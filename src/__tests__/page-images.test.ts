/**
 * The pooled images a page output shows (spec 135, page-images.ts): a saved
 * person page and the family pages' file (one HTML, a set of files) are
 * built from the tree with only their own images read from the pool, and
 * come out the same as from the tree with every image whole. In the app's
 * window the person page shows a pooled image by its reference (the
 * hydrator puts it in), a pooled PDF with the pages read from its bytes.
 * All data is invented.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const pool = new Map<string, string>();
const asked: string[][] = [];
vi.mock('../media-pool.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../media-pool.js')>()),
    loadImageUrls: async (ids: readonly string[]) => {
        asked.push([...ids].sort());
        return new Map(ids.filter(id => pool.has(id)).map(id => [id, pool.get(id)!]));
    },
}));

import { personPageImageIds, pageSetImageIds, withImagesWhole } from '../page-images.js';
import { POOL_REF, POOL_REF_ATTR } from '../image-ref.js';
import { withPoolRefsReplaced } from '../image-expand.js';
import { clearImageMeta, computeImageMeta, setImageMeta } from '../image-meta.js';
import {
    PERSON_PAGE_ALL_GROUPS, buildPersonPageBody, buildPersonPageDocument, pdfPageCount, preparePersonPageData,
    type PersonPageOptions,
} from '../person-page.js';
import { buildPageSet } from '../family-pages.js';
import { buildPageSetFilesAsync, buildPageSetHtmlAsync } from '../family-pages-html.js';
import { buildLineages, rods } from '../lineage.js';
import { CLIP_IMG, FP_NOW, familyPagesFixture } from './helpers/family-pages-fixture.js';
import type { Attachment, PartnershipId, PersonId, StromData } from '../types.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** A distinct small JPEG for each n (one quantization byte group changed). */
function jpeg(n: number): string {
    const out = CLIP_IMG.replace('ICIsIx', `IC${B64[n % 62]}${B64[Math.floor(n / 62) % 62]}Ix`);
    if (out === CLIP_IMG) throw new Error('jpeg: no place to vary');
    return out;
}
const pdf = (pages: number): string => `data:application/pdf;base64,${Buffer.from(
    `%PDF-1.4\n${Array.from({ length: pages }, (_, i) => `${i + 1} 0 obj<</Type /Page>>endobj\n`).join('')}%%EOF`).toString('base64')}`;
const PDF3 = pdf(3);

/**
 * The family pages' sample with an image on every person and couple, two
 * files (an image, a PDF) at a few people, a second excerpt on the cited
 * source and a source nobody cites with its own excerpt — every image a data
 * URL (`whole`) and the same tree with each one a pooled reference (`refs`).
 */
async function sample(): Promise<{ whole: StromData; refs: StromData; ids: Map<string, string> }> {
    const { data } = familyPagesFixture();
    let n = 0;
    for (const p of Object.values(data.persons)) p.photo = jpeg(++n);
    for (const u of Object.values(data.partnerships)) u.photo = jpeg(++n);
    const media: Record<string, Attachment> = {};
    for (const pid of ['josef', 'anna', 'jaroslav', 'eva'] as PersonId[]) {
        media[`img-${pid}`] = { id: `img-${pid}`, name: `${pid}.jpg`, mimeType: 'image/jpeg', dataUrl: jpeg(++n), sizeBytes: 300, places: [{ personId: pid }] } as Attachment;
        media[`pdf-${pid}`] = { id: `pdf-${pid}`, name: `${pid}.pdf`, mimeType: 'application/pdf', dataUrl: PDF3, sizeBytes: 120, places: [{ personId: pid }] } as Attachment;
    }
    data.media = media;
    data.sources!['s-marr1846'].excerpts!.push({ id: 'x2', dataUrl: jpeg(++n), width: 1, height: 1, sizeBytes: 300, caption: 'Druhý záznam' });
    data.sources!['s-none'] = { id: 's-none', title: 'Nikým necitovaný', excerpts: [{ id: 'x3', dataUrl: jpeg(++n), width: 1, height: 1, sizeBytes: 300 }] } as never;
    const whole = JSON.parse(JSON.stringify(data)) as StromData;
    // Every distinct data URL pooled under its own id (as the pool interns them).
    const ids = new Map<string, string>();
    const refs = JSON.parse(JSON.stringify(data, (_k, v: unknown) => {
        if (typeof v !== 'string' || !v.startsWith('data:')) return v;
        let id = ids.get(v);
        if (!id) {
            id = `p:${(ids.size + 1).toString(16).padStart(40, '0')}`;
            ids.set(v, id);
        }
        return POOL_REF + id;
    })) as StromData;
    for (const [url, id] of ids) {
        pool.set(id, url);
        setImageMeta(id, await computeImageMeta(url));
    }
    return { whole, refs, ids };
}

