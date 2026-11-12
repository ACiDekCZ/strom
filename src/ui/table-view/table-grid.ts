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
 *
 * The row's actions (§10.1): a click selects a row, ↑ ↓ move the selection,
 * Escape clears it; the first column carries ⌖ ▤ ✎ (under the pointer and on
 * the selected row), Enter opens the person, a double click edits, a right
 * click / Shift+F10 / the menu key ask for the row's menu. After a change a
 * row lights up for a moment (`flash`, §10.3) and a row that no longer
 * passes the filter stays dimmed with a note (`stale`).
 */

import { strings } from '../../strings.js';
import { cellPlainText, columnLabel, groupLabel, type ColumnDef, type SortSpec } from './table-columns.js';
import { rowKey, type CellName, type CellSeverity, type CellValue, type ResearchCellDetail, type ResearchSignal, type RowType, type TableModel, type TableRow } from './table-model.js';
import { columnRun, groupRuns, lockedColumn, MIN_COLUMN_WIDTH, type CollapsedBand } from './table-state.js';
import { columnOffsets, columnWindow, lineOffsets, lineWindow, type ColumnWindow } from './table-window.js';
import { lineCell, lineKey, lineLevel, plainLines, type GridLine } from './table-subrows.js';
import type { CoverageCell } from './table-coverage.js';
import { cellShownText, highlightHtml } from './table-filter.js';
import { copyPlainText } from './table-cell.js';
import { shownNameOrEmpty as personName } from '../../person-name.js';
import { AGENT_SPIN_MS, sharedPhaseDelay } from '../../card-signals.js';
import { PERSON_FINDINGS_COLUMNS } from './table-checks.js';

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
    /** The selected row is shared with other windows (spec 079 §2): its own look. */
    selectedShared?: boolean;
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
    /** Rows kept after a change that no longer pass the filter (§10.3, their row keys). */
    stale?: ReadonlySet<string>;
    /** The action icons in the first column (§10.1; `edit` false: read-only); none on a phone (10b). */
    actions?: { edit: boolean; tree?: boolean } | null;
    /** Live-only research columns while the research is not followed (§16.2: the head's dashed "live" tag). */
    liveOff?: ReadonlySet<string>;
    /** An open research conflict on a fact's cell (§16.3): ≠ before its value; null: none. */
    conflictAt?: (line: GridLine, col: ColumnDef, value: CellValue) => CellConflictMark | null;
    /** A research cell that opens its bubble (§16.4): a click, Enter or Space on it asks for it (`onResearch`). */
    researchAt?: (line: GridLine, col: ColumnDef, value: CellValue) => boolean;
    /** The agent at a row's person while the research is followed (§16.6): the bar on the name's left edge, ✓ once done. */
    agentAt?: (line: GridLine) => AgentRowState | null;
    /** A cell edited in place (T54 F8): it carries `is-editable` (the text cursor under a mouse). */
    editableAt?: (line: GridLine, col: ColumnDef) => boolean;
}

/**
 * A cell's editor (T54 F8): the field's text, its kind and what a save does.
 * `save` returns null when the text was saved (or nothing changed), else
 * the short error said under the field (the editor stays).
 */
export interface CellEditSpec {
    value: string;
    input: 'text' | 'date' | 'place' | 'select';
    /** The field's accessible name. */
    label: string;
    /** A datalist's id: the suggestions of a place. */
    list?: string;
    /** A choice's values with their words (T54 G3: the sex, a union's type). */
    options?: readonly { value: string; label: string }[];
    save(text: string): string | null;
}

/** The least width of an editor, wider than a narrow column (T54 F8: it goes over the cell's edge). */
const EDITOR_MIN_WIDTH: Record<CellEditSpec['input'], number> = { text: 160, date: 150, place: 240, select: 150 };

/** The agent at a row (§16.6): at work on its task, or just done. */
export type AgentRowState = { kind: 'working'; task: string } | { kind: 'done' };

/**
 * The agent's bar on the name's left edge (§16.6): a 3 px track with a
 * running segment, in step with every arc (the card's AGENT_SPIN_MS and
 * shared phase, so a redraw does not restart it); ✓ when it is done.
 */
export function agentRowHtml(state: AgentRowState | null): string {
    if (!state) return '';
    if (state.kind === 'done') return researchMarkHtml('done');
    const phase = sharedPhaseDelay(AGENT_SPIN_MS, (typeof document !== 'undefined' ? document.timeline?.currentTime as number | undefined : undefined) ?? performance.now());
    return `<span class="tv-agent-bar" aria-hidden="true"><span class="tv-agent-run" style="animation-delay:${phase}"></span></span>`;
}

/** A row's action (§10.1): show in the tree, open the person, edit. */
export type RowAction = 'tree' | 'open' | 'edit';

/** How long a changed row stays lit (§10.3). */
export const FLASH_MS = 1200;

/** A research conflict's ≠ on a cell (§16.3): its name for a screen reader ("1890, sources disagree: birth"). */
export interface CellConflictMark {
    label: string;
}

/** A finding's mark in a cell: its level (or `unusual`) and the finding's title (for the mark's name). */
export interface CellIssueMark {
    severity: CellSeverity;
    label: string;
}

/** A body cell: its column (drawn position `index`) and its value; not a collapsed group's band. */
export interface GridCellRef {
    col: ColumnDef;
    index: number;
    value: CellValue;
}

