/**
 * Table view (T54 F4, F9): a cell's own choices — the text Copy takes, and
 * "Only {value}" / "Without {value}" as a column filter of equality (a person
 * by id, a text without regard to case and diacritics), an empty cell's only
 * empty / only filled, Copy alone where no one value compares.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { joinOr, setLanguage } from '../strings.js';
import { joinOrPl } from '../strings-pl/helpers.js';
import { sanitizeTableView } from '../table-views-data.js';
import { buildTableModel, type TableModel, type TableRow, type PersonRow } from '../ui/table-view/table-model.js';
import { cellOf, columnById } from '../ui/table-view/table-columns.js';
import {
    addOnlyFilter, addWithoutFilter, cellPasses, cellShownText, clearFilter, columnItemLabel, columnItems, emptyFilter, filterKindOf, filterRows,
    removeColumnItemAt, setColumnFilter, type ColumnFilter, type FilterItem, type TableFilter,
} from '../ui/table-view/table-filter.js';
import { cellChoices, shortValue } from '../ui/table-view/table-cell.js';
import { lineCell, type GridLine } from '../ui/table-view/table-subrows.js';

/** Two invented families whose fathers share a name; places written with and without diacritics. */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const persons: Record<string, Record<string, unknown>> = {
        f: person('f', 'Radomír', 'Šlapetný', 'male', { birthDate: '~1850', partnerships: ['u1'], childIds: ['b1', 'b2'] }),
        m: person('m', 'Žofie', 'Kvapilová', 'female', { birthDate: '1855', birthPlace: 'Dolni Vresova', partnerships: ['u1'], childIds: ['b1', 'b2'] }),
        b1: person('b1', 'Bonifác', 'Šlapetný', 'male', { birthDate: '1880', birthPlace: 'Lhotka nad Brodem', parentIds: ['f', 'm'] }),
        b2: person('b2', 'Hedvika', 'Šlapetná', 'female', { birthDate: '1882', birthPlace: 'LHOTKA NAD BRODEM', parentIds: ['f', 'm'] }),
        f2: person('f2', 'Radomír', 'Šlapetný', 'male', { birthDate: '1849', partnerships: ['u2'], childIds: ['t'] }),
        w: person('w', 'Bohdana', 'Měchurková', 'female', { birthDate: '1851', partnerships: ['u2'], childIds: ['t'] }),
        t: person('t', 'Teofil', 'Měchurka', 'male', { birthDate: '1885', birthPlace: 'Dolní Vřesová', parentIds: ['f2', 'w'] }),
    };
    const partnerships = {
        u1: { id: 'u1', person1Id: 'f', person2Id: 'm', childIds: ['b1', 'b2'], status: 'married', startDate: '1878' },
        u2: { id: 'u2', person1Id: 'f2', person2Id: 'w', childIds: ['t'], status: 'divorced', startDate: '1884' },
    };
    return { persons, partnerships } as unknown as StromData;
}

const build = (): TableModel =>
    buildTableModel(tree(), { rev: 1, homeId: 'b1' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });

const col = (id: string) => columnById('persons', id)!;
const rowOf = (m: TableModel, id: string): PersonRow => m.persons.find(r => r.id === id)!;
const lineOf = (row: TableRow): GridLine => ({ kind: 'row', row, union: row.kind === 'person' ? 0 : null, n: row.kind === 'person' ? row.unions.length : 0, expanded: null });
const choicesAt = (m: TableModel, id: string, colId: string) => {
    const line = lineOf(rowOf(m, id));
    return cellChoices(m, 'persons', line, col(colId), lineCell(m, line, col(colId)))!;
};
const run = (m: TableModel, item: ColumnFilter) => filterRows(m, 'persons', m.persons, { op: 'and', items: [item] }).rows.map(r => r.id).sort();

beforeAll(() => setLanguage('en'));

