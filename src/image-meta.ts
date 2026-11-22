/**
 * The catalog of pooled images: what the app needs to know about an image
 * without having the image itself — its data URL's length and head, its byte
 * and pixel size, the two content tokens the fingerprints use and the SHA-256
 * of its bytes (the research bridge names images by it).
 *
 * Each entry is computed once, from the data URL, when the image goes into
 * the pool (media-pool.ts storeImages), and stored with the tree record and
 * the backup that name it. Kept in memory by content id, so any place can
 * ask synchronously what used to need the whole data URL: dataUrlByteSize,
 * dataUrlImageSize, the research fingerprint's image token, the browser
 * media token, the bytes' hash. The values are exactly those the functions
 * give for the data URL, so fingerprints stay the same.
 */

import { dataUrlByteSize, dataUrlImageSize } from './photo.js';
import { base64ToBytes } from './base64.js';
import { sha256Bytes } from './sha256.js';

/** What the catalog keeps of one pooled image (about 150 bytes). */
export interface ImageMeta {
    /** Length of the data URL (the research changes' `img:<length>`). */
    len: number;
    /** The data URL's head up to and including the comma (`data:image/jpeg;base64,`). */
    head: string;
    /** dataUrlByteSize of the data URL. */
    bytes: number;
    /** dataUrlImageSize of the data URL, when it gives one. */
    w?: number;
    h?: number;
    /** imageToken of the data URL (the research link's content fingerprint). */
    token: string;
    /** mediaToken of the data URL (browserMediaFingerprint). */
    mtok: string;
    /** SHA-256 hex of the decoded bytes; only for a base64 data URL. */
    sha?: string;
}

/** Content id → stored data, as a tree record or a backup keeps them. */
export type ImageMetaRecord = Record<string, ImageMeta>;

// ---- the tokens (browser-media.ts takes its token from here) ----

/**
 * The same as research-link.ts's imageToken (a test pins both to one value).
 * Stands for an image in the research fingerprint: its length and a hash of
 * every 16th character plus the tail. Any real change of a picture (a new
 * crop, a rotation, another scan) changes the length or the sample; hashing
 * all of 80 MB of images took seconds on every research update.
 */
export function imageToken(url: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i += 16) {
        h ^= url.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    for (let i = Math.max(0, url.length - 64); i < url.length; i++) {
        h ^= url.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `\u0000img:${url.length}:${(h >>> 0).toString(36)}`;
}

/** FNV-1a over every `step`-th character of `text` from `start`. */
export function fnvHash(text: string, start: number, step: number, seed: number): number {
    let h = seed >>> 0;
    for (let i = start; i < text.length; i += step) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

/**
 * Stands for one picture or file in the browser media fingerprint: its length
 * and a hash of a sample (every 64th character) and the tail. A new picture,
 * a new crop or a rotation changes the length or the sample; hashing every
 * byte of a tree's images on each edit would cost far more than the
 * indicator is worth.
 */
export function mediaToken(url: string | undefined): string {
    if (!url) return '';
    const sample = fnvHash(url, 0, 64, 0x811c9dc5);
    const tail = fnvHash(url, Math.max(0, url.length - 64), 1, sample);
    return `${url.length.toString(36)}.${tail.toString(36)}`;
}

// ---- computing an entry ----

/** The head of a data URL, up to and including its comma ('' when none). */
function headOf(url: string): string {
    const comma = url.indexOf(',');
    return comma < 0 ? '' : url.slice(0, comma + 1);
}

/** The media type a data URL head names (`image/jpeg`), '' when none. */
export function headMime(head: string): string {
    if (!head.startsWith('data:')) return '';
    const end = head.search(/[;,]/);
    return (end < 0 ? head.slice(5) : head.slice(5, end)).trim();
}

/**
 * The bytes of a base64 data URL, or null when it is not one — the same test
 * and decoding the research bridge's image hashing uses.
 */
function base64Bytes(url: string): Uint8Array | null {
    const comma = url.indexOf(',');
    if (!url.startsWith('data:') || comma < 0 || !url.slice(0, comma).endsWith(';base64')) return null;
    try {
        return base64ToBytes(url.slice(comma + 1));
    } catch {
        return null;
    }
}

function hex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The catalog entry of a data URL. `bytes`: its decoded bytes when the caller
 * has them already (they must be exactly what the base64 gives).
 */
export async function computeImageMeta(url: string, bytes?: Uint8Array | null): Promise<ImageMeta> {
    const head = headOf(url);
    const meta: ImageMeta = {
        len: url.length,
        head,
        bytes: dataUrlByteSize(url),
        token: imageToken(url),
        mtok: mediaToken(url),
    };
    const size = dataUrlImageSize(url);
    if (size) { meta.w = size.w; meta.h = size.h; }
    const raw = head.endsWith(';base64,') ? (bytes ?? base64Bytes(url)) : null;
    if (raw) meta.sha = hex(await sha256Bytes(raw));
    return meta;
}

/** A stored entry that has the shape of one (a record may come from anywhere). */
export function isImageMeta(v: unknown): v is ImageMeta {
    if (!v || typeof v !== 'object') return false;
    const m = v as Record<string, unknown>;
    const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    return num(m.len) && num(m.bytes) && typeof m.head === 'string' && typeof m.token === 'string'
        && typeof m.mtok === 'string'
        && (m.w === undefined || num(m.w)) && (m.h === undefined || num(m.h))
        && (m.sha === undefined || (typeof m.sha === 'string' && /^[0-9a-f]{64}$/.test(m.sha)));
}

// ---- the catalog in memory ----

/** Content id → entry, for every pooled image this window has seen. */
const catalog = new Map<string, ImageMeta>();

/** The id of a pool reference (`\u0000sm:p:…`) or the id itself. */
function idOf(idOrRef: string): string {
    return idOrRef.startsWith('\u0000sm:') ? idOrRef.slice(4) : idOrRef;
}

/** The entry of a pooled image by its id or its reference, if known. */
export function imageMetaOf(idOrRef: string): ImageMeta | undefined {
    return catalog.get(idOf(idOrRef));
}

/** Remember one entry. */
export function setImageMeta(id: string, meta: ImageMeta): void {
    catalog.set(id, meta);
}

/** Remember the entries of a stored record (ones without the right shape are left out). */
export function noteImageMeta(record: unknown): void {
    if (!record || typeof record !== 'object') return;
    for (const [id, meta] of Object.entries(record as Record<string, unknown>)) {
        if (isImageMeta(meta)) catalog.set(id, meta);
    }
}

/** The entries for `ids` that the catalog has (for writing a record). */
export function imageMetaFor(ids: Iterable<string>): ImageMetaRecord {
    const out: ImageMetaRecord = {};
    for (const id of ids) {
        const meta = catalog.get(id);
        if (meta) out[id] = meta;
    }
    return out;
}

/** Forget everything (tests). */
export function clearImageMeta(): void {
    catalog.clear();
}
