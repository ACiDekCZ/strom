/**
 * Faster first save of a tree with photos and faster reading of a file with
 * photos in it — with the same result as before, byte for byte.
 *
 * 1. Storing an image as bytes: whether its base64 is canonical used to be a
 *    pattern test over the whole text (over a second on 150 MB of photos);
 *    now the decoders' own checks plus a length check decide
 *    (canonicalBase64Bytes). Same decision as the old test on every input.
 * 2. New images go to the pool in a few transactions, not one each.
 * 3. Images from the research bridge: canonical base64 is kept as it came
 *    (not written anew), and the bytes checked against the hash are reused
 *    when the tree is stored.
 * 4. decodeGedcomBytes: "any byte outside ASCII" four bytes at a time, and a
 *    valid UTF-8 file decoded once (the strict pass's text), not twice.
 *
 * Each part: the old way, kept here, against the new on the same inputs
 * (including invalid UTF-8 and broken base64), and a time budget judged
 * against a calibration run (helpers/perf-budget.ts). All data is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const media = new Map<string, unknown>();
const together: { key: string }[][] = [];
let failTogether = false;
vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(_store: string, key: string): Promise<T | null> { return (media.get(key) as T) ?? null; },
        set(_store: string, key: string, value: unknown): Promise<void> { media.set(key, value); return Promise.resolve(); },
        setTogether(writes: { store: string; key: string; value: unknown }[]): Promise<void> {
            if (failTogether) return Promise.reject(new Error('QuotaExceededError'));
            together.push(writes.map(w => ({ key: w.key })));
            for (const w of writes) media.set(w.key, structuredClone(w.value));
            return Promise.resolve();
        },
        async delete(_store: string, key: string): Promise<void> { media.delete(key); },
        async keys(): Promise<string[]> { return [...media.keys()]; },
        async getAll<T>(): Promise<T[]> { return [...media.values()] as T[]; },
        async getMany<T>(_store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, (media.get(k) as T) ?? null]));
        },
        async flush(): Promise<void> {},
    },
}));

import { base64ToBytes, bytesToBase64, canonicalBase64Bytes } from '../base64.js';
import { storeImages, forgetPoolScope, unpoolObject, POOL_REF } from '../media-pool.js';
import { rememberImageBytes, rememberedImageCount, forgetImageBytes, KNOWN_BYTES_MAX } from '../known-image-bytes.js';
import { fetchImagesByHash, sha256Hex, type ImageFetchDeps, type ImageRef } from '../research-image-refs.js';
import { decodeGedcomBytes, hasNonAscii } from '../ged-parser.js';
import { clearImageMeta, computeImageMeta } from '../image-meta.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

// ---- invented inputs (seeded, repeatable) ----

function rng(seed: number): () => number {
    let x = (seed * 2654435761) >>> 0 || 1;
    return () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x / 0x100000000; };
}

function randomBytes(n: number, seed: number): Uint8Array {
    const r = rng(seed);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.floor(r() * 256);
    return out;
}

/** Canonical base64 and a mutation of it (whitespace, foreign letters, padding, stray bits, cut, …). */
function base64Cases(count: number): string[] {
    const r = rng(7);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const foreign = [' ', '\n', '\r', '\t', '\f', '-', '_', '=', '*', '.', 'é', '😀', '\u0000', ' ', '中'];
    const out: string[] = ['', '=', '==', '====', 'A', 'AA', 'AAA', 'AAAA', 'AAA=', 'AA==', 'A===', 'AB==', 'ABC=', 'AAB=', 'AAAB'];
    for (let i = 0; i < count; i++) {
        const b64 = bytesToBase64(randomBytes(Math.floor(r() * 40), i + 1));
        out.push(b64);
        if (!b64) continue;
        const at = Math.floor(r() * (b64.length + 1));
        switch (i % 8) {
            case 0: out.push(b64.slice(0, at) + pick(foreign) + b64.slice(at)); break;
            case 1: out.push(b64.slice(0, at) + pick(foreign) + b64.slice(at + 1)); break;
            case 2: out.push(b64.replace(/=+$/, '')); break;
            case 3: { // stray bits: the last letter before the padding one step up
                const m = /([A-Za-z0-9+/])(=+)$/.exec(b64);
                if (m) {
                    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
                    const k = alpha.indexOf(m[1]);
                    out.push(b64.slice(0, m.index) + alpha[(k + 1) % 64] + m[2]);
                } else out.push(b64 + '=');
                break;
            }
            case 4: out.push(b64.slice(0, b64.length - 4) + pick(foreign) + b64.slice(b64.length - 3)); break;
            case 5: out.push(b64.slice(0, at) + '\n' + b64.slice(at, b64.length - 1)); break;
            case 6: out.push(b64 + pick(['=', '==', 'A=', '\n', ' '])); break;
            default: out.push(b64.slice(1)); break;
        }
    }
    return out;
}

