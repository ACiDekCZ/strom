/**
 * A GEDCOM of a tree holding pooled image references (spec 135, part D10b):
 * the tree is never expanded; each image's FILE is written in its place a few
 * images at a time, and the text is byte for byte the GEDCOM of the tree with
 * its images expanded (CONC wrapping, FORM by the catalog, the portrait left
 * out of the attachments, media records, excerpts). An image the pool cannot
 * give: the export of the expanded tree, as before. A send to a research
 * takes a pooled image's hash from the catalog: the same `_STROM_DATA` as
 * from the expanded tree, nothing read from the pool for it.
 *
 * The pool is StorageManager.getMany over a Map; the data invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../settings.js', async (orig) => {
    const real = await orig<typeof import('../settings.js')>();
    return { ...real, SettingsManager: Object.assign(Object.create(Object.getPrototypeOf(real.SettingsManager)), real.SettingsManager, { isEncryptionEnabled: () => false }) };
});

import { StorageManager } from '../storage.js';
import { expandedData } from '../image-expand.js';
import { POOL_REF } from '../image-ref.js';
import { clearImageMeta, imageMetaOf } from '../image-meta.js';
import { ensureImageMeta } from '../media-pool.js';
import { exportToGedcom, FILE_SLOT, type GedcomExportOptions } from '../ged-exporter.js';
import { exportGedcomWithImages, gedcomText } from '../ged-export-images.js';
import { forgetMediaRefMemory, prepareMediaRef, SYNC_MEDIA_REF_FEATURE } from '../research-media-ref.js';
import { MEDIA_KNOWN_FEATURE } from '../batch.js';
import type { StromData } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

// ---- the pool ----

const media = new Map<string, unknown>();
let mediaReads: string[][] = [];

/** Image-looking bytes of `n` bytes, distinct per seed (JPEG or PNG signature). */
function imageBytes(seed: number, n: number, png = false): Uint8Array {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7 + (i >> 5)) & 0xFF;
    if (png) b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    else { b[0] = 0xFF; b[1] = 0xD8; b[n - 2] = 0xFF; b[n - 1] = 0xD9; }
    return b;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const shaOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface Img { url: string; ref: string; id: string; sha: string }

/** An image put into the pool as the pool stores it. Sizes give FILE lines of one, several and an exact number of CONC chunks. */
function pooled(seed: number, n = 1500, png = false): Img {
    const bytes = imageBytes(seed, n, png);
    const head = png ? 'data:image/png;base64,' : 'data:image/jpeg;base64,';
    const id = 'p:' + seed.toString(16).padStart(2, '0').repeat(20);
    media.set(id, { head, bytes: bytes.slice().buffer });
    return { url: head + b64(bytes), ref: POOL_REF + id, id, sha: shaOf(bytes) };
}