export interface GridHandlers {
    /** The grid scrolled (the view keeps its position per row type). */
    onScroll?(top: number, left: number): void;
    /** A row was selected (a click, ↑ ↓; a sub-row selects its person); null: Escape cleared it. */
    onSelect?(key: string | null, row: TableRow | null): void;
    /** A cell's editor closed (saved, Esc, blur): what waited for the edit may come now. */
    onEditClosed?(): void;
    /** A line was clicked or tapped, after its selection (a phone opens the row's sheet, 10b); the cell it was on. */
    onRowClick?(line: GridLine, cell: GridCellRef | null): void;
    /** A row's action (§10.1): its icon, Enter (open), a double click (edit). */
    onRowAction?(action: RowAction, line: GridLine): void;
    /**
     * A name in a cell was clicked or chosen by Enter (§14.1): a tree's person
     * (a link), a participant's name (its filter).
     */
    onName?(line: GridLine, col: ColumnDef, name: CellName, anchor: HTMLElement): void;
    /** The pill "+N" of a citation cell (§14.3): the further citations' bubble. */
    onMoreCites?(line: GridLine, col: ColumnDef, ids: readonly string[], anchor: HTMLElement): void;
    /** The row's menu (§10.1): a right click, Shift+F10, the menu key; the cell it is for (T54 F4). */
    onRowMenu?(line: GridLine, anchor: HTMLElement, cell: GridCellRef | null): void;
    /**
     * A cell to edit in place (T54 F8: a double click, F2, Enter): its
     * editor, or null when the cell is not edited there (a double click then
     * edits the row, Enter opens it).
     */
    onEditCell?(line: GridLine, cell: GridCellRef): CellEditSpec | null;
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
    /** The ≠ of a research conflict on a cell was clicked (§16.3): its line, its drawn column, the mark. */
    onConflict?(line: GridLine, col: number, mark: HTMLElement): void;
    /** A research cell was clicked, or Enter or Space pressed on it (§16.4): its line, its drawn column, the cell. */
    onResearch?(line: GridLine, col: number, cell: HTMLElement): void;
    /** A cell with a finding was clicked or Enter was pressed on it (§7.4): its line, its drawn column, the cell. */
    onIssue?(line: GridLine, col: number, cell: HTMLElement): void;
    /** A person's Findings or Highest level cell with a mark was clicked or Enter was pressed on it (§7.4): the person's findings. */
    onFindings?(line: GridLine, col: number, cell: HTMLElement): void;
    /** A tap on a completeness cell (§6.2): true when its bubble opened (touch; a mouse has the title). */
    onComp?(line: GridLine, col: number, cell: HTMLElement): boolean;
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
export function cellClasses(value: CellValue, col: ColumnDef, issue: CellSeverity | null = null, conflict = false): string {
    let cls = 'tv-cell';
    if (col.align === 'right') cls += ' tv-right';
    if (col.id === 'name' || col.id === 'p1' || col.id === 'p2' || col.id === 'evWho') cls += ' tv-name';
    if (col.id === 'srcTitle') cls += ' tv-src-title';
    if (value.aggregate) cls += ' tv-cell--aggregate';
    else if (value.na) cls += ' tv-cell--na';
    else if (value.computed && !value.empty && !value.research) cls += ' tv-cell--computed';
    if (value.uncertain) cls += ' tv-cell--uncertain';
    if (value.subst) cls += ' tv-cell--subst';
    if (value.ghost) cls += ' tv-cell--ghost';
    if (issue) cls += ` tv-cell--${issue} has-issue`;
    if (conflict) cls += ' has-conf';
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
export function cellInner(value: CellValue, col: ColumnDef, issue: CellIssueMark | null = null, hit = '', conflict: CellConflictMark | null = null): string {
    // A research conflict's ≠ stands before the value, a finding's mark stays after it (§16.3).
    const conf = conflict ? conflictMarkHtml(conflict) : '';
    if (issue) return conf + cellValueHtml(value, col, hit) + markHtml(issue.severity, issue.label);
    if (!value.mark) return conf + cellValueHtml(value, col, hit);
    // A level beside a value (Findings: after the number; Highest level: before its word).
    return col.align === 'right' ? cellValueHtml(value, col, hit) + markHtml(value.mark) : markHtml(value.mark) + cellValueHtml(value, col, hit);
}

/**
 * The ≠ of a research conflict on a fact's cell (§16.3): the research's
 * mark with its rim, a button that opens the conflicts (out of the tab
 * order until its cell is the active one, `syncNameTabs`).
 */
export function conflictMarkHtml(conflict: CellConflictMark): string {
    return `<button type="button" class="tv-rmark tv-rmark--conf tv-conf" tabindex="-1" aria-haspopup="dialog"`
        + ` aria-label="${esc(conflict.label)}" title="${esc(conflict.label)}">${RESEARCH_GLYPH.conf}</button>`;
}

function cellValueHtml(value: CellValue, col: ColumnDef, hit = ''): string {
    const html = cellValueCore(value, col, hit);
    return value.moreSources?.length && !value.na ? html + moreCitesHtml(value.moreSources.length) : html;
}

/**
 * The pill "+2" of a fact's further citations (§14.3): a button that opens
 * their bubble, out of the tab order until its cell is the active one.
 */
export function moreCitesHtml(n: number): string {
    return `<button type="button" class="tv-cites-more" tabindex="-1" aria-haspopup="dialog" aria-label="${esc(strings.table.moreCites(n))}">+${n}</button>`;
}

/** A research mark's glyph (§16.3; its look and legend: the marks' own styles). */
const RESEARCH_GLYPH: Record<ResearchSignal, string> = { wait: '!', ext: '!', conf: '≠', q: '?', agent: '', done: '✓', queue: '·', new: '•' };

/**
 * A research mark (§16.3): the card's marks with a rim (wait, conf, q), the
 * hollow "!" of a wait on others, the agent's arc (turning in step with
 * every other arc, as on the cards), ✓ done.
 */
export function researchMarkHtml(mark: ResearchSignal): string {
    const spin = mark === 'agent'
        ? ` style="animation-delay:${sharedPhaseDelay(AGENT_SPIN_MS, (typeof document !== 'undefined' ? document.timeline?.currentTime as number | undefined : undefined) ?? performance.now())}"`
        : '';
    return `<span class="tv-rmark tv-rmark--${mark}" aria-hidden="true"${spin}>${RESEARCH_GLYPH[mark]}</span>`;
}

/**
 * A research cell (§16.2, §16.9, §16.10): its mark, the count (600), "+n"
 * further kinds, then its parts each in its tone, weight and slant.
 */
export function researchHtml(d: ResearchCellDetail, hit = ''): string {
    const text = (t: string): string => (hit ? highlightHtml(t, hit) : esc(t));
    let html = d.signal ? researchMarkHtml(d.signal) : '';
    if (d.count !== undefined) html += `<span class="tv-rcount">${d.count}</span>`;
    if (d.more) html += `<span class="tv-rmore">+${d.more}</span>`;
    for (const part of d.parts) {
        const cls = ['tv-rpart', part.tone ? `tv-rtone--${part.tone}` : '', part.weight ? `tv-rw--${part.weight}` : '', part.italic ? 'tv-rpart--i' : '']
            .filter(Boolean).join(' ');
        html += `<span class="${cls}">${text(part.text)}</span>`;
    }
    return `<span class="tv-cell-text tv-rcell">${html}</span>`;
}

function cellValueCore(value: CellValue, col: ColumnDef, hit = ''): string {
    const r = value.research;
    if (r && !value.na && (r.parts.length > 0 || r.count !== undefined || r.signal)) return researchHtml(r, hit);
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
    if (value.names?.length && !value.na) return html + `<span class="tv-cell-text">${namesHtml(value.names, hit)}</span>`;
    if (value.link && !value.na) return html + linkHtml(value.link, hit);
    if (value.dots && !value.na) return html + readersHtml(value, hit);
    return html + `<span class="tv-cell-text">${hit && !value.na ? highlightHtml(cellText(value), hit) : esc(cellText(value))}</span>`;
}

/**
 * A web address in a cell (§14.2 Online): a link into a new window with ↗,
 * out of the tab order until its cell is the active one (`syncNameTabs`).
 */
export function linkHtml(link: { href: string; label: string }, hit = ''): string {
    const label = hit ? highlightHtml(link.label, hit) : esc(link.label);
    return `<span class="tv-cell-text"><a class="tv-link" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer" tabindex="-1">${label}`
        + `<span class="tv-link-out" aria-hidden="true"> ↗</span></a></span>`;
}

/** The readers of a source (§14.2): the reliability pill's dots (spec 066) and the count, inert. */
export function readersHtml(value: CellValue, hit = ''): string {
    const dots = (value.dots ?? []).map(on => (on ? '<i class="on"></i>' : '<i></i>')).join('');
    const text = hit ? highlightHtml(value.text, hit) : esc(value.text);
    return `<span class="fact-status tv-readers"><span class="fs-dots" aria-hidden="true">${dots}</span><span class="fs-text">${text}</span></span>`;
}

/**
 * The names of a cell (§14.1): a tree's person as a link, a participant's
 * name as a button that offers its filter, any other name as text. Out of
 * the tab order until their cell is the active one (`syncNameTabs`).
 */
export function namesHtml(names: readonly CellName[], hit = ''): string {
    return names.map((n, i) => {
        const text = hit ? highlightHtml(n.text, hit) : esc(n.text);
        if (!n.personId && !n.role) return `<span>${text}</span>`;
        return `<button type="button" class="tv-nm${n.personId ? ' tv-nm--person' : ''}" data-ni="${i}" tabindex="-1"`
            + `${n.role ? ' aria-haspopup="menu"' : ''}>${text}</button>`;
    }).join(', ');
}

/** A row as drawn: its opening tag and its cells (spacers included), each one element. */
interface DrawnRow {
    key: string;
    open: string;
    cells: string[];
}

/** A cell's HTML compared without an animation's shared phase (it moves with the clock, not with the content). */
function drawnForm(html: string): string {
    return html.includes('animation-delay:') ? html.replace(/animation-delay:[^;"]*/g, '') : html;
}

function elementOf(html: string): Element {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild!;
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
    /**
     * The active cell was chosen (a click, a right click, the keys; T54 F9):
     * it carries a quiet outline. A jump to a row (the person in focus coming
     * into the table, the app's search) only makes the row active.
     */
    private cellChosen = false;
    /** The rows last drawn, so a redraw of the same rows replaces only the cells that changed (§16.6). */
    private drawnRows: DrawnRow[] = [];
    /** The agent's bars stop while out of sight (§16.6). */
    private agentBars: IntersectionObserver | null = null;
    /** The rows lit after a change (row keys, §10.3) and the timer that ends it. */
    private readonly flashKeys = new Set<string>();
    private flashTimer: ReturnType<typeof setTimeout> | null = null;
    /** The open cell editor (T54 F8): over the cell, in the scrolled area (outside the body, so a redraw keeps it). */
    private editor: { key: string; colId: string; box: HTMLElement; input: HTMLInputElement | HTMLSelectElement; error: HTMLElement; spec: CellEditSpec } | null = null;

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
            this.placeEditor();
        }, { passive: true });
        this.body.addEventListener('click', (e) => {
            const t = e.target as Element;
            const rowEl = t.closest<HTMLElement>('.tv-row[data-key]');
            const line = rowEl ? this.lines[Number(rowEl.dataset.index)] : undefined;
            const cellEl = t.closest<HTMLElement>('[aria-colindex]');
            if (line && cellEl) this.chooseCell(line, cellEl);
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
            const nm = t.closest<HTMLElement>('.tv-nm[data-ni]');
            if (nm && cellEl && this.nameAt(line, cellEl, nm)) return;
            const more = t.closest<HTMLElement>('.tv-cites-more');
            if (more && cellEl && this.moreCitesAt(line, cellEl, more)) return;
            // A web address opens its own window (§14.2); the row stays as it is.
            if (t.closest('a.tv-link')) return;
            const conf = t.closest<HTMLElement>('.tv-conf');
            if (conf && cellEl && this.handlers.onConflict) {
                this.select(line);
                this.handlers.onConflict(line, Number(cellEl.getAttribute('aria-colindex')) - 1, conf);
                return;
            }
            const act = t.closest<HTMLElement>('.tv-act[data-act]');
            if (act) {
                this.select(line);
                this.handlers.onRowAction?.(act.dataset.act as RowAction, line);
                return;
            }
            if (cellEl?.classList.contains('has-issue') && this.handlers.onIssue) {
                this.handlers.onIssue(line, Number(cellEl.getAttribute('aria-colindex')) - 1, cellEl);
                return;
            }
            if (cellEl?.classList.contains('has-res') && this.handlers.onResearch) {
                this.select(line);
                this.handlers.onResearch(line, Number(cellEl.getAttribute('aria-colindex')) - 1, cellEl);
                return;
            }
            if (cellEl?.classList.contains('has-finds') && this.handlers.onFindings) {
                this.select(line);
                this.handlers.onFindings(line, Number(cellEl.getAttribute('aria-colindex')) - 1, cellEl);
                return;
            }
            this.select(line);
            if (cellEl?.querySelector('.tv-comp') && this.handlers.onComp?.(line, Number(cellEl.getAttribute('aria-colindex')) - 1, cellEl)) return;
            this.handlers.onRowClick?.(line, this.cellRefOf(line, cellEl));
        });
        // A double click edits (§10.1); the ▾/▸, the count pill and the icons are their own.
        this.body.addEventListener('dblclick', (e) => {
            const t = e.target as Element;
            if (t.closest('.tv-toggle, .tv-unions-pill, .tv-act, .tv-more-btn, .tv-nm, .tv-link, .tv-cites-more, .tv-conf')) return;
            const line = this.lineOf(t);
            if (!line || line.kind === 'more') return;
            // A cell edited in place (T54 F8) opens its editor; any other cell edits the row.
            const ref = this.cellRefOf(line, t.closest<HTMLElement>('[aria-colindex]'));
            if (ref && this.startEdit(line, ref)) return;
            this.handlers.onRowAction?.('edit', line);
        });
        this.body.addEventListener('contextmenu', (e) => {
            const t = e.target as Element;
            const line = this.lineOf(t);
            if (!line || line.kind === 'more' || !this.handlers.onRowMenu) return;
            e.preventDefault();
            const cellEl = t.closest<HTMLElement>('[aria-colindex]');
            if (cellEl) this.chooseCell(line, cellEl);
            const ref = this.cellRefOf(line, cellEl);
            const anchor = cellEl ?? t.closest<HTMLElement>('.tv-row')!;
            this.select(line);
            this.handlers.onRowMenu(line, this.liveAnchor(line, anchor), ref);
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
            this.cellChosen = true;
            for (const other of this.body.querySelectorAll<HTMLElement>('[aria-colindex][tabindex="0"]')) if (other !== cellEl) other.tabIndex = -1;
            cellEl.tabIndex = 0;
            this.syncNameTabs();
            this.syncActiveMark();
        });
        this.wireHead();
        this.resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.schedule()) : null;
        this.resize?.observe(el);
    }