describe('a cell\'s Only / Without (T54 F4)', () => {
    it('a parent compares the person, not the name: Only "{father}" are the siblings', () => {
        const m = build();
        const c = choicesAt(m, 'b1', 'father');
        expect(c.copy).toBe('Radomír Šlapetný');
        expect(c.only).toMatchObject({ col: 'father', match: 'equals', personId: 'f', text: 'Radomír Šlapetný' });
        // The other Radomír Šlapetný's son is not a sibling.
        expect(run(m, c.only!)).toEqual(['b1', 'b2']);
        // Without: everyone else, the people without a father among them.
        expect(run(m, c.without!)).toEqual(['f', 'f2', 'm', 't', 'w']);
    });

    it('a text compares the whole value without regard to case and diacritics', () => {
        const m = build();
        expect(run(m, choicesAt(m, 'b1', 'bPlace').only!)).toEqual(['b1', 'b2']);
        expect(run(m, choicesAt(m, 't', 'bPlace').only!)).toEqual(['m', 't']);
        // Part of a value is not the value.
        expect(cellPasses(cellOf(m, rowOf(m, 'b1'), col('bPlace')), { col: 'bPlace', kind: 'text', match: 'equals', text: 'Lhotka' }, 'text')).toBe(false);
        expect(run(m, choicesAt(m, 't', 'bPlace').without!)).toEqual(['b1', 'b2', 'f', 'f2', 'w']);
    });

    it('a date compares its shown text with the qualifier', () => {
        const m = build();
        const c = choicesAt(m, 'f', 'bDate');
        const v = cellOf(m, rowOf(m, 'f'), col('bDate'));
        expect(v.prefix).toBeTruthy();
        expect(c.copy).toBe(`${v.prefix} ${v.text}`);
        expect(run(m, c.only!)).toEqual(['f']);
    });

    it('the chip says "=" or "≠" with the value', () => {
        const m = build();
        const c = choicesAt(m, 'b1', 'father');
        expect(columnItemLabel('persons', c.only!)).toBe('Father = Radomír Šlapetný');
        expect(columnItemLabel('persons', c.without!)).toBe('Father ≠ Radomír Šlapetný');
    });

    it('an empty cell offers only empty / only filled; a completeness only Copy', () => {
        const m = build();
        const empty = choicesAt(m, 'f', 'bPlace');
        expect(empty).toMatchObject({ copy: '', empty: true });
        expect(empty.only).toBeUndefined();
        const comp = choicesAt(m, 'f', 'comp');
        expect(comp.copy).not.toBe('');
        expect(comp.only).toBeUndefined();
        expect(comp.without).toBeUndefined();
        expect(comp.empty).toBeUndefined();
    });

    it('an enumeration sets its values filter', () => {
        const m = build();
        expect(filterKindOf(col('uStatus'))).toBe('values');
        const c = choicesAt(m, 'f', 'uStatus');
        expect(c.only?.values).toHaveLength(1);
        expect(c.only?.match).toBeUndefined();
        expect(run(m, c.only!)).toEqual(['f', 'm']);
        expect(run(m, c.without!)).toEqual(['f2', 'w']);
    });

    it('nothing on a person\'s cell of a union\'s sub-row; a count of unions only copies', () => {
        const m = build();
        const row = rowOf(m, 'f');
        const sub: GridLine = { kind: 'sub', row, union: 0, k: 1, n: 1, dimmed: false };
        expect(cellChoices(m, 'persons', sub, col('bPlace'), lineCell(m, sub, col('bPlace')))).toBeNull();
        const main: GridLine = { kind: 'row', row, union: null, n: 2, expanded: false };
        const agg = cellChoices(m, 'persons', main, col('partner'), lineCell(m, main, col('partner')))!;
        expect(agg.copy).not.toBe('');
        expect(agg.only).toBeUndefined();
    });

    it('the row\'s own name offers nothing (its Only would keep the one row)', () => {
        const m = build();
        const line = lineOf(rowOf(m, 'b1'));
        expect(cellChoices(m, 'persons', line, col('name'), lineCell(m, line, col('name')))).toBeNull();
    });

    it('a long value is shortened to about 24 characters with "…"', () => {
        expect(shortValue('Lhotka nad Brodem')).toBe('Lhotka nad Brodem');
        const long = shortValue('Farní úřad Lhotka nad Brodem, matrika narozených');
        expect(long.length).toBe(24);
        expect(long.endsWith('…')).toBe(true);
    });
});

describe('the text a cell shows (T54 F9)', () => {
    it('no marks: a substitute\'s sign and the further citations are left out', () => {
        const base = cellOf(build(), rowOf(build(), 'b1'), col('bPlace'));
        expect(cellShownText({ ...base, subst: 'bap', moreSources: ['s1', 's2'] })).toBe('Lhotka nad Brodem');
        expect(cellShownText({ ...base, na: true, text: '' })).toBe('');
    });
});

