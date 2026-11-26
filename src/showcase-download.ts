/**
 * Downloading the showcase (spec 143 §2, §3): its file from the same origin
 * (`/demo/<lang>/strom-ukazka-<lang>.json`, outside the app's service
 * worker), read as a stream with its progress, and why it did not come
 * (offline, the server, no room, a broken file, a newer format). Its
 * version beside it (`/demo/<lang>/VERSION`). No DOM here: the UI
 * (src/ui/showcase-open-ui.ts) says it all.
 */

import { compareSampleVersion, parseShowcaseFile, SHOWCASE_LANGS, type ShowcaseFile, type ShowcaseLang } from './showcase-format.js';
import type { TreeSampleMark } from './types.js';

/** Why a showcase did not open (§3); `cancelled`: the person stopped the download (nothing said but the toast). */
export type ShowcaseErrorKind = 'offline' | 'server' | 'space' | 'broken' | 'newerFormat';

export type ShowcaseDownloadResult =
    | { ok: true; file: ShowcaseFile; bytes: number }
    | { ok: false; kind: 'cancelled' }
    | { ok: false; kind: 'offline' }
    | { ok: false; kind: 'server'; status?: number }
    | { ok: false; kind: 'space'; bytes: number }
    | { ok: false; kind: 'broken' | 'newerFormat' };

/** How far a download is: bytes in, of the whole (null: not known). */
export interface ShowcaseProgress {
    done: number;
    total: number | null;
}

/** The value of `?demo=` the app opens (anything else is ignored). */
export function showcaseLangParam(value: string | null | undefined): ShowcaseLang | null {
    const v = (value ?? '').trim().toLowerCase();
    return (SHOWCASE_LANGS as readonly string[]).includes(v) ? v as ShowcaseLang : null;
}

/** The export id of a language's showcase (fixed across its versions). */
export function showcaseExportId(lang: ShowcaseLang): string {
    return `showcase-${lang}`;
}

/** The showcase file's address, from the origin's root (the app runs at /run/). */
export function showcaseFileUrl(lang: ShowcaseLang): string {
    return `/demo/${lang}/strom-ukazka-${lang}.json`;
}

/** The address of the showcase's version beside its file. */
export function showcaseVersionUrl(lang: ShowcaseLang): string {
    return `/demo/${lang}/VERSION`;
}

/** localStorage key: the newer version already offered for a language (offered once per version). */
export function showcaseOfferedKey(lang: ShowcaseLang): string {
    return `strom-sample-offered-${lang}`;
}

/** Megabytes with one decimal in the language's way ("2,4" in Czech, "2.4" in English). */
export function formatShowcaseMb(bytes: number, lang: string): string {
    const mb = Math.max(0, bytes) / (1024 * 1024);
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(mb);
}

/** The share done, 0–100 (null: the whole is not known). */
export function showcasePercent(p: ShowcaseProgress): number | null {
    if (!p.total || p.total <= 0) return null;
    return Math.max(0, Math.min(100, Math.floor((p.done / p.total) * 100)));
}

/**
 * The file's size as its header says it (`sizeBytes`), read from its first
 * bytes (the header comes first); null when they do not say it.
 */
export function showcaseSizeFromPrefix(prefix: string): number | null {
    const m = /"sizeBytes"\s*:\s*(\d{1,12})\b/.exec(prefix.slice(0, 8192));
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** The room a showcase of `bytes` needs in the browser's storage (twice its size: the tree and its images). */
export function showcaseRoomNeeded(bytes: number): number {
    return 2 * Math.max(0, bytes);
}

/** The storage estimate leaves less room than the showcase needs (unknown: enough). */
export function showcaseRoomShort(estimate: { quota?: number; usage?: number } | null | undefined, bytes: number): boolean {
    if (!estimate || typeof estimate.quota !== 'number' || !Number.isFinite(estimate.quota) || estimate.quota <= 0) return false;
    const free = estimate.quota - (typeof estimate.usage === 'number' && Number.isFinite(estimate.usage) ? estimate.usage : 0);
    return free < showcaseRoomNeeded(bytes);
}

/** A failed fetch (not an HTTP answer): the person stopped it, or the network is not there. */
export function showcaseFetchFailure(err: unknown, online: boolean): 'cancelled' | 'offline' | 'server' {
    if (isAbort(err)) return 'cancelled';
    if (!online || err instanceof TypeError) return 'offline';
    return 'server';
}

/** A write the browser refused for lack of room (IndexedDB, localStorage). */
export function isQuotaError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return /quota/i.test(String(err ?? ''));
    const e = err as { name?: unknown; message?: unknown; code?: unknown };
    return e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(String(e.message ?? ''));
}

function isAbort(err: unknown): boolean {
    return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
}

/** Read a downloaded (or opened) showcase's text: its JSON, its header and body (§3: broken, newer format). */
export function readShowcaseText(text: string): { ok: true; file: ShowcaseFile } | { ok: false; kind: 'broken' | 'newerFormat' } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
        return { ok: false, kind: 'broken' };
    }
    const read = parseShowcaseFile(parsed);
    if (read.ok) return read;
    // Downloaded as the showcase and no showcase at all: an unknown file.
    return { ok: false, kind: read.kind === 'newerFormat' ? 'newerFormat' : 'broken' };
}

