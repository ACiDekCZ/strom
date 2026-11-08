/**
 * Another program's own tags beyond the person and the family (spec 066 G8):
 * the level-1 `_XXX` of a source record (MyHeritage's `_TYPE`, `_MEDI`) is
 * kept as written for "Back to {prog}" and goes back into the same record; a
 * picture's `_DATE` under its OBJE stays with the photo or attachment it
 * becomes and goes back under that OBJE; a repository's or a note record's
 * own tag, which has nowhere to stay, is counted instead of vanishing.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { cleanImportOrigin, keepImports, pruneImportOrigin } from '../import-origin.js';
import { GedcomExtra, Person, Source, StromData } from '../types.js';

const ORIGIN: GedcomImportOrigin = { at: '2026-11-08', file: 'export.ged', encoding: 'utf-8' };

function load(text: string, origin: GedcomImportOrigin | null = ORIGIN) {
    return convertToStrom(parseGedcom(text), origin ? { importOrigin: origin } : {});
}

/** The lines of the record whose first line matches. */
function recordOf(ged: string, match: (head: string, body: string[]) => boolean): string[] {
    const recs = ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/).filter(l => l !== ''));
    const rec = recs.find(r => match(r[0], r));
    if (!rec) throw new Error('no record');
    return rec;
}

const sourceRecord = (ged: string, title: string) =>
    recordOf(ged, (head, body) => / SOUR$/.test(head) && body.includes(`1 TITL ${title}`));

function byName(data: StromData, first: string): Person {
    const p = Object.values(data.persons).find(x => x.firstName === first);
    if (!p) throw new Error(`no ${first}`);
    return p;
}

function sourceTitled(data: StromData, title: string): Source {
    const s = Object.values(data.sources ?? {}).find(x => x.title === title);
    if (!s) throw new Error(`no ${title}`);
    return s;
}

/** A tiny JPEG header the import takes as an image. */
function jpeg(width: number, height: number): string {
    const bytes = [0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
        0xFF, 0xC0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9];
    return 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...bytes));
}
const PORTRAIT = jpeg(300, 400);
const LETTER = jpeg(800, 600);

const MYHERITAGE = `0 HEAD
1 SOUR MYHERITAGE
2 NAME MyHeritage Family Tree Builder
2 VERS 5.5.1
1 DATE 8 NOV 2026
1 CHAR UTF-8
0 @I500001@ INDI
1 _UPD 8 NOV 2026 10:00:00 GMT -0500
1 NAME Mlhoslav /Řepíček/
1 SEX M
1 SOUR @S500001@
1 NOTE @N1@
1 OBJE
2 FORM jpg
2 FILE https://www.myheritage.com/photos/mlhoslav.jpg
2 _FILESIZE 2382484
2 _DATE 24 JUL 2007
2 _PRIM Y
2 _PHOTO_RIN MH:P500013
1 OBJE
2 _STROM_KIND photo
2 FILE ${PORTRAIT}
2 _DATE 3 MAR 1931
1 OBJE
2 TITL Dopis z Kořenova
2 FILE ${LETTER}
2 _DATE ABT 1925
1 OBJE @O1@
1 RIN MH:I500001
1 _UID 5F3A1B2C3D4E5F60718293A4B5C6D7E9
0 @S500001@ SOUR
1 _UPD 18 JUL 2018 11:47:11 GMT -0500
1 TITL Birth register
1 TEXT Some text
1 _TYPE Discovery
1 _MEDI 45329791-1
1 REPO @R1@
0 @R1@ REPO
1 NAME Archiv Kořenov
1 _RPLACE Kořenov
2 _RSUB nahoře
0 @N1@ NOTE Narozen za bouřky
1 _NFLAG Y
0 @O1@ OBJE
1 FILE https://www.myheritage.com/photos/statek.jpg
1 _DATE 1 JAN 1930
0 TRLR
`;

