/**
 * Every case of spec 066 in one file, so a change that breaks any of them
 * shows here (fictional people):
 * - test/gedcom-066-combined.ged: a MyHeritage Family Tree Builder file, one
 *   block of records per case (xrefs @I<case>01@…, @F<case>01@…), the
 *   source records at the end;
 * - test/gedcom-066-combined-research.ged: the research's tree of the same
 *   people, as it writes it (_STROM_IMPORT / _XREF, _STROM_ORIGIN,
 *   _STROM_PRIMARY, REFN).
 * Paths checked: import → "Back to {program}" → import of that file → "Back
 * to" again; the research's file → the app → the GEDCOM for the research →
 * read again; the same file merged into the tree it was imported into.
 *
 * A new case: add its own block of records to the fixture (next free case
 * number in the xrefs) and its own `it(...)` in the "each case" describe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyLivingPrivacy, CONTENT_PRESETS } from '../privacy.js';
import { researchGedcom } from '../ui/research-ui.js';
import { StorageManager } from '../storage.js';
import { createMergeState } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { validateJsonImport } from '../merge/validation.js';
import { factCitations } from '../import-origin.js';
import { StromData, STROM_DATA_VERSION, Partnership } from '../types.js';

const FILE = readFileSync(join(process.cwd(), 'test', 'gedcom-066-combined.ged'), 'utf-8');
const RESEARCH = readFileSync(join(process.cwd(), 'test', 'gedcom-066-combined-research.ged'), 'utf-8');

const importOf = (text: string, at: string, file = 'Hrbolec.ged') =>
    convertToStrom(parseGedcom(text), { importOrigin: { at, file, encoding: 'utf-8' } });

const load = (text: string, at: string, file?: string): StromData => migrateData(importOf(text, at, file).data);

/** "Back to {program}" as the app makes it (import-export.ts), for the tree's first import. */
const backTo = (data: StromData): string =>
    exportToGedcom(applyLivingPrivacy(data, 'full', 2026, { keepDeceasedSources: true }), 'Hrbolec',
        { content: CONTENT_PRESETS.back, origins: true, backTo: data.imports![0].id }).content;

/** The GEDCOM the research gets from the app (research-ui.ts). */
const forResearch = (data: StromData): string => researchGedcom(data, 'Hrbolec', { id: 'r-066' }, 'line');

/** The file without the date of the export in its header. */
const undated = (ged: string): string => ged.replace(/^(0 HEAD\n(?:[1-9].*\n)*?)1 DATE [^\n]*\n/, '$1');

const lines = (ged: string): string[] => ged.split(/\r?\n/);

/** One record's lines, by its xref (`@I101@`). */
function record(ged: string, xref: string): string[] {
    const all = lines(ged);
    const start = all.findIndex(l => l.startsWith(`0 ${xref} `));
    expect(start, `record ${xref}`).toBeGreaterThanOrEqual(0);
    const end = all.findIndex((l, i) => i > start && l.startsWith('0 '));
    return all.slice(start, end);
}

/** The lines of the records of these types (INDI, FAM, SOUR), but the records named in `except`. */
function recordsOf(ged: string, types: string[], except: string[] = []): string[] {
    const out: string[] = [];
    let keep = false;
    for (const line of lines(ged)) {
        if (line.startsWith('0 ')) {
            const m = line.match(/^0 (@[^@]+@) (\S+)/);
            keep = !!m && types.includes(m[2]) && !except.includes(m[1]);
        }
        if (keep) out.push(line);
    }
    return out;
}

const count = (list: string[], re: RegExp): number => list.filter(l => re.test(l)).length;

