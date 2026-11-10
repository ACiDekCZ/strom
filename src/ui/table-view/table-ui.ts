/**
 * Table view (spec 073): the view in the app — the mixin the renderer calls.
 *
 * Joins the model (table-model.ts), the column catalog, the bar and the
 * grid. The rows are rebuilt only when the data revision, the data object,
 * the home person or the language change; the state of each row type
 * (columns, widths, pinning, sort, scroll, selected row) is kept per tree
 * while the app is open (§2: switching the row type loses nothing). The
 * table runs no layout and never changes the diagram's selection of people.
 *
 * The column work (§4.3–§4.6) changes the row type's state here: the
 * Columns panel (table-colpanel.ts), the head's drags and keys and its menu
 * (table-grid.ts, table-headmenu.ts); each change draws the table again.
 *
 * The findings of Data quality (§7) are computed after the table is first
 * drawn, in idle time (table-checks.ts maps them to the cells); until then
 * the Findings cells show "…" and the status line says the checks run. A
 * change of the tree computes them again while the last ones stay shown. A
 * click on a finding's cell opens its bubble (table-bubble.ts); "Not an
 * error" there marks it as Data quality does, with the same toast and Undo.
 */

import { DataManager } from '../../data.js';
import { TreeManager } from '../../tree-manager.js';
import { TreeRenderer } from '../../renderer.js';
import { isPhoneBar } from '../../breakpoints.js';
import { strings, getCurrentLanguage, type Language } from '../../strings.js';
import { uiModule } from '../module.js';
import { cellOf, columnById, columnLabel, columnNote, dateCell, eventPersons, eventTypeLabel, type SortSpec } from './table-columns.js';
import {
    CHECK_CHIPS, chipItem, clearFilter, columnItem, filterRows, filterSummary, isChipItem, removeColumnFilter, searchQuery, setChip, setParticipantFilter,
    setColumnFilter, setEmptyFilter, sortRows, columnItemActive, type ChipId, type FilterResult, type TableFilter,
} from './table-filter.js';
import {
    chipChoiceForm, closeFilterPanel, columnFilterForm, FilterBar, FilterSheet, openFilterPanel, type FilterBarState, type PanelOptions,
} from './table-filterbar.js';
import {
    buildTableModel, modelIsCurrent, ROW_KEY, ROW_TYPES, rowCounts, rowKey, rowPersonId, rowsOf,
    type CellName, type EventRow, type RowType, type SourceRow, type TableModel, type TableRow,
} from './table-model.js';
import { eventEditTarget } from './table-events.js';
import { TableGrid, type RowAction } from './table-grid.js';
import { createBar, createStatus, updateBar, updateStatus } from './table-bar.js';
import {
    canMoveColumn, canPinColumn, catalogColumns, displayColumns, hideColumn, lockedColumn, moveColumnBy, moveColumnRun, moveColumnTo,
    filterChanged, normalizeColumns, pinColumn, resetColumns, setColumnWidth, setGroupCollapsed, setGroupShown, showColumn, sortAdd, sortClick,
    columnSetupOf, shownColumns, sortOnly, sortShiftClick, tableStateFor, unpinColumn, type DisplayColumns, type RowTypeState, type TableState,
} from './table-state.js';
import { ColumnPanel } from './table-colpanel.js';
import {
    anyExpanded, buildLines, coverageUnionsOf, hasMultiUnions, setAllExpanded, setExpanded, sortUnionOf, type UnionPredicate,
} from './table-subrows.js';
import { columnCoverage, coverageCell, coverageLabel, type CoverageCell } from './table-coverage.js';
import type { ColumnDef } from './table-columns.js';
import { closeHeadMenu, headMenuItems, openHeadMenu, SEP, type HeadMenuItem, type MenuEntry } from './table-headmenu.js';
import { issueCategory, translateValidationType, validateTreeData, type ValidationIssue } from '../../validation.js';
import { dismissalFor, dismissalKey } from '../../quality-dismiss.js';
import { QUALITY_CHANGED_EVENT } from '../quality-ui.js';
import type { Partnership, PartnershipId, PersonId, StromData, TableView, TreeId } from '../../types.js';
import {
    discardViewChanges, dropMissingViews, isBuiltinId, newViewId, openViewOf, readTableWork, restoreTableState, switchView,
    tableWorkOf, takenViewNames, uniqueViewName, viewChanged, viewFromState, viewList, writeTableWork,
} from './table-views.js';
import { ExportSummary, exportForm, ViewBar, viewNameForm } from './table-viewbar.js';
import { buildTableCsv, tableCsvFileName, type TableCsv } from './table-export.js';
import { applyChecks, bandSeverity, CHECK_COLUMNS, CheckIndex, isPlaceColumn, type CellFinding } from './table-checks.js';
import { lineCell, lineKey, type GridLine } from './table-subrows.js';
import { markHtml, type CellIssueMark } from './table-grid.js';
import { bubbleHeading, bubbleHtml, citesHtml, closeTableBubble, legendHtml, openBubblePanel, sheetElement, type BubbleCite } from './table-bubble.js';
import { bridgeChanges, changedKeys, familyKeys, keepOrder, namesList, rowKeysFor, watchEdit } from './table-refresh.js';
import type { DataChangedDetail } from '../../data.js';
import { isCoarsePointer } from '../bottom-sheet.js';
import { ZoomPan } from '../../zoom.js';
import { fanYears } from '../../fan-labels.js';
import { shownNameOrEmpty as personName } from '../../person-name.js';
import { emptyStateHtml } from '../empty-state.js';
import { tableEmptyState, type TableEmptyState } from './table-empty.js';

interface Mounted {
    container: HTMLElement;
    lang: Language;
    bar: HTMLElement;
    grid: TableGrid;
    status: HTMLElement;
    /** The bar's Columns button (§4.4). */
    colsBtn: HTMLButtonElement;
    /** Tree and row type last drawn: a change restores that type's scroll. */
    drawn: string;
    /** The columns as last drawn (maps drawn positions to the state's). */
    display: DisplayColumns | null;
    /** Search and the filter's chips (§8). */
    filters: FilterBar;
    /** The filter's state as last drawn (the phone's sheet follows it). */
    filterState: FilterBarState | null;
    /** The view picker (§9.2). */
    views: ViewBar;
    /** The bar's Export button (§11.1). */
    exportBtn: HTMLButtonElement;
    /** The state drawn in place of the grid (§13a, 13e–13g). */
    empty: HTMLElement;
    /** Its kind as last drawn (the content changes only with it). */
    emptyKey: string;
    /** What the phone's ⋯ offers for unions (§3.2): expand, collapse or nothing. */
    unionsButton: 'expand' | 'collapse' | null;
}

/** The phone's Filters sheet while it is open (8h). */
let filterSheet: { sheet: FilterSheet; overlay: HTMLElement } | null = null;

/** The open Columns panel; on a phone it sits in a sheet (`overlay`). */
let panel: { panel: ColumnPanel; overlay: HTMLElement | null } | null = null;

let model: TableModel | null = null;

/** The rows shown: filtered and sorted, or kept in place after a change (§10.3) with those that no longer pass. */
interface ShownRows extends FilterResult {
    stale: ReadonlySet<string>;
}
const NONE: ReadonlySet<string> = new Set();
/**
 * The rows last shown: for the tree, the model, the row type, what the user
 * set (filter, search, sort) and the findings it reads. `kept`: in their
 * place since a change of the data (§10.3), until the user sets something.
 */
let view: { tree: string; model: TableModel; type: RowType; key: string; checks: number; kept: boolean; result: ShownRows } | null = null;

/** An edit opened from the table (§10.3): what it edits (the toast's name) and the records the edit may change, as stored before. */
let watching: { tree: string; name: () => string; keys: Map<string, string> } | null = null;

/** A person's name for "Saved: {name}", read when the edit is saved. */
function personNameOf(personId: PersonId): () => string {
    return () => {
        const p = DataManager.getPerson(personId);
        return p ? personName(p) : '';
    };
}
/** Records changed (entity keys) whose rows light up at the next draw (§10.3). */
let flashNext: { tree: string; keys: readonly string[] } | null = null;
const BRIDGE_TOAST_MS = 8000;
let mounted: Mounted | null = null;
/** The coverage row's cells (§6.1) for the rows last drawn; computed when a column is first drawn. */
let coverage: { rows: readonly TableRow[]; cells: Map<string, CoverageCell> } | null = null;

function coverageOf(m: TableModel, type: RowType, rows: readonly TableRow[], col: ColumnDef, pass: UnionPredicate | null): CoverageCell {
    if (col.id === lockedColumn(type)) return coverageLabel();
    if (!coverage || coverage.rows !== rows) coverage = { rows, cells: new Map() };
    let cell = coverage.cells.get(col.id);
    if (!cell) {
        cell = coverageCell(columnCoverage(m, rows, col, coverageUnionsOf(pass)));
        coverage.cells.set(col.id, cell);
    }
    return cell;
}

/**
 * The findings of the tree last drawn (§7.1): the data object and revision
 * they are for, the index shown (the last one while new ones are computed;
 * null before the first) and whether a computation runs.
 */
