/**
 * Table view (spec 073): the view in the app — the mixin the renderer calls.
 *
 * Joins the model (table-model.ts), the column catalog, the bar and the
 * grid. The rows are rebuilt only when the data revision, the data object,
 * the home person or the language change; the state of each row type
 * (columns, widths, pinning, sort, scroll, selected row) is kept per tree
 * while the app is open (§2: switching the row type loses nothing). The
 * table runs no layout and never changes the diagram's selection of people.
 */

import { DataManager } from '../../data.js';
import { TreeRenderer } from '../../renderer.js';
import { isPhoneBar } from '../../breakpoints.js';
import { strings, getCurrentLanguage, type Language } from '../../strings.js';
import { uiModule } from '../module.js';
import type { SortSpec } from './table-columns.js';
import { sortRows } from './table-filter.js';
import { buildTableModel, modelIsCurrent, ROW_TYPES, rowsOf, type RowType, type TableModel, type TableRow } from './table-model.js';
import { TableGrid } from './table-grid.js';
import { createBar, createStatus, updateBar, updateStatus } from './table-bar.js';
import { shownColumns, tableStateFor } from './table-state.js';

interface Mounted {
    container: HTMLElement;
    lang: Language;
    bar: HTMLElement;
    grid: TableGrid;
    status: HTMLElement;
    /** Tree and row type last drawn: a change restores that type's scroll. */
    drawn: string;
}

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
            });
            const status = createStatus();
            container.append(bar, grid.el, status);
            mounted = { container, lang, bar, grid, status, drawn: '' };
        }

        const counts = { persons: m.persons.length, unions: m.unions.length } as Record<RowType, number>;
        const rows = sortedRows(m, type, st.sort);
        const { columns, widths, pinned } = shownColumns(type, st, isPhoneBar());
        container.dataset.rowtype = type;
        updateBar(mounted.bar, type, counts);
        updateStatus(mounted.status, type, rows.length, counts[type], st.sort);
        const drawn = `${tree}|${type}`;
        const restore = mounted.drawn !== drawn ? { top: st.top, left: st.left } : undefined;
        mounted.drawn = drawn;
        mounted.grid.setInput({
            model: m, type, rows, columns, widths, pinned, sort: st.sort, homeId,
            selected: st.selected,
            label: `${strings.viewModeSwitch.table} – ${strings.table.rows[type]}`,
        }, restore);
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
