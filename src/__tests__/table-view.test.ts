/**
 * Table view (spec 073 §1.6, §2, §4.1): the row model, the column catalog,
 * the drawn window and sorting — the parts without the DOM.
 */

import { describe, it, expect } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { getStringsForLang, type Language } from '../strings.js';
import { buildTableModel, modelIsCurrent, rowKey, rowsOf, unionsByDate, type TableRow } from '../ui/table-view/table-model.js';
import { cellOf, columnById, columnsOf, DEFAULT_VIEWS, PERSON_COLUMNS, UNION_COLUMNS, phoneWidth } from '../ui/table-view/table-columns.js';
import { columnOffsets, columnWindow, rowWindow } from '../ui/table-view/table-window.js';
import { sortRows } from '../ui/table-view/table-filter.js';
import { defaultTableState, shownColumns } from '../ui/table-view/table-state.js';

/** A small invented family: a couple, their two children, a second union, a placeholder. */
function smallTree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const persons: Record<string, Record<string, unknown>> = {
        a: person('a', 'Orvin', 'Kvelden', 'male', { birthDate: '1850', deathDate: '1920', partnerships: ['u1', 'u2'], childIds: ['c', 'd'] }),
        b: person('b', 'Tamsa', 'Morastin', 'female', { birthDate: '1855', partnerships: ['u1'], childIds: ['c', 'd'] }),
        c: person('c', 'Belko', 'Kvelden', 'male', { birthDate: '1880', parentIds: ['a', 'b'] }),
        d: person('d', 'Ivrena', 'Kvelden', 'female', { parentIds: ['a', 'b'] }),
        e: person('e', 'Selvie', 'Udrasko', 'female', { birthDate: '1862', partnerships: ['u2'] }),
        x: { ...person('x', '?', '', 'male'), isPlaceholder: true, partnerships: ['u3'] },
    };
    const partnerships = {
        u2: { id: 'u2', person1Id: 'a', person2Id: 'e', childIds: [], status: 'married', startDate: '1895' },
        u1: { id: 'u1', person1Id: 'b', person2Id: 'a', childIds: ['c', 'd'], status: 'married', startDate: '1876' },
        u3: { id: 'u3', person1Id: 'x', person2Id: 'x', childIds: [], status: 'married' },
    };
    return { persons, partnerships } as unknown as StromData;
}

const build = (data = smallTree(), rev = 1, homeId: string | null = 'c', lang: Language = 'en') =>
    buildTableModel(data, { rev, homeId: homeId as PersonId | null, lang, year: 2026 });

const names = (rows: readonly TableRow[]) => rows.map(r => r.kind === 'person' ? r.person.firstName : r.id);

