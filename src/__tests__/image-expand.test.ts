/**
 * Every output carries its pooled images whole (spec 135, part D5a):
 * expandImages gives a copy of tree data with each `\u0000sm:` reference
 * replaced by the pool's data URL (read in batches, encrypted ones
 * decrypted; a missing one empty and counted; data without a reference the
 * same object, nothing read), expandImageText does it for HTML/SVG text; and
 * no output of a tree holding references — a JSON file (with a password
 * too), the working file, the saved app, a GEDCOM, the page files, a person
 * page, the book, the poster, the move to another browser, a change packet —
 * names a reference or `data-pool-ref`, its images byte for byte the ones
 * put into the pool. The pool is StorageManager.getMany over a Map; the data
 * invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../settings.js', async (orig) => {
    const real = await orig<typeof import('../settings.js')>();
    return { ...real, SettingsManager: Object.assign(Object.create(Object.getPrototypeOf(real.SettingsManager)), real.SettingsManager, { isEncryptionEnabled: () => false }) };
});

import { StorageManager } from '../storage.js';
import { CryptoSession, decrypt as decryptWith } from '../crypto.js';
import { expandImages, expandedData, expandImageText, hasPoolRefs } from '../image-expand.js';
import { POOL_REF, IMAGE_PLACEHOLDER, imageAddrAttr, turnedPoolRef } from '../image-ref.js';
import { noteOwnImages, clearImageMeta } from '../image-meta.js';
import { withExifOrientation } from '../excerpts.js';
import { DataManager, storedTreeForExport, storedTreeWithRefs } from '../data.js';
import { exportGedcomWithImages, gedcomText } from '../ged-export-images.js';
import { TreeManager } from '../tree-manager.js';
import { AppExporter } from '../export.js';
import { exportToGedcom } from '../ged-exporter.js';
import { buildTransferJson } from '../research-transfer.js';
import { buildChangePacket, isEmptyPacket } from '../share-diff.js';
import { buildFamilyBook } from '../book.js';
import { defaultBookOptions } from '../book-options.js';
import { escapeXml } from '../export-image.js';
import { buildPagesFile } from '../ui/family-pages-ui.js';
import { preparePersonPageData, buildPersonPageDocument, PERSON_PAGE_ALL_GROUPS, type PersonPageOptions } from '../person-page.js';
import type { StromData, TreeId, PersonId } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

// ---- the pool ----

const media = new Map<string, unknown>();
let reads = 0;

/** JPEG-looking bytes (SOI … EOI) of about `n` bytes, distinct per seed. */
function jpegBytes(seed: number, n = 1500): Uint8Array {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7) & 0xFF;
    b[0] = 0xFF; b[1] = 0xD8; b[n - 2] = 0xFF; b[n - 1] = 0xD9;
    return b;
}

const HEAD = 'data:image/jpeg;base64,';
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** An image put into the pool as the pool stores it: its data URL and its reference. */
function pooled(seed: number): { url: string; ref: string; id: string } {
    const bytes = jpegBytes(seed);
    const id = 'p:' + seed.toString(16).padStart(2, '0').repeat(20);
    media.set(id, { head: HEAD, bytes: bytes.slice().buffer });
    return { url: HEAD + b64(bytes), ref: POOL_REF + id, id };
}

