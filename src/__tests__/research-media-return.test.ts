/**
 * The tree's own files coming back from a research that keeps them (spec 108
 * §5, K2.3, Strom Research 1.35 `media.app`): the file asked with them only
 * behind the gate, its portraits, couples' photos and attachments read from
 * `strom-image:` references, a file the archive names by its name alone kept
 * from what the browser holds, nothing downloaded that is held, and the
 * archive as the truth for what it gave (carryOverMedia with a base).
 * Invented data only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { carryOverMedia as carryOver, researchMediaKeys, stabilizeIds, MEDIA_APP_FEATURE } from '../research-link.js';
import { refTreeUrl, resolveImageRefs, findImageRefs, findNamedFileShas, forgetHeldImages, sha256Hex, type ImageResolveDeps } from '../research-image-refs.js';
import { storedTreeEtag, treeAsksAppMedia } from '../research-tree-file.js';
import type { Attachment, Person, StromData } from '../types.js';

/** A small JPEG; `salt` makes its bytes (and hash) its own. */
function jpeg(width: number, height: number, salt: number): Buffer {
    return Buffer.from([0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xFE, 0x00, 0x04, salt >> 8, salt & 0xFF,
        0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 0xFF, width >> 8, width & 0xFF,
        0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
        ...Array.from({ length: 300 }, (_, i) => (i * 5 + salt) & 0xFF),
        0xFF, 0xD9]);
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const shaOf = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const urlOf = (b: Buffer, mime = 'image/jpeg'): string => `data:${mime};base64,${b.toString('base64')}`;

const PORTRAIT = jpeg(256, 256, 11);
const SCAN = jpeg(1200, 900, 12);
const COUPLE = jpeg(1600, 1067, 13);
/** The scan's original (a big TIFF the research holds; only its hash is known here). */
const SCAN_ORIGINAL_SHA = 'a'.repeat(64);
/** A file the research keeps no working copy of, named by its hash alone. */
const BIG_ORIGINAL_SHA = 'b'.repeat(64);
const UUID = '6f0c2d9e-4b17-4a83-9e52-1d7b3c8a0f61';
const GED = 'http://127.0.0.1:5996/tok/tree.ged';

/** The research's tree as `tree.ged?images=ref&media=app` gives it. */
function mediaFile(o: { scan?: boolean; pdf?: boolean; big?: boolean } = {}): string {
    const { scan = true, pdf = true, big = true } = o;
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 17 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 5e8a1c3f7b20', '1 CHAR UTF-8',
        '0 @S0001@ SOUR', '1 TITL Matriky Lhota u Brodu 1920–1930', '1 REFN S0001',
        '0 @P0001@ INDI', '1 NAME Hostivít /Pšeničný/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND photo', `2 FILE strom-image:${shaOf(PORTRAIT)}`, '3 _MIME image/jpeg', '2 _DATE 1931',
        ...(scan ? ['1 OBJE', `2 FILE strom-image:${shaOf(SCAN)}`, '3 _MIME image/jpeg', '2 TITL Svatební list', '2 NOTE Opis z fary',
            '2 _DATE 12 MAY 1924', '2 _SOUR @S0001@', `2 _STROM_SHA ${SCAN_ORIGINAL_SHA}`, '2 _STROM_ORIENT 6'] : []),
        ...(pdf ? ['1 OBJE', '2 FILE dopis.pdf', '2 TITL dopis.pdf', `2 _STROM_SHA ${shaOf(PDF)}`] : []),
        ...(big ? ['1 OBJE', '2 FILE kronika.tif', '2 TITL kronika.tif', `2 _STROM_SHA ${BIG_ORIGINAL_SHA}`] : []),
        '0 @P0002@ INDI', '1 NAME Ctirada /Pšeničná/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 MARR', '2 DATE 12 MAY 1924',
        '1 OBJE', `2 FILE strom-image:${shaOf(COUPLE)}`, '3 _MIME image/jpeg', '2 _PRIM Y',
        '0 TRLR', '',
    ].join('\n');
}

const IMAGES = new Map([PORTRAIT, SCAN, COUPLE].map(b => [shaOf(b), urlOf(b)]));
const read = (text: string, images: ReadonlyMap<string, string> = IMAGES): StromData => convertToStrom(parseGedcom(text), { images }).data;
const person = (data: StromData, refn: string): Person => {
    const p = Object.values(data.persons).find(x => x.refn === refn);
    if (!p) throw new Error(`no ${refn}`);
    return p;
};
const atts = (data: StromData, refn: string): Attachment[] => person(data, refn).attachments ?? [];
const clone = (d: StromData): StromData => JSON.parse(JSON.stringify(d)) as StromData;
/** As a load does it: the next version on the previous one's ids first. */
const carryOverMedia = (next: StromData, previous: StromData, base?: ReadonlySet<string> | null) => carryOver(stabilizeIds(next, previous), previous, base);

