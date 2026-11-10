/**
 * Table view (spec 073 §1.4, §1.6): the grid in the DOM.
 *
 * A `role="treegrid"` that scrolls both ways. The head (group row, column
 * names, coverage row) sticks to the top; the pinned columns stick to the
 * left. Only the window of rows in view (± ROW_OVERSCAN) is in the DOM, each
 * row placed absolutely at its index × row height; past
 * COLUMN_VIRTUAL_THRESHOLD columns only the pinned ones and the scrolled
 * range are drawn, spacers standing for the rest. The grid knows nothing of
 * the data: it draws the rows and columns it is given (table-ui.ts), the
 * cells come from the model (cellOf).
 */

import { cellOf, columnLabel, groupLabel, type ColumnDef, type SortSpec } from './table-columns.js';
import { rowKey, type CellValue, type RowType, type TableModel, type TableRow } from './table-model.js';
import { columnOffsets, columnWindow, rowWindow, type ColumnWindow } from './table-window.js';

export interface GridInput {
    model: TableModel;
    type: RowType;
    /** The rows in their shown order (filtered, sorted). */
    rows: readonly TableRow[];
    columns: readonly ColumnDef[];
    /** Each column's width in px (same order as `columns`). */
    widths: readonly number[];
    /** Number of leading columns pinned to the left. */
    pinned: number;
    sort: readonly SortSpec[];
    homeId: string | null;
    /** The selected row's key (rowKey), if any. */
    selected: string | null;
    /** The grid's accessible name. */
    label: string;
    /** The coverage row's text of a column (§6.1; empty until it is computed). */
    coverage?: (col: ColumnDef) => string;
}

export interface GridHandlers {
    /** The grid scrolled (the view keeps its position per row type). */
    onScroll?(top: number, left: number): void;
    /** A row was clicked. */
    onSelect?(key: string, row: TableRow): void;
}

const ROW_HEIGHT_FALLBACK = 32;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The classes of a cell for its value (§5: computed, n/a, uncertain, substitute). */
export function cellClasses(value: CellValue, col: ColumnDef): string {
    let cls = 'tv-cell';
    if (col.align === 'right') cls += ' tv-right';
    if (col.id === 'name' || col.id === 'p1' || col.id === 'p2') cls += ' tv-name';
    if (value.na) cls += ' tv-cell--na';
    else if (value.computed && !value.empty) cls += ' tv-cell--computed';
    if (value.uncertain) cls += ' tv-cell--uncertain';
    if (value.subst) cls += ' tv-cell--subst';
    return cls;
}

/** What a cell shows: its text, "–" for one that does not apply. */
export function cellText(value: CellValue): string {
    if (value.na && !value.text) return '–';
    return value.text;
}

export class TableGrid {
    readonly el: HTMLElement;
    private readonly head: HTMLElement;
    private readonly groupRow: HTMLElement;
    private readonly headRow: HTMLElement;
    private readonly covRow: HTMLElement;
    private readonly body: HTMLElement;
    private input: GridInput | null = null;
    private offsets: number[] = [0];
    private frame = 0;
    /** What the head and the body were last drawn for (skip identical redraws). */
    private headKey = '';
    private bodyKey = '';
    private readonly resize: ResizeObserver | null;