describe('table model', () => {
    it('has a row per real person and per union with a real partner, placeholders left out', () => {
        const m = build();
        expect(m.persons.map(r => r.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(m.unions.map(r => r.id).sort()).toEqual(['u1', 'u2']);
        expect(rowsOf(m, 'persons')).toBe(m.persons);
        expect(rowKey(m.persons[0])).toBe(`p:${m.persons[0].id}`);
        expect(rowKey(m.unions[0])).toBe(`u:${m.unions[0].id}`);
    });

    it('orders a person\'s unions by date, the undated last in data order', () => {
        const m = build();
        expect(m.personRows.get('a' as PersonId)!.unions.map(u => u.id)).toEqual(['u1', 'u2']);
        const u = (id: string, startDate?: string) => ({ id, startDate }) as never;
        expect(unionsByDate([u('n1'), u('d2', '1900'), u('n2'), u('d1', '1890')]).map((x: { id: string }) => x.id)).toEqual(['d1', 'd2', 'n1', 'n2']);
    });

    it('partner 1 of a union is the home person\'s blood relative', () => {
        const m = build();
        // u1 lists Tamsa first, but Orvin is Belko's father as much: Tamsa is blood too, so the order stays.
        expect(m.unionRows.get('u1' as never)!.p1!.id).toBe('b');
        const p1 = cellOf(m, m.unionRows.get('u2' as never)!, columnById('unions', 'p1')!);
        expect(p1.text).toContain('Orvin');
    });

    it('caches cells until the model is rebuilt for a new revision', () => {
        const data = smallTree();
        const m = build(data, 1);
        const row = m.personRows.get('c' as PersonId)!;
        const col = columnById('persons', 'bDate')!;
        const first = cellOf(m, row, col);
        expect(first.text).toBe('1880');
        expect(cellOf(m, row, col)).toBe(first);
        expect(modelIsCurrent(m, data, 1, 'c' as PersonId, 'en')).toBe(true);
        expect(modelIsCurrent(m, data, 2, 'c' as PersonId, 'en')).toBe(false);
        expect(modelIsCurrent(m, data, 1, 'a' as PersonId, 'en')).toBe(false);
        expect(modelIsCurrent(m, data, 1, 'c' as PersonId, 'cs')).toBe(false);
        expect(modelIsCurrent(m, smallTree(), 1, 'c' as PersonId, 'en')).toBe(false);
        data.persons['c' as PersonId].birthDate = '1881';
        const next = build(data, 2);
        expect(cellOf(next, next.personRows.get('c' as PersonId)!, col).text).toBe('1881');
    });
});

describe('column catalog', () => {
    const LANGS: Language[] = ['en', 'cs', 'de', 'pl'];

    it('every column and group has a label in every language', () => {
        for (const lang of LANGS) {
            const t = getStringsForLang(lang).table;
            for (const col of [...PERSON_COLUMNS, ...UNION_COLUMNS]) {
                expect(t.col[col.label], `${lang} ${col.id}`).toBeTruthy();
                expect(t.group[col.group], `${lang} group ${col.group}`).toBeTruthy();
            }
            expect(t.rows.persons && t.rows.unions && t.rowType && t.rowTypeNote && t.legend, lang).toBeTruthy();
            expect(t.countOf.p(3, 38)).toMatch(/3.*38/);
            expect(t.countOf.u(1, 2)).toMatch(/1.*2/);
        }
    });

    it('ids are unique per row type and the default views use known columns', () => {
        for (const type of ['persons', 'unions'] as const) {
            const ids = columnsOf(type).map(c => c.id);
            expect(new Set(ids).size).toBe(ids.length);
            for (const id of DEFAULT_VIEWS[type].columns) expect(columnById(type, id), `${type} ${id}`).toBeTruthy();
            for (const s of DEFAULT_VIEWS[type].sort) expect(columnById(type, s.col)).toBeTruthy();
        }
        expect(DEFAULT_VIEWS.persons.columns[0]).toBe('name');
        expect(DEFAULT_VIEWS.unions.columns.slice(0, 2)).toEqual(['p1', 'p2']);
    });

    it('computes values on the small tree', () => {
        const m = build();
        const cell = (id: string, col: string, unionIndex?: number) =>
            cellOf(m, m.personRows.get(id as PersonId)!, columnById('persons', col)!, unionIndex);
        expect(cell('a', 'name').text).toBe('Orvin Kvelden');
        expect(cell('a', 'uCount').text).toBe('2');
        expect(cell('a', 'partner').text).toContain('Tamsa');
        expect(cell('a', 'partner', 1).text).toContain('Selvie');
        expect(cell('a', 'wDate').text).toBe('1876');
        expect(cell('a', 'dAge').computed).toBe(true);
        expect(cell('a', 'dAge').text).toMatch(/69|70/);
        // No union: the union columns do not apply; no date: empty.
        expect(cell('c', 'partner').na).toBe(true);
        expect(cell('d', 'bDate').empty).toBe(true);
        expect(cell('d', 'bDate').sortKey).toBeNull();
    });

    it('a phone pins the name at 156 px and narrows the others (min 70)', () => {
        const name = columnById('persons', 'name')!;
        const nFind = columnById('persons', 'nFind')!;
        expect(phoneWidth(name, 250, true)).toBe(156);
        expect(phoneWidth(name, 250, false)).toBe(200);
        expect(phoneWidth(nFind, 84, false)).toBe(70);
    });

    it('a phone keeps a date and an age range whole beside a finding mark (1110)', () => {
        // Events' date 110 → 88 cut "28. 12. 1888" before its year; Age at marriage 90 → 72 cut "15–16".
        expect(phoneWidth(columnById('events', 'evDate')!, 110, false)).toBe(124);
        expect(phoneWidth(columnById('persons', 'wAge')!, 90, false)).toBe(92);
        expect(phoneWidth(columnById('persons', 'bDate')!, 200, false)).toBe(160);
    });

    it('the shown columns of a default state, desktop and phone', () => {
        const st = defaultTableState();
        const desk = shownColumns('persons', st.types.persons, false);
        expect(desk.columns.map(c => c.id)).toEqual(DEFAULT_VIEWS.persons.columns);
        expect(desk.widths[0]).toBe(250);
        expect(desk.pinned).toBe(1);
        const phone = shownColumns('persons', st.types.persons, true);
        expect(phone.widths[0]).toBe(156);
        const unions = shownColumns('unions', st.types.unions, false);
        expect(unions.pinned).toBe(2);
        expect(unions.widths.every(w => w > 0)).toBe(true);
        // An unknown column id (a later version's) is skipped, the pinning clamped.
        expect(shownColumns('persons', { ...st.types.persons, columns: ['nope'], pinned: 3 }, false)).toEqual({ columns: [], widths: [], pinned: 0 });
    });
});

describe('drawn window', () => {
    it('rows: the visible ones plus the overscan, clamped to the list', () => {
        expect(rowWindow(0, 320, 32, 1000)).toEqual({ start: 0, end: 21 });
        expect(rowWindow(3200, 320, 32, 1000)).toEqual({ start: 90, end: 121 });
        expect(rowWindow(1e6, 320, 32, 1000).end).toBe(1000);
        expect(rowWindow(0, 320, 32, 0)).toEqual({ start: 0, end: 0 });
        expect(rowWindow(0, 320, 32, 5)).toEqual({ start: 0, end: 5 });
    });

    it('columns: all up to the threshold; past it the pinned plus the scrolled range ± 2', () => {
        expect(columnOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
        const few = columnWindow(new Array(10).fill(100), 1, 500, 400);
        expect(few.indices).toHaveLength(10);
        expect(few.before + few.after).toBe(0);
        const widths = new Array(60).fill(100);
        const w = columnWindow(widths, 1, 1000, 500);
        // Pinned 0; right of it the viewport shows x 1100–1500 = columns 11–14, ± 2 → 9–16.
        expect(w.indices[0]).toBe(0);
        expect(w.indices.slice(1)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
        expect(w.before).toBe(800);
        expect(w.after).toBe(6000 - 1700);
        expect(w.total).toBe(6000);
        const start = columnWindow(widths, 2, 0, 500);
        expect(start.indices.slice(0, 2)).toEqual([0, 1]);
        expect(start.before).toBe(0);
    });
});

describe('sorting', () => {
    it('by birth date, rows without a date last in both directions; ties keep the base order', () => {
        const m = build();
        const asc = sortRows(m, 'persons', m.persons, [{ col: 'bDate', dir: 'asc' }]);
        expect(names(asc)).toEqual(['Orvin', 'Tamsa', 'Selvie', 'Belko', 'Ivrena']);
        const desc = sortRows(m, 'persons', m.persons, [{ col: 'bDate', dir: 'desc' }]);
        expect(names(desc)).toEqual(['Belko', 'Selvie', 'Tamsa', 'Orvin', 'Ivrena']);
        // An unknown column is skipped: the base order.
        expect(names(sortRows(m, 'persons', m.persons, [{ col: 'nope', dir: 'asc' }]))).toEqual(names(m.persons));
    });

    it('unions by marriage date', () => {
        const m = build();
        expect(names(sortRows(m, 'unions', m.unions, DEFAULT_VIEWS.unions.sort))).toEqual(['u1', 'u2']);
    });
});