describe('the file with the tree\'s own files is asked only behind its gate', () => {
    it('asks `media=app` only with `images=ref`, and never without the gate', () => {
        const withMedia = new URL(refTreeUrl(`${GED}?stale=1`, true));
        expect(withMedia.searchParams.get('images')).toBe('ref');
        expect(withMedia.searchParams.get('media')).toBe('app');
        expect(withMedia.searchParams.get('stale')).toBe('1');
        const without = new URL(refTreeUrl(`${GED}?media=app`));
        expect(without.searchParams.get('images')).toBe('ref');
        expect(without.searchParams.has('media')).toBe(false);
    });

    it('the gate: images by their hash, `media.app`, and a tree that takes images', () => {
        const all = ['ged.etag', 'ged.imagesByHash', MEDIA_APP_FEATURE];
        expect(treeAsksAppMedia(all, true)).toBe(true);
        expect(treeAsksAppMedia(all, false)).toBe(false);
        expect(treeAsksAppMedia(['ged.etag', 'ged.imagesByHash'], true)).toBe(false);
        expect(treeAsksAppMedia(['ged.etag', MEDIA_APP_FEATURE], true)).toBe(false);
        expect(treeAsksAppMedia(null, true)).toBe(false);
    });

    it('the file with them has its own tag: never asked with the other\'s', () => {
        const link = { fingerprint: 'fp', head: 'h1', treeEtag: { tag: '"m1"', head: 'h1', fingerprint: 'fp', images: true, variant: 'ref' as const, media: true as const } };
        expect(storedTreeEtag(link, 'fp', true, 'ref', true)).toBe('"m1"');
        expect(storedTreeEtag(link, 'fp', true, 'ref')).toBeNull();
        const plain = { ...link, treeEtag: { ...link.treeEtag, media: undefined } };
        expect(storedTreeEtag(plain, 'fp', true, 'ref')).toBe('"m1"');
        expect(storedTreeEtag(plain, 'fp', true, 'ref', true)).toBeNull();
    });
});

describe('the tree\'s own files read from the file', () => {
    it('restores the portrait, the couple\'s photo, an attachment with its fields and an original by its name', () => {
        const data = read(mediaFile({ pdf: false }));
        const man = person(data, 'P0001');
        expect(man.photo).toBe(urlOf(PORTRAIT));
        expect(man.photoDate).toBe('1931');
        const couple = Object.values(data.partnerships)[0];
        expect(couple.photo).toBe(urlOf(COUPLE));
        const [scan, big] = atts(data, 'P0001');
        expect(scan).toMatchObject({ name: 'Svatební list', mimeType: 'image/jpeg', dataUrl: urlOf(SCAN), note: 'Opis z fary', date: '12 MAY 1924' });
        expect(scan.original).toMatchObject({ sha256: SCAN_ORIGINAL_SHA, orientation: 6 });
        expect(scan.sourceId && data.sources?.[scan.sourceId]?.title).toBe('Matriky Lhota u Brodu 1920–1930');
        expect(big).toMatchObject({ name: 'kronika.tif', originalOnly: true, original: { sha256: BIG_ORIGINAL_SHA } });
        // No reference ever comes into the tree.
        expect(JSON.stringify(data)).not.toContain('strom-image:');
    });

    it('a file named by its name alone that the browser holds comes back as that file', () => {
        const pdf = urlOf(PDF, 'application/pdf');
        const data = read(mediaFile(), new Map([...IMAGES, [shaOf(PDF), pdf]]));
        const letter = atts(data, 'P0001').find(a => a.name === 'dopis.pdf');
        expect(letter).toMatchObject({ dataUrl: pdf, mimeType: 'application/pdf' });
        expect(letter?.originalOnly).toBeUndefined();
        // Not held: an original by its name, as before.
        const bare = atts(read(mediaFile()), 'P0001').find(a => a.name === 'dopis.pdf');
        expect(bare).toMatchObject({ originalOnly: true, original: { sha256: shaOf(PDF) } });
    });

    it('the files a file names by their name alone', () => {
        expect(findNamedFileShas(mediaFile()).sort()).toEqual([BIG_ORIGINAL_SHA, shaOf(PDF)].sort());
        // An image by its hash with its original's hash is no such file.
        expect(findNamedFileShas(mediaFile({ pdf: false, big: false }))).toEqual([]);
    });
});

