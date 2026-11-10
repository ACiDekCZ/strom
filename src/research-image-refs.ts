/**
 * The research's images by their content hash (spec 071, `ged.imagesByHash`).
 *
 * A bridge with the feature gives `tree.ged?images=ref`: the very file it
 * would send, except that each embedded excerpt image is a reference
 *
 *     2 FILE strom-image:<sha256 of the JPEG bytes>
 *     3 _MIME image/jpeg
 *     3 _WIDTH 1200
 *     3 _HEIGHT 640
 *     3 _BYTES 84512
 *
 * The images themselves come by `POST <token>/images` ({"images": [sha…]},
 * 1–500 at once; the answer holds what it has, `missing` what the bridge
 * does not have and `more` what did not fit into it, asked again). Each image
 * is checked against its hash before it is used; anything that fails makes
 * the caller load the file with its images in it instead — never a tree with
 * some images left out.
 *
 * Images the app already holds are never downloaded again: the images of the
 * last file loaded (one research at a time, exactly that file's, so nothing a
 * tree dropped is kept alive), and in a new session those of the tree stored
 * for that research, found by hashing its excerpts once. No copy of its own:
 * the stored tree (and its image pool) is the store.
 *
 * Pure of the UI: the network, the hashing and the stored tree come in as
 * dependencies (tests, a real bridge).
 */

import { base64ToBytes, bytesToBase64 } from './base64.js';
import { sha256Bytes } from './sha256.js';

/** A FILE value that names an image by its hash. */
export const IMAGE_REF_PREFIX = 'strom-image:';
const REF_VALUE = /^strom-image:([0-9a-f]{64})\s*$/i;
const REF_LINE = /^(\d+)[ \t]+FILE[ \t]+strom-image:([0-9a-fA-F]{64})[ \t]*$/gm;
/** The image types a data URL of an excerpt may have (what the parser takes). */
const SAFE_IMAGE_MIME = /^image\/(jpeg|png|webp|gif)$/;

/** Hashes asked at once (the bridge takes 1–500). */
export const IMAGE_BATCH = 500;
/** Asks in flight at once (the bridge recommends 2–3). */
export const IMAGE_CONCURRENCY = 2;
/** Waits before asking again after a network error, a 5xx or an answer cut short. */
export const IMAGE_RETRY_MS: readonly number[] = [500, 1500, 4000];
/** How long one answer (≤ 8 MB) is waited for. */
export const IMAGE_ANSWER_MS = 60_000;

/** The hash a FILE value names (`strom-image:<sha>`, lower case), or null. */
export function imageRefSha(value: string): string | null {
    const m = REF_VALUE.exec(value);
    return m ? m[1].toLowerCase() : null;
}

/**
 * A FILE value with its image: a reference becomes the image's data URL from
 * `images`, or '' when not there (the image is then left out, as a file with
 * a reference was always read). Any other value as it is.
 */
export function resolveImageFile(value: string, images?: ReadonlyMap<string, string> | null): string {
    const sha = imageRefSha(value);
    if (!sha) return value;
    return images?.get(sha) ?? '';
}

/** An image the file names by its hash, with what its lines say of it. */
export interface ImageRef {
    sha: string;
    /** `_MIME` (lower case); image/jpeg when not said. */
    mime: string;
    width?: number;
    height?: number;
    bytes?: number;
}

/** The images a file names by their hashes, each once (first mention wins). */
export function findImageRefs(text: string): ImageRef[] {
    const out = new Map<string, ImageRef>();
    REF_LINE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_LINE.exec(text))) {
        const sha = m[2].toLowerCase();
        if (out.has(sha)) continue;
        const ref: ImageRef = { sha, mime: 'image/jpeg' };
        const sub = `${Number(m[1]) + 1}`;
        // Its own lines follow at once, one level deeper.
        let at = REF_LINE.lastIndex;
        for (let i = 0; i < 8 && at < text.length; i++) {
            const start = text.indexOf('\n', at);
            if (start < 0) break;
            const end = text.indexOf('\n', start + 1);
            const line = text.slice(start + 1, end < 0 ? text.length : end).replace(/\r$/, '');
            const [lvl, tag, ...rest] = line.trim().split(/\s+/);
            if (lvl !== sub) break;
            const value = rest.join(' ');
            if (tag === '_MIME' && value) ref.mime = value.toLowerCase();
            else if (tag === '_WIDTH' && /^\d+$/.test(value)) ref.width = Number(value);
            else if (tag === '_HEIGHT' && /^\d+$/.test(value)) ref.height = Number(value);
            else if (tag === '_BYTES' && /^\d+$/.test(value)) ref.bytes = Number(value);
            at = start + 1;
        }
        out.set(sha, ref);
    }
    return [...out.values()];
}

