/**
 * The research's images by their content hash (spec 071, `ged.imagesByHash`):
 * the file with its images by reference reads, with those images, into the
 * very tree the file with them in it gives; a reference never comes into the
 * tree; the images come in batches, checked against their hash, those held
 * never asked again; anything amiss makes the load take the whole file.
 * Invented data only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { stripMedia } from '../attachments.js';
import { researchGedcom } from '../ui/research-ui.js';
import {
    findImageRefs, imageRefSha, resolveImageFile, imagesUrlOf, refTreeUrl, fetchImagesByHash, resolveImageRefs,
    forgetHeldImages, heldImageShas, ImagesNotResolved, IMAGE_BATCH, IMAGE_RETRY_MS, sha256Hex,
    type ImageFetchDeps, type ImageRef, type ImageResolveDeps,
} from '../research-image-refs.js';
import { storedTreeEtag, bridgeGivesImagesByHash, treeReplyImages } from '../research-tree-file.js';
import type { StromData } from '../types.js';

/** A small JPEG of `width` × `height`; `salt` makes its bytes (and hash) its own. */
function jpeg(width: number, height: number, salt: number): Buffer {
    return Buffer.from([0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xFE, 0x00, 0x04, salt >> 8, salt & 0xFF,
        0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 0xFF, width >> 8, width & 0xFF,
        0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
        ...Array.from({ length: 600 }, (_, i) => (i * 7 + salt) & 0xFF),
        0xFF, 0xD9]);
}
const shaOf = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const dataUrlOf = (b: Buffer): string => `data:image/jpeg;base64,${b.toString('base64')}`;

const IMG_A = jpeg(400, 100, 1);
const IMG_B = jpeg(300, 500, 2);
const IMG_C = jpeg(120, 80, 3);
const PHOTO = jpeg(64, 64, 9);
const UUID = '0b7e5c3a-91d2-4f60-8a1e-5d2c7f9b3e14';

/** `2 FILE` of an image as the file carries it: in it (CONC-wrapped) or by its hash. */
function fileLines(img: Buffer, ref: boolean, upper = false): string[] {
    if (ref) {
        const sha = shaOf(img);
        return [`2 FILE strom-image:${upper ? sha.toUpperCase() : sha}`, '3 _MIME image/jpeg', '3 _WIDTH 400', '3 _HEIGHT 100', `3 _BYTES ${img.length}`];
    }
    const url = dataUrlOf(img);
    const out = [`2 FILE ${url.slice(0, 200)}`];
    for (let i = 200; i < url.length; i += 200) out.push(`3 CONC ${url.slice(i, i + 200)}`);
    return out;
}

/** The research's tree: the file with its images in it, or by their hash (`ref`). */
function researchFile(ref: boolean, opts: { upper?: boolean } = {}): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 9 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 7c1e9a3b5d20', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Velimír /Šťovíček/', '1 SEX M', '1 REFN P0001', '1 SOUR @S0001@', '1 SOUR @S0002@',
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND photo', `2 FILE ${dataUrlOf(PHOTO)}`,
        '0 @P0002@ INDI', '1 NAME Vlastislava /Řeřichová/', '1 SEX F', '1 REFN P0002', '1 SOUR @S0002@',
        '0 @S0001@ SOUR', '1 TITL Křestní matrika Mechovice 1851', '1 REFN S0001',
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0001', ...fileLines(IMG_A, ref, opts.upper),
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0002', `2 _STROM_SHA ${'d'.repeat(64)}`, '2 _STROM_ORIENT 6',
        ...fileLines(IMG_B, ref),
        '0 @S0002@ SOUR', '1 TITL Oddací matrika Mechovice 1874', '1 REFN S0002',
        // The same picture on two sources: one image by its hash.
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0003', ...fileLines(IMG_A, ref),
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0004', ...fileLines(IMG_C, ref),
        '0 @S0003@ SOUR', '1 TITL Úmrtní matrika Mechovice 1899', '1 REFN S0003', '1 _STROM_IMG_OMITTED later', '2 _STROM_CLIP C0009',
        '0 TRLR',
    ].join('\n');
}