beforeEach(() => {
    media.clear();
    reads = 0;
    clearImageMeta();
    vi.spyOn(StorageManager, 'getMany').mockImplementation(async (store: string, keys: string[]) => {
        reads++;
        return new Map(keys.map(k => [k, store === 'media' ? structuredClone(media.get(k) ?? null) : null])) as never;
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ---- a tree holding references ----

const person = (id: string, extra: Record<string, unknown> = {}) => ({
    id, firstName: id[0].toUpperCase() + id.slice(1), lastName: 'Zwirnhofer', gender: 'female',
    isPlaceholder: false, partnerships: [] as string[], parentIds: [] as string[], childIds: [] as string[],
    birthDate: '1850', deathDate: '1910', ...extra,
});

/** A tree with a person's, a couple's photo, an attachment and an excerpt as references (and the images they stand for). */
function treeWithRefs(): { data: StromData; urls: string[]; refs: string[] } {
    const a = pooled(1), b = pooled(2), c = pooled(3), d = pooled(4);
    const data = {
        version: STROM_DATA_VERSION,
        persons: {
            kunigunde: person('kunigunde', { photo: a.ref, partnerships: ['u1'], childIds: ['ottilie'] }),
            bartholomaeus: person('bartholomaeus', { gender: 'male', partnerships: ['u1'], childIds: ['ottilie'] }),
            ottilie: person('ottilie', { parentIds: ['kunigunde', 'bartholomaeus'], birthDate: '1880' }),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'bartholomaeus', person2Id: 'kunigunde', childIds: ['ottilie'], status: 'married', photo: b.ref },
        },
        media: { m1: { id: 'm1', dataUrl: c.ref, name: 'scan.jpg', mimeType: 'image/jpeg', sizeBytes: 1500, places: [{ personId: 'kunigunde' }] } },
        sources: { s1: { id: 's1', title: 'Matrika', excerpts: [{ id: 'e1', dataUrl: d.ref }] } },
    } as unknown as StromData;
    noteOwnImages({ [a.id]: 1500, [b.id]: 1500, [c.id]: 1500, [d.id]: 1500 });
    return { data, urls: [a.url, b.url, c.url, d.url], refs: [a.ref, b.ref, c.ref, d.ref] };
}

/** Text of an output: no reference, no placeholder of one; every image in it whole. */
function expectWhole(text: string, urls: readonly string[]): void {
    expect(text).not.toContain('\u0000sm:');
    expect(text).not.toContain('\\u0000sm:');
    expect(text).not.toContain('data-pool-ref');
    for (const url of urls) expect(text).toContain(url);
}

// ==================== expandImages ====================

describe('expandImages', () => {
    it('a copy with every reference replaced by the pool\'s data URL, byte for byte; the input as it was', async () => {
        const { data, urls, refs } = treeWithRefs();
        const before = JSON.stringify(data);
        const { data: out, missing } = await expandImages(data);
        expect(missing).toBe(0);
        expect(out).not.toBe(data);
        expect(out.persons['kunigunde' as PersonId].photo).toBe(urls[0]);
        expect(out.partnerships['u1' as never].photo).toBe(urls[1]);
        expect(out.media!['m1'].dataUrl).toBe(urls[2]);
        expect(out.sources!['s1'].excerpts![0].dataUrl).toBe(urls[3]);
        expect(JSON.stringify(data)).toBe(before);
        expect(data.persons['kunigunde' as PersonId].photo).toBe(refs[0]);
        // Strings shared, objects copied.
        expect(out.persons['ottilie' as PersonId].firstName).toBe(data.persons['ottilie' as PersonId].firstName);
        expect(out.persons['ottilie' as PersonId]).not.toBe(data.persons['ottilie' as PersonId]);
        expect(hasPoolRefs(out)).toBe(false);
        expect(hasPoolRefs(data)).toBe(true);
    });

    it('data without a reference: the same object, nothing read', async () => {
        const data = { persons: { a: person('a', { photo: HEAD + 'QUFB'.repeat(400) }) }, partnerships: {} } as unknown as StromData;
        const r = await expandImages(data);
        expect(r.data).toBe(data);
        expect(r.missing).toBe(0);
        expect(reads).toBe(0);
        expect(await expandedData(data)).toBe(data);
    });

    it('only a reference exactly as the pool writes one: a longer text, another syntax or a turned address stay text', async () => {
        const a = pooled(5);
        const data = { notes: [a.ref + ' x', POOL_REF + 'p:abc', turnedPoolRef(a.ref, 6)], photo: a.ref };
        const { data: out } = await expandImages(data);
        expect(out.notes).toEqual(data.notes);
        expect(out.photo).toBe(a.url);
    });

    it('a reference given alone: its image (a test reads one photo or one element\'s pooled image)', async () => {
        const a = pooled(9);
        expect(await expandImages(a.ref)).toEqual({ data: a.url, missing: 0 });
        expect(await expandedData(a.ref + ' x')).toBe(a.ref + ' x');
        expect(await expandedData(POOL_REF + 'p:' + 'dd'.repeat(20))).toBe('');
    });

    it('an image missing from the pool: empty text (the sanitizer drops it), counted once', async () => {
        const a = pooled(6);
        const gone = POOL_REF + 'p:' + 'ee'.repeat(20);
        const { data: out, missing } = await expandImages({ a: a.ref, b: gone, c: [gone] });
        expect(out).toEqual({ a: a.url, b: '', c: [''] });
        expect(missing).toBe(1);
    });

    it('an encrypted image: decrypted by the session; locked, it is missing; or by the decrypt given', async () => {
        const url = HEAD + b64(jpegBytes(7));
        const id = 'e:' + '77'.repeat(20);
        media.set(id, { encrypted: { v: 1, iv: 'x', data: 'sealed' } });
        const ref = POOL_REF + id;
        const unlocked = vi.spyOn(CryptoSession, 'isUnlocked').mockReturnValue(true);
        vi.spyOn(CryptoSession, 'decrypt').mockImplementation(async (enc: { data: string }) => enc.data === 'sealed' ? url : '');
        expect((await expandImages({ photo: ref })).data.photo).toBe(url);
        unlocked.mockReturnValue(false);
        expect(await expandImages({ photo: ref })).toEqual({ data: { photo: '' }, missing: 1 });
        expect((await expandImages({ photo: ref }, { decrypt: async () => url })).data.photo).toBe(url);
    });

    it('many images: read in batches, each once', async () => {
        const all = Array.from({ length: 150 }, (_, i) => pooled(i + 16));
        const data = { list: all.map(p => p.ref), again: all.map(p => p.ref) };
        const { data: out, missing } = await expandImages(data);
        expect(missing).toBe(0);
        expect(out.list).toEqual(all.map(p => p.url));
        expect(out.again).toEqual(all.map(p => p.url));
        expect(reads).toBe(3);
    });

    it('taken at the call: a change of the data while the images are read does not reach the copy', async () => {
        const a = pooled(8);
        const data: { photo: string; name: string } = { photo: a.ref, name: 'Ottilie' };
        const pending = expandImages(data);
        data.name = 'changed';
        expect((await pending).data).toEqual({ photo: a.url, name: 'Ottilie' });
    });
});

// ==================== expandImageText ====================

describe('expandImageText', () => {
    it('the placeholder with data-pool-ref, a reference in an attribute and one escaped in JSON: the images whole', async () => {
        const a = pooled(9), b = pooled(10), c = pooled(11);
        const html = `<img ${imageAddrAttr(a.ref)} alt=""><svg><image ${imageAddrAttr(b.ref, 'href')} x="1"/>`
            + `<image href="${escapeXml(c.ref)}"/></svg><script>var d=${JSON.stringify({ p: a.ref })}</script>`;
        const { data: out, missing } = await expandImageText(html);
        expect(missing).toBe(0);
        expectWhole(out, [a.url, b.url, c.url]);
        expect(out).toContain(`<img src="${a.url}" alt="">`);
        expect(out).toContain(`<image href="${b.url}" x="1"/>`);
        expect(out).toContain(`<image href="${c.url}"/>`);
        expect(JSON.parse(out.slice(out.indexOf('var d=') + 6, out.indexOf('</script>'))).p).toBe(a.url);
        expect(out).not.toContain(IMAGE_PLACEHOLDER);
    });

    it('a turned address: the image turned by its EXIF orientation; a missing one empty; text without any as it is', async () => {
        const a = pooled(12);
        const { data: out } = await expandImageText(`<img ${imageAddrAttr(turnedPoolRef(a.ref, 6))}>`);
        expect(out).toBe(`<img src="${withExifOrientation(a.url, 6)}">`);
        const gone = POOL_REF + 'p:' + 'ef'.repeat(20);
        expect(await expandImageText(`<img ${imageAddrAttr(gone)}>`)).toEqual({ data: '<img src="">', missing: 1 });
        const plain = '<img src="data:image/png;base64,AAAA">';
        expect((await expandImageText(plain)).data).toBe(plain);
        expect(reads).toBe(2);
    });
});

// ==================== the outputs ====================

describe('no output of a tree holding references names one; its images whole', () => {
    const TREE = 'd5a-tree' as TreeId;
    let downloads: Blob[];

    beforeEach(() => {
        downloads = [];
        vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue(null);
        vi.spyOn(TreeManager, 'getTrees').mockReturnValue([{ id: TREE, name: 'Zwirnhofer' }] as never);
        vi.spyOn(TreeManager, 'getActiveTreeId').mockReturnValue(TREE);
        vi.spyOn(TreeManager, 'noteFileCopy').mockImplementation(() => {});
        vi.spyOn(TreeManager, 'setLastExportId').mockImplementation(() => {});
        vi.stubGlobal('document', { createElement: () => ({ click() {}, href: '', download: '' }) });
        vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { downloads.push(b as Blob); return 'blob:x'; });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    /** The tree as storage gives it once images stay in the pool (135 D6): with references. */
    function storedWithRefs(): string[] {
        const { data, urls } = treeWithRefs();
        vi.spyOn(TreeManager, 'getTreeData').mockImplementation(async () => structuredClone(data));
        return urls;
    }

    /** The tree in memory with references. */
    function openWithRefs(): { data: StromData; urls: string[] } {
        const t = treeWithRefs();
        (DataManager as unknown as { data: StromData }).data = structuredClone(t.data);
        return t;
    }

    it('a stored tree for an output (every file of a stored tree starts here): the images whole, not one lost to the sanitizer', async () => {
        const urls = storedWithRefs();
        const out = await storedTreeForExport(TREE);
        expectWhole(JSON.stringify(out), urls);
        expect(out!.persons['kunigunde' as PersonId].photo).toBe(urls[0]);
    });

    it('the JSON file, and the one under a password', async () => {
        const urls = storedWithRefs();
        await DataManager.exportTreeJSON(TREE);
        expectWhole(await downloads[0].text(), urls);
        await DataManager.exportTreeJSON(TREE, 'heslo-1');
        const sealed = JSON.parse(await downloads[1].text());
        expectWhole(await decryptWith(sealed, 'heslo-1'), urls);
    });

    it('the working file (and so the copy of the file)', async () => {
        const urls = storedWithRefs();
        expectWhole(await DataManager.buildAttachedFileJson(TREE), urls);
    });

    it('the open tree\'s JSON and the view\'s JSON', async () => {
        const { urls } = openWithRefs();
        await DataManager.exportJSON();
        expectWhole(await downloads[0].text(), urls);
        await DataManager.exportFocusedJSON(new Set(['kunigunde', 'bartholomaeus', 'ottilie'] as PersonId[]));
        expectWhole(await downloads[1].text(), [urls[0], urls[1]]);
        // The tree in memory keeps its references.
        expect(DataManager.getData().persons['kunigunde' as PersonId].photo).toMatch(/^\u0000sm:/);
    });

    it('the saved app: one tree, all trees, a branch', async () => {
        const urls = storedWithRefs();
        const exporter = AppExporter as unknown as { isBuiltVersion(): boolean; getExportHtml(): string; downloadHtml(html: string | Blob, name: string): void };
        const files: (string | Blob)[] = [];
        vi.spyOn(exporter, 'isBuiltVersion').mockReturnValue(true);
        vi.spyOn(exporter, 'getExportHtml').mockReturnValue('<html><head></head><body></body></html>');
        vi.spyOn(exporter, 'downloadHtml').mockImplementation((html: string | Blob) => { files.push(html); });
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
        await AppExporter.exportApp(TREE);
        await AppExporter.exportAllAsApp();
        const { data } = treeWithRefs();
        await AppExporter.exportFocusAsApp(data, 'branch.html');
        const saved = await Promise.all(files.map(f => (typeof f === 'string' ? f : f.text())));
        expect(saved).toHaveLength(3);
        // jsonForScript writes "/" as "\/".
        for (const html of saved) expectWhole(html.replace(/\\\//g, '/'), urls);
    });

    it('a GEDCOM of a stored tree (the file, and the research\'s send built the same way): its images read as it is written (D10b)', async () => {
        const urls = storedWithRefs();
        const ged = gedcomText(await exportGedcomWithImages((await storedTreeWithRefs(TREE))!, 'Zwirnhofer'));
        expect(ged).toBe(exportToGedcom((await storedTreeForExport(TREE))!, 'Zwirnhofer').content);
        const joined = ged.replace(/\r?\n\d+ CONC /g, '');
        expect(joined).not.toContain('sm:p:');
        expect(joined).toContain(urls[0]);
        // Without the step the GEDCOM would hold slots for the images (what the research cannot read).
        const bare = exportToGedcom(treeWithRefs().data, 'Zwirnhofer').content.replace(/\r?\n\d+ CONC /g, '');
        expect(bare).not.toContain(urls[0]);
    });

    it('the move to another browser, a change packet against the shared copy', async () => {
        const { data, urls } = openWithRefs();
        const full = await expandedData(data);
        const transfer = buildTransferJson({ v: 1, token: 't'.repeat(16), from: 'chrome', tree: 'Z', persons: 3, at: '' }, full);
        expectWhole(transfer, urls);
        // The shared copy holds the images whole: an unchanged tree is no change (none named for its images).
        expect(isEmptyPacket(buildChangePacket(full, await expandedData(DataManager.getData()), { baseExportId: 'x', senderName: 'S' }))).toBe(true);
        expect(isEmptyPacket(buildChangePacket(full, DataManager.getData(), { baseExportId: 'x', senderName: 'S' }))).toBe(false);
    });

    it('the family pages file, as one page and as a set of files (the build takes the tree with references)', async () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', { styleSheets: [] });
        const { data, urls } = openWithRefs();
        const opts = { lang: 'en', privacy: 'full', photos: 'full', clips: 'full', now: new Date('2026-11-23T10:00:00Z') } as never;
        const job = { cancelled: false, paused: false };
        const html = await buildPagesFile(data, { kind: 'tree' } as never, opts, job, () => {});
        expect(typeof html.data).toBe('string');
        expectWhole(html.data as string, [urls[0]]);
        const zip = await buildPagesFile(data, { kind: 'tree' } as never, opts, job, () => {}, true);
        const bytes = Buffer.from(await (zip.data as Blob).arrayBuffer()).toString('latin1');
        expect(bytes).not.toContain('\u0000sm:');
        expect(bytes).not.toContain('data-pool-ref');
    });

    it('a saved person page from the expanded tree carries the photo; from the references it would not', async () => {
        const { data, urls } = openWithRefs();
        const op: PersonPageOptions = {
            personId: 'kunigunde' as PersonId, lang: 'en', mode: 'file', links: 'plain', groups: { ...PERSON_PAGE_ALL_GROUPS },
            privacy: 'full', toggles: { history: true, childEvents: true }, now: new Date('2026-11-23T10:00:00Z'),
        } as PersonPageOptions;
        expectWhole(buildPersonPageDocument(preparePersonPageData(await expandedData(data), op), op), [urls[0]]);
        expect(buildPersonPageDocument(preparePersonPageData(data, op), op)).not.toContain(urls[0]);
    });

    it('the book (window and saved file) from the expanded tree shows the photos the references stand for', async () => {
        const { data, urls } = openWithRefs();
        const options = { ...defaultBookOptions('en'), selection: { kind: 'tree' } } as never;
        const html = buildFamilyBook(await expandedData(data), options, { forSave: true });
        expectWhole(html, [urls[0]]);
        // Built from the references themselves it would leave them out.
        expect(buildFamilyBook(data, options, { forSave: true })).not.toContain(urls[0]);
    });
});
