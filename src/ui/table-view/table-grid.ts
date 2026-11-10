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
 *
 * The body draws lines (§3): a person's row, the union sub-rows of a person
 * with 2+ unions (`aria-level` 2) and the quiet "n outside the filter · show"
 * line. One cell holds the body's tab stop (roving tabindex, §3.4): arrows
 * walk rows and cells, Home/End, Ctrl+Home/End, PageUp/PageDown; on the name
 * cell → expands and ← collapses (on a sub-row ← goes to the person's row);
 * `*` expands all, Shift+`*` collapses all.
 *
 * A finding of Data quality on a cell (§7.3) tints it and puts its mark at
 * the end of the text (after the number in a numeric cell); a click on such
 * a cell, or Enter on it, asks for the finding's bubble (`onIssue`).
 */

import { strings } from '../../strings.js';
import { cellPlainText, columnLabel, groupLabel, type ColumnDef, type SortSpec } from './table-columns.js';
import { rowKey, type CellSeverity, type CellValue, type RowType, type TableModel, type TableRow } from './table-model.js';
import { columnRun, groupRuns, MIN_COLUMN_WIDTH, type CollapsedBand } from './table-state.js';
import { columnOffsets, columnWindow, lineOffsets, lineWindow, type ColumnWindow } from './table-window.js';
import { lineCell, lineKey, lineLevel, plainLines, type GridLine } from './table-subrows.js';
import type { CoverageCell } from './table-coverage.js';
import { highlightHtml } from './table-filter.js';
import { shownNameOrEmpty as personName } from '../../person-name.js';

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
    /** The lines drawn (§3: rows with their union sub-rows); default one line per row. */
    lines?: readonly GridLine[];
    /** The People table: the name cell has the sub-rows' ▾/▸ slot (§3.2). */
    subRows?: boolean;
    /** The name head's "Expand unions" / "Collapse unions" (§3.2); null: no one has 2+ unions. */
    unionsButton?: 'expand' | 'collapse' | null;
    /** The coverage row's cell of a column (§6.1). */
    coverage?: (col: ColumnDef) => CoverageCell | null;
    /** The coverage row is shown (§6.1; default yes). */
    coverageRow?: boolean;
    /** A collapsed group's band at each position (§4.3; null for a plain column). */
    bands?: readonly (CollapsedBand | null)[];
    /** The group row has −/+ and the head can be dragged and resized (not on a phone, §4.3). */
    editableHead?: boolean;
    /** What a band shows in a line (§4.3: the highest finding of its columns, HTML). */
    bandCell?: (line: GridLine, band: CollapsedBand) => string;
    /** The finding shown in a cell (§7.3) and its title; null: none (or the checks still run). */
    issueAt?: (line: GridLine, col: ColumnDef, value: CellValue) => CellIssueMark | null;
    /** The search's folded query (§8.3): its matches are marked in the cells. */
    hit?: string;
    /** The columns with a filter (§8.2: the head says "filter"). */
    filtered?: ReadonlySet<string>;
    /** Nothing passes the filter (§13c, §13d): said under the head, with "Clear filters". */
    noMatch?: { title: string; text: string; action: string } | null;
}

/** A finding's mark in a cell: its level (or `unusual`) and the finding's title (for the mark's name). */
export interface CellIssueMark {
    severity: CellSeverity;
    label: string;
}

