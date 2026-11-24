import { describe, it, expect } from 'vitest';
import vectors from './fixtures/device-crypto.json';
import {
    b64url, fromB64url, deriveKey, pairProof, seal, open, sealRequest, openRequest, openResponse, responseBody,
    openPair, sealEvent, openEvent, eventsAuth, hmacB64, sealMediaBlock, openMediaBlock, mediaNonce, sealResponse,
    DEVICE_PROTOCOL,
} from '../device/device-crypto';

const enc = new TextEncoder();
const bytes = (s: string): Uint8Array => {
    const b = fromB64url(s);
    if (!b) throw new Error(`not base64url: ${s}`);
    return b;
};

describe('device crypto: the research vectors (strom-device/1)', () => {
    it('base64url round-trips and refuses other spellings', () => {
        for (const n of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
            const b = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 0xff);
            expect(fromB64url(b64url(b))).toEqual(b);
        }
        expect(fromB64url('a')).toBeNull();
        expect(fromB64url('ab=')).toBeNull();
        expect(fromB64url('ab+/')).toBeNull();
        // stray bits in the last character
        expect(fromB64url('Kh')).toBeNull();
        expect(fromB64url('Kg')).toEqual(new Uint8Array([0x2a]));
        expect(fromB64url('Kg', 2)).toBeNull();
    });

    it('derives K by HKDF-SHA256', () => {
        expect(vectors.protocol).toBe(DEVICE_PROTOCOL);
        for (const v of vectors.hkdf) {
            expect(v.info).toBe(DEVICE_PROTOCOL);
            expect(b64url(deriveKey(bytes(v.secret), v.pairId))).toBe(v.key);
        }
    });

    it('proves K by HMAC-SHA256 of pair|pairId', () => {
        for (const v of vectors.proof) {
            expect(v.message).toBe(`pair|${v.pairId}`);
            expect(pairProof(bytes(v.key), v.pairId)).toBe(v.proof);
        }
    });

    it('seals and opens every AEAD vector', () => {
        expect(vectors.aead.length).toBe(8);
        for (const v of vectors.aead) {
            const key = bytes(v.key);
            const nonce = bytes(v.nonce);
            const aad = enc.encode(v.aad);
            expect(b64url(seal(key, nonce, aad, bytes(v.plain))), v.name).toBe(v.sealed);
            expect(open(key, nonce, aad, bytes(v.sealed)), v.name).toEqual(bytes(v.plain));
        }
    });

    it('refuses every negative vector without a throw', () => {
        expect(vectors.negative.length).toBe(4);
        for (const v of vectors.negative) {
            expect(open(bytes(v.key), bytes(v.nonce), enc.encode(v.aad), bytes(v.sealed)), v.name).toBeNull();
        }
        // a short or empty ciphertext, a wrong nonce length
        const k = new Uint8Array(32);
        expect(open(k, new Uint8Array(12), new Uint8Array(0), new Uint8Array(15))).toBeNull();
        expect(open(k, new Uint8Array(11), new Uint8Array(0), new Uint8Array(16))).toBeNull();
    });

    it('seals a tunnel request exactly as the gateway expects it', () => {
        const v = vectors.request;
        const key = bytes(v.key);
        const env = sealRequest(key, v.d, v.t, v.request, bytes(v.envelope.n));
        expect(env).toEqual(v.envelope);
        expect(new TextDecoder().decode(open(key, bytes(v.envelope.n), enc.encode(v.aad), bytes(v.envelope.c))!)).toBe(v.plain);
        expect(openRequest(key, env)).toEqual(v.request);
    });

    it('opens the answers, plain and gzipped, to the bytes of their body', async () => {
        for (const v of vectors.response) {
            const key = bytes(v.key);
            const r = openResponse(key, v.d, v.requestNonce, v.envelope);
            expect(r, v.name).not.toBeNull();
            expect(JSON.stringify(r)).toBe(v.plain);
            const body = await responseBody(r!);
            expect(body, v.name).toEqual(bytes(v.body));
            // another request's nonce, another device: not this answer
            expect(openResponse(key, v.d, 'AAAAAAAAAAAAAAAA', v.envelope)).toBeNull();
            expect(openResponse(key, 'dv_bbbbbbbbbbbbbbbb', v.requestNonce, v.envelope)).toBeNull();
        }
        expect(vectors.response.some(r => JSON.parse(r.plain).z === 'gzip')).toBe(true);
    });

    it('opens the answer to a pairing', () => {
        const v = vectors.pair;
        const a = openPair(bytes(v.key), v.pairId, v.envelope);
        expect(a).toEqual(v.answer);
        expect(openPair(bytes(v.key), 'another', v.envelope)).toBeNull();
    });
});

describe('device crypto: events and media blocks', () => {
    const key = deriveKey(new Uint8Array(32).fill(7), 'pairPýchavka');

    it('authorizes the event stream and opens its events, bound to the stream', () => {
        expect(eventsAuth(key, 1764000000000, 'abc')).toBe(hmacB64(key, 'events|1764000000000|abc'));
        const sealed = sealEvent(key, 'dv_abcdefghijklmnop', 'streamNonce1', { type: 'device', what: 'unpaired' });
        expect(openEvent(key, 'dv_abcdefghijklmnop', 'streamNonce1', JSON.stringify(sealed))).toEqual({ type: 'device', what: 'unpaired' });
        expect(openEvent(key, 'dv_abcdefghijklmnop', 'streamNonce2', sealed)).toBeUndefined();
        expect(openEvent(key, 'dv_abcdefghijklmnop', 'streamNonce1', 'not json')).toBeUndefined();
    });

    it('seals media blocks with the base nonce XOR their index and their place in the AAD', () => {
        const base = new Uint8Array(12).fill(0xf0);
        expect(mediaNonce(base, 0)).toEqual(base);
        const n1 = mediaNonce(base, 0x0102);
        expect(Array.from(n1.slice(0, 10))).toEqual(Array(10).fill(0xf0));
        expect(n1[10]).toBe(0xf0 ^ 0x01);
        expect(n1[11]).toBe(0xf0 ^ 0x02);
        const data = enc.encode('block of a photo');
        const sha = 'a'.repeat(64);
        const s = sealMediaBlock(key, 'dv_abcdefghijklmnop', 5, base, sha, 3, true, data);
        expect(s.length).toBe(data.length + 16);
        expect(openMediaBlock(key, 'dv_abcdefghijklmnop', 5, base, sha, 3, true, s)).toEqual(data);
        expect(openMediaBlock(key, 'dv_abcdefghijklmnop', 5, base, sha, 3, false, s)).toBeNull();
        expect(openMediaBlock(key, 'dv_abcdefghijklmnop', 5, base, sha, 2, true, s)).toBeNull();
    });

    it('round-trips an answer sealed by the fake gateway', async () => {
        const r = sealResponse(key, 'dv_abcdefghijklmnop', 'nonceA', { s: 200, h: { 'Content-Type': 'application/json' }, b: b64url(enc.encode('{"ok":true}')) });
        const opened = openResponse(key, 'dv_abcdefghijklmnop', 'nonceA', r);
        expect(new TextDecoder().decode((await responseBody(opened!))!)).toBe('{"ok":true}');
    });
});
