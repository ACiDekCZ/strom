import { describe, it, expect } from 'vitest';
import vectors from './fixtures/device-crypto.json';
import { MEDIA_BLOCK, fromB64url, mediaAad, mediaNonce, openMediaBlock, sealMediaBlock, b64url, sha256Hex } from '../device/device-crypto';
import {
    MEDIA_META, mediaBlockCount, mediaBlockRange, mediaBodyLength, mediaMetaBlock, mediaMetaHeaders, sealMediaBody, sealMediaMeta,
    sealDataBlock, openMediaBody, type MediaSealJob,
} from '../device/media-blocks';

const V = vectors.media;
const vKey = fromB64url(V.key, 32)!;
const vBase = fromB64url(V.base, 12)!;
const dec = new TextDecoder();

/** The vectors' file: byte j = (j * 31 + 7) & 255. */
function vectorFile(): Uint8Array {
    return new Uint8Array(V.file.size).map((_, j) => (j * 31 + 7) & 0xff);
}

function vectorJob(from = 0): MediaSealJob {
    const meta = new Uint8Array(MEDIA_META).fill(0x20);
    meta.set(new TextEncoder().encode(V.meta.json));
    return { key: vKey, deviceId: V.d, t: V.t, nonce: vBase, sha: V.file.sha256, meta, size: V.file.size, from };
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

describe('PUT /device/media blocks by the research\'s vectors (U9c)', () => {
    it('the file, its blocks and the body\'s length', () => {
        const file = vectorFile();
        expect(sha256Hex(file)).toBe(V.file.sha256);
        expect(MEDIA_BLOCK).toBe(V.block);
        expect(mediaBlockCount(V.file.size)).toBe(V.blocks);
        expect(mediaBlockRange(V.file.size, 2)).toEqual([MEDIA_BLOCK, V.file.size]);
        expect(mediaBodyLength(V.file.size, 0)).toBe(V.bodyLength);
        expect(mediaBodyLength(V.file.size, V.blocks)).toBe(MEDIA_META + 16);
    });

    it('builds the meta block byte for byte: the allowlist only, padded with spaces to 4096', () => {
        const h = mediaMetaHeaders({
            'Content-Type': 'image/jpeg',
            'X-Strom-Name': encodeURIComponent('Matrika Lhota — křest, Лхота.jpg'),
            'X-Strom-Person': 'P0001',
            'X-Strom-App-Version': '3.33.0',
            Prefer: 'respond-async',
        });
        const meta = mediaMetaBlock(h)!;
        expect(meta.length).toBe(V.meta.plainLength);
        expect(dec.decode(meta).trimEnd()).toBe(V.meta.json);
        expect(meta.every((b, i) => i < V.meta.json.length || b === 0x20)).toBe(true);
        expect(dec.decode(mediaAad(V.d, V.t, V.file.sha256, 0, false))).toBe(V.meta.aad);
        expect(b64url(mediaNonce(vBase, 0))).toBe(V.meta.nonce);
        expect(b64url(sealMediaMeta({ ...vectorJob(), meta }))).toBe(V.meta.sealed);
    });

    it('seals each data block as the vectors: nonce, AAD, tag and the SHA-256 of the sealed block', () => {
        const file = vectorFile();
        const job = vectorJob();
        for (const b of V.data) {
            expect(b64url(mediaNonce(vBase, b.i))).toBe(b.nonce);
            expect(dec.decode(mediaAad(V.d, V.t, V.file.sha256, b.i, b.last))).toBe(b.aad);
            const [a, z] = mediaBlockRange(V.file.size, b.i);
            expect(z - a).toBe(b.plainLength);
            const sealed = sealDataBlock(job, b.i, file.subarray(a, z));
            expect(b64url(sealed.subarray(sealed.length - 16))).toBe(b.tag);
            expect(sha256Hex(sealed)).toBe(b.sealedSha256);
            if ('sealed' in b && b.sealed) expect(b64url(sealed)).toBe(b.sealed);
        }
        const body = concat(sealMediaBody(job, file));
        expect(body.length).toBe(V.bodyLength);
    });

    it('the vectors\' negative cases do not open: the last block with last 0, blocks swapped', () => {
        // Each opened as the gateway does (its AAD, its nonce): it does not open.
        for (const n of V.negative) {
            const sealed = fromB64url(n.sealed)!;
            const last = n.aad.endsWith('|1');
            expect(dec.decode(mediaAad(V.d, V.t, V.file.sha256, n.i, last))).toBe(n.aad);
            expect(b64url(mediaNonce(vBase, n.i))).toBe(n.nonce);
            expect(openMediaBlock(vKey, V.d, V.t, vBase, V.file.sha256, n.i, last, sealed)).toBeNull();
        }
        // The first is the last block sealed with last 0, byte for byte.
        const tail = vectorFile().subarray(MEDIA_BLOCK);
        expect(b64url(sealMediaBlock(vKey, V.d, V.t, vBase, V.file.sha256, 2, false, tail))).toBe(V.negative[0].sealed);
        const last = V.data[1];
        expect(openMediaBlock(vKey, V.d, V.t, vBase, V.file.sha256, 2, true, fromB64url(last.sealed!)!)).toEqual(vectorFile().subarray(MEDIA_BLOCK));
        // The whole body with its data blocks swapped stops at the first.
        const parts = sealMediaBody(vectorJob(), vectorFile());
        const swapped = openMediaBody(vKey, V.d, V.t, vBase, V.file.sha256, V.file.size, 0, concat([parts[0], parts[2], parts[1]]));
        expect(swapped).toMatchObject({ ok: false, meta: true, have: 0 });
    });

    it('opens a body again, also one sent from block From, and one with the meta block alone', () => {
        const file = vectorFile();
        const whole = openMediaBody(vKey, V.d, V.t, vBase, V.file.sha256, V.file.size, 0, concat(sealMediaBody(vectorJob(), file)));
        expect(whole.ok).toBe(true);
        if (!whole.ok) return;
        expect(whole.headers).toEqual({ 'X-Strom-Name': expect.stringContaining('Matrika'), 'X-Strom-Person': 'P0001', Prefer: 'respond-async' });
        expect(concat([...whole.blocks.values()])).toEqual(file);
        const rest = sealMediaBody(vectorJob(1), file);
        expect(rest.length).toBe(2);
        const fromOne = openMediaBody(vKey, V.d, V.t, vBase, V.file.sha256, V.file.size, 1, concat(rest));
        expect(fromOne.ok && [...fromOne.blocks.keys()]).toEqual([2]);
        const metaOnly = sealMediaBody(vectorJob(2), file);
        expect(metaOnly.length).toBe(1);
        expect(openMediaBody(vKey, V.d, V.t, vBase, V.file.sha256, V.file.size, 2, metaOnly[0])).toMatchObject({ ok: true, have: 2 });
        // A body that ends after block 1: fine, `have` 1 (the gateway answers how far it came).
        expect(openMediaBody(vKey, V.d, V.t, vBase, V.file.sha256, V.file.size, 0, concat(sealMediaBody(vectorJob(), file).slice(0, 2)))).toMatchObject({ ok: true, have: 1 });
        // A block cut short: stopped with the blocks whole before it.
        const cut = concat(sealMediaBody(vectorJob(), file));
        expect(openMediaBody(vKey, V.d, V.t, vBase, V.file.sha256, V.file.size, 0, cut.subarray(0, cut.length - 5))).toMatchObject({ ok: false, meta: true, have: 1 });
    });
});

describe('the meta block of a file', () => {
    it('keeps only the allowlist, each once, printable ASCII (Unicode percent-encoded)', () => {
        expect(mediaMetaHeaders({
            'Content-Type': 'image/jpeg', 'X-Strom-App-Version': '3.33.0', 'X-Strom-Read': '1', 'X-Strom-Batch': 'b-mlynky',
            'x-strom-path': 'Mlýnky/IMG_2036.jpg', 'X-Strom-Note': 'Křest v Mlýnkách', 'X-Strom-Zip': '1',
        })).toEqual({
            'X-Strom-Batch': 'b-mlynky', 'X-Strom-Path': 'Ml%C3%BDnky/IMG_2036.jpg', 'X-Strom-Note': 'K%C5%99est v Ml%C3%BDnk%C3%A1ch', 'X-Strom-Zip': '1',
        });
    });

    it('cuts a value over 2048 characters never inside a percent-encoded character, and the longest text until the JSON fits 4096', () => {
        const name = encodeURIComponent('ý'.repeat(1500));
        const h = mediaMetaHeaders({ 'X-Strom-Name': name, 'X-Strom-Path': name });
        expect(h['X-Strom-Name'].length).toBeLessThanOrEqual(2048);
        expect(() => decodeURIComponent(h['X-Strom-Name'])).not.toThrow();
        const meta = mediaMetaBlock(h)!;
        expect(meta.length).toBe(MEDIA_META);
        const parsed = JSON.parse(dec.decode(meta)) as { h: Record<string, string> };
        expect(() => decodeURIComponent(parsed.h['X-Strom-Path'] ?? '')).not.toThrow();
        expect(parsed.h['X-Strom-Name']).toBe(h['X-Strom-Name']);
    });

    it('a header outside the allowlist in a meta block is refused by its name (400 device.bad {header})', () => {
        const meta = new Uint8Array(MEDIA_META).fill(0x20);
        meta.set(new TextEncoder().encode('{"h":{"X-Strom-Name":"a.jpg","Content-Type":"image/jpeg"}}'));
        const job = { ...vectorJob(), meta };
        const body = concat(sealMediaBody(job, vectorFile()));
        expect(openMediaBody(vKey, V.d, V.t, vBase, V.file.sha256, V.file.size, 0, body)).toEqual({ ok: false, meta: true, header: 'Content-Type' });
    });
});
