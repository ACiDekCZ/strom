/**
 * Table view (spec 073 §3, §5, §6): union sub-rows, computed values and
 * substitutes, the coverage row and a person's completeness — the parts
 * without the DOM.
 */

import { describe, it, expect } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { approxAgeBetween, flexDateParts } from '../dates.js';
import { getStringsForLang, type Language } from '../strings.js';
import { buildTableModel, type PersonRow, type TableModel } from '../ui/table-view/table-model.js';
import { ageCell, cellOf, cellPlainText, columnById, columnNote, PERSON_COLUMNS, UNION_COLUMNS } from '../ui/table-view/table-columns.js';
import { sortRows } from '../ui/table-view/table-filter.js';
import { columnCoverage, coverageCell } from '../ui/table-view/table-coverage.js';
import {
    anyExpanded, buildLines, coverageUnionsOf, defaultUnionCollapse, hasMultiUnions, isExpanded, lineCell, lineKey, lineLevel,
    passingUnions, personPassesUnions, setAllExpanded, setExpanded, sortUnionOf, toggleExpanded, type UnionPredicate,
} from '../ui/table-view/table-subrows.js';
import { lineOffsets, lineWindow } from '../ui/table-view/table-window.js';
import { defaultTypeState } from '../ui/table-view/table-state.js';

/*
 * An invented family. Halvor has three unions (dated 1890 and 1902, one
 * undated); Tobin is living; Corvin has only a baptism and a burial;
 * Ysolde's dates are estimates.
 */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const persons: Record<string, Record<string, unknown>> = {
        h: person('h', 'Halvor', 'Quillmaren', 'male', {
            birthDate: '1862-04-10', birthPlace: 'Vellmark', deathDate: '1934-02-01', partnerships: ['u1', 'u2', 'u3'], childIds: ['c'],
        }),
        w1: person('w1', 'Ysolde', 'Arkenvale', 'female', { birthDate: '~1865', deathDate: '<1932', partnerships: ['u1'], childIds: ['c'] }),
        w2: person('w2', 'Brenna', 'Thistlecombe', 'female', { birthDate: '1878-06-01', partnerships: ['u2'] }),
        w3: person('w3', 'Maelis', 'Orrowind', 'female', { birthDate: '1870..1872', partnerships: ['u3'] }),
        c: person('c', 'Corvin', 'Quillmaren', 'male', {
            parentIds: ['h', 'w1'],
            events: [{ id: 'e1', type: 'baptism', date: '1891-03-02', place: 'Vellmark' }, { id: 'e2', type: 'burial', date: '1950-07-08', place: 'Dornwick' }],
        }),
        s: person('s', 'Tobin', 'Pellwright', 'male', { birthDate: '1990' }),
    };
    const partnerships = {
        u2: { id: 'u2', person1Id: 'h', person2Id: 'w2', childIds: [], status: 'married', startDate: '1902-05-05', startPlace: 'Dornwick' },
        u3: { id: 'u3', person1Id: 'h', person2Id: 'w3', childIds: [], status: 'married' },
        u1: { id: 'u1', person1Id: 'h', person2Id: 'w1', childIds: ['c'], status: 'married', startDate: '1890-06-01', sourceIds: ['s1'] },
    };
    return { persons, partnerships } as unknown as StromData;
}

const build = (lang: Language = 'en'): TableModel => buildTableModel(tree(), { rev: 1, homeId: 'h' as PersonId, lang, year: 2026 });
const prow = (m: TableModel, id: string): PersonRow => m.personRows.get(id as PersonId)!;
const cell = (m: TableModel, id: string, col: string, union?: number) => cellOf(m, prow(m, id), columnById('persons', col)!, union);

