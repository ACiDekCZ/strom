/**
 * The Table narrowed to a list of people (spec 084 §9, §13d): the rows of
 * each row type in the scope (People in the list's order, Unions and Events
 * with a person of the list, Sources never narrowed), the counts, a row
 * outside the scope, the # and Done columns, the work list's chips, the
 * scope kept in a view and carried to a new window, and the whole on a
 * 5 000-person tree within the budget (helpers/perf-budget.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { buildTableModel, rowsOf, type TableModel } from '../ui/table-view/table-model.js';
import { cellOf, LEAD_COLUMNS } from '../ui/table-view/table-columns.js';
import { availableChips, emptyFilter, filterRows, setChip, sortRows } from '../ui/table-view/table-filter.js';
import { applyScopeCells, outsideScope, scopeCounts, scopeRows, tableScopeOf } from '../ui/table-view/table-scope.js';
import { defaultTableState } from '../ui/table-view/table-state.js';
import { applyView, viewFromState } from '../ui/table-view/table-views.js';
import { applyTableWindowState, readTableWindowState, tableWindowStateOf } from '../ui/table-view/table-window-state.js';
import { sortText } from '../ui/table-view/table-bar.js';
import { setLanguage } from '../strings.js';
import type { PersonId, PersonList, StromData, TreeId } from '../types.js';

const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean };

function load(data: StromData, lists: PersonList[]): void {
    data.personLists = lists;
    dm.data = migrateData(data);
    dm.currentTreeId = 'scope-test' as TreeId;
    dm.viewMode = false;
}

let rev = 0;
function model(): TableModel {
    return buildTableModel(dm.data, { rev: ++rev, homeId: null, lang: 'en', year: 2026 });
}

beforeEach(() => setLanguage('en'));

describe('table scope by a list of people', () => {
    const { data } = syntheticTree({ persons: 200, founders: 20 });
    const ids = Object.keys(data.persons).filter(id => !data.persons[id as PersonId].isPlaceholder) as PersonId[];
    // Kept out of the list's order on purpose: the rows follow the list, not the tree.
    const picked = [ids[40], ids[3], ids[17], ids[60]];
    const fixed: PersonList = { id: 'pl_fixed', name: 'Picked', dynamic: false, personIds: picked, sort: 'manual', updated: '2026-11-16T10:00:00.000Z' };
    const work: PersonList = { ...fixed, id: 'pl_work', name: 'Work', checklist: true, done: [picked[1]] };

    beforeEach(() => load(structuredClone(data), [fixed, work]));

    it('People come in the list order; Unions and Events need one person of the list; Sources are not narrowed', () => {
        const m = model();
        const scope = tableScopeOf('pl_fixed')!;
        expect(scope.fixed).toBe(true);
        expect(scopeRows(m, 'persons', scope).map(r => r.id)).toEqual(picked);
        const set = new Set<string>(picked);
        const unions = scopeRows(m, 'unions', scope);
        expect(unions.length).toBeGreaterThan(0);
        for (const r of unions) if (r.kind === 'union') expect(set.has(r.p1?.id ?? '') || set.has(r.p2?.id ?? '')).toBe(true);
        const allUnions = rowsOf(m, 'unions').filter(r => r.kind === 'union' && (set.has(r.p1?.id ?? '') || set.has(r.p2?.id ?? '')));
        expect(unions).toHaveLength(allUnions.length);
        const events = scopeRows(m, 'events', scope);
        expect(events.length).toBeGreaterThan(0);
        for (const r of events) if (r.kind === 'event') expect(r.persons.some(p => set.has(p.id))).toBe(true);
        expect(scopeRows(m, 'sources', scope)).toBe(rowsOf(m, 'sources'));
        const counts = scopeCounts(m, scope);
        expect(counts).toEqual({ persons: 4, unions: unions.length, events: events.length, sources: m.sources.length });
        // The same list and model: the rows are not worked out again.
        expect(scopeRows(m, 'unions', tableScopeOf('pl_fixed'))).toBe(unions);
    });

    it('a row outside the list is said to be outside; no scope: nothing is outside', () => {
        const m = model();
        const scope = tableScopeOf('pl_fixed')!;
        const inside = m.personRows.get(picked[0])!;
        const out = m.personRows.get(ids[0])!;
        expect(outsideScope(inside, scope)).toBe(false);
        expect(outsideScope(out, scope)).toBe(true);
        expect(outsideScope(out, null)).toBe(false);
    });

    it('a list that is gone gives no scope; a change of the list makes a new one', () => {
        expect(tableScopeOf('pl_nope')).toBeNull();
        expect(tableScopeOf(null)).toBeNull();
        const a = tableScopeOf('pl_fixed');
        expect(tableScopeOf('pl_fixed')).toBe(a);
        DataManager.removePersonsFromList('pl_fixed', [picked[1]]);
        const b = tableScopeOf('pl_fixed')!;
        expect(b).not.toBe(a);
        expect(b.ids).toEqual([picked[0], picked[2], picked[3]]);
    });

    it('# is the place in the list ("–" outside); Done boxes only for a work list; the chips Left and Done exclude each other', () => {
        const m = model();
        const num = LEAD_COLUMNS.find(c => c.id === 'num')!;
        const done = LEAD_COLUMNS.find(c => c.id === 'done')!;
        applyScopeCells(m, tableScopeOf('pl_fixed'));
        expect(cellOf(m, m.personRows.get(picked[2])!, num).text).toBe('3');
        expect(cellOf(m, m.personRows.get(ids[0])!, num).text).toBe('–');
        expect(cellOf(m, m.personRows.get(picked[0])!, done).check).toBeUndefined();
        expect(availableChips(m, 'persons')).not.toContain('left');

        const ws = tableScopeOf('pl_work')!;
        expect(applyScopeCells(m, ws)).toBe(true);
        expect(applyScopeCells(m, ws)).toBe(false);
        expect(cellOf(m, m.personRows.get(picked[1])!, done).check).toBe(true);
        expect(cellOf(m, m.personRows.get(picked[0])!, done).check).toBe(false);
        expect(availableChips(m, 'persons').slice(0, 2)).toEqual(['left', 'done']);
        const rows = scopeRows(m, 'persons', ws);
        const f = emptyFilter();
        setChip(f, 'left', true);
        expect(filterRows(m, 'persons', rows, f).rows.map(r => r.id)).toEqual([picked[0], picked[2], picked[3]]);
        setChip(f, 'done', true);
        expect(f.items).toHaveLength(1);
        expect(filterRows(m, 'persons', rows, f).rows.map(r => r.id)).toEqual([picked[1]]);
        // # ↓ sorts by the list's place, backwards.
        expect(sortRows(m, 'persons', rows, [{ col: 'num', dir: 'desc' }]).map(r => r.id)).toEqual([...picked].reverse());
    });

    it('a view keeps its scope and a new window gets it; Sources never take one', () => {
        const state = defaultTableState();
        const st = state.types.persons;
        st.scope = 'pl_fixed';
        st.sort = [{ col: 'num', dir: 'asc' }];
        const v = viewFromState('persons', st, 'v1', 'Mine', '');
        expect(v.scope).toEqual({ listId: 'pl_fixed' });
        const back = defaultTableState().types.persons;
        applyView(v, back);
        expect(back.scope).toBe('pl_fixed');
        const carried = readTableWindowState(structuredClone(tableWindowStateOf(state, [])))!;
        const other = defaultTableState();
        applyTableWindowState(other, carried, []);
        expect(other.types.persons.scope).toBe('pl_fixed');
        expect(sortText('persons', other.types.persons.sort)).toBe('Sort: # (list order)');
        const src = defaultTableState().types.sources;
        src.scope = 'pl_fixed';
        expect(viewFromState('sources', src, 'v2', 'S', '').scope).toBeUndefined();
    });
});

describe('table scope performance: 5 000 people', () => {
    it('narrows, counts and draws the first rows of a 3 000-person list within the budget', () => {
        const { data } = syntheticTree({ persons: 5000 });
        const ids = Object.keys(data.persons).filter(id => !data.persons[id as PersonId].isPlaceholder) as PersonId[];
        const personIds = ids.filter((_, i) => i % 5 !== 0).reverse().slice(0, 3000);
        load(data, [{ id: 'pl_big', name: 'Big', dynamic: false, personIds, sort: 'manual', updated: '', checklist: true, done: personIds.slice(0, 500) }]);
        const [num, done] = LEAD_COLUMNS;
        const run = () => {
            const m = model();   // a fresh model: nothing cached
            const scope = tableScopeOf('pl_big')!;
            applyScopeCells(m, scope);
            const counts = scopeCounts(m, scope);
            const rows = sortRows(m, 'persons', scopeRows(m, 'persons', scope), [{ col: 'num', dir: 'asc' }]);
            let n = 0;
            for (let i = 0; i < 40; i++) n += cellOf(m, rows[i], num).text.length + (cellOf(m, rows[i], done).check ? 1 : 0);
            return counts.persons + counts.unions + counts.events + n;
        };
        expect(run()).toBeGreaterThan(3000);
        const BUDGET_MS = 300;
        const m = measureAgainstBudget(run, { budgetMs: BUDGET_MS, calibrationRounds: 4, referenceMs: 22, minPairs: 2, maxPairs: 5, maxWallMs: 30_000 });
        console.log(budgetReport('table scope, 3000 of 5000 people', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 120_000);
});
