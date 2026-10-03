/**
 * Originals for Strom Research (step C of the research sync) — the pure half.
 *
 * A file the user adds to a tree linked to a research keeps its preview in the
 * tree (attachments.ts / excerpts.ts shrink it as before), and the file as it
 * was goes to the research: `PUT /media/<sha256>` on its bridge, with the
 * person (REFN P…), the source (REFN S…) and the crop's region. While the
 * bridge does not run, or the person / source has no research number yet, the
 * file waits in the browser (IndexedDB store `originals`, see originals-ui.ts)
 * within a budget. Nothing of this is in the tree data except the original's
 * identity (Attachment.original, SourceExcerpt.originalSha).
 */

import { StromData, PersonId, TreeId } from './types.js';
import { researchPersonRef } from './research-link.js';
import { normalizeSha256 } from './sha256.js';

/** The queue never holds more than this… */
export const ORIGINALS_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** …nor more than this share of what the browser grants the site. */
export const ORIGINALS_QUOTA_SHARE = 0.3;
/** A file larger than this is not taken when the research does not say its limit. */
export const DEFAULT_MEDIA_MAX_BYTES = 500 * 1024 * 1024;

/** A crop's frame in fractions of the image (0–1 from the top left). */
export interface Region { x: number; y: number; w: number; h: number }

/** One original waiting to go to the research (IndexedDB `originals`, key `queueKey`). */
export interface QueuedOriginal {
    sha256: string;
    treeId: TreeId;
    /** The research the tree was linked to when the file was added. */
    researchId: string;
    name: string;
    mimeType: string;
    bytes: number;
    blob: Blob;
    /** The person it belongs to (app id; its REFN is looked up when sending). */
    personId?: PersonId;
    /** The source it belongs to (app id; its REFN is looked up when sending). */
    sourceId?: string;
    /** Where the crop lies on this file, in its stored pixels (regionToStored). */
    region?: Region;
    /** EXIF orientation of the file (1 = as stored). */
    orientation: number;
    note?: string;
    /** When it was added (ms). */
    addedAt: number;
    /** Failed sends so far. */
    attempts: number;
}

export function queueKey(treeId: string, sha256: string): string {
    return `${treeId}:${sha256}`;
}

/** How many bytes the queue may hold: min(2 GB, 30 % of the quota); 2 GB when the browser does not say. */
export function originalsBudget(quota: number | undefined): number {
    if (!quota || !Number.isFinite(quota) || quota <= 0) return ORIGINALS_MAX_BYTES;
    return Math.min(ORIGINALS_MAX_BYTES, Math.floor(quota * ORIGINALS_QUOTA_SHARE));
}

/** Does a file of `bytes` still fit next to what waits already? */
export function fitsBudget(queuedBytes: number, bytes: number, quota: number | undefined): boolean {
    return queuedBytes + bytes <= originalsBudget(quota);
}

/** A source's number in the research ("S0042"), or null. */
export function researchSourceRef(refn: unknown): string | null {
    return typeof refn === 'string' && /^S\d{1,7}$/.test(refn.trim()) ? refn.trim() : null;
}

