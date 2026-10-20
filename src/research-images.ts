/**
 * Source images the research left out of its file (`Source.imageHeld`,
 * `Source.heldClips`), loaded on request from its running bridge and kept
 * with the tree in this browser.
 *
 * They are never part of the tree's data: storing one is no edit (no undo
 * step, no unsaved change, nothing to send to the research) and a file export
 * carries them only when asked to. They live in a database of their own,
 * keyed by tree, the research's source id (`Source.refn`, "S0012") and the
 * excerpt's mark (`clip`) — the research keeps both across versions, and a
 * changed crop gets a new mark.
 *
 * The module is UI-free: storage (IndexedDB, replaceable for tests), the
 * bridge client (`GET <token>/excerpt/<S…>?clip=`, `GET <token>/excerpts?missing=1`),
 * the per-source state and the bulk loading queue.
 */

import { Source, SourceExcerpt, StromData } from './types.js';
import { excerptFromDataUrl } from './excerpts.js';
import { withAppVersion } from './research-link.js';

/** The bridge capability for both endpoints (research 1.18.0-beta.10+). */
export const EXCERPT_FEATURE = 'excerpt.get';

/** Fired on `window` when stored images of a tree change: `{ treeId, sourceRef? }`. */
export const RESEARCH_IMAGE_EVENT = 'research-image-stored';

/** How long one excerpt may take (the bridge renders a large scan in ~15 s; it answers 202 meanwhile). */
export const EXCERPT_TIMEOUT_MS = 60_000;

/** One image loaded from the research, as stored. */
export interface StoredResearchImage {
    /** `${treeId}|${sourceRef}|${clip}` */
    key: string;
    treeId: string;
    /** The research's source id (`Source.refn`). */
    sourceRef: string;
    /** The excerpt's mark (`input` = a document's whole input). */
    clip: string;
    /** Ready to show and to export as the source's excerpt. */
    excerpt: SourceExcerpt;
    loadedAt: number;
}

/** Why an excerpt did not load. */
export type LoadError = 'missingScan' | 'revoked' | { merged: string } | 'failed' | 'timeout';

/** The kind of a LoadError (for grouping in a summary). */
export type LoadErrorKind = 'missingScan' | 'revoked' | 'merged' | 'failed' | 'timeout';

export function loadErrorKind(err: LoadError): LoadErrorKind {
    return typeof err === 'object' ? 'merged' : err;
}

// ==================== STORAGE ====================

/** Where stored images live (IndexedDB in the app, a map in tests). */
export interface ResearchImageBackend {
    all(treeId: string): Promise<StoredResearchImage[]>;
    put(image: StoredResearchImage): Promise<void>;
    remove(keys: string[]): Promise<void>;
}

const DB_NAME = 'strom-research-images';
const STORE = 'images';

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Its own database: the app's main one stays at its version. */
function indexedDbBackend(): ResearchImageBackend {
    let dbPromise: Promise<IDBDatabase> | null = null;
    const open = (): Promise<IDBDatabase> => {
        if (!dbPromise) {
            dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE)) {
                        db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('treeId', 'treeId');
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            }).catch(err => {
                dbPromise = null;
                throw err;
            });
        }
        return dbPromise;
    };
    const tx = async (mode: IDBTransactionMode): Promise<IDBObjectStore> =>
        (await open()).transaction(STORE, mode).objectStore(STORE);
    return {
        async all(treeId) {
            const store = await tx('readonly');
            return idbRequest(store.index('treeId').getAll(treeId)) as Promise<StoredResearchImage[]>;
        },
        async put(image) {
            const store = await tx('readwrite');
            await idbRequest(store.put(image));
        },
        async remove(keys) {
            if (keys.length === 0) return;
            const store = await tx('readwrite');
            await Promise.all(keys.map(k => idbRequest(store.delete(k))));
        },
    };
}

/** An in-memory store (tests, or a browser without IndexedDB: kept for the tab only). */
export function memoryBackend(): ResearchImageBackend {
    const rows = new Map<string, StoredResearchImage>();
    return {
        async all(treeId) { return [...rows.values()].filter(r => r.treeId === treeId); },
        async put(image) { rows.set(image.key, image); },
        async remove(keys) { keys.forEach(k => rows.delete(k)); },
    };
}

let backend: ResearchImageBackend | null = null;
function store(): ResearchImageBackend {
    if (!backend) backend = typeof indexedDB !== 'undefined' ? indexedDbBackend() : memoryBackend();
    return backend;
}

