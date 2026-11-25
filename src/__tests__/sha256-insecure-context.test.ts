/**
 * Outside a secure context (plain http at a network address, GitHub #13) the
 * browser has no crypto.subtle: the app must still hash its images — the
 * image pool's ids and a research's image references — with the built-in
 * SHA-256, giving the same digests as WebCrypto.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

const media = new Map<string, unknown>();
vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(_store: string, key: string): Promise<T | null> { return (media.get(key) as T) ?? null; },
        set(_store: string, key: string, value: unknown): Promise<void> { media.set(key, value); return Promise.resolve(); },
        setTogether(writes: { key: string; value: unknown }[]): Promise<void> {
            for (const w of writes) media.set(w.key, w.value);
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

import { sha256Bytes, OFF_THREAD_MIN_BYTES } from '../sha256.js';
import { configureHeavyWork } from '../heavy-work.js';
import { runHeavyJob, type HeavyJob } from '../heavy-job.js';
import { sha256Hex } from '../research-image-refs.js';
import { storeImages, forgetPoolScope } from '../media-pool.js';

const realCrypto = globalThis.crypto;
/** The page as at http://192.168.x.y: crypto without subtle. */
function insecure(): void {
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
}

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

afterEach(() => {
    vi.unstubAllGlobals();
    media.clear();
});

describe('SHA-256 without crypto.subtle', () => {
    it('the built-in digest equals WebCrypto on known vectors and odd lengths', async () => {
        const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'Žluťoučký kůň 😀 王', 'x'.repeat(1000)];
        const want = await Promise.all(inputs.map(s => realCrypto.subtle.digest('SHA-256', enc(s) as BufferSource).then(hex)));
        insecure();
        expect(globalThis.crypto.subtle).toBeUndefined();
        const got = await Promise.all(inputs.map(s => sha256Bytes(enc(s)).then(hex)));
        expect(got).toEqual(want);
        expect(got[1]).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(await sha256Hex(enc('abc'))).toBe(got[1]);
    });

    it('images of a tree without encryption go into the pool with the same ids as in a secure context', async () => {
        const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        const secure = await storeImages(new Set([url]), false, 'secure');
        media.clear();
        forgetPoolScope('secure');
        insecure();
        const plain = await storeImages(new Set([url]), false, 'insecure');
        expect(plain.ids.get(url)).toBe(secure.ids.get(url));
        expect(plain.ids.get(url)).toMatch(/^p:[0-9a-f]{40}$/);
        expect(media.has(plain.ids.get(url)!)).toBe(true);
    });
});

describe('SHA-256 without crypto.subtle: off the page\'s thread', () => {
    afterEach(() => configureHeavyWork(null));

    it('a photo is hashed in a worker (the same digest), a few bytes here', async () => {
        const photo = new Uint8Array(OFF_THREAD_MIN_BYTES + 5).map((_, i) => i % 251);
        const want = hex(await realCrypto.subtle.digest('SHA-256', photo as BufferSource));
        const jobs: HeavyJob[] = [];
        configureHeavyWork({ run: async job => { jobs.push(job); return (await runHeavyJob(job)).result; } });
        insecure();
        expect(hex(await sha256Bytes(photo))).toBe(want);
        expect(hex(await sha256Bytes(enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(jobs.map(j => j.op)).toEqual(['sha256']);
        // A view of a larger buffer goes as its own bytes, not the whole buffer.
        const inside = new Uint8Array(OFF_THREAD_MIN_BYTES * 4).subarray(10, 10 + OFF_THREAD_MIN_BYTES);
        await sha256Bytes(inside);
        expect((jobs[1] as { bytes: Uint8Array }).bytes.buffer.byteLength).toBe(OFF_THREAD_MIN_BYTES);
    });

    it('without a worker a photo is hashed here after a pause for the page', async () => {
        configureHeavyWork({ off: true });
        insecure();
        const photo = new Uint8Array(OFF_THREAD_MIN_BYTES).fill(7);
        let paused = false;
        setTimeout(() => { paused = true; }, 0);
        await sha256Bytes(photo);
        expect(paused).toBe(true);
    });

    it('the pool hashes its new images in workers, two at a time, with the ids of a secure context', async () => {
        const urls = new Set(Array.from({ length: 5 }, (_, i) => 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...new Uint8Array(1000).fill(i + 1))).repeat(70)));
        forgetPoolScope('secure');
        const secure = await storeImages(urls, false, 'secure');
        media.clear();
        let running = 0, most = 0;
        const jobs: HeavyJob[] = [];
        configureHeavyWork({ run: async job => {
            jobs.push(job);
            running++; most = Math.max(most, running);
            await new Promise(r => setTimeout(r, 1));
            running--;
            return (await runHeavyJob(job)).result;
        } });
        insecure();
        forgetPoolScope('insecure');
        const got = await storeImages(urls, false, 'insecure');
        expect([...got.ids]).toEqual([...secure.ids]);
        expect(jobs.filter(j => j.op === 'sha256').length).toBeGreaterThanOrEqual(5);
        expect(most).toBe(2);
    });
});
