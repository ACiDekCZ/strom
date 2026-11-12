/**
 * Table view (spec 073 §4.3–§4.6): the column operations without the DOM —
 * showing and hiding, moving within a group, moving a group, widths,
 * pinning, collapsed groups and the setup a saved view keeps.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    applyColumnSetup, canMoveColumn, canPinColumn, catalogColumns, columnRun, columnSetupOf, defaultTypeState, displayColumns,
    groupRuns, hideColumn, lockedColumn, moveColumnBy, moveColumnRun, moveColumnTo, normalizeColumns, pinColumn, resetColumns,
    setColumnWidth, setGroupCollapsed, setGroupShown, showColumn, sortAdd, sortOnly, unpinColumn, BAND_WIDTH, MIN_COLUMN_WIDTH,
    type RowTypeState,
} from '../ui/table-view/table-state.js';
import { stickyLefts } from '../ui/table-view/table-window.js';
import { headMenuItems, SEP, type HeadMenuContext } from '../ui/table-view/table-headmenu.js';
import { buildExportTable } from '../ui/table-view/table-export.js';
import { buildTableXlsx } from '../ui/table-view/table-xlsx.js';
import { buildTableModel } from '../ui/table-view/table-model.js';
import { columnById, type ColumnDef } from '../ui/table-view/table-columns.js';
import { columnName } from '../xlsx.js';
import { readXlsx } from './helpers/xlsx-read.js';
import { setLanguage } from '../strings.js';
import type { PersonId, StromData } from '../types.js';

const people = (): RowTypeState => defaultTypeState('persons');

describe('table columns: show and hide', () => {
    it('a shown column goes beside its group in catalog order, a new group in group order', () => {
        const st = people();
        // Overview: name · bDate bPlace · dDate dAge · partner wDate wAge · nFind comp
        expect(showColumn('persons', st, 'bAddr')).toBe(true);
        expect(st.columns.slice(1, 4)).toEqual(['bDate', 'bPlace', 'bAddr']);
        // Birth surname (group "person") lands right after the locked name.
        showColumn('persons', st, 'birthSurname');
        expect(st.columns[1]).toBe('birthSurname');
        // Father (group "parents", none shown) goes after birth, before death.
        showColumn('persons', st, 'father');
        expect(st.columns.indexOf('father')).toBe(st.columns.indexOf('bAddr') + 1);
        expect(showColumn('persons', st, 'father')).toBe(false);
        expect(showColumn('persons', st, 'no-such-column')).toBe(false);
    });

    it('the name cannot be hidden; hiding a pinned column lowers the pinned count', () => {
        const st = people();
        expect(hideColumn('persons', st, 'name')).toBe(false);
        pinColumn('persons', st, 'bPlace');
        expect(st.pinned).toBe(2);
        expect(hideColumn('persons', st, 'bPlace')).toBe(true);
        expect(st.pinned).toBe(1);
        expect(st.columns).not.toContain('bPlace');
    });

    it('"all" shows or hides a whole group (the name stays)', () => {
        const st = people();
        setGroupShown('persons', st, 'death', true);
        const death = catalogColumns('persons').filter(c => c.group === 'death').map(c => c.id);
        expect(death.every(id => st.columns.includes(id))).toBe(true);
        // The group's columns sit together, in catalog order.
        const at = st.columns.indexOf(death[0]);
        expect(st.columns.slice(at, at + death.length)).toEqual(death);
        setGroupShown('persons', st, 'person', false);
        expect(st.columns[0]).toBe(lockedColumn('persons'));
        setGroupShown('persons', st, 'death', false);
        expect(st.columns.some(id => death.includes(id))).toBe(false);
    });

    it('normalizing drops unknown and repeated columns and keeps the name first and pinned', () => {
        const st: RowTypeState = { ...people(), columns: ['bDate', 'name', 'nope', 'bDate', 'dDate'], pinned: 0 };
        normalizeColumns('persons', st);
        expect(st.columns).toEqual(['name', 'bDate', 'dDate']);
        expect(st.pinned).toBe(1);
    });
});

describe('table columns: order', () => {
    it('a column moves only within its group and zone', () => {
        expect(columnRun(['person', 'birth', 'birth', 'death', 'death'], 1, 2)).toEqual([1, 2]);
        expect(columnRun(['person', 'birth', 'birth', 'death', 'death'], 1, 0)).toEqual([0, 0]);
        // A pinned birth column and a scrolling one are apart.
        expect(columnRun(['person', 'birth', 'birth', 'birth'], 2, 2)).toEqual([2, 3]);
        // In the pinned zone any place (spec 082 K2.1), the name's too.
        expect(columnRun(['person', 'birth', 'birth', 'birth'], 2, 1)).toEqual([0, 1]);
        expect(columnRun(['person', 'birth', 'birth', 'birth'], 2, 0)).toEqual([0, 1]);

        const st = people();
        expect(canMoveColumn('persons', st, 'bDate', -1)).toBe(false);
        expect(canMoveColumn('persons', st, 'bDate', 1)).toBe(true);
        expect(moveColumnBy('persons', st, 'bDate', 1)).toBe(true);
        expect(st.columns.slice(1, 3)).toEqual(['bPlace', 'bDate']);
        // Past its group: refused.
        expect(moveColumnBy('persons', st, 'bDate', 1)).toBe(false);
        expect(moveColumnBy('persons', st, 'name', 1)).toBe(false);
        // The panel's drag: to where another column of the run is.
        expect(moveColumnTo('persons', st, 'wAge', 'partner')).toBe(true);
        expect(st.columns.slice(5, 8)).toEqual(['wAge', 'partner', 'wDate']);
        expect(moveColumnTo('persons', st, 'wAge', 'dDate')).toBe(false);
    });

    it('a whole group run moves to another run boundary of the scrolling zone', () => {
        const st = people();
        const groups = st.columns.map(id => catalogColumns('persons').find(c => c.id === id)!.group);
        const runs = groupRuns(groups, st.pinned);
        expect(runs.map(r => r.group)).toEqual(['person', 'birth', 'death', 'union', 'checks']);
        const union = runs[3];
        // Unions before birth.
        expect(moveColumnRun('persons', st, union.start, union.end, runs[1].start)).toBe(true);
        expect(st.columns).toEqual(['name', 'partner', 'wDate', 'wAge', 'bDate', 'bPlace', 'dDate', 'dAge', 'nFind', 'comp']);
        // Birth to the end.
        expect(moveColumnRun('persons', st, 4, 5, st.columns.length)).toBe(true);
        expect(st.columns.slice(-2)).toEqual(['bDate', 'bPlace']);
        // Into the pinned zone, inside a run or not a run: refused.
        expect(moveColumnRun('persons', st, 1, 3, 0)).toBe(false);
        expect(moveColumnRun('persons', st, 1, 2, 5)).toBe(false);
        expect(moveColumnRun('persons', st, 1, 3, 2)).toBe(false);
    });
});

describe('table columns: width and pinning', () => {
    it('a width never goes under the minimum', () => {
        const st = people();
        expect(setColumnWidth(st, 'bDate', 20)).toBe(true);
        expect(st.widths.bDate).toBe(MIN_COLUMN_WIDTH);
        expect(setColumnWidth(st, 'bDate', MIN_COLUMN_WIDTH)).toBe(false);
    });

    it('the pinned columns\' left offsets follow a changed width', () => {
        expect(stickyLefts([250, 130, 200], 2)).toEqual([0, 250]);
        const st = people();
        pinColumn('persons', st, 'bPlace');
        setColumnWidth(st, 'name', 300);
        const d = displayColumns('persons', st, false);
        expect(d.columns.slice(0, 2).map(c => c.id)).toEqual(['name', 'bPlace']);
        expect(stickyLefts(d.widths, d.pinned)).toEqual([0, 300]);
    });

    it('pinning moves a column behind the last pinned one, at most half the grid; unpinning returns it to its group', () => {
        const st = people();
        expect(canPinColumn('persons', st, 'wDate', 1440)).toBe(true);
        // 250 + 120 > 700 / 2
        expect(canPinColumn('persons', st, 'wDate', 700)).toBe(false);
        expect(canPinColumn('persons', st, 'name', 1440)).toBe(false);
        pinColumn('persons', st, 'wDate');
        expect(st.columns.slice(0, 2)).toEqual(['name', 'wDate']);
        expect(st.pinned).toBe(2);
        expect(unpinColumn('persons', st, 'name')).toBe(false);
        expect(unpinColumn('persons', st, 'wDate')).toBe(true);
        expect(st.pinned).toBe(1);
        expect(st.columns.slice(5, 8)).toEqual(['partner', 'wDate', 'wAge']);
    });
});

describe('table columns: collapsed groups', () => {
    it('a collapsed group is one band of its scrolling columns; pinned columns never collapse', () => {
        const st = people();
        expect(setGroupCollapsed(st, 'union', true)).toBe(true);
        expect(setGroupCollapsed(st, 'union', true)).toBe(false);
        const d = displayColumns('persons', st, false);
        const at = d.bands.findIndex(b => b !== null);
        expect(d.bands[at]!.group).toBe('union');
        expect(d.bands[at]!.columns.map(c => c.id)).toEqual(['partner', 'wDate', 'wAge']);
        expect(d.widths[at]).toBe(BAND_WIDTH);
        expect(d.columns).toHaveLength(8);
        expect([d.starts[at], d.ends[at]]).toEqual([5, 7]);
        expect(displayColumns('persons', st, true).widths[at]).toBeLessThan(BAND_WIDTH);

        setGroupCollapsed(st, 'person', true);
        expect(displayColumns('persons', st, false).bands[0]).toBeNull();
        setGroupCollapsed(st, 'union', false);
        expect(displayColumns('persons', st, false).bands.every(b => b === null)).toBe(true);
    });

    it('the setup a saved view keeps round-trips; reset returns to the base', () => {
        const st = people();
        setColumnWidth(st, 'bDate', 160);
        setGroupCollapsed(st, 'death', true);
        st.coverageRow = false;
        pinColumn('persons', st, 'bDate');
        const setup = columnSetupOf(st);
        expect(setup.columns[1]).toEqual({ id: 'bDate', width: 160 });
        expect(setup.pinned).toBe(2);
        expect(setup.collapsedGroups).toEqual(['death']);
        expect(setup.coverageRow).toBe(false);

        const other = people();
        applyColumnSetup('persons', other, setup);
        expect(columnSetupOf(other)).toEqual(setup);

        resetColumns('persons', other);
        expect(other.columns).toEqual(people().columns);
        expect(other.pinned).toBe(1);
        expect(other.collapsedGroups).toEqual([]);
        expect(other.coverageRow).toBe(true);
        expect(other.widths.bDate).toBe(130);
    });
});

describe('table columns: sorting from the header menu', () => {
    it('sorts by one column, adds a key, flips a key already there', () => {
        const st = people();
        sortOnly(st, 'dDate', 'desc');
        expect(st.sort).toEqual([{ col: 'dDate', dir: 'desc' }]);
        sortAdd(st, 'name');
        expect(st.sort).toEqual([{ col: 'dDate', dir: 'desc' }, { col: 'name', dir: 'asc' }]);
        sortAdd(st, 'dDate');
        expect(st.sort[0]).toEqual({ col: 'dDate', dir: 'asc' });
    });
});

describe('table columns: the pinned zone in any order (spec 082 K2.1)', () => {
    /** name · bPlace · wDate pinned, the rest scrolling. */
    const pinnedThree = (): RowTypeState => {
        const st = people();
        pinColumn('persons', st, 'bPlace');
        pinColumn('persons', st, 'wDate');
        return st;
    };

    it('any pinned column moves anywhere in the zone, the name too; nothing crosses the zone\'s edge', () => {
        const st = pinnedThree();
        expect(st.columns.slice(0, 3)).toEqual(['name', 'bPlace', 'wDate']);
        expect(canMoveColumn('persons', st, 'name', -1)).toBe(false);
        expect(canMoveColumn('persons', st, 'name', 1)).toBe(true);
        expect(moveColumnBy('persons', st, 'name', 1)).toBe(true);
        expect(st.columns.slice(0, 3)).toEqual(['bPlace', 'name', 'wDate']);
        // Across groups within the zone.
        expect(moveColumnBy('persons', st, 'wDate', -2)).toBe(true);
        expect(st.columns.slice(0, 3)).toEqual(['wDate', 'bPlace', 'name']);
        expect(st.pinned).toBe(3);
        // Out of the zone or into it: refused.
        expect(canMoveColumn('persons', st, 'name', 1)).toBe(false);
        expect(moveColumnBy('persons', st, 'name', 1)).toBe(false);
        expect(moveColumnTo('persons', st, 'bDate', 'bPlace')).toBe(false);
        expect(canMoveColumn('persons', st, 'bDate', -1)).toBe(false);
        // The scrolling zone keeps its rules: within the group only.
        expect(moveColumnBy('persons', st, 'dDate', -1)).toBe(false);
        // The panel's drag in the zone.
        expect(moveColumnTo('persons', st, 'name', 'wDate')).toBe(true);
        expect(st.columns.slice(0, 3)).toEqual(['name', 'wDate', 'bPlace']);
    });

    it('a name not first stays pinned and shown; pinning goes behind the last pinned; normalizing keeps the zone\'s order', () => {
        const st = pinnedThree();
        moveColumnBy('persons', st, 'name', 2);
        expect(st.columns.slice(0, 3)).toEqual(['bPlace', 'wDate', 'name']);
        expect(hideColumn('persons', st, 'name')).toBe(false);
        expect(unpinColumn('persons', st, 'name')).toBe(false);
        expect(pinColumn('persons', st, 'dDate')).toBe(true);
        expect(st.columns.slice(0, 4)).toEqual(['bPlace', 'wDate', 'name', 'dDate']);
        // Unpinning the first column leaves the name pinned where it is.
        expect(unpinColumn('persons', st, 'bPlace')).toBe(true);
        expect(st.columns.slice(0, 3)).toEqual(['wDate', 'name', 'dDate']);
        expect(st.pinned).toBe(3);
        // A setup round-trips with the name in the middle.
        const other = people();
        applyColumnSetup('persons', other, columnSetupOf(st));
        expect(other.columns).toEqual(st.columns);
        expect(other.pinned).toBe(3);

        // Normalizing: the zone's order kept; a missing name or a name out of the zone goes first into it.
        const kept: RowTypeState = { ...people(), columns: ['bDate', 'name', 'dDate'], pinned: 2 };
        normalizeColumns('persons', kept);
        expect(kept.columns).toEqual(['bDate', 'name', 'dDate']);
        expect(kept.pinned).toBe(2);
        const missing: RowTypeState = { ...people(), columns: ['bDate', 'dDate'], pinned: 1 };
        normalizeColumns('persons', missing);
        expect(missing.columns).toEqual(['name', 'bDate', 'dDate']);
        expect(missing.pinned).toBe(2);
        const outside: RowTypeState = { ...people(), columns: ['bDate', 'dDate', 'name'], pinned: 1 };
        normalizeColumns('persons', outside);
        expect(outside.columns).toEqual(['name', 'bDate', 'dDate']);
        expect(outside.pinned).toBe(2);
    });

    it('the header menu offers only a move that can be made, never greyed; no empty part', () => {
        const noop = (): void => {};
        const ctx = (over: Partial<HeadMenuContext>): HeadMenuContext => ({
            pinned: false, locked: false, canPin: false, canMoveLeft: false, canMoveRight: false,
            sortAsc: noop, sortDesc: noop, sortAdd: noop, pin: noop, unpin: noop, move: noop, hide: noop, ...over,
        });
        const ids = (c: HeadMenuContext): (string | null)[] => headMenuItems(c).map(e => (e === SEP ? null : e.id));
        const items = (c: HeadMenuContext) => headMenuItems(c).filter((e): e is Exclude<typeof e, null> => e !== SEP);

        // At the start of its group: only right.
        expect(ids(ctx({ canMoveRight: true }))).toEqual(['sortAsc', 'sortDesc', 'sortAdd', null, 'moveRight', 'hide']);
        // The name alone pinned: no move, no hide, no unpin, no separator at the end.
        expect(ids(ctx({ pinned: true, locked: true }))).toEqual(['sortAsc', 'sortDesc', 'sortAdd']);
        // The name in a zone of three: both moves, still no hide or unpin.
        expect(ids(ctx({ pinned: true, locked: true, canMoveLeft: true, canMoveRight: true })))
            .toEqual(['sortAsc', 'sortDesc', 'sortAdd', null, 'moveLeft', 'moveRight']);
        for (const c of [ctx({}), ctx({ canMoveLeft: true }), ctx({ pinned: true, locked: true })]) {
            expect(items(c).some(e => e.disabled)).toBe(false);
        }
    });
});

