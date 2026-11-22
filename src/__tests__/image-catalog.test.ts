/**
 * The image catalog (image-meta.ts) and the image resolver (image-src.ts):
 * catalog entries give exactly what today's functions give for the data URL,
 * stored trees and backups carry them (encrypted with an encrypted record),
 * trees stored before the catalog get it without their data changing, and a
 * pooled image's reference becomes an object URL of the right bytes (also an
 * encrypted one), kept in a bounded cache that revokes what it pushes out.
 *
 * StorageManager is an in-memory, per-store Map; encryption uses the real Web
 * Crypto session. All data is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveObjectURL } from 'node:buffer';

const stores = new Map<string, Map<string, unknown>>();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}
/** Runs inside update's transaction before its change (a write landing in between). */
let beforeUpdate: (() => void) | null = null;
const getManyCalls: string[][] = [];

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return structuredClone((st(store).get(key) as T) ?? null);
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            st(store).set(key, structuredClone(value));
            return Promise.resolve();
        },
        setTogether(writes: { store: string; key: string; value: unknown }[]): Promise<void> {
            for (const w of writes) st(w.store).set(w.key, structuredClone(w.value));
            return Promise.resolve();
        },
        async update<T>(store: string, key: string, change: (v: T | null) => T | undefined): Promise<boolean> {
            beforeUpdate?.();
            const next = change(structuredClone((st(store).get(key) as T) ?? null));
            if (next === undefined) return false;
            st(store).set(key, structuredClone(next));
            return true;
        },
        async delete(store: string, key: string): Promise<void> {
            st(store).delete(key);
        },
        async keys(store: string): Promise<string[]> {
            return [...st(store).keys()];
        },
        async getAll<T>(store: string): Promise<T[]> {
            return [...st(store).values()] as T[];
        },
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            if (store === 'media') getManyCalls.push([...keys]);
            return new Map(keys.map(k => [k, structuredClone((st(store).get(k) as T) ?? null)]));
        },
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession, isEncrypted } from '../crypto.js';
import { createSnapshot, getSnapshotJson } from '../snapshots.js';
import { backfillImageMeta } from '../image-meta-backfill.js';
import { contentFingerprint } from '../research-link.js';
import { POOL_REF, withPoolLock, storeImages } from '../media-pool.js';
import {
    computeImageMeta, imageMetaOf, clearImageMeta, imageToken, mediaToken, headMime, type ImageMeta,
} from '../image-meta.js';
import {
    imageUrl, imageUrlNow, imageBlob, imgSrcAttr, releaseImageUrls, setImageCacheLimits, imageCacheStats,
    onImageUrlRevoked, poolIdOf, IMAGE_PLACEHOLDER, POOL_REF_ATTR, startImageHydrator, stopImageHydrator,
} from '../image-src.js';
import { dataUrlByteSize, dataUrlImageSize } from '../photo.js';
import { sha256Hex } from '../research-image-refs.js';
import { StromData, TreeId, TreeMetadata } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

let encryptionOn = false;

/** Seeded pseudo-random bytes (repeatable). */
function noise(seed: number, n: number): Uint8Array {
    const bytes = new Uint8Array(n);
    let x = seed * 2654435761 >>> 0;
    for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; bytes[i] = x >>> 24; }
    return bytes;
}