/** `block` (consecutive lines) stands in `rec` as one run. */
function holdsRun(rec: string[], block: string[]): boolean {
    for (let i = 0; i + block.length <= rec.length; i++) {
        if (block.every((l, k) => rec[i + k] === l)) return true;
    }
    return false;
}

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
    for (const line of lines(ged)) {
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

/**
 * The records of a file without the header, in xref order, without Strom's
 * own import bookkeeping (`_STROM_IMPORT` / `_STROM_XID` blocks: a merge
 * records its second load of the file there).
 */
function records(ged: string): string[] {
    const out: string[] = [];
    let skipBelow = -1;
    for (const line of lines(ged)) {
        const level = Number(line.split(' ')[0]);
        if (skipBelow >= 0 && level > skipBelow) continue;
        skipBelow = -1;
        if (/^\d+ _STROM_(?:IMPORT|XID)\b/.test(line)) { skipBelow = level; continue; }
        if (level === 0) out.push(line);
        else if (out.length) out[out.length - 1] += '\n' + line;
    }
    return out.filter(r => /^0 @(?!SUBM)/.test(r)).sort();
}

describe('The combined 066 file: import → "Back to" → import → "Back to"', () => {
    const imported = importOf(FILE, '2026-11-08');
    const tree = migrateData(imported.data);
    const first = backTo(tree);
    const again = load(first, '2026-11-09', 'Hrbolec-back.ged');
    const second = backTo(again);

    it('the second "Back to" is the first, byte for byte but the export date', () => {
        expect(undated(second)).toBe(undated(first));
        // The file read again is Strom's own: no second import of it.
        expect(again.imports).toHaveLength(1);
    });

    it('the import summary names nothing unsupported', () => {
        expect(imported.stats.unsupportedTags).toBe(0);
        expect(imported.stats.droppedTagSummary).toBe('');
    });

    it('as many records, links, ids, events and lines of their own as the file', () => {
        const people = ['INDI', 'FAM'];
        const counted: [string, string[], RegExp][] = [
            ['INDI', ['INDI'], /^0 @[^@]+@ INDI$/], ['FAM', ['FAM'], /^0 @[^@]+@ FAM$/], ['SOUR', ['SOUR'], /^0 @[^@]+@ SOUR$/],
            ['HUSB', people, /^1 HUSB /], ['WIFE', people, /^1 WIFE /], ['CHIL', people, /^1 CHIL /],
            ['FAMC', people, /^1 FAMC /], ['FAMS', people, /^1 FAMS /], ['PEDI', people, /^2 PEDI /],
            ['NAME', people, /^1 NAME/], ['TYPE married', people, /^2 TYPE married$/],
            ['RIN', ['INDI', 'FAM', 'SOUR'], /^1 RIN /], ['_UID', people, /^1 _UID /], ['_UPD', ['INDI', 'FAM', 'SOUR'], /^1 _UPD /],
            ['TYPE', people, /^2 TYPE /], ['BIRT', people, /^1 BIRT$/], ['DEAT', people, /^1 DEAT( Y)?$/], ['MARR', people, /^1 MARR$/],
            ['RESI', people, /^1 RESI$/], ['EMAIL', people, /^2 EMAIL /], ['NCHI', people, /^1 NCHI /],
            ['AGE', people, /^2 AGE /], ['NOTE', people, /^\d NOTE /], ['CONT', people, /^\d CONT /],
            ['OBJE', people, /^1 OBJE$/], ['_DATE', people, /^2 _DATE /], ['_PHOTO_RIN', people, /^2 _PHOTO_RIN /],
            ['SOUR citation', people, /^\d SOUR @/], ['PAGE', people, /^\d PAGE /], ['QUAY', people, /^\d QUAY /],
            ['TEXT', people, /^\d TEXT /], ['CONC', people, /^\d CONC /], ['ROLE', people, /^\d ROLE /],
            ['AUTH', ['SOUR'], /^1 AUTH /], ['PUBL', ['SOUR'], /^1 PUBL /], ['_TYPE', ['SOUR'], /^1 _TYPE /], ['_MEDI', ['SOUR'], /^1 _MEDI /],
            ['GIVN', people, /^2 GIVN /], ['SURN', people, /^2 SURN /],
            ['ASSO', people, /^2 ASSO /], ['_WITN', people, /^2 _WITN /],
        ];
        const tally = (ged: string) => Object.fromEntries(counted.map(([name, types, re]) =>
            [name, count(recordsOf(ged, types), re)]));
        expect(tally(first)).toEqual(tally(FILE));
    });

    it('no note the file did not write', () => {
        expect(count(lines(first), /^1 NOTE /)).toBe(count(lines(FILE), /^1 NOTE /));
        expect(first).not.toMatch(/_STROM_NOTED|_STROM_CITE|Number of children|Publication:|Author:|Birth:/);
    });

    describe('each case', () => {
        it('1 · one source record cited at many pages, with and without PAGE, QUAY, DATA > DATE / TEXT (CONC), EVEN > ROLE', () => {
            expect(citations(first)).toEqual(citations(FILE));
            expect(record(first, '@S1@')).toEqual(expect.arrayContaining(['1 TITL Parish register Hrbolcov',
                '1 AUTH Hrbolcov parish office', '1 PUBL Hrbolcov 1860', '1 _TYPE Parish register', '1 _MEDI Book',
                '1 _UPD 8 NOV 2026 10:00:00 GMT -0500']));
            expect(count(record(first, '@S1@'), /^1 (PAGE|NOTE) /)).toBe(0);
            // The source records' own ids (RIN, _UID) go back to them, in both "Back to" files.
            for (const ged of [first, second]) {
                expect(record(ged, '@S1@')).toContain('1 RIN MH:S1');
                expect(record(ged, '@S2@')).toContain('1 RIN MH:S2');
                // An EXID with its TYPE (GEDCOM 7) as written, after the file is read again too.
                expect(holdsRun(record(ged, '@S2@'), ['1 EXID 7741', '2 TYPE https://chronicle.example.org'])).toBe(true);
            }
            const kvasibor = record(first, '@I101@');
            expect(holdsRun(kvasibor, ['2 SOUR @S1@', '3 PAGE fol. 3', '3 DATA', '4 DATE 3 FEB 1860',
                '4 TEXT Kvasibor, son of the potter', '5 CONC  of Hrbolcov', '3 QUAY 3', '3 EVEN BIRT', '4 ROLE CHIL'])).toBe(true);
            expect(holdsRun(kvasibor, ['1 SOUR @S2@', '2 DATA',
                '3 TEXT Kvasibor Hrbolec, potter of Hrbolcov, named in the chronicle', '4 CONC  for the year of the flood',
                '2 QUAY 3', '2 EVEN RESI', '3 ROLE PRIN'])).toBe(true);
            expect(holdsRun(kvasibor, ['1 SOUR @S1@', '2 PAGE fol. 9'])).toBe(true);
        });

        it('1 · a source record cited nowhere keeps its xref and ids (@S3@)', () => {
            for (const ged of [first, second]) {
                expect(record(ged, '@S3@')).toEqual(expect.arrayContaining(['1 TITL Drnkalov estate inventory', '1 RIN MH:S3',
                    '1 _UPD 8 NOV 2026 10:00:00 GMT -0500']));
            }
            expect(count(recordsOf(first, ['SOUR']), /^0 @S4@ /)).toBe(0);
        });

        it('2 · a family of one spouse with nothing but its ids (husband alone, wife alone)', () => {
            expect(record(first, '@F201@')).toEqual(expect.arrayContaining(['1 HUSB @I201@', '1 RIN MH:F201',
                '1 _UID 02F1B2C3D4E5F60718293A4B5C6D7F01', '1 _UPD 8 NOV 2026 10:00:00 GMT -0500']));
            expect(record(first, '@F202@')).toEqual(expect.arrayContaining(['1 WIFE @I202@', '1 RIN MH:F202',
                '1 _UID 02F1B2C3D4E5F60718293A4B5C6D7F02']));
            for (const xref of ['@F201@', '@F202@']) {
                expect(count(record(first, xref), /^1 (HUSB|WIFE|CHIL|MARR) /)).toBe(1);
            }
        });

        it('3 · a child\'s second family with one parent and PEDI adopted', () => {
            const child = record(first, '@I303@');
            expect(holdsRun(child, ['1 FAMC @F301@', '1 FAMC @F302@', '2 PEDI adopted'])).toBe(true);
            expect(count(child, /NOTE/)).toBe(0);
            const family = record(first, '@F302@');
            expect(family).toEqual(expect.arrayContaining(['1 HUSB @I304@', '1 CHIL @I303@', '1 _UID 03F1B2C3D4E5F60718293A4B5C6D7F02']));
            expect(count(family, /^1 (WIFE|MARR)/)).toBe(0);
        });

        it('4 · a child in two families, both of them with both parents', () => {
            const child = record(first, '@I403@');
            expect(holdsRun(child, ['1 FAMC @F401@', '1 FAMC @F402@', '2 PEDI adopted'])).toBe(true);
            expect(count(child, /NOTE/)).toBe(0);
            expect(record(first, '@F402@')).toEqual(expect.arrayContaining(['1 HUSB @I404@', '1 WIFE @I405@', '1 CHIL @I403@']));
            expect(record(first, '@F401@')).toEqual(expect.arrayContaining(['1 HUSB @I401@', '1 WIFE @I402@', '1 CHIL @I403@']));
        });

        it('5 · a name after marriage with given names of its own (TYPE married, GIVN, SURN)', () => {
            const rec = record(first, '@I501@');
            expect(holdsRun(rec, ['1 NAME Duhoslava Věnuna /Hrbolcová/', '2 TYPE married',
                '2 GIVN Duhoslava Věnuna', '2 SURN Hrbolcová'])).toBe(true);
            expect(rec).toContain('1 NAME Duhoslava /Plotýnková/');
            const person = Object.values(again.persons).find(p => p.firstName === 'Duhoslava')!;
            expect([person.marriedSurname, person.marriedFirstName]).toEqual(['Hrbolcová', 'Duhoslava Věnuna']);
        });

        it('6 · people without a name (an empty NAME, NAME //) keep their records and ids', () => {
            const empty = record(first, '@I602@');
            expect(empty).toEqual(expect.arrayContaining(['1 SEX U', '1 FAMS @F601@', '1 RIN MH:I602', '1 _UID 06A1B2C3D4E5F60718293A4B5C6D7E02']));
            expect(count(empty, /^1 NAME/)).toBe(1);
            expect(record(first, '@I603@')).toEqual(expect.arrayContaining(['1 NAME //', '1 SEX U', '1 FAMC @F601@', '1 _UID 06A1B2C3D4E5F60718293A4B5C6D7E03']));
            expect(record(first, '@F601@')).toEqual(expect.arrayContaining(['1 HUSB @I601@', '1 WIFE @I602@', '1 CHIL @I603@']));
        });

        it('7 · a death known without a date (DEAT Y), cited and not', () => {
            expect(holdsRun(record(first, '@I701@'), ['1 DEAT Y', '2 SOUR @S1@', '3 PAGE fol. 120', '3 QUAY 2'])).toBe(true);
            const plain = record(first, '@I702@');
            expect(plain).toContain('1 DEAT Y');
            expect(plain[plain.indexOf('1 DEAT Y') + 1]).toMatch(/^1 /);
        });

        it('8 · an age written at the birth (BIRT > AGE)', () => {
            expect(holdsRun(record(first, '@I801@'), ['1 BIRT', '2 DATE 1871', '2 PLAC Drnkalov', '2 AGE 0y'])).toBe(true);
        });

        it('9 · a birth with nothing but a NOTE', () => {
            expect(holdsRun(record(first, '@I901@'), ['1 BIRT', '2 NOTE Born in the forge, says the family.'])).toBe(true);
            expect(count(record(first, '@I901@'), /^1 NOTE/)).toBe(0);
        });

        it('10 · a wedding with a NOTE (CONT)', () => {
            expect(holdsRun(record(first, '@F1001@'), ['1 MARR', '2 DATE 1899', '2 PLAC Drnkalov',
                '2 NOTE Married at the mill chapel,', '3 CONT the miller standing witness.'])).toBe(true);
        });

        it('11 · a family without any event: no MARR made up', () => {
            const family = record(first, '@F1101@');
            expect(family).toEqual(expect.arrayContaining(['1 HUSB @I1101@', '1 WIFE @I1102@', '1 _UPD 8 NOV 2026 10:00:00 GMT -0500']));
            expect(count(family, /^1 (MARR|DIV|ENGA|EVEN)/)).toBe(0);
        });

        it('12 · picture links by address and by path, with FILE, FORM, _FILESIZE, _PHOTO_RIN, _PERSONALPHOTO, _DATE', () => {
            const rec = record(first, '@I1201@');
            const source = record(FILE, '@I1201@');
            const linkBlocks: string[][] = [];
            let open: string[] | null = null;
            for (const l of source) {
                if (l === '1 OBJE') linkBlocks.push(open = [l]);
                else if (open && /^[2-9] /.test(l)) open.push(l);
                else open = null;
            }
            expect(linkBlocks).toHaveLength(2);
            for (const block of linkBlocks) expect(holdsRun(rec, block), block[2]).toBe(true);
        });

        it('13 · NCHI, an e-mail of a residence, GIVN / SURN', () => {
            const rec = record(first, '@I1301@');
            expect(rec).toContain('1 NCHI 4');
            expect(holdsRun(rec, ['1 RESI', '2 ADDR Drnkalov 7', '2 EMAIL bystron@@example.org'])).toBe(true);
            expect(holdsRun(rec, ['1 NAME Bystroň /Drnkal/', '2 GIVN Bystroň', '2 SURN Drnkal'])).toBe(true);
        });

        it('14 · a couple divorced in one family record and married again in another: one couple, both records back', () => {
            const couple = Object.values(tree.partnerships).filter(p => tree.persons[p.person1Id]?.firstName === 'Kořenoslav');
            expect(couple).toHaveLength(1);
            expect([couple[0].status, couple[0].startDate, couple[0].endDate]).toEqual(['married', '1911-04-01', undefined]);
            expect(imported.stats.joinedFamilies).toBe(5);
            expect(holdsRun(record(first, '@F1401@'), ['1 MARR', '2 DATE 1 APR 1911', '2 PLAC Drnkalov'])).toBe(true);
            // The wedding's TYPE, read nowhere, goes back under it as written.
            const marriage = record(first, '@F1401@');
            const at = marriage.indexOf('1 MARR');
            expect(marriage.slice(at + 1, marriage.findIndex((l, i) => i > at && l.startsWith('1 ')))).toContain('2 TYPE civil');
            expect(holdsRun(record(first, '@F1401@'), ['1 DIV', '2 DATE 2 MAY 1912'])).toBe(true);
            const remarried = record(first, '@F1402@');
            expect(remarried).toEqual(expect.arrayContaining(['1 HUSB @I1401@', '1 WIFE @I1402@', '1 RIN MH:F1402',
                '1 _UID 14F1B2C3D4E5F60718293A4B5C6D7F02', '1 _UPD 8 NOV 2026 10:00:00 GMT -0500']));
            expect(holdsRun(remarried, ['1 MARR', '2 DATE 4 JUL 1914', '2 PLAC Hrbolcov',
                '2 NOTE Married again at the town hall,', '3 CONT the same witnesses as before.'])).toBe(true);
            // The second record's notes go back to it once, not to the first record as well.
            expect(remarried).toContain('1 NOTE The second wedding of the two.');
            expect(count(record(first, '@F1401@'), /NOTE|CONT/)).toBe(0);
            // In the tree, the couple's note has them.
            expect(couple[0].note).toContain('The second wedding of the two.');
            for (const xref of ['@I1401@', '@I1402@']) {
                expect(holdsRun(record(first, xref), ['1 FAMS @F1401@', '1 FAMS @F1402@']), xref).toBe(true);
            }
        });

        it('14 · the second record\'s child, citation and event go back to it, not to the first record', () => {
            for (const ged of [first, second]) {
                const remarried = record(ged, '@F1402@');
                const firstFam = record(ged, '@F1401@');
                expect(remarried).toContain('1 CHIL @I1403@');
                expect(firstFam).not.toContain('1 CHIL @I1403@');
                expect(count(record(ged, '@I1403@'), /^1 FAMC /)).toBe(1);
                expect(record(ged, '@I1403@')).toContain('1 FAMC @F1402@');
                const at = remarried.indexOf('1 MARR');
                expect(holdsRun(remarried.slice(at, remarried.findIndex((l, i) => i > at && l.startsWith('1 '))),
                    ['2 SOUR @S1@', '3 PAGE fol. 14'])).toBe(true);
                expect(count(firstFam, /^\d SOUR @/)).toBe(0);
                expect(holdsRun(remarried, ['1 EVEN', '2 TYPE Blessing', '2 DATE 1915'])).toBe(true);
                expect(count(firstFam, /^1 EVEN/)).toBe(0);
            }
            // In the tree they stay with the couple.
            const couple = Object.values(tree.partnerships).find(p => tree.persons[p.person1Id]?.firstName === 'Kořenoslav')!;
            expect(couple.childIds.map(c => tree.persons[c].firstName)).toEqual(['Drobuna']);
            expect(couple.events?.map(e => e.customLabel)).toEqual(['Blessing']);
        });

        it('14 · the couple\'s note edited in the tree: written once, in the first record', () => {
            const edited = structuredClone(tree);
            const couple = Object.values(edited.partnerships).find(p => edited.persons[p.person1Id]?.firstName === 'Kořenoslav')!;
            couple.note = couple.note!.replace('The second wedding of the two.', 'The second wedding, in the town hall.');
            const ged = backTo(edited);
            expect(count(record(ged, '@F1402@'), /NOTE|CONT/)).toBe(0);
            expect(count(lines(ged), /The second wedding, in the town hall\./)).toBe(1);
            expect(count(lines(ged), /Married again at the town hall,/)).toBe(1);
        });

        it('15 · an age of more than 999 days (AGE 1y 30m 1100d) and a web link (OBJE > FORM URL)', () => {
            const rec = record(first, '@I1501@');
            expect(holdsRun(rec, ['1 DEAT', '2 DATE 1896', '2 AGE 1y 30m 1100d'])).toBe(true);
            expect(holdsRun(rec, ['1 OBJE', '2 FORM URL', '2 TITL Drnkalov chronicle online',
                '2 FILE https://www.example.org/drnkalov/chronicle'])).toBe(true);
        });

        it('16 · dates Strom cannot read (10 JAN, 1735/1736, the Julian calendar), also as the only date of an event', () => {
            const he = record(first, '@I1601@');
            expect(holdsRun(he, ['1 BIRT', '2 DATE 10 JAN'])).toBe(true);
            expect(holdsRun(he, ['1 DEAT', '2 DATE @#DJULIAN@ 3 MAR 1790', '2 PLAC Hrbolcov'])).toBe(true);
            expect(holdsRun(record(first, '@I1602@'), ['1 BIRT', '2 DATE 1735/1736', '2 PLAC Drnkalov'])).toBe(true);
            expect(holdsRun(record(first, '@F1601@'), ['1 MARR', '2 DATE 1755/1756'])).toBe(true);
        });

        it('17 · a divorce with a NOTE (CONT) under it', () => {
            expect(holdsRun(record(first, '@F1701@'), ['1 DIV', '2 DATE 1905', '2 NOTE By the court of Drnkalov,',
                '3 CONT the children left with the mother.'])).toBe(true);
        });

        it('18 · a couple\'s first record without a wedding date: the couple has the second\'s, the first goes back without it', () => {
            const couple = Object.values(tree.partnerships).find(p => tree.persons[p.person1Id]?.firstName === 'Ťukoslav')!;
            expect([couple.startDate, couple.startPlace]).toEqual(['1920-05-12', 'Hrbolcov']);
            expect(Object.values(couple.ages ?? {})).toEqual(['30 years']);
            for (const ged of [first, second]) {
                const firstFam = record(ged, '@F1801@');
                expect(holdsRun(firstFam, ['1 MARR', '2 PLAC Hrbolcov'])).toBe(true);
                expect(count(firstFam, /^2 (DATE|HUSB)|^3 AGE /)).toBe(0);
                expect(holdsRun(record(ged, '@F1802@'), ['1 MARR', '2 DATE 12 MAY 1920', '2 PLAC Drnkalov', '2 HUSB', '3 AGE 30y'])).toBe(true);
            }
        });

        it('19 · a couple\'s first record without a wedding: it goes back without one', () => {
            const couple = Object.values(tree.partnerships).find(p => tree.persons[p.person1Id]?.firstName === 'Šimrdoš')!;
            expect([couple.status, couple.startDate, couple.marriageUnrecorded]).toEqual(['married', '1922-03-03', undefined]);
            for (const ged of [first, second]) {
                expect(count(record(ged, '@F1901@'), /^1 MARR|^2 DATE/)).toBe(0);
                expect(holdsRun(record(ged, '@F1902@'), ['1 MARR', '2 DATE 3 MAR 1922'])).toBe(true);
            }
        });

        it('20 · a child named in both of a couple\'s family records: in both, with both FAMC, and no note about it', () => {
            const couple = Object.values(tree.partnerships).filter(p => tree.persons[p.person1Id]?.firstName === 'Hnětislav');
            expect(couple).toHaveLength(1);
            expect(couple[0].childIds.map(c => tree.persons[c].firstName)).toEqual(['Klíčenka']);
            const child = Object.values(tree.persons).find(p => p.firstName === 'Klíčenka')!;
            expect(child.notes ?? '').toBe('');
            expect(child.alsoChildOf).toBeUndefined();
            for (const ged of [first, second]) {
                expect(record(ged, '@F2001@')).toContain('1 CHIL @I2003@');
                expect(record(ged, '@F2002@')).toContain('1 CHIL @I2003@');
                expect(holdsRun(record(ged, '@I2003@'), ['1 FAMC @F2001@', '1 FAMC @F2002@'])).toBe(true);
                expect(count(record(ged, '@I2003@'), /^1 (FAMC|NOTE) /)).toBe(2);
            }
        });

        it('21 · the witnesses of a couple\'s second wedding go back under it; one both weddings name, under both', () => {
            const couple = Object.values(tree.partnerships).find(p => tree.persons[p.person1Id]?.firstName === 'Brumislav')!;
            expect(couple.participants?.map(p => p.personId ? tree.persons[p.personId].firstName : p.name))
                .toEqual(['Mračoslav Bzučák', 'Vrtimír', 'Čučmíra Ťapková']);
            const wedding = (rec: string[]): string[] => {
                const at = rec.indexOf('1 MARR');
                return rec.slice(at, rec.findIndex((l, i) => i > at && l.startsWith('1 ')));
            };
            for (const ged of [first, second]) {
                const firstWedding = wedding(record(ged, '@F2101@'));
                const secondWedding = wedding(record(ged, '@F2102@'));
                expect(firstWedding.filter(l => /^2 (ASSO|_WITN) /.test(l))).toEqual(['2 _WITN Mračoslav Bzučák']);
                expect(secondWedding.filter(l => /^2 (ASSO|_WITN) /.test(l)))
                    .toEqual(['2 ASSO @I2103@', '2 _WITN Čučmíra Ťapková', '2 _WITN Mračoslav Bzučák']);
                expect(holdsRun(secondWedding, ['2 ASSO @I2103@', '3 RELA Witness'])).toBe(true);
            }
        });

        it('21 · a witness of the second wedding removed in the tree is not written back', () => {
            const edited = structuredClone(tree);
            const couple = Object.values(edited.partnerships).find(p => edited.persons[p.person1Id]?.firstName === 'Brumislav')!;
            couple.participants = couple.participants!.filter(p => p.name !== 'Čučmíra Ťapková');
            const ged = backTo(edited);
            expect(count(lines(ged), /Čučmíra Ťapková/)).toBe(0);
            expect(record(ged, '@F2102@')).toContain('2 ASSO @I2103@');
        });

        it('18 · the date taken from the second record changed in the tree: the first record writes it', () => {
            const edited = structuredClone(tree);
            const couple = Object.values(edited.partnerships).find(p => edited.persons[p.person1Id]?.firstName === 'Ťukoslav')!;
            couple.startDate = '1919-05-12';
            const ged = backTo(edited);
            expect(holdsRun(record(ged, '@F1801@'), ['1 MARR', '2 DATE 12 MAY 1919', '2 PLAC Hrbolcov'])).toBe(true);
            expect(holdsRun(record(ged, '@F1802@'), ['1 MARR', '2 DATE 12 MAY 1920'])).toBe(true);
        });

        it('22 · text on a fact\'s own line (EDUC, BURI, EVEN with TYPE) and an address of ADR1 / CITY: kept, and back as written', () => {
            const person = Object.values(tree.persons).find(p => p.firstName === 'Bublislav')!;
            const of = (type: string) => person.events!.find(e => e.type === type)!;
            expect(of('education').note).toBe('Kňouralov grammar school');
            expect(of('burial').note).toBe('Kňouralov churchyard, grave 12');
            expect(of('custom').note).toBe('Blessing of the new mill');
            expect(of('residence').address).toBe('Mlýnská 5, Kňouralov');
            for (const ged of [first, second]) {
                const rec = record(ged, '@I2201@');
                expect(holdsRun(rec, ['1 EDUC Kňouralov grammar school', '2 DATE 1862'])).toBe(true);
                expect(holdsRun(rec, ['1 BURI Kňouralov churchyard, grave 12', '2 DATE 1920'])).toBe(true);
                expect(holdsRun(rec, ['1 EVEN Blessing of the new mill', '2 TYPE Mill', '2 DATE 1880'])).toBe(true);
                expect(holdsRun(rec, ['1 RESI', '2 ADDR', '3 ADR1 Mlýnská 5', '3 CITY Kňouralov'])).toBe(true);
                expect(count(rec, /NOTE/)).toBe(0);
            }
        });

        it('22 · the text or the address edited in the tree: the tree\'s goes back', () => {
            const edited = structuredClone(tree);
            const person = Object.values(edited.persons).find(p => p.firstName === 'Bublislav')!;
            person.events!.find(e => e.type === 'education')!.note = 'Kňouralov grammar school\nA prize in Latin';
            person.events!.find(e => e.type === 'residence')!.address = 'Mlýnská 6, Kňouralov';
            const rec = record(backTo(edited), '@I2201@');
            expect(holdsRun(rec, ['1 EDUC Kňouralov grammar school', '2 DATE 1862', '2 NOTE A prize in Latin'])).toBe(true);
            expect(holdsRun(rec, ['1 RESI', '2 ADDR Mlýnská 6, Kňouralov'])).toBe(true);
            expect(count(rec, /ADR1/)).toBe(0);
        });

        it('23 · a source\'s TEXT with web links (MyHeritage): the links\' addresses kept, the TEXT back as written', () => {
            const source = Object.values(tree.sources!).find(s => s.title === 'Kňouralov parish register online')!;
            expect(source.transcript).toBe('Births 1850-1860, scan 7 (https://www.example.org/register/7), also at https://archive.example.org');
            for (const ged of [first, second]) {
                expect(record(ged, '@S5@')).toContain("1 TEXT Births 1850-1860, <a href='https://www.example.org/register/7' target='_blank'>scan 7</a>, also at <a href='https://archive.example.org' target='_blank'>archive.example.org</a>");
            }
            const edited = structuredClone(tree);
            Object.values(edited.sources!).find(s => s.title === 'Kňouralov parish register online')!.transcript = 'Births 1850-1860';
            expect(record(backTo(edited), '@S5@')).toContain('1 TEXT Births 1850-1860');
        });

        it('24 · two sisters with nothing but a surname: both kept, in their order', () => {
            const family = Object.values(tree.persons).find(p => p.firstName === 'Ťapkoslav')!;
            const children = family.childIds.map(id => tree.persons[id]);
            expect(children.map(c => [c.firstName, c.lastName])).toEqual([['?', 'Čvachtová'], ['?', 'Čvachtová']]);
            expect(record(first, '@F2401@')).toEqual(expect.arrayContaining(['1 CHIL @I2403@', '1 CHIL @I2404@']));
        });

        it('25 · a divorce\'s citations (PAGE, DATA > TEXT with CONC, QUAY) are its own, and back under DIV as written', () => {
            const couple = divorcedCouple(tree);
            const cited = (ids?: string[]) => (ids ?? []).map(id => [tree.sources![id].title, tree.sources![id].reference ?? '', tree.sources![id].quality]);
            expect(cited(couple.sourceIds)).toEqual([['Parish register Hrbolcov', 'fol. 41', undefined]]);
            expect(cited(couple.divorceSourceIds)).toEqual([['Parish register Hrbolcov', 'fol. 78', 2], ['Drnkalov chronicle', '', 1]]);
            expect(factCitations(tree, couple, 'divorce')).toEqual(couple.divorceSourceIds!.map(id =>
                ({ source: tree.sources![id], ctx: { partnershipId: couple.id, fact: 'divorce' } })));
            expect(factCitations(tree, couple, 'marriage').map(c => c.source.id)).toEqual(couple.sourceIds);
            for (const ged of [first, second]) {
                const rec = record(ged, '@F2501@');
                expect(holdsRun(rec, ['1 MARR', '2 DATE 1885', '2 PLAC Hrbolcov', '2 SOUR @S1@', '3 PAGE fol. 41'])).toBe(true);
                expect(count(rec, /^\d SOUR /)).toBe(3);
                expect(holdsRun(rec, ['1 DIV', '2 DATE 1890', '2 PLAC Drnkalov', '2 SOUR @S1@', '3 PAGE fol. 78', '3 DATA',
                    '4 TEXT The marriage of Mračoslav and Kapradina dissolved', '5 CONC  by the court of Drnkalov.', '3 QUAY 2',
                    '2 SOUR @S2@', '3 QUAY 1'])).toBe(true);
            }
        });

        it('25 · the divorce\'s citations go through the tree\'s JSON (export, import) unchanged', () => {
            const json = validateJsonImport(JSON.stringify({ version: STROM_DATA_VERSION, ...tree })).data!;
            expect(divorcedCouple(json).divorceSourceIds).toEqual(divorcedCouple(tree).divorceSourceIds);
            expect(undated(backTo(json))).toBe(undated(first));
        });
    });
});

/** The couple of case 25 (divorced, the divorce cited). */
const divorcedCouple = (data: StromData): Partnership =>
    Object.values(data.partnerships).find(p => data.persons[p.person1Id]?.firstName === 'Mračoslav')!;

describe('The combined 066 file merged into the tree it was imported into', () => {
    beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('doubles nothing, and "Back to" is the fresh import\'s', async () => {
        const tree = load(FILE, '2026-11-08');
        const fresh = backTo(tree);
        const result = await executeMerge(createMergeState(tree, load(FILE, '2026-11-09')));
        expect(result.success).toBe(true);
        const merged = result.mergedData!;
        const size = (d: StromData) => [Object.keys(d.persons).length, Object.keys(d.partnerships).length, Object.keys(d.sources ?? {}).length];
        expect(size(merged)).toEqual(size(tree));
        expect(records(backTo(merged))).toEqual(records(fresh));
    });

    it('24 · siblings nothing tells apart pair by their place in the family, each with its own record', async () => {
        const tree = load(FILE, '2026-11-08');
        const state = createMergeState(tree, load(FILE, '2026-11-09'));
        const sisters = (d: StromData) => Object.values(d.persons).find(p => p.firstName === 'Ťapkoslav')!.childIds;
        const pairs = sisters(state.incomingData).map(id => state.matches.find(m => m.incomingId === id)?.existingId);
        expect(pairs).toEqual(sisters(tree));
        const merged = (await executeMerge(state)).mergedData!;
        expect(Object.values(merged.persons).filter(p => p.lastName === 'Čvachtová')).toHaveLength(2);
        expect(record(backTo(merged), '@F2401@')).toEqual(expect.arrayContaining(['1 CHIL @I2403@', '1 CHIL @I2404@']));
    });

    it('22, 23 · a tree imported before these were kept takes them from the file merged again', async () => {
        const fresh = backTo(load(FILE, '2026-11-08'));
        // What an earlier import of the file made of cases 22 and 23.
        const tree = load(FILE, '2026-11-08');
        const person = Object.values(tree.persons).find(p => p.firstName === 'Bublislav')!;
        for (const event of person.events!) {
            if (event.gedcomValue && event.type !== 'custom') delete event.note;
            delete event.gedcomValue;
            if (event.gedcomAddress) { delete event.address; delete event.gedcomAddress; }
        }
        const source = Object.values(tree.sources!).find(s => s.title === 'Kňouralov parish register online')!;
        source.transcript = 'Births 1850-1860, scan 7, also at archive.example.org';
        delete source.gedcomText;

        const merged = (await executeMerge(createMergeState(tree, load(FILE, '2026-11-09')))).mergedData!;
        const events = Object.values(merged.persons).find(p => p.firstName === 'Bublislav')!.events!;
        expect(events.find(e => e.type === 'education')!.note).toBe('Kňouralov grammar school');
        expect(events.find(e => e.type === 'burial')!.note).toBe('Kňouralov churchyard, grave 12');
        expect(events.find(e => e.type === 'residence')!.address).toBe('Mlýnská 5, Kňouralov');
        expect(events).toHaveLength(person.events!.length);
        expect(Object.values(merged.sources!).find(s => s.title === 'Kňouralov parish register online')!.transcript)
            .toBe('Births 1850-1860, scan 7 (https://www.example.org/register/7), also at https://archive.example.org');
        const ofCase = (ged: string) => records(ged).filter(r => /^0 @(I2201|S5)@ /.test(r));
        expect(ofCase(backTo(merged))).toEqual(ofCase(fresh));
    });

    it('25 · a tree imported before the divorce\'s citations were read takes them from the file merged again, once', async () => {
        const fresh = load(FILE, '2026-11-08');
        // What an earlier import of the file made of case 25: no divorce citations, no sources of theirs.
        const tree = load(FILE, '2026-11-08');
        const couple = divorcedCouple(tree);
        for (const id of couple.divorceSourceIds!) delete tree.sources![id];
        delete couple.divorceSourceIds;

        const merged = (await executeMerge(createMergeState(tree, load(FILE, '2026-11-09')))).mergedData!;
        const titles = (d: StromData) => divorcedCouple(d).divorceSourceIds!.map(id => [d.sources![id].reference ?? '', d.sources![id].quality]);
        expect(titles(merged)).toEqual(titles(fresh));
        expect(Object.keys(merged.sources!)).toHaveLength(Object.keys(fresh.sources!).length);
        const ofCase = (ged: string) => records(ged).filter(r => /^0 @F2501@ /.test(r));
        expect(ofCase(backTo(merged))).toEqual(ofCase(backTo(fresh)));
        // Merged once more: nothing doubled.
        const again = (await executeMerge(createMergeState(merged, load(FILE, '2026-11-10')))).mergedData!;
        expect(divorcedCouple(again).divorceSourceIds).toEqual(divorcedCouple(merged).divorceSourceIds);
        expect(Object.keys(again.sources!)).toHaveLength(Object.keys(fresh.sources!).length);
    });
});

describe('The research\'s file of the same people → the app → the GEDCOM for the research', () => {
    const tree = migrateData(convertToStrom(parseGedcom(RESEARCH)).data);
    const sent = forResearch(tree);
    const again = migrateData(convertToStrom(parseGedcom(sent)).data);
    const people = (ged: string) => recordsOf(ged, ['INDI', 'FAM']);

    it('read again and sent again: the same, byte for byte but the export date', () => {
        expect(undated(forResearch(again))).toBe(undated(sent));
    });

    it('no note the research did not write (the app\'s own lines of the header and the sources\' authors aside)', () => {
        expect(count(people(sent), /^\d NOTE /)).toBe(0);
        expect(count(lines(sent), /^1 NOTE (?!Strom surname-variant |Author: )/)).toBe(0);
        expect(count(lines(sent), /^[2-9] NOTE /)).toBe(0);
    });

    it('every family, child link and PEDI, and each record\'s import with its xref', () => {
        for (const [name, re] of [['FAM', /^0 @[^@]+@ FAM$/], ['INDI', /^0 @[^@]+@ INDI$/], ['FAMC', /^1 FAMC /], ['FAMS', /^1 FAMS /],
            ['HUSB', /^1 HUSB /], ['WIFE', /^1 WIFE /], ['CHIL', /^1 CHIL /], ['PEDI adopted', /^2 PEDI adopted$/],
            // The research's `_STROM_NO_COUPLE` of a family of one parent does not come back: such a
            // family goes out as the app keeps it, its one parent alone (ged-exporter.ts).
            ['_STROM_IMPORT', /^1 _STROM_IMPORT R1$/], ['_XREF', /^2 _XREF /], ['REFN', /^1 REFN /]] as [string, RegExp][]) {
            expect(count(people(sent), re), name).toBe(count(people(RESEARCH), re));
        }
    });

    it('a second family of one parent stays a family; a child in two families of both parents keeps both', () => {
        /** The xref the app gave the research's person with this REFN. */
        const xrefOf = (ged: string, refn: string): string => {
            const all = lines(ged);
            const at = all.indexOf(`1 REFN ${refn}`);
            expect(at, refn).toBeGreaterThan(0);
            return all.slice(0, at).reverse().find(l => l.startsWith('0 '))!.split(' ')[1];
        };
        for (const refn of ['P0006', 'P0010']) {
            const child = record(sent, xrefOf(sent, refn));
            const famc = child.filter(l => l.startsWith('1 FAMC '));
            expect(famc, refn).toHaveLength(2);
            expect(child[child.indexOf(famc[1]) + 1]).toBe('2 PEDI adopted');
        }
        const lone = record(sent, xrefOf(sent, 'P0007'));
        const family = record(sent, lone.find(l => l.startsWith('1 FAMS '))!.slice(7));
        expect(count(family, /^1 (HUSB|CHIL) /)).toBe(2);
        expect(count(family, /^1 WIFE /)).toBe(0);
        // The family of one spouse with nothing but its import.
        const alone = record(sent, record(sent, xrefOf(sent, 'P0003')).find(l => l.startsWith('1 FAMS '))!.slice(7));
        expect(alone).toEqual(expect.arrayContaining(['1 HUSB ' + xrefOf(sent, 'P0003'), '2 _XREF @F201@', '2 _UID 02F1B2C3D4E5F60718293A4B5C6D7F01']));
    });

    it('the married name with given names of its own, the one the person goes by, as it came', () => {
        expect(holdsRun(lines(sent), ['1 NAME Duhoslava /Plotýnková/', '1 NAME Duhoslava Věnuna /Hrbolcová/', '2 TYPE married', '2 _STROM_PRIMARY Y'])).toBe(true);
    });

    it('a nameless person keeps the record and its ids; a death without a date its citation and status; the age at the birth', () => {
        expect(holdsRun(lines(sent), ['2 _XREF @I602@', '2 _UID 06A1B2C3D4E5F60718293A4B5C6D7E02', '1 NAME //', '1 SEX U'])).toBe(true);
        const death = lines(sent).indexOf('1 DEAT Y');
        expect(lines(sent).slice(death, death + 5)).toEqual(expect.arrayContaining(['2 _STROM_STATUS lead', '3 PAGE fol. 120', '3 QUAY 2']));
        expect(holdsRun(lines(sent), ['1 BIRT', '2 DATE 1871', '2 PLAC Drnkalov', '2 AGE 0y'])).toBe(true);
    });

    it('the file export keeps every origin the research wrote', () => {
        const file = exportToGedcom(structuredClone(tree), 'Hrbolec', { origins: true }).content;
        expect(count(lines(file), /^2 _STROM_ORIGIN /)).toBe(count(lines(RESEARCH), /^2 _STROM_ORIGIN /));
        expect(count(lines(file), /^1 _STROM_SEX_ORIGIN /)).toBe(count(lines(RESEARCH), /^1 _STROM_SEX_ORIGIN /));
        // Read again and written again: the same.
        const twice = exportToGedcom(migrateData(convertToStrom(parseGedcom(file)).data), 'Hrbolec', { origins: true }).content;
        expect(undated(twice)).toBe(undated(file));
    });
});

describe('A divorce cited by a source written in place (2 SOUR text)', () => {
    const GED = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Mračoslav /Kroupal/', '1 SEX M', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Kapradina /Mlaskalová/', '1 SEX F', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1885',
        '1 DIV', '2 DATE 1890', '2 SOUR Court register of Drnkalov', '0 TRLR', ''].join('\n');

    it('takes it as the divorce\'s source and writes it back under DIV', () => {
        const tree = load(GED, '2026-11-09');
        const couple = divorcedCouple(tree);
        expect(couple.sourceIds ?? []).toEqual([]);
        expect((couple.divorceSourceIds ?? []).map(id => tree.sources![id].title)).toEqual(['Court register of Drnkalov']);
        for (const ged of [backTo(tree), exportToGedcom(tree, 'Hrbolec').content]) {
            const rec = record(ged, '@F1@');
            const marr = rec.indexOf('1 MARR');
            const div = rec.indexOf('1 DIV');
            expect(div).toBeGreaterThan(marr);
            expect(rec.slice(div + 1).some(l => /^2 SOUR /.test(l))).toBe(true);
            expect(rec.slice(marr, div).some(l => /SOUR/.test(l))).toBe(false);
        }
    });
});