describe('images and files held are never downloaded again', () => {
    beforeEach(() => forgetHeldImages());

    it('a new session: the stored tree\'s portraits, couple\'s photo, attachments and its PDF', async () => {
        const pdf = urlOf(PDF, 'application/pdf');
        const stored = [urlOf(PORTRAIT), urlOf(SCAN), urlOf(COUPLE), pdf];
        const deps: ImageResolveDeps = {
            fetch: async () => { throw new Error('nothing is asked of the bridge'); },
            sha256Hex,
            sleep: async () => undefined,
            treeImages: async () => stored,
        };
        const text = mediaFile();
        const got = await resolveImageRefs({ researchId: UUID, refs: findImageRefs(text), imagesUrl: 'http://127.0.0.1:5996/tok/images', files: findNamedFileShas(text) }, deps);
        expect(got.fetched).toBe(0);
        expect(got.images.get(shaOf(PDF))).toBe(pdf);
        expect(got.images.has(BIG_ORIGINAL_SHA)).toBe(false);
        // The next file of the same research: all held, nothing hashed or asked.
        let hashed = 0;
        const again = await resolveImageRefs({ researchId: UUID, refs: findImageRefs(text), imagesUrl: 'x', files: [shaOf(PDF)] },
            { ...deps, sha256Hex: async b => { hashed++; return sha256Hex(b); } });
        expect(again).toMatchObject({ fetched: 0, seeded: 0 });
        expect(hashed).toBe(0);
    });

    it('without the files asked (an older research): only the images, as before', async () => {
        const deps: ImageResolveDeps = {
            fetch: async () => { throw new Error('nothing is asked of the bridge'); },
            sha256Hex,
            sleep: async () => undefined,
            treeImages: async () => [urlOf(PORTRAIT), urlOf(SCAN), urlOf(COUPLE), urlOf(PDF, 'application/pdf')],
        };
        const got = await resolveImageRefs({ researchId: UUID, refs: findImageRefs(mediaFile()), imagesUrl: 'x' }, deps);
        expect(got.images.has(shaOf(PDF))).toBe(false);
        expect(got.images.size).toBe(3);
    });
});

describe('the archive is the truth for the files it gave (carryOverMedia with a base)', () => {
    /** The tree as the last return with the files left it, and that return's base. */
    const returned = (): { tree: StromData; base: Set<string> } => {
        const tree = read(mediaFile({ pdf: false }));
        return { tree, base: new Set(researchMediaKeys(tree)) };
    };

    it('the same version again: nothing carried, nothing lost (no write due)', () => {
        const { tree, base } = returned();
        const r = carryOverMedia(read(mediaFile({ pdf: false })), tree, base);
        expect(r).toMatchObject({ lost: 0, carried: 0 });
        expect(atts(r.data, 'P0001')).toHaveLength(2);
    });

    it('a file taken off in the archive (another window) is not kept; one added here since is', () => {
        const { tree, base } = returned();
        const added: Attachment = { id: 'att_added', name: 'pohlednice.jpg', mimeType: 'image/jpeg', dataUrl: urlOf(jpeg(320, 200, 21)), sizeBytes: 320 };
        const previous = clone(tree);
        person(previous, 'P0001').attachments!.push(added);
        const next = read(mediaFile({ pdf: false, scan: false }));
        const r = carryOverMedia(next, previous, base);
        const names = atts(r.data, 'P0001').map(a => a.name).sort();
        expect(names).toEqual(['kronika.tif', 'pohlednice.jpg']);
        expect(r).toMatchObject({ lost: 0, carried: 1 });
    });

    it('a portrait or couple\'s photo taken off there stays off', () => {
        const { tree, base } = returned();
        const next = read(mediaFile({ pdf: false }));
        delete person(next, 'P0001').photo;
        for (const u of Object.values(next.partnerships)) delete u.photo;
        const r = carryOverMedia(next, tree, base);
        expect(person(r.data, 'P0001').photo).toBeUndefined();
        expect(Object.values(r.data.partnerships)[0].photo).toBeUndefined();
        expect(r.carried).toBe(0);
    });

    it('no base yet (the first return with them): every file of the app kept', () => {
        const { tree } = returned();
        const next = read(mediaFile({ pdf: false, scan: false }));
        const r = carryOverMedia(next, tree, null);
        expect(atts(r.data, 'P0001').map(a => a.name).sort()).toEqual(['Svatební list', 'kronika.tif']);
        expect(r.carried).toBe(1);
        // And a version without them (an older research): as ever.
        expect(carryOverMedia(next, tree).carried).toBe(1);
    });

    it('lost counts only what the archive did not give: a person gone with files added here', () => {
        const { tree, base } = returned();
        const previous = clone(tree);
        person(previous, 'P0001').attachments!.push({ id: 'att_x', name: 'x.jpg', mimeType: 'image/jpeg', dataUrl: urlOf(jpeg(30, 30, 31)), sizeBytes: 30 });
        const next = clone(previous);
        const gone = person(next, 'P0001').id;
        delete next.persons[gone];
        expect(carryOverMedia(next, previous, base).lost).toBe(1);
        // Without the base all of his files count.
        expect(carryOverMedia(next, previous).lost).toBe(4);
    });

    it('a file the archive names by its name alone keeps the picture held here of it', () => {
        const preview = urlOf(jpeg(800, 600, 41));
        const previous = read(mediaFile({ pdf: false }));
        const big = atts(previous, 'P0001').find(a => a.name === 'kronika.tif')!;
        Object.assign(big, { dataUrl: preview, mimeType: 'image/jpeg', sizeBytes: 800 });
        delete big.originalOnly;
        const next = read(mediaFile({ pdf: false }));
        const r = carryOverMedia(next, previous, null);
        const got = atts(r.data, 'P0001').filter(a => a.original?.sha256 === BIG_ORIGINAL_SHA);
        expect(got).toHaveLength(1);
        expect(got[0]).toMatchObject({ dataUrl: preview, name: 'kronika.tif' });
        expect(got[0].originalOnly).toBeUndefined();
        expect(r.carried).toBe(0);
    });
});
