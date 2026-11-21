/**
 * The Table narrowed to a scope (spec 084 §9, spec 098 §11c): the rows of
 * its people (People in a list's order; Unions and Events with at least one
 * of them), the # and Done columns' cells of a list (§13d) and the counts of
 * the row types within the scope. The scope is the shared switch's (This
 * view / Selection / Whole tree, src/ui/scope-seg-ui.ts): the window's
 * selection a list gives a list's scope, another selection its people, This
 * view the people the Family view lays out. Worked out once per change of
 * its people.
 */

import type { PersonId, PersonList } from '../../types.js';
import { DataManager } from '../../data.js';
import { decodeSelectionRef, encodeSelectionRef, type SelectionRef } from '../../view-selection-ref.js';
import { selectionPersonIds } from '../../view-selection.js';
import type { ViewScope } from '../../view-scope.js';
import type { RowType, ScopeCells, TableModel, TableRow } from './table-model.js';
import { rowsOf } from './table-model.js';
import { selectionIndex } from '../view-selection-ui.js';

/**
 * The Table's scope: a list and what its people give the rows, the
 * window's selection that is not a list (spec 098 §5: a family line,
 * ancestors, descendants, a research line; `kind: 'selection'`), or This
 * view (`kind: 'view'`). The Whole tree has none (null).
 */
export type TableScope = {
    kind: 'list';
    /** The scope's key (the rows' memo, what a row shown for now depends on): the list's id. */
    key: string;
    listId: string;
    list: PersonList;
    /** The list's people in its order. */
    ids: readonly PersonId[];
    cells: ScopeCells;
    /** A fixed list: its people can be taken out from the Table (§9d). */
    fixed: boolean;
} | {
    kind: 'selection';
    /** The state's scope key: `sel:` and the encoded ref. */
    key: string;
    ref: SelectionRef;
    /** The selection's people (no order of their own: the sort stays). */
    ids: readonly PersonId[];
    /** Only `pos` (who is in), no # or Done column. */
    cells: ScopeCells;
    fixed: false;
} | {
    /** This view (spec 098 §11c): the people the Family view lays out around the focus now. */
    kind: 'view';
    key: 'view';
    /** Its people (no order of their own: the sort stays). */
    ids: readonly PersonId[];
    /** Only `pos` (who is in), no # or Done column. */
    cells: ScopeCells;
    fixed: false;
};

/** The prefix of a selection's scope key (a list's id never has it). */
const SEL_PREFIX = 'sel:';

/** The state's scope key of a selection (a list: its id). */
export function selectionScopeKey(ref: SelectionRef): string {
    return ref.kind === 'list' ? ref.listId : SEL_PREFIX + encodeSelectionRef(ref);
}

/** The selection of a scope key (null: a list's id or nothing). */
export function scopeKeySelection(key: string | null): SelectionRef | null {
    return key && key.startsWith(SEL_PREFIX) ? decodeSelectionRef(key.slice(SEL_PREFIX.length)) : null;
}

/** Whether a scope key names a selection (not a list). */
export function isSelectionScopeKey(key: string | null): boolean {
    return !!key && key.startsWith(SEL_PREFIX);
}

interface ScopeMemo {
    ids: readonly PersonId[];
    list: PersonList | null;
    ref: SelectionRef | null;
    scope: TableScope;
    rows: Map<RowType, TableRow[]>;
    model: TableModel | null;
}

let memo: ScopeMemo | null = null;

/**
 * The scope of a key (null: no such list or selection any more): a list's
 * id, or a selection's key (selectionScopeKey). The people come from
 * DataManager or the selection (cached per revision there); the rest is
 * built again only when the people, the list or the selection change.
 */
export function tableScopeOf(key: string | null): TableScope | null {
    if (!key) return null;
    if (isSelectionScopeKey(key)) return selectionScopeOf(key);
    const listId = key;
    const list = DataManager.getPersonList(listId);
    if (!list) return null;
    const ids = DataManager.getPersonListIds(listId);
    // A stored list is a new object after each change; the ready-made one is made anew on each read (same `updated`).
    if (memo && memo.list && memo.ids === ids && (memo.list === list || (!!list.builtin && memo.list.id === list.id && memo.list.updated === list.updated))) return memo.scope;
    const pos = new Map<string, number>();
    ids.forEach((id, i) => pos.set(id, i + 1));
    const fixed = !list.dynamic;
    const done = fixed && list.checklist ? new Set<string>(list.done ?? []) : null;
    const scope: TableScope = { kind: 'list', key, listId, list, ids, cells: { pos, done }, fixed };
    memo = { ids, list, ref: null, scope, rows: new Map(), model: null };
    return scope;
}

