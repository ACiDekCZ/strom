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
 *
 * The head carries the column work of §4.3–§4.6: the group row's −/+ and a
 * collapsed group's band, dragging a column within its group or a group by
 * its cell, the right edge to change a width (a double click fits the
 * content), the ▾ / right click / Shift+F10 / long press for the header
 * menu, and the keys Alt+←/→ (move), Alt+Shift+←/→ (width). The grid only
 * reports these; table-ui.ts changes the state and draws again.
 */

import { strings } from '../../strings.js';
import { cellOf, columnLabel, groupLabel, type ColumnDef, type SortSpec } from './table-columns.js';
import { rowKey, type CellValue, type RowType, type TableModel, type TableRow } from './table-model.js';
import { columnRun, groupRuns, MIN_COLUMN_WIDTH, type CollapsedBand } from './table-state.js';
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
    /** The coverage row is shown (§6.1; default yes). */
    coverageRow?: boolean;
    /** A collapsed group's band at each position (§4.3; null for a plain column). */
    bands?: readonly (CollapsedBand | null)[];
    /** The group row has −/+ and the head can be dragged and resized (not on a phone, §4.3). */
    editableHead?: boolean;
    /** What a band shows in a row (§4.3: the highest finding of its columns, part C). */
    bandCell?: (row: TableRow, band: CollapsedBand) => string;
}

export interface GridHandlers {
    /** The grid scrolled (the view keeps its position per row type). */
    onScroll?(top: number, left: number): void;
    /** A row was clicked. */
    onSelect?(key: string, row: TableRow): void;
    /** A group's −/+ or a band was used (§4.3). */
    onToggleGroup?(group: string, collapse: boolean): void;
    /** The header menu of a column was asked for (§4.6). */
    onHeadMenu?(colId: string, anchor: HTMLElement): void;
    /** A column's width is being dragged (`done` at the end) or set by keys or a double click (§4.5). */
    onResize?(colId: string, width: number, done: boolean): void;
    /** A column moves by `offset` places within its group (drag or Alt+←/→). */
    onMoveColumn?(colId: string, offset: number): void;
    /** A group's drawn columns [start, end] move before drawn position `before` (drag or Alt+←/→ on its cell). */
    onMoveGroup?(start: number, end: number, before: number): void;
}