/** A PNG-looking image of `w`×`h` pixels (a real IHDR, invented pixels). */
function pngBytes(seed: number, w: number, h: number, n = 3000): Uint8Array {
    const b = noise(seed, n);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const png = (seed: number, w = 37, h = 21) => 'data:image/png;base64,' + b64(pngBytes(seed, w, h));
const jpeg = (seed: number) => 'data:image/jpeg;base64,' + b64(noise(seed, 3000));

function tree(name: string, images: string[] = []): StromData {
    const d = {
        version: STROM_DATA_VERSION,
        persons: { p0: { id: 'p0', firstName: name, lastName: 'Example', gender: 'female', partnerships: [], parentIds: [], childIds: [] } },
        partnerships: {},
    } as unknown as StromData;
    if (images.length) {
        (d.persons as Record<string, { photo?: string }>).p0.photo = images[0];
        d.sources = { s1: { id: 's1', title: 'Entry', excerpts: images.slice(1).map((url, i) =>
            ({ id: `e${i}`, dataUrl: url, width: 10, height: 10, sizeBytes: 1 })) } } as never;
    }
    return d;
}

function meta(id: string, name: string): TreeMetadata {
    return { id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01', personCount: 0, partnershipCount: 0, sizeBytes: 0 };
}

function resetTreeManager(trees: TreeMetadata[]): void {
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
    };
    tm.index = { version: 1, activeTreeId: trees[0]?.id ?? null, trees };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
}

async function save(id: string, data: StromData): Promise<void> {
    TreeManager.saveTreeData(id as TreeId, data);
    await TreeManager.flush(id as TreeId);
}

type Rec = { pooled: 1; data?: StromData; encrypted?: unknown; media: Record<string, number>; imageMeta?: unknown };

/** What today's functions say of a data URL. */
async function expected(url: string): Promise<ImageMeta> {
    const size = dataUrlImageSize(url);
    const comma = url.indexOf(',');
    return {
        len: url.length,
        head: url.slice(0, comma + 1),
        bytes: dataUrlByteSize(url),
        ...(size ? { w: size.w, h: size.h } : {}),
        token: imageToken(url),
        mtok: mediaToken(url),
        sha: await sha256Hex(Buffer.from(url.slice(comma + 1), 'base64')),
    };
}

async function blobBytes(url: string): Promise<{ bytes: Uint8Array; type: string }> {
    const blob = resolveObjectURL(url);
    if (!blob) throw new Error('no blob behind ' + url);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
}

beforeEach(() => {
    stores.clear();
    getManyCalls.length = 0;
    beforeUpdate = null;
    encryptionOn = false;
    clearImageMeta();
    releaseImageUrls();
    setImageCacheLimits();
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockImplementation(() => encryptionOn);
    vi.stubGlobal('window', new EventTarget());
    resetTreeManager([meta('t1', 'One'), meta('t2', 'Two')]);
});

afterEach(() => {
    CryptoSession.lock();
    releaseImageUrls();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('catalog entries', () => {
    it('give what the functions over the data URL give', async () => {
        for (const url of [png(1), png(2, 640, 480), jpeg(3)]) {
            expect(await computeImageMeta(url)).toEqual(await expected(url));
        }
        expect((await computeImageMeta(png(2, 640, 480))).w).toBe(640);
        // Not base64: no hash (the research bridge names only base64 images), the rest as always.
        const text = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg">' + 'x'.repeat(1200) + '</svg>');
        const m = await computeImageMeta(text);
        expect(m.sha).toBeUndefined();
        expect(m).toMatchObject({ len: text.length, bytes: dataUrlByteSize(text), token: imageToken(text), mtok: mediaToken(text) });
        expect(headMime(m.head)).toBe('image/svg+xml');
    });

    it('the tokens are the fingerprints\' own (values from before they moved here)', () => {
        const url = 'data:image/jpeg;base64,' + 'QUJD'.repeat(500);
        expect(imageToken(url)).toBe('\u0000img:2023:14wq00m');
        expect(mediaToken(url)).toBe('1k7.18ye8lw');
        expect(mediaToken(undefined)).toBe('');
    });

    it('the token is the research fingerprint\'s own: a tree with the image fingerprints as one with its token', () => {
        const url = png(4);
        expect(contentFingerprint(tree('Anna', [url]))).toBe(contentFingerprint(tree('Anna', [imageToken(url)])));
        expect(contentFingerprint(tree('Anna', [url]))).not.toBe(contentFingerprint(tree('Anna', [imageToken(png(5))])));
    });

    it('come with storing images and are kept by content id', async () => {
        const urls = [png(1), jpeg(2)];
        const out = await withPoolLock(() => storeImages(new Set(urls), false, 't1'));
        for (const url of urls) {
            const id = out.ids.get(url)!;
            expect(out.meta[id]).toEqual(await expected(url));
            expect(imageMetaOf(id)).toEqual(out.meta[id]);
            expect(imageMetaOf(POOL_REF + id)).toEqual(out.meta[id]);
        }
    });

    it('a stored tree and a backup carry them; reading the tree brings them back', async () => {
        const d = tree('Anna', [png(1), jpeg(2)]);
        await save('t1', d);
        const rec = st('trees').get('t1') as Rec;
        const ids = Object.keys(rec.media);
        expect(Object.keys(rec.imageMeta as object).sort()).toEqual(ids.sort());
        const snapId = (await createSnapshot('t1', d, 'manual', 1_700_000_000_000)).id;
        const snap = st('snapshots').get(snapId) as { imageMeta?: object };
        expect(Object.keys(snap.imageMeta ?? {}).sort()).toEqual(ids.sort());

        clearImageMeta();
        const r = await TreeManager.readTreeData('t1' as TreeId);
        expect(r.status).toBe('ok');
        const photoId = ids.find(i => (rec.imageMeta as Record<string, ImageMeta>)[i].head === 'data:image/png;base64,')!;
        expect(imageMetaOf(photoId)).toEqual(await expected(png(1)));

        clearImageMeta();
        expect(await getSnapshotJson(snapId)).toBeTruthy();
        expect(imageMetaOf(photoId)).toEqual(await expected(png(1)));
    });

    it('an encrypted tree keeps them encrypted, and reads them back unlocked', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('catalog-password');
        await save('t1', tree('Anna', [png(1)]));
        const rec = st('trees').get('t1') as Rec;
        expect(isEncrypted(rec.imageMeta)).toBe(true);
        const sha = (await expected(png(1))).sha!;
        expect(JSON.stringify(rec)).not.toContain(sha);

        clearImageMeta();
        expect((await TreeManager.readTreeData('t1' as TreeId)).status).toBe('ok');
        expect(imageMetaOf(Object.keys(rec.media)[0])?.sha).toBe(sha);
    });
});

describe('trees stored before the catalog', () => {
    async function oldRecord(id: string, data: StromData): Promise<Rec> {
        await save(id, data);
        const rec = st('trees').get(id) as Rec;
        delete rec.imageMeta;
        clearImageMeta();
        return structuredClone(rec);
    }

    it('get it from the pool, their data unchanged', async () => {
        const before = await oldRecord('t1', tree('Anna', [png(1), jpeg(2)]));
        const out = await backfillImageMeta(['t1', 't2']);
        expect(out).toEqual({ filled: 1, locked: 0 });
        const rec = st('trees').get('t1') as Rec;
        const { imageMeta, ...rest } = rec;
        expect(rest).toEqual(before);
        for (const [id, m] of Object.entries(imageMeta as Record<string, ImageMeta>)) {
            const url = m.head.includes('png') ? png(1) : jpeg(2);
            expect(m).toEqual(await expected(url));
            expect(imageMetaOf(id)).toEqual(m);
        }
        // Once is enough.
        expect(await backfillImageMeta(['t1', 't2'])).toEqual({ filled: 0, locked: 0 });
    });

    it('an encrypted one waits for the unlock, then gets it encrypted', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('catalog-password');
        const before = await oldRecord('t1', tree('Anna', [png(1)]));
        const salt = CryptoSession.getSalt()!;
        CryptoSession.lock();
        expect(await backfillImageMeta(['t1', 't2'])).toEqual({ filled: 0, locked: 1 });
        expect((st('trees').get('t1') as Rec).imageMeta).toBeUndefined();

        await CryptoSession.unlock('catalog-password', salt);
        expect(await backfillImageMeta(['t1', 't2'])).toEqual({ filled: 1, locked: 0 });
        const rec = st('trees').get('t1') as Rec;
        expect(isEncrypted(rec.imageMeta)).toBe(true);
        const { imageMeta: _m, ...rest } = rec;
        expect(rest).toEqual(before);
    });

    it('a save landing meanwhile is never overwritten', async () => {
        await oldRecord('t1', tree('Anna', [png(1)]));
        // Another window stored the tree without its picture in between.
        const newer = tree('Anna Newer');
        beforeUpdate = () => { st('trees').set('t1', structuredClone(newer)); };
        expect(await backfillImageMeta(['t1', 't2'])).toEqual({ filled: 0, locked: 0 });
        expect(st('trees').get('t1')).toEqual(newer);
    });
});

describe('the resolver', () => {
    async function pooled(urls: string[], encrypted = false): Promise<Map<string, string>> {
        const out = await withPoolLock(() => storeImages(new Set(urls), encrypted, 't1'));
        return new Map(urls.map(u => [u, POOL_REF + out.ids.get(u)!]));
    }

    it('a data URL or another address is used as it is', async () => {
        const url = png(1);
        expect(await imageUrl(url)).toBe(url);
        expect(imageUrlNow(url)).toBe(url);
        expect(poolIdOf(url)).toBeNull();
    });

    it('a reference becomes an object URL of the image\'s bytes and type', async () => {
        const url = png(1);
        const ref = (await pooled([url])).get(url)!;
        expect(imageUrlNow(ref)).toBe('');
        const objectUrl = await imageUrl(ref);
        expect(objectUrl.startsWith('blob:')).toBe(true);
        const got = await blobBytes(objectUrl);
        expect(got.type).toBe('image/png');
        expect(Buffer.from(got.bytes).toString('base64')).toBe(url.slice(url.indexOf(',') + 1));
        expect(imageUrlNow(ref)).toBe(objectUrl);
        expect(await imageUrl(ref)).toBe(objectUrl);
        const blob = await imageBlob(ref);
        expect(blob?.type).toBe('image/png');
        expect(blob?.size).toBe(got.bytes.length);
    });

    it('an encrypted image is decrypted; locked it gives nothing', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('catalog-password');
        const url = jpeg(5);
        const ref = (await pooled([url], true)).get(url)!;
        expect(ref.startsWith(POOL_REF + 'e:')).toBe(true);
        const got = await blobBytes(await imageUrl(ref));
        expect(got.type).toBe('image/jpeg');
        expect(Buffer.from(got.bytes).toString('base64')).toBe(url.slice(url.indexOf(',') + 1));

        releaseImageUrls();
        CryptoSession.lock();
        expect(await imageUrl(ref)).toBe('');
        expect(await imageBlob(ref)).toBeNull();
    });

    it('a reference the pool does not have gives nothing', async () => {
        expect(await imageUrl(POOL_REF + 'p:' + '0'.repeat(40))).toBe('');
    });

    it('images asked in one tick are read in one transaction', async () => {
        const urls = [png(1), png(2), jpeg(3)];
        const refs = await pooled(urls);
        getManyCalls.length = 0;
        const out = await Promise.all([...refs.values(), refs.get(urls[0])!].map(imageUrl));
        expect(getManyCalls).toHaveLength(1);
        expect(getManyCalls[0]).toHaveLength(3);
        expect(out[3]).toBe(out[0]);
    });

    it('the cache keeps to its bounds and revokes what it pushes out', async () => {
        const urls = [png(1), png(2), png(3)];
        const refs = await pooled(urls);
        setImageCacheLimits(7000, 400);   // two images of 3000 bytes
        const revoked: string[] = [];
        const off = onImageUrlRevoked((_id, u) => revoked.push(u));
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
        const first = await imageUrl(refs.get(urls[0])!);
        await imageUrl(refs.get(urls[1])!);
        await imageUrl(refs.get(urls[0])!);   // used again: now the newest
        await imageUrl(refs.get(urls[2])!);
        off();
        expect(imageCacheStats()).toEqual({ count: 2, bytes: 6000 });
        expect(imageUrlNow(refs.get(urls[1])!)).toBe('');
        expect(imageUrlNow(refs.get(urls[0])!)).toBe(first);
        expect(revoked).toHaveLength(1);
        expect(revokeSpy).toHaveBeenCalledWith(revoked[0]);
        expect(resolveObjectURL(revoked[0])).toBeUndefined();
    });
});