// The change stamp too (_UPD): back with the record, never counted.
const SOURCE_KEPT = ['1 _UPD 18 JUL 2018 11:47:11 GMT -0500', '1 _TYPE Discovery', '1 _MEDI 45329791-1'];

describe('a source record’s own tags of another program', () => {
    it('are kept on the source as written, with the import they came from, and never counted as unsupported', () => {
        const r = load(MYHERITAGE);
        expect(sourceTitled(r.data, 'Birth register').gedcomExtra).toEqual([{ from: 'I1', lines: SOURCE_KEPT }]);
        expect(r.stats.keptTagSummary.split(', ').sort()).toEqual(['_MEDI', '_TYPE']);
        expect(r.stats.keptTags).toBe(2);
        expect(r.stats.droppedTagSummary).not.toMatch(/_TYPE|_MEDI|_DATE/);
    });

    it('the MyHeritage source alone: nothing unsupported, both kept', () => {
        const r = load(`0 HEAD
1 SOUR MYHERITAGE
2 NAME MyHeritage Family Tree Builder
1 CHAR UTF-8
0 @S500001@ SOUR
1 TITL Birth register
1 TEXT Some text
1 _TYPE Discovery
1 _MEDI 45329791-1
0 TRLR
`);
        expect(r.stats.unsupportedTags).toBe(0);
        expect(r.stats.droppedTagSummary).toBe('');
        expect(r.stats.keptTags).toBe(2);
    });

    it('"Back to MyHeritage" writes them at the end of the same source record, byte for byte', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const ged = exportToGedcom(data, 'Řepíček', { backTo: 'I1' }).content;
        const rec = sourceRecord(ged, 'Birth register');
        expect(rec.slice(-SOURCE_KEPT.length)).toEqual(SOURCE_KEPT);
        expect(ged.split('\n').filter(l => l.startsWith('1 _TYPE') || l.startsWith('1 _MEDI'))).toEqual(SOURCE_KEPT.slice(1));
    });

    it('Strom’s own export, the research’s, and back to another program write none of them', () => {
        const data = migrateData(load(MYHERITAGE).data);
        for (const ged of [exportToGedcom(data).content, exportToGedcom(data, 'x', { research: { id: 'r-test' }, titles: 'tags', readings: false }).content]) {
            expect(ged).not.toContain('_MEDI');
            expect(ged).not.toContain('_TYPE Discovery');
        }
        data.imports!.push({ id: 'I2', program: 'Gramps', at: '2026-11-08', file: 'other.ged' });
        expect(exportToGedcom(data, 'x', { backTo: 'I2' }).content).not.toContain('_MEDI');
    });

    it('a file not loaded as an import keeps nothing and counts them', () => {
        const r = load(MYHERITAGE, null);
        expect(sourceTitled(r.data, 'Birth register').gedcomExtra).toBeUndefined();
        expect(r.stats.droppedTagSummary).toContain('_TYPE');
        expect(r.stats.droppedTagSummary).toContain('_MEDI');
    });

    it('they survive a save and load; cleaning drops broken blocks and unknown imports', () => {
        const data = migrateData(JSON.parse(JSON.stringify(load(MYHERITAGE).data)));
        const src = sourceTitled(data, 'Birth register');
        expect(src.gedcomExtra).toEqual([{ from: 'I1', lines: SOURCE_KEPT }]);
        src.gedcomExtra = [
            { from: 'I1', lines: ['1 _A x', '1 _BAD\nline', '1 TITL not ours'] },
            { from: 'I9', lines: ['1 _B'] },
            'junk',
        ] as unknown as GedcomExtra[];
        cleanImportOrigin(data, data.imports);
        expect(src.gedcomExtra).toEqual([{ from: 'I1', lines: ['1 _A x'] }]);
        data.imports = [];
        pruneImportOrigin(data);
        expect(src.gedcomExtra).toBeUndefined();
    });

    it('a research version keeps the tree’s own (the research never has them), matched by the record id', () => {
        const previous = migrateData(load(MYHERITAGE).data);
        sourceTitled(previous, 'Birth register').refn = 'S0042';
        const next = structuredClone(previous);
        const nextSrc = sourceTitled(next, 'Birth register');
        delete nextSrc.gedcomExtra;
        // The research's copy of the source under another id.
        delete next.sources![nextSrc.id];
        next.sources!['src_research'] = { ...nextSrc, id: 'src_research' };
        const kept = keepImports(next, previous);
        expect(kept.sources!['src_research'].gedcomExtra).toEqual([{ from: 'I1', lines: SOURCE_KEPT }]);
    });
});

