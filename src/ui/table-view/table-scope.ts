/**
 * The Table narrowed to one list of people (spec 084 §9): the rows of the
 * list's people (People in the list's order; Unions and Events with at least
 * one of them), the # and Done columns' cells (§13d) and the counts of the
 * row types within the scope. Worked out once per list and model revision.
 */

import type { PersonId, PersonList } from '../../types.js';
import { DataManager } from '../../data.js';
import type { RowType, ScopeCells, TableModel, TableRow } from './table-model.js';
import { rowsOf } from './table-model.js';

/** The Table's scope: the list and what its people give the rows. */
export interface TableScope {
    listId: string;
    list: PersonList;
    /** The list's people in its order. */
    ids: readonly PersonId[];
    cells: ScopeCells;
    /** A fixed list: its people can be taken out from the Table (§9d). */
    fixed: boolean;
}

interface ScopeMemo {
    ids: readonly PersonId[];
    list: PersonList;
    scope: TableScope;
    rows: Map<RowType, TableRow[]>;
    model: TableModel | null;
}

let memo: ScopeMemo | null = null;

/**
 * The scope of a list (null: no such list any more). The people come from
 * DataManager (cached per revision there); the rest is built again only when
 * the people or the list change.
 */
export function tableScopeOf(listId: string | null): TableScope | null {
    if (!listId) return null;
    const list = DataManager.getPersonList(listId);
    if (!list) return null;
    const ids = DataManager.getPersonListIds(listId);
    // A stored list is a new object after each change; the ready-made one is made anew on each read (same `updated`).
    if (memo && memo.ids === ids && (memo.list === list || (!!list.builtin && memo.list.id === list.id && memo.list.updated === list.updated))) return memo.scope;
    const pos = new Map<string, number>();
    ids.forEach((id, i) => pos.set(id, i + 1));
    const fixed = !list.dynamic;
    const done = fixed && list.checklist ? new Set<string>(list.done ?? []) : null;
    const scope: TableScope = { listId, list, ids, cells: { pos, done }, fixed };
    memo = { ids, list, scope, rows: new Map(), model: null };
    return scope;
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
