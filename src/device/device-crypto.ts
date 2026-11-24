/**
 * The cipher of a device of the home network (strom-device/1): the app opened
 * from the research's gateway on another device (a phone, a tablet, a second
 * computer) seals what it asks and opens what it is told.
 *
 * - K = HKDF-SHA256(ikm = the pairing secret (32 bytes), salt = the pairId's
 *   UTF-8, info = "strom-device/1", 32 bytes);
 * - the proof of K: HMAC-SHA256(K, "pair|" + pairId), base64url;
 * - each envelope: ChaCha20-Poly1305 (RFC 8439), a nonce of 12 bytes, the
 *   ciphertext with its 16-byte tag after it, base64url without padding.
 *
 * The gateway speaks plain http in the home network, which is not a secure
 * context: `crypto.subtle` is not there, so the cipher is @noble (pure JS) and
 * the randomness `crypto.getRandomValues` (present without a secure context).
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const DEVICE_PROTOCOL = 'strom-device/1';

const encoder = new TextEncoder();
const utf8 = (s: string): Uint8Array => encoder.encode(s);
const fromUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: false }).decode(b);

// ——— base64url ———

const B64URL = /^[A-Za-z0-9_-]*$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = (() => {
    const t = new Int16Array(128).fill(-1);
    for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
    return t;
})();

/** Bytes as base64url without padding. */
export function b64url(bytes: Uint8Array): string {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
    }
    const rest = bytes.length - i;
    if (rest === 1) {
        const n = bytes[i] << 16;
        out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63];
    } else if (rest === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
    }
    return out;
}

/**
 * The bytes of a base64url text (no padding, the one spelling of its bytes);
 * null for anything else, or when `length` is given and they are not that many.
 */
export function fromB64url(s: unknown, length?: number): Uint8Array | null {
    if (typeof s !== 'string' || !B64URL.test(s) || s.length % 4 === 1) return null;
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let o = 0;
    let acc = 0;
    let bits = 0;
    for (let i = 0; i < s.length; i++) {
        acc = (acc << 6) | LOOKUP[s.charCodeAt(i)];
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[o++] = (acc >> bits) & 0xff;
        }
    }
    // stray bits in the last character: not the one spelling of these bytes
    if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null;
    if (length !== undefined && out.length !== length) return null;
    return out;
}

// ——— randomness ———

/** `n` random bytes from `crypto.getRandomValues` (never `crypto.subtle`). */
export function randomBytes(n: number): Uint8Array {
    const c = (globalThis as { crypto?: { getRandomValues?: <T extends ArrayBufferView>(a: T) => T } }).crypto;
    if (!c?.getRandomValues) throw new Error('crypto.getRandomValues is missing');
    return c.getRandomValues(new Uint8Array(n));
}

/** A nonce of 12 random bytes. */
export function newNonce(): Uint8Array {
    return randomBytes(12);
}

// ——— keys ———

/** K = HKDF-SHA256(ikm = secret, salt = UTF-8 pairId, info = "strom-device/1", 32 bytes). */
export function deriveKey(secret: Uint8Array, pairId: string): Uint8Array {
    return hkdf(sha256, secret, utf8(pairId), utf8(DEVICE_PROTOCOL), 32);
}

/** HMAC-SHA256(K, message) as base64url. */
export function hmacB64(key: Uint8Array, message: string): string {
    return b64url(hmac(sha256, key, utf8(message)));
}

/** The device's proof that it holds K: HMAC-SHA256(K, "pair|" + pairId), base64url. */
export function pairProof(key: Uint8Array, pairId: string): string {
    return hmacB64(key, `pair|${pairId}`);
}

/** The `a` of GET /device/events: HMAC-SHA256(K, "events|" + t + "|" + n), base64url. */
export function eventsAuth(key: Uint8Array, t: number, n: string): string {
    return hmacB64(key, `events|${t}|${n}`);
}

