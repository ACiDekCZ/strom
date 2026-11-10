/**
 * Table view (spec 073 §2): the state of each row type — its columns,
 * widths, pinning, sort, scroll and selected row — kept per tree while the
 * app is open, so switching the row type loses nothing; and the column
 * operations of §4.3–§4.6 (show, order, width, pin, collapse). No DOM here.
 */

import { columnById, columnsOf, DEFAULT_VIEWS, phoneWidth, type ColumnDef, type ColumnGroup, type SortSpec } from './table-columns.js';
import type { RowType } from './table-model.js';
import type { TableView } from '../../types.js';
import { defaultUnionCollapse, type UnionCollapse } from './table-subrows.js';
import { emptyFilter, type TableFilter } from './table-filter.js';

/** One row type's state (§2): its own columns, widths, pinning, sort, scroll and selection. */
export interface RowTypeState {
    columns: string[];
    widths: Record<string, number>;
    pinned: number;
    sort: SortSpec[];
    top: number;
    left: number;
    selected: string | null;
    /** Groups shown as one narrow band (§4.3). */
    collapsedGroups: string[];
    /** The coverage row under the head is shown (§6.1; switched in the Columns panel). */
    coverageRow: boolean;
    /**
     * The union sub-rows of the People table (§3.2): collapsed or not, with
     * exceptions per person. Part of a saved view (§9.1 `unions`; part D).
     */
    unions: UnionCollapse;
    /**
     * People whose unions outside the filter are shown dimmed (§3.3 "show");
     * cleared when the filter changes (part C2). Not part of a view.
     */
    revealedUnions: string[];
    /**
     * The filter (§8.1 chips, §8.2 column filters; §9.1 `filter`): part D
     * stores it in `TableView.filter` as it is.
     */
    filter: TableFilter;
    /** The search text (§8.3; not part of a view). */
    search: string;
    /** The setup "Reset to default" returns to (part D: the open view's stored one; else the default view). */
    base?: ColumnSetup;
}

export interface TableState {
    rowType: RowType;
    types: Record<RowType, RowTypeState>;
    /** The view open in each row type (§9; a built-in `b:…` or a saved view's id). */
    open: Record<RowType, string>;
    /** Unsaved states of views not open now, by view id (§9.3: kept until the app closes). */
    drafts: Record<string, TableView>;
    /** The tree's stored working state was read (localStorage, §9.1). */
    restored?: boolean;
}

/** A row type's state as its default view gives it. */
export function defaultTypeState(type: RowType): RowTypeState {
    const v = DEFAULT_VIEWS[type];
    return { columns: [...v.columns], widths: { ...v.widths }, pinned: v.pinned, sort: v.sort.map(s => ({ ...s })), top: 0, left: 0, selected: null, collapsedGroups: [], coverageRow: true, unions: defaultUnionCollapse(), revealedUnions: [], filter: emptyFilter(), search: '' };
}