export interface GridHandlers {
    /** The grid scrolled (the view keeps its position per row type). */
    onScroll?(top: number, left: number): void;
    /** A row was clicked (a sub-row selects its person). */
    onSelect?(key: string, row: TableRow): void;
    /** A person's ▾/▸, the count pill or → / ← on the name cell (§3.2). */
    onToggleUnions?(personId: string, expand: boolean): void;
    /** "Expand unions" / "Collapse unions" in the name head, `*` / Shift+`*` (§3.2, §3.4). */
    onAllUnions?(expand: boolean): void;
    /** "n outside the filter · show" (§3.3). */
    onRevealUnions?(personId: string): void;
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
    /** A cell with a finding was clicked or Enter was pressed on it (§7.4): its line, its drawn column, the cell. */
    onIssue?(line: GridLine, col: number, cell: HTMLElement): void;
    /** A click on a column's head (§8.4); `add`: with Shift, a further sort key. */
    onHeadSort?(colId: string, add: boolean): void;
    /** A click on a coverage cell (§6.1: only empty / only filled). */
    onCoverageCell?(colId: string, anchor: HTMLElement): void;
    /** "Clear filters" under the head when nothing passes (§13c). */
    onClearFilters?(): void;
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

/** The glyph of each mark (§7.3): a ring for a lead is drawn by CSS. */
const MARK_GLYPH: Record<CellSeverity, string> = { error: '!', warning: '?', info: '', unusual: '☆' };

/**
 * A mark (§7.3): a red circle with "!", an amber square with "?", a hollow
 * ring, ☆. `label` names it for a screen reader (the level word alone when
 * the mark only stands beside a value, e.g. in the Findings column).
 */
export function markHtml(severity: CellSeverity, label?: string): string {
    const word = strings.table.sev[severity];
    const name = label ? strings.table.issueAria(word, label) : word;
    return `<span class="tv-mark tv-mark--${severity}" role="img" aria-label="${esc(name)}" title="${esc(name)}">${MARK_GLYPH[severity]}</span>`;
}

/** The classes of a cell for its value (§5: computed, n/a, uncertain, substitute; §7.3: a finding). */
export function cellClasses(value: CellValue, col: ColumnDef, issue: CellSeverity | null = null): string {
    let cls = 'tv-cell';
    if (col.align === 'right') cls += ' tv-right';
    if (col.id === 'name' || col.id === 'p1' || col.id === 'p2') cls += ' tv-name';
    if (value.aggregate) cls += ' tv-cell--aggregate';
    else if (value.na) cls += ' tv-cell--na';
    else if (value.computed && !value.empty) cls += ' tv-cell--computed';
    if (value.uncertain) cls += ' tv-cell--uncertain';
    if (value.subst) cls += ' tv-cell--subst';
    if (value.ghost) cls += ' tv-cell--ghost';
    if (issue) cls += ` tv-cell--${issue} has-issue`;
    return cls;
}

/** What a cell shows: its text, "–" for one that does not apply. */
export function cellText(value: CellValue): string {
    if (value.na && !value.text) return '–';
    return value.text;
}

/** Completeness bar width (§6.2: 30 px, the filled part is the value). */
const COMP_BAR = 30;

/**
 * A cell's inner HTML (§5, §6.2): a substitute's label before the value in
 * italics, a date qualifier's word, a completeness percentage with its bar.
 */
export function cellInner(value: CellValue, col: ColumnDef, issue: CellIssueMark | null = null, hit = ''): string {
    if (issue) return cellValueHtml(value, col, hit) + markHtml(issue.severity, issue.label);
    if (!value.mark) return cellValueHtml(value, col, hit);
    // A level beside a value (Findings: after the number; Highest level: before its word).
    return col.align === 'right' ? cellValueHtml(value, col, hit) + markHtml(value.mark) : markHtml(value.mark) + cellValueHtml(value, col, hit);
}

function cellValueHtml(value: CellValue, col: ColumnDef, hit = ''): string {
    if (col.kind === 'percent' && value.percent !== undefined && !value.na) {
        const fill = Math.round((value.percent * COMP_BAR) / 100);
        return `<span class="tv-comp"><span class="tv-comp-num">${esc(value.text)}</span>`
            + `<span class="tv-comp-bar" aria-hidden="true"><span class="tv-comp-fill" style="width:${fill}px"></span></span></span>`;
    }
    let html = '';
    if (value.subst) {
        const s = strings.table.subst;
        const tip = value.subst === 'bap' ? s.bap : s.bur;
        html += `<span class="tv-subst" title="${esc(tip)}" aria-label="${esc(tip)}">${esc(value.subst === 'bap' ? s.bapShort : s.burShort)}</span>`;
    }
    if (value.prefix) html += `<span class="tv-qual">${hit ? highlightHtml(value.prefix, hit) : esc(value.prefix)}</span>`;
    return html + `<span class="tv-cell-text">${hit && !value.na ? highlightHtml(cellText(value), hit) : esc(cellText(value))}</span>`;
}

export class TableGrid {
    readonly el: HTMLElement;
    private readonly head: HTMLElement;
    private readonly groupRow: HTMLElement;
    private readonly headRow: HTMLElement;
    private readonly covRow: HTMLElement;
    private readonly body: HTMLElement;
    private readonly noMatch: HTMLElement;
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
    /** The lines drawn and their tops (§3). */
    private lines: readonly GridLine[] = [];
    private tops: number[] = [0];
    private topsFor = '';
    /** The body's active cell (roving tabindex, §3.4): the line's key and the column's drawn position. */
    private activeKey: string | null = null;
    private activeCol = 0;

