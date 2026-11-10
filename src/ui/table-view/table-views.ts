/**
 * Table view (spec 073 §9): the built-in and saved views, without the DOM.
 *
 * A view is the row type, the column setup (order, widths, pinning,
 * collapsed groups, the coverage row), the filter, the sort and (People) the
 * union sub-rows — the tree's `TableView` (§9.1). A row type's state is
 * compared with the view open in it: any difference is "changed" (§9.3);
 * the search, the selected row and the scroll never are.
 *
 * The working state of each row type and the view open in it are kept per
 * tree in localStorage (`strom.table.{treeId}`), not in the tree's data, so
 * a reload comes back to the same table with its unsaved changes.
 */

import { strings } from '../../strings.js';
import type { TableView, TableViewRowType } from '../../types.js';
import { DEFAULT_VIEWS, type SortSpec } from './table-columns.js';
import { ROW_TYPES, type RowType } from './table-model.js';
import type { FilterItem } from './table-filter.js';
import { defaultUnionCollapse } from './table-subrows.js';
import {
    applyColumnSetup, columnSetupOf, defaultTypeState, type ColumnSetup, type RowTypeState, type TableState,
} from './table-state.js';

export const BUILTIN_VIEWS = ['overview', 'births', 'marriages', 'deaths', 'sources', 'gaps', 'checks', 'events', 'allSources'] as const;
export type BuiltinViewName = typeof BUILTIN_VIEWS[number];

const BUILTIN_PREFIX = 'b:';

interface BuiltinDef {
    rowType: RowType;
    columns: string[];
    widths?: Record<string, number>;
    pinned: number;
    sort: SortSpec[];
    chips?: string[];
    unionsCollapsed?: boolean;
}

/** The built-in views (§9.4), in their fixed order. */
const BUILTIN_DEFS: Record<BuiltinViewName, BuiltinDef> = {
    overview: {
        rowType: 'persons', columns: DEFAULT_VIEWS.persons.columns, widths: DEFAULT_VIEWS.persons.widths,
        pinned: DEFAULT_VIEWS.persons.pinned, sort: DEFAULT_VIEWS.persons.sort,
    },
    births: {
        rowType: 'persons', pinned: 1, sort: [{ col: 'bDate', dir: 'asc' }],
        columns: ['name', 'bDate', 'bPlace', 'bapDate', 'bapPlace', 'father', 'mother', 'fAge', 'mAge', 'bComp'],
    },
    marriages: {
        rowType: 'unions', columns: DEFAULT_VIEWS.unions.columns, widths: DEFAULT_VIEWS.unions.widths,
        pinned: DEFAULT_VIEWS.unions.pinned, sort: DEFAULT_VIEWS.unions.sort,
    },
    deaths: {
        rowType: 'persons', pinned: 1, sort: [{ col: 'dDate', dir: 'asc' }], chips: ['deceased'],
        columns: ['name', 'dDate', 'dPlace', 'dCause', 'burDate', 'burPlace', 'dAge', 'dAgeRec', 'dAgeDiff', 'dComp'],
    },
    sources: {
        rowType: 'persons', pinned: 1, sort: [{ col: 'srcCount', dir: 'asc' }],
        columns: ['name', 'srcCount', 'evid', 'relB', 'relD'],
    },
    gaps: {
        rowType: 'persons', pinned: 1, sort: [{ col: 'comp', dir: 'asc' }], unionsCollapsed: true,
        columns: ['name', 'comp', 'bComp', 'uComp', 'dComp', 'bDate', 'bPlace', 'father', 'mother', 'srcCount'],
        widths: { name: 240, bPlace: 190, father: 160, mother: 160 },
    },
    checks: {
        rowType: 'persons', pinned: 1, sort: [{ col: 'topSev', dir: 'desc' }, { col: 'nFind', dir: 'desc' }], chips: ['finding'],
        columns: ['name', 'topSev', 'nFind', 'bDate', 'dDate', 'fAge', 'mAge', 'partner', 'wDate', 'wAge', 'wAgeRec'],
    },
    events: {
        rowType: 'events', columns: DEFAULT_VIEWS.events.columns, widths: DEFAULT_VIEWS.events.widths,
        pinned: DEFAULT_VIEWS.events.pinned, sort: DEFAULT_VIEWS.events.sort,
    },
    allSources: {
        rowType: 'sources', columns: DEFAULT_VIEWS.sources.columns, widths: DEFAULT_VIEWS.sources.widths,
        pinned: DEFAULT_VIEWS.sources.pinned, sort: DEFAULT_VIEWS.sources.sort,
    },
};