export interface ShowcaseDownloadDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    online: () => boolean;
    /** The browser's storage estimate (null: not known). */
    estimate: () => Promise<{ quota?: number; usage?: number } | null>;
}

/** The browser's own ways (a test hands its own). */
export function browserShowcaseDeps(): ShowcaseDownloadDeps {
    return {
        fetch: (url, init) => fetch(url, init),
        online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
        estimate: async () => {
            try {
                const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
                return storage && typeof storage.estimate === 'function' ? await storage.estimate() : null;
            } catch {
                return null;
            }
        },
    };
}

/**
 * Download the showcase file at `url` and read it (§2 steps 2–3). Its
 * progress as it comes (`onProgress`); `signal` stops it (`cancelled`). The
 * whole is the header's `sizeBytes` as soon as its first bytes say it, else
 * the answer's Content-Length. Not enough room for it in the browser's
 * storage (2× its size): stopped at once (`space`).
 */
export async function downloadShowcase(url: string, opts: {
    signal: AbortSignal;
    onProgress?: (p: ShowcaseProgress) => void;
    deps?: ShowcaseDownloadDeps;
}): Promise<ShowcaseDownloadResult> {
    const deps = opts.deps ?? browserShowcaseDeps();
    if (!deps.online()) return { ok: false, kind: 'offline' };
    let res: Response;
    try {
        res = await deps.fetch(url, { signal: opts.signal, cache: 'no-cache', credentials: 'same-origin' });
    } catch (err) {
        const kind = opts.signal.aborted ? 'cancelled' : showcaseFetchFailure(err, deps.online());
        if (kind === 'cancelled') return { ok: false, kind: 'cancelled' };
        return kind === 'offline' ? { ok: false, kind: 'offline' } : { ok: false, kind: 'server' };
    }
    if (res.status !== 200) {
        try { await res.body?.cancel(); } catch { /* nothing to free */ }
        return { ok: false, kind: 'server', status: res.status };
    }
    const lengthHeader = Number(res.headers.get('content-length'));
    let total: number | null = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;
    let sizeKnown = false;
    const chunks: Uint8Array[] = [];
    let done = 0;
    const decoder = new TextDecoder('utf-8');
    let prefix = '';
    /** Not enough room: said at once, the rest never downloaded. */
    const roomShortFor = async (bytes: number): Promise<boolean> => showcaseRoomShort(await deps.estimate(), bytes);
    if (total !== null && await roomShortFor(total)) {
        try { await res.body?.cancel(); } catch { /* nothing to free */ }
        return { ok: false, kind: 'space', bytes: total };
    }
    opts.onProgress?.({ done, total });
    const body = res.body;
    try {
        if (!body) {
            const buf = new Uint8Array(await res.arrayBuffer());
            chunks.push(buf);
            done = buf.byteLength;
        } else {
            const reader = body.getReader();
            for (;;) {
                const { value, done: end } = await reader.read();
                if (end) break;
                if (!value) continue;
                chunks.push(value);
                done += value.byteLength;
                if (!sizeKnown && prefix.length < 8192) {
                    prefix += decoder.decode(value.subarray(0, Math.min(value.byteLength, 8192)), { stream: true });
                    const size = showcaseSizeFromPrefix(prefix);
                    if (size !== null) {
                        sizeKnown = true;
                        total = size;
                        if (await roomShortFor(size)) {
                            try { await reader.cancel(); } catch { /* nothing to free */ }
                            return { ok: false, kind: 'space', bytes: size };
                        }
                    }
                }
                opts.onProgress?.({ done, total: total !== null ? Math.max(total, done) : null });
            }
        }
    } catch (err) {
        if (opts.signal.aborted || isAbort(err)) return { ok: false, kind: 'cancelled' };
        // Broken off in the middle: the server's (or the network's) end.
        return deps.online() ? { ok: false, kind: 'server' } : { ok: false, kind: 'offline' };
    }
    if (opts.signal.aborted) return { ok: false, kind: 'cancelled' };
    const all = new Uint8Array(done);
    let at = 0;
    for (const c of chunks) {
        all.set(c, at);
        at += c.byteLength;
    }
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(all);
    } catch {
        return { ok: false, kind: 'broken' };
    }
    const read = readShowcaseText(text);
    if (!read.ok) return read;
    return { ok: true, file: read.file, bytes: done };
}

/** The showcase's version on the web (`VERSION`, one line); null on any failure (said nowhere). */
export async function fetchShowcaseVersion(lang: ShowcaseLang, deps: Pick<ShowcaseDownloadDeps, 'fetch'> = browserShowcaseDeps()): Promise<string | null> {
    try {
        const res = await deps.fetch(showcaseVersionUrl(lang), { cache: 'no-store', credentials: 'same-origin' });
        if (res.status !== 200) return null;
        const text = (await res.text()).trim().split(/\s+/)[0] ?? '';
        return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(text) && text.length <= 60 ? text : null;
    } catch {
        return null;
    }
}

/** The web's version, when it is newer than the tree's showcase (else null). */
export function newerShowcaseVersion(mark: TreeSampleMark | undefined, remote: string | null | undefined): string | null {
    if (!mark || !remote) return null;
    return compareSampleVersion(remote, mark.sampleVersion) > 0 ? remote : null;
}