    /** New rows or columns: drawn now; `scroll` restores a kept position. */
    /** The line a body element belongs to. */
    private lineOf(t: Element): GridLine | undefined {
        const rowEl = t.closest<HTMLElement>('.tv-row[data-index]');
        return rowEl ? this.lines[Number(rowEl.dataset.index)] : undefined;
    }

    /** A name of a cell (§14.1) to its handler; false: not a name the cell lists. */
    private nameAt(line: GridLine, cellEl: HTMLElement, nm: HTMLElement): boolean {
        const input = this.input;
        if (!input || line.kind === 'more' || !this.handlers.onName) return false;
        const col = input.columns[Number(cellEl.getAttribute('aria-colindex')) - 1];
        const name = col ? lineCell(input.model, line, col).names?.[Number(nm.dataset.ni)] : undefined;
        if (!col || !name) return false;
        this.handlers.onName(line, col, name, nm);
        return true;
    }

    /** The pill "+N" of a citation cell (§14.3) to its handler; false: the cell has no further citations. */
    private moreCitesAt(line: GridLine, cellEl: HTMLElement, btn: HTMLElement): boolean {
        const input = this.input;
        if (!input || line.kind === 'more' || !this.handlers.onMoreCites) return false;
        const col = input.columns[Number(cellEl.getAttribute('aria-colindex')) - 1];
        const ids = col ? lineCell(input.model, line, col).moreSources : undefined;
        if (!col || !ids?.length) return false;
        this.handlers.onMoreCites(line, col, ids, btn);
        return true;
    }