/** Tree id → key → image: what is stored, read once per tree (sync for rendering). */
const cache = new Map<string, Map<string, StoredResearchImage>>();
const priming = new Map<string, Promise<void>>();

/** Replace the storage (tests); clears what is cached. */
export function setResearchImageBackend(next: ResearchImageBackend | null): void {
    backend = next;
    cache.clear();
    priming.clear();
}

export function imageKey(treeId: string, sourceRef: string, clip: string): string {
    return `${treeId}|${sourceRef}|${clip}`;
}

function notify(treeId: string, sourceRef?: string): void {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent(RESEARCH_IMAGE_EVENT, { detail: { treeId, sourceRef } }));
}

/** Read a tree's stored images into memory (once; later calls wait for the same read). */
export function primeResearchImages(treeId: string): Promise<void> {
    let p = priming.get(treeId);
    if (!p) {
        p = store().all(treeId).then(rows => {
            const map = new Map<string, StoredResearchImage>();
            for (const row of rows) if (row?.key && row.excerpt?.dataUrl) map.set(row.key, row);
            cache.set(treeId, map);
        }).catch(err => {
            console.warn('Reading stored research images failed', err);
            cache.set(treeId, cache.get(treeId) ?? new Map());
        });
        priming.set(treeId, p);
    }
    return p;
}

/** Have the tree's stored images been read (sync answers are complete)? */
export function researchImagesPrimed(treeId: string): boolean {
    return cache.has(treeId);
}

function treeRows(treeId: string): StoredResearchImage[] {
    return [...(cache.get(treeId)?.values() ?? [])];
}

/** The research's id of a source (its REFN), or null for a source that did not come from it. */
export function sourceRefOf(src: Pick<Source, 'refn'>): string | null {
    const ref = src.refn?.trim();
    return ref && /^S\d+$/.test(ref) ? ref : null;
}

/** Marks of the excerpts the tree's file brought for a source. */
function fileClips(src: Source): Set<string> {
    return new Set((src.excerpts ?? []).map(e => e.clip).filter((c): c is string => !!c));
}

/**
 * The stored images of a source, in the research's order (its held marks),
 * without those the file now brings itself.
 */
export function storedImagesOf(treeId: string | null | undefined, src: Source): StoredResearchImage[] {
    const ref = treeId ? sourceRefOf(src) : null;
    if (!treeId || !ref) return [];
    const inFile = fileClips(src);
    const order = src.heldClips ?? [];
    const rank = (clip: string): number => { const i = order.indexOf(clip); return i < 0 ? order.length : i; };
    return treeRows(treeId)
        .filter(r => r.sourceRef === ref && !inFile.has(r.clip))
        .sort((a, b) => rank(a.clip) - rank(b.clip) || a.loadedAt - b.loadedAt);
}

/** Every excerpt of a source the app has: the file's, then the stored ones. */
export function shownExcerpts(treeId: string | null | undefined, src: Source): SourceExcerpt[] {
    const own = src.excerpts ?? [];
    const stored = storedImagesOf(treeId, src);
    return stored.length ? [...own, ...stored.map(r => r.excerpt)] : own;
}

/**
 * Marks of a source's excerpts that are only in the research and could be
 * loaded: held, not in the file, not stored, not known as missing / gone.
 * A source marked `missing` has nothing to load.
 */
export function pendingClips(treeId: string | null | undefined, src: Source, head?: string): string[] {
    if (!src.imageHeld || src.imageHeld === 'missing' || !src.heldClips?.length) return [];
    const ref = sourceRefOf(src);
    if (!ref) return [];
    const inFile = fileClips(src);
    const stored = new Set(treeId ? storedImagesOf(treeId, src).map(r => r.clip) : []);
    return src.heldClips.filter(c => !inFile.has(c) && !stored.has(c)
        && !(treeId && knownImageError(treeId, head, ref, c)));
}

/** Put one loaded image into the store (and the cache). */
export async function putResearchImage(image: StoredResearchImage): Promise<void> {
    await primeResearchImages(image.treeId);
    await store().put(image);
    cache.get(image.treeId)?.set(image.key, image);
    notify(image.treeId, image.sourceRef);
}

