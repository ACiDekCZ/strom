/**
 * The files of a tree holding pooled images are written with each image
 * read as the file is written (spec 135, part D10c): the JSON file, the open
 * tree's and the view's JSON, the working file, every file of all trees and
 * the saved app (one tree, all trees, a branch) are byte for byte the files
 * of the tree with its images expanded — the JSON's escaping, the inline
 * script's escaping ('<', U+2028), a missing image empty, a reference as a
 * key left alone — and no read of the pool asks for more than a few images
 * (the tree is never expanded whole). The saved app's share baseline keeps
 * its images whole. The pool is StorageManager.getMany over a Map; the data
 * invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../settings.js', async (orig) => {
    const real = await orig<typeof import('../settings.js')>();
    return { ...real, SettingsManager: Object.assign(Object.create(Object.getPrototypeOf(real.SettingsManager)), real.SettingsManager, { isEncryptionEnabled: () => false }) };
});

import { StorageManager } from '../storage.js';
import { expandedData } from '../image-expand.js';
import { jsonFileWithImages, htmlFileWithImages, countPoolRefs, scriptSafeJson, IMAGES_PER_READ } from '../image-stream.js';
import { POOL_REF } from '../image-ref.js';
import { noteOwnImages, clearImageMeta } from '../image-meta.js';
import { DataManager, storedTreeForExport } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AppExporter, jsonForScript, injectBeforeHeadEnd } from '../export.js';
import { applyLivingPrivacy, applyContentOptions } from '../privacy.js';
import { extractSubtree } from '../subtree.js';
import { importExportMethods } from '../ui/import-export.js';
import type { StromData, TreeId, PersonId } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';
import { IMAGE_SCRIPT_OPEN, SPLIT_IMAGES_FROM, IMAGE_SCRIPT_CHARS, restoreWindowImages } from '../embedded-images.js';
import { readEmbeddedHtml } from '../backup-formats.js';

// ---- the pool ----

const media = new Map<string, unknown>();
/** The ids each read of the image store asked for. */
let readSizes: number[] = [];

function jpegBytes(seed: number, n = 1200): Uint8Array {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 17 + seed * 13) & 0xFF;
    b[0] = 0xFF; b[1] = 0xD8; b[n - 2] = 0xFF; b[n - 1] = 0xD9;
    return b;
}

const HEAD = 'data:image/jpeg;base64,';
const idOf = (seed: number) => 'p:' + (seed + 0x100).toString(16).padStart(4, '0').repeat(10);

/** An image put into the pool as the pool stores it: its data URL and its reference. */
function pooled(seed: number): { url: string; ref: string; id: string } {
    const bytes = jpegBytes(seed);
    const id = idOf(seed);
    media.set(id, { head: HEAD, bytes: bytes.slice().buffer });
    noteOwnImages({ [id]: bytes.length });
    return { url: HEAD + Buffer.from(bytes).toString('base64'), ref: POOL_REF + id, id };
}