    /** A cell clicked or right-clicked becomes the active one (T54 F9). */
    private chooseCell(line: GridLine, cellEl: HTMLElement): void {
        this.activeKey = lineKey(line);
        this.activeCol = Number(cellEl.getAttribute('aria-colindex')) - 1;
        this.cellChosen = true;
        this.syncActiveMark();
        // The click's caret left in a cut text hides its "…" (Chromium paints
        // a box holding the selection without its ellipsis): drop it. A text
        // selected by hand (not collapsed) stays for its copy.
        const sel = document.getSelection();
        if (sel?.rangeCount && sel.isCollapsed && cellEl.contains(sel.anchorNode)) sel.removeAllRanges();
    }

    /** A body cell's column and value; null for a collapsed group's band or the "more" line. */
    private cellRefOf(line: GridLine, cellEl: HTMLElement | null | undefined): GridCellRef | null {
        const input = this.input;
        if (!input || !cellEl || line.kind === 'more' || cellEl.classList.contains('tv-band')) return null;
        const index = Number(cellEl.getAttribute('aria-colindex')) - 1;
        const col = input.columns[index];
        if (!col || input.bands?.[index]) return null;
        return { col, index, value: lineCell(input.model, line, col) };
    }

    /**
     * The active cell (T54 F9; F8 edits it by F2 / Enter): its line, column
     * and element (null while out of the drawn window); null without a chosen one.
     */
    activeCell(): { line: GridLine; cell: GridCellRef; el: HTMLElement | null } | null {
        if (!this.cellChosen || !this.activeKey || !this.input) return null;
        const at = this.lines.findIndex(l => lineKey(l) === this.activeKey);
        const line = at >= 0 ? this.lines[at] : undefined;
        const col = this.input.columns[this.activeCol];
        if (!line || !col || line.kind === 'more' || this.input.bands?.[this.activeCol]) return null;
        const el = this.body.querySelector<HTMLElement>(`.tv-row[data-index="${at}"] [aria-colindex="${this.activeCol + 1}"]`);
        return { line, cell: { col, index: this.activeCol, value: lineCell(this.input.model, line, col) }, el };
    }

    /** The quiet outline on the chosen active cell (T54 F9), off everywhere else. */
    private syncActiveMark(): void {
        for (const c of this.body.querySelectorAll('.is-active-cell')) c.classList.remove('is-active-cell');
        if (!this.cellChosen || !this.activeKey) return;
        const at = this.lines.findIndex(l => lineKey(l) === this.activeKey);
        if (at < 0) return;
        this.body.querySelector(`.tv-row[data-index="${at}"] [aria-colindex="${this.activeCol + 1}"]`)?.classList.add('is-active-cell');
    }

    /** The names of the active cell (the one with the body's tab stop) in the tab order, the others out (§14.1). */
    private syncNameTabs(): void {
        for (const b of this.body.querySelectorAll<HTMLElement>('.tv-nm[data-ni], .tv-link, .tv-cites-more, .tv-conf')) {
            b.tabIndex = b.closest('[aria-colindex]')?.getAttribute('tabindex') === '0' ? 0 : -1;
        }
    }

    /**
     * The element a menu opens at after a select: selecting another row draws
     * the rows anew, so the cell clicked is no longer on the page (a menu at
     * it opened in the window's corner, T54 G7). The same cell (or row) as
     * drawn now; the element itself while it is still there.
     */
    private liveAnchor(line: GridLine, el: HTMLElement): HTMLElement {
        if (el.isConnected) return el;
        const at = this.lines.findIndex(l => lineKey(l) === lineKey(line));
        const rowEl = at >= 0 ? this.body.querySelector<HTMLElement>(`.tv-row[data-index="${at}"]`) : null;
        if (!rowEl) return el;
        const col = el.getAttribute('aria-colindex');
        return (col ? rowEl.querySelector<HTMLElement>(`[aria-colindex="${col}"]`) : null) ?? rowEl;
    }

    /** Select a line's row (its person for a sub-row) unless it is the selected one. */
    private select(line: GridLine): void {
        const key = rowKey(line.row);
        if (this.input?.selected !== key) this.handlers.onSelect?.(key, line.row);
    }

