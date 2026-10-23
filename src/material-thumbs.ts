/**
 * Previews of the research's files (spec 017 §3.5), shared by the person's
 * section (128 px) and the materials window (256 px).
 *
 * A preview comes from the browser's cache (IndexedDB `strom-materials`),
 * else from the bridge: `GET /media/<sha>?thumb=<px>` when the research makes
 * previews, otherwise only a JPEG/PNG/WebP up to 8 MB from `?file=1`, made
 * smaller here. At most 4 at once, newest wish first; a wish whose tile left
 * the screen is dropped. Pause/resume, nothing while the research is not
 * running, a busy research (503) is waited for, and a failure (415 or any
 * other) is remembered: the type's icon stays until the window opens again.
 *
 * UI-free: the bridge, the cache and the image work come in as dependencies.
 */

import {
    MaterialResult, ThumbSize, MaterialType, materialType,
    fetchThumb, fileUrl, getCachedThumb, putCachedThumb, MAX_RETRY_WAIT_MS,
} from './materials.js';

export const THUMB_CONCURRENCY = 4;
/** The largest file made into a preview here (without the research's previews). */
export const LOCAL_THUMB_MAX_BYTES = 8 * 1024 * 1024;
const LOCAL_THUMB_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Object URLs kept in memory (older ones are let go; the cache still has them). */
const KEEP_URLS = 800;

/** What a preview is wanted of. */
export interface ThumbTask {
    sha: string;
    px: ThumbSize;
    mime?: string;
    name?: string;
    bytes?: number;
    /** Where the item is shown (the strip's "in …"). */
    where?: string;
}

/** The tree and the research the previews are for. */
export interface ThumbEnv {
    treeId: string;
    base: string | null;
    /** The research makes previews (`matThumb`). */
    thumb: boolean;
    bridgeUp: boolean;
}

export interface ThumbDeps {
    getCached(treeId: string, sha: string, px: number): Promise<Blob | null>;
    putCached(treeId: string, sha: string, px: number, blob: Blob): Promise<void>;
    fetchThumb(base: string, sha: string, px: ThumbSize): Promise<MaterialResult<Blob>>;
    /** The file itself (`?file=1`); null: not to be had. */
    fetchFile(base: string, sha: string): Promise<Blob | null>;
    /** An image made at most `px` on its shorter side; null: not decodable. */
    shrink(blob: Blob, px: number): Promise<Blob | null>;
    sleep(ms: number): Promise<void>;
    createUrl(blob: Blob): string;
    revokeUrl(url: string): void;
}

export type ThumbPhase = 'idle' | 'running' | 'paused' | 'stopped';

export interface ThumbSnapshot {
    phase: ThumbPhase;
    /** Finished since the queue last started from empty. */
    done: number;
    /** Wished for since the queue last started from empty. */
    total: number;
    /** Waiting or on their way. */
    left: number;
    where: string;
}

type Deliver = (url: string | null) => void;
interface Waiter { deliver: Deliver; wanted: () => boolean }

const key = (sha: string, px: number) => `${sha}@${px}`;

/** How a preview of this file can be had now: from the research, made here, or not at all. */
export function thumbSource(task: Pick<ThumbTask, 'mime' | 'name' | 'bytes'>, env: Pick<ThumbEnv, 'thumb' | 'bridgeUp' | 'base'>): 'research' | 'local' | null {
    if (!env.bridgeUp || !env.base) return null;
    const type: MaterialType = materialType(task.mime, task.name);
    if (env.thumb) return type === 'image' || type === 'pdf' ? 'research' : null;
    const mime = (task.mime ?? '').toLowerCase();
    if (!LOCAL_THUMB_TYPES.includes(mime)) return null;
    if (task.bytes !== undefined && task.bytes > LOCAL_THUMB_MAX_BYTES) return null;
    return 'local';
}