describe('computed values (§5.1)', () => {
    it('an age: exact on day dates, a range from a year or a range date, ≈ from an estimate', () => {
        expect(ageCell('1862-04-10', '1934-02-01').text).toBe('71');
        expect(ageCell('1862', '1934-02-01').text).toBe('71–72');
        expect(ageCell('1870..1872', '1934').text).toBe('61–64');
        expect(ageCell('1862', '1862').text).toBe('0');
        const est = ageCell('~1865', '1932-01-01');
        expect(est.text).toBe('≈ 67');
        expect(est.approx).toBe(true);
        expect(est.computed).toBe(true);
        expect(ageCell('1865', '<1932').text).toBe('≈ 67');
        expect(ageCell('>1865', '1932').text).toBe('≈ 67');
        // The end before the start: nothing (a finding, §7).
        expect(ageCell('1900', '1890').empty).toBe(true);
        expect(ageCell('~1900', '1890').empty).toBe(true);
        // A substitute date: always ≈ (a range gives its upper end).
        expect(ageCell('1891-03-02', '1950-07-08', true).text).toBe('≈ 59');
        expect(ageCell('1891', '1950', true).text).toBe('≈ 59');
        expect(ageCell(undefined, '1950').empty).toBe(true);
    });

    it('approxAgeBetween is the difference of the years; flexDateParts splits the qualifier', () => {
        expect(approxAgeBetween('~1865', '1932-11-30')).toBe(67);
        expect(approxAgeBetween('1932', '1865')).toBeNull();
        expect(flexDateParts('~1865', 'cs')).toEqual({ qualifier: '~', main: '1865' });
        expect(flexDateParts('1920..1925', 'en')).toEqual({ qualifier: '', main: '1920–1925' });
        expect(flexDateParts('<1880-05-15', 'cs')).toEqual({ qualifier: '<', main: '15. 5. 1880' });
        expect(flexDateParts('~1880-05', 'pl')!.main).toBe('maja 1880');
    });

    it('ages in the catalog: at death, at the wedding, of the partner, of the parents at the birth', () => {
        const m = build();
        expect(cell(m, 'h', 'dAge').text).toBe('71');
        expect(cell(m, 'h', 'wAge', 0).text).toBe('28');
        expect(cell(m, 'h', 'pAge', 0).text).toBe('≈ 25');
        expect(cell(m, 'h', 'wAge', 1).text).toBe('40');
        // Corvin has only a baptism: the parents' ages and his age at death are estimates.
        expect(cell(m, 'c', 'fAge').text).toBe('≈ 28');
        expect(cell(m, 'c', 'mAge').text).toBe('≈ 26');
        expect(cell(m, 'c', 'dAge').text).toBe('≈ 59');
        // No parents: the parents' ages do not apply.
        expect(cell(m, 's', 'fAge').na).toBe(true);
        // A union's length: to the first death.
        expect(cell(m, 'h', 'uLen', 0).text).toBe('≈ 42');
    });

    it('a computed column says what it is computed from, in every language; a recorded one says nothing', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as Language[]) {
            const t = getStringsForLang(lang).table;
            for (const key of Object.keys(t.from)) expect((t.from as Record<string, string>)[key], `${lang} ${key}`).toBeTruthy();
        }
        for (const col of [...PERSON_COLUMNS, ...UNION_COLUMNS]) {
            if (col.computed) expect(columnNote(col), `${col.rowType} ${col.id}`).toMatch(/^Computed from: \S/);
            else expect(columnNote(col), col.id).toBe('');
        }
        expect(columnNote(columnById('persons', 'wAge')!)).toBe('Computed from: the birth date and the wedding date');
    });
});