export function builtinId(name: BuiltinViewName): string {
    return BUILTIN_PREFIX + name;
}

export function isBuiltinId(id: string): boolean {
    return id.startsWith(BUILTIN_PREFIX) && (BUILTIN_VIEWS as readonly string[]).includes(id.slice(BUILTIN_PREFIX.length));
}

/** The view a row type opens with (§2: Overview for people, Marriages for unions, All events, All sources). */
export function defaultViewId(type: RowType): string {
    return builtinId(type === 'persons' ? 'overview' : type === 'unions' ? 'marriages' : type === 'events' ? 'events' : 'allSources');
}

/** A built-in view as a `TableView` (its name in the current language). */
export function builtinView(name: BuiltinViewName): TableView {
    const d = BUILTIN_DEFS[name];
    return {
        id: builtinId(name),
        name: strings.table.viewName[name],
        rowType: d.rowType,
        columns: d.columns.map(id => (d.widths?.[id] !== undefined ? { id, width: d.widths[id] } : { id })),
        pinned: d.pinned,
        collapsedGroups: [],
        coverageRow: true,
        filter: { op: 'and', items: (d.chips ?? []).map(chip => ({ chip })) },
        sort: d.sort.map(s => ({ col: s.col, dir: s.dir === 'desc' ? -1 : 1 })),
        ...(d.rowType === 'persons' ? { unions: { collapsed: !!d.unionsCollapsed, except: [] } } : {}),
        updated: '',
    };
}

export function builtinViews(): TableView[] {
    return BUILTIN_VIEWS.map(builtinView);
}

/** A row type the table shows (people, unions, events; §9.1 also names sources). */
export function isShownRowType(type: TableViewRowType): type is RowType {
    return (ROW_TYPES as readonly string[]).includes(type);
}

