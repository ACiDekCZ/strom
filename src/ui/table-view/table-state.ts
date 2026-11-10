/**
 * Table view (spec 073 §2): the state of each row type — its columns,
 * widths, pinning, sort, scroll and selected row — kept per tree while the
 * app is open, so switching the row type loses nothing. No DOM here.
 */

import { columnById, DEFAULT_VIEWS, phoneWidth, type ColumnDef, type SortSpec } from './table-columns.js';
import type { RowType } from './table-model.js';

/** One row type's state (§2): its own columns, widths, pinning, sort, scroll and selection. */
export interface RowTypeState {
    columns: string[];
    widths: Record<string, number>;
    pinned: number;
    sort: SortSpec[];
    top: number;
    left: number;
    selected: string | null;
}

export interface TableState {
    rowType: RowType;
    types: Record<RowType, RowTypeState>;
}

/** A row type's state as its default view gives it. */
export function defaultTypeState(type: RowType): RowTypeState {
    const v = DEFAULT_VIEWS[type];
    return { columns: [...v.columns], widths: { ...v.widths }, pinned: v.pinned, sort: v.sort.map(s => ({ ...s })), top: 0, left: 0, selected: null };
}

export function defaultTableState(): TableState {
    return { rowType: 'persons', types: { persons: defaultTypeState('persons'), unions: defaultTypeState('unions') } };
}

/** The state per tree, while the app is open. */
const states = new Map<string, TableState>();

export function tableStateFor(treeKey: string): TableState {
    let st = states.get(treeKey);
    if (!st) { st = defaultTableState(); states.set(treeKey, st); }
    return st;
}

/** The columns of a state that the catalog knows, with their widths (a phone narrows them, §1.4). */
export function shownColumns(type: RowType, st: RowTypeState, phone: boolean): { columns: ColumnDef[]; widths: number[]; pinned: number } {
    const columns = st.columns.map(id => columnById(type, id)).filter((c): c is ColumnDef => !!c && c.phase === 1);
    const pinned = Math.min(st.pinned, columns.length);
    const widths = columns.map((c, i) => {
        const w = st.widths[c.id] ?? c.width;
        return phone ? phoneWidth(c, w, i < pinned) : w;
    });
    return { columns, widths, pinned };
}
