/**
 * A file sent by PUT /device/media/<sha256> (the research's interface §2.4):
 * its body sealed block by block, so a large photo never goes through the
 * tunnel's JSON. The body is
 *
 * - the meta block (index 0, never the last): the bridge's headers of the
 *   file as JSON `{h: {...}}` (its name, path, batch, person: what is not
 *   said in an open header), its sealed length in `X-Strom-Meta`;
 * - the file's blocks (index 1…k): 1 MiB of it each, the last shorter, a
 *   file of 0 B one empty block; the last one sealed with `last` = 1.
 *
 * Each block is ChaCha20-Poly1305 with the nonce base XOR its index and the
 * AAD strom-device/1|<d>|<t>|media|<sha>|<i>|<last 0/1> (device-crypto.ts).
 * No DOM here: the blob worker of the build seals with the same code.
 */

import { MEDIA_BLOCK, sealMediaBlock, openMediaBlock } from './device-crypto';

/** What the blocks of one file are sealed with. */
export interface MediaSealJob {
    key: Uint8Array;
    deviceId: string;
    /** The request's time (the gateway's clock), in `X-Strom-Time`. */
    t: number;
    /** The nonce base (12 bytes), in `X-Strom-Nonce`. */
    nonce: Uint8Array;
    /** The file's SHA-256 (hex), in the path. */
    sha: string;
    /** The meta block's plain bytes (JSON). */
    meta: Uint8Array;
}

/** The plain ranges [from, to) of a file's blocks: 1 MiB each, the last shorter; a file of 0 B is one empty block. */
export function mediaBlockRanges(size: number): [number, number][] {
    const n = Math.max(0, Math.floor(size));
    if (n === 0) return [[0, 0]];
    const out: [number, number][] = [];
    for (let at = 0; at < n; at += MEDIA_BLOCK) out.push([at, Math.min(n, at + MEDIA_BLOCK)]);
    return out;
}

/** The meta block sealed (index 0, never the last). */
export function sealMediaMeta(job: MediaSealJob): Uint8Array {
    return sealMediaBlock(job.key, job.deviceId, job.t, job.nonce, job.sha, 0, false, job.meta);
}

/** The file's block `i` (from 0) sealed: index i + 1 in its AAD and nonce. */
export function sealFileBlock(job: MediaSealJob, i: number, last: boolean, bytes: Uint8Array): Uint8Array {
    return sealMediaBlock(job.key, job.deviceId, job.t, job.nonce, job.sha, i + 1, last, bytes);
}

/** The whole body of bytes in memory: the meta block, then the file's blocks. */
export function sealMediaBody(job: MediaSealJob, file: Uint8Array): Uint8Array[] {
    const ranges = mediaBlockRanges(file.length);
    return [sealMediaMeta(job), ...ranges.map(([a, b], i) => sealFileBlock(job, i, i === ranges.length - 1, file.subarray(a, b)))];
}

/**
 * A body opened again (the fake gateway of the tests, as the research does):
 * the meta block by its sealed length, then blocks of 1 MiB + 16 until the
 * end, the last one opened as the last. Null when anything does not hold
 * (a block moved, cut, left out or sealed for another file).
 */
export function openMediaBody(key: Uint8Array, deviceId: string, t: number, nonce: Uint8Array, sha: string, metaLength: number, body: Uint8Array): { meta: Uint8Array; file: Uint8Array } | null {
    if (!Number.isSafeInteger(metaLength) || metaLength < 16 || metaLength > body.length - 16) return null;
    const meta = openMediaBlock(key, deviceId, t, nonce, sha, 0, false, body.subarray(0, metaLength));
    if (!meta) return null;
    const sealedBlock = MEDIA_BLOCK + 16;
    const parts: Uint8Array[] = [];
    let size = 0;
    for (let at = metaLength, i = 1; at < body.length; at += sealedBlock, i++) {
        const end = Math.min(body.length, at + sealedBlock);
        const last = end === body.length;
        const plain = openMediaBlock(key, deviceId, t, nonce, sha, i, last, body.subarray(at, end));
        if (!plain) return null;
        parts.push(plain);
        size += plain.length;
    }
    if (parts.length === 0) return null;
    const file = new Uint8Array(size);
    let off = 0;
    for (const p of parts) { file.set(p, off); off += p.length; }
    return { meta, file };
}