/** How far a press moves before it is a drag; how long a touch holds for the header menu. */
const DRAG_START_PX = 5;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;
/** Alt+Shift+←/→ changes a width by this much (§4.5). */
export const WIDTH_STEP = 16;
/** A double click on the edge fits the content of this many rows (§4.5). */
const FIT_ROWS = 200;
const FIT_MAX = 480;

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
    /** The head cell that holds the head's tab stop (roving tabindex). */
    private headFocus: string | null = null;
    /** A drag or a long press just ended: the click that follows is not a click. */
    private swallowClick = false;
    private measureCtx: CanvasRenderingContext2D | null = null;

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
            const band = (e.target as Element).closest<HTMLElement>('.tv-band[data-band]');
            if (band) { this.handlers.onToggleGroup?.(band.dataset.band!, false); return; }
            const rowEl = (e.target as Element).closest<HTMLElement>('.tv-row[data-key]');
            const key = rowEl?.dataset.key;
            if (!key || !this.input) return;
            const row = this.input.rows[Number(rowEl!.dataset.index)];
            if (row) this.handlers.onSelect?.(key, row);
        });
        this.wireHead();
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
        this.covRow.hidden = input.coverageRow === false;
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
        const editable = !!input.editableHead;
        // What had the focus in the head comes back after the redraw.
        const active = document.activeElement;
        const refocus = active instanceof HTMLElement && this.head.contains(active)
            ? (active.closest<HTMLElement>('[data-col]')?.dataset.col ? `[data-col="${active.closest<HTMLElement>('[data-col]')!.dataset.col}"]`
                : active.closest<HTMLElement>('[data-band]') ? `.tv-headcell[data-band="${active.closest<HTMLElement>('[data-band]')!.dataset.band}"]`
                    : active.matches('.tv-group-toggle[data-group]') ? `.tv-group-toggle[data-group="${active.dataset.group}"]` : '')
            : '';
        const focusCol = input.columns.some((c, i) => c.id === this.headFocus && !input.bands?.[i]) ? this.headFocus : input.columns[0]?.id ?? null;
        // Group row: a run of drawn columns of one group is one cell (pinned and scrolling runs apart, a band alone).
        let groups = '';
        let run: { group: string; width: number; first: number; last: number; pinned: boolean; band: boolean } | null = null;
        const flush = (): void => {
            if (!run) return;
            const sticky = run.pinned ? (run.last === pinnedCount - 1 ? ' tv-pinned tv-pinned-last' : ' tv-pinned') : '';
            const style = run.pinned ? `width:${run.width}px;left:${this.offsets[run.first]}px` : `width:${run.width}px`;
            const label = groupLabel(input.columns[run.first].group);
            const toggle = editable && !run.pinned
                ? `<button type="button" class="tv-group-toggle" data-group="${esc(run.group)}" aria-expanded="${!run.band}"`
                    + ` aria-label="${esc(run.band ? strings.table.expandGroup(label) : strings.table.collapseGroup(label))}">${run.band ? '+' : '−'}</button>`
                : '';
            groups += `<div class="tv-cell tv-groupcell${sticky}${run.band ? ' is-collapsed' : ''}" role="columnheader"`
                + ` data-start="${run.first}" data-end="${run.last}"${run.pinned ? ' data-pinned="1"' : ''} style="${style}">`
                + `<span class="tv-cell-text">${run.band ? '▸ ' : ''}${esc(label)}</span>${toggle}</div>`;
            run = null;
        };
        let names = '';
        let cov = '';
        let prev = -1;
        for (const i of cw.indices) {
            const col = input.columns[i];
            const band = input.bands?.[i] ?? null;
            const pinned = i < pinnedCount;
            if (prev >= 0 && i !== prev + 1) {
                flush();
                groups += this.spacer(cw.before);
                names += this.spacer(cw.before);
                cov += this.spacer(cw.before);
            }
            if (!run || run.group !== col.group || run.pinned !== pinned || run.band || band || (prev >= 0 && i !== prev + 1)) {
                flush();
                run = { group: col.group, width: 0, first: i, last: i, pinned, band: !!band };
            }
            run.width += input.widths[i];
            run.last = i;
            if (band) {
                const text = strings.table.ncols(band.columns.length);
                names += `<div class="tv-cell tv-headcell tv-bandhead" role="columnheader" aria-colindex="${i + 1}" data-index="${i}"`
                    + ` data-band="${esc(band.group)}" tabindex="-1" aria-label="${esc(`${groupLabel(band.group)}: ${text}`)}"`
                    + ` style="width:${input.widths[i]}px"><span class="tv-cell-text">${esc(text)}</span></div>`;
                cov += `<div class="tv-cell tv-covcell tv-band" role="gridcell" aria-colindex="${i + 1}" style="width:${input.widths[i]}px"></div>`;
                prev = i;
                continue;
            }
            const label = columnLabel(col);
            const sort = input.sort.findIndex(s => s.col === col.id);
            const ariaSort = sort === 0 ? ` aria-sort="${input.sort[0].dir === 'desc' ? 'descending' : 'ascending'}"` : '';
            const arrow = sort >= 0 ? ` <span class="tv-sort-mark" aria-hidden="true">${input.sort[sort].dir === 'desc' ? '↓' : '↑'}</span>` : '';
            const right = col.align === 'right' ? ' tv-right' : '';
            const computed = col.computed ? ' is-computed' : '';
            names += `<div class="tv-cell tv-headcell${right}${computed}${this.pinClass(i, input)}" role="columnheader"`
                + ` aria-colindex="${i + 1}" data-col="${esc(col.id)}" data-index="${i}" tabindex="${col.id === focusCol ? 0 : -1}"`
                + ` title="${esc(label)}" aria-label="${esc(label)}"${ariaSort} style="${this.pinStyle(i, input)}">`
                + `<span class="tv-cell-text">${esc(label)}</span>${arrow}`
                + `<button type="button" class="tv-head-menu" tabindex="-1" aria-haspopup="menu" aria-label="${esc(strings.table.columnMenu(label))}"></button>`
                + (editable ? '<span class="tv-resize" aria-hidden="true"></span>' : '')
                + '</div>';
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
        if (refocus) this.head.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
    }

    // -----------------------------------------------------------------------
    // The head's work (§4.3–§4.6)

    private wireHead(): void {
        const head = this.head;
        head.addEventListener('click', (e) => {
            const t = e.target as Element;
            const toggle = t.closest<HTMLElement>('.tv-group-toggle[data-group]');
            if (toggle) {
                e.stopPropagation();
                this.handlers.onToggleGroup?.(toggle.dataset.group!, toggle.getAttribute('aria-expanded') === 'true');
                return;
            }
            const menu = t.closest<HTMLElement>('.tv-head-menu');
            const cell = t.closest<HTMLElement>('.tv-headcell[data-col]');
            if (menu && cell) {
                e.stopPropagation();
                this.handlers.onHeadMenu?.(cell.dataset.col!, cell);
                return;
            }
            const band = t.closest<HTMLElement>('.tv-headcell[data-band]');
            if (band) { this.handlers.onToggleGroup?.(band.dataset.band!, false); return; }
            const collapsed = t.closest<HTMLElement>('.tv-groupcell.is-collapsed');
            const bandAt = collapsed ? this.input?.bands?.[Number(collapsed.dataset.start)] : null;
            if (bandAt) this.handlers.onToggleGroup?.(bandAt.group, false);
        });
        // A drag or a long press is not a click (part C2 sorts on the head's click).
        head.addEventListener('click', (e) => {
            if (!this.swallowClick) return;
            this.swallowClick = false;
            e.stopPropagation();
            e.preventDefault();
        }, true);
        head.addEventListener('contextmenu', (e) => {
            const cell = (e.target as Element).closest<HTMLElement>('.tv-headcell[data-col]');
            if (!cell) return;
            e.preventDefault();
            this.handlers.onHeadMenu?.(cell.dataset.col!, cell);
        });
        head.addEventListener('focusin', (e) => {
            const cell = (e.target as Element).closest<HTMLElement>('.tv-headcell[data-col]');
            if (!cell) return;
            this.headFocus = cell.dataset.col!;
            for (const other of this.headRow.querySelectorAll<HTMLElement>('.tv-headcell[tabindex="0"]')) if (other !== cell) other.tabIndex = -1;
            cell.tabIndex = 0;
        });
        head.addEventListener('keydown', (e) => this.onHeadKey(e));
        head.addEventListener('pointerdown', (e) => this.onHeadPointer(e));
        head.addEventListener('dblclick', (e) => {
            const cell = (e.target as Element).closest('.tv-resize') ? (e.target as Element).closest<HTMLElement>('.tv-headcell[data-col]') : null;
            if (!cell || !this.input) return;
            e.preventDefault();
            const i = Number(cell.dataset.index);
            this.handlers.onResize?.(cell.dataset.col!, this.fitWidth(i), true);
        });
    }

    private onHeadKey(e: KeyboardEvent): void {
        const input = this.input;
        if (!input) return;
        const t = e.target as HTMLElement;
        const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        // A group's cell: Alt+←/→ moves the whole group.
        const toggle = t.closest<HTMLElement>('.tv-group-toggle');
        if (toggle && horizontal && e.altKey) {
            const cell = toggle.closest<HTMLElement>('.tv-groupcell')!;
            const runs = groupRuns(this.displayGroups(input), input.pinned).filter(r => !r.pinned);
            const at = runs.findIndex(r => r.start === Number(cell.dataset.start));
            const next = runs[at + dir];
            if (at < 0 || !next) return;
            e.preventDefault();
            this.handlers.onMoveGroup?.(runs[at].start, runs[at].end, dir < 0 ? next.start : next.end + 1);
            return;
        }
        const cell = t.closest<HTMLElement>('.tv-headcell[data-index]');
        if (!cell) return;
        const i = Number(cell.dataset.index);
        const col = input.columns[i];
        const band = input.bands?.[i] ?? null;
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
            if (band) return;
            e.preventDefault();
            this.handlers.onHeadMenu?.(col.id, cell);
            return;
        }
        if (band && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            this.handlers.onToggleGroup?.(band.group, false);
            return;
        }
        if (!horizontal || e.ctrlKey || e.metaKey) return;
        if (e.altKey && e.shiftKey) {
            if (band || !input.editableHead) return;
            e.preventDefault();
            this.handlers.onResize?.(col.id, Math.max(MIN_COLUMN_WIDTH, input.widths[i] + dir * WIDTH_STEP), true);
            return;
        }
        if (e.altKey) {
            if (band) return;
            e.preventDefault();
            this.handlers.onMoveColumn?.(col.id, dir);
            return;
        }
        if (e.shiftKey) return;
        // ← → walk the head cells.
        const cells = [...this.headRow.querySelectorAll<HTMLElement>('.tv-headcell[data-index]')];
        const next = cells[cells.indexOf(cell) + dir];
        if (!next) return;
        e.preventDefault();
        next.focus();
        next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    /** Each drawn column's group (a band is its own kind, so nothing joins it). */
    private displayGroups(input: GridInput): string[] {
        return input.columns.map((c, i) => (input.bands?.[i] ? `band:${c.group}` : c.group));
    }

    /** A drawn column's left edge on screen (pinned ones do not scroll). */
    private colLeft(i: number): number {
        const input = this.input!;
        const rect = this.el.getBoundingClientRect();
        return rect.left + this.offsets[i] - (i >= input.pinned ? this.el.scrollLeft : 0);
    }

    private onHeadPointer(e: PointerEvent): void {
        const input = this.input;
        if (!input) return;
        const t = e.target as Element;
        const cell = t.closest<HTMLElement>('.tv-headcell[data-col]');
        if (e.pointerType === 'touch') {
            if (cell) this.longPress(e, cell);
            return;
        }
        if (e.button !== 0 || !input.editableHead) return;
        if (cell && t.closest('.tv-resize')) {
            e.preventDefault();
            this.resizeDrag(e, cell);
            return;
        }
        if (t.closest('button')) return;
        if (cell) { this.columnDrag(e, cell); return; }
        const group = t.closest<HTMLElement>('.tv-groupcell[data-start]');
        if (group && !group.dataset.pinned) this.groupDrag(e, group);
    }

    /** Follow a press until it is let go; Escape cancels (§4.5). */
    private track(e: PointerEvent, move: (ev: PointerEvent) => void, end: (cancelled: boolean) => void): void {
        const id = e.pointerId;
        let done = false;
        const finish = (cancelled: boolean): void => {
            if (done) return;
            done = true;
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('pointercancel', onCancel, true);
            window.removeEventListener('keydown', onKey, true);
            end(cancelled);
        };
        const onMove = (ev: PointerEvent): void => { if (ev.pointerId === id) move(ev); };
        const onUp = (ev: PointerEvent): void => { if (ev.pointerId === id) finish(false); };
        const onCancel = (ev: PointerEvent): void => { if (ev.pointerId === id) finish(true); };
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopPropagation();
            finish(true);
        };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onCancel, true);
        window.addEventListener('keydown', onKey, true);
    }

    /** The floating copy of a head cell and the drop line (§4.5, 4d). */
    private dragChrome(label: string, width: number): { ghost: HTMLElement; line: HTMLElement; remove(): void } {
        const ghost = document.createElement('div');
        ghost.className = 'tv-drag-ghost';
        ghost.textContent = label;
        ghost.style.width = `${width}px`;
        const line = document.createElement('div');
        line.className = 'tv-drop-line';
        const rect = this.el.getBoundingClientRect();
        line.style.top = `${rect.top}px`;
        line.style.height = `${this.el.clientHeight}px`;
        document.body.append(ghost, line);
        return { ghost, line, remove: () => { ghost.remove(); line.remove(); } };
    }

    private columnDrag(e: PointerEvent, cell: HTMLElement): void {
        const input = this.input!;
        const i = Number(cell.dataset.index);
        const col = input.columns[i];
        const [a, b] = columnRun(this.displayGroups(input), input.pinned, i);
        if (a === b) return;
        const x0 = e.clientX;
        const y0 = e.clientY;
        const headRect = this.headRow.getBoundingClientRect();
        let chrome: ReturnType<TableGrid['dragChrome']> | null = null;
        let target = i;
        const mark = (on: boolean): void => {
            for (const el of this.el.querySelectorAll<HTMLElement>(`[aria-colindex="${i + 1}"]`)) el.classList.toggle('is-drag-source', on);
        };
        this.track(e, (ev) => {
            if (!chrome) {
                if (Math.abs(ev.clientX - x0) < DRAG_START_PX && Math.abs(ev.clientY - y0) < DRAG_START_PX) return;
                chrome = this.dragChrome(columnLabel(col), input.widths[i]);
                chrome.ghost.style.top = `${headRect.top}px`;
                chrome.ghost.style.height = `${headRect.height}px`;
                mark(true);
            }
            // The place among the run: how many of its other columns have their middle left of the pointer.
            let before = 0;
            for (let j = a; j <= b; j++) {
                if (j !== i && this.colLeft(j) + input.widths[j] / 2 < ev.clientX) before++;
            }
            target = a + before;
            const x = target <= i ? this.colLeft(target) : this.colLeft(target) + input.widths[target];
            chrome.line.style.left = `${Math.round(x - 1)}px`;
            chrome.ghost.style.left = `${Math.round(ev.clientX - input.widths[i] / 2)}px`;
        }, (cancelled) => {
            if (!chrome) return;
            chrome.remove();
            mark(false);
            this.swallowClick = true;
            setTimeout(() => { this.swallowClick = false; }, 0);
            if (!cancelled && target !== i) this.handlers.onMoveColumn?.(col.id, target - i);
        });
    }

    private groupDrag(e: PointerEvent, groupCell: HTMLElement): void {
        const input = this.input!;
        const start = Number(groupCell.dataset.start);
        const runs = groupRuns(this.displayGroups(input), input.pinned).filter(r => !r.pinned);
        const own = runs.find(r => r.start === start);
        if (!own || runs.length < 2) return;
        const n = input.columns.length;
        const bounds = [...runs.map(r => r.start), n].filter(p => p !== own.start && p !== own.end + 1);
        const x0 = e.clientX;
        const rect = groupCell.getBoundingClientRect();
        let chrome: ReturnType<TableGrid['dragChrome']> | null = null;
        let before = -1;
        const edge = (p: number): number => (p < n ? this.colLeft(p) : this.colLeft(n - 1) + input.widths[n - 1]);
        this.track(e, (ev) => {
            if (!chrome) {
                if (Math.abs(ev.clientX - x0) < DRAG_START_PX) return;
                chrome = this.dragChrome(groupCell.textContent ?? '', Math.min(rect.width, 240));
                chrome.ghost.classList.add('tv-drag-ghost--group');
                chrome.ghost.style.top = `${rect.top}px`;
                chrome.ghost.style.height = `${rect.height}px`;
                groupCell.classList.add('is-drag-source');
            }
            before = bounds.reduce((best, p) => (best < 0 || Math.abs(edge(p) - ev.clientX) < Math.abs(edge(best) - ev.clientX) ? p : best), -1);
            chrome.line.style.left = `${Math.round(edge(before) - 1)}px`;
            chrome.ghost.style.left = `${Math.round(ev.clientX - Math.min(rect.width, 240) / 2)}px`;
        }, (cancelled) => {
            if (!chrome) return;
            chrome.remove();
            groupCell.classList.remove('is-drag-source');
            this.swallowClick = true;
            setTimeout(() => { this.swallowClick = false; }, 0);
            if (!cancelled && before >= 0) this.handlers.onMoveGroup?.(own.start, own.end, before);
        });
    }

    private resizeDrag(e: PointerEvent, cell: HTMLElement): void {
        const input = this.input!;
        const i = Number(cell.dataset.index);
        const id = cell.dataset.col!;
        const w0 = input.widths[i];
        const x0 = e.clientX;
        let w = w0;
        let frame = 0;
        document.body.classList.add('tv-resizing');
        this.track(e, (ev) => {
            w = Math.max(MIN_COLUMN_WIDTH, Math.round(w0 + ev.clientX - x0));
            if (frame) return;
            frame = requestAnimationFrame(() => { frame = 0; this.handlers.onResize?.(id, w, false); });
        }, (cancelled) => {
            if (frame) cancelAnimationFrame(frame);
            document.body.classList.remove('tv-resizing');
            this.swallowClick = true;
            setTimeout(() => { this.swallowClick = false; }, 0);
            this.handlers.onResize?.(id, cancelled ? w0 : w, true);
        });
    }

    /** A touch held on a head cell opens its menu (§4.6); a short tap stays a click. */
    private longPress(e: PointerEvent, cell: HTMLElement): void {
        const x0 = e.clientX;
        const y0 = e.clientY;
        const timer = setTimeout(() => {
            stop();
            this.swallowClick = true;
            setTimeout(() => { this.swallowClick = false; }, 700);
            this.handlers.onHeadMenu?.(cell.dataset.col!, cell);
        }, LONG_PRESS_MS);
        const onMove = (ev: PointerEvent): void => {
            if (Math.abs(ev.clientX - x0) > LONG_PRESS_MOVE_PX || Math.abs(ev.clientY - y0) > LONG_PRESS_MOVE_PX) stop();
        };
        const stop = (): void => {
            clearTimeout(timer);
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', stop, true);
            window.removeEventListener('pointercancel', stop, true);
        };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', stop, true);
        window.addEventListener('pointercancel', stop, true);
    }

    /** The width that fits a column's content: the first rows from the top of the view and its name on two lines (§4.5). */
    fitWidth(i: number): number {
        const input = this.input;
        if (!input) return MIN_COLUMN_WIDTH;
        const col = input.columns[i];
        this.measureCtx ??= document.createElement('canvas').getContext('2d');
        const ctx = this.measureCtx;
        if (!ctx) return input.widths[i];
        const sample = this.body.querySelector<HTMLElement>(`.tv-row [aria-colindex="${i + 1}"] .tv-cell-text`);
        ctx.font = getComputedStyle(sample ?? this.el).font;
        const from = this.drawnRange().start;
        let max = 0;
        for (let r = from; r < Math.min(input.rows.length, from + FIT_ROWS); r++) {
            max = Math.max(max, ctx.measureText(cellText(cellOf(input.model, input.rows[r], col))).width);
        }
        const headText = this.headRow.querySelector<HTMLElement>(`[data-col="${col.id}"] .tv-cell-text`);
        if (headText) {
            ctx.font = getComputedStyle(headText).font;
            max = Math.max(max, ctx.measureText(columnLabel(col)).width / 2 + 8);
        }
        // Padding on both sides, the sort mark and the ▾.
        return Math.max(MIN_COLUMN_WIDTH, Math.min(FIT_MAX, Math.ceil(max) + 20 + 22));
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
                const band = input.bands?.[i];
                if (band) {
                    html += `<div class="tv-cell tv-band" role="gridcell" aria-colindex="${i + 1}" data-band="${esc(band.group)}"`
                        + ` style="width:${input.widths[i]}px">${input.bandCell?.(row, band) ?? ''}</div>`;
                    prev = i;
                    continue;
                }
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