describe('substitutes and uncertain dates (§5.2, §5.3)', () => {
    it('the baptism stands for the birth, the burial for the death, marked and in plain text with the label', () => {
        const m = build();
        const b = cell(m, 'c', 'bDate');
        expect(b.subst).toBe('bap');
        expect(b.text).toBe('2 Mar 1891');
        expect(cellPlainText(b)).toBe('bap. 2 Mar 1891');
        expect(cell(m, 'c', 'bPlace').subst).toBe('bap');
        expect(cell(m, 'c', 'dDate').subst).toBe('bur');
        expect(cell(m, 'c', 'dPlace').text).toBe('Dornwick');
        // Sorting counts the substitute.
        expect(b.sortKey).toBe(18910302);
    });

    it('a qualified date has its word before it and is uncertain, not a finding; a range is "start–end"', () => {
        const m = build();
        const d = cell(m, 'w1', 'bDate');
        expect(d.prefix).toBe('abt.');
        expect(d.text).toBe('1865');
        expect(d.uncertain).toBe(true);
        expect(d.issue).toBeUndefined();
        expect(cellPlainText(d)).toBe('abt. 1865');
        expect(cell(m, 'w1', 'dDate').prefix).toBe('bef.');
        expect(cell(m, 'w1', 'dDate').sortKey).toBe(19320000);
        expect(cell(m, 'w3', 'bDate').text).toBe('1870–1872');
        expect(cell(m, 'w3', 'bDate').uncertain).toBe(true);
        expect(cell(m, 'h', 'bDate').uncertain).toBe(false);
        const cs = build('cs');
        // The language's words (the model's own language).
        expect(['cca', 'abt.']).toContain(cellOf(cs, prow(cs, 'w1'), columnById('persons', 'bDate')!).prefix);
    });
});

describe('completeness (§6.2)', () => {
    it('birth, union, death and overall, with what is missing; the living leave death out', () => {
        const m = build();
        const bc = cell(m, 'h', 'bComp');
        // date, place; no parents, no source: 2 of 5.
        expect(bc.percent).toBe(40);
        expect(bc.title).toContain('Birth completeness 40 %');
        expect(bc.title).toContain('missing: father, mother, birth source');
        expect(bc.title).toContain('Counted from: date, place, father, mother, source.');
        // u1: date, partner, source; no place: 75 %.
        expect(cell(m, 'h', 'uComp', 0).percent).toBe(75);
        // Tobin is living: death "living", left out of the overall.
        const dc = cell(m, 's', 'dComp');
        expect(dc.na).toBe(true);
        expect(dc.text).toBe('living');
        // Tobin has no union either: the overall is his birth alone (1 of 5).
        expect(cell(m, 's', 'uComp').na).toBe(true);
        expect(cell(m, 's', 'comp').percent).toBe(20);
        // Brenna: birth date (1 of 5) + union u2 date, place, partner (3 of 4) + death (0 of 3) = 4 of 12.
        expect(cell(m, 'w2', 'comp').percent).toBe(33);
        expect(cell(m, 'w2', 'dComp').title).toContain('missing: death date, death place, death source');
        // A substitute does not fill a field: Corvin's birth has father and mother only.
        expect(cell(m, 'c', 'bComp').percent).toBe(40);
    });
});

describe('coverage row (§6.1)', () => {
    it('counts the rows a column applies to, the substitute not as filled; unions are the unit of union columns', () => {
        const m = build();
        const rows = m.persons;
        const bDate = columnCoverage(m, rows, columnById('persons', 'bDate')!);
        // 6 people; Corvin's baptism is a substitute.
        expect(bDate).toEqual({ filled: 5, total: 6, percent: 83 });
        // Death date: Tobin is living (left out); Corvin's burial is a substitute.
        const dDate = columnCoverage(m, rows, columnById('persons', 'dDate')!);
        expect(dDate.total).toBe(5);
        expect(dDate.filled).toBe(2);
        // Wedding date: the unit is the union — Halvor's 3 + one each for his three partners = 6; 4 dated.
        const wDate = columnCoverage(m, rows, columnById('persons', 'wDate')!);
        expect(wDate).toEqual({ filled: 4, total: 6, percent: 67 });
        // Father's age: only people with a father.
        expect(columnCoverage(m, rows, columnById('persons', 'fAge')!).total).toBe(1);
        expect(coverageCell(dDate)).toMatchObject({ text: '40 %', low: true, title: '2 of 5' });
        expect(coverageCell(bDate).low).toBe(false);
        expect(coverageCell({ filled: 0, total: 0, percent: null }).text).toBe('–');
        // With a union filter, only the passing unions count.
        const dated: UnionPredicate = (r, i) => !!r.unions[i].startDate;
        expect(columnCoverage(m, rows, columnById('persons', 'wDate')!, coverageUnionsOf(dated))).toEqual({ filled: 4, total: 4, percent: 100 });
        // Unions table: one row per union.
        expect(columnCoverage(m, m.unions, columnById('unions', 'wPlace')!).percent).toBe(33);
    });
});