describe('a picture’s _DATE', () => {
    it('is read, not counted, and goes with the picture it becomes', () => {
        const r = load(MYHERITAGE);
        const p = byName(r.data, 'Mlhoslav');
        expect(p.photoDate).toBe('3 MAR 1931');
        expect(p.attachments?.map(a => [a.name, a.date])).toEqual([['Dopis z Kořenova', 'ABT 1925']]);
        // The files the GEDCOM only names: the date waits with them (attach / download).
        expect(r.externalMedia.map(m => [m.fileName, m.date])).toEqual([
            ['mlhoslav.jpg', '24 JUL 2007'], ['statek.jpg', '1 JAN 1930'],
        ]);
        expect(r.stats.droppedTagSummary).not.toContain('_DATE');
    });

    it('"Back to MyHeritage" writes it under the picture’s OBJE; no other export does', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const back = exportToGedcom(data, 'Řepíček', { backTo: 'I1' }).content;
        const rec = recordOf(back, head => / INDI$/.test(head));
        const objes: string[][] = [];
        for (const line of rec) {
            if (line === '1 OBJE') objes.push([]);
            else if (line.startsWith('1 ')) objes.push(['-']);
            else objes[objes.length - 1]?.push(line);
        }
        const dates = objes.filter(o => o[0] !== '-').map(o => o.filter(l => l.startsWith('2 _DATE')));
        expect(dates).toEqual([['2 _DATE 3 MAR 1931'], ['2 _DATE ABT 1925']]);
        expect(exportToGedcom(data).content).not.toContain('_DATE');
    });

    it('a date that is not one line is not kept', () => {
        const r = load(MYHERITAGE.replace('2 _DATE ABT 1925', `2 _DATE ${'9'.repeat(101)}`));
        expect(byName(r.data, 'Mlhoslav').attachments?.[0].date).toBeUndefined();
    });

    it('a research version keeps it on the same picture, never on another', () => {
        const previous = migrateData(load(MYHERITAGE).data);
        let n = 0;
        for (const p of Object.values(previous.persons)) p.refn = `P${++n}`;
        const next = structuredClone(previous);
        const p = byName(next, 'Mlhoslav');
        delete p.photoDate;
        for (const a of p.attachments ?? []) { delete a.date; a.id = 'att_research'; }
        const kept = byName(keepImports(next, previous), 'Mlhoslav');
        expect(kept.photoDate).toBe('3 MAR 1931');
        expect(kept.attachments?.[0].date).toBe('ABT 1925');
        // Another picture in the research's version: no date carried over to it.
        const other = structuredClone(previous);
        byName(other, 'Mlhoslav').photo = LETTER;
        delete byName(other, 'Mlhoslav').photoDate;
        expect(byName(keepImports(other, previous), 'Mlhoslav').photoDate).toBeUndefined();
    });
});

describe('records that do not stay as records', () => {
    it('a repository’s and a note record’s own tags are counted, not lost without a word', () => {
        const r = load(MYHERITAGE);
        const summary = r.stats.droppedTagSummary;
        expect(summary).toContain('_RPLACE');
        expect(summary).toContain('_NFLAG');
        // Lines under a counted tag are not counted again.
        expect(summary).not.toContain('_RSUB');
        expect(r.stats.unsupportedTags).toBe(2);
    });
});
