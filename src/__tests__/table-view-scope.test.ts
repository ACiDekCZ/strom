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
import {
    applyScopeCells, isSelectionScopeKey, legacyScopeSelection, outsideScope, scopeCounts, scopeKeySelection, scopeRows, selectionScopeKey, tableScopeNow, tableScopeOf,
} from '../ui/table-view/table-scope.js';
import { selectionIndex } from '../ui/view-selection-ui.js';
import { selectionPersonIds, type SelectionRef } from '../view-selection.js';
import { defaultTableState } from '../ui/table-view/table-state.js';
import { restoreTableState, tableWorkOf, viewFromState } from '../ui/table-view/table-views.js';
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

    it("the scope now from the window's switch (spec 098 §11c): Whole tree none, Selection the list with # and Done, This view its people", () => {
        const view = new Set<PersonId>([ids[5], ids[6], ids[7]]);
        let asked = 0;
        const viewIds = () => { asked++; return view; };
        expect(tableScopeNow('tree', { kind: 'list', listId: 'pl_work' }, viewIds)).toBeNull();
        expect(tableScopeNow('sel', null, viewIds)).toBeNull();
        expect(asked).toBe(0);
        const list = tableScopeNow('sel', { kind: 'list', listId: 'pl_work' }, viewIds)!;
        expect(list.kind).toBe('list');
        expect(list.ids).toEqual(picked);
        expect(list.fixed).toBe(true);
        expect([...list.cells.done!]).toEqual([picked[1]]);
        expect(tableScopeNow('sel', { kind: 'list', listId: 'pl_gone' }, viewIds)).toBeNull();
        const here = tableScopeNow('view', null, viewIds)!;
        expect(here.kind).toBe('view');
        expect(here.key).toBe('view');
        expect(here.fixed).toBe(false);
        expect(here.cells.done).toBeNull();
        expect([...here.ids].sort()).toEqual([...view].sort());
        // The same people: the same scope (its rows kept); others: a new one.
        expect(tableScopeNow('view', { kind: 'list', listId: 'pl_work' }, viewIds)).toBe(here);
        expect(tableScopeNow('view', null, () => new Set([ids[5]]))).not.toBe(here);
        const m = model();
        expect(scopeRows(m, 'persons', here).map(r => r.id).sort()).toEqual([...view].sort());
        expect(outsideScope(m.personRows.get(ids[8])!, here)).toBe(true);
    });

    it('a view no longer keeps a scope; the list a stored state had is taken over once (spec 098 §11c)', () => {
        const state = defaultTableState();
        const st = state.types.persons;
        st.sort = [{ col: 'num', dir: 'asc' }];
        const v = viewFromState('persons', st, 'v1', 'Mine', '');
        expect(v.scope).toBeUndefined();
        // Stored before the shared switch: the open view's draft with its list.
        const old = { rowType: 'persons' as const, open: { persons: 'b:overview' }, work: { persons: { ...viewFromState('persons', st, 'b:overview', '', ''), scope: { listId: 'pl_fixed' } } } };
        const before = defaultTableState();
        restoreTableState(before, old, []);
        expect(before.legacyScope).toBe('pl_fixed');
        const written = tableWorkOf(before, []);
        expect(written.sharedScope).toBe(true);
        expect(JSON.stringify(written)).not.toContain('pl_fixed');
        const after = defaultTableState();
        restoreTableState(after, { ...old, sharedScope: true }, []);
        expect(after.legacyScope).toBeUndefined();
        const none = defaultTableState();
        restoreTableState(none, null, []);
        expect(none.legacyScope).toBeUndefined();
    });

    it('the old list becomes the selection only in a window without one and while it is there', () => {
        const exists = (r: SelectionRef) => !!tableScopeOf(selectionScopeKey(r));
        expect(legacyScopeSelection('pl_fixed', false, exists)).toEqual({ kind: 'list', listId: 'pl_fixed' });
        expect(legacyScopeSelection('pl_fixed', true, exists)).toBeNull();
        expect(legacyScopeSelection('pl_gone', false, exists)).toBeNull();
        expect(legacyScopeSelection(null, false, exists)).toBeNull();
        expect(legacyScopeSelection(undefined, false, exists)).toBeNull();
        const rod: SelectionRef = { kind: 'descendants', personId: ids[0] };
        expect(legacyScopeSelection(selectionScopeKey(rod), false, () => true)).toEqual(rod);
        expect(legacyScopeSelection('sel:garbage', false, () => true)).toBeNull();
    });
});