export class MaterialThumbQueue {
    private env: ThumbEnv | null = null;
    private readonly urls = new Map<string, string>();
    private readonly failed = new Set<string>();
    private readonly waiters = new Map<string, Waiter[]>();
    /** Waiting for the bridge, in wish order (the newest is taken first). */
    private readonly pending = new Map<string, ThumbTask>();
    private readonly active = new Set<string>();
    private paused = false;
    private busyUntil = 0;
    private done = 0;
    private total = 0;
    private where = '';
    private readonly listeners = new Set<(s: ThumbSnapshot) => void>();

    constructor(private readonly deps: ThumbDeps = browserThumbDeps(), private readonly concurrency = THUMB_CONCURRENCY) {}

    /** The tree, the bridge and its capability (called on every redraw; a stopped bridge empties the queue). */
    setEnv(env: ThumbEnv | null): void {
        const prev = this.env;
        this.env = env;
        if (prev && env && prev.treeId !== env.treeId) this.clear();
        if (!env || !env.bridgeUp || !env.base) {
            this.dropPending();
        } else {
            this.pump();
        }
        this.emit();
    }

    /** A preview ready in memory (shown at once, no flicker). */
    urlOf(sha: string, px: number): string | null {
        return this.urls.get(key(sha, px)) ?? null;
    }

    hasFailed(sha: string, px: number): boolean {
        return this.failed.has(key(sha, px));
    }

    /**
     * Wish for a preview. `deliver` gets the URL, or null (the type's icon
     * stays). `wanted`: is it still on screen (checked before asking the bridge).
     */
    want(task: ThumbTask, deliver: Deliver, wanted: () => boolean = () => true): void {
        const k = key(task.sha, task.px);
        const ready = this.urls.get(k);
        if (ready) { deliver(ready); return; }
        if (this.failed.has(k)) { deliver(null); return; }
        const list = this.waiters.get(k);
        if (list) {
            list.push({ deliver, wanted });
            // Wished again: to the front of the line.
            const t = this.pending.get(k);
            if (t) { this.pending.delete(k); this.pending.set(k, t); }
            return;
        }
        this.waiters.set(k, [{ deliver, wanted }]);
        const env = this.env;
        if (!env) { this.finish(k, null); return; }
        void this.deps.getCached(env.treeId, task.sha, task.px).catch(() => null).then(blob => {
            if (blob) { this.finish(k, this.remember(k, blob)); return; }
            const now = this.env;
            if (!now || !thumbSource(task, now)) { this.finish(k, null); return; }
            this.pending.set(k, task);
            this.total++;
            this.pump();
            this.emit();
        });
    }

    pause(): void { this.paused = true; this.emit(); }

    resume(): void { this.paused = false; this.pump(); this.emit(); }

    /** A new opening of the window: failed previews may be tried again. */
    resetFailures(): void { this.failed.clear(); }

    /** Let go of everything (another tree; tests). */
    clear(): void {
        this.dropPending();
        for (const url of this.urls.values()) this.deps.revokeUrl(url);
        this.urls.clear();
        this.failed.clear();
        this.paused = false;
        this.emit();
    }

    snapshot(): ThumbSnapshot {
        const left = this.pending.size + this.active.size;
        const env = this.env;
        const phase: ThumbPhase = !env || !env.bridgeUp ? 'stopped' : left === 0 ? 'idle' : this.paused ? 'paused' : 'running';
        return { phase, done: this.done, total: this.total, left, where: this.where };
    }