/** An image the pool keeps as text: an SVG data URL with what JSON and an inline script escape. */
function pooledSvg(seed: number): { url: string; ref: string; id: string } {
    const url = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><text>\\ \u2028 \u2029 </script> ${seed}</text></svg>`;
    const id = idOf(seed);
    media.set(id, { text: url });
    return { url, ref: POOL_REF + id, id };
}

beforeEach(() => {
    media.clear();
    readSizes = [];
    clearImageMeta();
    vi.spyOn(StorageManager, 'getMany').mockImplementation(async (store: string, keys: string[]) => {
        if (store === 'media') readSizes.push(keys.length);
        return new Map(keys.map(k => [k, store === 'media' ? structuredClone(media.get(k) ?? null) : null])) as never;
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const person = (id: string, extra: Record<string, unknown> = {}) => ({
    id, firstName: id[0].toUpperCase() + id.slice(1), lastName: 'Quellmatter', gender: 'female',
    isPlaceholder: false, partnerships: [] as string[], parentIds: [] as string[], childIds: [] as string[],
    birthDate: '1850', deathDate: '1910', ...extra,
});

const IMAGES = 21;

/**
 * A tree with more images than one read takes: portraits, a couple's photo,
 * attachments (one image twice), an excerpt; an SVG kept as text; a
 * reference the pool lacks; text that only looks like a reference.
 */
function treeWithRefs(): { data: StromData; urls: string[] } {
    const imgs = Array.from({ length: IMAGES }, (_, i) => (i === 5 ? pooledSvg(i) : pooled(i)));
    const persons: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) persons[`p${i}`] = person(`p${i}`, { photo: imgs[i].ref, note: i === 3 ? `"${imgs[0].ref}x" and ${imgs[1].ref.slice(1)}` : 'é ✓ 𝄞' });
    persons.p0 = { ...(persons.p0 as object), partnerships: ['u1'] };
    persons.p1 = { ...(persons.p1 as object), partnerships: ['u1'], gender: 'male' };
    const mediaRec: Record<string, unknown> = {};
    for (let i = 12; i < IMAGES - 1; i++) mediaRec[`m${i}`] = { id: `m${i}`, dataUrl: imgs[i].ref, name: `scan-${i}.jpg`, mimeType: 'image/jpeg', sizeBytes: 900, places: [{ personId: 'p2' }] };
    // The same image twice, and one the pool does not have.
    mediaRec.m98 = { id: 'm98', dataUrl: imgs[12].ref, name: 'again.jpg', mimeType: 'image/jpeg', sizeBytes: 900, places: [{ personId: 'p4' }] };
    mediaRec.m99 = { id: 'm99', dataUrl: POOL_REF + 'p:' + 'ab'.repeat(20), name: 'gone.jpg', mimeType: 'image/jpeg', sizeBytes: 900, places: [{ personId: 'p4' }] };
    const data = {
        version: STROM_DATA_VERSION,
        persons,
        partnerships: { u1: { id: 'u1', person1Id: 'p1', person2Id: 'p0', childIds: [], status: 'married', photo: imgs[IMAGES - 1].ref } },
        media: mediaRec,
        sources: { s1: { id: 's1', title: 'Kirchenbuch', excerpts: [{ id: 'e1', dataUrl: imgs[13].ref }] } },
    } as unknown as StromData;
    return { data, urls: imgs.map(i => i.url) };
}

function expectNoRef(text: string): void {
    expect(text).not.toMatch(/"\\u0000sm:[pe]:[0-9a-f]{40}"/);
    expect(text).not.toContain('data-pool-ref');
}

function expectFewPerRead(): void {
    expect(readSizes.length).toBeGreaterThan(0);
    expect(Math.max(...readSizes)).toBeLessThanOrEqual(IMAGES_PER_READ);
}

// ==================== the writer ====================

describe('jsonFileWithImages', () => {
    it('byte for byte the JSON of the expanded copy, read a few images at a time', async () => {
        const { data, urls } = treeWithRefs();
        const expected = JSON.stringify(await expandedData(data), null, 2);
        readSizes = [];
        const file = await jsonFileWithImages(data, { indent: 2 });
        const text = await file.blob.text();
        expect(text).toBe(expected);
        expect(file.blob.type).toBe('application/json');
        expect(file.missing).toBe(1);
        for (const url of urls) expect(JSON.stringify(JSON.parse(text))).toContain(JSON.stringify(url).slice(1, -1));
        expectNoRef(text.replace(/"note": "[^\n]*/g, ''));
        expectFewPerRead();
        // The text only looking like a reference stays as it was.
        expect(JSON.parse(text).persons.p3.note).toBe((data.persons as unknown as Record<string, { note: string }>).p3.note);
    });

    it('compact, and as an inline script embeds it: the same as the expanded copy\'s', async () => {
        const { data } = treeWithRefs();
        const full = await expandedData(data);
        expect(await (await jsonFileWithImages(data)).blob.text()).toBe(JSON.stringify(full));
        const script = await (await jsonFileWithImages(data, { script: true })).blob.text();
        expect(script).toBe(jsonForScript(full));
        expect(script).not.toContain('</script>');
        expect(script).not.toContain('\u2028');
    });

    it('a reference as a key stays a key; data without a reference written at once, nothing read', async () => {
        const a = pooled(40);
        const value = { [a.ref]: 'key', photo: a.ref };
        expect(countPoolRefs(value)).toBe(1);
        expect(await (await jsonFileWithImages(value)).blob.text()).toBe(JSON.stringify(await expandedData(value)));
        readSizes = [];
        const plain = { persons: { x: { photo: HEAD + 'AAAA' } } };
        expect(await (await jsonFileWithImages(plain, { indent: 2 })).blob.text()).toBe(JSON.stringify(plain, null, 2));
        expect(readSizes).toEqual([]);
    });

    it('taken at the call: a change of the data while the images are read does not reach the file', async () => {
        const { data } = treeWithRefs();
        const expected = JSON.stringify(await expandedData(data), null, 2);
        const pending = jsonFileWithImages(data, { indent: 2 });
        (data.persons as unknown as Record<string, { firstName: string }>).p0.firstName = 'Changed';
        expect(await (await pending).blob.text()).toBe(expected);
    });
});

describe('htmlFileWithImages', () => {
    it('the page with the script before </head>, as injectBeforeHeadEnd writes it with the images whole; no </head>: the page as it is', async () => {
        const { data } = treeWithRefs();
        const html = '<html><head><title>x</title></head><body><script>var s="\\u0000sm:"</script></body></html>';
        const script = (v: unknown) => `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript(v)};<\/script>`;
        const expected = injectBeforeHeadEnd(html, script(await expandedData({ data })));
        readSizes = [];
        const file = await htmlFileWithImages(html, { data }, script);
        expect(await file.blob.text()).toBe(expected);
        expect(file.blob.type).toBe('text/html');
        expectFewPerRead();
        expect(await (await htmlFileWithImages('<p>none</p>', { data }, script)).blob.text()).toBe('<p>none</p>');
        expect(scriptSafeJson('"<\u2028"')).toBe('"\\u003c\\u2028"');
    });

    it('images past SPLIT_IMAGES_FROM characters (1127): the data script holds their places, the images follow in scripts of their own; the page and an import put them back as the expanded tree', async () => {
        // A script longer than the browser's longest string (about 512 million characters) never runs: the app opened empty.
        expect(SPLIT_IMAGES_FROM + 2 * IMAGE_SCRIPT_CHARS).toBeLessThan(2 ** 29 - 24);
        vi.stubGlobal('__STROM_SPLIT_IMAGES_FROM', 1);
        vi.stubGlobal('__STROM_IMAGE_SCRIPT_CHARS', 4000);
        const { data } = treeWithRefs();
        const html = '<html><head><title>x</title></head><body><script>var s="\\u0000sm:"</script></body></html>';
        const script = (v: unknown) => `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript(v)};<\/script>`;
        const whole = await expandedData({ data });
        readSizes = [];
        const file = await htmlFileWithImages(html, { data }, script);
        const text = await file.blob.text();
        expectFewPerRead();
        expect(file.missing).toBe(1);
        const at = text.indexOf('<script>window.STROM_EMBEDDED_DATA');
        const dataScript = text.slice(at, text.indexOf('</script>', at));
        expect(dataScript).not.toContain('data:image');
        expect(dataScript).toContain('"\\u0000si:0"');
        expectNoRef(text);
        // Several image scripts after the data script, all in the head; the page's own code as it was.
        expect(text.split(IMAGE_SCRIPT_OPEN).length - 1).toBeGreaterThan(2);
        expect(text.indexOf(IMAGE_SCRIPT_OPEN)).toBeGreaterThan(at);
        expect(text.lastIndexOf(IMAGE_SCRIPT_OPEN)).toBeLessThan(text.indexOf('</head>'));
        expect(text.endsWith('</head><body><script>var s="\\u0000sm:"</script></body></html>')).toBe(true);
        // An import of the file.
        expect(readEmbeddedHtml(text).envelope).toEqual(whole);
        // The page: its scripts run as the browser runs them, then the app puts the images back.
        const win: Record<string, unknown> = {};
        vi.stubGlobal('window', win);
        for (const m of text.matchAll(/<script>(window\.STROM_EMBEDDED_[\s\S]*?)<\/script>/g)) new Function('window', m[1])(win);
        restoreWindowImages();
        expect(win.STROM_EMBEDDED_DATA).toEqual(whole);
        expect('STROM_EMBEDDED_IMAGES' in win).toBe(false);
    });
});

// ==================== the outputs ====================

describe('the files of a tree holding references: as from the expanded tree, a few images read at a time', () => {
    const TREE = 'd10c-tree' as TreeId;
    let downloads: Blob[];

    beforeEach(() => {
        downloads = [];
        vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue(null);
        vi.spyOn(TreeManager, 'getTrees').mockReturnValue([{ id: TREE, name: 'Quellmatter' }] as never);
        vi.spyOn(TreeManager, 'getActiveTreeId').mockReturnValue(TREE);
        vi.spyOn(TreeManager, 'noteFileCopy').mockImplementation(() => {});
        vi.spyOn(TreeManager, 'setLastExportId').mockImplementation(() => {});
        vi.stubGlobal('document', { createElement: () => ({ click() {}, href: '', download: '' }) });
        vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { downloads.push(b as Blob); return 'blob:x'; });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    function stored(): StromData {
        const { data } = treeWithRefs();
        vi.spyOn(TreeManager, 'getTreeData').mockImplementation(async () => structuredClone(data));
        return data;
    }

    it('the JSON file (with content left out too), the working file, every tree\'s JSON', async () => {
        stored();
        const whole = (await storedTreeForExport(TREE))!;
        readSizes = [];
        await DataManager.exportTreeJSON(TREE);
        expect(await downloads[0].text()).toBe(JSON.stringify(applyContentOptions(applyLivingPrivacy(whole, 'full'), false), null, 2));
        expectFewPerRead();
        const content = { photos: false, attachments: true, notes: true, sources: true };
        await DataManager.exportTreeJSON(TREE, null, 'initials', content);
        expect(await downloads[1].text()).toBe(JSON.stringify(applyContentOptions(applyLivingPrivacy(whole, 'initials'), content), null, 2));
        readSizes = [];
        expect(await DataManager.buildAttachedFileJson(TREE)).toBe(JSON.stringify(whole, null, 2));
        expectFewPerRead();
        readSizes = [];
        await importExportMethods.downloadAllTreesJson.call(importExportMethods as never, null, false, 'full', { photos: true, attachments: true, notes: true, sources: true });
        expect(await downloads[2].text()).toBe(JSON.stringify({ [TREE]: { name: 'Quellmatter', data: applyContentOptions(applyLivingPrivacy(whole, 'full'), { photos: true, attachments: true, notes: true, sources: true }) } }, null, 2));
        expectFewPerRead();
    });

    it('the open tree\'s JSON and the view\'s JSON; the tree in memory keeps its references', async () => {
        const { data } = treeWithRefs();
        (DataManager as unknown as { data: StromData }).data = structuredClone(data);
        const whole = await expandedData(data);
        readSizes = [];
        await DataManager.exportJSON();
        expect(await downloads[0].text()).toBe(JSON.stringify(applyContentOptions(applyLivingPrivacy(whole, 'full'), false), null, 2));
        expectFewPerRead();
        const ids = new Set(['p0', 'p1', 'p2'] as PersonId[]);
        await DataManager.exportFocusedJSON(ids);
        const slice = applyContentOptions(applyLivingPrivacy({ version: STROM_DATA_VERSION, ...extractSubtree(whole, ids) }, 'full'), false);
        expect(await downloads[1].text()).toBe(JSON.stringify(slice, null, 2));
        expect(DataManager.getData().persons['p0' as PersonId].photo).toMatch(/^\u0000sm:/);
    });

    it('the saved app (one tree, all trees, a branch): its data as the expanded tree\'s; the share baseline with the images whole', async () => {
        stored();
        const whole = (await storedTreeForExport(TREE))!;
        const exporter = AppExporter as unknown as { isBuiltVersion(): boolean; getExportHtml(): string; downloadHtml(html: string | Blob, name: string): void };
        const files: (string | Blob)[] = [];
        vi.spyOn(exporter, 'isBuiltVersion').mockReturnValue(true);
        vi.spyOn(exporter, 'getExportHtml').mockReturnValue('<html><head></head><body></body></html>');
        vi.spyOn(exporter, 'downloadHtml').mockImplementation((html: string | Blob) => { files.push(html); });
        const baselines: string[] = [];
        vi.spyOn(StorageManager, 'set').mockImplementation(async (store: string, _k: unknown, rec: unknown) => {
            if (store === 'shareBaselines') baselines.push((rec as { plain: string }).plain);
        });
        vi.spyOn(StorageManager, 'getAll').mockResolvedValue([] as never);
        readSizes = [];
        await AppExporter.exportApp(TREE);
        await AppExporter.exportAllAsApp();
        await AppExporter.exportFocusAsApp(treeWithRefs().data, 'branch.html', null, 'full', false, { trackTreeId: TREE });
        expect(files).toHaveLength(3);
        expect(files.every(f => f instanceof Blob)).toBe(true);
        expectFewPerRead();
        const texts = await Promise.all(files.map(f => (f as Blob).text()));
        const envelopeOf = (t: string) => JSON.parse(t.slice(t.indexOf(' = ') + 3).split(/;(?:window\.|<\/script>)/)[0]);
        const data = applyContentOptions(applyLivingPrivacy(whole, 'full'), false);
        const branch = applyContentOptions(applyLivingPrivacy(await expandedData(treeWithRefs().data), 'full'), false);
        const page = '<html><head></head><body></body></html>';
        // Each file as injectBeforeHeadEnd writes it from the expanded tree (its id and time as written).
        expect(texts[0]).toBe(injectBeforeHeadEnd(page, `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript({ ...envelopeOf(texts[0]), data })};<\/script>`));
        expect(texts[1]).toBe(injectBeforeHeadEnd(page, `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript({ ...envelopeOf(texts[1]), data })};`
            + `window.STROM_ALL_TREES = ${jsonForScript({ [TREE]: { name: 'Quellmatter', data } })};<\/script>`));
        expect(texts[2]).toBe(injectBeforeHeadEnd(page, `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript({ ...envelopeOf(texts[2]), data: branch })};<\/script>`));
        await vi.waitFor(() => expect(baselines).toHaveLength(2));
        expect(baselines[0]).toBe(JSON.stringify(data));
        expect(baselines[1]).toBe(JSON.stringify(branch));
    });
});