describe('several Only / Without at once (spec 103 K1.1–K1.4)', () => {
    const rows = (m: TableModel, f: TableFilter) => filterRows(m, 'persons', m.persons, f).rows.map(r => r.id).sort();
    const labels = (f: TableFilter) => columnItems(f).map(i => columnItemLabel('persons', i));
    const only = (m: TableModel, f: TableFilter, id: string, colId: string) => addOnlyFilter(f, choicesAt(m, id, colId).only!);
    const without = (m: TableModel, f: TableFilter, id: string, colId: string) => addWithoutFilter(f, choicesAt(m, id, colId).without!);

    it('K1.1: a second Without of the same column keeps the first, each one its own chip', () => {
        const m = build();
        const f = emptyFilter();
        expect(without(m, f, 'b1', 'bPlace')).toBe(true);
        expect(without(m, f, 't', 'bPlace')).toBe(true);
        expect(labels(f)).toEqual(['Birthplace ≠ Lhotka nad Brodem', 'Birthplace ≠ Dolní Vřesová']);
        // Neither place; the people without one stay.
        expect(rows(m, f)).toEqual(['f', 'f2', 'w']);
        // The same value again (in other letters) changes nothing.
        expect(without(m, f, 'b2', 'bPlace')).toBe(false);
        expect(columnItems(f)).toHaveLength(2);
    });

    it('K1.1: Without in two columns: both apply', () => {
        const m = build();
        const f = emptyFilter();
        without(m, f, 'b1', 'father');
        without(m, f, 't', 'bPlace');
        expect(labels(f)).toEqual(['Father ≠ Radomír Šlapetný', 'Birthplace ≠ Dolní Vřesová']);
        expect(rows(m, f)).toEqual(['f', 'f2', 'w']);
    });

    it('K1.2: the × of a chip drops that one; Clear filters drops them all', () => {
        const m = build();
        const f = emptyFilter();
        without(m, f, 'b1', 'bPlace');
        without(m, f, 't', 'bPlace');
        without(m, f, 'b1', 'father');
        expect(removeColumnItemAt(f, 0)).toBe(true);
        expect(labels(f)).toEqual(['Birthplace ≠ Dolní Vřesová', 'Father ≠ Radomír Šlapetný']);
        expect(rows(m, f)).toEqual(['f', 'f2', 'w']);
        expect(clearFilter(f)).toBe(true);
        expect(rows(m, f)).toHaveLength(7);
    });

    it('K1.3: a second Only of a column adds its value (one of them passes); the same value again changes nothing', () => {
        const m = build();
        const f = emptyFilter();
        only(m, f, 'b1', 'bPlace');
        expect(only(m, f, 't', 'bPlace')).toBe(true);
        expect(columnItems(f)).toHaveLength(1);
        expect(labels(f)).toEqual(['Birthplace = Lhotka nad Brodem or Dolní Vřesová']);
        expect(rows(m, f)).toEqual(['b1', 'b2', 'm', 't']);
        expect(only(m, f, 'b2', 'bPlace')).toBe(false);
        // A father by the person: the other Radomír Šlapetný is a value of his own.
        const g = emptyFilter();
        only(m, g, 'b1', 'father');
        only(m, g, 't', 'father');
        expect(labels(g)).toEqual(['Father = Radomír Šlapetný or Radomír Šlapetný']);
        expect(rows(m, g)).toEqual(['b1', 'b2', 't']);
    });

    it('K1.3: Only and Without apply together; a Without of a value of the Only takes it out of the Only', () => {
        const m = build();
        const f = emptyFilter();
        only(m, f, 'b1', 'bPlace');
        only(m, f, 't', 'bPlace');
        without(m, f, 'b1', 'father');
        expect(rows(m, f)).toEqual(['m', 't']);
        // Without Lhotka: out of the Only, no chip of its own.
        expect(without(m, f, 'b2', 'bPlace')).toBe(true);
        expect(labels(f)).toEqual(['Birthplace = Dolní Vřesová', 'Father ≠ Radomír Šlapetný']);
        expect(rows(m, f)).toEqual(['m', 't']);
        // Its last value: the Only goes and the value is excluded (never an empty table without a word).
        expect(without(m, f, 'm', 'bPlace')).toBe(true);
        expect(labels(f)).toEqual(['Father ≠ Radomír Šlapetný', 'Birthplace ≠ Dolni Vresova']);
        expect(rows(m, f)).toEqual(['f', 'f2', 'w']);
        // Only of an excluded value: the exclusion goes.
        expect(only(m, f, 't', 'bPlace')).toBe(true);
        expect(labels(f)).toEqual(['Father ≠ Radomír Šlapetný', 'Birthplace = Dolní Vřesová']);
        expect(rows(m, f)).toEqual(['m', 't']);
    });

    it('K1.3: an enumeration\'s Only adds its value, its Without takes one out', () => {
        const m = build();
        const f = emptyFilter();
        only(m, f, 'f', 'uStatus');
        expect(rows(m, f)).toEqual(['f', 'm']);
        only(m, f, 'f2', 'uStatus');
        expect(columnItems(f)).toHaveLength(1);
        expect(rows(m, f)).toEqual(['f', 'f2', 'm', 'w']);
        without(m, f, 'f', 'uStatus');
        expect(rows(m, f)).toEqual(['f2', 'w']);
        // Without first, then Only of another value: just that value.
        const g = emptyFilter();
        without(m, g, 'f', 'uStatus');
        only(m, g, 'f2', 'uStatus');
        expect(rows(m, g)).toEqual(['f2', 'w']);
    });

    it('the head\'s form edits the main filter; the column\'s exclusions stay', () => {
        const m = build();
        const f = emptyFilter();
        without(m, f, 'b1', 'bPlace');
        setColumnFilter(f, { col: 'bPlace', kind: 'text', filled: true });
        expect(labels(f)).toEqual(['Birthplace ≠ Lhotka nad Brodem', 'Birthplace filled']);
        expect(rows(m, f)).toEqual(['m', 't']);
        // A chip's form edits its own item.
        setColumnFilter(f, { col: 'bPlace', kind: 'text', match: 'notEquals', text: 'Dolní Vřesová' }, 0);
        expect(rows(m, f)).toEqual(['b1', 'b2']);
    });

    it('K1.4: a stored view keeps the chips; an older view (one filter a column) reads and filters as before', () => {
        const m = build();
        const f = emptyFilter();
        without(m, f, 'b1', 'bPlace');
        without(m, f, 't', 'bPlace');
        only(m, f, 'b1', 'father');
        only(m, f, 't', 'father');
        const stored = JSON.parse(JSON.stringify({ id: 'tv-x', name: 'Bez dvou míst', rowType: 'persons', filter: f }));
        const back = sanitizeTableView(stored)!;
        const g: TableFilter = { op: 'and', items: back.filter.items as unknown as FilterItem[] };
        expect(labels(g)).toEqual(labels(f));
        expect(rows(m, g)).toEqual(rows(m, f));
        // A view saved by 3.29 (one item a column): the same items and the same rows.
        const old = sanitizeTableView({
            id: 'tv-old', name: 'Starý', rowType: 'persons',
            filter: { op: 'and', items: [
                { col: 'bPlace', kind: 'text', match: 'notEquals', text: 'Dolni Vresova' },
                { col: 'father', kind: 'text', match: 'equals', text: 'Radomír Šlapetný', personId: 'f' },
            ] },
        })!;
        const h: TableFilter = { op: 'and', items: old.filter.items as unknown as FilterItem[] };
        expect(labels(h)).toEqual(['Birthplace ≠ Dolni Vresova', 'Father = Radomír Šlapetný']);
        expect(rows(m, h)).toEqual(['b1', 'b2']);
        // A further Without of an old view's column joins its exclusion.
        without(m, h, 'b1', 'bPlace');
        expect(labels(h)).toEqual(['Birthplace ≠ Dolni Vresova', 'Father = Radomír Šlapetný', 'Birthplace ≠ Lhotka nad Brodem']);
    });

    it('"or" in the four languages', () => {
        expect(joinOr('en', ['A', 'B'])).toBe('A or B');
        expect(joinOr('cs', ['A', 'B', 'C'])).toBe('A, B nebo C');
        expect(joinOr('de', ['A', 'B'])).toBe('A oder B');
        expect(joinOrPl(['A', 'B'])).toBe('A lub B');
        expect(joinOr('en', ['A', 'B', 'C', 'D'])).toBe('A, B +2');
    });
});