    /**
     * Light these rows up (row keys, §10.3): `--primary-soft` for FLASH_MS,
     * then back over 400 ms (the class `is-flash-out` carries the transition).
     */
    flash(keys: Iterable<string>, ms = FLASH_MS): void {
        for (const k of keys) this.flashKeys.add(k);
        if (!this.flashKeys.size) return;
        if (this.flashTimer) clearTimeout(this.flashTimer);
        this.bodyKey = '';
        this.draw();
        this.flashTimer = setTimeout(() => {
            this.flashTimer = null;
            this.flashKeys.clear();
            for (const el of this.body.querySelectorAll<HTMLElement>('.tv-row.is-flash')) {
                el.classList.add('is-flash-out');
                el.classList.remove('is-flash');
            }
        }, ms);
    }

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
        this.syncEditor();
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
        this.placeEditor();
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
            const liveOff = !!input.liveOff?.has(col.id);
            const liveTag = liveOff ? `<span class="tv-live-tag" title="${esc(strings.table.res.liveOnly)}">${esc(strings.table.res.liveTag)}</span>` : '';
            const headName = liveOff ? `${label} (${strings.table.res.liveOnly})` : label;
            const right = col.align === 'right' ? ' tv-right' : '';
            const computed = col.computed ? ' is-computed' : '';
            names += `<div class="tv-cell tv-headcell${right}${computed}${this.pinClass(i, input)}" role="columnheader"`
                + ` aria-colindex="${i + 1}" data-col="${esc(col.id)}" data-index="${i}" tabindex="${col.id === focusCol ? 0 : -1}"`
                + ` title="${esc(headName)}" aria-label="${esc(headName)}"${ariaSort} style="${this.pinStyle(i, input)}">`
                + `<span class="tv-cell-text">${esc(label)}</span>${liveTag}${arrow}${filtered}`
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
        const drawn: DrawnRow[] = [];
        for (let r = start; r < end; r++) {
            const line = this.lines[r];
            const row = line.row;
            const key = lineKey(line);
            const home = row.kind === 'person' && row.id === input.homeId ? ' is-home' : '';
            const rk = rowKey(row);
            const rowSelected = rk === selectedPerson;
            let attrs = ` aria-level="${lineLevel(line)}"`;
            let cls = 'tv-row' + home;
            if (line.kind !== 'more' && this.flashKeys.has(rk)) cls += ' is-flash';
            if (input.stale?.has(rk)) cls += ' is-stale';
            if (line.kind === 'row') {
                attrs += ` aria-selected="${rowSelected ? 'true' : 'false'}"`;
                if (rowSelected && input.selectedShared) cls += ' is-shared';
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
            const open = `<div class="${cls}" role="row" data-key="${esc(key)}" data-index="${r}" aria-rowindex="${r + 4}"${attrs}`
                + ` style="top:${tops[r]}px;height:${tops[r + 1] - tops[r]}px;width:${cw.total}px">`;
            const cells: string[] = [];
            let prev = -1;
            const tailAt = this.tailColumn(input);
            for (const i of cw.indices) {
                if (prev >= 0 && i !== prev + 1 && cw.before > 0) cells.push(this.spacer(cw.before));
                prev = i;
                const col = input.columns[i];
                const tab = r === activeLine && i === activeCol ? 0 : -1;
                const band = input.bands?.[i];
                if (band) {
                    cells.push(`<div class="tv-cell tv-band" role="gridcell" aria-colindex="${i + 1}" tabindex="${tab}" data-band="${esc(band.group)}"`
                        + ` style="width:${input.widths[i]}px">${line.kind === 'more' ? '' : input.bandCell?.(line, band) ?? ''}</div>`);
                    continue;
                }
                if (input.subRows && col.id === 'name') {
                    cells.push(this.nameCell(input, line, col, i, tab, i === tailAt ? this.rowTail(input, line) : ''));
                    continue;
                }
                const value = lineCell(input.model, line, col);
                const issue = line.kind === 'more' ? null : input.issueAt?.(line, col, value) ?? null;
                const conflict = line.kind === 'more' ? null : input.conflictAt?.(line, col, value) ?? null;
                const substTip = value.subst ? (value.subst === 'bap' ? strings.table.subst.bap : strings.table.subst.bur) : '';
                const title = value.title ?? (substTip || (value.text.length > 24 ? value.text : ''));
                const res = line.kind !== 'more' && !issue && !!input.researchAt?.(line, col, value);
                // §7.4: Findings and Highest level with a mark open the person's findings.
                const finds = line.kind === 'row' && line.row.kind === 'person' && !issue && !!value.mark && PERSON_FINDINGS_COLUMNS.has(col.id);
                const editable = line.kind !== 'more' && !!input.editableAt?.(line, col);
                cells.push(`<div class="${cellClasses(value, col, issue?.severity ?? null, !!conflict)}${res ? ' has-res' : ''}${finds ? ' has-finds' : ''}${editable ? ' is-editable' : ''}${this.pinClass(i, input)}" role="gridcell" aria-colindex="${i + 1}" tabindex="${tab}"`
                    + (res || finds ? ' aria-haspopup="dialog"' : '')
                    + ` style="${this.pinStyle(i, input)}"${title ? ` title="${esc(title)}"` : ''}>${cellInner(value, col, issue, line.kind === 'more' ? '' : input.hit ?? '', conflict)}`
                    + `${i === tailAt ? this.rowTail(input, line) : ''}</div>`);
            }
            if (cw.after > 0) cells.push(this.spacer(cw.after));
            drawn.push({ key, open, cells });
        }
        this.paintBody(drawn);
        this.syncNameTabs();
        this.syncActiveMark();
        if (refocus) this.focusActive(false);
    }

    /**
     * Put the drawn rows in the body. A row drawn last time under the same
     * key in the same place (a live change of the research's signals, §16.6;
     * a selection; a row passing the filter now, put after the others) keeps
     * its element: only its cells whose HTML changed are replaced, the rest
     * stay as they are (no new layout, a running bar runs on). Other rows are
     * drawn anew; with none to keep, the body anew.
     */
    private paintBody(rows: DrawnRow[]): void {
        const last = this.drawnRows;
        this.drawnRows = rows;
        const els = Array.from(this.body.children);
        const byKey = new Map<string, { el: Element; drawn: DrawnRow }>();
        if (els.length === last.length) last.forEach((d, i) => byKey.set(d.key, { el: els[i], drawn: d }));
        const whole = (): void => {
            this.body.innerHTML = rows.map(r => r.open + r.cells.join('') + '</div>').join('');
            this.watchAgentBars();
        };
        if (byKey.size === 0 || byKey.size !== last.length) { whole(); return; }
        const next: Element[] = [];
        let kept = 0;
        let changed = false;
        for (const now of rows) {
            const old = byKey.get(now.key);
            if (old) byKey.delete(now.key);
            if (!old || old.drawn.open !== now.open || old.drawn.cells.length !== now.cells.length || old.el.children.length !== now.cells.length) {
                if (old) old.el.remove();
                next.push(elementOf(now.open + now.cells.join('') + '</div>'));
                changed = true;
                continue;
            }
            kept++;
            for (let c = 0; c < now.cells.length; c++) {
                const was = old.drawn.cells[c];
                if (now.cells[c] === was || drawnForm(now.cells[c]) === drawnForm(was)) continue;
                old.el.children[c].replaceWith(elementOf(now.cells[c]));
                changed = true;
            }
            next.push(old.el);
        }
        if (kept === 0) { whole(); return; }
        for (const gone of byKey.values()) { gone.el.remove(); changed = true; }
        const body = this.body.children;
        next.forEach((el, i) => { if (body[i] !== el) { this.body.insertBefore(el, body[i] ?? null); changed = true; } });
        if (changed) this.watchAgentBars();
    }