/** SHA-256 of bytes as lowercase hex (the name of a media file, §2.4). */
export function sha256Hex(bytes: Uint8Array): string {
    return Array.from(sha256(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

// ——— the cipher ———

/** ChaCha20-Poly1305: the ciphertext with its 16-byte tag after it. */
export function seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plain: Uint8Array): Uint8Array {
    return chacha20poly1305(key, nonce, aad).encrypt(plain);
}

/** What `seal` sealed, or null when anything of it does not hold (key, nonce, AAD, a byte) — never a throw. */
export function open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Uint8Array | null {
    if (key.length !== 32 || nonce.length !== 12 || sealed.length < 16) return null;
    try {
        return chacha20poly1305(key, nonce, aad).decrypt(sealed);
    } catch {
        return null;
    }
}

/** AAD of a request: strom-device/1|<d>|<t>|req. */
export function requestAad(deviceId: string, t: number): Uint8Array {
    return utf8(`${DEVICE_PROTOCOL}|${deviceId}|${t}|req`);
}

/** AAD of an answer: strom-device/1|<d>|<the request's nonce>|res. */
export function responseAad(deviceId: string, requestNonce: string): Uint8Array {
    return utf8(`${DEVICE_PROTOCOL}|${deviceId}|${requestNonce}|res`);
}

/** AAD of the answer to a pairing: strom-device/1|<pairId>|pair. */
export function pairAad(pairId: string): Uint8Array {
    return utf8(`${DEVICE_PROTOCOL}|${pairId}|pair`);
}

/**
 * AAD of an event of GET /device/events: strom-device/1|<d>|<the stream's n>|event
 * (bound to the stream it was asked by, like an answer to its request).
 */
export function eventAad(deviceId: string, streamNonce: string): Uint8Array {
    return utf8(`${DEVICE_PROTOCOL}|${deviceId}|${streamNonce}|event`);
}

/** AAD of a block of PUT /device/media/<sha>: strom-device/1|<d>|<t>|media|<sha>|<i>|<last 0/1>. */
export function mediaAad(deviceId: string, t: number, sha: string, index: number, last: boolean): Uint8Array {
    return utf8(`${DEVICE_PROTOCOL}|${deviceId}|${t}|media|${sha}|${index}|${last ? 1 : 0}`);
}

// ——— envelopes ———

/** The envelope of a request (POST /device/x). */
export interface RequestEnvelope {
    v: 1;
    d: string;
    t: number;
    n: string;
    c: string;
}

/** The envelope of an answer (to a request, to a pairing) and of an event. */
export interface SealedEnvelope {
    v?: 1;
    n: string;
    c: string;
}

/** What a request asks inside: the bridge's method and path (no token), the tree's id, its query, headers and body. */
export interface DeviceRequest {
    m: string;
    p: string;
    tree: string;
    q?: Record<string, string>;
    h?: Record<string, string>;
    /** A JSON body. */
    b?: unknown;
    /** A binary body, base64url (b or b64, never both). */
    b64?: string;
}

/** What an answer says inside: the status, the headers, the body's bytes (base64url, null for none), gzipped or not. */
export interface DeviceResponse {
    s: number;
    h: Record<string, string>;
    b: string | null;
    z?: 'gzip';
}

/** What the answer to a pairing says. */
export interface PairAnswer {
    device: { id: string; name: string; kind: string };
    computer: { name: string; label?: string };
    trees: unknown[];
}

function parseJson(b: Uint8Array | null): unknown {
    if (!b) return undefined;
    try {
        return JSON.parse(fromUtf8(b));
    } catch {
        return undefined;
    }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function stringRecord(v: unknown): Record<string, string> | undefined {
    const r = asRecord(v);
    if (!r) return undefined;
    for (const x of Object.values(r)) if (typeof x !== 'string') return undefined;
    return r as Record<string, string>;
}

/** The bytes an envelope `{n, c}` opens to with this AAD; null when it does not hold. */
function openEnvelope(key: Uint8Array, aad: Uint8Array, envelope: unknown, needV: boolean): Uint8Array | null {
    const e = asRecord(envelope);
    if (!e || (needV && e.v !== 1)) return null;
    const nonce = fromB64url(e.n, 12);
    const c = fromB64url(e.c);
    if (!nonce || !c) return null;
    return open(key, nonce, aad, c);
}

/** A request sealed for the gateway. `t`: the device's time in ms (evened out by the gateway's clock). */
export function sealRequest(key: Uint8Array, deviceId: string, t: number, request: DeviceRequest, nonce: Uint8Array = newNonce()): RequestEnvelope {
    return { v: 1, d: deviceId, t, n: b64url(nonce), c: b64url(seal(key, nonce, requestAad(deviceId, t), utf8(JSON.stringify(request)))) };
}

/** A request opened (the fake gateway of the tests plays the gateway with it); null when it does not hold. */
export function openRequest(key: Uint8Array, envelope: RequestEnvelope): DeviceRequest | null {
    const nonce = fromB64url(envelope.n, 12);
    const c = fromB64url(envelope.c);
    if (!nonce || !c) return null;
    const r = asRecord(parseJson(open(key, nonce, requestAad(envelope.d, envelope.t), c)));
    if (!r || typeof r.m !== 'string' || typeof r.p !== 'string' || typeof r.tree !== 'string') return null;
    return r as unknown as DeviceRequest;
}

/** An answer sealed for a device (the fake gateway of the tests). */
export function sealResponse(key: Uint8Array, deviceId: string, requestNonce: string, response: DeviceResponse, nonce: Uint8Array = newNonce()): SealedEnvelope & { v: 1 } {
    return { v: 1, n: b64url(nonce), c: b64url(seal(key, nonce, responseAad(deviceId, requestNonce), utf8(JSON.stringify(response)))) };
}

/** The answer to this request opened; null when it is another request's, changed, or not an answer. */
export function openResponse(key: Uint8Array, deviceId: string, requestNonce: string, envelope: unknown): DeviceResponse | null {
    const r = asRecord(parseJson(openEnvelope(key, responseAad(deviceId, requestNonce), envelope, true)));
    if (!r || typeof r.s !== 'number' || (r.b !== null && typeof r.b !== 'string') || (r.z !== undefined && r.z !== 'gzip')) return null;
    const h = stringRecord(r.h);
    if (!h) return null;
    return { s: r.s, h, b: r.b as string | null, ...(r.z === 'gzip' ? { z: 'gzip' as const } : {}) };
}

/** The answer to a pairing sealed with the new K (the fake gateway of the tests). */
export function sealPair(key: Uint8Array, pairId: string, answer: PairAnswer, nonce: Uint8Array = newNonce()): SealedEnvelope & { v: 1 } {
    return { v: 1, n: b64url(nonce), c: b64url(seal(key, nonce, pairAad(pairId), utf8(JSON.stringify(answer)))) };
}

/** The answer to a pairing opened with the new K; null when it does not hold. */
export function openPair(key: Uint8Array, pairId: string, envelope: unknown): PairAnswer | null {
    const a = asRecord(parseJson(openEnvelope(key, pairAad(pairId), envelope, true)));
    const device = asRecord(a?.device);
    const computer = asRecord(a?.computer);
    if (!a || !device || typeof device.id !== 'string' || !computer || typeof computer.name !== 'string' || !Array.isArray(a.trees)) return null;
    return a as unknown as PairAnswer;
}

/** An event sealed for a device's stream (the fake gateway of the tests). */
export function sealEvent(key: Uint8Array, deviceId: string, streamNonce: string, event: unknown, nonce: Uint8Array = newNonce()): SealedEnvelope {
    return { n: b64url(nonce), c: b64url(seal(key, nonce, eventAad(deviceId, streamNonce), utf8(JSON.stringify(event)))) };
}

/** The `data` of an event of the stream opened (text or parsed); undefined when it does not hold. */
export function openEvent(key: Uint8Array, deviceId: string, streamNonce: string, data: unknown): unknown {
    let e = data;
    if (typeof e === 'string') {
        try { e = JSON.parse(e); } catch { return undefined; }
    }
    return parseJson(openEnvelope(key, eventAad(deviceId, streamNonce), e, false));
}

// ——— the body of an answer ———

/** Gzipped bytes unpacked by `DecompressionStream`; null when they do not unpack or the browser has none. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
        const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}

/** Whether this browser can unpack a gzipped answer (else the app asks `Accept-Encoding: identity`). */
export function canGunzip(): boolean {
    return typeof DecompressionStream !== 'undefined';
}

/** The body of an answer as bytes (gunzipped when it was gzipped); null for none, undefined when it does not unpack. */
export async function responseBody(response: DeviceResponse): Promise<Uint8Array | null | undefined> {
    if (response.b === null) return null;
    const b = fromB64url(response.b);
    if (!b) return undefined;
    if (response.z !== 'gzip') return b;
    return (await gunzip(b)) ?? undefined;
}

// ——— large files (PUT /device/media/<sha256>, §2.4) ———

/** The size of a block of a media file before sealing. */
export const MEDIA_BLOCK = 1024 * 1024;

/**
 * The nonce of block `index`: the base nonce XOR the index as a 64-bit
 * big-endian number in its last 8 bytes (as TLS 1.3 does with its sequence).
 */
export function mediaNonce(baseNonce: Uint8Array, index: number): Uint8Array {
    const out = new Uint8Array(baseNonce);
    let n = index;
    for (let i = 11; i >= 4 && n > 0; i--) {
        out[i] ^= n & 0xff;
        n = Math.floor(n / 256);
    }
    return out;
}

/** One block of a media file sealed: its ciphertext and its 16-byte tag. */
export function sealMediaBlock(key: Uint8Array, deviceId: string, t: number, baseNonce: Uint8Array, sha: string, index: number, last: boolean, bytes: Uint8Array): Uint8Array {
    return seal(key, mediaNonce(baseNonce, index), mediaAad(deviceId, t, sha, index, last), bytes);
}

/** One block opened (the fake gateway of the tests); null when it does not hold. */
export function openMediaBlock(key: Uint8Array, deviceId: string, t: number, baseNonce: Uint8Array, sha: string, index: number, last: boolean, sealed: Uint8Array): Uint8Array | null {
    return open(key, mediaNonce(baseNonce, index), mediaAad(deviceId, t, sha, index, last), sealed);
}