const FULL = researchFile(false);
const SLIM = researchFile(true);
const ALL_IMAGES = new Map([[shaOf(IMG_A), dataUrlOf(IMG_A)], [shaOf(IMG_B), dataUrlOf(IMG_B)], [shaOf(IMG_C), dataUrlOf(IMG_C)]]);

/** The data with its generated ids named by their first appearance (they are random). */
function comparable(data: StromData): unknown {
    const names = new Map<string, string>();
    const json = JSON.stringify(data).replace(/\b([a-z]+)_\d{10,}_[0-9a-z]{4,}\b/g, (id, kind: string) => {
        if (!names.has(id)) names.set(id, `${kind}#${names.size}`);
        return names.get(id)!;
    });
    return JSON.parse(json);
}
const read = (text: string, images?: ReadonlyMap<string, string>): StromData => convertToStrom(parseGedcom(text), images ? { images } : {}).data;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
    forgetHeldImages();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('references in the file', () => {
    it('finds each image once, its hash in lower case, with its type and size', () => {
        const refs = findImageRefs(researchFile(true, { upper: true }));
        expect(refs.map(r => r.sha)).toEqual([shaOf(IMG_A), shaOf(IMG_B), shaOf(IMG_C)]);
        expect(refs[0]).toEqual({ sha: shaOf(IMG_A), mime: 'image/jpeg', width: 400, height: 100, bytes: IMG_A.length });
        expect(findImageRefs(FULL)).toEqual([]);
        expect(findImageRefs(SLIM.replace(/\n/g, '\r\n')).length).toBe(3);
    });

    it('reads a FILE value: a reference by its hash, anything else as it is', () => {
        expect(imageRefSha(`strom-image:${'AB'.repeat(32)}`)).toBe('ab'.repeat(32));
        expect(imageRefSha('strom-image:123')).toBeNull();
        expect(imageRefSha('data:image/jpeg;base64,AAAA')).toBeNull();
        const map = new Map([['ab'.repeat(32), 'data:image/jpeg;base64,QUJD']]);
        expect(resolveImageFile(`strom-image:${'ab'.repeat(32)}`, map)).toBe('data:image/jpeg;base64,QUJD');
        expect(resolveImageFile(`strom-image:${'cd'.repeat(32)}`, map)).toBe('');
        expect(resolveImageFile('photos/a.jpg', map)).toBe('photos/a.jpg');
    });

    it('addresses: the images beside the tree, the file asked by reference with the rest kept', () => {
        expect(imagesUrlOf('http://127.0.0.1:5994/abc/tree.ged')).toBe('http://127.0.0.1:5994/abc/images');
        expect(imagesUrlOf('http://127.0.0.1:5994/abc/tree.ged?stale=1')).toBe('http://127.0.0.1:5994/abc/images');
        const url = new URL(refTreeUrl('http://127.0.0.1:5994/abc/tree.ged?stale=1'));
        expect(url.searchParams.get('images')).toBe('ref');
        expect(url.searchParams.get('stale')).toBe('1');
    });
});