let checks: { tree: string; data: StromData; rev: number; issues: ValidationIssue[] | null; index: CheckIndex | null; running: boolean } | null = null;
let checksJob = 0;
/** Findings mapped per idle slice (§7.1). */
const CHECK_BATCH = 500;
const DISMISS_TOAST_MS = 6000;

function whenIdle(fn: (deadline: { timeRemaining(): number } | null) => void): void {
    const ric = (window as Window & { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
    if (ric) ric(d => fn(d), { timeout: 400 });
    else setTimeout(() => fn(null), 1);
}

/** The table listens for marks changed elsewhere (Data quality, the research's bridge, an undo). */
let listening = false;
let redrawFrame = 0;

/** The table on screen, drawn again (after the checks finish or a finding is marked). */
function redrawTable(draw: (el: HTMLElement) => void): void {
    const el = document.getElementById('table-container');
    if (el && TreeRenderer.getViewMode() === 'table') draw(el);
}

/** The union a line reads in a union column of the People table (none for a "more" line or the Unions table). */
function lineUnion(line: GridLine): Partnership | null {
    if (line.kind === 'more' || line.row.kind !== 'person' || line.union === null) return null;
    return line.row.unions[line.union] ?? null;
}

/** The findings of a line's cell: its union for a union column of the People table, the value of a place cell. */
function cellFindings(index: CheckIndex, m: TableModel, line: GridLine, col: ColumnDef): CellFinding[] {
    if (line.kind === 'more') return [];
    const row = line.row;
    const union = col.unionScoped ? lineUnion(line) : null;
    const text = isPlaceColumn(col.id) ? lineCell(m, line, col).text : '';
    return index.cellAll(row, col.id, union, text);
}

function treeKey(): string {
    return DataManager.getCurrentTreeId() ?? '';
}

function storedViews(): readonly TableView[] | undefined {
    return DataManager.getData().tableViews;
}

/** The tree's table state; the first time, as the tree's table was left (§9.1, localStorage). */
function stateOf(tree: string): TableState {
    const state = tableStateFor(tree);
    if (!state.restored) restoreTableState(state, tree ? readTableWork(tree) : null, storedViews());
    return state;
}

/** The working state last written, so a draw writes only a change. */
let keptWork = '';

/** Keep the tree's table for the next visit (§9.1); a read-only tree's views are for this opening only. */
function keepWork(tree: string, state: TableState): void {
    if (!tree || DataManager.isReadOnly()) return;
    const work = tableWorkOf(state, storedViews());
    const key = `${tree}|${JSON.stringify(work)}`;
    if (key === keptWork) return;
    keptWork = key;
    writeTableWork(tree, work);
}

/**
 * The rows shown (§8): filtered and searched, then sorted (a union column by
 * each person's first passing union, §3.3). Kept while the model, the row
 * type, the filter, the search (and the columns it looks in) and the sort
 * stay; sorted or filtered by the findings, again when they change (else the
 * order stays, §13i).
 */
function viewRows(
    tree: string, m: TableModel, type: RowType, filter: TableFilter, search: string, sort: readonly SortSpec[], columns: readonly ColumnDef[],
): ShownRows {
    const q = searchQuery(search);
    const byChecks = sort.some(s => CHECK_COLUMNS.includes(s.col))
        || filter.items.some(i => isChipItem(i) && CHECK_CHIPS.includes(i.chip));
    const key = JSON.stringify([filter, q, q ? columns.map(c => c.id) : 0, sort]);
    const checksVersion = byChecks ? m.ctx.checks?.version ?? 0 : 0;
    const last = view && view.tree === tree && view.type === type && view.key === key ? view : null;
    if (last && last.model === m && last.checks === checksVersion) return last.result;
    const f = filterRows(m, type, rowsOf(m, type), filter, q ? { query: q, columns } : undefined);
    const rows = sort.length ? sortRows(m, type, f.rows, sort, f.pass ? sortUnionOf(f.pass) : undefined) : f.rows;
    // §10.3: after a change of the data the rows stay in place, those that no longer
    // pass dimmed, until the sort, the filter or the view change.
    const kept = last && (last.model.rev !== m.rev || last.kept) ? keepOrder(m, last.result.rows, rows) : null;
    const result: ShownRows = kept ? { rows: kept.rows, pass: f.pass, stale: kept.stale } : { rows, pass: f.pass, stale: NONE };
    view = { tree, model: m, type, key, checks: checksVersion, kept: !!kept, result };
    return result;
}

/** The row's person (a union row: its first partner). */
function personOfRow(row: TableRow): PersonId | null {
    return rowPersonId(row);
}

/** The union a line stands for, when its edit is the relationships panel (§10.1): a sub-row's, a union row's. */
function unionOfLine(line: GridLine): PartnershipId | null {
    if (line.row.kind === 'union') return line.row.id;
    if (line.kind === 'sub') return line.row.unions[line.union]?.id ?? null;
    return null;
}

function escHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** No edits here (13j): a read-only page or a locked tree. */
function tableReadOnly(): boolean {
    return DataManager.isReadOnly() || DataManager.isTreeLocked();
}

export const tableMethods = uiModule({
    /** Draw the Table view into its container. Called by the renderer whenever the table is on. */
    renderTableView(container: HTMLElement): void {
        const data = DataManager.getData();
        const lang = getCurrentLanguage();
        const homeId = TreeRenderer.getFocusPersonId();
        const rev = DataManager.getRevision();
        if (!modelIsCurrent(model, data, rev, homeId, lang)) {
            model = buildTableModel(data, { rev, homeId, lang, reliability: this.reliabilityOptionsNow() });
        }
        const m = model;
        const tree = treeKey();
        const index = this.tableChecksFor(tree, data, rev);
        applyChecks(m, index);
        const state = stateOf(tree);
        // An undo or a delete took the open view away: back to the default one (§9.3).
        dropMissingViews(state, data.tableViews);
        const type = state.rowType;
        const st = state.types[type];

        if (!mounted || mounted.container !== container || mounted.lang !== lang || !container.contains(mounted.grid.el)) {
            this.closeTableColumns(false);
            this.closeTableFilters();
            closeHeadMenu();
            closeFilterPanel();
            mounted?.grid.destroy();
            mounted?.filters.destroy();
            container.innerHTML = '';
            const bar = createBar({
                onRowType: (t) => this.setTableRowType(t),
                onRowTypeSheet: () => this.showTableRowTypeSheet(),
                onMoreMenu: () => this.showTableMoreMenu(),
            });
            const grid = new TableGrid({
                onScroll: (top, left) => {
                    const s = stateOf(treeKey());
                    s.types[s.rowType].top = top;
                    s.types[s.rowType].left = left;
                },
                onSelect: (key) => {
                    const s = stateOf(treeKey());
                    s.types[s.rowType].selected = key;
                    this.renderTableView(container);
                },
                onRowClick: (line) => { if (isPhoneBar() || isCoarsePointer()) this.showTableRowSheet(line); },
                // §6.2 by touch: the completeness bubble on a tap of its cell (a mouse has its title).
                onComp: (line, col, cell) => {
                    if (!isPhoneBar() && !isCoarsePointer()) return false;
                    this.showTableCompleteness(line, col, cell);
                    return true;
                },
                onRowAction: (action, line) => this.tableRowAction(action, line),
                onName: (line, _col, name, anchor) => this.tableNameAction(line, name, anchor),
                onMoreCites: (_line, _col, ids, anchor) => this.showTableCites(ids, anchor),
                onRowMenu: (line, anchor) => this.showTableRowMenu(line, anchor),
                onIssue: (line, col, cell) => this.showTableFinding(line, col, cell),
                onToggleUnions: (personId, expand) => this.changeTableColumns(st => setExpanded(st.unions, personId, expand)),
                onAllUnions: (expand) => this.changeTableColumns(st => setAllExpanded(st.unions, expand)),
                onRevealUnions: (personId) => this.changeTableColumns(st => {
                    if (st.revealedUnions.includes(personId)) return false;
                    st.revealedUnions = [...st.revealedUnions, personId];
                    return true;
                }),
                onToggleGroup: (group, collapse) => this.changeTableColumns(st => setGroupCollapsed(st, group, collapse)),
                onHeadMenu: (colId, anchor) => this.showTableHeadMenu(colId, anchor),
                onHeadSort: (colId, add) => this.changeTableColumns(st => (add ? sortShiftClick(st, colId) : sortClick(st, colId))),
                onCoverageCell: (colId, anchor) => this.showTableCoverageMenu(colId, anchor),
                // §13c: the search counts among what applies, so it goes too.
                onClearFilters: () => this.changeTableFilter((f, st) => {
                    const searched = st.search !== '';
                    st.search = '';
                    return clearFilter(f) || searched;
                }, true),
                onResize: (colId, width) => this.changeTableColumns(st => setColumnWidth(st, colId, width)),
                onMoveColumn: (colId, offset) => this.changeTableColumns((st, t) => moveColumnBy(t, st, colId, offset)),
                onMoveGroup: (start, end, before) => this.changeTableColumns((st, t) => {
                    const d = mounted?.display;
                    if (!d) return false;
                    const to = before < d.starts.length ? d.starts[before] : st.columns.length;
                    return moveColumnRun(t, st, d.starts[start], d.ends[end], to);
                }),
            });
            if (!listening) {
                listening = true;
                // A mark set in Data quality or by the research, an undo: drawn again once per frame.
                const later = (): void => {
                    if (redrawFrame) return;
                    redrawFrame = requestAnimationFrame(() => { redrawFrame = 0; redrawTable(el => this.renderTableView(el)); });
                };
                window.addEventListener(QUALITY_CHANGED_EVENT, later);
                window.addEventListener('strom:user-change', () => {
                    this.tableEditSaved();
                    later();
                });
                // A load from the research's bridge (§10.3, 10d): its changed rows lit, a toast with Show.
                window.addEventListener('strom:data-changed', (e) => {
                    const detail = (e as CustomEvent<DataChangedDetail | undefined>).detail;
                    if (detail?.source === 'live' && this.tableBridgeChanged(detail.previous)) later();
                });
            }
            const status = createStatus();
            const legendBtn = status.querySelector<HTMLButtonElement>('.tv-legend-btn')!;
            legendBtn.addEventListener('click', () => this.showTableLegend(legendBtn));
            const colsBtn = document.createElement('button');
            colsBtn.type = 'button';
            colsBtn.className = 'tv-cols-btn';
            colsBtn.setAttribute('aria-haspopup', 'dialog');
            colsBtn.setAttribute('aria-expanded', 'false');
            colsBtn.addEventListener('click', () => (panel ? this.closeTableColumns(true) : this.showTableColumns()));
            bar.querySelector('.tv-slot-cols')!.appendChild(colsBtn);
            const filters = new FilterBar(bar, {
                onSearch: (text) => this.changeTableFilter((_f, st) => {
                    if (st.search === text) return false;
                    const was = searchQuery(st.search);
                    st.search = text;
                    // Below two letters the search does nothing: no new draw.
                    return was !== searchQuery(text);
                }),
                onChip: (chip, on) => this.changeTableFilter(f => setChip(f, chip, on)),
                onChoiceChip: (chip, anchor) => this.showTableChipChoice(chip, anchor),
                onEditColumn: (col, anchor) => this.showTableColumnFilter(col, anchor),
                onRemoveColumn: (col) => this.changeTableFilter(f => removeColumnFilter(f, col)),
                onClear: () => this.changeTableFilter(f => clearFilter(f), true),
                onSheet: () => this.showTableFilters(),
            });
            const views = new ViewBar(bar.querySelector<HTMLElement>('.tv-slot-view')!, {
                onList: () => this.showTableViewList(),
                onSave: () => this.saveOpenTableView(),
                onSaveAs: (anchor) => this.saveTableViewAs(anchor),
                onDiscard: () => this.discardTableViewChanges(),
                onBuiltinNote: (anchor) => this.showTableBuiltinNote(anchor),
            });
            const exportBtn = document.createElement('button');
            exportBtn.type = 'button';
            exportBtn.className = 'tv-export-btn';
            exportBtn.setAttribute('aria-haspopup', 'dialog');
            exportBtn.innerHTML = `${strings.table.export}<span class="tv-export-caret" aria-hidden="true">▾</span>`;
            exportBtn.addEventListener('click', () => this.showTableExport());
            bar.querySelector('.tv-slot-export')!.appendChild(exportBtn);
            const empty = document.createElement('div');
            empty.className = 'tv-empty';
            empty.hidden = true;
            empty.addEventListener('click', (e) => {
                const act = (e.target as Element).closest<HTMLElement>('[data-empty-act]')?.dataset.emptyAct;
                if (act === 'add') this.showAddPersonModal();
                else if (act === 'quality') void this.showTreeValidationDialog(treeKey() as TreeId);
            });
            container.append(bar, grid.el, empty, status);
            mounted = {
                container, lang, bar, grid, status, colsBtn, drawn: '', display: null, filters, filterState: null, views, exportBtn,
                empty, emptyKey: '', unionsButton: null,
            };
        }

        const counts = rowCounts(m);
        const phone = isPhoneBar();
        normalizeColumns(type, st);
        const display = displayColumns(type, st, phone);
        mounted.display = display;
        const { rows, pass, stale } = viewRows(tree, m, type, st.filter, st.search, st.sort, display.columns);
        const persons = type === 'persons';
        const lines = persons ? buildLines(rows, { collapse: st.unions, pass, revealed: new Set(st.revealedUnions) }) : undefined;
        const unionsButton = persons && hasMultiUnions(rows) ? (anyExpanded(st.unions, rows) ? 'collapse' : 'expand') : null;
        const summary = filterSummary(m, type, st.filter, st.search);
        const filterState: FilterBarState = {
            model: m, type, filter: st.filter, search: st.search, shown: rows.length, checking: !index || !!checks?.running, phone,
        };
        mounted.filterState = filterState;
        mounted.filters.update(filterState);
        filterSheet?.sheet.update(filterState);
        const total = catalogColumns(type).length;
        mounted.colsBtn.innerHTML = `<span class="tv-cols-label">${strings.table.columns}</span>`
            + `<span class="tv-cols-count" aria-hidden="true">${st.columns.length}</span>`;
        mounted.colsBtn.setAttribute('aria-label', `${strings.table.columns}, ${strings.table.columnsCount(st.columns.length, total)}`);
        container.dataset.rowtype = type;
        updateBar(mounted.bar, type, counts);
        updateStatus(mounted.status, type, rows.length, counts[type], st.sort, !!checks?.running, tableReadOnly());
        mounted.unionsButton = unionsButton;
        const openView = openViewOf(state, type, data.tableViews);
        this.drawTableEmpty(tableEmptyState({
            persons: counts.persons, unions: counts.unions, events: counts.events, sources: counts.sources, type, viewId: openView.id, viewChanged: viewChanged(openView, st),
            search: st.search, shown: rows.length, checksDone: !!index && !checks?.running,
            leads: index ? index.issues.filter(i => i.severity === 'info').length : 0,
            allComplete: () => {
                const comp = columnById('persons', 'comp');
                return !!comp && rows.every(r => { const c = cellOf(m, r, comp); return c.na || c.percent === 100; });
            },
            readOnly: tableReadOnly(),
        }));
        const drawn = `${tree}|${type}`;
        const restore = mounted.drawn !== drawn ? { top: st.top, left: st.left } : undefined;
        mounted.drawn = drawn;
        mounted.grid.setInput({
            model: m, type, rows, columns: display.columns, widths: display.widths, pinned: display.pinned, sort: st.sort, homeId,
            bands: display.bands, coverageRow: st.coverageRow, editableHead: !phone,
            hit: searchQuery(st.search),
            filtered: new Set(st.filter.items.filter((i): i is Exclude<typeof i, { chip: ChipId }> => !isChipItem(i) && columnItemActive(i)).map(i => i.col)),
            noMatch: !rows.length && summary
                ? { title: strings.table.noMatch, text: strings.table.applies(summary), action: strings.table.clearFilters }
                : null,
            lines, subRows: persons, unionsButton, stale,
            actions: phone ? null : { edit: !tableReadOnly() },
            coverage: st.coverageRow ? (col) => coverageOf(m, type, rows, col, pass) : undefined,
            selected: st.selected,
            label: `${strings.viewModeSwitch.table} – ${strings.table.rows[type]}`,
            issueAt: index ? (line, col): CellIssueMark | null => {
                const f = cellFindings(index, m, line, col)[0];
                return f ? { severity: f.severity, label: translateValidationType(f.issue.type) } : null;
            } : undefined,
            bandCell: index ? (line, band) => {
                const row = line.row;
                const union = lineUnion(line);
                const sev = bandSeverity(index, row, band.columns.map(c => c.id),
                    id => (columnById(type, id)?.unionScoped ? union : null),
                    id => { const c = columnById(type, id); return c ? lineCell(m, line, c).text : ''; });
                return sev ? markHtml(sev) : '';
            } : undefined,
        }, restore);
        if (flashNext) {
            const lit = flashNext.tree === tree ? rowKeysFor(data, type, flashNext.keys, type === 'events' ? m.events : undefined) : null;
            flashNext = null;
            if (lit?.size) mounted.grid.flash(lit);
        }
        panel?.panel.update(type, st);
        const open = openViewOf(state, type, data.tableViews);
        mounted.views.update({
            name: open.name, builtin: isBuiltinId(open.id), changed: viewChanged(open, st), readOnly: DataManager.isReadOnly(),
        });
        keepWork(tree, state);
    },

    /**
     * The findings to show for the tree's data now (§7.1). Computed once per
     * data object and revision, after this draw, in idle time: the tree is
     * checked in one go, its findings mapped to the cells CHECK_BATCH at a
     * time; then the table is drawn again. Meanwhile the last findings of the
     * same tree stay shown (null before the first: the cells show "…").
     */
    tableChecksFor(tree: string, data: StromData, rev: number): CheckIndex | null {
        if (checks && checks.data === data && checks.rev === rev) return checks.index;
        const stale = checks && checks.tree === tree ? checks.index : null;
        const job = ++checksJob;
        const state = { tree, data, rev, issues: null as ValidationIssue[] | null, index: stale, running: true };
        checks = state;
        whenIdle(() => {
            if (job !== checksJob) return;
            const issues = validateTreeData(data).issues;
            const index = new CheckIndex(data);
            let at = 0;
            const step = (deadline: { timeRemaining(): number } | null): void => {
                if (job !== checksJob) return;
                do {
                    index.add(issues.slice(at, at + CHECK_BATCH));
                    at += CHECK_BATCH;
                } while (at < issues.length && deadline && deadline.timeRemaining() > 4);
                if (at < issues.length) { whenIdle(step); return; }
                state.issues = issues;
                state.index = index;
                state.running = false;
                redrawTable(el => this.renderTableView(el));
            };
            step(null);
        });
        return stale;
    },

    /** After a finding was marked or its mark taken back: the same findings, mapped again with the tree's marks now. */
    remapTableChecks(): void {
        const data = DataManager.getData();
        if (checks?.issues && checks.data === data) {
            // A computation started meanwhile (an event of the same change) is not needed.
            checksJob++;
            const index = new CheckIndex(data);
            index.add(checks.issues);
            checks = { ...checks, rev: DataManager.getRevision(), index, running: false };
        }
        redrawTable(el => this.renderTableView(el));
    },

    /** A finding's cell was clicked or Enter pressed on it (§7.4): the row selected, the bubble opened. */
    showTableFinding(line: GridLine, colPos: number, cell: HTMLElement): void {
        const m = model;
        const index = checks?.index;
        const col = mounted?.display?.columns[colPos];
        if (!m || !index || !col || !mounted) return;
        const list = cellFindings(index, m, line, col);
        if (!list.length) return;
        const rect = cell.getBoundingClientRect();
        const treeId = treeKey();
        const readOnly = this.treeValidationReadOnly(treeId);
        const container = mounted.container;
        const s = stateOf(treeId);
        const key = rowKey(line.row);
        if (s.types[s.rowType].selected !== key) {
            s.types[s.rowType].selected = key;
            this.renderTableView(container);
        }
        const grid = mounted.grid;
        const cellKey = lineKey(line);
        const findCell = (): HTMLElement | null => [...grid.el.querySelectorAll<HTMLElement>('.tv-row[data-key]')]
            .find(r => r.dataset.key === cellKey)?.querySelector<HTMLElement>(`[aria-colindex="${colPos + 1}"]`) ?? null;
        const shown = list.map(f => ({
            severity: f.severity, title: translateValidationType(f.issue.type), detail: f.issue.detail ?? '',
        }));
        const act = (what: string, i: number): void => {
            const f = list[i];
            if (!f) return;
            if (what === 'dismiss') this.dismissTableFinding(f, treeId);
            else if (what === 'restore') this.restoreTableFinding(f, treeId);
            else if (what === 'quality') {
                void this.showTreeValidationDialog(treeId, undefined, {
                    focus: { type: f.issue.type, category: issueCategory(f.issue), dismissed: f.dismissed },
                });
            }
        };
        const title = bubbleHeading(list[0].severity);
        if (isPhoneBar()) {
            this.showTableSheet(sheetElement(title, bubbleHtml(shown, readOnly, true), 'finding', () => this.hideBottomSheet(), act));
            return;
        }
        openBubblePanel({
            rect, label: `${title}: ${shown[0].title}`, html: bubbleHtml(shown, readOnly, false), kind: 'finding',
            focusBack: findCell, scroller: grid.el, onAction: act,
        });
    },

    /** "Not an error" in a finding's bubble (§7.5): marked as Data quality marks it, a toast with Undo. */
    dismissTableFinding(f: CellFinding, treeId: string): void {
        if (this.treeValidationReadOnly(treeId)) return;
        const mark = dismissalFor(f.issue);
        const label = this.qualityMarkLabel(mark, DataManager.getData());
        if (!DataManager.dismissQualityFinding(mark, label)) return;
        this.qualityMarksChanged();
        this.remapTableChecks();
        const key = dismissalKey(mark);
        this.showToast(strings.table.dismissedToast, DISMISS_TOAST_MS, {
            kind: 'quality-dismiss',
            action: {
                label: strings.treeManager.valUndo,
                run: () => {
                    if (treeKey() !== treeId || DataManager.isReadOnly()) return;
                    if (DataManager.restoreQualityDismissal(key, label)) {
                        this.qualityMarksChanged();
                        this.remapTableChecks();
                    }
                },
            },
        });
    },

    /** "Report again" on a finding marked "Not an error". */
    restoreTableFinding(f: CellFinding, treeId: string): void {
        if (this.treeValidationReadOnly(treeId)) return;
        const data = DataManager.getData();
        const mark = (data.qualityDismissed ?? []).find(d => dismissalKey(d) === f.key);
        if (!mark) return;
        if (DataManager.restoreQualityDismissal(f.key, this.qualityMarkLabel(mark, data))) {
            this.qualityMarksChanged();
            this.remapTableChecks();
        }
    },

    /** "Marks ⓘ" in the status line (§7.3): what each mark and the other cell states mean. */
    showTableLegend(btn: HTMLElement): void {
        const title = strings.table.legendTitle;
        if (isPhoneBar()) {
            this.showTableSheet(sheetElement(title, legendHtml(), 'legend', () => this.hideBottomSheet()));
            return;
        }
        openBubblePanel({
            rect: btn.getBoundingClientRect(), label: title, kind: 'legend', focusBack: () => btn,
            html: `<div class="tv-bub-title">${title}</div>${legendHtml()}`,
        });
    },

    /** A bubble's content in a sheet from the bottom (a phone). */
    showTableSheet(el: HTMLElement): void {
        closeTableBubble(false);
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay tv-bubble-overlay';
        overlay.appendChild(el);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hideBottomSheet(); });
        overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.hideBottomSheet(); } });
        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        requestAnimationFrame(() => overlay.classList.add('active'));
        (el.querySelector<HTMLElement>('.tv-bub-sheet-body button') ?? el.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    },

    /** Change the shown row type's columns (§4.3–§4.6) and draw again when something changed. */
    changeTableColumns(change: (st: RowTypeState, type: RowType) => boolean | void): void {
        const state = stateOf(treeKey());
        const st = state.types[state.rowType];
        if (change(st, state.rowType) === false) return;
        const el = document.getElementById('table-container');
        if (el && TreeRenderer.getViewMode() === 'table') this.renderTableView(el);
    },

    /** The Columns panel (§4.4): at the right over the grid; on a phone a sheet from the bottom. */
    showTableColumns(): void {
        if (!mounted || panel) return;
        closeHeadMenu();
        const phone = isPhoneBar();
        const state = stateOf(treeKey());
        const p = new ColumnPanel(state.rowType, state.types[state.rowType], phone, {
            onShow: (id, on) => this.changeTableColumns((st, t) => (on ? showColumn(t, st, id) : hideColumn(t, st, id))),
            onGroupShown: (group, on) => this.changeTableColumns((st, t) => setGroupShown(t, st, group, on)),
            onMove: (id, dir) => this.changeTableColumns((st, t) => moveColumnBy(t, st, id, dir)),
            onMoveTo: (id, target) => this.changeTableColumns((st, t) => moveColumnTo(t, st, id, target)),
            onCollapse: (group, collapsed) => this.changeTableColumns(st => setGroupCollapsed(st, group, collapsed)),
            onCoverage: (on) => this.changeTableColumns(st => { if (st.coverageRow === on) return false; st.coverageRow = on; return true; }),
            onReset: () => this.changeTableColumns((st, t) => resetColumns(t, st)),
            onClose: () => this.closeTableColumns(true),
        });
        if (phone) {
            this.noteBottomSheetTrigger();
            this.hideBottomSheet();
            const overlay = document.createElement('div');
            overlay.className = 'bottom-sheet-overlay tv-colpanel-overlay';
            overlay.appendChild(p.el);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeTableColumns(true); });
            document.body.appendChild(overlay);
            this.bottomSheet = overlay;
            this.bottomSheetOnClose = () => { if (panel?.overlay === overlay) { panel = null; mounted?.colsBtn.setAttribute('aria-expanded', 'false'); } };
            panel = { panel: p, overlay };
            requestAnimationFrame(() => overlay.classList.add('active'));
        } else {
            mounted.container.appendChild(p.el);
            panel = { panel: p, overlay: null };
        }
        mounted.colsBtn.setAttribute('aria-expanded', 'true');
        p.focusFirst();
    },

    /** Close the Columns panel; `focusBack` returns the focus to the Columns button. */
    closeTableColumns(focusBack: boolean): void {
        if (!panel) return;
        const open = panel;
        panel = null;
        mounted?.colsBtn.setAttribute('aria-expanded', 'false');
        if (open.overlay) {
            // The sheet's close hands the focus back to what opened it.
            if (this.bottomSheet === open.overlay) this.hideBottomSheet();
            else open.overlay.remove();
            return;
        }
        open.panel.el.remove();
        if (focusBack && mounted?.colsBtn.isConnected) mounted.colsBtn.focus({ preventScroll: true });
    },

    /** The header menu of a column (§4.6): a menu under the head cell, on a phone a sheet. */
    showTableHeadMenu(colId: string, anchor: HTMLElement): void {
        const state = stateOf(treeKey());
        const type = state.rowType;
        const st = state.types[type];
        const col = columnById(type, colId);
        if (!col || !mounted) return;
        const phone = isPhoneBar();
        const at = st.columns.indexOf(colId);
        const change = (fn: (st: RowTypeState, t: RowType) => boolean | void) => () => this.changeTableColumns(fn);
        const entries = headMenuItems({
            pinned: at >= 0 && at < st.pinned,
            locked: colId === lockedColumn(type),
            canPin: canPinColumn(type, st, colId, mounted.grid.el.clientWidth, phone),
            canMoveLeft: canMoveColumn(type, st, colId, -1),
            canMoveRight: canMoveColumn(type, st, colId, 1),
            sortAsc: change(s => sortOnly(s, colId, 'asc')),
            sortDesc: change(s => sortOnly(s, colId, 'desc')),
            sortAdd: change(s => sortAdd(s, colId)),
            filter: {
                open: () => this.showTableColumnFilter(colId, anchor),
                onlyEmpty: () => this.changeTableFilter(f => setEmptyFilter(f, col, 'empty')),
                onlyFilled: () => this.changeTableFilter(f => setEmptyFilter(f, col, 'filled')),
            },
            pin: change((s, t) => pinColumn(t, s, colId)),
            unpin: change((s, t) => unpinColumn(t, s, colId)),
            move: (dir) => this.changeTableColumns((s, t) => moveColumnBy(t, s, colId, dir)),
            hide: change((s, t) => hideColumn(t, s, colId)),
        });
        const title = columnLabel(col);
        const note = columnNote(col);
        if (!phone) {
            openHeadMenu(anchor, title, note, entries);
            return;
        }
        // A phone: the same entries in a sheet (one block per part, nothing greyed out).
        const blocks: { rows: { label: string; run: () => void }[] }[] = [{ rows: [] }];
        for (const e of entries) {
            if (e === SEP) { blocks.push({ rows: [] }); continue; }
            const item: HeadMenuItem = e;
            if (!item.disabled) blocks[blocks.length - 1].rows.push({ label: item.label, run: item.run });
        }
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(title, blocks.filter(b => b.rows.length).map((b, i) => (i ? { ...b, divider: true } : b)), note ? { subtitle: note } : {});
    },

    /**
     * Change the shown row type's filter or search (§8) and draw again when
     * something changed; the unions shown on request are hidden again (§3.3).
     * `toTop`: the rows start from the top (Clear filters).
     */
    changeTableFilter(change: (filter: TableFilter, st: RowTypeState) => boolean | void, toTop = false): void {
        const state = stateOf(treeKey());
        const st = state.types[state.rowType];
        if (change(st.filter, st) === false) return;
        filterChanged(st);
        if (toTop) st.top = 0;
        const el = document.getElementById('table-container');
        if (el && TreeRenderer.getViewMode() === 'table') this.renderTableView(el);
    },

    /** A column's filter (8d): a panel under the head or its chip; on a phone a sheet. */
    showTableColumnFilter(colId: string, anchor: HTMLElement): void {
        if (!model) return;
        const state = stateOf(treeKey());
        const type = state.rowType;
        const col = columnById(type, colId);
        if (!col) return;
        const form = columnFilterForm(model, type, col, columnItem(state.types[type].filter, colId));
        const apply = (): void => this.changeTableFilter(f => setColumnFilter(f, form.read()));
        this.showTableFilterForm(anchor, columnLabel(col), form.el, apply);
    },

    /** The Family line or Generation chip's choice (8b). */
    showTableChipChoice(chip: ChipId, anchor: HTMLElement): void {
        if (!model) return;
        const state = stateOf(treeKey());
        const form = chipChoiceForm(model, chip, chipItem(state.types[state.rowType].filter, chip));
        const apply = (): void => this.changeTableFilter(f => {
            const choice = form.read();
            return setChip(f, chip, !!choice, choice ?? {});
        });
        this.showTableFilterForm(anchor, strings.table.chip[chip], form.el, apply);
    },

    /**
     * A filter's form: a panel on a computer and a tablet; a sheet with Cancel
     * · Apply on a phone. `opts` makes it the view name (§9.3) or Export (§11.1).
     */
    showTableFilterForm(anchor: HTMLElement, title: string, form: HTMLElement, apply: () => void, opts: PanelOptions = {}): void {
        closeHeadMenu();
        if (!isPhoneBar()) {
            openFilterPanel(anchor, title, form, apply, opts);
            return;
        }
        const t = strings.table;
        const el = document.createElement('div');
        el.className = 'tv-colpanel tv-colpanel--sheet bottom-sheet tv-fsheet' + (opts.cls ? ` ${opts.cls}` : '');
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-label', opts.ariaLabel ?? t.filterOf(title));
        const head = document.createElement('div');
        head.className = 'tv-cp-head';
        head.innerHTML = `<h2 class="tv-cp-title"></h2>`;
        head.querySelector('h2')!.textContent = title || opts.ariaLabel || '';
        const body = document.createElement('div');
        body.className = 'tv-cp-list tv-fs-body';
        body.appendChild(form);
        const foot = document.createElement('div');
        foot.className = 'tv-cp-foot';
        foot.innerHTML = '<button type="button" class="link-button tv-cp-reset tv-fs-cancel"></button><button type="button" class="primary tv-cp-done tv-fs-apply"></button>';
        foot.querySelector('.tv-fs-cancel')!.textContent = t.cancel;
        foot.querySelector('.tv-fs-apply')!.textContent = opts.applyLabel ?? t.apply;
        const done = (): void => {
            if (opts.validate && !opts.validate()) return;
            this.hideBottomSheet();
            apply();
        };
        foot.querySelector('.tv-fs-cancel')!.addEventListener('click', () => this.hideBottomSheet());
        foot.querySelector('.tv-fs-apply')!.addEventListener('click', done);
        if (opts.validate) {
            // The view name: Enter saves (§9.3).
            form.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.target as Element).matches('input')) { e.preventDefault(); done(); }
            });
        }
        el.append(head, body, foot);
        this.showTableSheet(el);
        const first = el.querySelector<HTMLElement>('input:not([type="checkbox"]), select, input');
        first?.focus({ preventScroll: true });
        if (opts.validate && first instanceof HTMLInputElement) first.select();
    },

    /** A coverage cell (§6.1): only empty / only filled as the column's filter. */
    showTableCoverageMenu(colId: string, anchor: HTMLElement): void {
        const state = stateOf(treeKey());
        const col = columnById(state.rowType, colId);
        if (!col) return;
        const t = strings.table;
        const empty = (): void => this.changeTableFilter(f => setEmptyFilter(f, col, 'empty'));
        const filled = (): void => this.changeTableFilter(f => setEmptyFilter(f, col, 'filled'));
        if (!isPhoneBar()) {
            openHeadMenu(anchor, columnLabel(col), '', [
                { id: 'onlyEmpty', label: t.onlyEmpty, icon: '', run: empty },
                { id: 'onlyFilled', label: t.onlyFilled, icon: '', run: filled },
            ]);
            return;
        }
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(columnLabel(col), [{ rows: [{ label: t.onlyEmpty, run: empty }, { label: t.onlyFilled, run: filled }] }]);
    },

    /** The phone's Filters sheet (8h): every change applies at once; "Show n people" closes it. */
    showTableFilters(): void {
        if (!mounted?.filterState || filterSheet) return;
        const sheet = new FilterSheet({
            onChip: (chip, on) => this.changeTableFilter(f => setChip(f, chip, on)),
            onChoice: (chip, choice) => this.changeTableFilter(f => setChip(f, chip, !!choice, choice ?? {})),
            onRemoveColumn: (col) => this.changeTableFilter(f => removeColumnFilter(f, col)),
            onClear: () => this.changeTableFilter(f => clearFilter(f), true),
            onClose: () => this.closeTableFilters(),
        });
        sheet.update(mounted.filterState);
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay tv-colpanel-overlay';
        overlay.appendChild(sheet.el);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeTableFilters(); });
        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        this.bottomSheetOnClose = () => { if (filterSheet?.overlay === overlay) filterSheet = null; };
        filterSheet = { sheet, overlay };
        requestAnimationFrame(() => overlay.classList.add('active'));
        sheet.focusFirst();
    },

    closeTableFilters(): void {
        if (!filterSheet) return;
        const open = filterSheet;
        filterSheet = null;
        if (this.bottomSheet === open.overlay) this.hideBottomSheet();
        else open.overlay.remove();
    },

    /**
     * The app's person search in the table (§8.3): the person's row is
     * selected and scrolled to (the People table); the diagram's focus stays.
     */
    revealTablePerson(personId: string): void {
        const state = stateOf(treeKey());
        state.rowType = 'persons';
        const key = `p:${personId}`;
        state.types.persons.selected = key;
        const el = document.getElementById('table-container');
        if (!el || TreeRenderer.getViewMode() !== 'table') return;
        this.renderTableView(el);
        mounted?.grid.revealKey(key);
    },

    // -----------------------------------------------------------------------
    // The row's actions (§10)

    /** ⌖ show in the tree, ▤ open the person, ✎ edit (a sub-row or a union row: the relationships panel at that union). */
    tableRowAction(action: RowAction, line: GridLine): void {
        if (line.row.kind === 'source') {
            closeHeadMenu();
            if (action !== 'tree') this.openTableSource(line.row);
            return;
        }
        const personId = personOfRow(line.row);
        if (!personId || !DataManager.getPerson(personId)) return;
        closeHeadMenu();
        if (action === 'tree') {
            // The only action that leaves the table: the family diagram with the person in the middle (as the search does).
            TreeRenderer.presetViewMode('family');
            TreeRenderer.setFocus(personId);
            ZoomPan.centerOnPerson(personId);
            ZoomPan.highlightPerson(personId);
            return;
        }
        if (action === 'open') {
            this.showPersonPage(personId);
            return;
        }
        if (tableReadOnly()) return;
        if (line.row.kind === 'event') { this.editTableEvent(line.row); return; }
        const data = DataManager.getData();
        const union = unionOfLine(line);
        watching = { tree: treeKey(), name: personNameOf(personId), keys: watchEdit(data, familyKeys(data, personId)) };
        if (!union) {
            this.clearDialogStack();
            this.pushDialog('person-modal');
            this.showEditPersonModal(personId);
            return;
        }
        this.showRelationshipsPanel(personId);
        const grid = document.querySelector<HTMLElement>(`#relationships-content .partnership-grid[data-partnership-id="${CSS.escape(union)}"]`);
        grid?.scrollIntoView({ block: 'nearest' });
    },

    /**
     * A source row's Open source and Edit (§14.2): the sources manager on that
     * source; a locked tree, which has no manager, shows the source itself.
     */
    openTableSource(row: SourceRow): void {
        this.openTableSourceId(row.id);
    },

    /** A source by its id in the sources manager (§14.2, §14.3); a locked tree shows the source itself. */
    openTableSourceId(id: string): void {
        const data = DataManager.getData();
        if (!data.sources?.[id]) return;
        if (DataManager.isTreeLocked()) { this.showSourceViewer(id, null, { readOnly: true }); return; }
        watching = { tree: treeKey(), name: () => DataManager.getData().sources?.[id]?.title ?? '', keys: watchEdit(data, [`s:${id}`]) };
        this.clearDialogStack();
        this.showSourcesDialog(id);
    },

    /**
     * The pill "+N" of a citation cell (§14.3): the further cited sources, a
     * click (a tap on a phone's sheet) opens one in the sources manager.
     */
    showTableCites(ids: readonly string[], anchor: HTMLElement): void {
        closeHeadMenu();
        const catalog = DataManager.getData().sources ?? {};
        const list = ids.filter(id => catalog[id]);
        if (!list.length) return;
        const cites: BubbleCite[] = list.map(id => {
            const src = catalog[id]!;
            return {
                title: src.title?.trim() || src.reference?.trim() || '?',
                meta: [src.repository?.trim(), src.reference?.trim()].filter(Boolean).join(' · '),
            };
        });
        const t = strings.table;
        if (isPhoneBar() || isCoarsePointer()) {
            this.noteBottomSheetTrigger();
            this.hideBottomSheet();
            this.presentMenuSheet(t.citesTitle, [{
                rows: list.map((id, i) => ({
                    label: cites[i].title, ...(cites[i].meta ? { sub: cites[i].meta } : {}), run: () => this.openTableSourceId(id),
                })),
            }]);
            return;
        }
        openBubblePanel({
            rect: anchor.getBoundingClientRect(), label: t.citesTitle, kind: 'cites', html: citesHtml(cites),
            focusBack: () => (anchor.isConnected ? anchor : null), scroller: mounted?.grid.el,
            onAction: (act, i) => { if (act === 'source' && list[i]) this.openTableSourceId(list[i]); },
        });
    },

    /**
     * Edit an event row (§14.1): a person's event in the person dialog on that
     * event, a couple's event in its own dialog, the wedding and the divorce in
     * the union's panel, the birth and the death in the person dialog.
     */
    editTableEvent(row: EventRow): void {
        const target = eventEditTarget(row);
        if (!target) return;
        const data = DataManager.getData();
        const keys = new Set(row.persons.flatMap(p => familyKeys(data, p.id)));
        if (row.union) keys.add(`u:${row.union.id}`);
        const personId = target.kind === 'coupleEvent' ? row.persons[0]?.id : target.personId;
        if (!personId) return;
        watching = { tree: treeKey(), name: personNameOf(personId), keys: watchEdit(data, [...keys]) };
        switch (target.kind) {
            case 'person':
            case 'personEvent':
                this.clearDialogStack();
                this.pushDialog('person-modal');
                this.showEditPersonModal(target.personId);
                if (target.kind === 'personEvent') this.showEditEventModal(target.eventId);
                return;
            case 'coupleEvent':
                this.clearDialogStack();
                this.showEditCoupleEventModal(target.partnershipId, target.eventId);
                return;
            case 'union': {
                this.showRelationshipsPanel(target.personId);
                const grid = document.querySelector<HTMLElement>(`#relationships-content .partnership-grid[data-partnership-id="${CSS.escape(target.partnershipId)}"]`);
                grid?.scrollIntoView({ block: 'nearest' });
                return;
            }
        }
    },

    /**
     * A name in a cell (§14.1). A person or couple's name opens the person; a
     * participant's name offers "Filter: godparent {name}" (and, for a tree's
     * person, Open person), as a menu or on a phone and by touch as a sheet.
     */
    tableNameAction(line: GridLine, name: CellName, anchor: HTMLElement): void {
        closeHeadMenu();
        const role = name.role;
        if (!role) {
            if (name.personId && DataManager.getPerson(name.personId)) this.showPersonPage(name.personId);
            return;
        }
        if (line.kind === 'more' || line.row.kind !== 'event') return;
        const t = strings.table;
        const filter = (): void => this.changeTableFilter((f) => {
            const m = model;
            return !!m && setParticipantFilter(f, m, { role, personId: name.personId, name: name.text });
        }, true);
        const personId = name.personId && DataManager.getPerson(name.personId) ? name.personId : null;
        const open = (): void => { if (personId) this.showPersonPage(personId); };
        if (isPhoneBar() || isCoarsePointer()) {
            const rows = [{ label: t.filterParticipant[role](name.text), icon: '', run: filter }];
            if (personId) rows.push({ label: t.act.open, icon: '▤', run: open });
            this.noteBottomSheetTrigger();
            this.hideBottomSheet();
            this.presentMenuSheet(name.text, [{ rows }]);
            return;
        }
        const entries: MenuEntry[] = [{ id: 'participant', label: t.filterParticipant[role](name.text), icon: '', run: filter }];
        if (personId) entries.push({ id: 'open', label: t.act.open, icon: '▤', run: open });
        const menu = openHeadMenu(anchor, '', '', entries);
        menu.setAttribute('aria-label', name.text);
    },

    /** The row's menu (§10.1): Show in tree · Open person (Enter) · Edit… (double click) · Expand / Collapse unions. */
    showTableRowMenu(line: GridLine, anchor: HTMLElement): void {
        if (line.kind === 'more') return;
        if (isPhoneBar()) { this.showTableRowSheet(line); return; }
        const t = strings.table;
        const run = (a: RowAction) => () => this.tableRowAction(a, line);
        const src = line.row.kind === 'source' ? line.row : null;
        const entries: MenuEntry[] = src
            ? [{ id: 'open', label: t.act.openSource, icon: '▤', hint: 'Enter', run: run('open') }]
            : [
                { id: 'tree', label: t.act.tree, icon: '⌖', run: run('tree') },
                { id: 'open', label: t.act.open, icon: '▤', hint: 'Enter', run: run('open') },
            ];
        if (!tableReadOnly()) entries.push({ id: 'edit', label: t.act.edit, icon: '✎', hint: t.dblClickHint, run: run('edit') });
        if (line.kind === 'row' && line.expanded !== null) {
            const expand = !line.expanded;
            const id = line.row.id;
            entries.push(SEP, {
                id: 'unions', label: expand ? t.expandAll : t.collapseAll, icon: expand ? '▸' : '▾', hint: expand ? '→' : '←',
                run: () => this.changeTableColumns(st => setExpanded(st.unions, id, expand)),
            });
        }
        const person = personOfRow(line.row);
        const p = person ? DataManager.getPerson(person) : null;
        const menu = openHeadMenu(anchor, '', '', entries);
        menu.setAttribute('aria-label', t.actionsOf(src ? src.source.title : p ? personName(p) : ''));
    },

    /**
     * The row's sheet on a phone and by touch (10b): the name and years on
     * top, the three actions, then a row per union into the relationships
     * panel ("Union k: {partner} · Edit ›"); a sub-row's sheet has its union only.
     */
    showTableRowSheet(line: GridLine): void {
        if (line.kind === 'more') return;
        if (line.row.kind === 'source') { this.showTableSourceSheet(line); return; }
        const personId = personOfRow(line.row);
        const person = personId ? DataManager.getPerson(personId) : null;
        if (!personId || !person) return;
        const t = strings.table;
        const ro = tableReadOnly();
        const run = (a: RowAction, l: GridLine = line) => () => this.tableRowAction(a, l);
        const rows = [
            { label: t.act.tree, icon: '⌖', run: run('tree') },
            { label: t.act.open, icon: '▤', run: run('open') },
        ];
        if (!ro) rows.push({ label: t.act.edit, icon: '✎', run: run('edit') });
        const blocks = [{ rows }];
        if (!ro && line.row.kind === 'person') {
            const row = line.row;
            const n = row.unions.length;
            const unionRows = row.unions.map((u, i) => {
                if (line.kind === 'sub' && line.union !== i) return null;
                const otherId = u.person1Id === personId ? u.person2Id : u.person1Id;
                const other = DataManager.getPerson(otherId);
                const sub: GridLine = { kind: 'sub', row, union: i, k: i + 1, n, dimmed: false };
                return { label: t.unionWith(i + 1, other ? personName(other) : '?'), value: t.editMore, icon: '', run: run('edit', sub) };
            }).filter((r): r is NonNullable<typeof r> => !!r);
            if (unionRows.length) blocks.push({ rows: unionRows, divider: true } as typeof blocks[number]);
        }
        // An event's sheet (§14.1): its type and people on top, its date under them.
        const ev = line.row.kind === 'event' ? line.row : null;
        const title = ev && model ? `${eventTypeLabel(ev)}: ${eventPersons(model.ctx, ev).map(p => personName(p)).join(', ')}` : personName(person);
        const date = ev && model ? dateCell(model.ctx, ev.date) : null;
        const sub = date ? [date.prefix, date.text].filter(Boolean).join(' ') : fanYears(person);
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(title, blocks, sub ? { subtitle: sub } : {});
    },

    /** A source row's sheet (§14.2): its title and archive on top, Open source and Edit. */
    showTableSourceSheet(line: GridLine): void {
        if (line.kind === 'more' || line.row.kind !== 'source') return;
        const src = line.row.source;
        const t = strings.table;
        const run = (a: RowAction) => () => this.tableRowAction(a, line);
        const rows = [{ label: t.act.openSource, icon: '▤', run: run('open') }];
        if (!tableReadOnly()) rows.push({ label: t.act.edit, icon: '✎', run: run('edit') });
        const sub = [src.repository, src.reference].map(x => x?.trim()).filter(Boolean).join(' · ');
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(src.title, [{ rows }], sub ? { subtitle: sub } : {});
    },

    /** The dialog or panel opened from the table was saved (§10.3): its changed rows lit, "Saved: {name}". */
    tableEditSaved(): void {
        const w = watching;
        watching = null;
        if (!w || w.tree !== treeKey() || TreeRenderer.getViewMode() !== 'table') return;
        const changed = changedKeys(DataManager.getData(), w.keys);
        if (!changed.length) return;
        flashNext = { tree: w.tree, keys: changed };
        this.showToast(strings.table.savedToast(w.name()));
    },

    /** A load from the research's bridge (§10.3, 10d): its rows lit and a toast whose Show selects the first. True when the table shows it. */
    tableBridgeChanged(previous: StromData): boolean {
        if (TreeRenderer.getViewMode() !== 'table') return false;
        const data = DataManager.getData();
        const changes = bridgeChanges(previous, data);
        if (!changes.keys.length) return false;
        const tree = treeKey();
        flashNext = { tree, keys: changes.keys };
        const names = [...rowKeysFor(data, 'persons', changes.keys)]
            .map(k => data.persons[k.slice(2) as PersonId])
            .filter((p): p is NonNullable<typeof p> => !!p)
            .map(p => personName(p));
        this.showToast(strings.table.bridgeToast(changes.facts, namesList(names)), BRIDGE_TOAST_MS, {
            action: { label: strings.table.show, run: () => this.showTableChanged(tree, changes.keys) },
        });
        return true;
    },

    /** "Show" in the bridge's toast: the first changed row in the shown order selected and scrolled to. */
    showTableChanged(tree: string, keys: readonly string[]): void {
        if (treeKey() !== tree || TreeRenderer.getViewMode() !== 'table' || !view) return;
        const state = stateOf(tree);
        const want = rowKeysFor(DataManager.getData(), state.rowType, keys, state.rowType === 'events' ? model?.events : undefined);
        const first = view.result.rows.find(r => want.has(rowKey(r)));
        if (!first) return;
        const key = rowKey(first);
        state.types[state.rowType].selected = key;
        this.redrawTableNow();
        mounted?.grid.revealKey(key);
    },

    /** The table is not shown: rows kept in place after an edit are sorted again when it comes back (§10.3). */
    forgetTableOrder(): void {
        view = null;
        watching = null;
        flashNext = null;
    },

    /** Draw the table again now when it is shown. */
    redrawTableNow(): void {
        const el = document.getElementById('table-container');
        if (el && TreeRenderer.getViewMode() === 'table') this.renderTableView(el);
    },

    /**
     * The list of views (9a): under the view button on a computer and a
     * tablet; on a phone a sheet that also carries Save, Save as new and
     * Discard changes while the view is changed.
     */
    showTableViewList(): void {
        if (!mounted) return;
        const t = strings.table;
        const tree = treeKey();
        const state = stateOf(tree);
        const stored = storedViews();
        const ro = DataManager.isReadOnly();
        const list = viewList(state, stored, ro);
        const anchor = mounted.views.button;
        if (!isPhoneBar()) {
            const item = (e: { id: string; name: string; rowNote: string; active: boolean }): MenuEntry => ({
                id: e.id, label: e.name, icon: '', hint: e.rowNote || undefined, checked: e.active, run: () => this.openTableView(e.id),
            });
            const entries: MenuEntry[] = [{ heading: t.views.builtin }, ...list.builtin.map(item)];
            if (list.custom.length) entries.push(SEP, { heading: t.views.custom }, ...list.custom.map(item));
            if (list.canSaveAs) {
                entries.push(SEP,
                    { id: 'saveAs', label: t.saveAsMenu, icon: '+', run: () => this.saveTableViewAs(anchor) },
                    { id: 'rename', label: t.renameMenu, icon: '', disabled: !list.canEdit, run: () => this.renameOpenTableView(anchor) },
                    { id: 'delete', label: t.deleteMenu, icon: '', disabled: !list.canEdit, run: () => { void this.deleteOpenTableView(); } });
                if (list.builtinOpen) entries.push({ note: t.builtinLocked });
            }
            openHeadMenu(anchor, '', '', entries);
            return;
        }
        const type = state.rowType;
        const open = openViewOf(state, type, stored);
        const changed = viewChanged(open, state.types[type]);
        const row = (e: { id: string; name: string; rowNote: string; active: boolean }) => ({
            label: e.name, value: e.rowNote || undefined, active: e.active, run: () => this.openTableView(e.id),
        });
        const blocks: { header?: string; rows: { label: string; run: () => void; value?: string; active?: boolean }[]; divider?: boolean; note?: string }[] = [];
        if (changed) {
            const rows = [];
            if (!ro && !list.builtinOpen) rows.push({ label: t.save, run: () => this.saveOpenTableView() });
            if (!ro) rows.push({ label: t.saveAsMenu, run: () => this.saveTableViewAs(anchor) });
            rows.push({ label: t.discard, run: () => this.discardTableViewChanges() });
            blocks.push({ header: `● ${t.changed}`, rows, ...(list.builtinOpen && !ro ? { note: t.builtinNote } : {}) });
        }
        blocks.push({ header: t.views.builtin, rows: list.builtin.map(row) });
        if (list.custom.length) blocks.push({ header: t.views.custom, rows: list.custom.map(row) });
        if (!ro) {
            const rows = [];
            if (!changed) rows.push({ label: t.saveAsMenu, run: () => this.saveTableViewAs(anchor) });
            if (list.canEdit) {
                rows.push({ label: t.renameMenu, run: () => this.renameOpenTableView(anchor) });
                rows.push({ label: t.deleteMenu, run: () => { void this.deleteOpenTableView(); } });
            }
            if (rows.length || list.builtinOpen) blocks.push({ rows, ...(list.builtinOpen ? { note: t.builtinLocked } : {}) });
        }
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(t.view, blocks.map((b, i) => (i ? { ...b, divider: true } : b)));
    },

    /** Open a view (§9.2); its row type is shown, the view left keeps its changes (§9.3). */
    openTableView(id: string): void {
        const state = stateOf(treeKey());
        if (!switchView(state, id, storedViews())) return;
        view = null;
        this.redrawTableNow();
    },

    /** "Save" (§9.3): the open saved view takes the shown state. */
    saveOpenTableView(): void {
        if (DataManager.isReadOnly()) return;
        const state = stateOf(treeKey());
        const type = state.rowType;
        const st = state.types[type];
        const open = openViewOf(state, type, storedViews());
        if (isBuiltinId(open.id)) return;
        if (!DataManager.saveTableView(viewFromState(type, st, open.id, open.name, new Date().toISOString()))) return;
        st.base = columnSetupOf(st);
        this.redrawTableNow();
    },

    /** "Save as new" (§9.3): a name panel ("{name} 2"); the new view opens with the shown state. */
    saveTableViewAs(anchor?: HTMLElement): void {
        if (DataManager.isReadOnly() || !mounted) return;
        const t = strings.table;
        const tree = treeKey();
        const state = stateOf(tree);
        const type = state.rowType;
        const open = openViewOf(state, type, storedViews());
        const form = viewNameForm(t.viewCopyName(open.name));
        const save = (): void => {
            if (treeKey() !== tree || DataManager.isReadOnly()) return;
            const st = state.types[type];
            const name = uniqueViewName(form.read(), takenViewNames(storedViews()));
            const id = newViewId();
            if (!DataManager.saveTableView(viewFromState(type, st, id, name, new Date().toISOString()))) return;
            // The changes went into the new view: the view left has none.
            delete state.drafts[open.id];
            state.open[type] = id;
            st.base = columnSetupOf(st);
            this.redrawTableNow();
        };
        this.showTableFilterForm(anchor ?? mounted.views.button, t.saveAsTitle, form.el, save, {
            applyLabel: t.save, ariaLabel: t.saveAsTitle, cls: 'tv-vpanel',
            validate: () => { if (form.read()) return true; form.invalid(); return false; },
        });
    },

    /** "Rename…" (§9.3): the same panel; the unsaved changes stay unsaved. */
    renameOpenTableView(anchor?: HTMLElement): void {
        if (DataManager.isReadOnly() || !mounted) return;
        const t = strings.table;
        const tree = treeKey();
        const state = stateOf(tree);
        const open = openViewOf(state, state.rowType, storedViews());
        if (isBuiltinId(open.id)) return;
        const form = viewNameForm(open.name);
        const rename = (): void => {
            if (treeKey() !== tree || DataManager.isReadOnly()) return;
            const name = uniqueViewName(form.read(), takenViewNames(storedViews(), open.id));
            if (name === open.name) return;
            if (DataManager.saveTableView({ ...open, name, updated: new Date().toISOString() }, true)) this.redrawTableNow();
        };
        this.showTableFilterForm(anchor ?? mounted.views.button, t.renameTitle, form.el, rename, {
            applyLabel: t.save, ariaLabel: t.renameTitle, cls: 'tv-vpanel',
            validate: () => { if (form.read()) return true; form.invalid(); return false; },
        });
    },

    /** "Delete" (§9.3): after a confirmation; Undo in the usual toast brings it back. */
    async deleteOpenTableView(): Promise<void> {
        if (DataManager.isReadOnly()) return;
        const t = strings.table;
        const tree = treeKey();
        const state = stateOf(tree);
        const open = openViewOf(state, state.rowType, storedViews());
        if (isBuiltinId(open.id)) return;
        const ok = await this.showConfirm(strings.danger.undoHint, t.deleteConfirm(open.name), { confirmLabel: t.deleteMenu, variant: 'danger' });
        if (!ok || treeKey() !== tree) return;
        if (DataManager.deleteTableView(open.id)) {
            dropMissingViews(state, storedViews());
            this.redrawTableNow();
        }
    },

    /** "Discard changes" (§9.3). */
    discardTableViewChanges(): void {
        discardViewChanges(stateOf(treeKey()), storedViews());
        view = null;
        this.redrawTableNow();
    },

    /** "● changed" of a built-in view: why there is no Save (9c). */
    showTableBuiltinNote(anchor: HTMLElement): void {
        const note = strings.table.builtinNote;
        openBubblePanel({
            rect: anchor.getBoundingClientRect(), label: note, kind: 'legend', focusBack: () => anchor,
            html: `<div class="tv-bub-note">${note.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`,
        });
    },

    /** The CSV of what the table shows now (§11.2) and its file name (§11.1). */
    tableCsvNow(): { csv: TableCsv; file: string; type: RowType } | null {
        if (!model) return null;
        const tree = treeKey();
        const state = stateOf(tree);
        const type = state.rowType;
        const st = state.types[type];
        const display = displayColumns(type, st, isPhoneBar());
        const shown = viewRows(tree, model, type, st.filter, st.search, st.sort, display.columns);
        // A row kept after an edit that no longer passes (§10.3) is not part of the export.
        const rows = shown.stale.size ? shown.rows.filter(r => !shown.stale.has(rowKey(r))) : shown.rows;
        const pass = shown.pass;
        const csv = buildTableCsv({ model, type, rows, columns: shownColumns(type, st, false).columns, pass });
        const treeName = (tree && TreeManager.getTreeMetadata(tree as TreeId)?.name) || '';
        const file = tableCsvFileName(treeName, openViewOf(state, type, storedViews()).name, new Date());
        return { csv, file, type };
    },

    /** Export (11a): a 380 px panel under the button; on a phone a sheet. */
    showTableExport(): void {
        if (!mounted) return;
        const now = this.tableCsvNow();
        if (!now) return;
        const t = strings.table;
        const sum: ExportSummary = { items: now.csv.items, columns: now.csv.columns, file: now.file };
        this.showTableFilterForm(mounted.exportBtn, '', exportForm(now.type, sum), () => this.downloadTableCsv(), {
            applyLabel: t.exportDownload, ariaLabel: t.export, cls: 'tv-xpanel', noCancel: true,
        });
    },

    /** Download the CSV (§11.2) and say what went in (11b). */
    downloadTableCsv(): void {
        const now = this.tableCsvNow();
        if (!now) return;
        const blob = new Blob([now.csv.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = now.file;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        const k = ROW_KEY[now.type];
        this.showToast(strings.table.exportedToast[k](now.file, now.csv.items, now.csv.lines, now.csv.columns), 5000);
    },

    /** The Export dialog's link (11d): the dialog closes, the Table view opens with its Export. */
    showTableExportFromDialog(): void {
        this.closeExportDialog();
        if (TreeRenderer.getViewMode() !== 'table') this.setDisplayViewMode('table');
        requestAnimationFrame(() => {
            if (TreeRenderer.getViewMode() === 'table') this.showTableExport();
        });
    },

    /** Switch the table's rows (§2); each type keeps its own state. */
    setTableRowType(type: RowType): void {
        if (!ROW_TYPES.includes(type)) return;
        const state = stateOf(treeKey());
        if (state.rowType === type) return;
        state.rowType = type;
        const el = document.getElementById('table-container');
        if (el && TreeRenderer.getViewMode() === 'table') this.renderTableView(el);
    },

    /** A state in place of the grid (§13a, 13e–13g), or the grid. */
    drawTableEmpty(state: TableEmptyState | null): void {
        if (!mounted) return;
        const key = state ? `${state.kind}|${state.text}|${state.action?.id ?? ''}` : '';
        if (state) mounted.container.dataset.empty = state.kind;
        else delete mounted.container.dataset.empty;
        mounted.grid.el.hidden = !!state;
        mounted.empty.hidden = !state;
        if (key === mounted.emptyKey) return;
        mounted.emptyKey = key;
        if (!state) { mounted.empty.innerHTML = ''; return; }
        const add = state.action?.id === 'add';
        mounted.empty.innerHTML = emptyStateHtml({ title: state.title, text: state.text, actionLabel: add ? state.action!.label : undefined });
        mounted.empty.querySelector('.empty-block-action')?.setAttribute('data-empty-act', 'add');
        if (state.action?.id === 'quality') {
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'tv-empty-link';
            link.dataset.emptyAct = 'quality';
            link.textContent = state.action.label;
            mounted.empty.querySelector('.empty-block')?.appendChild(link);
        }
    },

    /** The phone's ⋯ (12a): Columns, Export, Coverage row and Expand or Collapse unions. */
    showTableMoreMenu(): void {
        const state = stateOf(treeKey());
        const st = state.types[state.rowType];
        const t = strings.table;
        const rows: { label: string; run: () => void; value?: string; active?: boolean; ariaLabel?: string }[] = [
            { label: t.columns, value: String(st.columns.length), run: () => this.showTableColumns() },
            { label: t.export, run: () => this.showTableExport() },
            {
                label: t.coverageRow, value: st.coverageRow ? '✓' : '', active: st.coverageRow,
                ariaLabel: `${t.coverageRow}: ${st.coverageRow ? t.yes : t.no}`,
                run: () => this.changeTableColumns(s2 => { s2.coverageRow = !s2.coverageRow; }),
            },
        ];
        const unions = mounted?.unionsButton;
        if (unions) {
            rows.push({
                label: unions === 'expand' ? t.expandAll : t.collapseAll,
                run: () => this.changeTableColumns(s2 => setAllExpanded(s2.unions, unions === 'expand')),
            });
        }
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(t.moreActions, [{ rows }]);
    },

    /** A completeness cell's bubble by touch (§6.2): the share, what is missing, what it counts. */
    showTableCompleteness(line: GridLine, col: number, cell: HTMLElement): void {
        const def = mounted?.display?.columns[col];
        if (!def || !model || line.kind === 'more') return;
        const value = lineCell(model, line, def);
        if (!value.title) return;
        const [head, ...rest] = value.title.split('\n');
        const body = rest.map(r => `<div class="tv-bub-detail">${escHtml(r)}</div>`).join('');
        if (isPhoneBar()) {
            this.showTableSheet(sheetElement(head, `<div class="tv-bub-comp">${body}</div>`, 'legend', () => this.hideBottomSheet()));
            return;
        }
        openBubblePanel({
            rect: cell.getBoundingClientRect(), label: head, kind: 'legend', focusBack: () => cell, scroller: mounted?.grid.el,
            html: `<div class="tv-bub-title">${escHtml(head)}</div><div class="tv-bub-comp">${body}</div>`,
        });
    },

    /** The phone's row-type sheet (§2): the types with their counts and a note. */
    showTableRowTypeSheet(): void {
        const state = stateOf(treeKey());
        const counts = rowCounts(model);
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(strings.table.rowType, [{
            rows: ROW_TYPES.map(t => ({
                label: strings.table.rows[t], value: String(counts[t]), active: t === state.rowType,
                run: () => this.setTableRowType(t),
            })),
            note: strings.table.rowTypeNote,
        }]);
    },
});
