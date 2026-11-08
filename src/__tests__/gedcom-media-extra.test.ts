/**
 * Another program's media records and own tags (spec 066 G8): `0 @O1@ OBJE`
 * records linked from people and sources come in as inline OBJE do; a
 * level-1 `_XXX` of a person or a family is kept as written for "Back to
 * {prog}"; a deeper `_XXX` nothing reads is counted. Strom's own file drops
 * nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    parseGedcom, convertToStrom, GedcomImportOrigin, GEDCOM_READ_UNDERSCORE_TAGS, isUnreadUnderscoreTag,
} from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyLivingPrivacy } from '../privacy.js';
import {
    carryMergedImports, cleanImportOrigin, forgetHiddenImports, keepImports, pruneImportOrigin, remapHolderImports,
} from '../import-origin.js';
import { GedcomExtra, Partnership, Person, StromData } from '../types.js';

const ORIGIN: GedcomImportOrigin = { at: '2026-11-08', file: 'export.ged', encoding: 'utf-8' };

function load(text: string, origin: GedcomImportOrigin | null = ORIGIN) {
    return convertToStrom(parseGedcom(text), origin ? { importOrigin: origin } : {});
}

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

/** The lines of the record whose first line matches. */
function recordOf(ged: string, match: (head: string, body: string[]) => boolean): string[] {
    const recs = ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/).filter(l => l !== ''));
    const rec = recs.find(r => match(r[0], r));
    if (!rec) throw new Error('no record');
    return rec;
}