// ---- the old ways, as they were ----

/** encodeMedia's old decision: pattern test, decode, last group gives back the text. */
function oldCanonical(b64: string): Uint8Array | null {
    if (b64.length > 0 && b64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
        try {
            const bytes = base64ToBytes(b64);
            const lastGroup = (b64.length / 4 - 1) * 3;
            if (bytesToBase64(bytes.subarray(lastGroup)) === b64.slice(-4)) return bytes;
        } catch { /* not base64 */ }
    }
    return null;
}

/** The old fetchImagesByHash data URL: decode leniently, write anew. */
function oldBridgeDataUrl(mime: string, data: string): string | null {
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(data); } catch { return null; }
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** decodeGedcomBytes' old pieces: a callback per byte, and a strict decode thrown away before decoding again. */
const oldNonAscii = (bytes: Uint8Array): boolean => bytes.some(b => b >= 0x80);
function oldIsValidUtf8(bytes: Uint8Array): boolean {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}

type NativeHost = { fromBase64?: unknown };
type NativeProto = { toBase64?: unknown };

/** Run `fn` with and without the browser's native base64 (CI's Node 20 has none). */
function bothBase64Paths(fn: () => void): void {
    fn();
    const host = Uint8Array as unknown as NativeHost;
    const proto = Uint8Array.prototype as unknown as NativeProto;
    const from = Object.getOwnPropertyDescriptor(host, 'fromBase64');
    const to = Object.getOwnPropertyDescriptor(proto, 'toBase64');
    if (!from && !to) return;
    try {
        Object.defineProperty(host, 'fromBase64', { value: undefined, configurable: true, writable: true });
        Object.defineProperty(proto, 'toBase64', { value: undefined, configurable: true, writable: true });
        fn();
    } finally {
        if (from) Object.defineProperty(host, 'fromBase64', from); else delete host.fromBase64;
        if (to) Object.defineProperty(proto, 'toBase64', to); else delete proto.toBase64;
    }
}

beforeEach(() => {
    media.clear();
    together.length = 0;
    failTogether = false;
    forgetImageBytes();
    forgetPoolScope('t');
});
afterEach(() => forgetImageBytes());

// ==================== 1. canonical base64 without the pattern test ====================

