/**
 * The gift package of a tree whose photos would not fit the page's memory
 * whole (1127: the page ran out of memory making the package of a large tree
 * with photos). The package never holds the tree's images together: no read
 * of the image pool takes more than a few images (the old way read every
 * image of the cut at once and kept them for all its steps), and the package
 * is byte for byte the one made from the tree with its images expanded —
 * the app, the family pages with their image files, the book, the fan (SVG
 * and the PNG drawn from it), the GEDCOM and the cover page; an excerpt
 * turned by its orientation, an image kept as text (SVG), an image the pool
 * does not have. The pool is StorageManager.getMany over a Map; the data
 * invented (the demo family).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../settings.js', async (orig) => {
    const real = await orig<typeof import('../settings.js')>();
    return { ...real, SettingsManager: Object.assign(Object.create(Object.getPrototypeOf(real.SettingsManager)), real.SettingsManager, { isEncryptionEnabled: () => false }) };
});

import { StorageManager } from '../storage.js';
import { getDemoTree } from '../demo-tree.js';
import { expandedData } from '../image-expand.js';
import { htmlFileWithImages, scriptSafeJson } from '../image-stream.js';
import { POOL_REF } from '../image-ref.js';
import { clearImageMeta, computeImageMeta, setImageMeta } from '../image-meta.js';
import { defaultGiftParts, defaultGiftPrivacy, type GiftSettings } from '../gift-tree.js';
import { buildGiftBatch, buildGiftPackage, type GiftPackageEnv } from '../gift-package.js';
import { STAND_IN_IMAGES_PER_READ, textBlobWithImages, textWithImageUrls, treeWithPoolStandIns } from '../image-standin.js';
import { buildFamilyBook } from '../book.js';
import { defaultBookOptions } from '../book-options.js';
import { resolveObjectURL } from 'node:buffer';
import { blobBytes, zipFiles } from './helpers/zip-read.js';
import { buildPagesFile } from '../ui/family-pages-ui.js';
import type { PersonId, StromData } from '../types.js';
import { Spool } from '../spool.js';
import { countMemoryBlobs, fakeSpoolFolders } from './helpers/fake-opfs.js';

const NOW = new Date(2026, 11, 20, 14, 0, 0);
const P = (key: string) => `demo_${key}` as PersonId;

const media = new Map<string, unknown>();
/** The ids each read of the image store asked for (while `counting`). */
let reads: number[] = [];
let counting = false;

function jpegBytes(seed: number, n = 1500): Uint8Array {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7) & 0xFF;
    b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[3] = 0xFE; b[4] = 0x00; b[5] = 0x10;
    b[n - 2] = 0xFF; b[n - 1] = 0xD9;
    return b;
}

const HEAD = 'data:image/jpeg;base64,';
const idOf = (seed: number) => 'p:' + (seed + 0x200).toString(16).padStart(4, '0').repeat(10);

async function pooled(seed: number): Promise<string> {
    const bytes = jpegBytes(seed);
    const id = idOf(seed);
    media.set(id, { head: HEAD, bytes: bytes.slice().buffer });
    setImageMeta(id, await computeImageMeta(HEAD + Buffer.from(bytes).toString('base64'), bytes));
    return POOL_REF + id;
}

async function pooledSvg(seed: number): Promise<string> {
    const url = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><circle r="${seed}"/></svg>`;
    const id = idOf(seed);
    media.set(id, { text: url });
    setImageMeta(id, await computeImageMeta(url));
    return POOL_REF + id;
}

/** The demo family with a pooled photo for everyone, a couple's photo, attachments, excerpts (one turned), an SVG and one image the pool lacks. */
async function treeWithPhotos(): Promise<{ data: StromData; images: number }> {
    const d = getDemoTree();
    let seed = 0;
    for (const p of Object.values(d.persons)) {
        if (p.isPlaceholder) continue;
        p.photo = seed === 3 ? await pooledSvg(seed++) : await pooled(seed++);
    }
    const union = Object.values(d.partnerships).find(u => u.person1Id === P('daniel') || u.person2Id === P('daniel'))!;
    union.photo = await pooled(seed++);
    d.media = d.media ?? {};
    for (let i = 0; i < 4; i++) {
        d.media[`gift_m${i}`] = {
            id: `gift_m${i}`, dataUrl: await pooled(seed++), name: `scan-${i}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1500,
            places: [{ personId: P(i % 2 ? 'daniel' : 'eva') }],
        } as never;
    }
    d.media.gift_gone = {
        id: 'gift_gone', dataUrl: POOL_REF + 'p:' + 'ab'.repeat(20), name: 'gone.jpg', mimeType: 'image/jpeg', sizeBytes: 900,
        places: [{ personId: P('daniel') }],
    } as never;
    const sources = Object.values(d.sources ?? {});
    for (let i = 0; i < Math.min(3, sources.length); i++) {
        sources[i].excerpts = [{ id: `gift_e${i}`, dataUrl: await pooled(seed++), width: 40, height: 30, sizeBytes: 1500, ...(i === 0 ? { orient: 6 } : {}) } as never];
    }
    return { data: d, images: seed };
}