/** The address of the bridge's images (`<token>/images`) from its tree's (`<token>/tree.ged`). */
export function imagesUrlOf(gedUrl: string): string {
    try {
        const url = new URL(gedUrl);
        url.pathname = url.pathname.replace(/\/[^/]*$/, '/images');
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return gedUrl.replace(/\/[^/?#]*([?#].*)?$/, '/images');
    }
}

/** The address of the file with its images by reference (`images=ref`), the rest kept. */
export function refTreeUrl(gedUrl: string): string {
    try {
        const url = new URL(gedUrl);
        url.searchParams.set('images', 'ref');
        return url.toString();
    } catch {
        return gedUrl;
    }
}

/** Why the images could not be had: the caller loads the file with its images in it. */
export class ImagesNotResolved extends Error {
    constructor(message: string, readonly retry = false) {
        super(message);
        this.name = 'ImagesNotResolved';
    }
}

/** The network and the hashing (injected: tests, a real bridge). */
export interface ImageFetchDeps {
    fetch(url: string, init: RequestInit): Promise<Response>;
    /** SHA-256 of the bytes, 64 lower-case hex. */
    sha256Hex(bytes: Uint8Array): Promise<string>;
    sleep(ms: number): Promise<void>;
    /** The address with what the bridge is told of the app (e.g. `app=`); as it is by default. */
    address?(url: string): string;
}

/** What resolving needs besides: the excerpt images of the tree stored for a research. */
export interface ImageResolveDeps extends ImageFetchDeps {
    treeImages(researchId: string): Promise<Iterable<string>>;
}

/** SHA-256 hex of bytes (Web Crypto, or the built-in implementation outside a secure context). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await sha256Bytes(bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** The bytes of a base64 data URL, or null when it is not one. */
function dataUrlBytes(url: string): Uint8Array | null {
    const comma = url.indexOf(',');
    if (!url.startsWith('data:') || comma < 0 || !url.slice(0, comma).endsWith(';base64')) return null;
    try {
        return base64ToBytes(url.slice(comma + 1));
    } catch {
        return null;
    }
}

interface ImagesAnswer {
    images: { sha: string; mime: string; data: string }[];
    missing: string[];
    more: string[];
}

/** One answer of `POST /images` for `shas`, asked again after a network error, a 5xx or an answer cut short. */
async function askImages(url: string, shas: string[], deps: ImageFetchDeps): Promise<ImagesAnswer> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await askImagesOnce(url, shas, deps);
        } catch (err) {
            const retry = !(err instanceof ImagesNotResolved) || err.retry;
            if (!retry || attempt >= IMAGE_RETRY_MS.length) throw err;
            await deps.sleep(IMAGE_RETRY_MS[attempt]);
        }
    }
}

