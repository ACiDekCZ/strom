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
 */

import { DataManager } from '../../data.js';
import { TreeRenderer } from '../../renderer.js';
import { isPhoneBar } from '../../breakpoints.js';
import { strings, getCurrentLanguage, type Language } from '../../strings.js';
import { uiModule } from '../module.js';
import { columnById, columnLabel, columnNote, type SortSpec } from './table-columns.js';
import { sortRows } from './table-filter.js';
import { buildTableModel, modelIsCurrent, ROW_TYPES, rowsOf, type RowType, type TableModel, type TableRow } from './table-model.js';
import { TableGrid } from './table-grid.js';
import { createBar, createStatus, updateBar, updateStatus } from './table-bar.js';
import {
    canMoveColumn, canPinColumn, catalogColumns, displayColumns, hideColumn, lockedColumn, moveColumnBy, moveColumnRun, moveColumnTo,
    normalizeColumns, pinColumn, resetColumns, setColumnWidth, setGroupCollapsed, setGroupShown, showColumn, sortAdd, sortOnly,
    tableStateFor, unpinColumn, type DisplayColumns, type RowTypeState,
} from './table-state.js';
import { ColumnPanel } from './table-colpanel.js';
import { closeHeadMenu, headMenuItems, openHeadMenu, SEP, type HeadMenuItem } from './table-headmenu.js';

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

function treeKey(): string {
    return DataManager.getCurrentTreeId() ?? '';
}

function sortedRows(m: TableModel, type: RowType, sort: readonly SortSpec[]): TableRow[] {
    const key = JSON.stringify(sort);
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
            const status = createStatus();
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
        updateStatus(mounted.status, type, rows.length, counts[type], st.sort);
        const drawn = `${tree}|${type}`;
        const restore = mounted.drawn !== drawn ? { top: st.top, left: st.left } : undefined;
        mounted.drawn = drawn;
        mounted.grid.setInput({
            model: m, type, rows, columns: display.columns, widths: display.widths, pinned: display.pinned, sort: st.sort, homeId,
            bands: display.bands, coverageRow: st.coverageRow, editableHead: !phone,
            selected: st.selected,
            label: `${strings.viewModeSwitch.table} – ${strings.table.rows[type]}`,
        }, restore);
        panel?.panel.update(type, st);
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