/** Remove a source's stored images (all of the tree's without `sourceRef`). */
export async function removeResearchImages(treeId: string, sourceRef?: string): Promise<{ n: number; bytes: number }> {
    await primeResearchImages(treeId);
    const rows = treeRows(treeId).filter(r => !sourceRef || r.sourceRef === sourceRef);
    await store().remove(rows.map(r => r.key));
    const map = cache.get(treeId);
    rows.forEach(r => map?.delete(r.key));
    if (rows.length) notify(treeId, sourceRef);
    return { n: rows.length, bytes: rows.reduce((sum, r) => sum + (r.excerpt.sizeBytes || 0), 0) };
}

/** How much the tree keeps from the research (sync: call after primeResearchImages). */
export function researchImagesTotal(treeId: string | null | undefined): { sources: number; images: number; bytes: number } {
    if (!treeId) return { sources: 0, images: 0, bytes: 0 };
    const rows = treeRows(treeId);
    return {
        sources: new Set(rows.map(r => r.sourceRef)).size,
        images: rows.length,
        bytes: rows.reduce((sum, r) => sum + (r.excerpt.sizeBytes || 0), 0),
    };
}

/**
 * A new version of the research brought some images in its file: the stored
 * copies of those go quietly. Others stay (also of a source no longer in the
 * file: its id may come back).
 */
export async function pruneDeliveredImages(treeId: string, data: StromData): Promise<number> {
    await primeResearchImages(treeId);
    const delivered = new Set<string>();
    for (const src of Object.values(data.sources ?? {})) {
        const ref = src ? sourceRefOf(src) : null;
        if (!ref) continue;
        fileClips(src).forEach(c => delivered.add(imageKey(treeId, ref, c)));
    }
    const gone = treeRows(treeId).filter(r => delivered.has(r.key)).map(r => r.key);
    if (gone.length === 0) return 0;
    await store().remove(gone);
    const map = cache.get(treeId);
    gone.forEach(k => map?.delete(k));
    notify(treeId);
    return gone.length;
}

/** Does the tree have anything to do with research images (stored, or held in its sources)? */
export function hasResearchImages(treeId: string | null | undefined, data: StromData): boolean {
    if (researchImagesTotal(treeId).images > 0) return true;
    return Object.values(data.sources ?? {}).some(s => !!s?.imageHeld);
}

// ==================== REMEMBERED FAILURES ====================

/**
 * A missing scan or a source gone from the research does not change until the
 * research's next version: remembered per tree with the head it was seen at.
 */
type KnownError = 'missingScan' | 'revoked';
const ERRORS_KEY = 'strom-research-image-errors';
let knownErrors: Record<string, { head: string; errors: Record<string, KnownError> }> | null = null;

function loadKnownErrors(): Record<string, { head: string; errors: Record<string, KnownError> }> {
    if (knownErrors) return knownErrors;
    knownErrors = {};
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(ERRORS_KEY) : null;
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') knownErrors = parsed;
    } catch { /* storage unavailable: kept for the tab only */ }
    return knownErrors!;
}

function saveKnownErrors(): void {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(ERRORS_KEY, JSON.stringify(knownErrors ?? {}));
    } catch { /* storage unavailable */ }
}

export function knownImageError(treeId: string, head: string | undefined, sourceRef: string, clip: string): KnownError | null {
    const entry = loadKnownErrors()[treeId];
    if (!entry || entry.head !== (head ?? '')) return null;
    return entry.errors[`${sourceRef}|${clip}`] ?? entry.errors[`${sourceRef}|*`] ?? null;
}

export function rememberImageError(treeId: string, head: string | undefined, sourceRef: string, clip: string | '*', err: KnownError): void {
    const all = loadKnownErrors();
    const h = head ?? '';
    if (!all[treeId] || all[treeId].head !== h) all[treeId] = { head: h, errors: {} };
    all[treeId].errors[`${sourceRef}|${clip}`] = err;
    saveKnownErrors();
}

/** Forget the remembered failures (tests). */
export function resetKnownImageErrors(): void {
    knownErrors = {};
    saveKnownErrors();
}

// ==================== BRIDGE ====================

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** One excerpt as the bridge sends it. */
interface BridgeExcerpt {
    clip?: unknown; sha?: unknown; region?: unknown; orient?: unknown; width?: unknown; height?: unknown;
    url?: unknown; dataUrl?: unknown;
}