async function askImagesOnce(url: string, shas: string[], deps: ImageFetchDeps): Promise<ImagesAnswer> {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), IMAGE_ANSWER_MS) : null;
    try {
        const res = await deps.fetch(deps.address ? deps.address(url) : url, {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            // text/plain keeps it a simple request (the bridge reads the body as JSON).
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: JSON.stringify({ images: shas }),
            ...(ctl ? { signal: ctl.signal } : {}),
        });
        if (res.status >= 500) throw new ImagesNotResolved(`HTTP ${res.status}`, true);
        if (!res.ok) throw new ImagesNotResolved(`HTTP ${res.status}`);
        let body: unknown;
        try {
            // An answer cut short is no JSON: asked again.
            body = JSON.parse(await res.text());
        } catch {
            throw new ImagesNotResolved('answer cut short', true);
        }
        const b = body as Partial<ImagesAnswer> | null;
        const list = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
        if (!b || !Array.isArray(b.images) || !list(b.missing ?? []) || !list(b.more ?? [])
            || !b.images.every(i => i && typeof i.sha === 'string' && typeof i.data === 'string' && typeof i.mime === 'string')) {
            throw new ImagesNotResolved('unexpected answer');
        }
        return {
            images: b.images,
            missing: (b.missing ?? []).map(s => s.toLowerCase()),
            more: (b.more ?? []).map(s => s.toLowerCase()),
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * The images `refs` from the bridge (`url`: its `<token>/images`), each
 * checked against its hash, as the data URL the file with its images in it
 * would carry. Throws ImagesNotResolved (or the network's error) when any
 * one cannot be had: the bridge lacks it, refuses, keeps failing, or sends
 * bytes that do not give the hash (once more asked, then given up).
 */
export async function fetchImagesByHash(url: string, refs: readonly ImageRef[], deps: ImageFetchDeps): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const wanted = new Map(refs.map(r => [r.sha, r]));
    const queue: string[][] = [];
    const all = [...wanted.keys()];
    for (let i = 0; i < all.length; i += IMAGE_BATCH) queue.push(all.slice(i, i + IMAGE_BATCH));
    /** Hashes whose bytes did not give them once: asked once more. */
    const mismatched = new Set<string>();
    let failed: unknown = null;

    const handle = async (batch: string[]): Promise<void> => {
        const answer = await askImages(url, batch, deps);
        if (failed) return;
        if (answer.missing.length) throw new ImagesNotResolved(`not at the bridge: ${answer.missing.length}`);
        const open = new Set(batch);
        const again: string[] = [];
        for (const img of answer.images) {
            const sha = img.sha.toLowerCase();
            const ref = wanted.get(sha);
            // Only what was asked, once: nothing is ever kept under a hash not asked for.
            if (!ref || !open.delete(sha)) continue;
            const mime = img.mime.toLowerCase();
            if (mime !== ref.mime || !SAFE_IMAGE_MIME.test(mime)) throw new ImagesNotResolved(`unexpected type ${img.mime}`);
            let bytes: Uint8Array | null = null;
            try {
                bytes = base64ToBytes(img.data);
            } catch {
                bytes = null;
            }
            if (bytes && await deps.sha256Hex(bytes) === sha) {
                out.set(sha, `data:${mime};base64,${bytesToBase64(bytes)}`);
                continue;
            }
            if (mismatched.has(sha)) throw new ImagesNotResolved(`image does not give its hash: ${sha}`);
            mismatched.add(sha);
            again.push(sha);
        }
        for (const sha of answer.more) if (open.delete(sha)) again.push(sha);
        if (open.size) throw new ImagesNotResolved(`not answered: ${open.size}`);
        // An answer gives at least one image (or says why not): one with none would ask for ever.
        if (again.length === batch.length && !answer.images.length) throw new ImagesNotResolved('answer without images');
        if (again.length) queue.push(again);
    };

    const running = new Set<Promise<void>>();
    while (!failed && (queue.length || running.size)) {
        while (!failed && queue.length && running.size < IMAGE_CONCURRENCY) {
            const batch = queue.shift()!;
            const job: Promise<void> = handle(batch)
                .catch(err => { failed ??= err; })
                .finally(() => { running.delete(job); });
            running.add(job);
        }
        if (running.size) await Promise.race(running);
    }
    if (failed) throw failed;
    return out;
}

// ==================== THE IMAGES ALREADY HELD ====================

/** The images of the last file loaded: one research, exactly that file's images. */
let held: { researchId: string; bySha: Map<string, string> } | null = null;

/** Forget the images held (a file with its images in it was loaded, or none were taken). */
export function forgetHeldImages(): void {
    held = null;
}

/** The hashes of the images held for `researchId` (tests, diagnostics). */
export function heldImageShas(researchId: string): string[] {
    return held && held.researchId === researchId.toLowerCase() ? [...held.bySha.keys()] : [];
}

/** How a resolve went: how many images came from where. */
export interface ImagesResolved {
    images: Map<string, string>;
    /** From the images of the last file. */
    held: number;
    /** Found in the tree stored for the research (hashed). */
    seeded: number;
    /** Downloaded from the bridge. */
    fetched: number;
}

/**
 * Every image `refs` names, as data URLs by hash: those of the last file
 * loaded, then (a new session, another research) the stored tree's own,
 * found by hashing them, and the rest from the bridge at `imagesUrl`.
 * Throws when any cannot be had (the caller loads the whole file). After
 * success the images held are exactly these (the same strings the parsed
 * tree carries).
 */
export async function resolveImageRefs(
    o: { researchId: string | null; refs: readonly ImageRef[]; imagesUrl: string },
    deps: ImageResolveDeps,
): Promise<ImagesResolved> {
    const researchId = o.researchId ? o.researchId.toLowerCase() : null;
    const known = researchId && held?.researchId === researchId ? held.bySha : null;
    const images = new Map<string, string>();
    const want = new Map<string, ImageRef>();
    for (const ref of o.refs) {
        const url = known?.get(ref.sha);
        if (url && url.startsWith(`data:${ref.mime};base64,`)) images.set(ref.sha, url);
        else want.set(ref.sha, ref);
    }
    const fromHeld = images.size;
    let seeded = 0;
    // A new session (or another research): the stored tree's images, hashed once.
    if (want.size && researchId && !known) {
        for (const url of await deps.treeImages(researchId)) {
            if (!want.size) break;
            const bytes = dataUrlBytes(url);
            if (!bytes) continue;
            const sha = await deps.sha256Hex(bytes);
            const ref = want.get(sha);
            if (!ref || !url.startsWith(`data:${ref.mime};base64,`)) continue;
            images.set(sha, url);
            want.delete(sha);
            seeded++;
        }
    }
    let fetched = 0;
    if (want.size) {
        const got = await fetchImagesByHash(o.imagesUrl, [...want.values()], deps);
        for (const [sha, url] of got) images.set(sha, url);
        fetched = got.size;
    }
    for (const ref of o.refs) {
        if (!images.has(ref.sha)) throw new ImagesNotResolved(`not resolved: ${ref.sha}`);
    }
    if (researchId) held = { researchId, bySha: images };
    return { images, held: fromHeld, seeded, fetched };
}
