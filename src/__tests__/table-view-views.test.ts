/**
 * Table view (spec 073 §9): saved and built-in views, data version 17 — the
 * views in the tree's data (migration, import, export, split, research
 * loads, undo), a view against a row type's state ("changed"), and the
 * working state in localStorage.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { validateJsonImport } from '../merge/validation.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { extractSubtree } from '../subtree.js';
import { setLanguage } from '../strings.js';
import { keepTableViews, sanitizeTableView, sanitizeTableViews } from '../table-views-data.js';
import { STROM_DATA_VERSION, type PersonId, type StromData, type TableView, type TreeId } from '../types.js';
import {
    applyView, builtinView, builtinViews, customViews, defaultViewId, findView, isBuiltinId, readTableWork, takenViewNames, uniqueViewName,
    viewChanged, viewFromState, workStorageKey, writeTableWork, BUILTIN_VIEWS,
    discardViewChanges, dropMissingViews, openViewOf, restoreTableState, switchView, tableWorkOf, viewList,
} from '../ui/table-view/table-views.js';
import { defaultTableState, defaultTypeState, hideColumn, resetColumns, setColumnWidth, sortClick } from '../ui/table-view/table-state.js';
import { setChip } from '../ui/table-view/table-filter.js';
import { setExpanded } from '../ui/table-view/table-subrows.js';

const TREE = 'table-views-tree' as TreeId;

function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female') =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] });
    return {
        version: 16,
        persons: { k1: person('k1', 'Bořivoj', 'Hrachovský', 'male'), k2: person('k2', 'Vlasta', 'Kudrnová', 'female') },
        partnerships: {},
    } as unknown as StromData;
}

function saved(id = 'tv-a', name = 'Křty na Vysočině', extra: Partial<TableView> = {}): TableView {
    return {
        id, name, rowType: 'persons', columns: [{ id: 'name', width: 230 }, { id: 'bapDate' }, { id: 'bapPlace' }], pinned: 1,
        collapsedGroups: [], coverageRow: true, filter: { op: 'and', items: [{ chip: 'deceased' }] },
        sort: [{ col: 'bapDate', dir: -1 }], unions: { collapsed: true, except: ['k1'] }, updated: '2026-11-10T09:30:00.000Z', ...extra,
    };
}

function reset(data: StromData = migrateData(tree())): void {
    vi.restoreAllMocks();
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    dm.data = data;
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

beforeAll(() => setLanguage('en'));

describe('data version 17: the saved views (§9.1)', () => {
    it('is 17 or later', () => {
        expect(STROM_DATA_VERSION).toBeGreaterThanOrEqual(17);
    });

    it('a v16 tree without views loads unchanged and gets none', () => {
        const old = tree();
        const loaded = migrateData(structuredClone(old));
        expect(loaded.tableViews).toBeUndefined();
        expect(loaded.persons).toEqual(old.persons);
    });

    it('a tree with views keeps them whole', () => {
        const views = [saved(), saved('tv-b', 'Sňatky bez místa', { rowType: 'unions', columns: [{ id: 'p1' }, { id: 'wPlace' }], pinned: 2, unions: undefined })];
        delete (views[1] as Partial<TableView>).unions;
        const loaded = migrateData({ ...tree(), version: 17, tableViews: views });
        expect(loaded.tableViews).toEqual(views);
    });

    it('drops malformed views and parts, keeps events and sources views, drops an unknown row type', () => {
        const raw = [
            saved(),
            { ...saved('tv-x'), rowType: 'citations' },
            { ...saved('tv-e'), rowType: 'events' },
            { id: '', name: 'x', rowType: 'persons' },
            { ...saved('tv-n'), name: '   ' },
            'nonsense',
            { ...saved('tv-a', 'duplicate id') },
            { id: 'tv-m', name: ' Minimal ', rowType: 'unions', columns: [{ id: 'p1', width: -5 }, { width: 10 }, 'x'], sort: [{ col: 'wDate', dir: 7 }, { dir: 1 }], filter: 'bad' },
        ];
        const out = sanitizeTableViews(raw)!;
        expect(out.map(v => v.id)).toEqual(['tv-a', 'tv-e', 'tv-m']);
        expect(out[0].name).toBe('Křty na Vysočině');
        expect(out[2]).toEqual({
            id: 'tv-m', name: 'Minimal', rowType: 'unions', columns: [{ id: 'p1' }], pinned: 1, collapsedGroups: [], coverageRow: true,
            filter: { op: 'and', items: [] }, sort: [{ col: 'wDate', dir: 1 }], updated: '',
        });
        expect(sanitizeTableViews('x')).toBeUndefined();
        expect(sanitizeTableViews([])).toBeUndefined();
        expect(sanitizeTableView(null)).toBeNull();
    });

    it('round-trips a JSON export and import, and a split keeps the views', () => {
        const data = migrateData({ ...tree(), tableViews: [saved()] });
        const json = JSON.stringify({ ...data, version: STROM_DATA_VERSION });
        const imported = validateJsonImport(json);
        expect(imported.valid).toBe(true);
        expect(imported.data!.tableViews).toEqual([saved()]);
        expect(extractSubtree(data, new Set(['k1' as PersonId])).tableViews).toEqual([saved()]);
        // An older file (version 16) imports too, without views.
        expect(validateJsonImport(JSON.stringify(tree())).data!.tableViews).toBeUndefined();
    });

    it('a research load (no place for views in GEDCOM) keeps the previous views', () => {
        const prev = { ...tree(), tableViews: [saved()] } as StromData;
        const next = tree();
        expect(keepTableViews(next, prev).tableViews).toEqual([saved()]);
        expect(keepTableViews(next, tree())).toBe(next);
        const own = { ...tree(), tableViews: [saved('tv-z', 'Z')] } as StromData;
        expect(keepTableViews(own, prev)).toBe(own);
    });
});

describe('DataManager: saving and deleting a view', () => {
    beforeEach(() => reset());

    it('saves, renames and deletes as undo steps with change-log entries', () => {
        expect(DataManager.saveTableView(saved())).toBe(true);
        expect(DataManager.getData().tableViews).toEqual([saved()]);
        expect(AuditLogManager.log).toHaveBeenCalledWith(TREE, 'tableView.save', expect.stringContaining('Křty na Vysočině'));

        expect(DataManager.saveTableView({ ...saved(), name: 'Křty' }, true)).toBe(true);
        expect(DataManager.getData().tableViews!.map(v => v.name)).toEqual(['Křty']);
        expect(AuditLogManager.log).toHaveBeenCalledWith(TREE, 'tableView.rename', expect.stringContaining('Křty'));

        expect(DataManager.deleteTableView('tv-a')).toBe(true);
        expect(DataManager.getData().tableViews).toBeUndefined();
        expect(DataManager.deleteTableView('tv-a')).toBe(false);

        DataManager.undo();
        expect(DataManager.getData().tableViews!.map(v => v.name)).toEqual(['Křty']);
        DataManager.undo();
        expect(DataManager.getData().tableViews!.map(v => v.name)).toEqual(['Křty na Vysočině']);
        DataManager.redo();
        expect(DataManager.getData().tableViews!.map(v => v.name)).toEqual(['Křty']);
    });

    it('does nothing while read-only', () => {
        (DataManager as unknown as { viewMode: boolean }).viewMode = true;
        expect(DataManager.saveTableView(saved())).toBe(false);
        expect(DataManager.getData().tableViews).toBeUndefined();
    });
});

describe('views and a row type\'s state (§9.2–§9.4)', () => {
    it('the built-in views in their order, with their row types', () => {
        expect(builtinViews().map(v => v.name)).toEqual(['Overview', 'Births and parents', 'Marriages', 'Deaths', 'Sources and citations', 'Gaps', 'Checks', 'All events', 'All sources']);
        expect(builtinViews().map(v => v.rowType)).toEqual(['persons', 'persons', 'unions', 'persons', 'persons', 'persons', 'persons', 'events', 'sources']);
        expect(BUILTIN_VIEWS.every(n => isBuiltinId(builtinView(n).id))).toBe(true);
        expect(builtinView('deaths').filter.items).toEqual([{ chip: 'deceased' }]);
        expect(builtinView('checks').sort).toEqual([{ col: 'topSev', dir: -1 }, { col: 'nFind', dir: -1 }]);
        expect(builtinView('gaps').unions).toEqual({ collapsed: true, except: [] });
        expect(defaultViewId('persons')).toBe(builtinView('overview').id);
        expect(defaultViewId('unions')).toBe(builtinView('marriages').id);
        expect(defaultViewId('sources')).toBe(builtinView('allSources').id);
        expect(builtinView('allSources').sort).toEqual([{ col: 'srcTitle', dir: 1 }]);
        expect(defaultViewId('events')).toBe(builtinView('events').id);
    });

    it('the default state is the default view, unchanged', () => {
        expect(viewChanged(builtinView('overview'), defaultTypeState('persons'))).toBe(false);
        expect(viewChanged(builtinView('marriages'), defaultTypeState('unions'))).toBe(false);
    });

    it('every built-in view opens to a state of its own columns', () => {
        for (const v of builtinViews()) {
            const st = defaultTypeState(v.rowType as 'persons');
            applyView(v, st);
            expect(st.columns).toEqual(v.columns.map(c => c.id));
            expect(viewChanged(v, st)).toBe(false);
        }
    });

    it('columns, widths, filter, sort and unions make "changed"; search, selection and scroll do not', () => {
        const v = saved();
        const st = defaultTypeState('persons');
        applyView(v, st);
        expect(st.sort).toEqual([{ col: 'bapDate', dir: 'desc' }]);
        expect(st.base?.columns.map(c => c.id)).toEqual(['name', 'bapDate', 'bapPlace']);
        expect(viewChanged(v, st)).toBe(false);
        st.search = 'Hrach';
        st.selected = 'p:k1';
        st.top = 300;
        expect(viewChanged(v, st)).toBe(false);

        const each: ((s: typeof st) => void)[] = [
            s => hideColumn('persons', s, 'bapPlace'),
            s => setColumnWidth(s, 'bapDate', 200),
            s => setChip(s.filter, 'living', true),
            s => sortClick(s, 'name'),
            s => setExpanded(s.unions, 'k1', false),
            s => { s.coverageRow = false; },
        ];
        for (const change of each) {
            const s = defaultTypeState('persons');
            applyView(v, s);
            change(s);
            expect(viewChanged(v, s)).toBe(true);
        }
    });

    it('a saved state opens to itself', () => {
        const st = defaultTypeState('persons');
        setChip(st.filter, 'blood', true);
        sortClick(st, 'dDate');
        const v = viewFromState('persons', st, 'tv-new', 'Pokrevní', '2026-11-10T10:00:00.000Z');
        expect(v.sort).toEqual([{ col: 'dDate', dir: 1 }]);
        expect(v.filter.items).toEqual([{ chip: 'blood' }]);
        const again = defaultTypeState('persons');
        applyView(v, again);
        expect(viewChanged(v, again)).toBe(false);
        expect(again.filter).toEqual(st.filter);
    });

    it('a view with an unknown column is not "changed" once opened', () => {
        const v = saved('tv-c', 'C', { columns: [{ id: 'name' }, { id: 'noSuchColumn' }, { id: 'bDate' }] });
        const st = defaultTypeState('persons');
        applyView(v, st);
        expect(st.columns).toEqual(['name', 'bDate']);
        expect(viewChanged(v, st)).toBe(false);
    });

    it('custom views alphabetically, without row types the table does not show', () => {
        const list = [
            saved('tv-2', 'Úmrtí v Brně'), saved('tv-1', 'Antonínové'), saved('tv-3', 'Události', { rowType: 'events' }),
            saved('tv-4', 'Prameny', { rowType: 'sources' }), saved('tv-5', 'Místa', { rowType: 'places' as never }),
        ];
        expect(customViews(list).map(v => v.id)).toEqual(['tv-1', 'tv-4', 'tv-3', 'tv-2']);
        expect(findView('tv-3', list)?.rowType).toBe('events');
        expect(findView('tv-4', list)?.rowType).toBe('sources');
        expect(findView('tv-5', list)).toBeNull();
        expect(findView(builtinView('gaps').id, list)?.name).toBe('Gaps');
    });

    it('a name already taken gets " (2)", " (3)"', () => {
        expect(uniqueViewName(' Křty ', ['Overview'])).toBe('Křty');
        expect(uniqueViewName('overview', takenViewNames(undefined))).toBe('overview (2)');
        expect(uniqueViewName('Křty', ['Křty', 'křty (2)'])).toBe('Křty (3)');
        expect(takenViewNames([saved()], 'tv-a')).not.toContain('Křty na Vysočině');
    });
});

describe('the working state in localStorage (§9.1)', () => {
    let store: Map<string, string>;
    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('writes and reads back per tree', () => {
        const st = defaultTypeState('persons');
        sortClick(st, 'name');
        const work = { rowType: 'unions' as const, open: { persons: 'tv-a', unions: defaultViewId('unions') }, work: { persons: viewFromState('persons', st, 'tv-a', 'A', '') } };
        writeTableWork('t1', work);
        expect(store.has(workStorageKey('t1'))).toBe(true);
        expect(readTableWork('t1')).toEqual(work);
        expect(readTableWork('t2')).toBeNull();
    });

    it('ignores what it cannot read and survives blocked storage', () => {
        store.set(workStorageKey('t1'), '{not json');
        expect(readTableWork('t1')).toBeNull();
        store.set(workStorageKey('t1'), JSON.stringify({ rowType: 'places', open: { persons: 5 }, work: { persons: { rowType: 'unions' } } }));
        expect(readTableWork('t1')).toEqual({ rowType: 'persons', open: {}, work: {} });
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        });
        expect(readTableWork('t1')).toBeNull();
        expect(() => writeTableWork('t1', { rowType: 'persons', open: {}, work: {} })).not.toThrow();
    });
});

describe('opening, switching and keeping views in the table state (§9.2, §9.3)', () => {
    it('opens each row type\'s default view, unchanged, when nothing is stored', () => {
        const state = defaultTableState();
        restoreTableState(state, null, undefined);
        expect(state.restored).toBe(true);
        expect(state.open).toEqual({ persons: 'b:overview', unions: 'b:marriages', events: 'b:events', sources: 'b:allSources' });
        expect(viewChanged(openViewOf(state, 'persons', undefined), state.types.persons)).toBe(false);
        expect(tableWorkOf(state, undefined)).toEqual({ rowType: 'persons', open: { persons: 'b:overview', unions: 'b:marriages', events: 'b:events', sources: 'b:allSources' }, work: {} });
    });

    it('switching keeps the changes of the view left until it is chosen again, and switches the row type', () => {
        const stored = [saved()];
        const state = defaultTableState();
        restoreTableState(state, null, stored);
        sortClick(state.types.persons, 'name');
        expect(viewChanged(openViewOf(state, 'persons', stored), state.types.persons)).toBe(true);
        expect(switchView(state, 'tv-a', stored)).toBe(true);
        expect(state.open.persons).toBe('tv-a');
        expect(state.types.persons.columns).toEqual(['name', 'bapDate', 'bapPlace']);
        expect(viewChanged(stored[0], state.types.persons)).toBe(false);
        expect(Object.keys(state.drafts)).toEqual(['b:overview']);
        // Back: the changes are there again, and Reset still returns to the view's columns.
        switchView(state, 'b:overview', stored);
        expect(state.types.persons.sort).toEqual([{ col: 'name', dir: 'asc' }]);
        expect(viewChanged(builtinView('overview'), state.types.persons)).toBe(true);
        expect(state.drafts).toEqual({});
        hideColumn('persons', state.types.persons, 'bPlace');
        resetColumns('persons', state.types.persons);
        expect(state.types.persons.columns).toEqual(builtinView('overview').columns.map(c => c.id));
        // A view of the other row type switches the rows.
        switchView(state, 'b:marriages', stored);
        expect(state.rowType).toBe('unions');
        expect(switchView(state, 'tv-missing', stored)).toBe(false);
    });

    it('Discard changes goes back to the view as stored', () => {
        const stored = [saved()];
        const state = defaultTableState();
        restoreTableState(state, null, stored);
        switchView(state, 'tv-a', stored);
        setColumnWidth(state.types.persons, 'bapDate', 300);
        expect(viewChanged(stored[0], state.types.persons)).toBe(true);
        discardViewChanges(state, stored);
        expect(viewChanged(stored[0], state.types.persons)).toBe(false);
        expect(state.types.persons.widths.bapDate).not.toBe(300);
    });

    it('restores the open views and their unsaved state from the stored working state', () => {
        const stored = [saved()];
        const a = defaultTableState();
        restoreTableState(a, null, stored);
        switchView(a, 'tv-a', stored);
        setChip(a.types.persons.filter, 'living', true);
        switchView(a, 'b:marriages', stored);
        const work = tableWorkOf(a, stored);
        expect(work.rowType).toBe('unions');
        expect(work.open.persons).toBe('tv-a');
        expect(work.work.persons?.filter.items).toEqual([{ chip: 'living' }]);
        const b = defaultTableState();
        restoreTableState(b, JSON.parse(JSON.stringify(work)), stored);
        expect(b.rowType).toBe('unions');
        expect(b.open.persons).toBe('tv-a');
        expect(b.types.persons.filter.items).toEqual([{ chip: 'living' }]);
        expect(viewChanged(stored[0], b.types.persons)).toBe(true);
        // Reset returns to the view's own columns, not the defaults.
        expect(b.types.persons.base?.columns.map(c => c.id)).toEqual(['name', 'bapDate', 'bapPlace']);
        // A stored view the tree no longer has: the default view, without the unsaved state.
        const c = defaultTableState();
        restoreTableState(c, JSON.parse(JSON.stringify(work)), []);
        expect(c.open.persons).toBe('b:overview');
        expect(viewChanged(builtinView('overview'), c.types.persons)).toBe(false);
    });

    it('an open view the tree no longer has (deleted, undone) falls back to the default view', () => {
        const stored = [saved()];
        const state = defaultTableState();
        restoreTableState(state, null, stored);
        switchView(state, 'tv-a', stored);
        expect(dropMissingViews(state, stored)).toBe(false);
        expect(dropMissingViews(state, [])).toBe(true);
        expect(state.open.persons).toBe('b:overview');
        expect(viewChanged(builtinView('overview'), state.types.persons)).toBe(false);
    });

    it('the list: built-in in order, custom by name, the other row type named, Rename and Delete only for a saved view', () => {
        const stored = [saved('tv-b', 'Witnesses', { rowType: 'unions', columns: [{ id: 'partner' }] }), saved('tv-a', 'Baptisms')];
        const state = defaultTableState();
        restoreTableState(state, null, stored);
        let list = viewList(state, stored, false);
        expect(list.builtin.map(e => e.id)).toEqual(BUILTIN_VIEWS.map(n => `b:${n}`));
        expect(list.builtin.find(e => e.active)?.id).toBe('b:overview');
        expect(list.builtin.find(e => e.id === 'b:marriages')?.rowNote).toBe('unions');
        expect(list.custom.map(e => [e.name, e.rowNote])).toEqual([['Baptisms', ''], ['Witnesses', 'unions']]);
        expect(list).toMatchObject({ canSaveAs: true, canEdit: false, builtinOpen: true });
        switchView(state, 'tv-a', stored);
        list = viewList(state, stored, false);
        expect(list).toMatchObject({ canSaveAs: true, canEdit: true, builtinOpen: false });
        expect(viewList(state, stored, true)).toMatchObject({ canSaveAs: false, canEdit: false });
    });
});