function u16(b: Uint8Array, i: number, le: boolean): number {
    return le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1];
}
function u32(b: Uint8Array, i: number, le: boolean): number {
    return le
        ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
        : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

/** The Orientation tag (0x0112) of a TIFF structure starting at `start`, or 1. */
function tiffOrientation(b: Uint8Array, start: number): number {
    if (start + 8 > b.length) return 1;
    const le = b[start] === 0x49 && b[start + 1] === 0x49;
    if (!le && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return 1;
    if (u16(b, start + 2, le) !== 42) return 1;
    const ifd = start + u32(b, start + 4, le);
    if (ifd + 2 > b.length) return 1;
    const count = u16(b, ifd, le);
    for (let n = 0; n < count; n++) {
        const e = ifd + 2 + n * 12;
        if (e + 12 > b.length) return 1;
        if (u16(b, e, le) === 0x0112) {
            const v = u16(b, e + 8, le);
            return v >= 1 && v <= 8 ? v : 1;
        }
    }
    return 1;
}

/**
 * EXIF orientation (1–8) from the head of a JPEG or TIFF file; 1 for other
 * formats or when it cannot be found. 256 kB of the head is plenty.
 */
export function exifOrientation(head: Uint8Array): number {
    const b = head;
    if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) {
        return tiffOrientation(b, 0);
    }
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
    let i = 2;
    while (i + 4 <= b.length) {
        if (b[i] !== 0xff) return 1;
        const marker = b[i + 1];
        if (marker === 0xd9 || marker === 0xda) return 1;   // end of image / scan data: no EXIF before it
        const len = (b[i + 2] << 8) | b[i + 3];
        if (marker === 0xe1 && i + 10 <= b.length
            && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0 && b[i + 9] === 0) {
            return tiffOrientation(b, i + 10);
        }
        i += 2 + len;
    }
    return 1;
}

/**
 * A point of the image as shown (EXIF orientation applied — what the app's
 * preview and crop editor work with) in the file's stored pixel grid, both in
 * fractions. `orientation` is the file's EXIF value.
 */
function pointToStored(o: number, u: number, v: number): [number, number] {
    switch (o) {
        case 2: return [1 - u, v];
        case 3: return [1 - u, 1 - v];
        case 4: return [u, 1 - v];
        case 5: return [v, u];
        case 6: return [v, 1 - u];
        case 7: return [1 - v, 1 - u];
        case 8: return [1 - v, u];
        default: return [u, v];
    }
}

function pointFromStored(o: number, s: number, t: number): [number, number] {
    switch (o) {
        case 2: return [1 - s, t];
        case 3: return [1 - s, 1 - t];
        case 4: return [s, 1 - t];
        case 5: return [t, s];
        case 6: return [1 - t, s];
        case 7: return [1 - t, 1 - s];
        case 8: return [t, 1 - s];
        default: return [s, t];
    }
}

function mapRegion(r: Region, map: (a: number, b: number) => [number, number]): Region {
    const a = map(r.x, r.y);
    const b = map(r.x + r.w, r.y + r.h);
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
    return { x, y, w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

/**
 * A crop's region as the user drew it (on the image shown upright) in the
 * original file's stored pixels. Strom Research reads files as stored — it
 * does not apply EXIF orientation — so this is what it can cut by.
 */
export function regionToStored(r: Region, orientation: number | undefined): Region {
    return mapRegion(r, (u, v) => pointToStored(orientation ?? 1, u, v));
}

/** The inverse of regionToStored. */
export function regionFromStored(r: Region, orientation: number | undefined): Region {
    return mapRegion(r, (s, t) => pointFromStored(orientation ?? 1, s, t));
}

/** A region as the bridge header and `_STROM_REGION` carry it: "x,y,w,h" in fractions, 4 decimals. */
export function regionHeader(r: Region): string {
    const f = (v: number): string => String(Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000);
    return [r.x, r.y, r.w, r.h].map(f).join(',');
}

/** Parse "x,y,w,h" (the header and `_STROM_REGION` form) back; null when it is not four fractions with a size. */
export function parseRegion(text: unknown): Region | null {
    if (typeof text !== 'string') return null;
    const parts = text.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some(v => !Number.isFinite(v) || v < 0 || v > 1)) return null;
    const [x, y, w, h] = parts;
    if (w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) return null;
    return { x, y, w, h };
}

/**
 * Whom an original goes to, from the tree as it is now:
 * - `ready`: every target has its research number;
 * - `gone`: the person or source it was added to is no longer in the tree
 *   (nothing to send it with — the caller drops it).
 */
export interface OriginalTargets {
    ready: boolean;
    gone: boolean;
    person?: string;
    source?: string;
}

export function originalTargets(rec: Pick<QueuedOriginal, 'personId' | 'sourceId'>, data: StromData): OriginalTargets {
    const out: OriginalTargets = { ready: true, gone: false };
    if (rec.personId) {
        const person = data.persons[rec.personId];
        if (!person) return { ready: false, gone: true };
        const ref = researchPersonRef(person.refn);
        if (ref) out.person = ref;
        else out.ready = false;
    }
    if (rec.sourceId) {
        const source = data.sources?.[rec.sourceId];
        if (!source) {
            // A source dropped from a person's attachment: the person still takes the file.
            if (!rec.personId) return { ready: false, gone: true };
        } else {
            const ref = researchSourceRef(source.refn);
            if (ref) out.source = ref;
            else out.ready = false;
        }
    }
    return out;
}

/**
 * The headers of `PUT /media/<sha256>` (values percent-encoded where text).
 * Only the ones the research's CORS allows: Name, Person, Source, Region, Note.
 * `targets.region: false` — the research does not take a region.
 */
export function uploadHeaders(rec: Pick<QueuedOriginal, 'mimeType' | 'name' | 'region' | 'note'>,
    targets: Pick<OriginalTargets, 'person' | 'source'> & { region?: boolean }): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': rec.mimeType || 'application/octet-stream',
        'X-Strom-Name': encodeURIComponent(rec.name || 'file'),
    };
    if (targets.person) headers['X-Strom-Person'] = targets.person;
    if (targets.source) headers['X-Strom-Source'] = targets.source;
    // In the file's stored pixels (regionToStored): the research cuts files as stored.
    if (rec.region && targets.region !== false) headers['X-Strom-Region'] = regionHeader(rec.region);
    if (rec.note) headers['X-Strom-Note'] = encodeURIComponent(rec.note.slice(0, 500));
    return headers;
}

/** What the bridge said about a file: the research's id for it ("I0042" / "M0123"), or null. */
export function mediaReplyId(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const r = value as Record<string, unknown>;
    for (const key of ['known', 'input', 'media']) {
        const v = r[key];
        if (typeof v === 'string' && /^[IM]\d{1,7}$/.test(v.trim())) return v.trim();
    }
    return null;
}

/** The original's identity as stored on an attachment, or null for a malformed one (data from foreign files). */
export function attachmentOriginalSha(att: { original?: { sha256?: unknown } }): string | null {
    return normalizeSha256(att.original?.sha256);
}