export function defaultTableState(): TableState {
    return {
        rowType: 'persons', types: { persons: defaultTypeState('persons'), unions: defaultTypeState('unions'), events: defaultTypeState('events') },
        open: { persons: 'b:overview', unions: 'b:marriages', events: 'b:events' }, drafts: {},
    };
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

// ---------------------------------------------------------------------------
// Columns (§4.3–§4.5): showing, order, widths, pinning, collapsed groups.
// Pure operations on a row type's state; each returns whether it changed it.

/** The narrowest a column gets by dragging its edge (§4.5). */
export const MIN_COLUMN_WIDTH = 56;
/** A collapsed group is one band of this width (§4.3; a phone narrows it). */
export const BAND_WIDTH = 130;
/** Pinned columns may take at most this share of the grid's width (§4.5). */
export const MAX_PINNED_SHARE = 0.5;

/** The column that is always shown and pinned first (§4.4: the name). */
export function lockedColumn(type: RowType): string {
    return type === 'persons' ? 'name' : type === 'unions' ? 'p1' : 'evType';
}

/** The catalog's P1 columns of a row type (the Columns panel lists these). */
export function catalogColumns(type: RowType): ColumnDef[] {
    return columnsOf(type).filter(c => c.phase === 1);
}

function catalogIndex(type: RowType): Map<string, number> {
    return new Map(catalogColumns(type).map((c, i) => [c.id, i]));
}

function groupOrder(type: RowType): Map<string, number> {
    const out = new Map<string, number>();
    for (const c of catalogColumns(type)) if (!out.has(c.group)) out.set(c.group, out.size);
    return out;
}

/**
 * Keep only columns the catalog knows (P1), each once; the locked column
 * first and pinned; `pinned` within bounds. Run before every operation.
 */
export function normalizeColumns(type: RowType, st: RowTypeState): void {
    const known = catalogIndex(type);
    const seen = new Set<string>();
    const lock = lockedColumn(type);
    const pinnedIds = new Set(st.columns.slice(0, st.pinned));
    const cols = st.columns.filter(id => known.has(id) && !seen.has(id) && (seen.add(id), true));
    const rest = cols.filter(id => id !== lock);
    const pinned = rest.filter(id => pinnedIds.has(id));
    const scrolling = rest.filter(id => !pinnedIds.has(id));
    st.columns = [lock, ...pinned, ...scrolling];
    st.pinned = 1 + pinned.length;
    st.collapsedGroups = [...new Set(st.collapsedGroups ?? [])];
}

function groupOf(type: RowType, id: string): string {
    return columnById(type, id)?.group ?? '';
}

/**
 * The run of positions a column at `i` may move within (§4.5): neighbours of
 * the same group in the same zone (pinned or scrolling), never before the
 * locked first column. `groups` are the groups in shown order.
 */
export function columnRun(groups: readonly string[], pinned: number, i: number, locked = 1): [number, number] {
    if (i < locked) return [i, i];
    const zoneStart = i < pinned ? locked : Math.max(pinned, locked);
    const zoneEnd = i < pinned ? pinned - 1 : groups.length - 1;
    let a = i;
    while (a - 1 >= zoneStart && groups[a - 1] === groups[i]) a--;
    let b = i;
    while (b + 1 <= zoneEnd && groups[b + 1] === groups[i]) b++;
    return [a, b];
}

/** The runs of one group in a row of columns (§4.3: a pinned part is its own run). */
export interface GroupRun { group: string; start: number; end: number; pinned: boolean }

export function groupRuns(groups: readonly string[], pinned: number): GroupRun[] {
    const runs: GroupRun[] = [];
    groups.forEach((g, i) => {
        const p = i < pinned;
        const last = runs[runs.length - 1];
        if (last && last.group === g && last.pinned === p) last.end = i;
        else runs.push({ group: g, start: i, end: i, pinned: p });
    });
    return runs;
}

function groupsOf(type: RowType, st: RowTypeState): string[] {
    return st.columns.map(id => groupOf(type, id));
}

/** Where a newly shown column goes: beside its group's shown columns in catalog order, else by group order. */
function insertIndex(type: RowType, st: RowTypeState, id: string): number {
    const cat = catalogIndex(type);
    const order = groupOrder(type);
    const group = groupOf(type, id);
    const mine = cat.get(id) ?? 0;
    let afterSame = -1;
    let beforeSame = -1;
    for (let i = st.pinned; i < st.columns.length; i++) {
        const other = st.columns[i];
        if (groupOf(type, other) !== group) continue;
        if ((cat.get(other) ?? 0) < mine) afterSame = i;
        else if (beforeSame < 0) beforeSame = i;
    }
    if (afterSame >= 0) return afterSame + 1;
    if (beforeSame >= 0) return beforeSame;
    const g = order.get(group) ?? 0;
    for (let i = st.pinned; i < st.columns.length; i++) {
        if ((order.get(groupOf(type, st.columns[i])) ?? 0) > g) return i;
    }
    return st.columns.length;
}

export function showColumn(type: RowType, st: RowTypeState, id: string): boolean {
    normalizeColumns(type, st);
    if (st.columns.includes(id) || !catalogIndex(type).has(id)) return false;
    st.columns.splice(insertIndex(type, st, id), 0, id);
    return true;
}

export function hideColumn(type: RowType, st: RowTypeState, id: string): boolean {
    normalizeColumns(type, st);
    const i = st.columns.indexOf(id);
    if (i < 0 || id === lockedColumn(type)) return false;
    st.columns.splice(i, 1);
    if (i < st.pinned) st.pinned--;
    return true;
}

/** "all" in a group of the Columns panel: show or hide every column of the group. */
export function setGroupShown(type: RowType, st: RowTypeState, group: string, on: boolean): boolean {
    let changed = false;
    for (const c of catalogColumns(type)) {
        if (c.group !== group) continue;
        changed = (on ? showColumn(type, st, c.id) : hideColumn(type, st, c.id)) || changed;
    }
    return changed;
}

/** Whether a column can move one step (−1 left/up, +1 right/down) within its group. */
export function canMoveColumn(type: RowType, st: RowTypeState, id: string, dir: -1 | 1): boolean {
    normalizeColumns(type, st);
    const i = st.columns.indexOf(id);
    if (i < 0) return false;
    const [a, b] = columnRun(groupsOf(type, st), st.pinned, i);
    return dir < 0 ? i > a : i < b;
}

/** Move a column by `offset` positions, within its group and zone only (§4.5). */
export function moveColumnBy(type: RowType, st: RowTypeState, id: string, offset: number): boolean {
    normalizeColumns(type, st);
    const i = st.columns.indexOf(id);
    if (i < 0 || !offset) return false;
    const [a, b] = columnRun(groupsOf(type, st), st.pinned, i);
    const to = i + offset;
    if (to < a || to > b) return false;
    st.columns.splice(i, 1);
    st.columns.splice(to, 0, id);
    return true;
}

/** Move a column to where another one of its run is now (the panel's drag). */
export function moveColumnTo(type: RowType, st: RowTypeState, id: string, targetId: string): boolean {
    normalizeColumns(type, st);
    return moveColumnBy(type, st, id, st.columns.indexOf(targetId) - st.columns.indexOf(id));
}

/**
 * Move the columns [start, end] (a whole group run of the scrolling zone)
 * before position `before` (§4.5: a group moves by its cell in the group row).
 * `before` must be the start of a run of the scrolling zone or the end.
 */
export function moveColumnRun(type: RowType, st: RowTypeState, start: number, end: number, before: number): boolean {
    normalizeColumns(type, st);
    const n = st.columns.length;
    if (start < st.pinned || end < start || end >= n || before < st.pinned || before > n) return false;
    if (before >= start && before <= end + 1) return false;
    const runs = groupRuns(groupsOf(type, st), st.pinned);
    if (!runs.some(r => r.start === start && r.end === end)) return false;
    if (before < n && !runs.some(r => r.start === before)) return false;
    const moved = st.columns.slice(start, end + 1);
    const rest = [...st.columns.slice(0, start), ...st.columns.slice(end + 1)];
    const at = before > end ? before - moved.length : before;
    rest.splice(at, 0, ...moved);
    st.columns = rest;
    return true;
}

/** A column's width as stored (desktop px). */
export function columnWidth(type: RowType, st: RowTypeState, id: string): number {
    return st.widths[id] ?? columnById(type, id)?.width ?? 120;
}

export function setColumnWidth(st: RowTypeState, id: string, width: number): boolean {
    const w = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    if (st.widths[id] === w) return false;
    st.widths[id] = w;
    return true;
}

/** Whether "Pin left" is offered (§4.5): not pinned yet and the pinned ones stay ≤ half the grid. */
export function canPinColumn(type: RowType, st: RowTypeState, id: string, gridWidth: number, phone = false): boolean {
    normalizeColumns(type, st);
    const i = st.columns.indexOf(id);
    if (i < st.pinned) return false;
    const shown = shownColumns(type, st, phone);
    const pinnedWidth = shown.widths.slice(0, shown.pinned).reduce((s, w) => s + w, 0);
    const col = columnById(type, id);
    const w = col ? (phone ? phoneWidth(col, columnWidth(type, st, id), false) : columnWidth(type, st, id)) : 0;
    return pinnedWidth + w <= gridWidth * MAX_PINNED_SHARE;
}

/** Pin a column: it moves behind the last pinned one (§4.5). */
export function pinColumn(type: RowType, st: RowTypeState, id: string): boolean {
    normalizeColumns(type, st);
    const i = st.columns.indexOf(id);
    if (i < st.pinned) return false;
    st.columns.splice(i, 1);
    st.columns.splice(st.pinned, 0, id);
    st.pinned++;
    return true;
}

/** Unpin a column: it goes back beside its group among the scrolling ones. */
export function unpinColumn(type: RowType, st: RowTypeState, id: string): boolean {
    normalizeColumns(type, st);
    const i = st.columns.indexOf(id);
    if (i < 0 || i >= st.pinned || id === lockedColumn(type)) return false;
    st.columns.splice(i, 1);
    st.pinned--;
    st.columns.splice(insertIndex(type, st, id), 0, id);
    return true;
}

export function setGroupCollapsed(st: RowTypeState, group: string, collapsed: boolean): boolean {
    const has = st.collapsedGroups.includes(group);
    if (has === collapsed) return false;
    st.collapsedGroups = collapsed ? [...st.collapsedGroups, group] : st.collapsedGroups.filter(g => g !== group);
    return true;
}

/** A collapsed group's band in the drawn columns (§4.3). */
export interface CollapsedBand { group: ColumnGroup; columns: ColumnDef[] }

/** The columns as the grid draws them: a collapsed group's scrolling run becomes one band. */
export interface DisplayColumns {
    /** A drawn column; for a band its group's first column. */
    columns: ColumnDef[];
    widths: number[];
    pinned: number;
    /** The band at each drawn position (null for a plain column). */
    bands: (CollapsedBand | null)[];
    /** The state's columns [start, end] behind each drawn position. */
    starts: number[];
    ends: number[];
}

export function displayColumns(type: RowType, st: RowTypeState, phone: boolean): DisplayColumns {
    const shown = shownColumns(type, st, phone);
    const out: DisplayColumns = { columns: [], widths: [], pinned: shown.pinned, bands: [], starts: [], ends: [] };
    const collapsed = new Set(st.collapsedGroups);
    const bandWidth = phone ? Math.round(BAND_WIDTH * 0.8) : BAND_WIDTH;
    for (let i = 0; i < shown.columns.length; i++) {
        const col = shown.columns[i];
        if (i >= shown.pinned && collapsed.has(col.group)) {
            let j = i;
            while (j + 1 < shown.columns.length && shown.columns[j + 1].group === col.group) j++;
            out.columns.push(col);
            out.widths.push(bandWidth);
            out.bands.push({ group: col.group, columns: shown.columns.slice(i, j + 1) });
            out.starts.push(i);
            out.ends.push(j);
            i = j;
            continue;
        }
        out.columns.push(col);
        out.widths.push(shown.widths[i]);
        out.bands.push(null);
        out.starts.push(i);
        out.ends.push(i);
    }
    return out;
}

// ---------------------------------------------------------------------------
// The column setup as a saved view keeps it (§9.1: columns, pinned,
// collapsedGroups, coverageRow). Part D stores it in `TableView`.

export interface ColumnSetup {
    columns: { id: string; width?: number }[];
    pinned: number;
    collapsedGroups: string[];
    coverageRow: boolean;
}

export function columnSetupOf(st: RowTypeState): ColumnSetup {
    return {
        columns: st.columns.map(id => (st.widths[id] !== undefined ? { id, width: st.widths[id] } : { id })),
        pinned: st.pinned,
        collapsedGroups: [...st.collapsedGroups],
        coverageRow: st.coverageRow,
    };
}

export function applyColumnSetup(type: RowType, st: RowTypeState, setup: ColumnSetup): void {
    st.columns = setup.columns.map(c => c.id);
    st.widths = {};
    for (const c of setup.columns) if (c.width !== undefined) st.widths[c.id] = c.width;
    st.pinned = setup.pinned;
    st.collapsedGroups = [...setup.collapsedGroups];
    st.coverageRow = setup.coverageRow;
    normalizeColumns(type, st);
}

/** The setup a row type's default view gives (until part D keeps the view's own). */
export function defaultColumnSetup(type: RowType): ColumnSetup {
    return columnSetupOf(defaultTypeState(type));
}

/** "Reset to default" (§4.4): the columns back to the view's stored setup. */
export function resetColumns(type: RowType, st: RowTypeState, base: ColumnSetup = st.base ?? defaultColumnSetup(type)): void {
    applyColumnSetup(type, st, base);
}

// ---------------------------------------------------------------------------
// Sorting (§8.4): the header menu (§4.6) and the head's click.

/** "Sort ascending / descending": this column alone. */
export function sortOnly(st: RowTypeState, col: string, dir: SortSpec['dir']): void {
    st.sort = [{ col, dir }];
}

/** "Add to sort" (Shift + click): a further key; on a column already in the sort its direction flips. */
export function sortAdd(st: RowTypeState, col: string): void {
    const at = st.sort.find(s => s.col === col);
    if (at) at.dir = at.dir === 'asc' ? 'desc' : 'asc';
    else st.sort = [...st.sort, { col, dir: 'asc' }];
}

/** A click on a column's head (§8.4): ascending → descending → off; the column alone. */
export function sortClick(st: RowTypeState, col: string): void {
    const cur = st.sort.length === 1 && st.sort[0].col === col ? st.sort[0] : null;
    const next = !cur ? 'asc' : cur.dir === 'asc' ? 'desc' : null;
    st.sort = next ? [{ col, dir: next }] : [];
}

/** Shift + click (§8.4): adds the column, then changes its direction, then takes it out of the sort. */
export function sortShiftClick(st: RowTypeState, col: string): void {
    const at = st.sort.findIndex(s => s.col === col);
    if (at < 0) st.sort = [...st.sort, { col, dir: 'asc' }];
    else if (st.sort[at].dir === 'asc') st.sort = st.sort.map((s, i) => (i === at ? { col, dir: 'desc' } : s));
    else st.sort = st.sort.filter((_s, i) => i !== at);
}

/** After a change of the filter: the unions shown on request are hidden again (§3.3). */
export function filterChanged(st: RowTypeState): void {
    st.revealedUnions = [];
}
