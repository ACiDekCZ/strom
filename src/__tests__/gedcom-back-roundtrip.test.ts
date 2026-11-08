/**
 * "Back to {prog}" gives back what the import brought (spec 066 K3.1/K3.2),
 * on a file shaped like MyHeritage's (Family Tree Builder, GEDCOM 5.5.1):
 * nameless people with SEX U and only FAMS, EMAIL, GIVN/SURN, the _UPD stamp,
 * families without MARR, a child recorded in two families. And the research's
 * file read and written again keeps where its records and facts came from.
 * Invented data.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { DataManager, migrateData } from '../data.js';
import { applyLivingPrivacy, CONTENT_PRESETS, PrivacyMode, resolveContentOptions } from '../privacy.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StorageManager } from '../storage.js';
import { createMergeState } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { dropMediaLink } from '../import-origin.js';
import { Partnership, Person, StromData, TreeId } from '../types.js';
import { shownName } from '../person-name.js';

const ORIGIN: GedcomImportOrigin = { at: '2026-11-08', file: 'family.ged', encoding: 'utf-8' };

const MYHERITAGE = `0 HEAD
1 SOUR MYHERITAGE
2 NAME MyHeritage Family Tree Builder
2 VERS 5.5.1
1 DATE 2 OCT 2026
1 CHAR UTF-8
0 @I500001@ INDI
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 NAME Hromoslav /Ozubec/
2 GIVN Hromoslav
2 SURN Ozubec
1 SEX M
1 BIRT
2 DATE 1880
1 RESI
2 EMAIL hromoslav@@example.org
1 FAMS @F500001@
1 RIN MH:I500001
1 _UID 5F3A1B2C3D4E5F60718293A4B5C6D7E8
0 @I500002@ INDI
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 NAME Libuna /Šťovíková/
2 GIVN Libuna
2 SURN Šťovíková
1 SEX F
1 BIRT
2 DATE 1884
1 FAMS @F500001@
1 RIN MH:I500002
1 _UID 6A3A1B2C3D4E5F60718293A4B5C6D7E9
0 @I500003@ INDI
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 NAME Mlhoň /Ozubec/
2 GIVN Mlhoň
2 SURN Ozubec
1 SEX M
1 BIRT
2 DATE 1906
1 FAMC @F500001@
1 FAMC @F500002@
2 PEDI adopted
1 FAMS @F500003@
1 RIN MH:I500003
1 _UID 7B3A1B2C3D4E5F60718293A4B5C6D7EA
0 @I500004@ INDI
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 NAME //
1 SEX U
1 FAMS @F500002@
1 RIN MH:I500004
1 _UID 9D3A1B2C3D4E5F60718293A4B5C6D7EC
0 @I500005@ INDI
1 NAME Zbyhoň /Pražmouk/
2 GIVN Zbyhoň
2 SURN Pražmouk
1 SEX M
1 BIRT
2 DATE 1875
1 FAMS @F500002@
1 RIN MH:I500005
1 _UID AE3A1B2C3D4E5F60718293A4B5C6D7ED
0 @I500006@ INDI
1 NAME //
1 SEX U
1 FAMS @F500003@
1 RIN MH:I500006
1 _UID BF3A1B2C3D4E5F60718293A4B5C6D7EE
0 @F500001@ FAM
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 HUSB @I500001@
1 WIFE @I500002@
1 CHIL @I500003@
1 MARR
2 DATE 1905
1 RIN MH:F500001
1 _UID 8C3A1B2C3D4E5F60718293A4B5C6D7EB
0 @F500002@ FAM
1 HUSB @I500005@
1 WIFE @I500004@
1 CHIL @I500003@
1 RIN MH:F500002
1 _UID CA3A1B2C3D4E5F60718293A4B5C6D7EF
0 @F500003@ FAM
1 HUSB @I500003@
1 WIFE @I500006@
1 RIN MH:F500003
1 _UID DB3A1B2C3D4E5F60718293A4B5C6D7F0
0 TRLR`;

/** The tags the "done when" counts, each at the level the file writes it. */
const COUNTED: [string, RegExp][] = [
    ['INDI', /^0 @[^@]+@ INDI$/], ['FAM', /^0 @[^@]+@ FAM$/],
    ['_UID', /^1 _UID /], ['RIN', /^1 RIN /], ['HUSB', /^1 HUSB /], ['WIFE', /^1 WIFE /],
    ['CHIL', /^1 CHIL /], ['FAMC', /^1 FAMC /], ['PEDI', /^2 PEDI /], ['EMAIL', /^2 EMAIL /],
    ['GIVN', /^2 GIVN /], ['SURN', /^2 SURN /], ['MARR', /^1 MARR$/], ['_UPD', /^1 _UPD /],
];

function counts(ged: string): Record<string, number> {
    const lines = ged.split(/\r?\n/);
    return Object.fromEntries(COUNTED.map(([tag, re]) => [tag, lines.filter(l => re.test(l)).length]));
}

function load(text: string, origin: GedcomImportOrigin | null = ORIGIN) {
    return convertToStrom(parseGedcom(text), origin ? { importOrigin: origin } : {});
}

/** The export "Back to {prog}" as the app makes it (import-export.ts), for the tree's first import. */
function backTo(data: StromData, privacy: PrivacyMode = 'full'): string {
    const out = applyLivingPrivacy(data, privacy, 2026, { keepDeceasedSources: true });
    return exportToGedcom(out, 'Ozubec', { content: CONTENT_PRESETS.back, origins: true, backTo: data.imports![0].id }).content;
}

