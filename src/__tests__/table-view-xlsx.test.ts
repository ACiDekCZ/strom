/**
 * Table view (spec 073 §11.3, §14.4): the XLSX of what the table shows,
 * read back — the zip (CRC and sizes), the content types and the workbook;
 * the sheet's group row (merged), head and coverage row; the column groups
 * and the union continuation rows as outlines; the frozen panes; a finding's
 * fill and comment; texts as written (never a formula), counts, whole-year
 * ages and completeness as numbers; Excel's "number stored as text" off; links; the
 * other row types; and a fuzz test that a value comes back as it went in
 * (emoji, combining marks, CJK, XML specials, control characters).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { validateTreeData } from '../validation.js';
import { buildTableModel, type TableModel } from '../ui/table-view/table-model.js';
import { cellOf, columnById, columnLabel, columnsOf, type ColumnDef } from '../ui/table-view/table-columns.js';
import { buildCheckIndex, applyChecks } from '../ui/table-view/table-checks.js';
import { buildTableCsv, tableCsvFileName } from '../ui/table-view/table-export.js';
import { buildTableXlsx } from '../ui/table-view/table-xlsx.js';
import { sortRows } from '../ui/table-view/table-filter.js';
import { buildXlsx, columnName, sheetName, xlsxText, XLSX_FILL, XLSX_NUMBER, XLSX_PERCENT, XLSX_STYLE } from '../xlsx.js';
import { readXlsx } from './helpers/xlsx-read.js';
import { parseXml } from './helpers/xml-parse.js';

const WHEN = new Date('2026-06-15T10:00:00Z');

/**
 * An invented family: Radomil with two unions (the second wife was 14 at the
 * wedding: "to check" on his Partner's age in that union), a man who died
 * before his birth (an error on the dates), a name that looks like a formula
 * and three sources: one with a web address, cited on a birth, one with an
 * address that is no web link.
 */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const persons = {
        a: person('a', 'Radomil', 'Quellbarth', 'male', { birthDate: '1840-02-03', deathDate: '1901', partnerships: ['u1', 'u2'], birthSourceIds: ['s1', 's2'] }),
        b: person('b', 'Ottilie', 'Varnsdeck', 'female', { birthDate: '1843', deathDate: '1868', partnerships: ['u1'] }),
        c: person('c', 'Senta', 'Morwinkel', 'female', { birthDate: '1860-05-01', partnerships: ['u2'] }),
        d: person('d', 'Kasimir', 'Quellbarth', 'male', { birthDate: '1900', deathDate: '1890' }),
        e: person('e', '=1+1', 'Quellbarth', 'male', { birthDate: '1870' }),
    };
    const partnerships = {
        u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married', startDate: '1864' },
        u2: { id: 'u2', person1Id: 'a', person2Id: 'c', childIds: [], status: 'married', startDate: '1874-08-01' },
    };
    const sources = {
        s1: { id: 's1', title: 'Matrika Brestovská', repository: 'Archiv Smyšlený', reference: 'fol. 7', url: 'https://example.org/matrika/7' },
        s2: { id: 's2', title: 'Soupis & <výpis>', reference: 'č. 2' },
        s3: { id: 's3', title: 'Výpis bez odkazu', url: 'javascript:alert(1)' },
    };
    return { persons, partnerships, sources } as unknown as StromData;
}

const build = (data = tree()): TableModel =>
    buildTableModel(data, { rev: 1, homeId: 'a' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });
const cols = (type: 'persons' | 'unions' | 'events' | 'sources', ids: string[]): ColumnDef[] => ids.map(id => columnById(type, id)!);

function checked() {
    const data = tree();
    const m = build(data);
    const index = buildCheckIndex(data, validateTreeData(data).issues);
    applyChecks(m, index);
    return { m, index };
}

const PERSON_COLS = ['name', 'gender', 'bDate', 'bPlace', 'partner', 'wDate', 'pAge', 'dDate', 'bRef', 'bUrl'];