describe('HTML text and the hydrator', () => {
    it('imgSrcAttr: an address as src, a reference as the placeholder with its id', () => {
        expect(imgSrcAttr('data:image/png;base64,AA"<')).toBe('src="data:image/png;base64,AA&quot;&lt;"');
        const id = 'p:' + 'a'.repeat(40);
        expect(imgSrcAttr(POOL_REF + id)).toBe(`src="${IMAGE_PLACEHOLDER}" ${POOL_REF_ATTR}="${id}"`);
    });

    /** A minimal element: attributes, no children. */
    class FakeEl {
        nodeType = 1;
        tagName = 'IMG';
        attrs = new Map<string, string>();
        constructor(attrs: Record<string, string>) { for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v); }
        getAttribute(k: string) { return this.attrs.get(k) ?? null; }
        setAttribute(k: string, v: string) { this.attrs.set(k, v); }
        hasAttribute(k: string) { return this.attrs.has(k); }
        querySelectorAll() { return [] as FakeEl[]; }
    }

    it('fills an element on screen and lets it go off screen once the cache dropped it', async () => {
        const urls = [png(1), png(2)];
        const out = await withPoolLock(() => storeImages(new Set(urls), false, 't1'));
        const [id1, id2] = urls.map(u => out.ids.get(u)!);
        const el = new FakeEl({ src: IMAGE_PLACEHOLDER, [POOL_REF_ATTR]: id1 });
        const root = { nodeType: 1, tagName: 'HTML', hasAttribute: () => false, querySelectorAll: () => [el] };
        let io: ((entries: { target: FakeEl; isIntersecting: boolean }[]) => void) | null = null;
        const observed = new Set<FakeEl>();
        class FakeIO {
            constructor(cb: typeof io) { io = cb; }
            observe(x: FakeEl) { observed.add(x); }
            unobserve(x: FakeEl) { observed.delete(x); }
            disconnect() { observed.clear(); }
        }
        class FakeMO { observe() {} disconnect() {} }
        const doc = {
            documentElement: root,
            defaultView: { MutationObserver: FakeMO, IntersectionObserver: FakeIO },
            addEventListener() {}, removeEventListener() {},
        } as unknown as Document;
        startImageHydrator(doc);
        try {
            expect(observed.has(el)).toBe(true);
            expect(el.getAttribute('src')).toBe(IMAGE_PLACEHOLDER);
            io!([{ target: el, isIntersecting: true }]);
            await vi.waitFor(() => expect(el.getAttribute('src')).toBe(imageUrlNow(POOL_REF + id1)));
            const shown = el.getAttribute('src')!;
            expect(shown.startsWith('blob:')).toBe(true);

            // Off screen with its URL still at hand: kept.
            io!([{ target: el, isIntersecting: false }]);
            expect(el.getAttribute('src')).toBe(shown);
            // The cache pushes it out for another image: back to the placeholder.
            setImageCacheLimits(4000, 400);
            await imageUrl(POOL_REF + id2);
            expect(imageUrlNow(POOL_REF + id1)).toBe('');
            expect(el.getAttribute('src')).toBe(IMAGE_PLACEHOLDER);
            // On screen again: read anew.
            io!([{ target: el, isIntersecting: true }]);
            await vi.waitFor(() => expect(el.getAttribute('src')!.startsWith('blob:')).toBe(true));
            expect(el.getAttribute('src')).not.toBe(shown);
        } finally {
            stopImageHydrator(doc);
        }
    });
});