/** One record's lines, by its xref. */
function record(ged: string, xref: string): string[] {
    const lines = ged.split('\n');
    const start = lines.indexOf(`0 ${xref} ${xref.startsWith('@F') ? 'FAM' : 'INDI'}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((l, i) => i > start && l.startsWith('0 '));
    return lines.slice(start, end);
}

const body = (ged: string): string[] => ged.split('\n').slice(ged.split('\n').findIndex(l => /^0 @(?!SUBM)/.test(l)));

const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;

describe('"Back to MyHeritage" gives back what the file brought', () => {
    it('the same people, families, ids, links, e-mail and name parts, and no MARR the file did not have', () => {
        const r = load(MYHERITAGE);
        const ged = backTo(migrateData(r.data));
        expect(counts(ged)).toEqual(counts(MYHERITAGE));
        // The nameless people are records of their own, with their xref.
        expect(record(ged, '@I500004@')).toEqual(expect.arrayContaining(['1 NAME //', '1 SEX U', '1 FAMS @F500002@', '1 _UID 9D3A1B2C3D4E5F60718293A4B5C6D7EC']));
        expect(record(ged, '@F500003@')).toEqual(expect.arrayContaining(['1 HUSB @I500003@', '1 WIFE @I500006@']));
        expect(record(ged, '@F500002@')).not.toContain('1 MARR');
        expect(record(ged, '@F500001@')).toContain('1 MARR');
        // The e-mail as written, not as a line of a note.
        expect(record(ged, '@I500001@')).toContain('2 EMAIL hromoslav@@example.org');
        expect(ged).not.toMatch(/NOTE .*hromoslav@/);
    });

    it('a "?" the import made up for a parent the file does not name stays out, as before', () => {
        const oneParent = MYHERITAGE.replace('0 TRLR', [
            '0 @I500007@ INDI', '1 NAME Bořivoj /Ozubec/', '2 GIVN Bořivoj', '2 SURN Ozubec', '1 SEX M', '1 FAMC @F500004@', '1 _UID C03A1B2C3D4E5F60718293A4B5C6D7F1',
            '0 @F500004@ FAM', '1 HUSB @I500001@', '1 CHIL @I500007@', '1 _UID C13A1B2C3D4E5F60718293A4B5C6D7F2', '0 TRLR',
        ].join('\n'));
        const data = migrateData(load(oneParent).data);
        expect(Object.values(data.persons).filter(p => p.isPlaceholder)).toHaveLength(3);
        const ged = backTo(data);
        expect(counts(ged)).toEqual(counts(oneParent));
        expect(record(ged, '@F500004@').some(l => l.startsWith('1 WIFE'))).toBe(false);
    });

    it('the stamp _UPD is kept and goes back, but the summary never names it', () => {
        const r = load(MYHERITAGE);
        expect(r.stats.droppedTagSummary).not.toContain('_UPD');
        expect(r.stats.keptTagSummary).not.toContain('_UPD');
        expect(record(backTo(migrateData(r.data)), '@F500001@')).toContain('1 _UPD 2 OCT 2026 10:00:00 GMT -0500');
    });

    it('a second pass (the file read again, written again) takes nothing away', () => {
        const first = backTo(migrateData(load(MYHERITAGE).data));
        const again = migrateData(load(first, { at: '2026-11-09', file: 'back.ged', encoding: 'utf-8' }).data);
        const second = backTo(again);
        expect(counts(second)).toEqual(counts(MYHERITAGE));
        expect(body(second)).toEqual(body(first));
    });

    it('with the initials of the living the families stay whole: every person and both partners of each family', () => {
        const ged = backTo(migrateData(load(MYHERITAGE).data), 'initials');
        const c = counts(ged);
        expect([c.INDI, c.FAM, c.HUSB, c.WIFE]).toEqual([6, 3, 3, 3]);
        // The nameless partners count as living: no id of theirs in the other program.
        expect(ged).not.toContain('9D3A1B2C3D4E5F60718293A4B5C6D7EC');
        expect(ged).not.toContain('BF3A1B2C3D4E5F60718293A4B5C6D7EE');
    });

    it('GIVN/SURN come from the name as it is now; e-mail only while its line is in the note', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const h = byName(data, 'Hromoslav');
        h.firstName = 'Hromislav';
        const resi = h.events!.find(e => e.type === 'residence')!;
        resi.note = undefined;
        const rec = record(backTo(data), '@I500001@');
        expect(rec).toEqual(expect.arrayContaining(['1 NAME Hromislav /Ozubec/', '2 GIVN Hromislav', '2 SURN Ozubec']));
        expect(rec.some(l => l.includes('EMAIL'))).toBe(false);
    });

    it('another export (Strom’s own file, the research) writes the e-mail as the note line and no GIVN/SURN of its own', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const ged = exportToGedcom(data, 'Ozubec', { research: { id: 'r-test' }, origins: true }).content;
        expect(ged).not.toContain('2 EMAIL');
        expect(ged).toMatch(/2 NOTE .*hromoslav@@example\.org/);
    });
});

/** Two source records cited 17 times at 15 pages, two of the citations with the entry's date. */
const SOURCES = `0 HEAD
1 SOUR MYHERITAGE
2 NAME MyHeritage Family Tree Builder
2 VERS 5.5.1
1 DATE 2 OCT 2026
1 CHAR UTF-8
0 @I500001@ INDI
1 NAME Hromoslav /Ozubec/
1 SEX M
1 BIRT
2 DATE 1880
2 SOUR @S500001@
3 PAGE p. 2
3 QUAY 3
1 DEAT
2 DATE 1950
2 SOUR @S500001@
3 PAGE p. 3
3 DATA
4 DATE 5 MAY 1950
1 SOUR @S500001@
2 PAGE p. 1
1 SOUR @S500002@
2 PAGE Sheet 1
1 FAMS @F500001@
0 @I500002@ INDI
1 NAME Libuna /Šťovíková/
1 SEX F
1 BIRT
2 DATE 1884
2 SOUR @S500001@
3 PAGE p. 4
1 SOUR @S500001@
2 PAGE p. 1
1 SOUR @S500002@
2 PAGE Sheet 2
1 FAMS @F500001@
0 @I500003@ INDI
1 NAME Mlhoň /Ozubec/
1 SEX M
1 BIRT
2 DATE 1906
2 SOUR @S500001@
3 PAGE p. 5
2 SOUR @S500002@
3 PAGE Sheet 3
1 RESI
2 PLAC Ozubcov
2 SOUR @S500002@
3 PAGE Sheet 4
3 DATA
4 DATE 1 JUN 1900
1 SOUR @S500001@
2 PAGE p. 6
1 SOUR @S500002@
1 FAMC @F500001@
0 @I500004@ INDI
1 NAME Zbyhoň /Pražmouk/
1 SEX M
1 BIRT
2 DATE 1875
2 SOUR @S500001@
3 PAGE p. 7
1 SOUR @S500002@
2 PAGE Sheet 5
1 SOUR @S500001@
2 PAGE p. 8
0 @F500001@ FAM
1 HUSB @I500001@
1 WIFE @I500002@
1 CHIL @I500003@
1 MARR
2 DATE 1905
2 SOUR @S500001@
3 PAGE p. 9
2 SOUR @S500002@
3 PAGE Sheet 6
0 @S500001@ SOUR
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 TITL Parish register of Ozubcov
1 AUTH Ozubcov parish office
1 TEXT Births and deaths 1870-1950
1 _TYPE Church record
1 _MEDI Book
0 @S500002@ SOUR
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 TITL Census of Zbyhoňov 1900
1 AUTH District office
1 _TYPE Census
1 _MEDI Microfilm
0 TRLR`;

/** Every citation of a file: its record, its fact (level-1 tag, '' for the record), source xref, PAGE, DATA > DATE, QUAY. */
function citations(ged: string): string[] {
    const out: string[] = [];
    let owner = '';
    let fact = '';
    let open: { level: number; owner: string; fact: string; xref: string; page: string; date: string; quay: string } | null = null;
    const close = (): void => {
        if (open) out.push([open.owner, open.fact, open.xref, open.page, open.date, open.quay].join('|'));
        open = null;
    };
    for (const line of ged.split(/\r?\n/)) {
        const m = line.match(/^(\d+) (?:(@[^@]+@) )?(\S+)(?: (.*))?$/);
        if (!m) continue;
        const level = Number(m[1]);
        if (open && level <= open.level) close();
        if (level === 0) owner = m[2] ?? m[3];
        if (level === 1) fact = m[3];
        if (m[3] === 'SOUR' && level > 0 && /^@[^@]+@$/.test(m[4] ?? '')) {
            open = { level, owner, fact: level === 1 ? '' : fact, xref: m[4]!, page: '', date: '', quay: '' };
        } else if (open && m[3] === 'PAGE') open.page = m[4] ?? '';
        else if (open && m[3] === 'DATE') open.date = m[4] ?? '';
        else if (open && m[3] === 'QUAY') open.quay = m[4] ?? '';
    }
    close();
    return out.sort();
}

/** A source record's lines, by its xref. */
function sourceRecord(ged: string, xref: string): string[] {
    const lines = ged.split('\n');
    const start = lines.indexOf(`0 ${xref} SOUR`);
    expect(start).toBeGreaterThanOrEqual(0);
    return lines.slice(start, lines.findIndex((l, i) => i > start && l.startsWith('0 ')));
}

const sourceRecords = (ged: string): string[] => ged.split('\n').filter(l => /^0 @[^@]+@ SOUR$/.test(l));

describe('"Back to MyHeritage": one source record cited at many pages (N-A)', () => {
    it('goes back as the same record, its xref, author and tags once, each page and date on its citation', () => {
        const data = migrateData(load(SOURCES).data);
        // In the app every page is a source of its own (the entry), as before.
        expect(Object.keys(data.sources!)).toHaveLength(16);
        const ged = backTo(data);
        expect(sourceRecords(ged)).toEqual(['0 @S500001@ SOUR', '0 @S500002@ SOUR']);
        expect(citations(ged)).toEqual(citations(SOURCES));
        const parish = sourceRecord(ged, '@S500001@');
        expect(parish).toEqual(expect.arrayContaining(['1 TITL Parish register of Ozubcov', '1 AUTH Ozubcov parish office',
            '1 TEXT Births and deaths 1870-1950', '1 _TYPE Church record', '1 _MEDI Book', '1 _UPD 2 OCT 2026 10:00:00 GMT -0500']));
        expect(parish.filter(l => /^1 (_TYPE|_MEDI|_UPD|AUTH) /.test(l))).toHaveLength(4);
        expect(parish.some(l => /^1 (PAGE|NOTE) /.test(l))).toBe(false);
        expect(sourceRecord(ged, '@S500002@')).toEqual(expect.arrayContaining(['1 AUTH District office', '1 _TYPE Census', '1 _MEDI Microfilm']));
        expect(ged).not.toMatch(/NOTE .*Ozubcov parish office/);
    });

    it('a second pass keeps it so', () => {
        const first = backTo(migrateData(load(SOURCES).data));
        const second = backTo(migrateData(load(first, { at: '2026-11-09', file: 'back.ged', encoding: 'utf-8' }).data));
        expect(citations(second)).toEqual(citations(SOURCES));
        expect(body(second)).toEqual(body(first));
    });

    it('with the initials of the living, still the two records', () => {
        const ged = backTo(migrateData(load(SOURCES).data), 'initials');
        expect(sourceRecords(ged)).toEqual(['0 @S500001@ SOUR', '0 @S500002@ SOUR']);
    });

    it('another export keeps every page a source of its own, its page on the record and on the citation', () => {
        const data = migrateData(load(SOURCES).data);
        const ged = exportToGedcom(data, 'Ozubec', { origins: true }).content;
        expect(sourceRecords(ged)).toHaveLength(16);
        const withoutIds = (list: string[]): string[] => list.map(c => c.split('|')).map(([, fact, , ...rest]) => [fact, ...rest].join('|')).sort();
        expect(withoutIds(citations(ged))).toEqual(withoutIds(citations(SOURCES)));
        // The author stays a line of the note there.
        expect(ged).toMatch(/NOTE .*Ozubcov parish office/);
    });

    it('a tree imported before (no record ids on its sources) takes them from the same file merged again', async () => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
        const existing = migrateData(load(SOURCES).data);
        for (const src of Object.values(existing.sources!)) { delete src.originalIds; delete src.gedcomAuthor; }
        expect(sourceRecords(backTo(existing))).toHaveLength(16);
        const incoming = migrateData(load(SOURCES, { at: '2026-11-09', file: 'family.ged', encoding: 'utf-8' }).data);
        const merged = (await executeMerge(createMergeState(existing, incoming))).mergedData;
        const ged = backTo(merged);
        expect(sourceRecords(ged)).toEqual(['0 @S500001@ SOUR', '0 @S500002@ SOUR']);
        expect(citations(ged)).toEqual(citations(SOURCES));
        expect(sourceRecord(ged, '@S500001@')).toContain('1 AUTH Ozubcov parish office');
    });
});

describe('a tree loaded before e-mail and couples without MARR were kept, merged with the same file again (P-c)', () => {
    it('takes them: "Back to MyHeritage" gives the e-mail and no empty MARR', async () => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
        const existing = migrateData(load(MYHERITAGE).data);
        for (const p of Object.values(existing.persons)) for (const ev of p.events ?? []) delete ev.gedcomEmails;
        for (const ps of Object.values(existing.partnerships)) delete ps.marriageUnrecorded;
        const before = counts(backTo(existing));
        expect([before.EMAIL, before.MARR]).toEqual([0, 3]);
        const incoming = migrateData(load(MYHERITAGE, { at: '2026-11-09', file: 'family.ged', encoding: 'utf-8' }).data);
        const merged = (await executeMerge(createMergeState(existing, incoming))).mergedData;
        expect(counts(backTo(merged))).toEqual(counts(MYHERITAGE));
    });

    it('a couple whose wedding the tree says something of keeps its MARR', async () => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
        const existing = migrateData(load(MYHERITAGE).data);
        for (const ps of Object.values(existing.partnerships)) { delete ps.marriageUnrecorded; ps.startPlace = 'Mechovka'; }
        const incoming = migrateData(load(MYHERITAGE, { at: '2026-11-09', file: 'family.ged', encoding: 'utf-8' }).data);
        const merged = (await executeMerge(createMergeState(existing, incoming))).mergedData;
        expect(Object.values(merged.partnerships).some(ps => ps.marriageUnrecorded)).toBe(false);
    });
});

describe('a picture linked by path or address, with no file taken in (P-b)', () => {
    const OBJE = ['1 OBJE', '2 FORM jpg', '2 FILE https://example.org/photos/hromoslav.jpg', '2 TITL Hromoslav 1930', '2 _DATE 1930', '2 _PRIM Y'];
    const OBJE2 = ['1 OBJE', '2 FORM jpg', '2 FILE C:\\Photos\\wedding.jpg', '2 _DATE 12 MAY 1905'];
    const file = MYHERITAGE.replace('1 FAMS @F500001@\n1 RIN MH:I500001', ['1 FAMS @F500001@', ...OBJE, ...OBJE2, '1 RIN MH:I500001'].join('\n'));

    it('goes back as the file wrote it, its _DATE with it; the summary does not name it as kept', () => {
        const r = load(file);
        expect(r.externalMedia).toHaveLength(2);
        expect(r.stats.keptTagSummary ?? '').not.toContain('OBJE');
        const rec = record(backTo(migrateData(r.data)), '@I500001@');
        for (const block of [OBJE, OBJE2]) {
            const at = rec.indexOf(block[2]);
            expect(rec.slice(at - 2, at - 2 + block.length)).toEqual(block);
        }
        // Another export does not write it (the app has no picture there).
        expect(exportToGedcom(migrateData(r.data), 'Ozubec', { origins: true }).content).not.toContain('hromoslav.jpg');
    });

    it('once its file is taken in, the link is not written as well', () => {
        const data = migrateData(load(file).data);
        dropMediaLink(byName(data, 'Hromoslav'), 'https://example.org/photos/hromoslav.jpg');
        const rec = record(backTo(data), '@I500001@');
        expect(rec.some(l => l.includes('hromoslav.jpg'))).toBe(false);
        expect(rec).toContain('2 _DATE 12 MAY 1905');
    });
});

describe('a couple without MARR in its file', () => {
    it('is noted on import, a couple with one is not', () => {
        const data = load(MYHERITAGE).data;
        const marked = Object.values(data.partnerships).filter(p => p.marriageUnrecorded).length;
        expect(marked).toBe(2);
    });

    it('a couple entered by hand, married, still gets its MARR in every export', () => {
        const data = migrateData(load(MYHERITAGE).data);
        for (const p of Object.values(data.partnerships)) delete p.marriageUnrecorded;
        expect(counts(backTo(data)).MARR).toBe(3);
    });

    it('a wedding detail added later writes it', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const ps = Object.values(data.partnerships).find(p => p.marriageUnrecorded)!;
        ps.startPlace = 'Mechovka';
        expect(counts(backTo(data)).MARR).toBe(2);
    });

    it('a status set in the app is said, not the file’s default any more', () => {
        const TREE = 'back-roundtrip-tree' as TreeId;
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = migrateData(load(MYHERITAGE).data);
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
        const [a, b] = Object.values(dm.data.partnerships).filter(p => p.marriageUnrecorded) as Partnership[];
        DataManager.updatePartnershipStatus(a.id, 'divorced');
        DataManager.updatePartnership(b.id, { status: 'divorced' });
        expect(dm.data.partnerships[a.id].marriageUnrecorded).toBeUndefined();
        expect(dm.data.partnerships[b.id].marriageUnrecorded).toBeUndefined();
        vi.restoreAllMocks();
    });
});

describe('a child recorded in two families (N3)', () => {
    it('goes back as the second FAMC with its PEDI and the family’s CHIL, not as a note', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const m = byName(data, 'Mlhoň');
        expect(m.alsoChildOf).toHaveLength(1);
        for (const ged of [backTo(data), exportToGedcom(data, 'Ozubec', { research: { id: 'r-test' }, origins: true }).content]) {
            const lines = ged.split('\n');
            const rec = record(ged, ged.includes('0 @I500003@ INDI') ? '@I500003@' : lines.find(l => /^0 @I\d+@ INDI$/.test(l) && record(ged, l.split(' ')[1]).includes('1 NAME Mlhoň /Ozubec/'))!.split(' ')[1]);
            const famc = rec.filter(l => l.startsWith('1 FAMC '));
            expect(famc).toHaveLength(2);
            expect(rec[rec.indexOf(famc[1]) + 1]).toBe('2 PEDI adopted');
            expect(record(ged, famc[1].slice(7))).toContain(`1 CHIL ${rec[0].split(' ')[1]}`);
            expect(rec.some(l => l.startsWith('1 NOTE'))).toBe(false);
        }
    });

    it('read back, the child hangs from the same family and keeps the other one', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const again = migrateData(load(backTo(data), { at: '2026-11-09', file: 'back.ged', encoding: 'utf-8' }).data);
        const m = byName(again, 'Mlhoň');
        const parents = m.parentIds.map(id => again.persons[id].firstName).sort();
        expect(parents).toEqual(['Hromoslav', 'Libuna']);
        expect(m.alsoChildOf).toHaveLength(1);
        expect(m.notes?.split('\n')).toHaveLength(1);
    });

    it('a second family with one parent, and a family of one spouse with nothing but its ids, go back whole (N-A, N-B)', () => {
        const file = MYHERITAGE
            .replace('1 FAMS @F500001@\n1 RIN MH:I500001', '1 FAMS @F500001@\n1 FAMS @F500006@\n1 RIN MH:I500001')
            .replace('1 FAMS @F500002@\n1 RIN MH:I500005', '1 FAMS @F500002@\n1 FAMS @F500005@\n1 RIN MH:I500005')
            .replace('1 CHIL @I500003@\n1 MARR', '1 CHIL @I500003@\n1 CHIL @I500008@\n1 MARR')
            .replace('0 TRLR', [
                // Bořivoj hangs from Hromoslav and Libuna; Zbyhoň alone adopted him.
                '0 @I500008@ INDI', '1 NAME Bořivoj /Ozubec/', '2 GIVN Bořivoj', '2 SURN Ozubec', '1 SEX M',
                '1 FAMC @F500001@', '1 FAMC @F500005@', '2 PEDI adopted', '1 _UID C03A1B2C3D4E5F60718293A4B5C6D7F1',
                '0 @F500005@ FAM', '1 HUSB @I500005@', '1 CHIL @I500008@', '1 _UID C13A1B2C3D4E5F60718293A4B5C6D7F2',
                // Hromoslav's family of his own: no spouse, no children, no events.
                '0 @F500006@ FAM', '1 _UPD 3 OCT 2026 11:00:00 GMT -0500', '1 HUSB @I500001@', '1 RIN MH:F500006', '1 _UID C23A1B2C3D4E5F60718293A4B5C6D7F3',
                '0 TRLR',
            ].join('\n'));
        const data = migrateData(load(file).data);
        const b = byName(data, 'Bořivoj');
        expect(b.alsoChildOf).toHaveLength(1);
        const ged = backTo(data);
        expect(counts(ged)).toEqual(counts(file));
        const rec = record(ged, '@I500008@');
        expect(rec).toEqual(expect.arrayContaining(['1 FAMC @F500001@', '1 FAMC @F500005@', '2 PEDI adopted']));
        expect(rec.some(l => l.startsWith('1 NOTE'))).toBe(false);
        expect(record(ged, '@F500005@')).toEqual(expect.arrayContaining(['1 HUSB @I500005@', '1 CHIL @I500008@', '1 _UID C13A1B2C3D4E5F60718293A4B5C6D7F2']));
        expect(record(ged, '@F500006@')).toEqual(expect.arrayContaining(['1 HUSB @I500001@', '1 RIN MH:F500006',
            '1 _UID C23A1B2C3D4E5F60718293A4B5C6D7F3', '1 _UPD 3 OCT 2026 11:00:00 GMT -0500']));
        // Read again and written again: the same.
        const second = backTo(migrateData(load(ged, { at: '2026-11-09', file: 'back.ged', encoding: 'utf-8' }).data));
        expect(body(second)).toEqual(body(ged));
    });

    it('the research’s file: a second family with one parent keeps its link and every family its import, no note made up', () => {
        const data = migrateData(load(RESEARCH_FAMILIES, null).data);
        const m = byName(data, 'Mlhoň');
        expect(m.alsoChildOf).toHaveLength(1);
        const count = (ged: string, re: RegExp) => ged.split('\n').filter(l => re.test(l)).length;
        for (const ged of [exportToGedcom(data, 'Ozubec', { origins: true }).content, exportToGedcom(data, 'Ozubec', { research: { id: 'r-test' } }).content]) {
            expect(count(ged, /^0 @[^@]+@ FAM$/)).toBe(4);
            expect(count(ged, /^1 FAMC /)).toBe(count(RESEARCH_FAMILIES, /^1 FAMC /));
            expect(count(ged, /^1 NOTE (?!Strom surname)/)).toBe(0);
        }
        const file = exportToGedcom(data, 'Ozubec', { origins: true }).content;
        expect(count(file, /^1 _STROM_IMPORT R1$/)).toBe(count(RESEARCH_FAMILIES, /^1 _STROM_IMPORT R1$/));
        expect(count(file, /^2 _XREF /)).toBe(count(RESEARCH_FAMILIES, /^2 _XREF /));
    });

    it('the research’s family of one parent written as no couple (its _STROM_NO_COUPLE), with or without its import, stays a family: the child keeps both FAMC and its PEDI', () => {
        const noCouple = RESEARCH_FAMILIES.replace('2 _XREF @F500003@\n1 HUSB @I4@\n1 CHIL @I3@\n', '2 _XREF @F500003@\n1 HUSB @I4@\n1 CHIL @I3@\n1 _STROM_NO_COUPLE Y\n');
        expect(noCouple).not.toBe(RESEARCH_FAMILIES);
        // A family the research made itself carries no import.
        const ownFamily = noCouple.replace('0 @F3@ FAM\n1 _STROM_IMPORT R1\n2 _XREF @F500003@\n', '0 @F3@ FAM\n');
        const foster = ownFamily.replace('1 FAMC @F3@\n2 PEDI adopted', '1 FAMC @F3@\n2 PEDI foster');
        const count = (ged: string, re: RegExp) => ged.split('\n').filter(l => re.test(l)).length;
        for (const [text, pedi] of [[noCouple, 'adopted'], [ownFamily, 'adopted'], [foster, 'foster']] as const) {
            const data = migrateData(load(text, null).data);
            const m = byName(data, 'Mlhoň');
            expect(m.alsoChildOf?.map(l => l.pedi)).toEqual([pedi]);
            const sync = exportToGedcom(structuredClone(data), 'Ozubec', { research: { id: 'r-test' } }).content;
            const file = exportToGedcom(structuredClone(data), 'Ozubec', { origins: true }).content;
            for (const ged of [sync, file]) {
                expect(count(ged, /^0 @[^@]+@ FAM$/)).toBe(4);
                expect(count(ged, /^1 FAMC /)).toBe(count(text, /^1 FAMC /));
                expect(count(ged, /^2 PEDI /)).toBe(1);
                expect(ged).toMatch(new RegExp(`1 FAMC @F\\d+@\\n2 PEDI ${pedi}\\n`));
                expect(count(ged, /^1 NOTE (?!Strom surname)/)).toBe(0);
            }
            // The app's file read again and written again: the same.
            const again = exportToGedcom(migrateData(load(file, null).data), 'Ozubec', { origins: true }).content;
            expect(body(again)).toEqual(body(file));
        }
    });

    it('a note line deleted in the app drops the link', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const m = byName(data, 'Mlhoň');
        m.notes = undefined;
        const ged = backTo(data);
        expect(record(ged, '@I500003@').filter(l => l.startsWith('1 FAMC '))).toEqual(['1 FAMC @F500001@']);
        expect(record(ged, '@F500002@')).not.toContain('1 CHIL @I500003@');
    });
});

/** The research's tree with a child in two families, the second with one parent, and a family of one spouse alone. */
const RESEARCH_FAMILIES = `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.30.0
2 NAME Strom Research
1 DATE 8 NOV 2026
1 _STROM_IMPORT R1
2 SOUR MyHeritage Family Tree Builder
2 DATE 2 OCT 2026
2 _AT 2026-11-08
2 FILE family.ged
1 CHAR UTF-8
0 @I1@ INDI
1 _STROM_IMPORT R1
2 _XREF @I500001@
1 NAME Hromoslav /Ozubec/
1 SEX M
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 _STROM_IMPORT R1
2 _XREF @I500002@
1 NAME Libuna /Šťovíková/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 _STROM_IMPORT R1
2 _XREF @I500003@
1 NAME Mlhoň /Ozubec/
1 SEX M
1 FAMC @F1@
1 FAMC @F3@
2 PEDI adopted
0 @I4@ INDI
1 _STROM_IMPORT R1
2 _XREF @I500004@
1 NAME Zbyhoň /Pražmouk/
1 SEX M
1 FAMS @F3@
1 FAMS @F4@
0 @I5@ INDI
1 _STROM_IMPORT R1
2 _XREF @I500005@
1 NAME Bořivoj /Pražmouk/
1 SEX M
1 FAMC @F4@
0 @F1@ FAM
1 _STROM_IMPORT R1
2 _XREF @F500001@
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 @F2@ FAM
1 _STROM_IMPORT R1
2 _XREF @F500002@
2 _UID AB3A1B2C3D4E5F60718293A4B5C6D7E8
1 HUSB @I1@
0 @F3@ FAM
1 _STROM_IMPORT R1
2 _XREF @F500003@
1 HUSB @I4@
1 CHIL @I3@
0 @F4@ FAM
1 _STROM_IMPORT R1
2 _XREF @F500004@
1 HUSB @I4@
1 CHIL @I5@
0 TRLR`;

/** The research's tree as it writes it: record and fact origins, a death known without a date. */
const RESEARCH = `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.30.0
2 NAME Strom Research
1 DATE 8 NOV 2026
1 _STROM_TREE 11111111-2222-3333-4444-555555555555
1 _STROM_IMPORT R1
2 SOUR MyHeritage Family Tree Builder
2 VERS 5.5.1
2 DATE 2 OCT 2026
2 _AT 2026-11-08
2 FILE family.ged
1 CHAR UTF-8
0 @I1@ INDI
1 _STROM_IMPORT R1
2 _XREF @I500001@
2 RIN MH:I500001
2 _UID 5F3A1B2C3D4E5F60718293A4B5C6D7E8
1 NAME Hromoslav /Ozubec/
2 GIVN Hromoslav
2 SURN Ozubec
2 _STROM_ORIGIN import R1
1 SEX M
1 _STROM_SEX_ORIGIN import R1
1 BIRT
2 DATE 1880
2 _STROM_ORIGIN import R1
1 DEAT Y
2 _STROM_ORIGIN import R1
1 FAMS @F1@
0 @I2@ INDI
1 _STROM_IMPORT R1
2 _XREF @I500002@
1 NAME Libuna /Šťovíková/
2 _STROM_ORIGIN import R1
1 SEX F
1 _STROM_SEX_ORIGIN import R1
1 DEAT
2 PLAC Mechovka
2 _STROM_ORIGIN import R1
1 FAMS @F1@
0 @F1@ FAM
1 _STROM_IMPORT R1
2 _XREF @F500001@
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1905
2 _STROM_ORIGIN import R1
0 TRLR`;

describe('the research’s file read and written again (P2)', () => {
    const count = (ged: string, re: RegExp) => ged.split('\n').filter(l => re.test(l)).length;

    it('each record keeps the import it came from and each fact its origin, a death without a date too', () => {
        const data = load(RESEARCH, null).data;
        expect(byName(data, 'Hromoslav').importId).toBe('R1');
        const ged = exportToGedcom(data, 'Ozubec', { origins: true }).content;
        expect(count(ged, /^1 _STROM_IMPORT R1$/)).toBe(count(RESEARCH, /^1 _STROM_IMPORT R1$/));
        expect(count(ged, /^1 _STROM_XID /)).toBe(0);
        expect(count(ged, /^2 _STROM_ORIGIN /)).toBe(count(RESEARCH, /^2 _STROM_ORIGIN /));
        const lines = ged.split('\n');
        expect(lines[lines.indexOf('1 DEAT Y') + 1]).toBe('2 _STROM_ORIGIN import R1');
    });
});

/**
 * The research's tree through the app and back (066 N-A, N-B, N-C): a child in
 * two families, the second of one parent; a death known without a date, cited;
 * an age written at the birth. Every import and origin goes back out, and the
 * app makes up no note of its own from any of it.
 */
const RESEARCH_ROUND = RESEARCH_FAMILIES
    .replace(`1 NAME Hromoslav /Ozubec/
1 SEX M
`, `1 NAME Hromoslav /Ozubec/
2 _STROM_ORIGIN import R1
1 SEX M
1 DEAT Y
2 SOUR @S1@
3 PAGE fol. 7
3 QUAY 2
2 _STROM_STATUS lead
2 _STROM_ORIGIN import R1
`)
    .replace(`1 NAME Mlhoň /Ozubec/
1 SEX M
`, `1 NAME Mlhoň /Ozubec/
2 _STROM_ORIGIN import R1
1 SEX M
1 BIRT
2 DATE 1890
2 AGE 32y
2 _STROM_ORIGIN import R1
`)
    .replace('0 TRLR', `0 @S1@ SOUR
1 TITL Matrika Ozubcov
0 TRLR`);

describe('the research’s tree through the app and back (N-A, N-B, N-C)', () => {
    const count = (ged: string, re: RegExp) => ged.split('\n').filter(l => re.test(l)).length;
    const data = migrateData(load(RESEARCH_ROUND, null).data);
    const file = exportToGedcom(structuredClone(data), 'Ozubec', { origins: true, content: resolveContentOptions(true) }).content;
    const sync = exportToGedcom(structuredClone(data), 'Ozubec', { research: { id: 'r-test' } }).content;

    it('the file export: as many imports, ids and origins as came in', () => {
        expect(count(file, /^1 _STROM_IMPORT R1$/)).toBe(count(RESEARCH_ROUND, /^1 _STROM_IMPORT R1$/));
        expect(count(file, /^2 _XREF /)).toBe(count(RESEARCH_ROUND, /^2 _XREF /));
        expect(count(file, /^2 _STROM_ORIGIN /)).toBe(count(RESEARCH_ROUND, /^2 _STROM_ORIGIN /));
        expect(count(file, /^1 FAMC /)).toBe(count(RESEARCH_ROUND, /^1 FAMC /));
    });

    it('the age at the birth goes back as AGE under BIRT, in the file and to the research', () => {
        for (const ged of [file, sync]) {
            expect(ged).toMatch(/1 BIRT\n2 DATE 1890\n2 AGE 32y\n/);
            expect(count(ged, /^1 FAMC /)).toBe(count(RESEARCH_ROUND, /^1 FAMC /));
        }
    });

    it('no note the research did not write, in either export', () => {
        for (const ged of [file, sync]) {
            expect(count(ged, /^1 NOTE (?!Strom surname)/)).toBe(0);
            expect(count(ged, /^2 NOTE /)).toBe(0);
        }
        // The age is no line of the person's note either (the second family's line is the app's own explanation).
        expect(byName(data, 'Mlhoň').notes ?? '').not.toMatch(/32/);
    });
});

/**
 * A name after marriage with given names of its own (066 N-E): "Zbyhoňka
 * Mlhoslava /Pražmouková/" beside the birth name "Zbyhoňka /Mlhoslava/", the one
 * the person goes by. The app keeps those given names, shows them with the
 * married surname and writes the name back as it came, so the research sees
 * no change of the name the person is shown by.
 */
describe('a married name with given names of its own (N-E)', () => {
    const count = (ged: string, re: RegExp) => ged.split('\n').filter(l => re.test(l)).length;
    const NAMES = ['1 NAME Zbyhoňka /Mlhoslava/', '1 NAME Zbyhoňka Mlhoslava /Pražmouková/', '2 TYPE married', '2 _STROM_PRIMARY Y'];
    const research = RESEARCH_FAMILIES.replace('0 TRLR', [
        '0 @I6@ INDI', '1 _STROM_IMPORT R1', '2 _XREF @I500006@', ...NAMES, '1 SEX F', '1 REFN P0006', '2 TYPE strom-research', '0 TRLR',
    ].join('\n'));
    const names = (ged: string): string[] => {
        const lines = ged.split('\n');
        const start = lines.findIndex(l => l === '1 NAME Zbyhoňka /Mlhoslava/');
        expect(start).toBeGreaterThanOrEqual(0);
        return lines.slice(start, start + 4);
    };

    it('comes from the research, shows and goes back as it came, in the file and to the research', () => {
        const data = migrateData(load(research, null).data);
        const m = byName(data, 'Zbyhoňka');
        expect([m.lastName, m.marriedSurname, m.marriedFirstName, m.primaryName]).toEqual(['Mlhoslava', 'Pražmouková', 'Zbyhoňka Mlhoslava', 'married']);
        expect(m.nameVariants).toBeUndefined();
        expect(shownName(m, '', false, 'married')).toBe('Zbyhoňka Mlhoslava Pražmouková');
        expect(shownName(m, '', false, 'birth')).toBe('Zbyhoňka Mlhoslava');
        const sync = exportToGedcom(structuredClone(data), 'Ozubec', { research: { id: 'r-test' } }).content;
        const file = exportToGedcom(structuredClone(data), 'Ozubec', { origins: true }).content;
        for (const ged of [sync, file]) {
            expect(names(ged)).toEqual(NAMES);
            expect(count(ged, /^1 NAME Zbyhoňka/)).toBe(2);
        }
        // Read again and written again: the same.
        const again = exportToGedcom(migrateData(load(file, null).data), 'Ozubec', { origins: true }).content;
        expect(body(again)).toEqual(body(file));
    });

    const file = MYHERITAGE.replace('1 NAME Libuna /Šťovíková/\n2 GIVN Libuna\n2 SURN Šťovíková\n',
        '1 NAME Libuna /Šťovíková/\n2 GIVN Libuna\n2 SURN Šťovíková\n1 NAME Libuna Bohumila /Ozubcová/\n2 TYPE married\n')
        .replace('1 NAME Hromoslav /Ozubec/\n2 GIVN Hromoslav\n2 SURN Ozubec\n',
            '1 NAME Hromoslav /Ozubec/\n2 GIVN Hromoslav\n2 SURN Ozubec\n1 NAME Hromoslav /Ozubec-Šťovík/\n2 TYPE married\n');

    it('another program’s married name keeps its given names in "Back to {program}"; the same given names are no field of their own', () => {
        expect(file).toContain('Libuna Bohumila');
        const data = migrateData(load(file).data);
        expect(byName(data, 'Libuna').marriedFirstName).toBe('Libuna Bohumila');
        expect(byName(data, 'Hromoslav').marriedFirstName).toBeUndefined();
        const ged = backTo(data);
        expect(record(ged, '@I500002@')).toEqual(expect.arrayContaining(['1 NAME Libuna Bohumila /Ozubcová/', '2 TYPE married']));
        expect(record(ged, '@I500001@')).toEqual(expect.arrayContaining(['1 NAME Hromoslav /Ozubec-Šťovík/', '2 TYPE married']));
    });

    it('a tree loaded before the given names were kept takes them when the same file is merged again', async () => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
        const existing = migrateData(load(file).data);
        delete byName(existing, 'Libuna').marriedFirstName;
        expect(record(backTo(existing), '@I500002@')).toContain('1 NAME Libuna /Ozubcová/');
        const incoming = migrateData(load(file, { at: '2026-11-09', file: 'family.ged', encoding: 'utf-8' }).data);
        const merged = (await executeMerge(createMergeState(existing, incoming))).mergedData;
        expect(byName(merged, 'Libuna').marriedFirstName).toBe('Libuna Bohumila');
        expect(record(backTo(merged), '@I500002@')).toContain('1 NAME Libuna Bohumila /Ozubcová/');
    });

    it('goes with the married surname, and a stored one that says nothing more is dropped on load', () => {
        const data = migrateData(load(research, null).data);
        const m = byName(data, 'Zbyhoňka');
        const loaded = migrateData({ ...data, persons: { ...data.persons,
            [m.id]: { ...m, marriedSurname: undefined },
        } } as StromData);
        expect(loaded.persons[m.id].marriedFirstName).toBeUndefined();
        const same = migrateData({ ...data, persons: { ...data.persons, [m.id]: { ...m, marriedFirstName: 'Zbyhoňka' } } } as StromData);
        expect(same.persons[m.id].marriedFirstName).toBeUndefined();
    });
});