    subscribe(fn: (s: ThumbSnapshot) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private emit(): void {
        const s = this.snapshot();
        for (const fn of this.listeners) fn(s);
    }

    private dropPending(): void {
        const keys = [...this.pending.keys()];
        this.pending.clear();
        for (const k of keys) this.finish(k, null, false);
        this.resetCounts();
    }

    private resetCounts(): void {
        if (this.pending.size + this.active.size === 0) { this.done = 0; this.total = 0; }
    }

    private remember(k: string, blob: Blob): string {
        const url = this.deps.createUrl(blob);
        this.urls.set(k, url);
        if (this.urls.size > KEEP_URLS) {
            const oldest = this.urls.keys().next().value as string;
            const old = this.urls.get(oldest);
            this.urls.delete(oldest);
            if (old) this.deps.revokeUrl(old);
        }
        return url;
    }

    private finish(k: string, url: string | null, fail = false): void {
        if (fail) this.failed.add(k);
        const list = this.waiters.get(k) ?? [];
        this.waiters.delete(k);
        for (const w of list) w.deliver(url);
    }

    private stillWanted(k: string): boolean {
        const list = this.waiters.get(k) ?? [];
        const keep = list.filter(w => w.wanted());
        if (keep.length) this.waiters.set(k, keep); else this.waiters.delete(k);
        return keep.length > 0;
    }

    private pump(): void {
        const env = this.env;
        if (!env || !env.bridgeUp || !env.base || this.paused || Date.now() < this.busyUntil) return;
        while (this.active.size < this.concurrency && this.pending.size) {
            const k = [...this.pending.keys()].pop()!;
            const task = this.pending.get(k)!;
            this.pending.delete(k);
            if (!this.stillWanted(k)) {
                // Left the screen before its turn: not counted.
                this.total = Math.max(0, this.total - 1);
                continue;
            }
            this.active.add(k);
            if (task.where) this.where = task.where;
            void this.run(k, task, env).finally(() => {
                this.active.delete(k);
                this.resetCounts();
                this.pump();
                this.emit();
            });
        }
        if (this.pending.size + this.active.size === 0) this.resetCounts();
    }

    private async run(k: string, task: ThumbTask, env: ThumbEnv): Promise<void> {
        const source = thumbSource(task, env);
        const base = env.base;
        if (!source || !base) { this.done++; this.finish(k, null); return; }
        try {
            let blob: Blob | null = null;
            if (source === 'research') {
                const answer = await this.deps.fetchThumb(base, task.sha, task.px);
                if (answer.ok) blob = answer.value;
                else if (answer.error.kind === 'busy') {
                    // The research makes too many previews now: wait, then this one again.
                    const wait = Math.min(MAX_RETRY_WAIT_MS, Math.max(1000, (answer.error.retry ?? 1) * 1000));
                    this.busyUntil = Date.now() + wait;
                    this.pending.set(k, task);
                    await this.deps.sleep(wait);
                    return;
                } else if (answer.error.kind === 'down' || answer.error.kind === 'aborted') {
                    // Not answering: the poll says so soon; nothing remembered.
                    this.done++;
                    this.finish(k, null);
                    return;
                }
            } else {
                const file = await this.deps.fetchFile(base, task.sha);
                blob = file ? await this.deps.shrink(file, task.px) : null;
            }
            this.done++;
            if (!blob) { this.finish(k, null, true); return; }
            const url = this.remember(k, blob);
            void this.deps.putCached(env.treeId, task.sha, task.px, blob).catch(() => undefined);
            this.finish(k, url);
        } catch {
            this.done++;
            this.finish(k, null, true);
        }
    }
}

/** Make an image at most `px` on its shorter side (JPEG); null: not decodable here. */
async function shrinkImage(blob: Blob, px: number): Promise<Blob | null> {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch {
        return null;
    }
    const scale = Math.min(1, px / Math.max(1, Math.min(bitmap.width, bitmap.height)));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return null; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.85));
}

export function browserThumbDeps(): ThumbDeps {
    return {
        getCached: getCachedThumb,
        putCached: putCachedThumb,
        fetchThumb: (base, sha, px) => fetchThumb(base, sha, px),
        async fetchFile(base, sha) {
            try {
                const res = await fetch(fileUrl(base, sha));
                return res.ok ? await res.blob() : null;
            } catch {
                return null;
            }
        },
        shrink: shrinkImage,
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        createUrl: blob => URL.createObjectURL(blob),
        revokeUrl: url => URL.revokeObjectURL(url),
    };
}

/** The app's one queue (the person's section and the window share it). */
let shared: MaterialThumbQueue | null = null;
export function materialThumbs(): MaterialThumbQueue {
    if (!shared) shared = new MaterialThumbQueue();
    return shared;
}