describe('table columns: export and coverage with the name elsewhere (spec 082 K2.1)', () => {
    beforeAll(() => setLanguage('en'));

    /** A man of two unions (the export's "Union" column) and his wives. */
    function model() {
        const person = (id: string, firstName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName: 'Vorlenz', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        const data = {
            persons: {
                a: person('a', 'Ambrož', 'male', { birthDate: '1830', partnerships: ['u1', 'u2'] }),
                b: person('b', 'Rozálie', 'female', { birthDate: '1832', partnerships: ['u1'] }),
                c: person('c', 'Kordula', 'female', { partnerships: ['u2'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married', startDate: '1855' },
                u2: { id: 'u2', person1Id: 'a', person2Id: 'c', childIds: [], status: 'married', startDate: '1866' },
            },
        } as unknown as StromData;
        return buildTableModel(data, { rev: 1, homeId: 'a' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });
    }
    const cols = (ids: string[]): ColumnDef[] => ids.map(id => columnById('persons', id)!);

    it('the export\'s Union column follows the name wherever it stands; the XLSX coverage label is in the first column', () => {
        const m = model();
        const columns = cols(['bDate', 'name', 'wDate']);
        const t = buildExportTable({ model: m, type: 'persons', rows: m.persons, columns });
        expect(t.head).toEqual(['Birth date', 'Full name', 'Union', 'Marriage date']);
        expect(t.unionAt).toBe(2);
        const amb = t.lines.filter(l => l.row.kind === 'person' && l.row.id === 'a');
        expect(amb.map(l => l.texts[2])).toEqual(['1 of 2', '2 of 2']);
        // The continuation line: the union's column only.
        expect(amb[1].texts[1]).toBe('');
        expect(amb[1].texts[3]).not.toBe('');

        const out = buildTableXlsx({ model: m, type: 'persons', rows: m.persons, columns, pinned: 2, sheetName: 'People', when: new Date('2026-06-15T10:00:00Z') });
        const read = readXlsx(out.bytes);
        const cov = Array.from({ length: 4 }, (_v, i) => read.cell(`${columnName(i)}3`)?.text ?? '');
        expect(cov[0]).toBe('filled');
        expect(cov[1]).not.toBe('filled');
        // The name pinned with its Union column: three columns frozen.
        expect(read.sheet).toMatch(/<pane xSplit="3"/);
    });
});
