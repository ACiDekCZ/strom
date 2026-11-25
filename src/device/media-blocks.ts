/**
 * A file sent by PUT /device/media/<sha256> (the research's interface §2.4,
 * as its U9c settled it): its body sealed block by block, so a large photo
 * never goes through the tunnel's JSON. The open headers say only the device,
 * its time and nonce base, the tree, the file's size (≥ 1) and `X-Strom-From`
 * (how many of its data blocks the gateway has already; 0 = from the start).
 * The body is
 *
 * - the meta block (index 0, `last` 0): the bridge's headers of the file as
 *   UTF-8 JSON `{"h": {...}}` padded with spaces to exactly 4096 bytes
 *   (sealed: 4112) — only the headers of the allowlist, printable ASCII of at
 *   most 2048 characters each (Unicode percent-encoded);
 * - the data blocks `i = From+1 … N`, `N = ceil(size / 1 MiB)`: 1 MiB of the
 *   file each, the last the rest, block N sealed with `last` = 1. A request
 *   with From = N carries the meta block alone ("you have it all, deliver").
 *
 * Each block is ChaCha20-Poly1305 with the nonce base XOR its index and the
 * AAD strom-device/1|<d>|<t>|media|<sha>|<i>|<last 0/1> (device-crypto.ts).
 * No DOM here: the blob worker of the build seals with the same code, and the
 * fake gateway of the tests opens with it.
 */

import { MEDIA_BLOCK, sealMediaBlock, openMediaBlock } from './device-crypto';

/** The meta block's plain length (the JSON padded with spaces). */
export const MEDIA_META = 4096;
/** The tag each sealed block carries. */
export const MEDIA_TAG = 16;
/** The longest value of a header of the meta block. */
export const MEDIA_HEADER_MAX = 2048;
/**
 * The data blocks one request carries at most (8 MiB, the research's U9d): the
 * gateway reads an answer's leftover body up to 8 MiB on the same connection,
 * so its early answer always reaches the browser, and a cut connection costs
 * one batch at most. A file over that goes in several requests, each From = k
 * with blocks k+1…min(k+8, N); the gateway answers one short of block N with
 * 200 {sha, have, size}.
 */
export const MEDIA_BATCH_BLOCKS = 8;

/** The bridge's headers of a file a device may send in the meta block (U9c), as the bridge spells them. */
export const MEDIA_META_HEADERS: readonly string[] = [
    'X-Strom-Name', 'X-Strom-Note', 'X-Strom-Person', 'X-Strom-Family', 'X-Strom-Source', 'X-Strom-Region', 'X-Strom-Batch',
    'X-Strom-Path', 'X-Strom-Zip', 'X-Strom-Task', 'X-Strom-Image', 'X-Strom-Replace', 'X-Strom-List-Ref', 'Prefer',
];
const ALLOWED = new Map(MEDIA_META_HEADERS.map(h => [h.toLowerCase(), h]));
/** Values cut first when the meta block would be over 4096 bytes: free text the file does not depend on. */
const CUTTABLE = ['X-Strom-Path', 'X-Strom-Note', 'X-Strom-Name'];

/** What the blocks of one request are sealed with. */
export interface MediaSealJob {
    key: Uint8Array;
    deviceId: string;
    /** The request's time (the gateway's clock), in `X-Strom-Time`. */
    t: number;
    /** The nonce base (12 bytes), in `X-Strom-Nonce`. */
    nonce: Uint8Array;
    /** The file's SHA-256 (hex), in the path. */
    sha: string;
    /** The meta block's plain bytes (4096). */
    meta: Uint8Array;
    /** The file's size (≥ 1), in `X-Strom-Size`. */
    size: number;
    /** The data blocks the gateway has already (`X-Strom-From`): blocks from+1…to are sealed. */
    from: number;
    /** The last data block of this request (none: N, the file's last). */
    to?: number;
}

/** N: the file's data blocks. */
export function mediaBlockCount(size: number): number {
    return Math.ceil(Math.max(0, size) / MEDIA_BLOCK);
}

/** The plain range [from, to) of data block `i` (1…N). */
export function mediaBlockRange(size: number, i: number): [number, number] {
    return [(i - 1) * MEDIA_BLOCK, Math.min(size, i * MEDIA_BLOCK)];
}

/** The last data block a request of `job` carries: its `to`, never past N. */
export function mediaJobEnd(job: Pick<MediaSealJob, 'size' | 'to'>): number {
    const n = mediaBlockCount(job.size);
    return job.to === undefined ? n : Math.max(0, Math.min(n, job.to));
}

/** The last data block of a batch sent from block `from`: at most MEDIA_BATCH_BLOCKS of them, never past N. */
export function mediaBatchEnd(size: number, from: number): number {
    return Math.min(mediaBlockCount(size), from + MEDIA_BATCH_BLOCKS);
}

/** The body's length for a file of `size` sent from block `from` (to block `to`, none: N): the sealed meta block and its blocks. */
export function mediaBodyLength(size: number, from: number, to?: number): number {
    const n = mediaJobEnd({ size, to });
    let len = MEDIA_META + MEDIA_TAG;
    for (let i = from + 1; i <= n; i++) {
        const [a, b] = mediaBlockRange(size, i);
        len += b - a + MEDIA_TAG;
    }
    return len;
}

/** A value as printable ASCII: anything else percent-encoded (as the bridge reads it). */
function printable(v: string): string {
    return v.replace(/[^ -~]/gu, c => {
        try { return encodeURIComponent(c); } catch { return ''; }
    });
}

function decodes(s: string): boolean {
    try { decodeURIComponent(s); return true; } catch { return false; }
}