describe("table scope by the window's selection (spec 098 §5)", () => {
    const { data } = syntheticTree({ persons: 200, founders: 20 });

    beforeEach(() => load(structuredClone(data), []));

    /** A person with descendants (the selection must not be empty). */
    function descendantsRef(): SelectionRef {
        const { index } = selectionIndex();
        for (const id of Object.keys(dm.data.persons) as PersonId[]) {
            const ref: SelectionRef = { kind: 'descendants', personId: id };
            if ((selectionPersonIds(index.data, index, ref)?.size ?? 0) > 3) return ref;
        }
        throw new Error('no person with descendants');
    }

    it('a list keeps its id as the key; another selection is a key of its own, read back', () => {
        expect(selectionScopeKey({ kind: 'list', listId: 'pl_x' })).toBe('pl_x');
        const ref = descendantsRef();
        const key = selectionScopeKey(ref);
        expect(isSelectionScopeKey(key)).toBe(true);
        expect(isSelectionScopeKey('pl_x')).toBe(false);
        expect(scopeKeySelection(key)).toEqual(ref);
        expect(scopeKeySelection('pl_x')).toBeNull();
    });

    it("the rows are the selection's people (the sort stays the Table's), no Done, nobody to take out", () => {
        const ref = descendantsRef();
        const m = model();
        const scope = tableScopeOf(selectionScopeKey(ref))!;
        expect(scope.kind).toBe('selection');
        expect(scope.fixed).toBe(false);
        expect(scope.cells.done).toBeNull();
        const { index } = selectionIndex();
        const want = [...selectionPersonIds(index.data, index, ref)!].filter(id => !dm.data.persons[id].isPlaceholder).sort();
        expect(scopeRows(m, 'persons', scope).map(r => r.id).sort()).toEqual(want);
        const outside = rowsOf(m, 'persons').find(r => !want.includes(r.id as PersonId))!;
        expect(outsideScope(outside, scope)).toBe(true);
        expect(scopeCounts(m, scope).persons).toBe(want.length);
    });

    it("a selection that is gone has no scope; the scope Selection is the window's selection", () => {
        expect(tableScopeOf(selectionScopeKey({ kind: 'descendants', personId: 'nobody' as PersonId }))).toBeNull();
        const ref = descendantsRef();
        const now = tableScopeNow('sel', ref, () => new Set())!;
        expect(now.kind).toBe('selection');
        expect(now).toBe(tableScopeOf(selectionScopeKey(ref)));
    });

    it('"No place" keeps the scope\'s people with no place of any map kind', () => {
        const ref = descendantsRef();
        const scope = tableScopeOf(selectionScopeKey(ref))!;
        const [a, b] = scope.ids;
        const pa = dm.data.persons[a];
        pa.birthPlace = undefined; pa.deathPlace = undefined; pa.events = [];
        for (const u of pa.partnerships) { const un = dm.data.partnerships[u]; un.startPlace = undefined; un.endPlace = undefined; un.events = []; }
        dm.data.persons[b].birthPlace = 'Bělokamen';
        const m = model();
        const f = emptyFilter();
        setChip(f, 'noPlace', true);
        const shown = filterRows(m, 'persons', scopeRows(m, 'persons', scope), f).rows.map(r => r.id);
        expect(shown).toContain(a);
        expect(shown).not.toContain(b);
        expect(availableChips(m, 'persons')).toContain('noPlace');
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
