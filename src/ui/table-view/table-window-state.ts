/**
 * The Table opened in a new window (spec 079 §1 "What is carried over"): the
 * state the main window's Table hands to the new window — the row type, the
 * open view (by id) with its filters and sort as they are now, the search and
 * the selected row — and how the new window takes it over. No DOM here.
 *
 * The state goes as one plain object (structured clone over the windows'
 * channel), never in the address. The window that gets it keeps its own
 * state afterwards.
 */

import type { TableView } from '../../types.js';
import { sanitizeTableView } from '../../table-views-data.js';
import { ROW_TYPES, type RowType } from './table-model.js';
import type { TableState } from './table-state.js';
import { applyView, findView, isShownRowType, openViewOf, viewFromState } from './table-views.js';

/** The Table's state for a new window. */
export interface TableWindowState {
    rowType: RowType;
    /** The view open in that row type (a built-in `b:…`, a research view or a saved view's id). */
    viewId: string;
    /** The row type's state as a view now: its columns, filters and sort (unsaved changes included). */
    view: TableView;
    search: string;
    /** The selected row's key (`p:<id>`…), scrolled to in the new window. */
    selected: string | null;
}

/** The state of the shown row type, as the new window takes it. */
export function tableWindowStateOf(state: TableState, stored: readonly TableView[] | undefined): TableWindowState {
    const t = state.rowType;
    const st = state.types[t];
    const open = openViewOf(state, t, stored);
    return {
        rowType: t,
        viewId: open.id,
        view: viewFromState(t, st, open.id, open.name, ''),
        search: st.search,
        selected: st.selected,
    };
}

/** A carried state as it came over the channel, or null when it is not one. */
export function readTableWindowState(raw: unknown): TableWindowState | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.rowType !== 'string' || !(ROW_TYPES as readonly string[]).includes(r.rowType)) return null;
    const rowType = r.rowType as RowType;
    const view = sanitizeTableView(r.view);
    if (!view || view.rowType !== rowType) return null;
    return {
        rowType,
        viewId: typeof r.viewId === 'string' ? r.viewId : '',
        view,
        search: typeof r.search === 'string' ? r.search : '',
        selected: typeof r.selected === 'string' && r.selected ? r.selected : null,
    };
}

/**
 * Take the carried state over: the row type, its view open (Reset to default
 * still returns to that view), the filters and sort as they were, the search
 * and the selected row; the scroll starts at the top (the selected row is
 * scrolled to by the caller).
 */
export function applyTableWindowState(state: TableState, ws: TableWindowState, stored: readonly TableView[] | undefined): void {
    const t = ws.rowType;
    const st = state.types[t];
    const found = ws.viewId ? findView(ws.viewId, stored) : null;
    if (found && found.rowType === t) {
        state.open[t] = found.id;
        applyView(found, st);
        delete state.drafts[found.id];
    }
    if (isShownRowType(ws.view.rowType)) {
        const base = st.base;
        applyView({ ...ws.view, rowType: t }, st);
        st.base = base;
    }
    st.search = ws.search;
    st.selected = ws.selected;
    st.top = 0;
    st.left = 0;
    state.rowType = t;
}