beforeEach(() => {
    media.clear();
    mediaReads = [];
    clearImageMeta();
    forgetMediaRefMemory();
    vi.spyOn(StorageManager, 'getMany').mockImplementation(async (store: string, keys: string[]) => {
        if (store === 'media') mediaReads.push([...keys]);
        return new Map(keys.map(k => [k, store === 'media' ? structuredClone(media.get(k) ?? null) : null])) as never;
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ---- a tree holding references ----

const person = (id: string, extra: Record<string, unknown> = {}) => ({
    id, firstName: id[0].toUpperCase() + id.slice(1), lastName: 'Quellenbach', gender: 'female',
    isPlaceholder: false, partnerships: [] as string[], parentIds: [] as string[], childIds: [] as string[],
    birthDate: '1850', deathDate: '1910', ...extra,
});

/**
 * Portraits (one also an attachment of its person), a couple's photo, an
 * attachment of two persons (a media record), one of a source, a PNG, an
 * excerpt, an image as a data URL beside the references, a file only by its
 * original, and notes wrapped with CONT around them.
 */
function treeWithRefs(): { data: StromData; imgs: Img[]; inline: string } {
    const imgs = [
        pooled(1, 1500), pooled(2, 150), pooled(3, 3000), pooled(4, 900, true),
        pooled(5, 2400), pooled(6, 600), pooled(7, 450), pooled(8, 4500),
    ];
    // 150 bytes = 200 base64 characters: a FILE of exactly one chunk with its head.
    const inline = 'data:image/jpeg;base64,' + b64(imageBytes(40, 1200));
    const [portrait, small, couple, png, shared, source, excerpt, big] = imgs;
    const data = {
        version: STROM_DATA_VERSION,
        persons: {
            kunigunde: person('kunigunde', { photo: portrait.ref, partnerships: ['u1'], childIds: ['ottilie'], notes: 'Erste Zeile\nZweite Zeile — 🌳 é 漢字' }),
            bartholomaeus: person('bartholomaeus', { gender: 'male', photo: small.ref, partnerships: ['u1'], childIds: ['ottilie'] }),
            ottilie: person('ottilie', { parentIds: ['kunigunde', 'bartholomaeus'], birthDate: '1880', photo: inline }),
            leopold: person('leopold', { gender: 'male', photo: big.ref }),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'bartholomaeus', person2Id: 'kunigunde', childIds: ['ottilie'], status: 'married', photo: couple.ref },
        },
        media: {
            m1: { id: 'm1', dataUrl: portrait.ref, name: 'portrait-copy.jpg', mimeType: 'image/jpeg', sizeBytes: 1500, places: [{ personId: 'kunigunde' }] },
            m2: { id: 'm2', dataUrl: shared.ref, name: 'wedding.jpg', title: 'Hochzeit', mimeType: 'image/jpeg', sizeBytes: 2400, places: [{ personId: 'kunigunde' }, { personId: 'bartholomaeus' }] },
            m3: { id: 'm3', dataUrl: png.ref, name: 'map.png', mimeType: 'image/png', sizeBytes: 900, places: [{ personId: 'ottilie' }] },
            m4: { id: 'm4', dataUrl: source.ref, name: 'page.jpg', mimeType: 'image/jpeg', sizeBytes: 600, places: [{ sourceId: 's1' }] },
            m5: { id: 'm5', dataUrl: '', originalOnly: true, name: 'scan.tif', mimeType: 'image/tiff', sizeBytes: 9000, original: { sha256: 'ab'.repeat(32), name: 'scan.tif', mimeType: 'image/tiff', sizeBytes: 9000 }, places: [{ personId: 'leopold' }] },
        },
        sources: {
            s1: { id: 's1', title: 'Taufbuch', note: 'Seite 12\nZeile 3', excerpts: [{ id: 'e1', dataUrl: excerpt.ref, caption: 'Eintrag' }, { id: 'e2', dataUrl: inline }] },
        },
    } as unknown as StromData;
    return { data, imgs, inline };
}

const OPTIONS: GedcomExportOptions[] = [
    {},
    { research: { id: '7e2b5c10-3a4d-4c8e-9f61-2d0a8b4e6c17', head: 'h-1', appTree: 't1' } },
    { content: { photos: false, attachments: true, notes: true, sources: true } },
];

async function expectedOf(data: StromData, options: GedcomExportOptions): Promise<ReturnType<typeof exportToGedcom>> {
    return exportToGedcom(await expandedData(data), 'Quellenbach', options);
}

describe('exportGedcomWithImages', () => {
    it('byte for byte the GEDCOM of the expanded tree (FILE wrapped in CONC, FORM, media records, excerpts), with every option', async () => {
        for (const options of OPTIONS) {
            const { data } = treeWithRefs();
            clearImageMeta();
            const expected = await expectedOf(data, options);
            const got = await exportGedcomWithImages(data, 'Quellenbach', options);
            expect(gedcomText(got)).toBe(expected.content);
            expect(new TextEncoder().encode(gedcomText(got))).toEqual(new TextEncoder().encode(expected.content));
            expect(got.stats).toEqual(expected.stats);
            expect(got.media).toEqual(expected.media);
            expect([...got.xrefs.persons]).toEqual([...expected.xrefs.persons]);
            expect(gedcomText(got)).not.toContain('\u0000');
        }
        // The tree is a real test of the slots: they are many, wrapped, and of all places.
        const { data, imgs } = treeWithRefs();
        const text = gedcomText(await exportGedcomWithImages(data, 'Quellenbach'));
        for (const img of imgs) expect(text.replace(/\n\d+ CONC /g, '')).toContain(img.url);
        expect(text).toMatch(/\n2 FORM png\n/);
        expect(text).toMatch(/\n0 @M\d+@ OBJE\n1 FILE data:image\/jpeg;base64,/);
        expect(text).toContain('\n2 CONT Zweite Zeile');
    });

    it('the portrait is not written again as its person\'s attachment (the same pooled image)', async () => {
        const { data, imgs } = treeWithRefs();
        const text = gedcomText(await exportGedcomWithImages(data, 'Quellenbach')).replace(/\n\d+ CONC /g, '');
        expect(text.split(imgs[0].url).length - 1).toBe(1);
    });

    it('the export itself writes a pooled image as its slot, never the reference in a FILE', () => {
        const { data, imgs } = treeWithRefs();
        const raw = exportToGedcom(data, 'Quellenbach').content;
        expect(raw).toContain(`\n${FILE_SLOT}2 ${imgs[0].ref}\n`);
        expect(raw).toMatch(new RegExp(`\\n0 @M\\d+@ OBJE\\n${FILE_SLOT}1 \\u0000sm:`));
        expect(raw).not.toMatch(/FILE \u0000sm:/);
    });

    it('reads a few images at a time, each slot once, never the whole tree at once', async () => {
        const { data, imgs } = treeWithRefs();
        for (let i = 0; i < 6; i++) {
            const img = pooled(60 + i, 300);
            imgs.push(img);
            data.persons[`extra${i}` as never] = person(`extra${i}`, { photo: img.ref }) as never;
        }
        await ensureImageMeta(imgs.map(i => i.id));
        mediaReads = [];
        await exportGedcomWithImages(data, 'Quellenbach');
        expect(mediaReads.length).toBeGreaterThan(1);
        for (const keys of mediaReads) expect(keys.length).toBeLessThanOrEqual(8);
        expect(mediaReads.flat().sort()).toEqual(imgs.map(i => i.id).sort());
    });

    it('a tree without references: as exportToGedcom, nothing read', async () => {
        const { data } = treeWithRefs();
        const whole = await expandedData(data);
        mediaReads = [];
        const got = await exportGedcomWithImages(whole, 'Quellenbach');
        expect(got.parts).toEqual([exportToGedcom(whole, 'Quellenbach').content]);
        expect(mediaReads).toEqual([]);
    });

    it('an image the pool does not have: the GEDCOM of the expanded tree, as before (the image left out)', async () => {
        const { data, imgs } = treeWithRefs();
        media.delete(imgs[2].id);
        const expected = await expectedOf(data, {});
        clearImageMeta();
        expect(gedcomText(await exportGedcomWithImages(data, 'Quellenbach'))).toBe(expected.content);
        // Gone from the pool after the catalog has its entry: the same.
        const again = treeWithRefs();
        await ensureImageMeta(again.imgs.map(i => i.id));
        media.delete(again.imgs[5].id);
        expect(gedcomText(await exportGedcomWithImages(again.data, 'Quellenbach'))).toBe((await expectedOf(again.data, {})).content);
    });

    it('taken at the call: a change of the tree while the images are read does not reach it', async () => {
        const { data } = treeWithRefs();
        const expected = (await expectedOf(data, {})).content;
        clearImageMeta();
        const running = exportGedcomWithImages(data, 'Quellenbach');
        data.persons['kunigunde' as never].firstName = 'Changed';
        delete data.persons['leopold' as never];
        expect(gedcomText(await running)).toBe(expected);
    });
});

// ==================== the send to a research ====================

describe('a send to a research: pooled images by the catalog\'s hash', () => {
    const FEATURES = [SYNC_MEDIA_REF_FEATURE, MEDIA_KNOWN_FEATURE];
    let asked: string[][];

    function bridge(held: ReadonlySet<string>): typeof fetch {
        return vi.fn(async (_url: string, init?: { body?: string }) => {
            const shas: string[] = JSON.parse(String(init?.body)).shas;
            asked.push(shas);
            return new Response(JSON.stringify({ known: Object.fromEntries(shas.map(s => [s, held.has(s) ? { id: 'I0001', kind: 'image', mime: 'image/jpeg', bytes: 10, here: true } : null])) }),
                { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as unknown as typeof fetch;
    }

    beforeEach(() => { asked = []; });

    it('the same _STROM_DATA and the same GEDCOM as from the expanded tree; the catalog\'s hashes asked, nothing read from the pool', async () => {
        const { data, imgs } = treeWithRefs();
        const held = new Set([imgs[0].sha, imgs[2].sha, imgs[4].sha, imgs[3].sha]);
        const options: GedcomExportOptions = { research: { id: 'r1', head: 'h-1', appTree: 't1' } };

        const whole = await expandedData(data);
        const refWhole = await prepareMediaRef({ researchId: 'r1', base: 'http://127.0.0.1:1/t', features: FEATURES, data: whole, fetchFn: bridge(held) });
        const expected = exportToGedcom(whole, 'Quellenbach', { ...options, mediaRef: refWhole });
        const askedWhole = asked.flat().sort();

        forgetMediaRefMemory();
        asked = [];
        await ensureImageMeta(imgs.map(i => i.id));
        expect(imageMetaOf(imgs[0].ref)?.sha).toBe(imgs[0].sha);
        mediaReads = [];
        const ref = await prepareMediaRef({ researchId: 'r1', base: 'http://127.0.0.1:1/t', features: FEATURES, data, fetchFn: bridge(held) });
        expect(mediaReads).toEqual([]);
        expect(asked.flat().sort()).toEqual(askedWhole);
        for (const img of [imgs[0], imgs[2], imgs[4]]) expect(ref!.dataSha(img.ref)).toBe(img.sha);
        expect(ref!.dataSha(imgs[1].ref)).toBeUndefined();

        const got = await exportGedcomWithImages(data, 'Quellenbach', { ...options, mediaRef: ref });
        expect(gedcomText(got)).toBe(expected.content);
        expect(got.media).toEqual(expected.media);
        expect(got.media.filesRef).toBeGreaterThan(0);
        expect(gedcomText(got)).toContain(`_STROM_DATA ${imgs[2].sha}`);
    });

    it('an image without a catalog entry: read for its hash as before (the same send)', async () => {
        const { data, imgs } = treeWithRefs();
        const held = new Set(imgs.map(i => i.sha));
        clearImageMeta();
        const ref = await prepareMediaRef({ researchId: 'r1', base: 'http://127.0.0.1:1/t', features: FEATURES, data, fetchFn: bridge(held) });
        for (const img of [imgs[0], imgs[1], imgs[2], imgs[3], imgs[4]]) expect(ref!.dataSha(img.ref)).toBe(img.sha);
        const whole = await expandedData(data);
        forgetMediaRefMemory();
        const refWhole = await prepareMediaRef({ researchId: 'r1', base: 'http://127.0.0.1:1/t', features: FEATURES, data: whole, fetchFn: bridge(held) });
        expect(gedcomText(await exportGedcomWithImages(data, 'Quellenbach', { mediaRef: ref })))
            .toBe(exportToGedcom(whole, 'Quellenbach', { mediaRef: refWhole }).content);
    });

    it('leaving the page (no time to ask): a pooled image goes by the catalog\'s hash the research said it has', async () => {
        const { data, imgs } = treeWithRefs();
        await ensureImageMeta(imgs.map(i => i.id));
        await prepareMediaRef({ researchId: 'r1', base: 'http://127.0.0.1:1/t', features: FEATURES, data, fetchFn: bridge(new Set([imgs[0].sha])) });
        const left = await prepareMediaRef({ researchId: 'r1', base: 'http://127.0.0.1:1/t', features: FEATURES, data, keepalive: true });
        expect(left!.dataSha(imgs[0].ref)).toBe(imgs[0].sha);
        expect(left!.dataSha(imgs[1].ref)).toBeUndefined();
    });
});