describe('canonical base64 (encodeMedia)', () => {
    it('decides exactly like the old pattern test, with and without native base64', () => {
        const cases = base64Cases(3000);
        bothBase64Paths(() => {
            let canonical = 0;
            for (const b64 of cases) {
                const before = oldCanonical(b64);
                const now = canonicalBase64Bytes(b64);
                expect(now === null, JSON.stringify(b64)).toBe(before === null);
                if (before && now) {
                    canonical++;
                    expect([...now]).toEqual([...before]);
                    expect(bytesToBase64(now)).toBe(b64);
                }
            }
            // Both kinds are there in numbers.
            expect(canonical).toBeGreaterThan(1000);
            expect(cases.length - canonical).toBeGreaterThan(1000);
        });
    });

    it('stores the same records under the same ids as before', async () => {
        const urls = [
            'data:image/jpeg;base64,' + bytesToBase64(randomBytes(3000, 1)),
            'data:image/png;base64,' + bytesToBase64(randomBytes(2001, 2)),
            // Not canonical: whitespace, URL-safe letters, stray bits, cut, not base64 at all.
            'data:image/jpeg;base64,' + bytesToBase64(randomBytes(1500, 3)).replace(/(.{76})/g, '$1\n'),
            'data:image/jpeg;base64,' + bytesToBase64(randomBytes(1500, 4)).replace(/\+/g, '-').replace(/\//g, '_'),
            'data:image/jpeg;base64,' + bytesToBase64(randomBytes(1501, 5)).replace(/.==$/, 'B=='),
            'data:image/jpeg;base64,' + bytesToBase64(randomBytes(1500, 6)).slice(0, -1),
            'data:text/plain,' + 'x'.repeat(1500),
            'data:application/pdf;base64,' + bytesToBase64(randomBytes(1600, 7)),
        ];
        const { ids, media: sizes } = await storeImages(new Set(urls), false, 't');
        for (const url of urls) {
            const id = ids.get(url)!;
            // Content ids: SHA-256 of the data URL text, as ever.
            expect(id).toBe('p:' + (await sha256Hex(new TextEncoder().encode(url))).slice(0, 40));
            const record = media.get(id) as { head?: string; bytes?: ArrayBuffer; text?: string };
            const comma = url.indexOf(',');
            const old = url.slice(0, comma + 1).endsWith(';base64,') ? oldCanonical(url.slice(comma + 1)) : null;
            if (old) {
                expect(record.head).toBe(url.slice(0, comma + 1));
                expect([...new Uint8Array(record.bytes!)]).toEqual([...old]);
                expect(sizes[id]).toBe(old.byteLength);
            } else {
                expect(record).toEqual({ text: url });
                expect(sizes[id]).toBe(url.length);
            }
        }
        // And every one reads back as it was.
        const back = await unpoolObject(urls.map(u => POOL_REF + ids.get(u)!));
        expect(back.missing).toBe(0);
        expect(back.data).toEqual(urls);
    });

    it('stays within its time budget on 24 MB of photos', () => {
        const texts = Array.from({ length: 240 }, (_, i) => bytesToBase64(randomBytes(75_000, 100 + i)));
        const run = (): number => {
            let n = 0;
            for (const t of texts) n += canonicalBase64Bytes(t)!.byteLength;
            return n;
        };
        expect(run()).toBe(240 * 75_000);
        // About 3 ms with native base64 and 21 ms without it (Node 20) on the
        // reference machine; the old pattern test took 88 ms (105 ms on Node 20).
        const BUDGET_MS = 50;
        const m = measureAgainstBudget(run, {
            budgetMs: BUDGET_MS, calibrationRounds: 2, referenceMs: 11, minPairs: 3, maxPairs: 8,
        });
        console.log(budgetReport('canonicalBase64Bytes 24 MB', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 60_000);
});

// ==================== 2. a few transactions, not one per image ====================

describe('storing new images (storeImages)', () => {
    const image = (i: number, n = 3000): string => 'data:image/jpeg;base64,' + bytesToBase64(randomBytes(n, 1000 + i));

    it('writes 600 new images in 3 transactions and nothing one by one', async () => {
        const urls = new Set(Array.from({ length: 600 }, (_, i) => image(i)));
        const { media: sizes } = await storeImages(urls, false, 't');
        expect(Object.keys(sizes)).toHaveLength(600);
        expect(together.map(t => t.length)).toEqual([256, 256, 88]);
        expect(media.size).toBe(600);
    });

    it('starts a new transaction after 16 MB', async () => {
        // 1.2 MB each: 13 fill the first transaction past 16 MB.
        const urls = new Set(Array.from({ length: 20 }, (_, i) => image(i, 1_200_000)));
        await storeImages(urls, false, 't');
        expect(together.map(t => t.length)).toEqual([14, 6]);
    });

    it('writes only what the pool lacks, once each, and a failed write fails the store', async () => {
        const urls = Array.from({ length: 5 }, (_, i) => image(i));
        await storeImages(new Set(urls.slice(0, 3)), false, 't');
        together.length = 0;
        await storeImages(new Set(urls), false, 't');
        expect(together).toHaveLength(1);
        expect(together[0]).toHaveLength(2);

        failTogether = true;
        await expect(storeImages(new Set([...urls, image(9)]), false, 't')).rejects.toThrow(/Quota/);
    });
});

// ==================== 3. the bridge's bytes reused ====================

describe('images from the research bridge', () => {
    const URL_IMAGES = 'http://127.0.0.1:5994/abc/images';

    function bridge(store: Map<string, string>): ImageFetchDeps {
        return {
            fetch: async (_url, init) => {
                const shas = (JSON.parse(String(init.body)) as { images: string[] }).images;
                const images = shas.map(sha => ({ sha, mime: 'image/jpeg', data: store.get(sha)! }));
                return new Response(JSON.stringify({ images, missing: [], more: [] }), { status: 200 });
            },
            sha256Hex,
            sleep: async () => {},
        };
    }

    async function fixture(): Promise<{ refs: ImageRef[]; store: Map<string, string>; bytes: Map<string, Uint8Array> }> {
        const store = new Map<string, string>();
        const bytes = new Map<string, Uint8Array>();
        const refs: ImageRef[] = [];
        for (let i = 0; i < 12; i++) {
            const b = randomBytes(2000 + i * 7, 500 + i);
            const sha = await sha256Hex(b);
            let data = bytesToBase64(b);
            // Some bridges wrap lines or leave off the padding: still the same picture.
            if (i % 4 === 1) data = data.replace(/(.{76})/g, '$1\n');
            if (i % 4 === 2) data = data.replace(/=+$/, '');
            store.set(sha, data);
            bytes.set(sha, b);
            refs.push({ sha, mime: 'image/jpeg' });
        }
        return { refs, store, bytes };
    }

    it('gives the same data URLs as before, canonical base64 kept as it came', async () => {
        const { refs, store } = await fixture();
        const got = await fetchImagesByHash(URL_IMAGES, refs, bridge(store));
        expect(got.size).toBe(refs.length);
        for (const ref of refs) expect(got.get(ref.sha)).toBe(oldBridgeDataUrl('image/jpeg', store.get(ref.sha)!));
    });

    it('stores the tree from the bytes it checked: same records, nothing left behind', async () => {
        const { refs, store, bytes } = await fixture();
        const got = await fetchImagesByHash(URL_IMAGES, refs, bridge(store));
        expect(rememberedImageCount()).toBe(refs.length);
        const urls = new Set(got.values());
        const { ids } = await storeImages(urls, false, 't');
        expect(rememberedImageCount()).toBe(0);
        for (const ref of refs) {
            const url = got.get(ref.sha)!;
            const record = media.get(ids.get(url)!) as { head: string; bytes: ArrayBuffer };
            expect(record.head).toBe('data:image/jpeg;base64,');
            expect(record.bytes.byteLength).toBe(bytes.get(ref.sha)!.byteLength);
            expect([...new Uint8Array(record.bytes)]).toEqual([...bytes.get(ref.sha)!]);
        }
    });

    it('takes the remembered bytes instead of decoding the text', async () => {
        const real = randomBytes(3000, 77);
        const url = 'data:image/jpeg;base64,' + bytesToBase64(real);
        // A stand-in of the same length shows which bytes were stored.
        const stand = new Uint8Array(real.length).fill(7);
        rememberImageBytes(url, stand);
        const { ids } = await storeImages(new Set([url]), false, 't');
        expect([...new Uint8Array((media.get(ids.get(url)!) as { bytes: ArrayBuffer }).bytes)].every(b => b === 7)).toBe(true);
    });

    it('keeps an own buffer for a view, keeps nothing past the bound, and forgets after a minute', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-19T10:30:00Z'));
        try {
            rememberImageBytes('data:image/jpeg;base64,AAAA', new Uint8Array(3));
            expect(rememberedImageCount()).toBe(1);
            // Past the bound: not kept (the store decodes it, as before).
            rememberImageBytes('data:image/jpeg;base64,BBBB', { byteLength: KNOWN_BYTES_MAX } as unknown as Uint8Array);
            expect(rememberedImageCount()).toBe(1);
            vi.advanceTimersByTime(59_000);
            expect(rememberedImageCount()).toBe(1);
            vi.advanceTimersByTime(2_000);
            expect(rememberedImageCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stores a remembered view as exactly its bytes', async () => {
        const big = randomBytes(5000, 9);
        const view = big.subarray(1000, 4000);
        const url = 'data:image/jpeg;base64,' + bytesToBase64(view);
        rememberImageBytes(url, view);
        const { ids } = await storeImages(new Set([url]), false, 't');
        const stored = (media.get(ids.get(url)!) as { bytes: ArrayBuffer }).bytes;
        expect(stored.byteLength).toBe(3000);
        expect([...new Uint8Array(stored)]).toEqual([...view]);
    });
    it('hashes each image once: its catalog entry takes the hash it was checked against', async () => {
        clearImageMeta();
        const real = randomBytes(3000, 4242);
        const url = 'data:image/jpeg;base64,' + bytesToBase64(real);
        // A stand-in hash shows which one the entry took.
        const stand = 'ab'.repeat(32);
        rememberImageBytes(url, real, stand);
        const { meta, ids } = await storeImages(new Set([url]), false, 't');
        expect(meta[ids.get(url)!].sha).toBe(stand);
    });

    it('a tree from the bridge stored: one hash per image (its content id), the same entries as before', async () => {
        clearImageMeta();
        const { refs, bytes } = await fixture();
        // Images of their own (the catalog of this window keeps the entries of the tests before).
        const own = new Map<string, string>();
        const ownRefs: ImageRef[] = [];
        for (const [i, ref] of refs.entries()) {
            const b = randomBytes(2100 + i * 5, 9100 + i);
            const sha = await sha256Hex(b);
            own.set(sha, bytesToBase64(b));
            bytes.set(sha, b);
            ownRefs.push({ ...ref, sha });
        }
        const got = await fetchImagesByHash(URL_IMAGES, ownRefs, bridge(own));
        const digest = vi.spyOn(crypto.subtle, 'digest');
        const { meta, ids } = await storeImages(new Set(got.values()), false, 't');
        // The content ids hash the data URLs; the catalog's hash is the one checked, not taken again.
        expect(digest).toHaveBeenCalledTimes(ownRefs.length);
        digest.mockRestore();
        for (const ref of ownRefs) {
            const url = got.get(ref.sha)!;
            const entry = meta[ids.get(url)!];
            // The same entry as computed from the text alone.
            expect(entry).toEqual(await computeImageMeta(url));
            expect(entry.sha).toBe(ref.sha);
        }
    });
});

// ==================== 4. decoding a GEDCOM file ====================

describe('decodeGedcomBytes', () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
    const ged = (char: string | null, body: string): string =>
        `0 HEAD\n1 SOUR Test\n${char ? `1 CHAR ${char}\n` : ''}0 @I1@ INDI\n1 NAME ${body}\n0 TRLR\n`;

    it('"any byte outside ASCII" agrees with the old test at every position and offset', () => {
        const backing = new Uint8Array(48);
        for (let offset = 0; offset < 4; offset++) {
            for (let len = 0; len <= 40; len++) {
                const view = backing.subarray(offset, offset + len);
                view.fill(0x41);
                expect(hasNonAscii(view)).toBe(false);
                for (let k = 0; k < len; k++) {
                    for (const b of [0x80, 0xC3, 0xFF]) {
                        view.fill(0x41);
                        view[k] = b;
                        expect(hasNonAscii(view)).toBe(oldNonAscii(view));
                    }
                }
            }
        }
        // Bytes just outside the view never count.
        backing.fill(0xFF);
        backing.subarray(5, 30).fill(0x20);
        expect(hasNonAscii(backing.subarray(5, 30))).toBe(false);
    });

    it('gives the same text, encoding and flags as before on valid and invalid UTF-8', () => {
        const valid = ['Anežka Dvořáková', 'Zoë Brontë-Müller', '王小明', 'é à combining', 'emoji 👨‍👩‍👧 end', 'plain ASCII'];
        const invalid: number[][] = [
            [0xC3],                   // cut at the end
            [0xE6, 0x97],             // a three-byte letter cut short
            [0xC0, 0xAF],             // overlong
            [0xED, 0xA0, 0x80],       // a lone surrogate
            [0xF4, 0x90, 0x80, 0x80], // past U+10FFFF
            [0xE8, 0x65, 0x6E],       // "č" in Windows-1250
            [0x80, 0x81],             // continuation bytes alone
        ];
        const files: Uint8Array[] = [];
        for (const char of [null, 'UTF-8', 'ANSI', 'ASCII', 'IBMPC']) {
            for (const v of valid) files.push(enc(ged(char, v)));
            for (const bad of invalid) {
                const head = enc(ged(char, 'Dvo'));
                const at = head.indexOf(0x0A, head.indexOf(0x4E)); // end of the NAME line
                files.push(new Uint8Array([...head.subarray(0, at), ...bad, ...head.subarray(at)]));
            }
        }
        // A whole run of random bytes, mostly not UTF-8.
        for (let i = 0; i < 200; i++) files.push(new Uint8Array([...enc(ged(null, '')), ...randomBytes(i, 900 + i)]));
        for (const bytes of files) {
            const got = decodeGedcomBytes(bytes.slice().buffer as ArrayBuffer);
            expect(got.nonAscii).toBe(oldNonAscii(bytes));
            if (got.encoding === 'utf-8') {
                expect(oldIsValidUtf8(bytes) || !got.nonAscii).toBe(true);
                expect(got.text).toBe(new TextDecoder('utf-8').decode(bytes));
            } else {
                // Not UTF-8: only invalid UTF-8 with bytes outside ASCII is guessed.
                expect(oldIsValidUtf8(bytes)).toBe(false);
            }
        }
    });

    it('decodes a 60 MB file with photos within its time budget', () => {
        // The one name with a letter outside ASCII at the end: the old byte
        // callback ran over the whole file before it found it.
        const r = rng(3);
        const line = (n: number): string => {
            let s = '';
            const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            for (let i = 0; i < n; i++) s += a[Math.floor(r() * 64)];
            return s;
        };
        const conc = Array.from({ length: 64 }, () => `3 CONC ${line(240)}\n`).join('');
        const body = '0 HEAD\n1 CHAR UTF-8\n' + `0 @M1@ OBJE\n1 FILE data:image/jpeg;base64,\n${conc}`.repeat(3800)
            + '0 @I1@ INDI\n1 NAME Anežka Dvořáková\n0 TRLR\n';
        const buffer = enc(body).buffer as ArrayBuffer;
        expect(buffer.byteLength).toBeGreaterThan(60_000_000);
        const got = decodeGedcomBytes(buffer);
        expect(got.encoding).toBe('utf-8');
        expect(got.text.length).toBe(body.length);
        // About 17 ms on the reference machine (23 ms on Node 20); with the old
        // byte callback and decoding twice about 280 ms.
        const BUDGET_MS = 100;
        const m = measureAgainstBudget(() => decodeGedcomBytes(buffer), {
            budgetMs: BUDGET_MS, calibrationRounds: 4, referenceMs: 22, minPairs: 3, maxPairs: 8,
        });
        console.log(budgetReport('decodeGedcomBytes 60 MB', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 60_000);
});