function pageOpts(personId: PersonId, o: Partial<PersonPageOptions> = {}): PersonPageOptions {
    return {
        personId, lang: 'cs', mode: 'file', links: 'plain', groups: { ...PERSON_PAGE_ALL_GROUPS },
        privacy: 'full', toggles: { history: true, childEvents: true }, research: true, now: FP_NOW, ...o,
    };
}

function personDoc(data: StromData, personId: PersonId): string {
    const op = pageOpts(personId);
    return buildPersonPageDocument(preparePersonPageData(data, op), op);
}

function rodSet(data: StromData) {
    const rod = rods(buildLineages(data)).filter(r => !r.small)[0].id;
    return buildPageSet(data, { kind: 'rods', rods: [rod] }, { lang: 'cs', now: FP_NOW });
}

const P0 = 'p0' as PersonId;
const id = (n: number): string => 'p:' + n.toString(16).padStart(2, '0').repeat(20);
const ref = (n: number): string => POOL_REF + id(n);
const url = (n: number): string => jpeg(100 + n);

function small(): StromData {
    return {
        version: 1,
        persons: {
            p0: { id: 'p0', firstName: 'Zbyňka', lastName: 'Brablcová', gender: 'female', partnerships: ['u0'], parentIds: [], childIds: [],
                photo: ref(1), sourceIds: ['s0'] },
            p1: { id: 'p1', firstName: 'Hroznata', lastName: 'Brablec', gender: 'male', partnerships: ['u0'], parentIds: [], childIds: [],
                photo: ref(2) },
            p2: { id: 'p2', firstName: 'Vojmír', lastName: 'Okurka', gender: 'male', partnerships: [], parentIds: [], childIds: [], photo: ref(8) },
        },
        partnerships: {
            u0: { id: 'u0', person1Id: 'p1', person2Id: 'p0', childIds: [], photo: ref(3) },
        },
        media: {
            m0: { id: 'm0', name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: ref(4), sizeBytes: 1, places: [{ personId: 'p0' }] },
            m1: { id: 'm1', name: 'other.jpg', mimeType: 'image/jpeg', dataUrl: ref(5), sizeBytes: 1, places: [{ personId: 'p2' }] },
        },
        sources: {
            s0: { id: 's0', title: 'Matrika', excerpts: [{ id: 'e0', dataUrl: ref(6), width: 1, height: 1, sizeBytes: 1 }] },
            s1: { id: 's1', title: 'Jiná', excerpts: [{ id: 'e1', dataUrl: ref(7), width: 1, height: 1, sizeBytes: 1 }] },
        },
    } as unknown as StromData;
}

beforeEach(() => {
    pool.clear();
    asked.length = 0;
    clearImageMeta();
});

describe('the images a page shows', () => {
    it('a person\'s page: the portrait, the couples\' photos, the person\'s files and the cited sources\' excerpts', () => {
        expect([...personPageImageIds(small(), P0)].sort()).toEqual([id(1), id(3), id(4), id(6)].sort());
        expect([...personPageImageIds(small(), 'p2' as PersonId)].sort()).toEqual([id(5), id(8)].sort());
        expect(personPageImageIds(small(), 'nobody' as PersonId).size).toBe(0);
    });

    it('a set of pages: its people\'s and the people next to them (a partner\'s portrait on the family page)', () => {
        const d = small();
        expect([...pageSetImageIds(d, [P0])].sort()).toEqual([id(1), id(2), id(3), id(4), id(6)].sort());
        expect([...pageSetImageIds(d, [], ['u0' as PartnershipId])].sort()).toEqual([id(1), id(2), id(3), id(4), id(6)].sort());
        expect([...pageSetImageIds(d, ['p2' as PersonId])].sort()).toEqual([id(5), id(8)].sort());
    });

    it('withImagesWhole: only those images whole, read once; the others stay references; the tree untouched', async () => {
        for (let n = 1; n <= 7; n++) pool.set(id(n), url(n));
        const d = small();
        const before = JSON.stringify(d);
        const t = await withImagesWhole(d, personPageImageIds(d, P0));
        expect(asked).toEqual([[id(1), id(3), id(4), id(6)].sort()]);
        expect(t.persons[P0].photo).toBe(url(1));
        expect(t.partnerships['u0' as PartnershipId].photo).toBe(url(3));
        expect(t.media!.m0.dataUrl).toBe(url(4));
        expect(t.sources!.s0.excerpts![0].dataUrl).toBe(url(6));
        expect(t.persons['p1' as PersonId].photo).toBe(ref(2));
        expect(t.media!.m1.dataUrl).toBe(ref(5));
        expect(t.sources!.s1.excerpts![0].dataUrl).toBe(ref(7));
        expect(JSON.stringify(d)).toBe(before);
        // One the pool does not have: empty text (as the whole tree's expansion gives it).
        const p2 = await withImagesWhole(d, personPageImageIds(d, 'p2' as PersonId));
        expect(p2.persons['p2' as PersonId].photo).toBe('');
        // None asked: a copy with the references, not read.
        asked.length = 0;
        const none = await withImagesWhole(d, new Set());
        expect(none).not.toBe(d);
        expect(none).toEqual(d);
        expect(asked).toEqual([]);
    });
});