describe('reading the file with its images by hash', () => {
    it('with its images: the very tree the file with them in it gives', () => {
        const full = read(FULL);
        const slim = read(SLIM, ALL_IMAGES);
        expect(comparable(slim)).toEqual(comparable(full));
        // (The comparison sees the images: without them the trees differ.)
        expect(comparable(read(SLIM))).not.toEqual(comparable(full));
        const excerpts = Object.values(slim.sources!).flatMap(s => s.excerpts ?? []);
        expect(excerpts.length).toBe(4);
        expect(excerpts.find(e => e.clip === 'C0002')).toMatchObject({ orient: 6, width: 500, height: 300, originalSha: 'd'.repeat(64) });
        // The hash written in capitals reads the same.
        expect(comparable(read(researchFile(true, { upper: true }), ALL_IMAGES))).toEqual(comparable(full));
    });

    it('a reference never comes into the tree, with all, some or none of its images', () => {
        const some = new Map([[shaOf(IMG_A), dataUrlOf(IMG_A)]]);
        for (const images of [ALL_IMAGES, some, new Map<string, string>(), undefined]) {
            const data = read(SLIM, images);
            expect(JSON.stringify(data)).not.toContain('strom-image:');
        }
        // Without its images: the excerpts left out, as the file was always read; the rest as the whole file.
        const none = read(SLIM);
        expect(Object.values(none.sources!).flatMap(s => s.excerpts ?? [])).toEqual([]);
        expect(Object.keys(none.sources!).length).toBe(3);
        expect(Object.values(none.persons).find(p => p.firstName === 'Velimír')?.photo).toBe(dataUrlOf(PHOTO));
        // Only those it has: a source keeps exactly those excerpts.
        const partial = read(SLIM, some);
        expect(Object.values(partial.sources!).flatMap(s => s.excerpts ?? []).map(e => e.clip)).toEqual(['C0001', 'C0003']);
    });

    it('a reference on a person never becomes a file path', () => {
        const text = SLIM.replace(`2 FILE ${dataUrlOf(PHOTO)}`, `2 FILE strom-image:${shaOf(PHOTO)}`);
        const res = convertToStrom(parseGedcom(text));
        expect(JSON.stringify(res)).not.toContain('strom-image:');
        const withIt = read(text, new Map([[shaOf(PHOTO), dataUrlOf(PHOTO)]]));
        expect(Object.values(withIt.persons).find(p => p.firstName === 'Velimír')?.photo).toBe(dataUrlOf(PHOTO));
    });

    it('images not taken: the file by reference without its images is the whole file with media stripped', () => {
        expect(comparable(stripMedia(read(SLIM)))).toEqual(comparable(stripMedia(read(FULL))));
    });

    it('the files that leave the app carry the images in them, never a reference', () => {
        const data = read(SLIM, ALL_IMAGES);
        const ged = exportToGedcom(data, 'Šťovíčkovi').content;
        const sync = researchGedcom(data, 'Šťovíčkovi', { id: UUID }, 'line');
        for (const text of [ged, sync]) {
            expect(text).not.toContain('strom-image:');
            // Each excerpt as the data URL it came as (CONC-wrapped like the research's own file).
            const back = read(text);
            const urls = Object.values(back.sources!).flatMap(s => s.excerpts ?? []).map(e => e.dataUrl);
            expect(urls.sort()).toEqual([dataUrlOf(IMG_A), dataUrlOf(IMG_A), dataUrlOf(IMG_B), dataUrlOf(IMG_C)].sort());
            expect(Object.values(back.persons).find(p => p.firstName === 'Velimír')?.photo).toBe(dataUrlOf(PHOTO));
        }
    });
});

// ==================== THE BRIDGE ====================

interface Ask { shas: string[]; at: number }