/** A selection's scope (spec 098 §5): its people as the window counts them; null when it is gone. */
function selectionScopeOf(key: string): TableScope | null {
    const ref = scopeKeySelection(key);
    if (!ref || ref.kind === 'list') return null;
    const { index } = selectionIndex();
    const set = selectionPersonIds(index.data, index, ref);
    if (!set) return null;
    if (memo && memo.ref && memo.scope.key === key && memoSet === set) return memo.scope;
    const ids = [...set].filter(id => !!index.data.persons[id] && !index.data.persons[id].isPlaceholder);
    const pos = new Map<string, number>();
    ids.forEach((id, i) => pos.set(id, i + 1));
    const scope: TableScope = { kind: 'selection', key, ref, ids, cells: { pos, done: null }, fixed: false };
    memo = { ids, list: null, ref, scope, rows: new Map(), model: null };
    memoSet = set;
    return scope;
}

/** The selection's set the memo was built from (selectionPersonIds caches it per change of the data). */
let memoSet: ReadonlySet<PersonId> | null = null;

/** This view's scope: its people as the Family view lays them out (the same set while nothing changed). */
function viewScopeOf(set: ReadonlySet<PersonId>): TableScope {
    if (memo && memo.scope.kind === 'view' && memoSet === set) return memo.scope;
    const persons = DataManager.getData().persons;
    const ids = [...set].filter(id => !!persons[id] && !persons[id].isPlaceholder);
    const pos = new Map<string, number>();
    ids.forEach((id, i) => pos.set(id, i + 1));
    const scope: TableScope = { kind: 'view', key: 'view', ids, cells: { pos, done: null }, fixed: false };
    memo = { ids, list: null, ref: null, scope, rows: new Map(), model: null };
    memoSet = set;
    return scope;
}

/**
 * The Table's scope now (spec 098 §11c) from the shared switch: the Whole
 * tree none (null); Selection the window's selection (a list: its order, #
 * and Done; null without one or when it is gone); This view the people the
 * Family view lays out (`viewIds`, read only then).
 */
export function tableScopeNow(scope: ViewScope, ref: SelectionRef | null, viewIds: () => ReadonlySet<PersonId>): TableScope | null {
    if (scope === 'tree') return null;
    if (scope === 'sel') return ref ? tableScopeOf(selectionScopeKey(ref)) : null;
    return viewScopeOf(viewIds());
}

/**
 * A scope the Table kept before it took the shared switch (spec 098 §11c,
 * the stored state's list or `sel:` key): it becomes the window's selection
 * with the scope Selection when the window has no selection and it is still
 * there; else it is dropped. Returns the selection to take, or null.
 */
export function legacyScopeSelection(stored: string | null | undefined, hasSelection: boolean, exists: (ref: SelectionRef) => boolean): SelectionRef | null {
    if (!stored || hasSelection) return null;
    const ref: SelectionRef | null = isSelectionScopeKey(stored) ? scopeKeySelection(stored) : { kind: 'list', listId: stored };
    return ref && exists(ref) ? ref : null;
}

/**
 * The rows of a row type within the scope: People in the list's order, a
 * union with a partner in the list, an event with a person of the list;
 * Sources are never narrowed.
 */
export function scopeRows(m: TableModel, type: RowType, scope: TableScope | null): TableRow[] {
    const all = rowsOf(m, type);
    if (!scope || type === 'sources') return all;
    const cached = memo && memo.scope === scope ? memo : null;
    if (cached && cached.model !== m) { cached.rows.clear(); cached.model = m; }
    const hit = cached?.rows.get(type);
    if (hit) return hit;
    const pos = scope.cells.pos;
    let out: TableRow[];
    if (type === 'persons') {
        out = [];
        for (const id of scope.ids) {
            const row = m.personRows.get(id);
            if (row) out.push(row);
        }
    } else if (type === 'unions') {
        out = all.filter(r => r.kind === 'union' && ((!!r.p1 && pos.has(r.p1.id)) || (!!r.p2 && pos.has(r.p2.id))));
    } else {
        out = all.filter(r => r.kind === 'event' && r.persons.some(p => pos.has(p.id)));
    }
    cached?.rows.set(type, out);
    return out;
}

/** The number of rows of each type within the scope (§9: the row-type switch counts what the scope has). */
export function scopeCounts(m: TableModel, scope: TableScope | null): Record<RowType, number> {
    return {
        persons: scopeRows(m, 'persons', scope).length, unions: scopeRows(m, 'unions', scope).length,
        events: scopeRows(m, 'events', scope).length, sources: m.sources.length,
    };
}

/** Whether a row stands outside the scope (a pinned or jumped-to row, §9). */
export function outsideScope(row: TableRow, scope: TableScope | null): boolean {
    if (!scope) return false;
    const pos = scope.cells.pos;
    if (row.kind === 'person') return !pos.has(row.id);
    if (row.kind === 'union') return !(row.p1 && pos.has(row.p1.id)) && !(row.p2 && pos.has(row.p2.id));
    if (row.kind === 'event') return !row.persons.some(p => pos.has(p.id));
    return false;
}

/** Set the model's scope cells (# and Done read them); returns whether they changed. */
export function applyScopeCells(m: TableModel, scope: TableScope | null): boolean {
    const next = scope?.cells ?? null;
    if (m.ctx.scope === next) return false;
    m.ctx.scope = next;
    return true;
}