    constructor(private readonly handlers: GridHandlers = {}) {
        const el = document.createElement('div');
        el.className = 'tv-grid';
        el.setAttribute('role', 'treegrid');
        el.tabIndex = 0;
        el.innerHTML = '<div class="tv-head" role="rowgroup">'
            + '<div class="tv-row tv-grouprow" role="row"></div>'
            + '<div class="tv-row tv-headrow" role="row"></div>'
            + '<div class="tv-row tv-covrow" role="row"></div>'
            + '</div><div class="tv-body" role="rowgroup"></div>'
            + '<div class="tv-nomatch" role="status" hidden></div>';
        this.el = el;
        this.head = el.querySelector('.tv-head')!;
        this.groupRow = el.querySelector('.tv-grouprow')!;
        this.headRow = el.querySelector('.tv-headrow')!;
        this.covRow = el.querySelector('.tv-covrow')!;
        this.body = el.querySelector('.tv-body')!;
        this.noMatch = el.querySelector('.tv-nomatch')!;
        this.noMatch.addEventListener('click', (e) => {
            if ((e.target as Element).closest('.tv-nomatch-clear')) this.handlers.onClearFilters?.();
        });
        el.addEventListener('scroll', () => {
            el.classList.toggle('is-scrolled-x', el.scrollLeft > 0);
            this.handlers.onScroll?.(el.scrollTop, el.scrollLeft);
            this.schedule();
        }, { passive: true });
        this.body.addEventListener('click', (e) => {
            const t = e.target as Element;
            const rowEl = t.closest<HTMLElement>('.tv-row[data-key]');
            const line = rowEl ? this.lines[Number(rowEl.dataset.index)] : undefined;
            const cellEl = t.closest<HTMLElement>('[aria-colindex]');
            if (line && cellEl) { this.activeKey = lineKey(line); this.activeCol = Number(cellEl.getAttribute('aria-colindex')) - 1; }
            const band = t.closest<HTMLElement>('.tv-band[data-band]');
            if (band) { this.handlers.onToggleGroup?.(band.dataset.band!, false); return; }
            if (!line || !this.input) return;
            if (line.kind === 'more') {
                if (t.closest('.tv-more-btn')) this.handlers.onRevealUnions?.(line.row.id);
                return;
            }
            if (line.kind === 'row' && line.expanded !== null && t.closest('.tv-toggle, .tv-unions-pill')) {
                this.handlers.onToggleUnions?.(line.row.id, !line.expanded);
                return;
            }
            if (cellEl?.classList.contains('has-issue') && this.handlers.onIssue) {
                this.handlers.onIssue(line, Number(cellEl.getAttribute('aria-colindex')) - 1, cellEl);
                return;
            }
            this.handlers.onSelect?.(rowKey(line.row), line.row);
        });
        this.body.addEventListener('keydown', (e) => this.onBodyKey(e));
        // The grid itself focused (its tab stop): an arrow enters the body at the active cell.
        el.addEventListener('keydown', (e) => {
            if (e.target !== el || !/^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(e.key)) return;
            e.preventDefault();
            this.focusCell(Math.max(0, this.activeLineIndex()), this.activeCol);
        });
        this.body.addEventListener('focusin', (e) => {
            const cellEl = (e.target as Element).closest<HTMLElement>('[aria-colindex]');
            const rowEl = cellEl?.closest<HTMLElement>('.tv-row[data-index]');
            const line = rowEl ? this.lines[Number(rowEl.dataset.index)] : undefined;
            if (!cellEl || !line) return;
            this.activeKey = lineKey(line);
            this.activeCol = Number(cellEl.getAttribute('aria-colindex')) - 1;
            for (const other of this.body.querySelectorAll<HTMLElement>('[aria-colindex][tabindex="0"]')) if (other !== cellEl) other.tabIndex = -1;
            cellEl.tabIndex = 0;
        });
        this.wireHead();
        this.resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.schedule()) : null;
        this.resize?.observe(el);
    }

