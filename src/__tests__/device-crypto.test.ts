import { describe, it, expect, vi, afterEach } from 'vitest';
import vectors from './fixtures/device-crypto.json';
import {
    b64url, fromB64url, deriveKey, pairProof, seal, open, sealRequest, openRequest, openResponse, responseBody,
    openPair, sealEvent, openEvent, eventsAuth, eventsMessage, eventAad, hmacB64, sealMediaBlock, openMediaBlock, mediaNonce, sealResponse,
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

describe('device crypto: the research vectors of the event stream (U9b)', () => {
    const v = vectors.events;

    it('signs the stream over t, n, the tree and the app', () => {
        expect(eventsMessage(v.t, v.n, v.tree, v.app)).toBe(v.message);
        expect(eventsMessage(v.t, v.n, v.tree)).toBe(v.messageWithoutApp);
        expect(eventsAuth(bytes(v.key), v.t, v.n, v.tree, v.app)).toBe(v.a);
        expect(eventsAuth(bytes(v.key), v.t, v.n, v.tree)).toBe(v.aWithoutApp);
    });

    it('opens each event by its order in the stream, as {event, data}', () => {
        for (const e of v.sealed) {
            expect(new TextDecoder().decode(eventAad(v.d, v.n, e.seq))).toBe(e.aad);
            expect(openEvent(bytes(v.key), v.d, v.n, e.seq, e.line.replace(/^data: /, ''))).toEqual(e.event);
            expect(openEvent(bytes(v.key), v.d, v.n, e.seq + 1, e.sealed)).toBeUndefined();
            expect(sealEvent(bytes(v.key), v.d, v.n, e.seq, e.event, bytes(e.sealed.n))).toEqual(e.sealed);
        }
    });
});

describe('device crypto: events and media blocks', () => {
    const key = deriveKey(new Uint8Array(32).fill(7), 'pairPýchavka');

    it('authorizes the event stream and opens its events, bound to the stream and their order', () => {
        expect(eventsAuth(key, 1764000000000, 'abc', 'pychavkovi')).toBe(hmacB64(key, 'events|1764000000000|abc|pychavkovi|'));
        expect(eventsAuth(key, 1764000000000, 'abc', 'pychavkovi', '3.33.0')).toBe(hmacB64(key, 'events|1764000000000|abc|pychavkovi|3.33.0'));
        const ev = { event: 'device', data: { type: 'device', what: 'unpaired' } };
        const sealed = sealEvent(key, 'dv_abcdefghijklmnop', 'streamNonce1', 0, ev);
        expect(openEvent(key, 'dv_abcdefghijklmnop', 'streamNonce1', 0, JSON.stringify(sealed))).toEqual(ev);
        expect(openEvent(key, 'dv_abcdefghijklmnop', 'streamNonce2', 0, sealed)).toBeUndefined();
        // moved or one left out: another order does not open
        expect(openEvent(key, 'dv_abcdefghijklmnop', 'streamNonce1', 1, sealed)).toBeUndefined();
        expect(openEvent(key, 'dv_abcdefghijklmnop', 'streamNonce1', 0, 'not json')).toBeUndefined();
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

/** The decoder as it was (a loop per character after a pattern test): what any text must still give. */
function referenceFromB64url(s: unknown, length?: number): Uint8Array | null {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let o = 0, acc = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
        acc = (acc << 6) | A.indexOf(s[i]);
        bits += 6;
        if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
    }
    if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null;
    if (length !== undefined && out.length !== length) return null;
    return out;
}

describe('device crypto: base64url of a big answer (a phone opening a research through the gateway)', () => {
    type U8 = { fromBase64?: unknown };
    const native = (Uint8Array as unknown as U8).fromBase64;
    afterEach(() => {
        vi.restoreAllMocks();
        (Uint8Array as unknown as U8).fromBase64 = native;
    });

    /** Texts of every kind: canonical, stray bits, whitespace, padding, the other alphabet, other characters. */
    function texts(): string[] {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const odd = [' ', '\n', '\t', '=', '+', '/', '.', 'é', '\u0000', '\u00a0', '€'];
        let seed = 7;
        const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
        const out: string[] = ['', 'Kg', 'Kh', 'KgA', 'KgB', 'AAAA', 'AA==', 'AAA=', 'A', 'ab+/', 'ab=', ' Kg', 'Kg ', 'K g', 'AAAA\nAAAA'];
        for (let i = 0; i < 4000; i++) {
            const n = rnd(14);
            let t = '';
            for (let k = 0; k < n; k++) t += rnd(9) === 0 ? odd[rnd(odd.length)] : chars[rnd(chars.length)];
            out.push(t);
        }
        return out;
    }

    function sameAsBefore(): void {
        for (const t of texts()) {
            expect(fromB64url(t), JSON.stringify(t)).toEqual(referenceFromB64url(t));
            expect(fromB64url(t, 2), JSON.stringify(t)).toEqual(referenceFromB64url(t, 2));
        }
        for (const v of [undefined, null, 3, {}, ['Kg']]) expect(fromB64url(v)).toBeNull();
    }

    it('gives exactly what it gave before, through the native decoder', () => {
        if (typeof native !== 'function') (Uint8Array as unknown as U8).fromBase64 = (b: string, o: { alphabet?: string }) => {
            if (o?.alphabet !== 'base64url') throw new Error('alphabet');
            const bin = atob(b.replace(/-/g, '+').replace(/_/g, '/'));
            return Uint8Array.from(bin, c => c.charCodeAt(0));
        };
        sameAsBefore();
    });

    it('gives exactly what it gave before through atob (a browser without fromBase64)', () => {
        (Uint8Array as unknown as U8).fromBase64 = undefined;
        sameAsBefore();
    });

    it('decodes a text in one native call: no loop per character, no pattern test over it', () => {
        const bytes = new Uint8Array(256 * 1024 + 2).map((_, i) => (i * 131 + 7) & 0xff);
        const text = b64url(bytes);
        const decode = vi.fn((b: string) => new Uint8Array(Buffer.from(b, 'base64url')));
        (Uint8Array as unknown as U8).fromBase64 = decode;
        const test = vi.spyOn(RegExp.prototype, 'test');
        const at = vi.spyOn(String.prototype, 'charCodeAt');
        expect(fromB64url(text)).toEqual(bytes);
        expect(decode).toHaveBeenCalledTimes(1);
        expect(test).not.toHaveBeenCalled();
        expect(at.mock.calls.length).toBeLessThan(10);
        at.mockRestore();
        // Without fromBase64: atob, its text translated once (its bytes then taken one by one, as base64ToBytes does).
        (Uint8Array as unknown as U8).fromBase64 = undefined;
        const atobSpy = vi.spyOn(globalThis, 'atob');
        expect(fromB64url(text)).toEqual(bytes);
        expect(atobSpy).toHaveBeenCalledTimes(1);
        expect(test).not.toHaveBeenCalled();
    });
});
