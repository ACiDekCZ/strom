/**
 * Table view (T54 F4, F9): a cell's own choices — the text Copy takes, and
 * "Only {value}" / "Without {value}" as a column filter of equality (a person
 * by id, a text without regard to case and diacritics), an empty cell's only
 * empty / only filled, Copy alone where no one value compares.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { buildTableModel, type TableModel, type TableRow, type PersonRow } from '../ui/table-view/table-model.js';
import { cellOf, columnById } from '../ui/table-view/table-columns.js';
import { cellPasses, cellShownText, columnItemLabel, filterKindOf, filterRows, type ColumnFilter } from '../ui/table-view/table-filter.js';
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