function peopleXlsx(pinned = 1) {
    const { m, index } = checked();
    const rows = sortRows(m, 'persons', m.persons, [{ col: 'name', dir: 'asc' }]);
    const columns = cols('persons', PERSON_COLS);
    const out = buildTableXlsx({ model: m, type: 'persons', rows, columns, pinned, checks: index, sheetName: 'Overview', when: WHEN });
    return { out, read: readXlsx(out.bytes), m, rows, columns };
}

/** The texts of a sheet row from column A, empty where there is no cell. */
function rowTexts(read: ReturnType<typeof readXlsx>, r: number, n: number): string[] {
    return Array.from({ length: n }, (_v, i) => read.cell(`${columnName(i)}${r}`)?.text ?? '');
}

beforeAll(() => setLanguage('en'));

describe('the package (zip and parts)', () => {
    it('a stored zip whose CRCs and sizes match, with the parts a spreadsheet needs', () => {
        const { out, read } = peopleXlsx();
        expect(String.fromCharCode(out.bytes[0], out.bytes[1])).toBe('PK');
        expect([...read.files.keys()]).toEqual([
            '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
            'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/_rels/sheet1.xml.rels', 'xl/comments1.xml',
            'xl/drawings/vmlDrawing1.vml',
        ]);
        const types = read.files.get('[Content_Types].xml')!;
        expect(types).toContain('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>');
        expect(types).toContain('PartName="/xl/worksheets/sheet1.xml"');
        expect(types).toContain('PartName="/xl/sharedStrings.xml"');
        expect(types).toContain('PartName="/xl/comments1.xml"');
        expect(types).toContain('<Default Extension="vml"');
        expect(read.files.get('_rels/.rels')).toContain('Target="xl/workbook.xml"');
        const wb = read.files.get('xl/workbook.xml')!;
        expect(wb).toContain('<sheet name="Overview" sheetId="1" r:id="rId1"/>');
        expect(read.files.get('xl/_rels/workbook.xml.rels')).toContain('Target="worksheets/sheet1.xml"');
        // Every part is well-formed enough for a parser: one root, declared UTF-8.
        for (const [path, text] of read.files) {
            if (path.endsWith('.vml')) continue;
            expect(text.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), path).toBe(true);
        }
        const sheetRels = read.files.get('xl/worksheets/_rels/sheet1.xml.rels')!;
        expect(sheetRels).toContain('Target="../comments1.xml"');
        expect(sheetRels).toContain('Target="../drawings/vmlDrawing1.vml"');
        expect(read.sheet).toMatch(/<legacyDrawing r:id="rId\d+"\/><\/worksheet>$/);
        // "Number stored as text" off for the whole sheet, after pageMargins and before legacyDrawing (CT_Worksheet order).
        expect(read.sheet).toContain('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
            + '<ignoredErrors><ignoredError sqref="A1:K9" numberStoredAsText="1"/></ignoredErrors><legacyDrawing ');
    });

    it('every part of every workbook is well-formed XML (parsed, not matched): all four row types, findings, a fuzzed workbook', () => {
        const m = build();
        const books: Array<[string, Uint8Array]> = [['persons with findings', peopleXlsx().out.bytes]];
        for (const type of ['persons', 'unions', 'events', 'sources'] as const) {
            const rows = type === 'persons' ? m.persons : type === 'unions' ? m.unions : type === 'events' ? m.events : m.sources;
            books.push([type, buildTableXlsx({ model: m, type, rows, columns: columnsOf(type), pinned: 1, sheetName: '', when: WHEN }).bytes]);
        }
        books.push(['specials', buildXlsx({
            name: 'S',
            columns: [{ width: 10 }, { width: 10 }],
            rows: [{ cells: [{ text: '<a href="x">&amp; "q" \'a\' ]]> \u0001 😀 क्ष', comment: '& < > " \' ]]>' }, { text: '=1+1' }] }],
        }, WHEN)]);
        for (const [label, bytes] of books) {
            const files = readXlsx(bytes).files;
            expect(files.size, label).toBeGreaterThan(6);
            for (const [path, text] of files) {
                const root = (() => {
                    try { return parseXml(text); } catch (e) { throw new Error(`${label}: ${path}: ${(e as Error).message}`); }
                })();
                expect(root.name, `${label}: ${path}`).toBeTruthy();
            }
            // The styles the cells point at: every xf names a font, a fill and a number format that exist.
            const styles = parseXml(files.get('xl/styles.xml')!);
            const part = (n: string) => styles.children.find(c => c.name === n)!;
            const xfs = part('cellXfs').children;
            expect(xfs).toHaveLength(Number(part('cellXfs').attrs.get('count')));
            for (const xf of xfs) {
                expect(Number(xf.attrs.get('fontId')), label).toBeLessThan(part('fonts').children.length);
                expect(Number(xf.attrs.get('fillId')), label).toBeLessThan(part('fills').children.length);
                expect(xf.attrs.get('numFmtId'), label).toMatch(/^\d+$/);
            }
        }
    });

    it('the XML parser of the tests rejects what a spreadsheet program rejects', () => {
        expect(parseXml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a x="1"><b/>t&amp;&#x1F600;<![CDATA[<]]></a>').children).toHaveLength(1);
        for (const bad of [
            '<a><xf numFmtId="49" fontId=""0" fillId="0"/></a>',
            '<a x="1" x="2"/>', '<a><b></a></b>', '<a>', '<a/><b/>', '<a>&nbsp;</a>', '<a>& b</a>', '<a x="<"/>',
            '<a x=1/>', '<a>\u0001</a>', '<a>\uD800</a>', '<a>]]></a>', 'text<a/>', '<a/>text', '<a x="1"y="2"/>',
            ' <?xml version="1.0"?><a/>', '<!DOCTYPE a><a/>', '<a><!-- a -- b --></a>',
        ]) {
            expect(() => parseXml(bad), bad).toThrow(/XML not well-formed/);
        }
    });

    it('the archive is dated and the same input gives the same bytes', () => {
        const a = peopleXlsx().out.bytes;
        const b = peopleXlsx().out.bytes;
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it('a file name with .xlsx', () => {
        expect(tableCsvFileName('Rod Quellbarthů', 'Přehled', new Date(2026, 5, 15, 12), 'xlsx')).toBe('Rod-Quellbarthu_Prehled_2026-06-15.xlsx');
        expect(tableCsvFileName('Rod', 'Přehled', new Date(2026, 5, 15, 12))).toBe('Rod_Prehled_2026-06-15.csv');
    });
});

describe('the sheet (§11.3)', () => {
    it('row 1 the groups (merged), row 2 the head with the "Union" column, row 3 the coverage row', () => {
        const { read, out } = peopleXlsx();
        const n = out.columns;
        expect(n).toBe(PERSON_COLS.length + 1);
        expect(rowTexts(read, 1, n)).toEqual(['Person', '', '', 'Birth and baptism', '', 'Unions', '', '', 'Death and burial', 'Sources', '']);
        expect(read.sheet).toContain('<mergeCells count="4"><mergeCell ref="A1:C1"/><mergeCell ref="D1:E1"/><mergeCell ref="F1:H1"/><mergeCell ref="J1:K1"/></mergeCells>');
        expect(read.cell('A1')!.style).toBe(XLSX_STYLE.group);
        const head = rowTexts(read, 2, n);
        expect(head.slice(0, 4)).toEqual(['Full name', 'Union', 'Sex', 'Birth date']);
        expect(read.cell('A2')!.style).toBe(XLSX_STYLE.bold);
        // Coverage: "filled" under the name, a percentage per column (a number shown "0%"), none for "Union".
        expect(read.cell('A3')!.text).toBe('filled');
        expect(read.cell('B3')).toBeUndefined();
        expect(read.cell('D3')).toMatchObject({ type: '', text: '1', style: XLSX_STYLE.faint + XLSX_PERCENT });
        // Birth place: nobody has one → 0 % (bold, under 50 %).
        expect(read.cell('E3')).toMatchObject({ type: '', text: '0', style: XLSX_STYLE.bold + XLSX_PERCENT });
        const styles = read.files.get('xl/styles.xml')!;
        const xfs = [...styles.split('<cellXfs')[1].matchAll(/<xf numFmtId="(\d+)"/g)].map(m => Number(m[1]));
        expect(xfs[XLSX_STYLE.bold + XLSX_PERCENT]).toBe(9);
        expect(xfs[XLSX_STYLE.normal + XLSX_NUMBER]).toBe(0);
        expect(xfs[XLSX_STYLE.normal]).toBe(49);
        expect(out.items).toBe(5);
        expect(out.lines).toBe(6);
        expect(read.rows).toHaveLength(3 + 6);
    });

    it('the same lines and texts as the CSV', () => {
        const { m, rows, columns, read, out } = peopleXlsx();
        const csv = buildTableCsv({ model: m, type: 'persons', rows, columns });
        const lines = csv.csv.slice(1).split('\r\n').filter(Boolean);
        expect(lines.length - 1).toBe(out.lines);
        // Radomil's continuation row: only the union's cells and "2 of 2".
        const k = read.rows.findIndex(r => r.cells.get(`A${r.r}`)?.text.startsWith('Radomil'));
        const main = read.rows[k];
        const cont = read.rows[k + 1];
        expect(main.cells.get(`B${main.r}`)!.text).toBe('1 of 2');
        expect(cont.cells.get(`B${cont.r}`)!.text).toBe('2 of 2');
        expect(cont.cells.get(`A${cont.r}`)).toBeUndefined();
        expect(cont.cells.get(`F${cont.r}`)!.text).toContain('Senta');
    });

    it('column groups and continuation rows as outlines, Excel\'s level 2', () => {
        const { read } = peopleXlsx();
        expect(read.sheet).toContain('<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>');
        expect(read.sheet).toMatch(/<sheetFormatPr defaultRowHeight="15" outlineLevelRow="1" outlineLevelCol="1"\/>/);
        const levels = [...read.sheet.matchAll(/<col min="(\d+)"[^>]*?(?: outlineLevel="(\d)")?\/>/g)].map(m => Number(m[2] ?? 0));
        // A (frozen), B "Union" (frozen with the name), C Gender (in the person group, outside the frozen part),
        // D Birth date (first of its group), E, F Partner (first), G, H Partner's age, I Death date (first), J (first), K.
        expect(levels).toEqual([0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1]);
        const outlined = read.rows.filter(r => r.outline > 0);
        expect(outlined).toHaveLength(1);
        expect(outlined[0].outline).toBe(1);
        expect(outlined[0].cells.get(`B${outlined[0].r}`)!.text).toBe('2 of 2');
    });

    it('the pinned columns and the three head rows are frozen', () => {
        expect(peopleXlsx(1).read.sheet).toContain('<pane xSplit="2" ySplit="3" topLeftCell="C4" activePane="bottomRight" state="frozen"/>');
        // Two pinned columns (name + gender) and the "Union" column after the name.
        expect(peopleXlsx(2).read.sheet).toContain('<pane xSplit="3" ySplit="3" topLeftCell="D4" activePane="bottomRight" state="frozen"/>');
    });

    it('a finding\'s cell: the fill of its level and the findings as a comment; a trace has no fill', () => {
        const { read, out } = peopleXlsx();
        const styles = read.files.get('xl/styles.xml')!;
        expect(styles).toContain(`<fgColor rgb="FF${XLSX_FILL.error}"/>`);
        expect(styles).toContain(`<fgColor rgb="FF${XLSX_FILL.warning}"/>`);
        expect(XLSX_FILL).toEqual({ error: 'F5E6E2', warning: 'F6ECD3' });
        // Kasimir died before his birth: an error on the birth and death dates.
        const k = read.rows.find(r => r.cells.get(`A${r.r}`)?.text.startsWith('Kasimir'))!;
        const bDate = k.cells.get(`D${k.r}`)!;
        expect(bDate.style).toBe(XLSX_STYLE.errorFill);
        expect(read.comments.get(`D${k.r}`)).toMatch(/^Error: /);
        expect(k.cells.get(`I${k.r}`)!.style).toBe(XLSX_STYLE.errorFill);
        // Radomil's second wife was 14: "to check" on Partner's age in the continuation row.
        const cont = read.rows.find(r => r.outline === 1)!;
        const pAge = cont.cells.get(`H${cont.r}`)!;
        expect(pAge).toMatchObject({ type: '', text: '14', style: XLSX_STYLE.warningFill + XLSX_NUMBER });
        expect(read.comments.get(`H${cont.r}`)).toMatch(/^To check: /);
        expect(out.marked).toBe(read.comments.size);
        // The legacy drawing has one hidden note per comment, anchored on its cell.
        const vml = read.files.get('xl/drawings/vmlDrawing1.vml')!;
        expect(vml.match(/<v:shape /g)).toHaveLength(read.comments.size);
        expect(vml).toContain(`<x:Row>${cont.r - 1}</x:Row><x:Column>7</x:Column>`);
    });

    it('without findings: no fills, no comments, no drawing', () => {
        const m = build();
        const out = buildTableXlsx({ model: m, type: 'persons', rows: m.persons, columns: cols('persons', ['name', 'bDate']), pinned: 1, sheetName: 'x', when: WHEN });
        const read = readXlsx(out.bytes);
        expect(read.files.has('xl/comments1.xml')).toBe(false);
        expect(read.files.has('xl/drawings/vmlDrawing1.vml')).toBe(false);
        expect(read.files.get('[Content_Types].xml')).not.toContain('vml');
        expect(read.sheet).not.toContain('legacyDrawing');
        expect(out.marked).toBe(0);
    });

    it('texts as the table shows them (a formula-like text kept, never a formula), ages as numbers, citations, links', () => {
        const { read } = peopleXlsx();
        const cells = read.rows.slice(1).flatMap(r => [...r.cells.values()]);
        expect(cells.length).toBeGreaterThan(20);
        // Texts are shared strings; the only numbers are Partner's age (column H) and the coverage row.
        expect(cells.filter(c => c.type !== 's').every(c => c.ref.startsWith('H') || /^[A-Z]+3$/.test(c.ref))).toBe(true);
        expect(read.sheet).not.toMatch(/<f>|t="n"|t="d"|<is>/);
        const e = read.rows.find(r => r.cells.get(`A${r.r}`)?.text.startsWith('=1+1'))!;
        expect(e.cells.get(`A${e.r}`)).toMatchObject({ type: 's', text: '=1+1 Quellbarth' });
        // Radomil's birth cites two sources: the first one's reference and "(+1)" as in the CSV.
        const a = read.rows.find(r => r.cells.get(`A${r.r}`)?.text.startsWith('Radomil'))!;
        expect(a.cells.get(`J${a.r}`)!.text).toBe('fol. 7 (+1)');
        expect(a.cells.get(`K${a.r}`)!.text).toContain('example.org/matrika/7');
        expect(read.sheet).toContain(`<hyperlinks><hyperlink ref="K${a.r}" r:id="rId1"/></hyperlinks>`);
        expect(read.files.get('xl/worksheets/_rels/sheet1.xml.rels')).toContain('Target="https://example.org/matrika/7" TargetMode="External"');
        // A date stays the app's text, never a serial number.
        expect(a.cells.get(`D${a.r}`)!.text).toBe('3 Feb 1840');
    });

    it('the other row types: Unions, Events and Sources (an unsafe link left out)', () => {
        const m = build();
        for (const type of ['unions', 'events', 'sources'] as const) {
            const columns = columnsOf(type).filter(c => c.phase === 1);
            const rows = type === 'unions' ? m.unions : type === 'events' ? m.events : m.sources;
            const out = buildTableXlsx({ model: m, type, rows, columns, pinned: 1, sheetName: '', when: WHEN });
            const read = readXlsx(out.bytes);
            expect(out.lines).toBe(rows.length);
            expect(read.rows).toHaveLength(3 + rows.length);
            expect(read.rows.every(r => r.outline === 0)).toBe(true);
            expect(rowTexts(read, 2, columns.length)).toEqual(columns.map(columnLabel));
            // The sheet is named after the row type when the view has no name.
            expect(read.files.get('xl/workbook.xml')).toContain(`<sheet name="${type[0].toUpperCase()}${type.slice(1)}"`);
        }
        const src = buildTableXlsx({ model: m, type: 'sources', rows: m.sources, columns: cols('sources', ['srcTitle', 'srcUrl']), pinned: 1, sheetName: 'S', when: WHEN });
        const read = readXlsx(src.bytes);
        expect(rowTexts(read, 4, 2)).toEqual(['Matrika Brestovská', 'https://example.org/matrika/7']);
        expect(read.cell('A5')!.text).toBe('Soupis & <výpis>');
        expect(read.files.get('xl/sharedStrings.xml')).toContain('Soupis &amp; &lt;výpis&gt;');
        const rels = read.files.get('xl/worksheets/_rels/sheet1.xml.rels')!;
        expect(rels.match(/TargetMode="External"/g)).toHaveLength(1);
        expect(rels).not.toContain('javascript');
    });
});

describe('numbers by the column, never by the text', () => {
    it('counts, whole-year ages and completeness are numbers; a name "1848", dates, ranges and "–" stay texts; the CSV unchanged', () => {
        const data = tree();
        const p = data.persons as unknown as Record<string, Record<string, unknown>>;
        p.e.firstName = '1848';
        p.e.lastName = '';
        p.a.deathDate = '1901-03-01';
        const m = build(data);
        const index = buildCheckIndex(data, validateTreeData(data).issues);
        applyChecks(m, index);
        const columns = cols('persons', ['name', 'bDate', 'dAge', 'uCount', 'nFind', 'comp']);
        const rows = sortRows(m, 'persons', m.persons, [{ col: 'name', dir: 'asc' }]);
        const out = buildTableXlsx({ model: m, type: 'persons', rows, columns, pinned: 1, checks: index, sheetName: 'N', when: WHEN });
        const read = readXlsx(out.bytes);
        const at = (first: string) => read.rows.find(r => r.cells.get(`A${r.r}`)?.text.startsWith(first))!;
        // The "Union" column follows the name (Radomil has two unions).
        expect(out.columns).toBe(columns.length + 1);
        const col = (r: ReturnType<typeof at>, id: string) => {
            const i = columns.findIndex(c => c.id === id);
            return r.cells.get(`${columnName(i === 0 ? 0 : i + 1)}${r.r}`);
        };
        const name = at('1848');
        expect(col(name, 'name')).toMatchObject({ type: 's', text: '1848' });
        // Radomil: the date a text, the age at death 61 a number, 2 unions, the completeness a fraction.
        const a = at('Radomil');
        expect(col(a, 'bDate')).toMatchObject({ type: 's', text: '3 Feb 1840' });
        expect(col(a, 'dAge')).toMatchObject({ type: '', text: '61' });
        expect(col(a, 'uCount')).toMatchObject({ type: '', text: '2' });
        expect(col(a, 'nFind')!.type).toBe('');
        const comp = col(a, 'comp')!;
        expect(comp.type).toBe('');
        expect(comp.style).toBe(XLSX_STYLE.normal + XLSX_PERCENT);
        const shown = m.persons.find(r => r.id === 'a')!;
        expect(Number(comp.text)).toBeCloseTo((cellOf(m, shown, columnById('persons', 'comp')!).percent ?? -1) / 100, 6);
        // Ottilie (born 1843, died 1868): an age as a range stays the text the table shows.
        const b = col(at('Ottilie'), 'dAge')!;
        expect(b.type).toBe('s');
        expect(b.text).toMatch(/\d+–\d+/);
        // The CSV keeps its texts.
        const csv = buildTableCsv({ model: m, type: 'persons', rows, columns }).csv;
        expect(csv).toMatch(/;61;2;/);
        expect(csv).toMatch(/\d+ %/);
    });

    it('Sources: People and Facts as numbers; Unions: children as a number', () => {
        const m = build();
        const src = readXlsx(buildTableXlsx({ model: m, type: 'sources', rows: m.sources, columns: cols('sources', ['srcTitle', 'srcPersons', 'srcFacts']), pinned: 1, sheetName: 'S', when: WHEN }).bytes);
        expect(src.cell('A4')!.text).toBe('Matrika Brestovská');
        expect(src.cell('B4')).toMatchObject({ type: '', text: '1' });
        expect(src.cell('C4')).toMatchObject({ type: '', text: '1' });
        const un = readXlsx(buildTableXlsx({ model: m, type: 'unions', rows: m.unions, columns: cols('unions', ['p1', 'uKids']), pinned: 1, sheetName: 'U', when: WHEN }).bytes);
        expect(un.cell('B4')).toMatchObject({ type: '', text: '0' });
    });
});

describe('text as a sheet holds it', () => {
    it('XML-invalid characters out; emoji, combining marks and CJK kept; long text cut without splitting a pair', () => {
        expect(xlsxText('a\u0000b\u0007c\u001Fd\tE\nF')).toBe('abcd\tE\nF');
        expect(xlsxText('x\uD800y\uDC00z￾')).toBe('xyz');
        expect(xlsxText('Pétrov 👨‍👩‍👧 王小明 🇨🇿')).toBe('Pétrov 👨‍👩‍👧 王小明 🇨🇿');
        const long = 'a'.repeat(32766) + '😀';
        expect(xlsxText(long)).toBe('a'.repeat(32766));
        expect(xlsxText('a'.repeat(40000))).toHaveLength(32767);
    });

    it('sheet names: no []:*?/\\, at most 31 characters, a fallback', () => {
        expect(sheetName('Deaths [1850/1900]: *?')).toBe('Deaths 1850 1900');
        expect(sheetName('x'.repeat(40))).toHaveLength(31);
        expect(sheetName("''")).toBe('Sheet1');
        expect(sheetName('Přehled 王')).toBe('Přehled 王');
    });

    it('column names', () => {
        expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
    });

    it('fuzz: a value → XLSX → read back is the value (after the XML cleanup), always a shared string', () => {
        let seed = 20261110;
        const rnd = (n: number): number => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed % n;
        };
        const pieces = ['a', 'Ž', 'ß', 'é', 'ñ', 'क्ष', '王', '小明', '한글', '😀', '👨‍👩‍👧', '🇨🇿', '👍🏽',
            '&', '<', '>', '"', "'", ';', ',', '\n', '\r', '\r\n', '\t', ' ', '  ', '=', '+', '-', '@', '_x0041_', '_x', ']]>', '\u0000', '\u0008',
            '￾', '\uD800', '\uDC00', '‍', '﻿', ' ', '©', '½', '1', '07', '1.5', 'TRUE', '1/2'];
        const values: string[][] = [];
        for (let r = 0; r < 120; r++) {
            const row: string[] = [];
            for (let c = 0; c < 6; c++) {
                let s = '';
                const len = rnd(9);
                for (let i = 0; i < len; i++) s += pieces[rnd(pieces.length)];
                row.push(s);
            }
            values.push(row);
        }
        const bytes = buildXlsx({
            name: 'Fuzz',
            columns: Array.from({ length: 6 }, () => ({ width: 10 })),
            rows: values.map(row => ({ cells: row.map(text => ({ text, comment: text })) })),
        }, WHEN);
        const read = readXlsx(bytes);
        for (let r = 0; r < values.length; r++) {
            for (let c = 0; c < 6; c++) {
                const want = xlsxText(values[r][c]);
                const ref = `${columnName(c)}${r + 1}`;
                expect(read.cell(ref)?.text ?? '', ref).toBe(want);
                expect(read.comments.get(ref) ?? '', `${ref} comment`).toBe(xlsxText(values[r][c]));
            }
        }
    });
});
