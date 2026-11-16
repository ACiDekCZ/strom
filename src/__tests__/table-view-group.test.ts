/**
 * The Table's rows under group headers (spec 084 §10, §11): the values each
 * row type offers, the groups' order with "no value" last, a row in several
 * groups once in each, the lines drawn with closed groups, the grouping kept
 * in a view and carried to a new window, the export's group column, and the
 * whole on a 5 000-person tree within the budget (helpers/perf-budget.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { buildTableModel, rowKey, rowsOf, type TableModel } from '../ui/table-view/table-model.js';
import { columnById } from '../ui/table-view/table-columns.js';
import { sortRows } from '../ui/table-view/table-filter.js';
import {
    groupedExportRows, groupedLines, groupKeysOf, groupKeysOfRow, groupRows, hasRepeats, hiddenByGroups, NO_VALUE_KEY, offeredGroupKeys,
} from '../ui/table-view/table-group.js';
import { buildLines, defaultUnionCollapse, lineKey, plainLines } from '../ui/table-view/table-subrows.js';
import { defaultTableState } from '../ui/table-view/table-state.js';
import { applyView, viewFromState } from '../ui/table-view/table-views.js';
import { applyTableWindowState, readTableWindowState, tableWindowStateOf } from '../ui/table-view/table-window-state.js';
import { buildTableCsv } from '../ui/table-view/table-export.js';
import { setLanguage, strings } from '../strings.js';
import type { PersonId, StromData, TreeId } from '../types.js';

const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean };

function load(data: StromData): void {
    dm.data = migrateData(data);
    dm.currentTreeId = 'group-test' as TreeId;
    dm.viewMode = false;
}

let rev = 0;
function model(): TableModel {
    return buildTableModel(dm.data, { rev: ++rev, homeId: null, lang: 'en', year: 2026 });
}

beforeEach(() => setLanguage('en'));

describe('table rows grouped by a value', () => {
    const { data } = syntheticTree({ persons: 200, founders: 20 });

    beforeEach(() => load(structuredClone(data)));

    it('each row type offers its own values; Sources none; Research line and Done only where they apply', () => {
        expect(groupKeysOf('persons')).toContain('surname');
        expect(groupKeysOf('unions')).toEqual(['wDecade', 'wPlace', 'uRods', 'kids']);
        expect(groupKeysOf('events')).toEqual(['evType', 'evDecade', 'evPlace']);
        expect(groupKeysOf('sources')).toEqual([]);
        const plain = offeredGroupKeys('persons', { lines: false, work: false });
        expect(plain).not.toContain('lines');
        expect(plain).not.toContain('done');
        expect(offeredGroupKeys('persons', { lines: true, work: true })).toEqual(expect.arrayContaining(['lines', 'done']));
    });

    it('groups by surname in the collator order, every row once, the sort kept inside a group', () => {
        const m = model();
        const rows = sortRows(m, 'persons', rowsOf(m, 'persons'), [{ col: 'bDate', dir: 'asc' }]);
        const groups = groupRows(m, 'persons', 'surname', rows);
        expect(groups.length).toBeGreaterThan(1);
        expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(rows.length);
        expect(hasRepeats(groups, rows.length)).toBe(false);
        const named = groups.filter(g => !g.special).map(g => g.label);
        expect(named).toEqual([...named].sort(new Intl.Collator('en').compare));
        // Inside a group the Table's order holds.
        const at = new Map(rows.map((r, i) => [rowKey(r), i]));
        for (const g of groups) {
            const idx = g.rows.map(r => at.get(rowKey(r))!);
            expect(idx).toEqual([...idx].sort((a, b) => a - b));
        }
        const r0 = groups[0].rows[0];
        expect(groupKeysOfRow(m, 'persons', 'surname', r0)).toEqual([groups[0].key]);
    });

    it('decades of birth go up by time and the people without a date come last as "no value"', () => {
        const d = structuredClone(data);
        const someone = Object.keys(d.persons).find(id => !d.persons[id as PersonId].isPlaceholder) as PersonId;
        d.persons[someone].birthDate = undefined;
        load(d);
        const m = model();
        const groups = groupRows(m, 'persons', 'bDecade', rowsOf(m, 'persons'));
        const last = groups[groups.length - 1];
        expect(last.key).toBe(NO_VALUE_KEY);
        expect(last.special).toBe(true);
        expect(last.label).toBe(strings.table.groupNoValue);
        const years = groups.filter(g => !g.special).map(g => Number(g.key));
        expect(years).toEqual([...years].sort((a, b) => a - b));
        expect(groups[0].label).toMatch(/^\d{4}–\d{4}$/);
        // Unions by the number of children, Events by their type.
        const um = groupRows(m, 'unions', 'kids', rowsOf(m, 'unions'));
        expect(um.length).toBeGreaterThan(0);
        expect(groupRows(m, 'events', 'evType', rowsOf(m, 'events')).length).toBeGreaterThan(0);
    });

    it('a union is in the family line of each partner; the lines mark its later places and closed groups draw only their header', () => {
        const m = model();
        const unions = rowsOf(m, 'unions');
        const groups = groupRows(m, 'unions', 'uRods', unions);
        const placed = groups.reduce((n, g) => n + g.rows.length, 0);
        expect(placed).toBeGreaterThanOrEqual(unions.length);
        const repeats = hasRepeats(groups, unions.length);
        expect(repeats).toBe(placed > unions.length);

        const lines = groupedLines(groups, new Set(), rows => plainLines(rows));
        const heads = lines.filter(l => l.kind === 'group');
        expect(heads).toHaveLength(groups.length);
        const keys = lines.map(lineKey);
        expect(new Set(keys).size).toBe(keys.length);
        const firstPlain = lines.filter(l => l.kind !== 'group' && !l.dup).length;
        expect(firstPlain).toBe(unions.length);

        const shut = new Set([groups[0].key]);
        const closed = groupedLines(groups, shut, rows => plainLines(rows));
        expect(closed.length).toBe(lines.length - groups[0].rows.length);
        expect(closed[0]).toMatchObject({ kind: 'group', key: groups[0].key, collapsed: true, count: groups[0].rows.length });
        // A row only in the closed group is hidden.
        const hidden = hiddenByGroups(groups, shut);
        for (const k of hidden) expect(groups.slice(1).some(g => g.rows.some(r => rowKey(r) === k))).toBe(false);

        // People with their union sub-rows inside the groups.
        const pm = groupRows(m, 'persons', 'sex', rowsOf(m, 'persons'));
        const pl = groupedLines(pm, new Set(), rows => buildLines(rows, { collapse: defaultUnionCollapse(), pass: null, revealed: new Set() }));
        expect(pl[0].kind).toBe('group');
    });

    it('the grouping is kept in a view, the work state and a new window; Sources never take one', () => {
        const state = defaultTableState();
        const st = state.types.unions;
        st.group = { by: 'wDecade', collapsed: ['1900', NO_VALUE_KEY] };
        const v = viewFromState('unions', st, 'v1', 'Mine', '');
        expect(v.group).toEqual({ by: 'wDecade', collapsed: ['1900', NO_VALUE_KEY].sort() });
        const back = defaultTableState().types.unions;
        applyView(v, back);
        expect(back.group).toEqual(v.group);
        // A key the row type does not have is not taken.
        applyView({ ...v, group: { by: 'surname', collapsed: [] } }, back);
        expect(back.group).toBeNull();
        state.rowType = 'unions';
        const carried = readTableWindowState(structuredClone(tableWindowStateOf(state, [])))!;
        const other = defaultTableState();
        applyTableWindowState(other, carried, []);
        expect(other.types.unions.group).toEqual(v.group);
        const src = defaultTableState().types.sources;
        src.group = { by: 'surname', collapsed: [] };
        expect(viewFromState('sources', src, 'v2', 'S', '').group).toBeUndefined();
    });

    it('the export writes the group in its first column, a row in each of its groups', () => {
        const m = model();
        const rows = rowsOf(m, 'unions');
        const groups = groupRows(m, 'unions', 'kids', rows);
        const cols = [columnById('unions', 'p1')!, columnById('unions', 'p2')!];
        const csv = buildTableCsv({ model: m, type: 'unions', rows, columns: cols, groups: groupedExportRows(groups) });
        const lines = csv.csv.replace(/^﻿/, '').trim().split('\r\n');
        expect(lines[0].startsWith(strings.table.groupCol)).toBe(true);
        expect(lines.length - 1).toBe(groups.reduce((n, g) => n + g.rows.length, 0));
        expect(lines[1].startsWith(groups[0].label.includes(',') ? `"${groups[0].label}"` : groups[0].label)).toBe(true);
    });
});

describe('table grouping performance: 5 000 people', () => {
    it('groups 5 000 people by decade of birth and by surname and builds the lines within the budget', () => {
        const { data } = syntheticTree({ persons: 5000 });
        load(data);
        const run = () => {
            const m = model();   // a fresh model: nothing cached
            const rows = rowsOf(m, 'persons');
            const a = groupRows(m, 'persons', 'bDecade', rows);
            const b = groupRows(m, 'persons', 'surname', rows);
            const lines = groupedLines(b, new Set([b[0].key]), r => plainLines(r));
            return a.length + b.length + lines.length;
        };
        expect(run()).toBeGreaterThan(1000);
        const BUDGET_MS = 300;
        const m = measureAgainstBudget(run, { budgetMs: BUDGET_MS, calibrationRounds: 4, referenceMs: 22, minPairs: 2, maxPairs: 5, maxWallMs: 30_000 });
        console.log(budgetReport('table grouping, 5000 people', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 120_000);
});