describe('union sub-rows (§3)', () => {
    it('collapse state: overall with exceptions per person', () => {
        const st = defaultUnionCollapse();
        expect(isExpanded(st, 'h')).toBe(true);
        expect(setExpanded(st, 'h', false)).toBe(true);
        expect(st).toEqual({ collapsed: false, except: ['h'] });
        expect(setExpanded(st, 'h', false)).toBe(false);
        expect(toggleExpanded(st, 'h')).toBe(true);
        expect(st.except).toEqual([]);
        expect(setAllExpanded(st, false)).toBe(true);
        expect(st).toEqual({ collapsed: true, except: [] });
        setExpanded(st, 'h', true);
        expect(st).toEqual({ collapsed: true, except: ['h'] });
        expect(isExpanded(st, 'w1')).toBe(false);
        expect(setAllExpanded(st, true)).toBe(true);
        expect(st).toEqual({ collapsed: false, except: [] });
        // Part of the row type's state (the view keeps it, §9.1).
        expect(defaultTypeState('persons').unions).toEqual({ collapsed: false, except: [] });
    });

    it('expanded: the person\'s row, then one sub-row per union by date (undated last)', () => {
        const m = build();
        const h = prow(m, 'h');
        const lines = buildLines([h, prow(m, 's')], { collapse: defaultUnionCollapse() });
        expect(lines.map(l => `${l.kind}:${l.kind === 'sub' ? l.k : ''}`)).toEqual(['row:', 'sub:1', 'sub:2', 'sub:3', 'row:']);
        expect(lines.map(lineLevel)).toEqual([1, 2, 2, 2, 1]);
        expect(lines.map(lineKey)).toEqual(['p:h', 'p:h#u1', 'p:h#u2', 'p:h#u3', 'p:s']);
        const partner = columnById('persons', 'partner')!;
        const wDate = columnById('persons', 'wDate')!;
        const bDate = columnById('persons', 'bDate')!;
        // The person's row: Partner gives the count, the other union cells are empty, the person's own are filled.
        expect(lineCell(m, lines[0], partner)).toMatchObject({ text: '3 unions', aggregate: true });
        expect(lineCell(m, lines[0], wDate).empty).toBe(true);
        expect(lineCell(m, lines[0], bDate).text).toBe('10 Apr 1862');
        // Sub-rows: their union's cells, the person's empty.
        expect(lineCell(m, lines[1], partner).text).toContain('Ysolde');
        expect(lineCell(m, lines[2], wDate).text).toBe('5 May 1902');
        expect(lineCell(m, lines[3], partner).text).toContain('Maelis');
        expect(lineCell(m, lines[3], bDate).empty).toBe(true);
        // One union: in the person's own row; none: "does not apply".
        const w1 = buildLines([prow(m, 'w1')], { collapse: defaultUnionCollapse() });
        expect(w1).toHaveLength(1);
        expect(lineCell(m, w1[0], partner).text).toContain('Halvor');
        expect(lineCell(m, buildLines([prow(m, 's')], { collapse: defaultUnionCollapse() })[0], partner).na).toBe(true);
    });

    it('collapsed: one row with the first union; the head button follows what is expanded', () => {
        const m = build();
        const rows = m.persons;
        const st = defaultUnionCollapse();
        expect(hasMultiUnions(rows)).toBe(true);
        expect(anyExpanded(st, rows)).toBe(true);
        setExpanded(st, 'h', false);
        expect(anyExpanded(st, rows)).toBe(false);
        const lines = buildLines([prow(m, 'h')], { collapse: st });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ kind: 'row', union: 0, expanded: false, n: 3 });
        expect(lineCell(m, lines[0], columnById('persons', 'partner')!).text).toContain('Ysolde');
        expect(hasMultiUnions([prow(m, 's')])).toBe(false);
    });

    it('a union filter: judged per union, the rest under "more", shown dimmed on request; collapsed shows the first passing', () => {
        const m = build();
        const h = prow(m, 'h');
        const placed: UnionPredicate = (r, i) => !!r.unions[i].startPlace;
        expect(passingUnions(h, placed)).toEqual([1]);
        expect(personPassesUnions(h, placed)).toBe(true);
        expect(personPassesUnions(prow(m, 'w1'), placed)).toBe(false);
        // No union filter: everyone passes; with one, a person without a union does not.
        expect(personPassesUnions(prow(m, 's'), null)).toBe(true);
        expect(personPassesUnions(prow(m, 's'), placed)).toBe(false);
        const lines = buildLines([h], { collapse: defaultUnionCollapse(), pass: placed });
        expect(lines.map(l => l.kind)).toEqual(['row', 'sub', 'more']);
        expect(lines[1]).toMatchObject({ k: 2, n: 3, dimmed: false });
        expect(lines[2]).toMatchObject({ kind: 'more', hidden: 2 });
        const shown = buildLines([h], { collapse: defaultUnionCollapse(), pass: placed, revealed: new Set(['h']) });
        expect(shown.map(l => (l.kind === 'sub' ? `${l.k}${l.dimmed ? 'd' : ''}` : l.kind))).toEqual(['row', '1d', '2', '3d']);
        const collapsed = buildLines([h], { collapse: { collapsed: true, except: [] }, pass: placed });
        expect(collapsed).toHaveLength(1);
        expect(collapsed[0]).toMatchObject({ union: 1 });
    });

    it('sorting by a union column uses the first passing union; the sub-rows keep their date order', () => {
        const m = build();
        const rows = [prow(m, 'h'), prow(m, 'w2')];
        const spec = [{ col: 'wDate', dir: 'asc' as const }];
        // Without a filter Halvor sorts by 1890, before Brenna's 1902.
        expect(sortRows(m, 'persons', rows, spec, sortUnionOf(null)).map(r => r.id)).toEqual(['h', 'w2']);
        // Only unions with a place: Halvor's 1902 union — a tie with Brenna, the base order stays.
        const placed: UnionPredicate = (r, i) => !!r.unions[i].startPlace;
        expect(sortRows(m, 'persons', [prow(m, 'w2'), prow(m, 'h')], spec, sortUnionOf(placed)).map(r => r.id)).toEqual(['w2', 'h']);
        const desc = [{ col: 'wDate', dir: 'desc' as const }];
        expect(sortRows(m, 'persons', rows, desc, sortUnionOf(null)).map(r => r.id)).toEqual(['w2', 'h']);
        const lines = buildLines(sortRows(m, 'persons', rows, desc), { collapse: defaultUnionCollapse() });
        expect(lines.filter(l => l.kind === 'sub').map(l => (l.kind === 'sub' ? l.k : 0))).toEqual([1, 2, 3]);
    });

    it('lines of differing heights: the window by their tops', () => {
        const tops = lineOffsets([32, 32, 26, 32, 32]);
        expect(tops).toEqual([0, 32, 64, 90, 122, 154]);
        expect(lineWindow(tops, 70, 40, 0)).toEqual({ start: 2, end: 4 });
        expect(lineWindow(tops, 0, 1000, 1)).toEqual({ start: 0, end: 5 });
        expect(lineWindow([0], 0, 100)).toEqual({ start: 0, end: 0 });
    });

    it('the texts of §3 in every language', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as Language[]) {
            const t = getStringsForLang(lang).table;
            expect(t.unionsN(3)).toMatch(/3/);
            expect(t.unionKofN(2, 3)).toMatch(/2.*3/);
            expect(t.hiddenUnions(1)).toMatch(/1/);
            expect(t.a11y.unionRow(1, 2, 'X')).toMatch(/1.*2.*X/);
            expect(t.a11y.collapsed('X', 2)).toMatch(/X.*2/);
            expect(t.expandAll && t.collapseAll && t.subst.bap && t.subst.burShort && t.qual.about && t.coverage, lang).toBeTruthy();
        }
        expect(getStringsForLang('cs').table.unionsN(5)).toBe('5 svazků');
        expect(getStringsForLang('cs').table.hiddenUnions(2)).toBe('2 svazky mimo filtr · ukázat');
    });
});