    /** The agent's bars drawn now, paused while out of sight (a row under the head, the table off screen). */
    private watchAgentBars(): void {
        this.agentBars?.disconnect();
        const bars = this.body.querySelectorAll<HTMLElement>('.tv-agent-bar');
        if (!bars.length || typeof IntersectionObserver !== 'function') return;
        this.agentBars ??= new IntersectionObserver((entries) => {
            for (const e of entries) e.target.classList.toggle('is-paused', !e.isIntersecting);
        });
        for (const bar of bars) this.agentBars.observe(bar);
    }

    /**
     * The column that carries the row's tail: the locked one (the name), wherever
     * it stands in the pinned zone (spec 082 K2.1); in the Events table the person
     * or couple when it is pinned (the narrow Type keeps its text, §14.1).
     */
    private tailColumn(input: GridInput): number {
        if (input.type === 'events') {
            const who = input.columns.findIndex(c => c.id === 'evWho');
            if (who >= 0 && who < input.pinned) return who;
        }
        const lock = lockedColumn(input.type);
        const at = input.columns.findIndex((c, i) => c.id === lock && !input.bands?.[i]);
        return at >= 0 ? at : 0;
    }

    /**
     * The end of a line's first cell (§10.1, §10.3): "no longer matches" on a
     * stale row, then the action icons (shown by the stylesheet under the
     * pointer and on the selected row).
     */
    private rowTail(input: GridInput, line: GridLine): string {
        if (line.kind === 'more') return '';
        let html = '';
        if (line.kind === 'row' && input.stale?.has(rowKey(line.row))) {
            html += `<span class="tv-stale-note">${esc(strings.table.staleRow)}</span>`;
        }
        const acts = input.actions;
        if (acts) {
            const t = strings.table.act;
            const b = (act: RowAction, icon: string, label: string): string =>
                `<button type="button" class="tv-act" data-act="${act}" tabindex="-1" title="${esc(label)}" aria-label="${esc(label)}">`
                + `<span aria-hidden="true">${icon}</span></button>`;
            // A source is not in the tree (§14.2): Open source and Edit, both its dialog.
            html += line.row.kind === 'source'
                ? `<span class="tv-acts">${b('open', '▤', t.openSource)}${acts.edit ? b('edit', '✎', t.edit) : ''}</span>`
                : `<span class="tv-acts">${acts.tree === false ? '' : b('tree', '⌖', t.tree)}${b('open', '▤', t.open)}${acts.edit ? b('edit', '✎', t.edit) : ''}</span>`;
        }
        return html;
    }

