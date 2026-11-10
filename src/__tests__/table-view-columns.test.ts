/**
 * Table view (spec 073 §4.3–§4.6): the column operations without the DOM —
 * showing and hiding, moving within a group, moving a group, widths,
 * pinning, collapsed groups and the setup a saved view keeps.
 */

import { describe, it, expect } from 'vitest';
import {
    applyColumnSetup, canMoveColumn, canPinColumn, catalogColumns, columnRun, columnSetupOf, defaultTypeState, displayColumns,
    groupRuns, hideColumn, lockedColumn, moveColumnBy, moveColumnRun, moveColumnTo, normalizeColumns, pinColumn, resetColumns,
    setColumnWidth, setGroupCollapsed, setGroupShown, showColumn, sortAdd, sortOnly, unpinColumn, BAND_WIDTH, MIN_COLUMN_WIDTH,
    type RowTypeState,
} from '../ui/table-view/table-state.js';
import { stickyLefts } from '../ui/table-view/table-window.js';

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
        expect(columnRun(['person', 'birth', 'birth', 'birth'], 2, 1)).toEqual([1, 1]);

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