    constructor(private readonly handlers: GridHandlers = {}) {
        const el = document.createElement('div');
        el.className = 'tv-grid';
        el.setAttribute('role', 'treegrid');
        el.tabIndex = 0;
        el.innerHTML = '<div class="tv-head" role="rowgroup">'
            + '<div class="tv-row tv-grouprow" role="row"></div>'
            + '<div class="tv-row tv-headrow" role="row"></div>'
            + '<div class="tv-row tv-covrow" role="row"></div>'
            + '</div><div class="tv-body" role="rowgroup"></div>';
        this.el = el;
        this.head = el.querySelector('.tv-head')!;
        this.groupRow = el.querySelector('.tv-grouprow')!;
        this.headRow = el.querySelector('.tv-headrow')!;
        this.covRow = el.querySelector('.tv-covrow')!;
        this.body = el.querySelector('.tv-body')!;
        el.addEventListener('scroll', () => {
            el.classList.toggle('is-scrolled-x', el.scrollLeft > 0);
            this.handlers.onScroll?.(el.scrollTop, el.scrollLeft);
            this.schedule();
        }, { passive: true });
        this.body.addEventListener('click', (e) => {
            const rowEl = (e.target as Element).closest<HTMLElement>('.tv-row[data-key]');
            const key = rowEl?.dataset.key;
            if (!key || !this.input) return;
            const row = this.input.rows[Number(rowEl!.dataset.index)];
            if (row) this.handlers.onSelect?.(key, row);
        });
        this.resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.schedule()) : null;
        this.resize?.observe(el);
    }

    /** New rows or columns: drawn now; `scroll` restores a kept position. */
    setInput(input: GridInput, scroll?: { top: number; left: number }): void {
        this.input = input;
        this.offsets = columnOffsets(input.widths);
        this.headKey = '';
        this.bodyKey = '';
        this.el.setAttribute('aria-label', input.label);
        this.el.setAttribute('aria-rowcount', String(input.rows.length + 3));
        this.el.setAttribute('aria-colcount', String(input.columns.length));
        this.body.style.height = `${input.rows.length * this.rowHeight()}px`;
        this.body.style.width = `${this.offsets[input.columns.length]}px`;
        if (scroll) {
            this.el.scrollTop = scroll.top;
            this.el.scrollLeft = scroll.left;
            this.el.classList.toggle('is-scrolled-x', this.el.scrollLeft > 0);
        }
        this.draw();
    }

    /** The row height the stylesheet gives (`--tv-row-h`; touch and phone rows are taller). */
    rowHeight(): number {
        const v = parseFloat(getComputedStyle(this.el).getPropertyValue('--tv-row-h'));
        return Number.isFinite(v) && v > 0 ? v : ROW_HEIGHT_FALLBACK;
    }

    private schedule(): void {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
    }

    /** Draw the head and the window of rows for the current scroll position. */
    draw(): void {
        const input = this.input;
        if (!input) return;
        const rowH = this.rowHeight();
        const headH = this.head.offsetHeight;
        this.body.style.height = `${input.rows.length * rowH}px`;
        const cw = columnWindow(input.widths, input.pinned, this.el.scrollLeft, this.el.clientWidth);
        const rw = rowWindow(Math.max(0, this.el.scrollTop - headH), Math.max(0, this.el.clientHeight - headH), rowH, input.rows.length);
        const colKey = cw.indices.join(',');
        if (colKey !== this.headKey) {
            this.headKey = colKey;
            this.drawHead(input, cw);
        }
        const bodyKey = `${colKey}|${rw.start}-${rw.end}|${rowH}`;
        if (bodyKey !== this.bodyKey) {
            this.bodyKey = bodyKey;
            this.drawBody(input, cw, rw.start, rw.end, rowH);
        }
    }

    /** The cell's sticky offset for a pinned column. */
    private pinStyle(i: number, input: GridInput): string {
        const w = input.widths[i];
        return i < input.pinned ? `width:${w}px;left:${this.offsets[i]}px` : `width:${w}px`;
    }

    private pinClass(i: number, input: GridInput): string {
        if (i >= input.pinned) return '';
        return i === input.pinned - 1 ? ' tv-pinned tv-pinned-last' : ' tv-pinned';
    }

    private spacer(width: number): string {
        return width > 0 ? `<div class="tv-spacer" style="width:${width}px" aria-hidden="true"></div>` : '';
    }

    private drawHead(input: GridInput, cw: ColumnWindow): void {
        const pinnedCount = Math.min(input.pinned, input.columns.length);
        // Group row: a run of drawn columns of one group is one cell (pinned and scrolling runs apart).
        let groups = '';
        let run: { group: string; width: number; first: number; last: number; pinned: boolean } | null = null;
        const flush = (): void => {
            if (!run) return;
            const sticky = run.pinned ? (run.last === pinnedCount - 1 ? ' tv-pinned tv-pinned-last' : ' tv-pinned') : '';
            const style = run.pinned ? `width:${run.width}px;left:${this.offsets[run.first]}px` : `width:${run.width}px`;
            groups += `<div class="tv-cell tv-groupcell${sticky}" role="columnheader" style="${style}">`
                + `<span class="tv-cell-text">${esc(groupLabel(input.columns[run.first].group))}</span></div>`;
            run = null;
        };
        let names = '';
        let cov = '';
        let prev = -1;
        for (const i of cw.indices) {
            const col = input.columns[i];
            const pinned = i < pinnedCount;
            if (prev >= 0 && i !== prev + 1) {
                flush();
                groups += this.spacer(cw.before);
                names += this.spacer(cw.before);
                cov += this.spacer(cw.before);
            }
            if (!run || run.group !== col.group || run.pinned !== pinned || (prev >= 0 && i !== prev + 1)) {
                flush();
                run = { group: col.group, width: 0, first: i, last: i, pinned };
            }
            run.width += input.widths[i];
            run.last = i;
            const sort = input.sort.findIndex(s => s.col === col.id);
            const ariaSort = sort === 0 ? ` aria-sort="${input.sort[0].dir === 'desc' ? 'descending' : 'ascending'}"` : '';
            const arrow = sort >= 0 ? ` <span class="tv-sort-mark" aria-hidden="true">${input.sort[sort].dir === 'desc' ? '↓' : '↑'}</span>` : '';
            const right = col.align === 'right' ? ' tv-right' : '';
            const computed = col.computed ? ' is-computed' : '';
            names += `<div class="tv-cell tv-headcell${right}${computed}${this.pinClass(i, input)}" role="columnheader"`
                + ` aria-colindex="${i + 1}" data-col="${esc(col.id)}"${ariaSort} style="${this.pinStyle(i, input)}">`
                + `<span class="tv-cell-text">${esc(columnLabel(col))}</span>${arrow}</div>`;
            cov += `<div class="tv-cell tv-covcell${right}${this.pinClass(i, input)}" role="gridcell" aria-colindex="${i + 1}"`
                + ` data-col="${esc(col.id)}" style="${this.pinStyle(i, input)}">${esc(input.coverage?.(col) ?? '')}</div>`;
            prev = i;
        }
        flush();
        groups += this.spacer(cw.after);
        names += this.spacer(cw.after);
        cov += this.spacer(cw.after);
        const total = `${cw.total}px`;
        for (const [row, html] of [[this.groupRow, groups], [this.headRow, names], [this.covRow, cov]] as const) {
            row.style.width = total;
            row.innerHTML = html;
        }
        this.groupRow.setAttribute('aria-rowindex', '1');
        this.headRow.setAttribute('aria-rowindex', '2');
        this.covRow.setAttribute('aria-rowindex', '3');
    }

    private drawBody(input: GridInput, cw: ColumnWindow, start: number, end: number, rowH: number): void {
        let html = '';
        for (let r = start; r < end; r++) {
            const row = input.rows[r];
            const key = rowKey(row);
            const home = row.kind === 'person' && row.id === input.homeId ? ' is-home' : '';
            const selected = key === input.selected ? 'true' : 'false';
            html += `<div class="tv-row${home}" role="row" data-key="${esc(key)}" data-index="${r}" aria-rowindex="${r + 4}"`
                + ` aria-selected="${selected}" style="top:${r * rowH}px;width:${cw.total}px">`;
            let prev = -1;
            for (const i of cw.indices) {
                if (prev >= 0 && i !== prev + 1) html += this.spacer(cw.before);
                const col = input.columns[i];
                const value = cellOf(input.model, row, col);
                const title = value.title ?? (value.text.length > 24 ? value.text : '');
                html += `<div class="${cellClasses(value, col)}${this.pinClass(i, input)}" role="gridcell" aria-colindex="${i + 1}"`
                    + ` style="${this.pinStyle(i, input)}"${title ? ` title="${esc(title)}"` : ''}>`
                    + `<span class="tv-cell-text">${esc(cellText(value))}</span></div>`;
                prev = i;
            }
            html += this.spacer(cw.after) + '</div>';
        }
        this.body.innerHTML = html;
    }

    /** The rows drawn now (their indexes), for tests and keyboard moves. */
    drawnRange(): { start: number; end: number } {
        const rows = this.body.querySelectorAll<HTMLElement>('.tv-row[data-index]');
        if (!rows.length) return { start: 0, end: 0 };
        return { start: Number(rows[0].dataset.index), end: Number(rows[rows.length - 1].dataset.index) + 1 };
    }

    destroy(): void {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.resize?.disconnect();
        this.el.remove();
    }
}