const personRecord = (ged: string, first: string) =>
    recordOf(ged, (head, body) => / INDI$/.test(head) && body.some(l => l.startsWith(`1 NAME ${first} `)));

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));
/** A JPEG header (SOI + APP0 + SOF0) claiming the given size. */
function jpegDataUrl(width: number, height: number): string {
    const app0 = [0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof0 = [0xFF, 0xC0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3,
        1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return 'data:image/jpeg;base64,' + b64([0xFF, 0xD8, ...app0, ...sof0, 0xFF, 0xD9]);
}
const JPEG = jpegDataUrl(800, 200);

// ---------- media records ----------

const GRAMPS = `0 HEAD
1 SOUR Gramps
2 VERS 5.2.3
2 NAME Gramps
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I0001@ INDI
1 NAME Vřesomil /Kapradník/
1 SEX M
1 OBJE @O0001@
1 OBJE @O0002@
1 OBJE @O0009@
1 SOUR @S0001@
0 @I0002@ INDI
1 NAME Tolinda /Mechová/
1 SEX F
0 @F0001@ FAM
1 HUSB @I0001@
1 WIFE @I0002@
1 OBJE @O0004@
0 @S0001@ SOUR
1 TITL Gruntovní kniha Mlžnova
1 OBJE @O0005@
0 @O0001@ OBJE
1 FILE photos/vresomil-1910.jpg
2 FORM jpg
2 TITL Vřesomil 1910
0 @O0002@ OBJE
1 FILE ${JPEG}
2 FORM jpeg
2 TITL Kupní smlouva
0 @O0003@ OBJE
1 FILE photos/nikdo.jpg
2 FORM jpg
0 @O0004@ OBJE
1 FILE photos/svatba.jpg
2 FORM jpg
0 @O0005@ OBJE
1 FILE ${JPEG}
2 FORM jpeg
2 TITL folio 12
0 TRLR
`;

const ROOTSMAGIC_7 = `0 HEAD
1 GEDC
2 VERS 7.0
1 SOUR RootsMagic
2 NAME RootsMagic
2 VERS 10.0.3.0
0 @I1@ INDI
1 NAME Ambrin /Corvelle/
1 SEX M
1 OBJE @O1@
2 TITL Portrét na verandě
1 OBJE @O2@
0 @O1@ OBJE
1 FILE https://media.example.org/corvelle/portrait.png?size=full
2 FORM image/png
3 MEDI PHOTO
2 TITL veranda.png
1 _PRIM Y
0 @O2@ OBJE
1 FILE C:\\Genealogie\\Corvelle\\dopis.pdf
2 FORM application/pdf
0 TRLR
`;

describe('media records (0 @O1@ OBJE)', () => {
    it('GEDCOM 5.5.1: a path goes to the media to connect, a data URL becomes an attachment, a source image an excerpt', () => {
        const r = load(GRAMPS);
        const v = byName(r.data, 'Vřesomil');
        expect(r.externalMedia).toEqual([{
            personId: v.id, fileName: 'vresomil-1910.jpg', filePath: 'photos/vresomil-1910.jpg', title: 'Vřesomil 1910',
        }]);
        expect(v.attachments).toHaveLength(1);
        expect(v.attachments![0]).toMatchObject({ name: 'Kupní smlouva', mimeType: 'image/jpeg', dataUrl: JPEG });
        const src = Object.values(r.data.sources!)[0];
        expect(src.excerpts).toHaveLength(1);
        expect(src.excerpts![0]).toMatchObject({ dataUrl: JPEG, caption: 'folio 12' });
        // A link to a record the file lacks, a record nobody takes, the family's photo.
        expect(r.stats.skippedMedia).toBe(3);
        expect(r.stats.droppedTagSummary).toContain('OBJE ×3');
        // The data URLs live in the attachment and the excerpt only.
        expect(JSON.stringify(r.data).split(JPEG).length - 1).toBe(2);
    });

    it('GEDCOM 7: FILE with FORM under it; the link’s own title wins, the record’s _PRIM marks the portrait', () => {
        const r = load(ROOTSMAGIC_7);
        const a = byName(r.data, 'Ambrin');
        expect(r.externalMedia).toEqual([
            {
                personId: a.id, fileName: 'portrait.png', filePath: 'https://media.example.org/corvelle/portrait.png?size=full',
                title: 'Portrét na verandě', isUrl: true, primary: true,
            },
            { personId: a.id, fileName: 'dopis.pdf', filePath: 'C:\\Genealogie\\Corvelle\\dopis.pdf' },
        ]);
        expect(r.stats.skippedMedia).toBe(0);
        expect(r.stats.unsupportedTags).toBe(0);
    });

    it('an unsafe embedded format is skipped and counted, never stored', () => {
        const svg = 'data:image/svg+xml;base64,PHN2Zz4=';
        const r = load(GRAMPS.replace(`1 FILE ${JPEG}\n2 FORM jpeg\n2 TITL Kupní smlouva`, `1 FILE ${svg}\n2 FORM svg`));
        expect(byName(r.data, 'Vřesomil').attachments).toBeUndefined();
        expect(JSON.stringify(r.data)).not.toContain('svg+xml');
        expect(r.stats.skippedMedia).toBe(4);
    });

    it('a record with no file is counted once, as its link', () => {
        const r = load(ROOTSMAGIC_7.replace('0 @O2@ OBJE\n1 FILE C:\\Genealogie\\Corvelle\\dopis.pdf\n2 FORM application/pdf\n', '0 @O2@ OBJE\n'));
        expect(r.externalMedia).toHaveLength(1);
        expect(r.stats.skippedMedia).toBe(1);
    });

    it('MyHeritage’s face cut-out bookkeeping under a photo is not counted as unsupported', () => {
        const r = load(`0 HEAD
1 SOUR MYHERITAGE
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Orsina /Korvalová/
1 OBJE
2 FORM jpg
2 FILE https://www.myheritage.com/photos/cut.jpg
2 _FILESIZE 4096
2 _PHOTO_RIN MH:P7
2 _PARENTRIN MH:P6
2 _PARENTPHOTO Y
2 _PERSONALPHOTO Y
2 _CUTOUT Y
2 _PRIM_CUTOUT Y
2 _POSITION 10 20 110 140
0 TRLR
`);
        expect(r.externalMedia).toHaveLength(1);
        expect(r.stats.droppedTagSummary).toBe('');
    });
});

// ---------- another program's own tags ----------

const LONG = '1 _MHNOTE ' + 'Žluťoučký kůň úpěl ďábelské ódy 😀🌳 鳥居と桜 '.repeat(12);

const MYHERITAGE = `0 HEAD
1 SOUR MYHERITAGE
2 NAME MyHeritage Family Tree Builder
2 VERS 5.5.1
1 DATE 2 OCT 2026
1 CHAR UTF-8
0 @I500001@ INDI
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 NAME Hromoslav /Ozubec/
1 SEX M
${LONG}
2 CONC  a ještě kousek 🦉
2 _MHSUB Kořenov
3 _MHDEEPER 1
1 _MHLINK @I500002@
1 BIRT
2 DATE 1880
2 _MHPLACEID 4711
1 FAMS @F500001@
1 RIN MH:I500001
1 _UID 5F3A1B2C3D4E5F60718293A4B5C6D7E8
1 _MHFLAG

0 @I500002@ INDI
1 NAME Libuna /Šťovíková/
1 SEX F
1 FAMS @F500001@
1 _MHPHOTO data:image/jpeg;base64,/9j/4AAQ
0 @F500001@ FAM
1 HUSB @I500001@
1 WIFE @I500002@
1 _MHSTATUS Spolu na statku
2 _MHSINCE 1905
1 MARR
2 DATE 1904
2 SOUR @S1@
3 _APID 1,7602::12345
0 @S1@ SOUR
1 TITL Oddací matrika Kořenov
0 TRLR
`;

const HROMOSLAV_KEPT = [LONG, '2 CONC  a ještě kousek 🦉', '2 _MHSUB Kořenov', '3 _MHDEEPER 1', '1 _MHFLAG'];
const COUPLE_KEPT = ['1 _MHSTATUS Spolu na statku', '2 _MHSINCE 1905'];

describe('another program’s level-1 tags', () => {
    it('are kept on the person and family as written, with the import they came from', () => {
        const r = load(MYHERITAGE);
        expect(byName(r.data, 'Hromoslav').gedcomExtra).toEqual([{ from: 'I1', lines: HROMOSLAV_KEPT }]);
        expect(onlyCouple(r.data).gedcomExtra).toEqual([{ from: 'I1', lines: COUPLE_KEPT }]);
        // A pointer and a data URL cannot be kept as they are: counted.
        expect(byName(r.data, 'Libuna').gedcomExtra).toBeUndefined();
        expect(r.stats.keptTags).toBe(3);
        expect(r.stats.keptTagSummary.split(', ').sort()).toEqual(['_MHFLAG', '_MHNOTE', '_MHSTATUS']);
    });

    it('deeper tags nothing reads are counted, Ancestry’s _APID under a citation too', () => {
        const r = load(MYHERITAGE);
        const summary = r.stats.droppedTagSummary;
        expect(summary).toContain('_MHPLACEID');
        expect(summary).toContain('_APID');
        expect(summary).toContain('_MHLINK');
        expect(summary).toContain('_MHPHOTO');
        // Lines inside a kept block are not counted again.
        expect(summary).not.toContain('_MHSUB');
        expect(summary).not.toContain('_MHDEEPER');
        expect(summary).not.toContain('_MHSINCE');
        expect(r.stats.unsupportedTags).toBe(4);
    });

    it('"Back to MyHeritage" writes them at the end of the record, byte for byte', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const ged = exportToGedcom(data, 'Ozubec', { backTo: 'I1' }).content;
        const rec = personRecord(ged, 'Hromoslav');
        expect(rec.slice(-HROMOSLAV_KEPT.length)).toEqual(HROMOSLAV_KEPT);
        const fam = recordOf(ged, head => / FAM$/.test(head));
        expect(fam.slice(-COUPLE_KEPT.length)).toEqual(COUPLE_KEPT);
        const bytes = new TextEncoder().encode(ged);
        expect(new TextDecoder().decode(bytes)).toContain(HROMOSLAV_KEPT.join('\n'));
    });

    it('without backTo, or back to another program, nothing of them is written', () => {
        const data = migrateData(load(MYHERITAGE).data);
        for (const ged of [exportToGedcom(data).content, exportToGedcom(data, 'Ozubec', { research: { id: 'r-test' }, titles: 'tags', readings: false }).content]) {
            expect(ged).not.toContain('_MHNOTE');
            expect(ged).not.toContain('_MHSTATUS');
        }
        data.imports!.push({ id: 'I2', program: 'Gramps', at: '2026-11-08', file: 'other.ged' });
        expect(exportToGedcom(data, 'Ozubec', { backTo: 'I2' }).content).not.toContain('_MHNOTE');
    });

    it('a file not loaded as an import keeps nothing and counts them', () => {
        const r = load(MYHERITAGE, null);
        expect(byName(r.data, 'Hromoslav').gedcomExtra).toBeUndefined();
        expect(r.stats.keptTags).toBe(0);
        expect(r.stats.droppedTagSummary).toContain('_MHNOTE');
    });

    it('Strom’s own export of that tree reads back with nothing dropped', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const again = load(exportToGedcom(data).content);
        expect(again.stats.unsupportedTags).toBe(0);
        expect(again.stats.keptTags).toBe(0);
    });

    it('Strom’s own export of the comprehensive fixture reads back with nothing dropped', () => {
        const fixture = migrateData(JSON.parse(readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8')) as StromData);
        const back = load(exportToGedcom(fixture).content);
        expect(back.stats.droppedTagSummary).toBe('');
        expect(back.stats.skippedMedia).toBe(0);
    });
});

describe('keeping them through the tree’s life', () => {
    const entry = (from: string, ...lines: string[]): GedcomExtra => ({ from, lines });

    it('cleaning drops unknown imports and broken blocks, keeps the rest as written', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const h = byName(data, 'Hromoslav');
        h.gedcomExtra = [
            entry('I1', '1 _A x', '2 _B y', '1 _BAD\nline', '1 NAME not ours', '1 _C'),
            entry('I9', '1 _D'),
            'junk',
        ] as unknown as GedcomExtra[];
        cleanImportOrigin(data, data.imports);
        expect(h.gedcomExtra).toEqual([entry('I1', '1 _A x', '2 _B y', '1 _C')]);
    });

    it('a merge joins the blocks of both without duplicates; a remap renames them', () => {
        const a = { id: 'a', gedcomExtra: [entry('I1', '1 _A x')] } as unknown as Person;
        const b = { id: 'b', gedcomExtra: [entry('I1', '1 _A x', '1 _B'), entry('I2', '1 _C')] } as unknown as Person;
        carryMergedImports(a, structuredClone(a), b, new Map([['I2', 'I3']]));
        expect(a.gedcomExtra).toEqual([entry('I1', '1 _A x', '1 _B'), entry('I3', '1 _C')]);
        remapHolderImports(a, new Map([['I3', 'I1']]));
        expect(a.gedcomExtra).toEqual([entry('I1', '1 _A x', '1 _B', '1 _C')]);
    });

    it('the tree keeps them over a research version (the research never has them)', () => {
        const previous = migrateData(load(MYHERITAGE).data);
        let n = 0;
        for (const p of Object.values(previous.persons)) p.refn = `P${++n}`;
        const next = structuredClone(previous);
        for (const p of Object.values(next.persons)) delete p.gedcomExtra;
        for (const ps of Object.values(next.partnerships)) delete ps.gedcomExtra;
        const kept = keepImports(next, previous);
        expect(byName(kept, 'Hromoslav').gedcomExtra).toEqual(byName(previous, 'Hromoslav').gedcomExtra);
        expect(onlyCouple(kept).gedcomExtra).toEqual(onlyCouple(previous).gedcomExtra);
    });

    it('a person whose facts the privacy filter changes loses them', () => {
        const p = { id: 'p', gedcomExtra: [entry('I1', '1 _A')] } as unknown as Person;
        forgetHiddenImports(p, false);
        expect(p.gedcomExtra).toHaveLength(1);
        forgetHiddenImports(p, true);
        expect(p.gedcomExtra).toBeUndefined();
        const living = MYHERITAGE.replace('2 DATE 1880', '2 DATE 1990').replace('2 DATE 1904', '2 DATE 2015');
        const data = migrateData(load(living).data);
        const filtered = applyLivingPrivacy(data, 'initials', 2026);
        expect(filtered.persons[byName(data, 'Hromoslav').id].gedcomExtra).toBeUndefined();
        expect(onlyCouple(filtered).gedcomExtra).toBeUndefined();
    });

    it('a tree without the import record drops them', () => {
        const data = migrateData(load(MYHERITAGE).data);
        data.imports = data.imports!.filter(r => r.id !== 'I1');
        pruneImportOrigin(data);
        expect(byName(data, 'Hromoslav').gedcomExtra).toBeUndefined();
        expect(onlyCouple(data).gedcomExtra).toBeUndefined();
    });
});

describe('the tags the reader takes', () => {
    it('every `_XXX` the parser names is read, ignored on purpose or ours', () => {
        const src = readFileSync(join(process.cwd(), 'src', 'ged-parser.ts'), 'utf-8');
        const named = new Set([...src.matchAll(/'(_[A-Z][A-Z0-9_]*)'/g)].map(m => m[1]));
        const unread = [...named].filter(t => t !== '_XXX' && isUnreadUnderscoreTag(t));
        expect(unread).toEqual([]);
        expect(GEDCOM_READ_UNDERSCORE_TAGS.has('_PRIM')).toBe(true);
    });
});