    /** The name cell of the People table (§3.1, §3.2): ▾/▸ and the count pill, a sub-row's "Union k of n", the "more" button. */
    private nameCell(input: GridInput, line: GridLine, col: ColumnDef, i: number, tab: number, tail = ''): string {
        const t = strings.table;
        const open = `<div class="tv-cell tv-name${this.pinClass(i, input)}" role="gridcell" aria-colindex="${i + 1}" tabindex="${tab}" style="${this.pinStyle(i, input)}"`;
        if (line.kind === 'more') {
            return `${open}><span class="tv-sub-indent" aria-hidden="true"></span>`
                + `<button type="button" class="tv-more-btn" tabindex="-1">${esc(t.hiddenUnions(line.hidden))}</button></div>`;
        }
        if (line.kind === 'sub') {
            return `${open}><span class="tv-sub-indent" aria-hidden="true"></span><span class="tv-sub-branch" aria-hidden="true">└</span>`
                + `<span class="tv-cell-text tv-sub-label">${esc(t.unionKofN(line.k, line.n))}</span>${tail}</div>`;
        }
        const value = lineCell(input.model, line, col);
        const name = cellText(value);
        const issue = input.issueAt?.(line, col, value) ?? null;
        const conflict = input.conflictAt?.(line, col, value) ?? null;
        const toggle = line.expanded === null
            ? '<span class="tv-toggle tv-toggle--none" aria-hidden="true"></span>'
            : `<span class="tv-toggle" aria-hidden="true" title="${esc(line.expanded ? `${t.collapseAll} (←)` : `${t.expandAll} (→)`)}">${line.expanded ? '▾' : '▸'}</span>`;
        const pill = line.expanded === false ? `<span class="tv-unions-pill" aria-hidden="true">${esc(t.unionsN(line.n))}</span>` : '';
        const head = issue
            ? `<div class="tv-cell tv-name tv-cell--${issue.severity} has-issue${conflict ? ' has-conf' : ''}${this.pinClass(i, input)}" role="gridcell" aria-colindex="${i + 1}" tabindex="${tab}" style="${this.pinStyle(i, input)}"`
            : conflict ? open.replace('class="tv-cell tv-name', 'class="tv-cell tv-name has-conf') : open;
        const nameHtml = input.hit ? highlightHtml(name, input.hit) : esc(name);
        const agent = line.kind === 'row' ? input.agentAt?.(line) ?? null : null;
        const bar = agent?.kind === 'working' ? agentRowHtml(agent) : '';
        const done = agent?.kind === 'done' ? agentRowHtml(agent) : '';
        const start = bar ? head.replace('class="tv-cell tv-name', 'class="tv-cell tv-name has-agent') : head;
        return `${start}${name.length > 24 ? ` title="${esc(name)}"` : ''}>${bar}${toggle}${conflict ? conflictMarkHtml(conflict) : ''}<span class="tv-cell-text">${nameHtml}</span>${done}${pill}`
            + `${issue ? markHtml(issue.severity, issue.label) : ''}${tail}</div>`;
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
        this.cellChosen = true;
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
        if (this.copyKey(e)) return;
        if (e.altKey) return;
        // A name in a cell (§14.1) is a button: Enter and Space are its own.
        if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).closest?.('.tv-nm, .tv-link, .tv-cites-more, .tv-conf')) return;
        const at = this.activeLineIndex();
        const line = this.lines[at];
        const col = Math.min(this.activeCol, input.columns.length - 1);
        const onName = input.columns[col]?.id === 'name' && !input.bands?.[col];
        const page = Math.max(1, Math.floor((this.el.clientHeight - this.head.offsetHeight) / this.rowHeight()) - 1);
        const ctrl = e.ctrlKey || e.metaKey;
        let to: [number, number] | null = null;
        // ↑ ↓ (and the page and Ctrl+Home/End jumps) move the selection with the focus (§10.1).
        let selects = false;
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
            if (line.kind === 'more' || !this.handlers.onRowMenu) return;
            e.preventDefault();
            const cellEl = (e.target as Element).closest<HTMLElement>('[aria-colindex]');
            if (cellEl) this.chooseCell(line, cellEl);
            const ref = this.cellRefOf(line, cellEl);
            const anchor = cellEl ?? (e.target as HTMLElement);
            this.select(line);
            this.handlers.onRowMenu(line, this.liveAnchor(line, anchor), ref);
            return;
        }
        // F2 edits the active cell in place (T54 F8).
        if (e.key === 'F2' && !ctrl && !e.shiftKey) {
            e.preventDefault();
            if (line.kind !== 'more') this.startEditAt(at, col);
            return;
        }
        switch (e.key) {
            case 'Escape':
                if (!input.selected) return;
                e.preventDefault();
                e.stopPropagation();
                this.handlers.onSelect?.(null, null);
                return;
            case 'ArrowDown': to = [at + 1, col]; selects = true; break;
            case 'ArrowUp': to = [at - 1, col]; selects = true; break;
            case 'PageDown': to = [at + page, col]; selects = true; break;
            case 'PageUp': to = [at - page, col]; selects = true; break;
            case 'Home': to = ctrl ? [0, 0] : [at, 0]; selects = ctrl; break;
            case 'End': to = ctrl ? [this.lines.length - 1, input.columns.length - 1] : [at, input.columns.length - 1]; selects = ctrl; break;
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
                if (e.key === 'Enter' && line.kind !== 'more' && cellEl?.classList.contains('has-finds') && this.handlers.onFindings) {
                    this.select(line);
                    this.handlers.onFindings(line, col, cellEl);
                    return;
                }
                if (line.kind !== 'more' && cellEl?.classList.contains('has-res') && this.handlers.onResearch) {
                    this.select(line);
                    this.handlers.onResearch(line, col, cellEl);
                    return;
                }
                if (line.kind === 'more') { this.handlers.onRevealUnions?.(line.row.id); return; }
                this.select(line);
                // Enter edits a cell edited in place (T54 F8), else opens the person (§10.1); Space only selects.
                if (e.key === 'Enter' && !this.startEditAt(at, col)) this.handlers.onRowAction?.('open', line);
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
        if (selects) {
            const now = this.lines[this.activeLineIndex()];
            if (now) this.select(now);
        }
    }

    /**
     * Ctrl/Cmd+C (T54 F9): with no text selected, the active cell's shown
     * text (no marks or icons); a selection made by the mouse copies as usual.
     * True when the key was this one.
     */
    private copyKey(e: KeyboardEvent): boolean {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key.toLowerCase() !== 'c' && e.code !== 'KeyC')) return false;
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (sel && !sel.isCollapsed && sel.toString().trim()) return true;
        const cellEl = (e.target as Element).closest<HTMLElement>('[aria-colindex]');
        const line = this.lineOf(e.target as Element);
        const ref = line ? this.cellRefOf(line, cellEl) : null;
        const text = ref ? cellShownText(ref.value) : '';
        if (!text) return true;
        e.preventDefault();
        copyPlainText(text);
        return true;
    }

    // -----------------------------------------------------------------------
    // The cell's editor (T54 F8)

    /** The active cell edited in place (the row menu's "Edit cell"); false: it is not edited there. */
    editActive(): boolean {
        const at = this.activeLineIndex();
        return at >= 0 && this.startEditAt(at, this.activeCol);
    }

    /** The cell's editor is open. */
    isEditing(): boolean {
        return !!this.editor;
    }

    /** The open editor's row and column (null: none open). */
    editingCell(): { key: string; colId: string } | null {
        const ed = this.editor;
        return ed ? { key: ed.key, colId: ed.colId } : null;
    }

    /**
     * A cell's text the tree did not take (spec 079 §3.4: the edit was refused,
     * the tree is fresh): the editor opens again over the cell with that text,
     * framed as a draft with `note` under it — Enter saves it on the fresh
     * tree, Esc drops it. An open editor (another cell) is kept as it is and
     * framed instead. False when the row or the column is not drawn.
     */
    reopenDraft(key: string, colId: string, text: string, note: string): boolean {
        if (this.markOpenDraft(note)) return true;
        const input = this.input;
        const at = this.lines.findIndex(l => lineKey(l) === key);
        const col = input ? input.columns.findIndex(c => c.id === colId) : -1;
        if (at < 0 || col < 0) return false;
        this.focusCell(at, col);
        if (!this.startEditAt(at, col) || !this.editor) return false;
        const field = (this.editor as { input: HTMLInputElement | HTMLSelectElement }).input;
        field.value = text;
        if (field instanceof HTMLInputElement) field.select();
        this.markDraft(note);
        return true;
    }

    /** The open editor framed as a kept draft (false: none is open). */
    markOpenDraft(note: string): boolean {
        if (!this.editor) return false;
        this.markDraft(note);
        return true;
    }

    /** The open editor framed as a kept draft, its note under the cell. */
    private markDraft(note: string): void {
        const ed = this.editor;
        if (!ed) return;
        ed.box.classList.add('is-draft-kept');
        let bubble = ed.box.querySelector<HTMLElement>('.tv-draft-kept');
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.className = 'tv-draft-kept';
            bubble.setAttribute('role', 'status');
            ed.box.append(bubble);
        }
        bubble.textContent = note;
    }

    /** A drawn line's cell edited in place, by the line's index and the column's drawn position. */
    private startEditAt(at: number, col: number): boolean {
        const line = this.lines[at];
        const input = this.input;
        if (!line || !input || line.kind === 'more' || input.bands?.[col]) return false;
        const def = input.columns[col];
        if (!def) return false;
        return this.startEdit(line, { col: def, index: col, value: lineCell(input.model, line, def) });
    }

    /** Open the editor over a cell when its handler gives one (an open editor is saved first). */
    private startEdit(line: GridLine, ref: GridCellRef): boolean {
        if (line.kind === 'more' || !this.handlers.onEditCell) return false;
        if (this.editor && !this.commitEdit(null)) return true;
        const spec = this.handlers.onEditCell(line, ref);
        if (!spec) return false;
        this.activeKey = lineKey(line);
        this.activeCol = ref.index;
        this.cellChosen = true;
        this.syncActiveMark();
        const box = document.createElement('div');
        box.className = 'tv-editor';
        box.dataset.input = spec.input;
        let field: HTMLInputElement | HTMLSelectElement;
        // A choice (T54 G3): its values in a select; a value picked with the mouse saves at once.
        let picked = false;
        if (spec.input === 'select') {
            const select = document.createElement('select');
            for (const o of spec.options ?? []) select.add(new Option(o.label, o.value, false, o.value === spec.value));
            select.value = spec.value;
            select.addEventListener('pointerdown', () => { picked = true; });
            select.addEventListener('change', () => { if (picked && this.editor?.input === select && this.commitEdit(null)) this.focusActive(true); });
            field = select;
        } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.value = spec.value;
            if (spec.list) input.setAttribute('list', spec.list);
            field = input;
        }
        field.className = 'tv-editor-input';
        field.setAttribute('aria-label', spec.label);
        const error = document.createElement('div');
        error.className = 'tv-editor-error';
        error.id = `tv-editor-error-${Date.now().toString(36)}`;
        error.setAttribute('role', 'alert');
        error.hidden = true;
        field.setAttribute('aria-describedby', error.id);
        box.append(field, error);
        const ed = { key: lineKey(line), colId: ref.col.id, box, input: field, error, spec };
        this.editor = ed;
        this.el.appendChild(box);
        (field as HTMLElement).addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                if (this.commitEdit(null)) this.focusActive(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeEdit(true);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                this.commitEdit(e.shiftKey ? -1 : 1);
            }
        });
        field.addEventListener('input', () => { if (!error.hidden) { error.hidden = true; box.classList.remove('has-error'); } });
        // A click elsewhere saves; a date that cannot be read keeps the editor with its error.
        field.addEventListener('blur', () => { if (this.editor === ed) this.commitEdit(null, true); });
        this.placeEditor();
        field.focus({ preventScroll: true });
        if (field instanceof HTMLInputElement) field.select();
        return true;
    }

    /**
     * Save the editor's text. Saved: the editor closes and, with `step`
     * (Tab ±1), the next cell edited in place in the row opens; not saved:
     * the error under the field, the editor stays. True when saved.
     */
    private commitEdit(step: 1 | -1 | null, fromBlur = false): boolean {
        const ed = this.editor;
        if (!ed) return true;
        const error = ed.spec.save(ed.input.value);
        if (this.editor !== ed) return error === null;
        if (error !== null) {
            ed.error.textContent = error;
            ed.error.hidden = false;
            ed.box.classList.add('has-error');
            ed.input.setAttribute('aria-invalid', 'true');
            if (!fromBlur) ed.input.focus({ preventScroll: true });
            return false;
        }
        this.closeEdit(false);
        if (step !== null) {
            const input = this.input;
            const at = this.lines.findIndex(l => lineKey(l) === ed.key);
            const from = input ? input.columns.findIndex(c => c.id === ed.colId) : -1;
            const line = at >= 0 ? this.lines[at] : undefined;
            let next = -1;
            if (input && line && from >= 0) {
                for (let i = from + step; i >= 0 && i < input.columns.length; i += step) {
                    if (!input.bands?.[i] && input.editableAt?.(line, input.columns[i])) { next = i; break; }
                }
            }
            if (next >= 0) {
                this.focusCell(at, next);
                if (!this.startEditAt(at, next)) this.focusActive(true);
            } else this.focusActive(true);
        }
        return true;
    }

    /** Close the editor without saving; `refocus`: the focus back on its cell. */
    private closeEdit(refocus: boolean): void {
        const ed = this.editor;
        if (!ed) return;
        this.editor = null;
        ed.box.remove();
        if (refocus) this.focusActive(true);
        this.handlers.onEditClosed?.();
    }

    /** The editor's line or column is gone (another filter, view or table): closed unsaved; else placed again. */
    private syncEditor(): void {
        const ed = this.editor;
        if (!ed) return;
        const input = this.input;
        if (!input || !this.lines.some(l => lineKey(l) === ed.key) || !input.columns.some(c => c.id === ed.colId)) {
            this.closeEdit(false);
            return;
        }
        this.placeEditor();
    }

    /** The editor over its cell (in the scrolled area), as wide as the column and at least its kind's width. */
    private placeEditor(): void {
        const ed = this.editor;
        const input = this.input;
        if (!ed || !input) return;
        const at = this.lines.findIndex(l => lineKey(l) === ed.key);
        const col = input.columns.findIndex(c => c.id === ed.colId);
        const cell = at >= 0 && col >= 0 ? this.body.querySelector<HTMLElement>(`.tv-row[data-index="${at}"] [aria-colindex="${col + 1}"]`) : null;
        if (!cell) return;
        const g = this.el.getBoundingClientRect();
        const r = cell.getBoundingClientRect();
        const width = Math.max(r.width, EDITOR_MIN_WIDTH[ed.spec.input]);
        let left = r.left - g.left - this.el.clientLeft + this.el.scrollLeft;
        // Wider than the room to the right: it ends at the visible edge.
        const right = this.el.scrollLeft + this.el.clientWidth;
        if (left + width > right) left = Math.max(this.el.scrollLeft, right - width);
        const top = r.top - g.top - this.el.clientTop + this.el.scrollTop;
        ed.box.style.cssText = `left:${Math.round(left)}px;top:${Math.round(top)}px;width:${Math.round(width)}px;height:${Math.round(r.height)}px`;
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
        this.cellChosen = false;
        this.bodyKey = '';
        this.draw();
    }

    /**
     * Scroll a row into view only when it is out of it, by the nearest edge
     * (spec 079 §2: a selection from another window; never scrollIntoView),
     * and draw.
     */
    revealKeyNearest(key: string): void {
        const at = this.lines.findIndex(l => lineKey(l) === key);
        if (at < 0) return;
        const tops = this.lineTops(this.rowHeight());
        const headH = this.head.offsetHeight;
        const el = this.el;
        if (tops[at] < el.scrollTop) el.scrollTop = tops[at];
        else if (tops[at + 1] + headH > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, tops[at + 1] + headH - el.clientHeight);
        this.activeKey = key;
        this.activeCol = 0;
        this.cellChosen = false;
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
        this.closeEdit(false);
        if (this.frame) cancelAnimationFrame(this.frame);
        if (this.flashTimer) clearTimeout(this.flashTimer);
        this.resize?.disconnect();
        this.agentBars?.disconnect();
        this.el.remove();
    }
}
