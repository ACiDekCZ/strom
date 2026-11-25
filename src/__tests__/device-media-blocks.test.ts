import { describe, it, expect } from 'vitest';
import { MEDIA_BLOCK, openMediaBlock } from '../device/device-crypto';
import { mediaBlockRanges, sealMediaBody, openMediaBody, type MediaSealJob } from '../device/media-blocks';

const key = new Uint8Array(32).map((_, i) => i + 1);
const nonce = new Uint8Array(12).map((_, i) => 200 - i);
const SHA = 'ab'.repeat(32);

function job(meta = '{"h":{"X-Strom-Name":"IMG_2036.jpg"}}'): MediaSealJob {
    return { key, deviceId: 'dev-1', t: 1_764_000_000_000, nonce, sha: SHA, meta: new TextEncoder().encode(meta) };
}

function bytes(n: number): Uint8Array {
    return new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

function roundTrip(size: number) {
    const file = bytes(size);
    const j = job();
    const parts = sealMediaBody(j, file);
    const opened = openMediaBody(key, j.deviceId, j.t, nonce, SHA, parts[0].length, concat(parts));
    return { file, parts, opened };
}

describe('media blocks of PUT /device/media', () => {
    it('splits a file into blocks of 1 MiB, the last shorter, a file of 0 B one empty block', () => {
        expect(mediaBlockRanges(0)).toEqual([[0, 0]]);
        expect(mediaBlockRanges(MEDIA_BLOCK)).toEqual([[0, MEDIA_BLOCK]]);
        expect(mediaBlockRanges(MEDIA_BLOCK + 1)).toEqual([[0, MEDIA_BLOCK], [MEDIA_BLOCK, MEDIA_BLOCK + 1]]);
        expect(mediaBlockRanges(5)).toEqual([[0, 5]]);
    });

    it('a file of 0 B: the meta block and one empty sealed block, opened again', () => {
        const { parts, opened } = roundTrip(0);
        expect(parts.map(p => p.length)).toEqual([parts[0].length, 16]);
        expect(opened?.file.length).toBe(0);
        expect(new TextDecoder().decode(opened!.meta)).toContain('IMG_2036.jpg');
    });

    it('exactly 1 MiB is one block, sealed as the last', () => {
        const { file, parts, opened } = roundTrip(MEDIA_BLOCK);
        expect(parts.length).toBe(2);
        expect(parts[1].length).toBe(MEDIA_BLOCK + 16);
        expect(openMediaBlock(key, 'dev-1', job().t, nonce, SHA, 1, true, parts[1])).toEqual(file);
        expect(openMediaBlock(key, 'dev-1', job().t, nonce, SHA, 1, false, parts[1])).toBeNull();
        expect(opened?.file).toEqual(file);
    });

    it('1 MiB + 1: two blocks, only the second the last; the body assembles back', () => {
        const { file, parts, opened } = roundTrip(MEDIA_BLOCK + 1);
        expect(parts.slice(1).map(p => p.length)).toEqual([MEDIA_BLOCK + 16, 17]);
        expect(openMediaBlock(key, 'dev-1', job().t, nonce, SHA, 1, false, parts[1])).not.toBeNull();
        expect(openMediaBlock(key, 'dev-1', job().t, nonce, SHA, 2, true, parts[2])).not.toBeNull();
        expect(opened?.file).toEqual(file);
    });

    it('a body cut, reordered or sealed for another file does not open', () => {
        const j = job();
        const parts = sealMediaBody(j, bytes(MEDIA_BLOCK * 2 + 10));
        const meta = parts[0].length;
        // The last block left out: the one before it was not sealed as the last.
        expect(openMediaBody(key, j.deviceId, j.t, nonce, SHA, meta, concat(parts.slice(0, 3)))).toBeNull();
        expect(openMediaBody(key, j.deviceId, j.t, nonce, SHA, meta, concat([parts[0], parts[2], parts[1], parts[3]]))).toBeNull();
        expect(openMediaBody(key, j.deviceId, j.t, nonce, 'cd'.repeat(32), meta, concat(parts))).toBeNull();
        expect(openMediaBody(key, j.deviceId, j.t, nonce, SHA, meta + 1, concat(parts))).toBeNull();
    });
});
