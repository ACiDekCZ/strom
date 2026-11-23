/**
 * Is it the same picture? Tree data holds an image as a data URL or as a
 * pooled image's reference (`\u0000sm:<id>`, media-pool.ts), and the two
 * forms of one picture are different strings — a dedup or a merge that
 * compares strings would take them for two pictures.
 *
 * - Two references: the same id is the same image. Ids of one kind (`p:`
 *   with `p:`, `e:` with `e:`) are hashes of the content: another id is
 *   another image. A `p:` and an `e:` id (one stored before encryption was
 *   switched on) are compared by the catalog: the same data URL head, length
 *   and bytes' hash.
 * - A data URL and a reference: the catalog tells most differences at once
 *   (length, the image token); a `p:` id is then the data URL's own hash, an
 *   `e:` id (peppered with the password's secret) is compared by the bytes'
 *   hash in the catalog.
 *
 * What cannot be told (a reference without its catalog entry) counts as
 * another picture: a dedup then keeps both, nothing is lost.
 */

import { poolIdOf, isImageValue } from './image-ref.js';
import { imageMetaOf, imageToken } from './image-meta.js';
import { sha256Bytes, createSha256 } from './sha256.js';
import { base64ToBytes } from './base64.js';

function hex(buf: ArrayBuffer, bytes: number): string {
    return Array.from(new Uint8Array(buf, 0, bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Synchronously, as far as the catalog tells: true or false when it is
 * certain, null when only a hash of the data URL would tell (sameImage).
 * Values that are no image compare as they are.
 */
export function sameImageNow(a: string | undefined, b: string | undefined): boolean | null {
    if (a === b) return true;
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const idA = poolIdOf(a);
    const idB = poolIdOf(b);
    if (idA && idB) {
        if (idA.slice(0, 2) === idB.slice(0, 2)) return false;
        const ma = imageMetaOf(idA);
        const mb = imageMetaOf(idB);
        if (!ma?.sha || !mb?.sha) return false;
        return ma.sha === mb.sha && ma.head === mb.head && ma.len === mb.len;
    }
    if (!idA && !idB) return false;
    const [id, url] = idA ? [idA, b] : [idB as string, a];
    if (!url.startsWith('data:')) return false;
    const meta = imageMetaOf(id);
    if (meta && (meta.len !== url.length || meta.token !== imageToken(url) || !url.startsWith(meta.head))) return false;
    if (id.startsWith('e:') && !meta?.sha) return false;
    return null;
}

/**
 * sameImageNow for a synchronous dedup, the catalog's word taken as enough:
 * a data URL whose length, head and image token match a reference's catalog
 * entry is that picture; a reference without its entry is another picture
 * (both are kept, nothing is lost).
 */
export function sameImageByCatalog(a: string | undefined, b: string | undefined): boolean {
    const now = sameImageNow(a, b);
    if (now !== null) return now;
    return !!imageMetaOf((poolIdOf(a) ? a : b) as string);
}

/** The same picture, also when one is a data URL and the other a pooled image's reference (see the file's comment). */
export async function sameImage(a: string | undefined, b: string | undefined): Promise<boolean> {
    const now = sameImageNow(a, b);
    if (now !== null) return now;
    // Only a data URL against a reference gets here.
    const idA = poolIdOf(a);
    const [id, url] = idA ? [idA, b as string] : [poolIdOf(b) as string, a as string];
    if (id.startsWith('p:')) {
        const digest = await sha256Bytes(new TextEncoder().encode(url));
        return 'p:' + hex(digest, 20) === id;
    }
    // An `e:` id with its catalog entry (sameImageNow checked length, head and token).
    const sha = imageMetaOf(id)?.sha;
    const comma = url.indexOf(',');
    if (!sha || !url.slice(0, comma).endsWith(';base64')) return false;
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(url.slice(comma + 1)); } catch { return false; }
    const digest = await sha256Bytes(bytes);
    return hex(digest, 32) === sha;
}

/**
 * sameImage, synchronously and exact, for code that compares as it goes (a
 * merge, a change packet, a research version against the tree): what the
 * catalog cannot tell is hashed here — a data URL's text against a `p:` id,
 * its bytes against an `e:` id's catalog hash. Only a data URL against a
 * reference whose catalog entry matches it gets that far (one hash), so a
 * comparison of two different pictures costs nothing.
 */
export function sameImageSync(a: string | undefined, b: string | undefined): boolean {
    const now = sameImageNow(a, b);
    if (now !== null) return now;
    const idA = poolIdOf(a);
    const [id, url] = idA ? [idA, b as string] : [poolIdOf(b) as string, a as string];
    const sha = createSha256();
    if (id.startsWith('p:')) {
        sha.update(new TextEncoder().encode(url));
        return 'p:' + sha.digestHex().slice(0, 40) === id;
    }
    const want = imageMetaOf(id)?.sha;
    const comma = url.indexOf(',');
    if (!want || !url.slice(0, comma).endsWith(';base64')) return false;
    try { sha.update(base64ToBytes(url.slice(comma + 1))); } catch { return false; }
    return sha.digestHex() === want;
}

/** What an image stands as in imageFreeJson (no tree text is a NUL and these letters). */
const IMAGE_MARK = '\u0000image';

/**
 * A value's JSON with each image (a data URL or a pooled image's reference,
 * isImageValue) put as one mark, and the images in their order. `sorted`:
 * object keys in sorted order (a comparison that ignores the keys' order).
 */
export function imageFreeJson(value: unknown, sorted = false): { json: string; images: string[] } {
    const images: string[] = [];
    if (!sorted) {
        const json = JSON.stringify(value, (_k, v: unknown) => {
            if (!isImageValue(v)) return v;
            images.push(v);
            return IMAGE_MARK;
        }) ?? 'undefined';
        return { json, images };
    }
    // As share-diff's stableStringify writes it, undefined values included.
    const walk = (v: unknown): string | undefined => {
        if (isImageValue(v)) { images.push(v); return JSON.stringify(IMAGE_MARK); }
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return `[${v.map(walk).join(',')}]`;
        const obj = v as Record<string, unknown>;
        return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${walk(obj[k])}`).join(',')}}`;
    };
    return { json: String(walk(value)), images };
}

/**
 * Two values the same as JSON (`sorted`: whatever their keys' order), an
 * image the same picture in either form (a tree's pooled reference and the
 * data URL a file or a packet brings of it).
 */
export function sameWithImages(a: unknown, b: unknown, sorted = false): boolean {
    if (a === b) return true;
    const x = imageFreeJson(a, sorted);
    const y = imageFreeJson(b, sorted);
    if (x.json !== y.json || x.images.length !== y.images.length) return false;
    return x.images.every((v, i) => sameImageSync(v, y.images[i]));
}

/** The length of an image's data URL: its own, or a reference's from the catalog (undefined: not known). */
function imageLength(value: string): number | undefined {
    const id = poolIdOf(value);
    if (id) return imageMetaOf(id)?.len;
    return value.startsWith('data:') ? value.length : undefined;
}

/**
 * Look up among many images the one that is the same picture as a given one
 * (a file of the tree for a file of the import): by the string itself, then
 * by sameImageSync among those whose data URL is as long. The first given
 * wins.
 */
export function imageFinder<T>(entries: Iterable<readonly [string | undefined, T]>): (value: string | undefined) => T | undefined {
    const exact = new Map<string, T>();
    const byLength = new Map<number, Array<readonly [string, T]>>();
    for (const [value, item] of entries) {
        if (!value) continue;
        if (!exact.has(value)) exact.set(value, item);
        const len = imageLength(value);
        if (len !== undefined) {
            const list = byLength.get(len);
            if (list) list.push([value, item]); else byLength.set(len, [[value, item]]);
        }
    }
    return (value) => {
        if (!value) return undefined;
        const hit = exact.get(value);
        if (hit !== undefined) return hit;
        const len = imageLength(value);
        const list = len === undefined ? undefined : byLength.get(len);
        return list?.find(([v]) => sameImageSync(v, value))?.[1];
    };
}