/** The tree's own views the table can open, by name (§9.2: "Custom" alphabetically). */
export function customViews(stored: readonly TableView[] | undefined): TableView[] {
    return (stored ?? []).filter(v => isShownRowType(v.rowType)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** A view by its id: a built-in one or one of the tree's. */
export function findView(id: string, stored: readonly TableView[] | undefined): TableView | null {
    if (isBuiltinId(id)) return builtinView(id.slice(BUILTIN_PREFIX.length) as BuiltinViewName);
    return customViews(stored).find(v => v.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// A view and a row type's state.

function toSpec(s: { col: string; dir: 1 | -1 }): SortSpec {
    return { col: s.col, dir: s.dir === -1 ? 'desc' : 'asc' };
}

function fromSpec(s: SortSpec): { col: string; dir: 1 | -1 } {
    return { col: s.col, dir: s.dir === 'desc' ? -1 : 1 };
}

/** Open a view in its row type's state: its setup becomes what "Reset to default" returns to (§4.4). */
export function applyView(view: TableView, st: RowTypeState): void {
    if (!isShownRowType(view.rowType)) return;
    const type = view.rowType;
    const setup: ColumnSetup = {
        columns: view.columns.map(c => ({ ...c })), pinned: view.pinned, collapsedGroups: [...view.collapsedGroups], coverageRow: view.coverageRow,
    };
    applyColumnSetup(type, st, setup);
    st.base = columnSetupOf(st);
    st.filter = { op: 'and', items: structuredClone(view.filter.items) as unknown as FilterItem[] };
    st.sort = view.sort.map(toSpec);
    st.unions = type === 'persons' && view.unions ? { collapsed: view.unions.collapsed, except: [...view.unions.except] } : defaultUnionCollapse();
    st.revealedUnions = [];
}

/** The view a row type's state makes: what "Save" and "Save as new" store (§9.3). */
export function viewFromState(type: RowType, st: RowTypeState, id: string, name: string, now: string): TableView {
    const setup = columnSetupOf(st);
    return {
        id, name, rowType: type,
        columns: setup.columns, pinned: setup.pinned, collapsedGroups: setup.collapsedGroups, coverageRow: setup.coverageRow,
        filter: { op: 'and', items: structuredClone(st.filter.items) as unknown as Record<string, unknown>[] },
        sort: st.sort.map(fromSpec),
        ...(type === 'persons' ? { unions: { collapsed: st.unions.collapsed, except: [...st.unions.except].sort() } } : {}),
        updated: now,
    };
}

/** What makes two states the same view: everything a view keeps, nothing else. */
function stateKey(type: RowType, st: RowTypeState): string {
    const v = viewFromState(type, st, '', '', '');
    return JSON.stringify([v.columns, v.pinned, [...v.collapsedGroups].sort(), v.coverageRow, v.filter.items, v.sort, v.unions ?? null]);
}

/** The state a view opens to, compared the same way (unknown columns dropped, as the table drops them). */
function viewKey(view: TableView): string {
    if (!isShownRowType(view.rowType)) return '';
    const st = defaultTypeState(view.rowType);
    applyView(view, st);
    return stateKey(view.rowType, st);
}

/** The row type's state differs from its open view (§9.3 "● changed"). */
export function viewChanged(view: TableView, st: RowTypeState): boolean {
    if (!isShownRowType(view.rowType)) return false;
    return stateKey(view.rowType, st) !== viewKey(view);
}

// ---------------------------------------------------------------------------
// Names and ids.

/** A name not used yet (§9.3: the same name gets " (2)", " (3)"…); compared without case. */
export function uniqueViewName(name: string, taken: readonly string[]): string {
    const base = name.trim();
    const used = new Set(taken.map(n => n.trim().toLocaleLowerCase()));
    if (!used.has(base.toLocaleLowerCase())) return base;
    for (let k = 2; ; k++) {
        const next = `${base} (${k})`;
        if (!used.has(next.toLocaleLowerCase())) return next;
    }
}

/** The names a new or renamed view must not take: every built-in and every saved view but `except`. */
export function takenViewNames(stored: readonly TableView[] | undefined, except?: string): string[] {
    return [...builtinViews().map(v => v.name), ...(stored ?? []).filter(v => v.id !== except).map(v => v.name)];
}

export function newViewId(): string {
    const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    return `tv-${rnd}`;
}

// ---------------------------------------------------------------------------
// The working state in localStorage (§9.1).

/** What a tree's table keeps between visits: the row type, each type's open view and its unsaved state. */
export interface StoredTableWork {
    rowType: RowType;
    open: Partial<Record<RowType, string>>;
    /** Each row type's state as a view (only when it differs from the open view). */
    work: Partial<Record<RowType, TableView>>;
}

export function workStorageKey(treeId: string): string {
    return `strom.table.${treeId}`;
}

export function readTableWork(treeId: string): StoredTableWork | null {
    try {
        const raw = localStorage.getItem(workStorageKey(treeId));
        if (!raw) return null;
        const v = JSON.parse(raw) as Partial<StoredTableWork>;
        if (!v || typeof v !== 'object') return null;
        const rowType = (ROW_TYPES as readonly string[]).includes(v.rowType as string) ? v.rowType as RowType : 'persons';
        const open: StoredTableWork['open'] = {};
        const work: StoredTableWork['work'] = {};
        for (const t of ROW_TYPES) {
            if (typeof v.open?.[t] === 'string') open[t] = v.open[t];
            const w = v.work?.[t];
            if (w && typeof w === 'object' && w.rowType === t && Array.isArray(w.columns) && Array.isArray(w.sort) && w.filter && Array.isArray(w.filter.items)) work[t] = w;
        }
        return { rowType, open, work };
    } catch {
        return null;
    }
}

export function writeTableWork(treeId: string, work: StoredTableWork): void {
    try {
        localStorage.setItem(workStorageKey(treeId), JSON.stringify(work));
    } catch {
        // Storage full or blocked: the table works without it.
    }
}

// ---------------------------------------------------------------------------
// Opening, switching and keeping views in a tree's table state (§9.2, §9.3).

/** Open a view's unsaved state over it: "Reset to default" still returns to the view (§4.4). */
function applyDraft(draft: TableView, type: RowType, st: RowTypeState): void {
    const base = st.base;
    applyView({ ...draft, rowType: type }, st);
    st.base = base;
}

/** The view open in a row type, or that type's default view when it is gone. */
export function openViewOf(state: TableState, type: RowType, stored: readonly TableView[] | undefined): TableView {
    const v = findView(state.open[type], stored);
    return v && v.rowType === type ? v : findView(defaultViewId(type), stored)!;
}

/**
 * The tree's table as it was left (§9.1): each row type's open view with its
 * unsaved state over it, and the row type. Without a stored state, each type
 * opens its default view. Marks the state restored.
 */
export function restoreTableState(state: TableState, work: StoredTableWork | null, stored: readonly TableView[] | undefined): void {
    for (const t of ROW_TYPES) {
        const id = work?.open[t];
        const found = id ? findView(id, stored) : null;
        const view = found && found.rowType === t ? found : findView(defaultViewId(t), stored)!;
        const st = state.types[t];
        state.open[t] = view.id;
        applyView(view, st);
        const w = work?.work[t];
        if (w && found) applyDraft(w, t, st);
    }
    if (work) state.rowType = work.rowType;
    state.restored = true;
}

/**
 * A view open in a row type that the tree no longer has (deleted, or an undo
 * took it away): that type goes back to its default view (§9.3). True when
 * something changed.
 */
export function dropMissingViews(state: TableState, stored: readonly TableView[] | undefined): boolean {
    let changed = false;
    for (const t of ROW_TYPES) {
        const v = findView(state.open[t], stored);
        if (v && v.rowType === t) continue;
        const def = findView(defaultViewId(t), stored)!;
        state.open[t] = def.id;
        applyView(def, state.types[t]);
        state.types[t].top = 0;
        state.types[t].left = 0;
        changed = true;
    }
    for (const id of Object.keys(state.drafts)) {
        if (!findView(id, stored)) delete state.drafts[id];
    }
    return changed;
}

/**
 * Choose a view (§9.2): its row type is shown. The view left keeps its
 * unsaved changes until the tree closes (§9.3: no question); a view chosen
 * again comes back with them. False when there is no such view.
 */
export function switchView(state: TableState, id: string, stored: readonly TableView[] | undefined): boolean {
    const view = findView(id, stored);
    if (!view || !isShownRowType(view.rowType)) return false;
    const t = view.rowType;
    const st = state.types[t];
    const curId = state.open[t];
    if (curId !== id) {
        const cur = findView(curId, stored);
        if (cur && viewChanged(cur, st)) state.drafts[curId] = viewFromState(t, st, curId, cur.name, '');
        else delete state.drafts[curId];
        applyView(view, st);
        const draft = state.drafts[id];
        if (draft) {
            applyDraft(draft, t, st);
            delete state.drafts[id];
        }
        state.open[t] = id;
        st.top = 0;
        st.left = 0;
    }
    state.rowType = t;
    return true;
}

/** "Discard changes" (§9.3): the shown row type back to its open view as stored. */
export function discardViewChanges(state: TableState, stored: readonly TableView[] | undefined): void {
    const t = state.rowType;
    const view = openViewOf(state, t, stored);
    state.open[t] = view.id;
    applyView(view, state.types[t]);
    delete state.drafts[view.id];
}

/** What the tree's table keeps in localStorage now (§9.1). */
export function tableWorkOf(state: TableState, stored: readonly TableView[] | undefined): StoredTableWork {
    const work: StoredTableWork = { rowType: state.rowType, open: {}, work: {} };
    for (const t of ROW_TYPES) {
        const view = openViewOf(state, t, stored);
        work.open[t] = view.id;
        const st = state.types[t];
        if (viewChanged(view, st)) work.work[t] = viewFromState(t, st, view.id, view.name, '');
    }
    return work;
}

// ---------------------------------------------------------------------------
// The list of views (9a).

export interface ViewListEntry {
    id: string;
    name: string;
    /** The row type when it is not the one shown ("unions"). */
    rowNote: string;
    active: boolean;
}

export interface ViewList {
    builtin: ViewListEntry[];
    custom: ViewListEntry[];
    /** "Save as new…" (not in a read-only tree). */
    canSaveAs: boolean;
    /** "Rename…" and "Delete": a saved view in a tree that can change. */
    canEdit: boolean;
    /** The open view is built in: Rename and Delete are inactive, with a note why. */
    builtinOpen: boolean;
}

/** The list of views for the shown row type (§9.2): built-in in their order, then the tree's alphabetically. */
export function viewList(state: TableState, stored: readonly TableView[] | undefined, readOnly: boolean): ViewList {
    const shown = state.rowType;
    const openId = openViewOf(state, shown, stored).id;
    const entry = (v: TableView): ViewListEntry => ({
        id: v.id, name: v.name, active: v.id === openId,
        rowNote: v.rowType !== shown && isShownRowType(v.rowType) ? strings.table.viewRows[v.rowType] : '',
    });
    const builtinOpen = isBuiltinId(openId);
    return {
        builtin: builtinViews().map(entry),
        custom: customViews(stored).map(entry),
        canSaveAs: !readOnly,
        canEdit: !readOnly && !builtinOpen,
        builtinOpen,
    };
}
