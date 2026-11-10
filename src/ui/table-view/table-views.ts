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
    applyColumnSetup, columnSetupOf, defaultTypeState, type ColumnSetup, type RowTypeState,
} from './table-state.js';

export const BUILTIN_VIEWS = ['overview', 'births', 'marriages', 'deaths', 'sources', 'gaps', 'checks'] as const;
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
};

export function builtinId(name: BuiltinViewName): string {
    return BUILTIN_PREFIX + name;
}

export function isBuiltinId(id: string): boolean {
    return id.startsWith(BUILTIN_PREFIX) && (BUILTIN_VIEWS as readonly string[]).includes(id.slice(BUILTIN_PREFIX.length));
}

/** The view a row type opens with (§2: Overview for people, Marriages for unions). */
export function defaultViewId(type: RowType): string {
    return builtinId(type === 'persons' ? 'overview' : 'marriages');
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

/** A row type the table shows (P1: people and unions; §9.1 also names events and sources). */
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