function sanitizeRegion(raw: unknown): SourceExcerpt['region'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const nums = [r.x, r.y, r.w, r.h];
    if (!nums.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return undefined;
    return { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number };
}

/** The bridge's excerpt as the source's excerpt (null when its image is not a safe raster image). */
export function excerptFromBridge(item: BridgeExcerpt, clip: string): SourceExcerpt | null {
    if (typeof item.dataUrl !== 'string') return null;
    const sha = typeof item.sha === 'string' && /^[0-9a-f]{64}$/i.test(item.sha) ? item.sha.toLowerCase() : undefined;
    const orient = typeof item.orient === 'number' && item.orient >= 2 && item.orient <= 8 ? item.orient : undefined;
    const pageUrl = typeof item.url === 'string' && /^https?:\/\//i.test(item.url) ? item.url : undefined;
    const exc = excerptFromDataUrl(item.dataUrl, { clip, originalSha: sha, region: sanitizeRegion(item.region), orient, pageUrl });
    if (!exc) return null;
    exc.id = `rx-${clip}`;
    return exc;
}

const delay = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

function abortError(): Error {
    const err = new Error('aborted');
    err.name = 'AbortError';
    return err;
}

/**
 * Fetch one excerpt from the bridge, asking again while it answers 202 (it
 * makes at least one new excerpt per request). Throws an AbortError only when
 * `signal` aborts; every other failure is a LoadError.
 */
export async function fetchExcerpt(
    base: string, sourceRef: string, clip: string, signal?: AbortSignal,
    opts: { timeoutMs?: number; fetchImpl?: FetchLike; retryDelayMs?: number } = {},
): Promise<{ ok: true; excerpt: SourceExcerpt } | { ok: false; error: LoadError }> {
    const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? EXCERPT_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const url = withAppVersion(`${base}/excerpt/${encodeURIComponent(sourceRef)}?clip=${encodeURIComponent(clip)}`);
    try {
        for (;;) {
            if (signal?.aborted) throw abortError();
            if (timeout.signal.aborted) return { ok: false, error: 'timeout' };
            let res: Response;
            try {
                res = await fetchImpl(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: timeout.signal });
            } catch {
                if (signal?.aborted) throw abortError();
                return { ok: false, error: timeout.signal.aborted ? 'timeout' : 'failed' };
            }
            let body: Record<string, unknown> | null = null;
            try { body = await res.json() as Record<string, unknown>; } catch { body = null; }
            if (res.status === 202) {
                await delay(opts.retryDelayMs ?? 150, timeout.signal);
                continue;
            }
            if (res.status === 200 && body) {
                const missing = Array.isArray(body.missing) ? body.missing : [];
                if (missing.includes(clip)) return { ok: false, error: 'missingScan' };
                const items = Array.isArray(body.excerpts) ? body.excerpts as BridgeExcerpt[] : [];
                const item = items.find(e => e && e.clip === clip);
                const excerpt = item ? excerptFromBridge(item, clip) : null;
                return excerpt ? { ok: true, excerpt } : { ok: false, error: 'failed' };
            }
            const code = typeof body?.code === 'string' ? body.code : '';
            if (res.status === 404 && code === 'source.unknown') return { ok: false, error: 'revoked' };
            if (res.status === 410) {
                const moved = typeof body?.movedTo === 'string' && /^S\d+$/.test(body.movedTo) ? body.movedTo : null;
                return { ok: false, error: moved ? { merged: moved } : 'revoked' };
            }
            return { ok: false, error: 'failed' };
        }
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/** Load one excerpt and store it (a known failure is remembered until the research's next version). */
export async function loadResearchImage(
    treeId: string, base: string, head: string | undefined, sourceRef: string, clip: string, signal?: AbortSignal,
    opts: { timeoutMs?: number; fetchImpl?: FetchLike; retryDelayMs?: number } = {},
): Promise<StoredResearchImage | LoadError> {
    const res = await fetchExcerpt(base, sourceRef, clip, signal, opts);
    if (!res.ok) {
        if (res.error === 'missingScan') rememberImageError(treeId, head, sourceRef, clip, 'missingScan');
        if (res.error === 'revoked') rememberImageError(treeId, head, sourceRef, '*', 'revoked');
        return res.error;
    }
    const image: StoredResearchImage = {
        key: imageKey(treeId, sourceRef, clip), treeId, sourceRef, clip, excerpt: res.excerpt, loadedAt: Date.now(),
    };
    await putResearchImage(image);
    return image;
}

/** One source of the bridge's list of what is only in the research. */
export interface MissingSource {
    source: string;
    why: string;
    clips: string[];
    /** As they come in a data URL (base64). */
    bytes: number;
    ready: boolean;
}

export interface MissingList {
    head: string;
    count: number;
    clips: number;
    bytes: number;
    estimated: boolean;
    sources: MissingSource[];
}

/** `GET <token>/excerpts?missing=1`: what the research left out and can give (null when it cannot say). */
export async function fetchMissingList(base: string, signal?: AbortSignal, fetchImpl?: FetchLike): Promise<MissingList | null> {
    const f: FetchLike = fetchImpl ?? ((u, i) => fetch(u, i));
    try {
        const res = await f(withAppVersion(`${base}/excerpts?missing=1`), { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal });
        if (!res.ok) return null;
        const body = await res.json() as Record<string, unknown>;
        const sources: MissingSource[] = (Array.isArray(body.sources) ? body.sources : []).flatMap((raw: unknown) => {
            if (!raw || typeof raw !== 'object') return [];
            const s = raw as Record<string, unknown>;
            if (typeof s.source !== 'string' || !/^S\d+$/.test(s.source)) return [];
            const clips = Array.isArray(s.clips) ? s.clips.filter((c): c is string => typeof c === 'string' && /^[A-Za-z0-9-]{1,32}$/.test(c)) : [];
            return [{
                source: s.source, why: typeof s.why === 'string' ? s.why : '', clips,
                bytes: typeof s.bytes === 'number' && s.bytes > 0 ? s.bytes : 0, ready: s.ready === true,
            }];
        });
        const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
        return {
            head: typeof body.head === 'string' ? body.head : '',
            count: num(body.count) || sources.length,
            clips: num(body.clips) || sources.reduce((n, s) => n + s.clips.length, 0),
            bytes: num(body.bytes) || sources.reduce((n, s) => n + s.bytes, 0),
            estimated: body.estimated === true,
            sources,
        };
    } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return null;
    }
}

// ==================== STATE ====================

/** What the app can do about a held image here. */
export type HeldImageMode = 'fetch' | 'bridgeOff' | 'device' | 'older';

/**
 * - `device`: a phone / tablet (the bridge runs on a computer);
 * - `older`: not linked to a research here, or its bridge cannot give excerpts;
 * - `bridgeOff`: linked, but its bridge is not running;
 * - `fetch`: the bridge runs and gives excerpts.
 */
export function heldImageMode(env: { onComputer: boolean; linked: boolean; bridgeUp: boolean; features?: readonly string[] | null }): HeldImageMode {
    if (!env.onComputer) return 'device';
    if (!env.linked) return 'older';
    if (!env.bridgeUp) return 'bridgeOff';
    return env.features?.includes(EXCERPT_FEATURE) ? 'fetch' : 'older';
}

/** The source viewer's image state. */
export type SourceImageState = 'loading' | 'canLoad' | 'loaded' | 'partial' | 'bridgeOff' | 'device' | 'older' | null;

/**
 * One state for a source's image block: `pending` = excerpts that could be
 * loaded, `shown` = excerpts the app has (file + stored), `stored` = of those
 * from the research, `loading` = a load runs for it.
 */
export function sourceImageState(src: Source, counts: { pending: number; shown: number; stored: number }, mode: HeldImageMode, loading: boolean): SourceImageState {
    if (counts.pending === 0 || !src.imageHeld) return counts.stored > 0 ? 'loaded' : null;
    if (mode !== 'fetch') return mode;
    if (loading) return 'loading';
    return counts.shown > 0 ? 'partial' : 'canLoad';
}

// ==================== BULK QUEUE ====================

export type QueuePhase = 'running' | 'paused' | 'done' | 'stopped' | 'bridgeOff';

export interface QueueTask {
    sourceRef: string;
    clips: string[];
    ready?: boolean;
}

export interface QueueSnapshot {
    phase: QueuePhase;
    /** Sources finished (loaded or failed). */
    done: number;
    /** Sources loaded fully. */
    loaded: number;
    total: number;
    bytes: number;
    /** Failed excerpts by reason. */
    failed: Partial<Record<LoadErrorKind, number>>;
    /** Sources with a failure. */
    failedSources: number;
    /** Images of all sources, and those finished (loaded or failed): the toolbar badge counts these. */
    images: number;
    imagesDone: number;
}

/**
 * Loads sources one after another, their excerpts one by one, ready ones
 * first. Pause waits after the excerpt in flight; stop aborts it. A load that
 * finds the bridge gone ends the queue as `bridgeOff`. Lives in the tab only.
 */
export class ResearchImageQueue {
    private tasks: QueueTask[];
    private index = 0;
    private abort: AbortController | null = null;
    private resumeWaiter: (() => void) | null = null;
    private listeners = new Set<(s: QueueSnapshot) => void>();
    readonly finished: Promise<QueueSnapshot>;
    private finish!: (s: QueueSnapshot) => void;
    private state: QueueSnapshot;

    constructor(
        tasks: QueueTask[],
        private readonly load: (sourceRef: string, clip: string, signal: AbortSignal) => Promise<StoredResearchImage | LoadError>,
        private readonly bridgeUp: () => boolean = () => true,
    ) {
        this.tasks = [...tasks].sort((a, b) => Number(!!b.ready) - Number(!!a.ready));
        this.state = {
            phase: 'running', done: 0, loaded: 0, total: this.tasks.length, bytes: 0, failed: {}, failedSources: 0,
            images: this.tasks.reduce((n, t) => n + t.clips.length, 0), imagesDone: 0,
        };
        this.finished = new Promise(resolve => { this.finish = resolve; });
    }

    get snapshot(): QueueSnapshot { return { ...this.state, failed: { ...this.state.failed } }; }
    get active(): boolean { return this.state.phase === 'running' || this.state.phase === 'paused'; }
    /** Source ids still to load (not reached yet). */
    get remaining(): string[] { return this.tasks.slice(this.index).map(t => t.sourceRef); }

    subscribe(fn: (s: QueueSnapshot) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private emit(): void { const s = this.snapshot; this.listeners.forEach(fn => fn(s)); }

    start(): Promise<QueueSnapshot> {
        void this.run();
        return this.finished;
    }

    pause(): void {
        if (this.state.phase !== 'running') return;
        this.state.phase = 'paused';
        this.emit();
    }

    resume(): void {
        if (this.state.phase !== 'paused') return;
        this.state.phase = 'running';
        this.emit();
        this.resumeWaiter?.();
    }

    stop(): void {
        if (!this.active) return;
        this.end('stopped');
        this.abort?.abort();
        this.resumeWaiter?.();
    }

    private end(phase: QueuePhase): void {
        if (!this.active) return;
        this.state.phase = phase;
        this.emit();
        this.finish(this.snapshot);
    }

    private async run(): Promise<void> {
        this.emit();
        while (this.index < this.tasks.length) {
            if (this.state.phase === 'paused') await new Promise<void>(r => { this.resumeWaiter = r; });
            this.resumeWaiter = null;
            if (!this.active) return;
            if (!this.bridgeUp()) { this.end('bridgeOff'); return; }
            const task = this.tasks[this.index];
            let failedHere = false;
            let reachedEnd = true;
            for (const clip of task.clips) {
                if (!this.active) return;
                this.abort = new AbortController();
                let result: StoredResearchImage | LoadError;
                try {
                    result = await this.load(task.sourceRef, clip, this.abort.signal);
                } catch {
                    if (!this.active) return;
                    result = 'failed';
                }
                if (!this.active) return;
                if (typeof result === 'object' && 'key' in result) {
                    this.state.bytes += result.excerpt.sizeBytes || 0;
                    this.state.imagesDone++;
                    this.emit();
                    continue;
                }
                if ((result === 'failed' || result === 'timeout') && !this.bridgeUp()) {
                    // The research stopped running: this source stays for the next run.
                    reachedEnd = false;
                    break;
                }
                failedHere = true;
                this.state.imagesDone++;
                const kind = loadErrorKind(result);
                this.state.failed[kind] = (this.state.failed[kind] ?? 0) + 1;
                if (kind === 'revoked' || kind === 'merged') break;
            }
            if (!reachedEnd) { this.end('bridgeOff'); return; }
            this.index++;
            this.state.done++;
            if (failedHere) this.state.failedSources++;
            else this.state.loaded++;
            this.emit();
        }
        this.end('done');
    }
}

// ==================== SIZES ====================

/** A byte size for people: "280 kB", "3,1 MB" (decimal comma in cs/de). */
export function formatImageBytes(bytes: number, lang: 'en' | 'cs' | 'de'): string {
    const num = (v: number, digits: number): string => {
        const s = v.toFixed(digits);
        return lang === 'en' ? s : s.replace('.', ',');
    };
    if (bytes >= 1024 * 1024 * 1024) return `${num(bytes / (1024 * 1024 * 1024), 1)} GB`;
    if (bytes >= 1024 * 1024) return `${num(bytes / (1024 * 1024), 1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}
