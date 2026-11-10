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
import { TreeRenderer } from '../../renderer.js';
import { isPhoneBar } from '../../breakpoints.js';
import { strings, getCurrentLanguage, type Language } from '../../strings.js';
import { uiModule } from '../module.js';
import { columnById, columnLabel, columnNote, type SortSpec } from './table-columns.js';
import { sortRows } from './table-filter.js';
import { buildTableModel, modelIsCurrent, ROW_TYPES, rowKey, rowsOf, type RowType, type TableModel, type TableRow } from './table-model.js';
import { TableGrid } from './table-grid.js';
import { createBar, createStatus, updateBar, updateStatus } from './table-bar.js';
import {
    canMoveColumn, canPinColumn, catalogColumns, displayColumns, hideColumn, lockedColumn, moveColumnBy, moveColumnRun, moveColumnTo,
    normalizeColumns, pinColumn, resetColumns, setColumnWidth, setGroupCollapsed, setGroupShown, showColumn, sortAdd, sortOnly,
    tableStateFor, unpinColumn, type DisplayColumns, type RowTypeState,
} from './table-state.js';
import { ColumnPanel } from './table-colpanel.js';
import { anyExpanded, buildLines, coverageUnionsOf, hasMultiUnions, setAllExpanded, setExpanded, type UnionPredicate } from './table-subrows.js';
import { columnCoverage, coverageCell, coverageLabel, type CoverageCell } from './table-coverage.js';
import type { ColumnDef } from './table-columns.js';
import { closeHeadMenu, headMenuItems, openHeadMenu, SEP, type HeadMenuItem } from './table-headmenu.js';
import { issueCategory, translateValidationType, validateTreeData, type ValidationIssue } from '../../validation.js';
import { dismissalFor, dismissalKey } from '../../quality-dismiss.js';
import { QUALITY_CHANGED_EVENT } from '../quality-ui.js';
import type { Partnership, StromData } from '../../types.js';
import { applyChecks, bandSeverity, CHECK_COLUMNS, CheckIndex, isPlaceColumn, type CellFinding } from './table-checks.js';
import { lineCell, lineKey, type GridLine } from './table-subrows.js';
import { markHtml, type CellIssueMark } from './table-grid.js';
import { bubbleHeading, bubbleHtml, closeTableBubble, legendHtml, openBubblePanel, sheetElement } from './table-bubble.js';

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
}

/** The open Columns panel; on a phone it sits in a sheet (`overlay`). */
let panel: { panel: ColumnPanel; overlay: HTMLElement | null } | null = null;

let model: TableModel | null = null;
let sorted: { model: TableModel; type: RowType; sort: string; rows: TableRow[] } | null = null;
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

function sortedRows(m: TableModel, type: RowType, sort: readonly SortSpec[]): TableRow[] {
    // Sorted by a column of the findings: sorted again when they change (else the order stays, §13i).
    const byChecks = sort.some(s => CHECK_COLUMNS.includes(s.col));
    const key = JSON.stringify(sort) + (byChecks ? `|${m.ctx.checks?.version ?? 0}` : '');
    if (sorted && sorted.model === m && sorted.type === type && sorted.sort === key) return sorted.rows;
    const rows = sortRows(m, type, rowsOf(m, type), sort);
    sorted = { model: m, type, sort: key, rows };
    return rows;
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
        const state = tableStateFor(tree);
        const type = state.rowType;
        const st = state.types[type];

        if (!mounted || mounted.container !== container || mounted.lang !== lang || !container.contains(mounted.grid.el)) {
            this.closeTableColumns(false);
            closeHeadMenu();
            mounted?.grid.destroy();
            container.innerHTML = '';
            const bar = createBar({
                onRowType: (t) => this.setTableRowType(t),
                onRowTypeSheet: () => this.showTableRowTypeSheet(),
            });
            const grid = new TableGrid({
                onScroll: (top, left) => {
                    const s = tableStateFor(treeKey());
                    s.types[s.rowType].top = top;
                    s.types[s.rowType].left = left;
                },
                onSelect: (key) => {
                    const s = tableStateFor(treeKey());
                    s.types[s.rowType].selected = key;
                    this.renderTableView(container);
                },
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
                window.addEventListener('strom:user-change', later);
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
            container.append(bar, grid.el, status);
            mounted = { container, lang, bar, grid, status, colsBtn, drawn: '', display: null };
        }

        const counts = { persons: m.persons.length, unions: m.unions.length } as Record<RowType, number>;
        const rows = sortedRows(m, type, st.sort);
        // The union filters (§3.3) come with part C2's filter; until then every union passes.
        const pass: UnionPredicate | null = null;
        const persons = type === 'persons';
        const lines = persons ? buildLines(rows, { collapse: st.unions, pass, revealed: new Set(st.revealedUnions) }) : undefined;
        const unionsButton = persons && hasMultiUnions(rows) ? (anyExpanded(st.unions, rows) ? 'collapse' : 'expand') : null;
        const phone = isPhoneBar();
        normalizeColumns(type, st);
        const display = displayColumns(type, st, phone);
        mounted.display = display;
        const total = catalogColumns(type).length;
        mounted.colsBtn.innerHTML = `<span class="tv-cols-label">${strings.table.columns}</span>`
            + `<span class="tv-cols-count" aria-hidden="true">${st.columns.length}</span>`;
        mounted.colsBtn.setAttribute('aria-label', `${strings.table.columns}, ${strings.table.columnsCount(st.columns.length, total)}`);
        container.dataset.rowtype = type;
        updateBar(mounted.bar, type, counts);
        updateStatus(mounted.status, type, rows.length, counts[type], st.sort, !!checks?.running);
        const drawn = `${tree}|${type}`;
        const restore = mounted.drawn !== drawn ? { top: st.top, left: st.left } : undefined;
        mounted.drawn = drawn;
        mounted.grid.setInput({
            model: m, type, rows, columns: display.columns, widths: display.widths, pinned: display.pinned, sort: st.sort, homeId,
            bands: display.bands, coverageRow: st.coverageRow, editableHead: !phone,
            lines, subRows: persons, unionsButton,
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
        panel?.panel.update(type, st);
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
        const s = tableStateFor(treeId);
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
        const state = tableStateFor(treeKey());
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
        const state = tableStateFor(treeKey());
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
        const state = tableStateFor(treeKey());
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

    /** Switch the table's rows (§2); each type keeps its own state. */
    setTableRowType(type: RowType): void {
        if (!ROW_TYPES.includes(type)) return;
        const state = tableStateFor(treeKey());
        if (state.rowType === type) return;
        state.rowType = type;
        const el = document.getElementById('table-container');
        if (el && TreeRenderer.getViewMode() === 'table') this.renderTableView(el);
    },

    /** The phone's row-type sheet (§2): the types with their counts and a note. */
    showTableRowTypeSheet(): void {
        const state = tableStateFor(treeKey());
        const counts: Record<RowType, number> = { persons: model?.persons.length ?? 0, unions: model?.unions.length ?? 0 };
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
