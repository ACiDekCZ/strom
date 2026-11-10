/**
 * Saved views of the Table view as the tree stores them (spec 073 §9.1,
 * data version 17): reading them back from any stored or imported tree. No
 * DOM and nothing of the table itself, so the data layer can use it.
 *
 * A malformed view is dropped, a malformed part of a view is left out (a
 * column without an id, a sort key without a column); a row type the app
 * does not know is no view at all. The table checks the column ids and the
 * filter's items against its own catalog when it opens a view.
 */

import type { StromData, TableView, TableViewRowType } from './types.js';

export const TABLE_VIEW_ROW_TYPES: readonly TableViewRowType[] = ['persons', 'unions', 'events', 'sources'];

function isObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strings(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
}

/** One stored view as the app can use it, or null. */
export function sanitizeTableView(raw: unknown): TableView | null {
    if (!isObject(raw)) return null;
    const { id, name, rowType } = raw;
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) return null;
    if (typeof rowType !== 'string' || !TABLE_VIEW_ROW_TYPES.includes(rowType as TableViewRowType)) return null;
    const columns = (Array.isArray(raw.columns) ? raw.columns : [])
        .filter(isObject)
        .filter(c => typeof c.id === 'string' && c.id !== '')
        .map(c => (typeof c.width === 'number' && Number.isFinite(c.width) && c.width > 0
            ? { id: c.id as string, width: Math.round(c.width) }
            : { id: c.id as string }));
    const pinned = typeof raw.pinned === 'number' && Number.isFinite(raw.pinned) ? Math.max(0, Math.floor(raw.pinned)) : 1;
    const filterRaw = isObject(raw.filter) ? raw.filter : {};
    const items = (Array.isArray(filterRaw.items) ? filterRaw.items : []).filter(isObject).map(i => ({ ...i }));
    const sort = (Array.isArray(raw.sort) ? raw.sort : [])
        .filter(isObject)
        .filter(s => typeof s.col === 'string' && s.col !== '')
        .map(s => ({ col: s.col as string, dir: (s.dir === -1 ? -1 : 1) as 1 | -1 }));
    const view: TableView = {
        id, name: name.trim(), rowType: rowType as TableViewRowType,
        columns, pinned,
        collapsedGroups: strings(raw.collapsedGroups),
        coverageRow: raw.coverageRow !== false,
        filter: { op: 'and', items },
        sort,
        updated: typeof raw.updated === 'string' ? raw.updated : '',
    };
    if (isObject(raw.unions)) view.unions = { collapsed: raw.unions.collapsed === true, except: strings(raw.unions.except) };
    return view;
}

/** The stored views as the app can use them (one per id, the first wins); undefined when none. */
export function sanitizeTableViews(raw: unknown): TableView[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const seen = new Set<string>();
    const out: TableView[] = [];
    for (const r of raw) {
        const v = sanitizeTableView(r);
        if (!v || seen.has(v.id)) continue;
        seen.add(v.id);
        out.push(v);
    }
    return out.length ? out : undefined;
}

/**
 * The saved views are the tree's own, not the research's: a version the
 * research sends (a GEDCOM file, which has no place for them) keeps the
 * previous state's. Returns `next` itself when nothing is carried.
 */
export function keepTableViews(next: StromData, previous: StromData): StromData {
    if (next.tableViews?.length || !previous.tableViews?.length) return next;
    return { ...next, tableViews: structuredClone(previous.tableViews) };
}