/** A bridge's `POST /images` over `store` (sha → bytes). `cap`: images per answer (the rest `more`). */
function bridge(store: Map<string, Buffer>, o: {
    cap?: number;
    /** Each ask answered by this first, when it returns something. */
    fault?: (n: number, shas: string[]) => Response | Error | null | undefined;
    /** The bytes sent for a hash (a wrong picture). */
    corrupt?: (sha: string, n: number) => Buffer | null;
} = {}) {
    const asks: Ask[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const deps: ImageFetchDeps = {
        fetch: async (url, init) => {
            expect(url).toBe('http://127.0.0.1:5994/abc/images');
            expect(init.method).toBe('POST');
            const shas = (JSON.parse(String(init.body)) as { images: string[] }).images;
            expect(shas.length).toBeGreaterThan(0);
            expect(shas.length).toBeLessThanOrEqual(IMAGE_BATCH);
            const n = asks.length;
            asks.push({ shas, at: n });
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(r => setTimeout(r, 1));
            inFlight--;
            const fault = o.fault?.(n, shas);
            if (fault instanceof Error) throw fault;
            if (fault) return fault;
            const images: { sha: string; mime: string; bytes: number; data: string }[] = [];
            const missing: string[] = [];
            const more: string[] = [];
            for (const sha of shas) {
                const bytes = store.get(sha.toLowerCase());
                if (!bytes) missing.push(sha);
                else if (images.length >= (o.cap ?? Infinity)) more.push(sha);
                else {
                    const sent = o.corrupt?.(sha, n) ?? bytes;
                    images.push({ sha, mime: 'image/jpeg', bytes: sent.length, data: sent.toString('base64') });
                }
            }
            return new Response(JSON.stringify({ images, missing, more }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
        sha256Hex,
        sleep: async (ms) => { sleeps.push(ms); },
    };
    const sleeps: number[] = [];
    return { deps, asks, sleeps, maxInFlight: () => maxInFlight };
}

const URL_IMAGES = 'http://127.0.0.1:5994/abc/images';
const refOf = (b: Buffer): ImageRef => ({ sha: shaOf(b), mime: 'image/jpeg' });
const many = (n: number): Buffer[] => Array.from({ length: n }, (_, i) => jpeg(10 + (i % 50), 10, 100 + i));
const storeOf = (imgs: Buffer[]): Map<string, Buffer> => new Map(imgs.map(b => [shaOf(b), b]));

describe('the images from the bridge', () => {
    it('asks at most 500 at once, two asks at a time, follows `more` and checks every image', async () => {
        const imgs = many(1203);
        const b = bridge(storeOf(imgs), { cap: 200 });
        const got = await fetchImagesByHash(URL_IMAGES, imgs.map(refOf), b.deps);
        expect(got.size).toBe(1203);
        for (const img of imgs) expect(got.get(shaOf(img))).toBe(dataUrlOf(img));
        expect(b.asks.slice(0, 3).map(a => a.shas.length)).toEqual([500, 500, 203]);
        expect(b.maxInFlight()).toBe(2);
        // Every hash asked until it came; none after.
        const asked = b.asks.flatMap(a => a.shas);
        expect(new Set(asked).size).toBe(1203);
        expect(b.asks.length).toBeGreaterThan(3);
    });

    it('a network error, a 5xx and an answer cut short are asked again after a wait', async () => {
        const imgs = many(3);
        const b = bridge(storeOf(imgs), {
            fault: n => n === 0 ? new TypeError('Failed to fetch')
                : n === 1 ? new Response('busy', { status: 503 })
                    : n === 2 ? new Response('{"images":[{"sha":"', { status: 200 }) : null,
        });
        const got = await fetchImagesByHash(URL_IMAGES, imgs.map(refOf), b.deps);
        expect(got.size).toBe(3);
        expect(b.sleeps).toEqual(IMAGE_RETRY_MS.slice(0, 3));
    });

    it('gives up after its retries (the load then takes the whole file)', async () => {
        const b = bridge(storeOf(many(2)), { fault: () => new Response('down', { status: 502 }) });
        await expect(fetchImagesByHash(URL_IMAGES, many(2).map(refOf), b.deps)).rejects.toThrow(ImagesNotResolved);
        expect(b.asks.length).toBe(IMAGE_RETRY_MS.length + 1);
    });

    it('a refusal (400, 404) is not asked again', async () => {
        for (const status of [400, 404]) {
            const b = bridge(storeOf(many(2)), { fault: () => new Response('{}', { status }) });
            await expect(fetchImagesByHash(URL_IMAGES, many(2).map(refOf), b.deps)).rejects.toThrow(ImagesNotResolved);
            expect(b.asks.length).toBe(1);
        }
    });

    it('one the bridge does not have (`missing`): nothing taken', async () => {
        const imgs = many(3);
        const b = bridge(storeOf(imgs.slice(0, 2)));
        await expect(fetchImagesByHash(URL_IMAGES, imgs.map(refOf), b.deps)).rejects.toThrow(/not at the bridge/);
    });

    it('bytes that do not give their hash are asked once more, then given up', async () => {
        const imgs = many(2);
        const target = shaOf(imgs[1]);
        const once = bridge(storeOf(imgs), { corrupt: (sha, n) => sha === target && n === 0 ? IMG_C : null });
        const got = await fetchImagesByHash(URL_IMAGES, imgs.map(refOf), once.deps);
        expect(got.get(target)).toBe(dataUrlOf(imgs[1]));
        expect(once.asks.map(a => a.shas)).toEqual([imgs.map(shaOf), [target]]);
        // Never anything under a hash its bytes do not give.
        expect([...got.values()]).not.toContain(dataUrlOf(IMG_C));

        const always = bridge(storeOf(imgs), { corrupt: sha => sha === target ? IMG_C : null });
        await expect(fetchImagesByHash(URL_IMAGES, imgs.map(refOf), always.deps)).rejects.toThrow(/does not give its hash/);
    });

    it('an image not asked for is never taken; one never answered fails', async () => {
        const imgs = many(2);
        const b = bridge(storeOf(imgs), {
            fault: () => new Response(JSON.stringify({
                images: [{ sha: shaOf(IMG_C), mime: 'image/jpeg', data: IMG_C.toString('base64') },
                    { sha: shaOf(imgs[0]), mime: 'image/jpeg', data: imgs[0].toString('base64') }],
                missing: [], more: [],
            }), { status: 200 }),
        });
        await expect(fetchImagesByHash(URL_IMAGES, imgs.map(refOf), b.deps)).rejects.toThrow(/not answered/);
    });

    it('a type other than the file says, or not an image, is refused', async () => {
        const imgs = many(1);
        const b = bridge(storeOf(imgs), {
            fault: () => new Response(JSON.stringify({ images: [{ sha: shaOf(imgs[0]), mime: 'text/html', data: imgs[0].toString('base64') }], missing: [], more: [] }), { status: 200 }),
        });
        await expect(fetchImagesByHash(URL_IMAGES, imgs.map(refOf), b.deps)).rejects.toThrow(/unexpected type/);
    });
});

describe('images already held are never asked again', () => {
    const resolveDeps = (b: ReturnType<typeof bridge>, tree: string[] = [], hashed: string[] = []): ImageResolveDeps => ({
        ...b.deps,
        sha256Hex: async bytes => { hashed.push('x'); return sha256Hex(bytes); },
        treeImages: async () => tree,
    });

    it('a first load fetches them all; the next file fetches only its new image', async () => {
        const store = storeOf([IMG_A, IMG_B, IMG_C]);
        const b = bridge(store);
        const refs = findImageRefs(SLIM);
        const first = await resolveImageRefs({ researchId: UUID, refs, imagesUrl: URL_IMAGES }, resolveDeps(b));
        expect(first).toMatchObject({ held: 0, seeded: 0, fetched: 3 });
        expect(first.images).toEqual(ALL_IMAGES);
        // The same file again (a live change of a fact): nothing asked, nothing hashed.
        const hashed: string[] = [];
        const again = await resolveImageRefs({ researchId: UUID.toUpperCase(), refs, imagesUrl: URL_IMAGES }, resolveDeps(b, [], hashed));
        expect(again).toMatchObject({ held: 3, seeded: 0, fetched: 0 });
        expect(hashed).toEqual([]);
        expect(b.asks.length).toBe(1);
        // The same strings: the tree and what is held share them.
        expect(again.images.get(shaOf(IMG_A))).toBe(first.images.get(shaOf(IMG_A)));
        // A new excerpt: exactly that one image asked.
        const IMG_D = jpeg(90, 90, 4);
        store.set(shaOf(IMG_D), IMG_D);
        const more = await resolveImageRefs({ researchId: UUID, refs: [...refs, refOf(IMG_D)], imagesUrl: URL_IMAGES }, resolveDeps(b));
        expect(more).toMatchObject({ held: 3, fetched: 1 });
        expect(b.asks[1].shas).toEqual([shaOf(IMG_D)]);
        // Held: exactly the last file's images (one dropped is not kept).
        await resolveImageRefs({ researchId: UUID, refs: [refOf(IMG_D)], imagesUrl: URL_IMAGES }, resolveDeps(b));
        expect(heldImageShas(UUID)).toEqual([shaOf(IMG_D)]);
    });

    it('a new session: the stored tree\'s images are found by their hash, none downloaded', async () => {
        const b = bridge(storeOf([IMG_A, IMG_B, IMG_C]));
        const tree = [dataUrlOf(PHOTO), dataUrlOf(IMG_C), dataUrlOf(IMG_A), dataUrlOf(IMG_B), 'data:image/jpeg;base64,!!'];
        const got = await resolveImageRefs({ researchId: UUID, refs: findImageRefs(SLIM), imagesUrl: URL_IMAGES }, resolveDeps(b, tree));
        expect(got).toMatchObject({ held: 0, seeded: 3, fetched: 0 });
        expect(b.asks.length).toBe(0);
        // The tree's own strings.
        expect(got.images.get(shaOf(IMG_A))).toBe(tree[2]);
        // Another research: its tree, not this one's images.
        forgetHeldImages();
        const other = await resolveImageRefs({ researchId: 'f'.repeat(8), refs: [refOf(IMG_A)], imagesUrl: URL_IMAGES }, resolveDeps(b, []));
        expect(other).toMatchObject({ seeded: 0, fetched: 1 });
    });

    it('a tree holding only some: the rest downloaded', async () => {
        const b = bridge(storeOf([IMG_A, IMG_B, IMG_C]));
        const got = await resolveImageRefs({ researchId: UUID, refs: findImageRefs(SLIM), imagesUrl: URL_IMAGES }, resolveDeps(b, [dataUrlOf(IMG_B)]));
        expect(got).toMatchObject({ seeded: 1, fetched: 2 });
        expect(b.asks[0].shas.sort()).toEqual([shaOf(IMG_A), shaOf(IMG_C)].sort());
    });

    it('failing keeps nothing new and says so (the caller loads the whole file)', async () => {
        const b = bridge(storeOf([IMG_A]));
        await expect(resolveImageRefs({ researchId: UUID, refs: findImageRefs(SLIM), imagesUrl: URL_IMAGES }, resolveDeps(b))).rejects.toThrow(ImagesNotResolved);
        expect(heldImageShas(UUID)).toEqual([]);
    });
});

describe('the tag of a variant (ETag)', () => {
    const link = (variant?: 'ref') => ({
        fingerprint: 'fp1', head: 'h1',
        treeEtag: { tag: '"abc"', head: 'h1', fingerprint: 'fp1', images: true, ...(variant ? { variant } : {}) },
    });
    it('a tag is sent only with an ask of the variant it was given for', () => {
        expect(storedTreeEtag(link(), 'fp1', true)).toBe('"abc"');
        expect(storedTreeEtag(link(), 'fp1', true, 'data')).toBe('"abc"');
        expect(storedTreeEtag(link(), 'fp1', true, 'ref')).toBeNull();
        expect(storedTreeEtag(link('ref'), 'fp1', true, 'ref')).toBe('"abc"');
        expect(storedTreeEtag(link('ref'), 'fp1', true, 'data')).toBeNull();
        expect(storedTreeEtag(link('ref'), 'fp1', true)).toBeNull();
    });

    it('the feature and the header that says which file came', () => {
        expect(bridgeGivesImagesByHash(['ged.etag', 'ged.imagesByHash'])).toBe(true);
        expect(bridgeGivesImagesByHash(['ged.etag'])).toBe(false);
        expect(bridgeGivesImagesByHash(null)).toBe(false);
        expect(treeReplyImages(() => 'ref')).toBe('ref');
        expect(treeReplyImages(() => ' DATA ')).toBe('data');
        expect(treeReplyImages(() => null)).toBeNull();
        expect(treeReplyImages(() => { throw new Error('not exposed'); })).toBeNull();
    });
});