/** A value cut to `max` characters, never inside a percent-encoded character. */
function cutValue(v: string, max: number): string {
    if (v.length <= max) return v;
    let out = v.slice(0, Math.max(0, max));
    if (!decodes(v)) return out.replace(/%[0-9A-Fa-f]?$/u, '');
    while (out && !decodes(out)) out = out.slice(0, Math.max(0, out.lastIndexOf('%')));
    return out;
}

/**
 * The meta block's headers from the bridge's headers of a file: only those of
 * the allowlist (Content-Type, the app's version and anything else stay out),
 * each once, printable ASCII of at most 2048 characters.
 */
export function mediaMetaHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, raw] of Object.entries(headers)) {
        const name = ALLOWED.get(k.toLowerCase());
        if (!name || name in out || raw === undefined || raw === null) continue;
        out[name] = cutValue(printable(String(raw)), MEDIA_HEADER_MAX);
    }
    return out;
}

const enc = new TextEncoder();

/**
 * The meta block's plain bytes: `{"h": {...}}` padded with spaces to exactly
 * 4096 bytes. Over that, the longest of the free texts (path, note, name) is
 * cut until it fits; null only when nothing is left to cut.
 */
export function mediaMetaBlock(headers: Record<string, string>): Uint8Array | null {
    const h = { ...headers };
    for (let guard = 0; guard < 64; guard++) {
        const json = enc.encode(JSON.stringify({ h }));
        if (json.length <= MEDIA_META) {
            const out = new Uint8Array(MEDIA_META).fill(0x20);
            out.set(json);
            return out;
        }
        const over = json.length - MEDIA_META;
        const key = CUTTABLE.filter(k => h[k]).sort((a, b) => h[b].length - h[a].length)[0];
        if (!key) return null;
        h[key] = cutValue(h[key], h[key].length - over);
        if (!h[key]) delete h[key];
    }
    return null;
}

/** The meta block sealed (index 0, `last` 0). */
export function sealMediaMeta(job: MediaSealJob): Uint8Array {
    return sealMediaBlock(job.key, job.deviceId, job.t, job.nonce, job.sha, 0, false, job.meta);
}

/** Data block `i` (1…N) sealed; block N with `last` = 1. */
export function sealDataBlock(job: MediaSealJob, i: number, bytes: Uint8Array): Uint8Array {
    return sealMediaBlock(job.key, job.deviceId, job.t, job.nonce, job.sha, i, i === mediaBlockCount(job.size), bytes);
}

/** The body of a request of a file in memory: the meta block, then its blocks from+1…to (none: N). */
export function sealMediaBody(job: MediaSealJob, file: Uint8Array): Uint8Array[] {
    const parts = [sealMediaMeta(job)];
    for (let i = job.from + 1; i <= mediaJobEnd(job); i++) {
        const [a, b] = mediaBlockRange(job.size, i);
        parts.push(sealDataBlock(job, i, file.subarray(a, b)));
    }
    return parts;
}

/** What a body opened again says (the fake gateway of the tests, as the research reads it). */
export type OpenedMediaBody =
    | { ok: true; headers: Record<string, string>; blocks: Map<number, Uint8Array>; have: number }
    /** The meta block does not open (refused open, 400 device.bad). */
    | { ok: false; meta: false }
    /** The meta block is not `{"h": {...}}`, or a header (`header`) is not one of the allowlist, twice, or not printable. */
    | { ok: false; meta: true; header?: string }
    /** A data block cut, not opening or past the last: `have` the blocks whole before it. */
    | { ok: false; meta: true; headers: Record<string, string>; blocks: Map<number, Uint8Array>; have: number };

/**
 * A body opened again: the meta block (4112 B), then data blocks from+1…N by
 * their lengths from the size. A body that ends before block N is fine (`have`
 * says how far it came); a block cut, one that does not open (moved, sealed
 * for another file or request, `last` wrong) or anything past block N stops
 * it with the blocks whole before it.
 */
export function openMediaBody(key: Uint8Array, deviceId: string, t: number, nonce: Uint8Array, sha: string, size: number, from: number, body: Uint8Array): OpenedMediaBody {
    const metaPlain = body.length >= MEDIA_META + MEDIA_TAG ? openMediaBlock(key, deviceId, t, nonce, sha, 0, false, body.subarray(0, MEDIA_META + MEDIA_TAG)) : null;
    if (!metaPlain) return { ok: false, meta: false };
    let h: unknown;
    try { h = (JSON.parse(new TextDecoder().decode(metaPlain)) as { h?: unknown }).h; } catch { h = undefined; }
    if (!h || typeof h !== 'object' || Array.isArray(h)) return { ok: false, meta: true };
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
        const name = ALLOWED.get(k.toLowerCase());
        if (!name || name in headers || typeof v !== 'string' || v.length > MEDIA_HEADER_MAX || !/^[ -~]*$/u.test(v)) return { ok: false, meta: true, header: k.slice(0, 60) };
        headers[name] = v;
    }
    const n = mediaBlockCount(size);
    const blocks = new Map<number, Uint8Array>();
    let at = MEDIA_META + MEDIA_TAG;
    let have = from;
    for (let i = from + 1; i <= n && at < body.length; i++) {
        const [a, b] = mediaBlockRange(size, i);
        const end = at + (b - a) + MEDIA_TAG;
        const plain = end <= body.length ? openMediaBlock(key, deviceId, t, nonce, sha, i, i === n, body.subarray(at, end)) : null;
        if (!plain) return { ok: false, meta: true, headers, blocks, have };
        blocks.set(i, plain);
        have = i;
        at = end;
    }
    if (at < body.length) return { ok: false, meta: true, headers, blocks, have };
    return { ok: true, headers, blocks, have };
}