    /** New rows or columns: drawn now; `scroll` restores a kept position. */
    setInput(input: GridInput, scroll?: { top: number; left: number }): void {
        this.input = input;
        this.lines = input.lines ?? plainLines(input.rows);
        this.topsFor = '';
        this.offsets = columnOffsets(input.widths);
        this.headKey = '';
        this.bodyKey = '';
        this.el.setAttribute('aria-label', input.label);
        this.el.setAttribute('aria-rowcount', String(this.lines.length + 3));
        this.el.setAttribute('aria-colcount', String(input.columns.length));
        this.body.style.height = `${this.lineTops(this.rowHeight())[this.lines.length]}px`;
        this.body.style.width = `${this.offsets[input.columns.length]}px`;
        this.covRow.hidden = input.coverageRow === false;
        const nm = input.noMatch;
        this.noMatch.hidden = !nm;
        this.noMatch.innerHTML = nm
            ? `<div class="tv-nomatch-title">${esc(nm.title)}</div>`
                + (nm.text ? `<div class="tv-nomatch-text">${esc(nm.text)}</div>` : '')
                + `<button type="button" class="tv-nomatch-clear">${esc(nm.action)}</button>`
            : '';
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

    /** The "more" line's height (`--tv-more-h`, §3.3: 26 px; as tall as a row on touch). */
    private moreHeight(rowH: number): number {
        const v = parseFloat(getComputedStyle(this.el).getPropertyValue('--tv-more-h'));
        return Number.isFinite(v) && v > 0 ? v : rowH;
    }

    /** Each line's top for this row height (and the body's height last). */
    private lineTops(rowH: number): number[] {
        const hasMore = this.lines.some(l => l.kind === 'more');
        const moreH = hasMore ? this.moreHeight(rowH) : rowH;
        const key = `${rowH}|${moreH}`;
        if (this.topsFor === key) return this.tops;
        this.tops = lineOffsets(this.lines.map(l => (l.kind === 'more' ? moreH : rowH)));
        this.topsFor = key;
        return this.tops;
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
        const tops = this.lineTops(rowH);
        this.body.style.height = `${tops[this.lines.length]}px`;
        const cw = columnWindow(input.widths, input.pinned, this.el.scrollLeft, this.el.clientWidth);
        if (!this.noMatch.hidden) this.noMatch.style.width = `${this.el.clientWidth}px`;
        const rw = lineWindow(tops, Math.max(0, this.el.scrollTop - headH), Math.max(0, this.el.clientHeight - headH));
        const colKey = cw.indices.join(',');
        if (colKey !== this.headKey) {
            this.headKey = colKey;
            this.drawHead(input, cw);
        }
        const bodyKey = `${colKey}|${rw.start}-${rw.end}|${rowH}`;
        if (bodyKey !== this.bodyKey) {
            this.bodyKey = bodyKey;
            this.drawBody(input, cw, rw.start, rw.end, tops);
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
            const arrow = sort >= 0
                ? ` <span class="tv-sort-mark" aria-hidden="true">${input.sort[sort].dir === 'desc' ? '↓' : '↑'}${input.sort.length > 1 ? sort + 1 : ''}</span>`
                : '';
            const filtered = input.filtered?.has(col.id) ? `<span class="tv-filter-mark">${esc(strings.table.filterMark)}</span>` : '';
            const right = col.align === 'right' ? ' tv-right' : '';
            const computed = col.computed ? ' is-computed' : '';
            names += `<div class="tv-cell tv-headcell${right}${computed}${this.pinClass(i, input)}" role="columnheader"`
                + ` aria-colindex="${i + 1}" data-col="${esc(col.id)}" data-index="${i}" tabindex="${col.id === focusCol ? 0 : -1}"`
                + ` title="${esc(label)}" aria-label="${esc(label)}"${ariaSort} style="${this.pinStyle(i, input)}">`
                + `<span class="tv-cell-text">${esc(label)}</span>${arrow}${filtered}`
                + (col.id === 'name' && input.unionsButton
                    ? `<button type="button" class="tv-head-all" tabindex="-1" data-expand="${input.unionsButton === 'expand' ? 1 : 0}">`
                        + `${esc(input.unionsButton === 'expand' ? strings.table.expandAll : strings.table.collapseAll)}</button>`
                    : '')
                + `<button type="button" class="tv-head-menu" tabindex="-1" aria-haspopup="menu" aria-label="${esc(strings.table.columnMenu(label))}"></button>`
                + (editable ? '<span class="tv-resize" aria-hidden="true"></span>' : '')
                + '</div>';
            const cc = input.coverage?.(col) ?? null;
            const ccls = cc?.label ? ' tv-cov-label' : cc?.low ? ' tv-cov-low' : '';
            cov += `<div class="tv-cell tv-covcell${right}${ccls}${this.pinClass(i, input)}${cc && !cc.label && this.handlers.onCoverageCell ? ' is-clickable' : ''}" role="gridcell" aria-colindex="${i + 1}"`
                + ` data-col="${esc(col.id)}" style="${this.pinStyle(i, input)}"${cc?.title ? ` title="${esc(cc.title)}"` : ''}>${esc(cc?.text ?? '')}</div>`;
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
            const all = t.closest<HTMLElement>('.tv-head-all');
            if (all) {
                e.stopPropagation();
                this.handlers.onAllUnions?.(all.dataset.expand === '1');
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
            // §8.4: a click on the head sorts (Shift: a further key); not on the edge or the head's buttons.
            if (cell && !t.closest('.tv-resize, button')) {
                this.handlers.onHeadSort?.(cell.dataset.col!, (e as MouseEvent).shiftKey);
                return;
            }
            const cov = t.closest<HTMLElement>('.tv-covcell.is-clickable[data-col]');
            if (cov) { this.handlers.onCoverageCell?.(cov.dataset.col!, cov); return; }
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
        if (!band && (e.key === 'Enter' || e.key === ' ') && t === cell) {
            e.preventDefault();
            this.handlers.onHeadSort?.(col.id, e.shiftKey);
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
        for (let r = from; r < Math.min(this.lines.length, from + FIT_ROWS); r++) {
            max = Math.max(max, ctx.measureText(cellPlainText(lineCell(input.model, this.lines[r], col))).width);
        }
        const headText = this.headRow.querySelector<HTMLElement>(`[data-col="${col.id}"] .tv-cell-text`);
        if (headText) {
            ctx.font = getComputedStyle(headText).font;
            max = Math.max(max, ctx.measureText(columnLabel(col)).width / 2 + 8);
        }
        // Padding on both sides, the sort mark and the ▾.
        return Math.max(MIN_COLUMN_WIDTH, Math.min(FIT_MAX, Math.ceil(max) + 20 + 22));
    }

    private drawBody(input: GridInput, cw: ColumnWindow, start: number, end: number, tops: readonly number[]): void {
        const refocus = this.body.contains(document.activeElement);
        const activeLine = this.activeLineIndex();
        const activeCol = Math.min(this.activeCol, input.columns.length - 1);
        const selectedPerson = input.selected;
        let html = '';
        for (let r = start; r < end; r++) {
            const line = this.lines[r];
            const row = line.row;
            const key = lineKey(line);
            const home = row.kind === 'person' && row.id === input.homeId ? ' is-home' : '';
            const rowSelected = rowKey(row) === selectedPerson;
            let attrs = ` aria-level="${lineLevel(line)}"`;
            let cls = 'tv-row' + home;
            if (line.kind === 'row') {
                attrs += ` aria-selected="${rowSelected ? 'true' : 'false'}"`;
                if (line.expanded !== null) attrs += ` aria-expanded="${line.expanded}"`;
                if (line.expanded === false && row.kind === 'person') {
                    attrs += ` aria-label="${esc(strings.table.a11y.collapsed(personName(row.person), line.n))}"`;
                }
            } else {
                cls += line.kind === 'sub' ? ' tv-row--sub' : ' tv-row--more';
                if (rowSelected) cls += ' is-selected-sub';
                if (line.kind === 'sub') {
                    if (line.dimmed) cls += ' is-dimmed';
                    attrs += ` aria-label="${esc(strings.table.a11y.unionRow(line.k, line.n, personName(line.row.person)))}"`;
                }
            }
            html += `<div class="${cls}" role="row" data-key="${esc(key)}" data-index="${r}" aria-rowindex="${r + 4}"${attrs}`
                + ` style="top:${tops[r]}px;height:${tops[r + 1] - tops[r]}px;width:${cw.total}px">`;
            let prev = -1;
            for (const i of cw.indices) {
                if (prev >= 0 && i !== prev + 1) html += this.spacer(cw.before);
                prev = i;
                const col = input.columns[i];
                const tab = r === activeLine && i === activeCol ? 0 : -1;
                const band = input.bands?.[i];
                if (band) {
                    html += `<div class="tv-cell tv-band" role="gridcell" aria-colindex="${i + 1}" tabindex="${tab}" data-band="${esc(band.group)}"`
                        + ` style="width:${input.widths[i]}px">${line.kind === 'more' ? '' : input.bandCell?.(line, band) ?? ''}</div>`;
                    continue;
                }
                if (input.subRows && col.id === 'name') {
                    html += this.nameCell(input, line, col, i, tab);
                    continue;
                }
                const value = lineCell(input.model, line, col);
                const issue = line.kind === 'more' ? null : input.issueAt?.(line, col, value) ?? null;
                const substTip = value.subst ? (value.subst === 'bap' ? strings.table.subst.bap : strings.table.subst.bur) : '';
                const title = value.title ?? (substTip || (value.text.length > 24 ? value.text : ''));
                html += `<div class="${cellClasses(value, col, issue?.severity ?? null)}${this.pinClass(i, input)}" role="gridcell" aria-colindex="${i + 1}" tabindex="${tab}"`
                    + ` style="${this.pinStyle(i, input)}"${title ? ` title="${esc(title)}"` : ''}>${cellInner(value, col, issue, line.kind === 'more' ? '' : input.hit ?? '')}</div>`;
            }
            html += this.spacer(cw.after) + '</div>';
        }
        this.body.innerHTML = html;
        if (refocus) this.focusActive(false);
    }

    /** The name cell of the People table (§3.1, §3.2): ▾/▸ and the count pill, a sub-row's "Union k of n", the "more" button. */
    private nameCell(input: GridInput, line: GridLine, col: ColumnDef, i: number, tab: number): string {
        const t = strings.table;
        const open = `<div class="tv-cell tv-name${this.pinClass(i, input)}" role="gridcell" aria-colindex="${i + 1}" tabindex="${tab}" style="${this.pinStyle(i, input)}"`;
        if (line.kind === 'more') {
            return `${open}><span class="tv-sub-indent" aria-hidden="true"></span>`
                + `<button type="button" class="tv-more-btn" tabindex="-1">${esc(t.hiddenUnions(line.hidden))}</button></div>`;
        }
        if (line.kind === 'sub') {
            return `${open}><span class="tv-sub-indent" aria-hidden="true"></span><span class="tv-sub-branch" aria-hidden="true">└</span>`
                + `<span class="tv-cell-text tv-sub-label">${esc(t.unionKofN(line.k, line.n))}</span></div>`;
        }
        const value = lineCell(input.model, line, col);
        const name = cellText(value);
        const issue = input.issueAt?.(line, col, value) ?? null;
        const toggle = line.expanded === null
            ? '<span class="tv-toggle tv-toggle--none" aria-hidden="true"></span>'
            : `<span class="tv-toggle" aria-hidden="true" title="${esc(line.expanded ? `${t.collapseAll} (←)` : `${t.expandAll} (→)`)}">${line.expanded ? '▾' : '▸'}</span>`;
        const pill = line.expanded === false ? `<span class="tv-unions-pill" aria-hidden="true">${esc(t.unionsN(line.n))}</span>` : '';
        const head = issue
            ? `<div class="tv-cell tv-name tv-cell--${issue.severity} has-issue${this.pinClass(i, input)}" role="gridcell" aria-colindex="${i + 1}" tabindex="${tab}" style="${this.pinStyle(i, input)}"`
            : open;
        const nameHtml = input.hit ? highlightHtml(name, input.hit) : esc(name);
        return `${head}${name.length > 24 ? ` title="${esc(name)}"` : ''}>${toggle}<span class="tv-cell-text">${nameHtml}</span>${pill}`
            + `${issue ? markHtml(issue.severity, issue.label) : ''}</div>`;
    }

    // -----------------------------------------------------------------------
    // The body's keys (§3.4)

    /** The active line's index (its key, else its person's row, else the first line). */
    private activeLineIndex(): number {
        if (!this.lines.length) return -1;
        const key = this.activeKey;
        if (key) {
            let at = this.lines.findIndex(l => lineKey(l) === key);
            if (at < 0) {
                const base = key.split('#')[0];
                at = this.lines.findIndex(l => lineKey(l) === base);
            }
            if (at >= 0) return at;
        }
        return 0;
    }

    /** Scroll a line and a column into view (drawing them), then focus the cell. */
    private focusCell(line: number, col: number): void {
        const input = this.input;
        if (!input || !this.lines.length) return;
        line = Math.max(0, Math.min(this.lines.length - 1, line));
        col = Math.max(0, Math.min(input.columns.length - 1, col));
        this.activeKey = lineKey(this.lines[line]);
        this.activeCol = col;
        const tops = this.lineTops(this.rowHeight());
        const headH = this.head.offsetHeight;
        const el = this.el;
        const top = tops[line];
        const bottom = tops[line + 1];
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom + headH > el.scrollTop + el.clientHeight) el.scrollTop = bottom + headH - el.clientHeight;
        if (col >= input.pinned) {
            const pinnedW = this.offsets[Math.min(input.pinned, input.columns.length)];
            const x = this.offsets[col];
            const w = input.widths[col];
            if (x - pinnedW < el.scrollLeft) el.scrollLeft = Math.max(0, x - pinnedW);
            else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
        }
        this.bodyKey = '';
        this.draw();
        this.focusActive(true);
    }

    /** Focus the active cell if it is drawn. */
    private focusActive(force: boolean): void {
        const at = this.activeLineIndex();
        const cell = this.body.querySelector<HTMLElement>(`.tv-row[data-index="${at}"] [aria-colindex="${this.activeCol + 1}"]`);
        if (cell && (force || document.activeElement !== cell)) cell.focus({ preventScroll: true });
    }

    private onBodyKey(e: KeyboardEvent): void {
        const input = this.input;
        if (!input || !this.lines.length) return;
        if (e.altKey) return;
        const at = this.activeLineIndex();
        const line = this.lines[at];
        const col = Math.min(this.activeCol, input.columns.length - 1);
        const onName = input.columns[col]?.id === 'name' && !input.bands?.[col];
        const page = Math.max(1, Math.floor((this.el.clientHeight - this.head.offsetHeight) / this.rowHeight()) - 1);
        const ctrl = e.ctrlKey || e.metaKey;
        let to: [number, number] | null = null;
        switch (e.key) {
            case 'ArrowDown': to = [at + 1, col]; break;
            case 'ArrowUp': to = [at - 1, col]; break;
            case 'PageDown': to = [at + page, col]; break;
            case 'PageUp': to = [at - page, col]; break;
            case 'Home': to = ctrl ? [0, 0] : [at, 0]; break;
            case 'End': to = ctrl ? [this.lines.length - 1, input.columns.length - 1] : [at, input.columns.length - 1]; break;
            case 'ArrowRight':
                if (onName && line.kind === 'row' && line.expanded === false) {
                    e.preventDefault();
                    this.handlers.onToggleUnions?.(line.row.id, true);
                    return;
                }
                to = [at, col + 1];
                break;
            case 'ArrowLeft':
                if (onName && line.kind === 'row' && line.expanded === true) {
                    e.preventDefault();
                    this.handlers.onToggleUnions?.(line.row.id, false);
                    return;
                }
                if (onName && line.kind !== 'row') {
                    const parent = this.lines.findIndex(l => l.kind === 'row' && l.row === line.row);
                    to = [parent >= 0 ? parent : at, col];
                    break;
                }
                to = [at, col - 1];
                break;
            case 'Enter':
            case ' ': {
                e.preventDefault();
                const cellEl = (e.target as Element).closest<HTMLElement>('[aria-colindex]');
                if (e.key === 'Enter' && line.kind !== 'more' && cellEl?.classList.contains('has-issue') && this.handlers.onIssue) {
                    this.handlers.onIssue(line, col, cellEl);
                    return;
                }
                if (line.kind === 'more') this.handlers.onRevealUnions?.(line.row.id);
                else this.handlers.onSelect?.(rowKey(line.row), line.row);
                return;
            }
            case '*':
                if (!input.subRows || !input.unionsButton) return;
                e.preventDefault();
                // The number pad: * expands, Shift+* collapses. A main keyboard needs Shift for * itself,
                // so there * does what the head's button says.
                this.handlers.onAllUnions?.(e.code === 'NumpadMultiply' ? !e.shiftKey : input.unionsButton === 'expand');
                return;
            default:
                return;
        }
        e.preventDefault();
        this.focusCell(to[0], to[1]);
    }

    /** Scroll a row into view (§8.3: the app's person search in the table) and draw. */
    revealKey(key: string): void {
        const at = this.lines.findIndex(l => lineKey(l) === key);
        if (at < 0) return;
        const tops = this.lineTops(this.rowHeight());
        const headH = this.head.offsetHeight;
        const view = Math.max(0, this.el.clientHeight - headH);
        if (tops[at] < this.el.scrollTop || tops[at + 1] > this.el.scrollTop + view) {
            this.el.scrollTop = Math.max(0, tops[at] - Math.round(view / 3));
        }
        this.activeKey = key;
        this.activeCol = 0;
        this.bodyKey = '';
        this.draw();
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
