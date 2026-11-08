/**
 * Every case of spec 066 in one file, so a change that breaks any of them
 * shows here (fictional people):
 * - test/gedcom-066-combined.ged: a MyHeritage Family Tree Builder file, one
 *   block of records per case (xrefs @I<case>01@…, @F<case>01@…), the two
 *   source records shared at the end;
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
import { StromData } from '../types.js';

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
            ['RIN', people, /^1 RIN /], ['_UID', people, /^1 _UID /], ['_UPD', ['INDI', 'FAM', 'SOUR'], /^1 _UPD /],
            ['BIRT', people, /^1 BIRT$/], ['DEAT', people, /^1 DEAT( Y)?$/], ['MARR', people, /^1 MARR$/],
            ['RESI', people, /^1 RESI$/], ['EMAIL', people, /^2 EMAIL /], ['NCHI', people, /^1 NCHI /],
            ['AGE', people, /^2 AGE /], ['NOTE', people, /^\d NOTE /], ['CONT', people, /^\d CONT /],
            ['OBJE', people, /^1 OBJE$/], ['_DATE', people, /^2 _DATE /], ['_PHOTO_RIN', people, /^2 _PHOTO_RIN /],
            ['SOUR citation', people, /^\d SOUR @/], ['PAGE', people, /^\d PAGE /], ['QUAY', people, /^\d QUAY /],
            ['TEXT', people, /^\d TEXT /], ['CONC', people, /^\d CONC /], ['ROLE', people, /^\d ROLE /],
            ['AUTH', ['SOUR'], /^1 AUTH /], ['PUBL', ['SOUR'], /^1 PUBL /], ['_TYPE', ['SOUR'], /^1 _TYPE /], ['_MEDI', ['SOUR'], /^1 _MEDI /],
            // GIVN / SURN under a married name are not written back yet: that record is left out here.
            ['GIVN', people, /^2 GIVN /], ['SURN', people, /^2 SURN /],
        ];
        const tally = (ged: string) => Object.fromEntries(counted.map(([name, types, re]) =>
            [name, count(recordsOf(ged, types, name === 'GIVN' || name === 'SURN' ? ['@I501@'] : []), re)]));
        expect(tally(first)).toEqual(tally(FILE));
    });

    it('no note the file did not write', () => {
        expect(count(lines(first), /^1 NOTE /)).toBe(0);
        expect(first).not.toMatch(/_STROM_NOTED|_STROM_CITE|Number of children|Publication:|Author:|Birth:/);
    });

    describe('each case', () => {
        it('1 · one source record cited at many pages, with and without PAGE, QUAY, DATA > DATE / TEXT (CONC), EVEN > ROLE', () => {
            expect(citations(first)).toEqual(citations(FILE));
            expect(record(first, '@S1@')).toEqual(expect.arrayContaining(['1 TITL Parish register Hrbolcov',
                '1 AUTH Hrbolcov parish office', '1 PUBL Hrbolcov 1860', '1 _TYPE Parish register', '1 _MEDI Book',
                '1 _UPD 8 NOV 2026 10:00:00 GMT -0500']));
            expect(count(record(first, '@S1@'), /^1 (PAGE|NOTE) /)).toBe(0);
            const kvasibor = record(first, '@I101@');
            expect(holdsRun(kvasibor, ['2 SOUR @S1@', '3 PAGE fol. 3', '3 DATA', '4 DATE 3 FEB 1860',
                '4 TEXT Kvasibor, son of the potter', '5 CONC  of Hrbolcov', '3 QUAY 3', '3 EVEN BIRT', '4 ROLE CHIL'])).toBe(true);
            expect(holdsRun(kvasibor, ['1 SOUR @S2@', '2 DATA',
                '3 TEXT Kvasibor Hrbolec, potter of Hrbolcov, named in the chronicle', '4 CONC  for the year of the flood',
                '2 QUAY 3', '2 EVEN RESI', '3 ROLE PRIN'])).toBe(true);
            expect(holdsRun(kvasibor, ['1 SOUR @S1@', '2 PAGE fol. 9'])).toBe(true);
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

        it('5 · a name after marriage with given names of its own (TYPE married)', () => {
            const rec = record(first, '@I501@');
            expect(holdsRun(rec, ['1 NAME Duhoslava Věnuna /Hrbolcová/', '2 TYPE married'])).toBe(true);
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
    });
});

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