function settings(): GiftSettings {
    return {
        cut: { recipients: [P('daniel')], depth: 2, branches: {} },
        privacy: defaultGiftPrivacy(),
        parts: { ...defaultGiftParts() },
        photos: true,
        fan: { asTree: false, styles: ['color', 'antique'], photos: true },
        cards: 'detailed',
        letter: { lang: 'en', motif: 'xmas', salutation: 'Dear Daniel', message: '[oslovení], merry Christmas.', signature: 'Grandma', date: '2026-12-20' },
    };
}

function env(extra: Partial<GiftPackageEnv> = {}): GiftPackageEnv {
    return {
        now: NOW,
        // The app as the window writes it: its embedded data with the pooled images read as the file is written.
        app: async (data, o) => (await htmlFileWithImages('<html><head></head><body></body></html>', data, v => `<script>window.D=${scriptSafeJson(JSON.stringify(v))}</script>`, o.spool)).blob,
        // The PNG stands for the SVG it is drawn from (its text as it is).
        png: async (svg) => new Blob([await svg.text()]),
        fan: { portrait: (p) => (typeof p.photo === 'string' && p.photo.startsWith('data:image/') ? { href: p.photo } : null) },
        pause: async () => undefined,
        ...extra,
    };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    media.clear();
    reads = [];
    counting = false;
    clearImageMeta();
    vi.spyOn(StorageManager, 'getMany').mockImplementation(async (store: string, keys: string[]) => {
        if (store === 'media' && counting) reads.push(keys.length);
        return new Map(keys.map(k => [k, store === 'media' ? structuredClone(media.get(k) ?? null) : null])) as never;
    });
    vi.spyOn(StorageManager, 'keys').mockImplementation(async (store: string) => (store === 'media' ? [...media.keys()] : []) as never);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the gift package of a tree with many photos (1127)', () => {
    it('reads the pool a few images at a time and is byte for byte the package of the expanded tree', async () => {
        const { data, images } = await treeWithPhotos();
        expect(images).toBeGreaterThan(3 * STAND_IN_IMAGES_PER_READ);

        // As before: the cut's images expanded at once.
        const before = await buildGiftPackage({ data, settings: settings(), treeName: 'Berg', env: env({ expand: (d) => expandedData(d) }) });

        counting = true;
        const after = await buildGiftPackage({ data, settings: settings(), treeName: 'Berg', env: env() });
        counting = false;

        // Never more than a few images held: no read of the pool takes more.
        expect(reads.length).toBeGreaterThan(0);
        expect(Math.max(...reads)).toBeLessThanOrEqual(STAND_IN_IMAGES_PER_READ);

        const a = zipFiles(await blobBytes(before.blob));
        const b = zipFiles(await blobBytes(after.blob));
        expect([...b.keys()]).toEqual([...a.keys()]);
        const dec = new TextDecoder();
        for (const [path, bytes] of a) {
            const got = b.get(path)!;
            if (!Buffer.from(got).equals(Buffer.from(bytes))) expect(dec.decode(got), path).toBe(dec.decode(bytes));
        }
        expect(after.files).toEqual(before.files);

        // Every part carries the photos: the images folder of the pages, the book, the fan, the app, the GEDCOM.
        const paths = [...b.keys()];
        const text = (re: RegExp) => dec.decode(b.get(paths.find(p => re.test(p))!)!);
        expect(paths.filter(p => /\/img-\d+\.jpg$/.test(p)).length).toBeGreaterThan(3);
        for (const re of [/\.html$/, /\.ged$/, /\.svg$/]) expect(text(re)).not.toContain('STROMPOOL');
        expect(paths.some(p => /\.svg$/.test(p) && dec.decode(b.get(p)!).includes(HEAD))).toBe(true);
        for (const [, bytes] of b) expect(dec.decode(bytes)).not.toMatch(/STROMPOOL|data-pool-ref|\\u0000sm:/);
    });

    it('with a spool: the archive, the app, the book and the GEDCOM are its files, not Blobs in memory, and the ZIP is the same', async () => {
        const { data } = await treeWithPhotos();
        // Chrome breaks Blobs made in memory faster than it moves them to its disk (gigabytes of photos: "network error").
        const plainCount = countMemoryBlobs();
        let plain;
        try {
            plain = await buildGiftPackage({ data, settings: settings(), treeName: 'Berg', env: env() });
        } finally {
            plainCount.restore();
        }
        const [parent, dir, name, fake] = fakeSpoolFolders();
        const spool = new Spool(parent, dir, name);
        const spooledCount = countMemoryBlobs();
        let spooled;
        try {
            spooled = await buildGiftPackage({ data, settings: settings(), treeName: 'Berg', env: env(), spool });
        } finally {
            spooledCount.restore();
        }
        expect(Buffer.from(await blobBytes(spooled.blob)).equals(Buffer.from(await blobBytes(plain.blob)))).toBe(true);
        expect(spooled.files).toEqual(plain.files);
        expect(spool.holds(spooled.blob)).toBe(true);
        // Only the package's own file is left: the app's, the book's and the GEDCOM's went once in the archive.
        expect(fake.files()).toHaveLength(1);
        expect(fake.files()[0].bytes.length).toBe(plain.blob.size);
        // In memory only the small ones (the fan's posters, a page, the cover).
        expect(spooledCount.bytes()).toBeLessThan(plainCount.bytes() / 4);
        // The batch: each package into the outer archive, then let go of.
        const batchSpool = new Spool(...fakeSpoolFolders('batch').slice(0, 3) as [FileSystemDirectoryHandle, FileSystemDirectoryHandle, string]);
        const batch = await buildGiftBatch({ data, items: [{ settings: settings() }, { settings: settings() }], treeName: 'Berg', lang: 'en', env: env(), spool: batchSpool });
        expect(batch.rows.every(r => r.ok)).toBe(true);
        expect(batchSpool.holds(batch.blob!)).toBe(true);
        const inner = zipFiles(await blobBytes(batch.blob!));
        expect([...inner.values()].map(b => b.length)).toEqual([plain.blob.size, plain.blob.size]);
    });

    it('the family pages file (one HTML, or the ZIP with the images folder): a few images per read, byte for byte as from the expanded tree', async () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', { styleSheets: [] });
        try {
            const { data } = await treeWithPhotos();
            const opts = { lang: 'en', privacy: 'full', photos: 'full', clips: 'full', now: NOW } as never;
            const job = { cancelled: false, paused: false };
            const spec = { kind: 'tree' } as never;
            const whole = await expandedData(data);
            const text = async (d: string | Blob) => (typeof d === 'string' ? d : d.text());
            const htmlBefore = await buildPagesFile(whole, spec, opts, job, () => {});
            const zipBefore = await buildPagesFile(whole, spec, opts, job, () => {}, true);
            counting = true;
            const htmlAfter = await buildPagesFile(data, spec, opts, job, () => {});
            const zipAfter = await buildPagesFile(data, spec, opts, job, () => {}, true);
            counting = false;
            expect(reads.length).toBeGreaterThan(0);
            expect(Math.max(...reads)).toBeLessThanOrEqual(STAND_IN_IMAGES_PER_READ);
            const h = await text(htmlAfter.data);
            expect(h).toBe(await text(htmlBefore.data));
            expect(h).toContain(HEAD);
            expect(htmlAfter.bytes).toBe(htmlBefore.bytes);
            const a = zipFiles(await blobBytes(zipBefore.data as Blob));
            const b = zipFiles(await blobBytes(zipAfter.data as Blob));
            expect([...b.keys()]).toEqual([...a.keys()]);
            for (const [path, bytes] of a) expect(Buffer.from(b.get(path)!).equals(Buffer.from(bytes)), path).toBe(true);
            expect([...b.keys()].filter(p => /\.jpg$/.test(p)).length).toBeGreaterThan(3);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('the book: its window shows each image by an object URL of its bytes, its saved file has them put in; a few per read, as from the expanded tree', async () => {
        const { data } = await treeWithPhotos();
        const options = { ...defaultBookOptions('en'), selection: { kind: 'tree' } } as never;
        const before = buildFamilyBook(await expandedData(data), options, { forSave: true });
        counting = true;
        const book = buildFamilyBook(await treeWithPoolStandIns(data), options, { forSave: true });
        const saved = await (await textBlobWithImages(book, 'text/html')).text();
        const shown = await textWithImageUrls(book);
        counting = false;
        expect(Math.max(...reads)).toBeLessThanOrEqual(STAND_IN_IMAGES_PER_READ);
        expect(saved).toBe(before);
        // Each object URL holds the image the expanded book carries.
        const urls = [...new Set(shown.text.match(/blob:nodedata:[0-9a-f-]+/g) ?? [])];
        expect(urls.length).toBeGreaterThan(3);
        const back = new Map<string, string>();
        for (const u of urls) {
            const blob = resolveObjectURL(u)!;
            back.set(u, `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`);
        }
        expect(shown.text.replace(/blob:nodedata:[0-9a-f-]+/g, u => back.get(u)!)).toBe(before);
        shown.revoke();
        expect(resolveObjectURL(urls[0])).toBeUndefined();
    });
});
