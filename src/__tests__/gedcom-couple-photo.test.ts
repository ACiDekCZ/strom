/**
 * A couple's photo in GEDCOM (spec 107 §6): Strom writes it as a plain
 * `1 OBJE` of the family (no tag of its own) and reads a family's first image
 * (one marked `_PRIM` first) back as the photo; the other pictures of the
 * family stay as written for "Back to {prog}". A portrait's source never goes
 * into the file. A family's picture outside the file is offered to connect
 * like a person's and becomes the photo once connected.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { personMedia } from '../media.js';
import { applyLivingPrivacy, CONTENT_PRESETS } from '../privacy.js';
import { attachGedcomMediaFile, gedcomMediaAttachedText, GedcomMediaReaders } from '../ged-media-attach.js';
import { Partnership, Person, PersonId, StromData } from '../types.js';

const ORIGIN: GedcomImportOrigin = { at: '2026-11-16', file: 'export.ged', encoding: 'utf-8' };

const load = (text: string, origin: GedcomImportOrigin | null = null) =>
    convertToStrom(parseGedcom(text), origin ? { importOrigin: origin } : {});

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));
/** A JPEG header (SOI + APP0 + SOF0) claiming the given size. */
function jpegDataUrl(width: number, height: number): string {
    const app0 = [0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof0 = [0xFF, 0xC0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3,
        1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return 'data:image/jpeg;base64,' + b64([0xFF, 0xD8, ...app0, ...sof0, 0xFF, 0xD9]);
}
const COUPLE_JPEG = jpegDataUrl(1600, 1067);
const OTHER_JPEG = jpegDataUrl(900, 1200);
const PORTRAIT_JPEG = jpegDataUrl(256, 256);

function byName(data: StromData, first: string): Person {
    const p = Object.values(data.persons).find(x => x.firstName === first);
    if (!p) throw new Error(`no ${first}`);
    return p;
}

function onlyCouple(data: StromData): Partnership {
    const all = Object.values(data.partnerships);
    expect(all).toHaveLength(1);
    return all[0];
}

/** The lines of the FAM records. */
const famRecords = (ged: string): string[][] => ged.split(/\r?\n(?=0 )/)
    .map(r => r.split(/\r?\n/).filter(l => l !== ''))
    .filter(r => / FAM$/.test(r[0]));

/** Every level-1/2/3 tag of the file. */
const tagsOf = (ged: string): Set<string> => new Set(ged.split(/\r?\n/)
    .map(l => /^\d+ (?:@[^@]+@ )?(\S+)/.exec(l)?.[1]).filter((t): t is string => !!t));

const COUPLE = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Bratrolib /Ječmínek/
1 SEX M
1 DEAT Y
1 FAMS @F1@
0 @I2@ INDI
1 NAME Zvonimíra /Lopuchová/
1 SEX F
1 DEAT Y
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1911
0 TRLR
`;

/** The couple with its photo and the wife's portrait cut from it. */
function treeWithCouplePhoto(): StromData {
    const data = migrateData(load(COUPLE).data);
    const union = onlyCouple(data);
    union.photo = COUPLE_JPEG;
    union.photoOriginalName = 'svatba-1911.jpg';
    const wife = byName(data, 'Zvonimíra');
    wife.photo = PORTRAIT_JPEG;
    wife.photoSource = { partnershipId: union.id, region: { x: 0.55, y: 0.1, w: 0.3, h: 0.45 }, quarterTurns: 1, angle: 2.5, mirror: true };
    return data;
}

describe('a couple’s photo: Strom → GEDCOM → Strom', () => {
    it('goes out as one plain OBJE of the family and comes back as the photo, nothing dropped', () => {
        const data = treeWithCouplePhoto();
        const ged = exportToGedcom(data).content;
        const [fam] = famRecords(ged);
        expect(fam.filter(l => l === '1 OBJE')).toHaveLength(1);
        const at = fam.indexOf('1 OBJE');
        const block = fam.slice(at + 1).filter((l, i, all) => all.slice(0, i + 1).every(x => !/^1 /.test(x)));
        expect(block).toContain('2 TITL svatba-1911.jpg');
        expect(block.some(l => l.startsWith('2 _STROM_'))).toBe(false);

        const back = load(ged);
        expect(back.stats.droppedTagSummary).toBe('');
        const union = onlyCouple(back.data);
        expect(union.photo).toBe(COUPLE_JPEG);
        expect(union.photoOriginalName).toBe('svatba-1911.jpg');
        // The family's picture is the photo, not also an extra kept for later.
        expect(union.gedcomExtra).toBeUndefined();
        expect(back.externalMedia).toEqual([]);
    });

    it('a second round trip writes the same family, no OBJE doubled', () => {
        const first = exportToGedcom(treeWithCouplePhoto()).content;
        const again = exportToGedcom(migrateData(load(first).data)).content;
        expect(famRecords(again)).toEqual(famRecords(first));
    });

    it('adds no tag of its own and never writes the portrait’s source', () => {
        const data = treeWithCouplePhoto();
        const plain = migrateData(load(COUPLE).data);
        Object.assign(byName(plain, 'Zvonimíra'), { photo: PORTRAIT_JPEG, photoOriginalName: 'zvonimira.jpg' });
        byName(data, 'Zvonimíra').photoOriginalName = 'zvonimira.jpg';
        const withPhoto = exportToGedcom(data).content;
        const added = [...tagsOf(withPhoto)].filter(t => !tagsOf(exportToGedcom(plain).content).has(t));
        // FORM, TITL, FILE and CONC are already the portrait's; nothing new besides.
        expect(added).toEqual([]);
        expect(withPhoto).not.toMatch(/CROP|photoSource|0\.55|quarterTurns/);
        // The portrait comes back as a portrait, without a source (JSON only).
        const wife = byName(load(withPhoto).data, 'Zvonimíra');
        expect(wife.photo).toBe(PORTRAIT_JPEG);
        expect(wife.photoSource).toBeUndefined();
    });
    it('a portrait whose frame reaches past the photo\'s edge goes out as the finished portrait, no region, and comes back', () => {
        const data = treeWithCouplePhoto();
        const wife = byName(data, 'Zvonimíra');
        wife.photoOriginalName = 'zvonimira.jpg';
        wife.photoSource = { partnershipId: onlyCouple(data).id, region: { x: -0.125, y: 0.4, w: 0.3, h: 0.45 } };
        const ged = exportToGedcom(data).content;
        const lines = ged.split(/\r?\n/);
        const kind = lines.indexOf('2 _STROM_KIND photo');
        expect(kind).toBeGreaterThan(0);
        expect(ged).not.toMatch(/CROP|photoSource|region|-0\.125|0\.45/);
        const back = load(ged);
        expect(back.stats.droppedTagSummary).toBe('');
        const again = byName(migrateData(back.data), 'Zvonimíra');
        expect(again.photo).toBe(PORTRAIT_JPEG);
        expect(again.photoSource).toBeUndefined();
    });
});

// ---------- another program's family pictures ----------

const MYHERITAGE_HEAD = `0 HEAD
1 SOUR MYHERITAGE
2 NAME MyHeritage Family Tree Builder
2 VERS 5.5.1
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Bratrolib /Ječmínek/
1 SEX M
1 DEAT Y
1 FAMS @F1@
0 @I2@ INDI
1 NAME Zvonimíra /Lopuchová/
1 SEX F
1 DEAT Y
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
`;

/**
 * "Back to {prog}" as the app makes it, for the tree's last import (the app's
 * "Back" leaves pictures out); `photos` writes them too, where a kept picture
 * and the couple's photo could meet.
 */
const backTo = (data: StromData, photos = false): string => exportToGedcom(applyLivingPrivacy(data, 'full', 2026, { keepDeceasedSources: true }), 'Ječmínek',
    { content: { ...CONTENT_PRESETS.back, photos }, origins: true, backTo: data.imports![data.imports!.length - 1].id }).content;
const objeCount = (ged: string): number => famRecords(ged)[0].filter(l => l === '1 OBJE').length;

const fakeReaders = (dataUrl: string): GedcomMediaReaders => ({
    portrait: async () => PORTRAIT_JPEG,
    image: async () => dataUrl,
    raw: async () => 'data:application/pdf;base64,JVBERi0=',
});
const jpegFile = (name: string): File => new File([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], name, { type: 'image/jpeg' });

describe('a family’s picture from another program', () => {
    it('a file outside the GEDCOM (MyHeritage) is offered for the couple; connected, it is the photo and goes back once', async () => {
        const ged = MYHERITAGE_HEAD + `1 OBJE
2 FORM jpg
2 FILE https://www.myheritage.com/photos/svatba.jpg
2 TITL Svatba v Kořenově
2 _DATE 12 JUN 1911
0 TRLR
`;
        const r = load(ged, ORIGIN);
        const union = onlyCouple(r.data);
        expect(r.externalMedia).toEqual([{
            partnershipId: union.id, fileName: 'svatba.jpg', filePath: 'https://www.myheritage.com/photos/svatba.jpg',
            title: 'Svatba v Kořenově', isUrl: true, date: '12 JUN 1911',
        }]);
        expect(r.stats.droppedTagSummary).toBe('');
        // Until a file comes, its lines wait for "Back to MyHeritage".
        expect(union.photo).toBeUndefined();
        expect(JSON.stringify(union.gedcomExtra)).toContain('svatba.jpg');
        expect(backTo(migrateData(structuredClone(r.data)))).toContain('2 FILE https://www.myheritage.com/photos/svatba.jpg');

        expect(await attachGedcomMediaFile(r.data, r.externalMedia[0], jpegFile('svatba.jpg'), fakeReaders(COUPLE_JPEG))).toBe('couplePhoto');
        expect(union.photo).toBe(COUPLE_JPEG);
        expect(union.photoOriginalName).toBe('Svatba v Kořenově');
        expect(union.photoDate).toBe('12 JUN 1911');
        expect(JSON.stringify(union.gedcomExtra ?? [])).not.toContain('svatba.jpg');

        // The connected file took the link's place: written once, as the photo.
        const out = backTo(migrateData(r.data), true);
        expect(objeCount(out)).toBe(1);
        expect(out).not.toContain('svatba.jpg');
        expect(out).toContain('2 _DATE 12 JUN 1911');
        expect(objeCount(backTo(migrateData(r.data)))).toBe(0);
    });

    it('one embedded through a media record is the photo; "Back to" writes it once, not again from the kept record', () => {
        const ged = MYHERITAGE_HEAD + `1 OBJE @O1@
0 @O1@ OBJE
1 FILE ${COUPLE_JPEG}
2 FORM jpg
2 TITL Svatba
0 TRLR
`;
        const r = load(ged, ORIGIN);
        const union = onlyCouple(r.data);
        expect(union.photo).toBe(COUPLE_JPEG);
        expect(r.stats.skippedMedia).toBe(0);
        expect(r.stats.droppedTagSummary).toBe('');
        expect(union.gedcomExtra).toBeUndefined();
        const out = backTo(migrateData(r.data), true);
        expect(objeCount(out)).toBe(1);
        expect(out).not.toMatch(/^0 @[^@]+@ OBJE/m);
        // The second "Back to" is the first again.
        const again = load(out, { at: '2026-11-17', file: 'back.ged', encoding: 'utf-8' });
        expect(onlyCouple(again.data).photo).toBe(COUPLE_JPEG);
        expect(objeCount(backTo(migrateData(again.data), true))).toBe(1);
    });

    it('the picture marked _PRIM wins over an earlier one; the others stay for "Back to"', () => {
        const ged = MYHERITAGE_HEAD + `1 OBJE
2 FORM jpg
2 FILE photos/statek.jpg
2 TITL Na statku
1 OBJE
2 FORM jpg
2 FILE photos/svatba.jpg
2 TITL Svatba
2 _PRIM Y
1 OBJE
2 FORM pdf
2 FILE photos/smlouva.pdf
0 TRLR
`;
        const r = load(ged, ORIGIN);
        const union = onlyCouple(r.data);
        expect(r.externalMedia).toEqual([expect.objectContaining({ partnershipId: union.id, fileName: 'svatba.jpg' })]);
        const kept = JSON.stringify(union.gedcomExtra);
        for (const f of ['statek.jpg', 'svatba.jpg', 'smlouva.pdf']) expect(kept).toContain(f);
        expect(r.stats.droppedTagSummary).toBe('');
    });

    it('embedded ones: the _PRIM one is the photo, the first one also embedded is counted (a data URL is never kept)', () => {
        const ged = MYHERITAGE_HEAD + `1 OBJE
2 FORM jpg
2 FILE ${OTHER_JPEG}
1 OBJE
2 FORM jpg
2 FILE ${COUPLE_JPEG}
2 _PRIM Y
0 TRLR
`;
        const r = load(ged, ORIGIN);
        expect(onlyCouple(r.data).photo).toBe(COUPLE_JPEG);
        expect(r.stats.droppedTagSummary).toContain('OBJE ×1');
    });

    it('a family’s only picture that is not an image stays as written, the couple gets no photo', () => {
        const ged = MYHERITAGE_HEAD + `1 OBJE
2 FORM pdf
2 FILE photos/smlouva.pdf
0 TRLR
`;
        const r = load(ged, ORIGIN);
        const union = onlyCouple(r.data);
        expect(union.photo).toBeUndefined();
        expect(r.externalMedia).toEqual([]);
        expect(JSON.stringify(union.gedcomExtra)).toContain('smlouva.pdf');
    });
});

describe('connecting a file to the import (attachGedcomMediaFile)', () => {
    const base = (): StromData => migrateData(load(COUPLE).data);

    it('a couple’s photo is shrunk as an attachment (not the square portrait) and only into a couple without one', async () => {
        const data = base();
        const union = onlyCouple(data);
        const ref = { partnershipId: union.id, filePath: 'photos/svatba.jpg' };
        expect(await attachGedcomMediaFile(data, ref, jpegFile('svatba.jpg'), fakeReaders(COUPLE_JPEG))).toBe('couplePhoto');
        expect(union.photo).toBe(COUPLE_JPEG);
        expect(union.photoOriginalName).toBe('svatba.jpg');
        expect(union.photoDate).toBeUndefined();
        // A second picture for the same couple finds the photo taken.
        expect(await attachGedcomMediaFile(data, ref, jpegFile('jina.jpg'), fakeReaders(OTHER_JPEG))).toBeNull();
        expect(union.photo).toBe(COUPLE_JPEG);
    });

    it('a PDF, an unknown couple or an unreadable image connects nothing', async () => {
        const data = base();
        const union = onlyCouple(data);
        const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'smlouva.pdf', { type: 'application/pdf' });
        expect(await attachGedcomMediaFile(data, { partnershipId: union.id }, pdf, fakeReaders(COUPLE_JPEG))).toBeNull();
        expect(await attachGedcomMediaFile(data, { partnershipId: 'u_nikdo' as never }, jpegFile('a.jpg'), fakeReaders(COUPLE_JPEG))).toBeNull();
        const broken: GedcomMediaReaders = { ...fakeReaders(COUPLE_JPEG), image: async () => { throw new Error('decode'); } };
        expect(await attachGedcomMediaFile(data, { partnershipId: union.id }, jpegFile('a.jpg'), broken)).toBeNull();
        expect(union.photo).toBeUndefined();
    });

    it('a person’s files as before: the first image is the portrait, the next an attachment, a PDF a document', async () => {
        const data = base();
        const he = byName(data, 'Bratrolib');
        const ref = { personId: he.id as PersonId, title: 'Bratrolib 1920', date: '1920' };
        expect(await attachGedcomMediaFile(data, ref, jpegFile('b.jpg'), fakeReaders(OTHER_JPEG))).toBe('portrait');
        expect(he.photo).toBe(PORTRAIT_JPEG);
        expect(he.photoDate).toBe('1920');
        // The portrait is in a record of the tree's files too (data v25).
        expect(personMedia(data, he.id)).toEqual([expect.objectContaining({ name: 'b.jpg', dataUrl: PORTRAIT_JPEG, kind: 'photo', date: '1920' })]);
        expect(await attachGedcomMediaFile(data, ref, jpegFile('c.jpg'), fakeReaders(OTHER_JPEG))).toBe('attachment');
        expect(personMedia(data, he.id)[1]).toMatchObject({ name: 'Bratrolib 1920', dataUrl: OTHER_JPEG, date: '1920' });
        const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'd.pdf', { type: 'application/pdf' });
        expect(await attachGedcomMediaFile(data, ref, pdf, fakeReaders(OTHER_JPEG))).toBe('attachment');
        expect(personMedia(data, he.id)).toHaveLength(3);
    });

    it('the sentence after connecting splits the count only when a couple’s photo came in', () => {
        expect(gedcomMediaAttachedText(new Map([['portrait', 2], ['attachment', 1]]), 4)).toBe('Attached 3 of 4 referenced files.');
        expect(gedcomMediaAttachedText(new Map([['portrait', 2], ['couplePhoto', 1]]), 4))
            .toBe('Attached 3 of 4 referenced files: 2 portraits, 0 attachments, 1 couple photo.');
    });
});