describe('a page output from the tree with references is the one from the tree with its images whole', () => {
    it('the saved person page of every person', async () => {
        const { whole, refs } = await sample();
        for (const pid of Object.keys(whole.persons) as PersonId[]) {
            const html = personDoc(await withImagesWhole(refs, personPageImageIds(refs, pid)), pid);
            expect(html).not.toContain(POOL_REF);
            expect(html).not.toContain(POOL_REF_ATTR);
            expect(html, pid).toBe(personDoc(whole, pid));
        }
        // A page with a PDF file: its pages read from the data URL.
        expect(personDoc(whole, 'josef' as PersonId)).toContain('3 str');
    });

    it('the family pages\' file and set of files, reading only the images of its pages', async () => {
        const { whole, refs, ids } = await sample();
        const named = rodSet(refs);
        const want = pageSetImageIds(refs, named.personSlug.keys(), named.familySlug.keys());
        const t = await withImagesWhole(refs, want);
        // Not the whole tree's: the excerpt of the source nobody cites and the people of other lines stay out.
        expect(want.has(ids.get(whole.sources!['s-none'].excerpts![0].dataUrl)!)).toBe(false);
        expect(want.size).toBeLessThan(ids.size);
        expect(asked.flat().length).toBe(want.size);
        const set = rodSet(t);
        const html = await buildPageSetHtmlAsync(set);
        expect(html).not.toContain(POOL_REF);
        expect(html).not.toContain(POOL_REF_ATTR);
        expect(html).toBe(await buildPageSetHtmlAsync(rodSet(whole)));
        // The pages carry their images (the portraits, the couples' photos, the excerpt).
        expect([...want].filter(w => html.includes(pool.get(w)!)).length).toBeGreaterThan(10);
        const files = await buildPageSetFilesAsync(set);
        const wholeFiles = await buildPageSetFilesAsync(rodSet(whole));
        expect(files.map(e => e.path)).toEqual(wholeFiles.map(e => e.path));
        files.forEach((e, i) => expect(e.data, e.path).toEqual(wholeFiles[i].data));
    });
});

describe('the person page in the app\'s window with pooled images', () => {
    it('shows a pooled image by its reference (the hydrator puts it in), never the reference as an address', async () => {
        const { refs } = await sample();
        const op = pageOpts('josef' as PersonId, { mode: 'app', links: 'app' });
        const html = buildPersonPageBody(preparePersonPageData(refs, op), op);
        const photo = refs.persons['josef' as PersonId].photo!;
        expect(html).toMatch(new RegExp(`<img class="pp-photo" src="[^"]*" ${POOL_REF_ATTR}="${photo.slice(POOL_REF.length)}"`));
        expect(html).not.toContain(POOL_REF);
        expect(html).not.toMatch(/src="data:image\/jpeg/);
    });

    it('a pooled PDF: its pages from opts.pdfPages (read from its bytes), unknown until then', async () => {
        const { refs } = await sample();
        const pdfRef = refs.media!['pdf-josef'].dataUrl;
        const asks: string[] = [];
        const op = (pages: number | null) => pageOpts('josef' as PersonId, { mode: 'app', links: 'app', pdfPages: (r) => { asks.push(r); return pages; } });
        const shown = (pages: number | null) => {
            const o = op(pages);
            return buildPersonPageBody(preparePersonPageData(refs, o), o).match(/<li class="pp-pdf">.*?<\/li>/)?.[0] ?? '';
        };
        expect(shown(null)).not.toContain('3 str');
        expect(shown(3)).toContain('3 str');
        expect(asks).toContain(pdfRef);
        // The count from the PDF's bytes, as from its data URL.
        expect(pdfPageCount(new Uint8Array(Buffer.from(PDF3.slice(PDF3.indexOf(',') + 1), 'base64')))).toBe(3);
        expect(pdfPageCount(new Uint8Array(Buffer.from('not a pdf')))).toBeNull();
    });
});
