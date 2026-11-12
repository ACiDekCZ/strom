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

import { auditPersonName, DataManager } from '../../data.js';
import { TreeManager } from '../../tree-manager.js';
import { TreeRenderer } from '../../renderer.js';
import { isPhoneBar, isTabletOrMobile } from '../../breakpoints.js';
import { strings, getCurrentLanguage, type Language } from '../../strings.js';
import { uiModule } from '../module.js';
import { cellOf, columnById, columnLabel, columnNote, dateCell, eventPersons, eventTypeLabel, setResearchOffer, type SortSpec } from './table-columns.js';
import {
    applyResearch, isResearchChipId, researchChipCounts, researchChipOffer, researchColumnLiveOff, researchConflictWhat, researchOffer,
    researchAgentRow, researchOpenConflicts, researchTableEnv, type ResearchChipId, type ResearchColumnId, type ResearchNewWindow, type ResearchTableEnv, type ResearchTableInput,
} from './table-research.js';
import { onComputer, researchTableLive } from '../research-ui.js';
import { researchBubble, researchConflictBubble, type ResearchBubble } from './table-research-bubble.js';
import { AGENT_DONE_MS, materialsCountNow, researchConflictsNow } from '../../card-signals.js';
import { directionPlacesKept, onDirectionPlaces } from '../../research-directions-write.js';
import { findCrossTreeMatches, getTreesDataForMatching, type CrossTreeMatch } from '../../cross-tree.js';
import type { ChangeKind, PersonChange } from '../../research-changes.js';
import {
    CHECK_CHIPS, chipItem, chipLabel, clearFilter, columnItem, filterRows, filterSummary, isChipItem, newWindowOf, removeColumnFilter, searchQuery, setChip, setParticipantFilter,
    setColumnFilter, setEmptyFilter, sortRows, columnItemActive, type ChipId, type ColumnFilter, type FilterResult, type TableFilter,
} from './table-filter.js';
import {
    chipChoiceForm, closeFilterPanel, columnFilterForm, FilterBar, FilterSheet, openFilterPanel, type FilterBarState, type PanelOptions, type ResearchBarState,
} from './table-filterbar.js';
import {
    buildTableModel, modelIsCurrent, ROW_KEY, ROW_TYPES, rowCounts, rowKey, rowPersonId, rowsOf,
    type CellName, type CellValue, type EventRow, type RowType, type SourceRow, type TableModel, type TableRow,
} from './table-model.js';
import { eventEditTarget } from './table-events.js';
import { TableGrid, type CellEditSpec, type GridCellRef, type RowAction } from './table-grid.js';
import { editChangeOf, editOptionsOf, editTargetOf, editValueOf, type EditTarget } from './table-edit.js';
import { cellChoices, copyPlainText } from './table-cell.js';
import { fanZoomModifier } from '../../fan-zoom.js';
import { createBar, createStatus, createWindowButton, updateBar, updateResearchStatus, updateStatus } from './table-bar.js';
import { applyTableWindowState, readTableWindowState, tableWindowStateOf, type TableWindowState } from './table-window-state.js';
import { canOpenWindows, openInNewWindow } from '../../windows/window-open.js';
import { getWindowRole } from '../../windows/window-role.js';
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
import type { Partnership, PartnershipId, Person, PersonId, StromData, TableView, TreeId } from '../../types.js';
import {
    discardViewChanges, dropMissingViews, isBuiltinId, isResearchViewId, newViewId, openViewOf, readTableWork, restoreTableState, setResearchViews, switchView,
    tableWorkOf, takenViewNames, uniqueViewName, viewChanged, viewFromState, viewList, writeTableWork,
} from './table-views.js';
import { exportDownloadLabel, exportForm, ViewBar, viewNameForm, type ExportFormat, type ExportSummary } from './table-viewbar.js';
import { buildTableCsv, exportColumnCount, exportsNotLive, tableCsvFileName, type TableCsvInput } from './table-export.js';
import { buildTableXlsx } from './table-xlsx.js';
import {
    applyChecks, bandSeverity, CHECK_COLUMNS, CheckIndex, conflictCells, lineFindings, lineUnion, type CellFinding, type ConflictCell,
} from './table-checks.js';
import { conflictScope } from '../person-research-ui.js';
import { lineCell, lineKey, type GridLine } from './table-subrows.js';
import { cellDraft, type CellDraft } from '../../windows/window-drafts.js';
import { cellText, markHtml, type CellConflictMark, type CellIssueMark } from './table-grid.js';
import { bubbleHeading, bubbleHtml, citesHtml, closeTableBubble, legendHtml, openBubblePanel, sheetElement, type BubbleCite } from './table-bubble.js';
import { bridgeChanges, changedKeys, familyKeys, keepOrder, namesList, rowKeysFor, watchEdit } from './table-refresh.js';
import type { DataChangedDetail } from '../../data.js';
import { isCoarsePointer } from '../bottom-sheet.js';
import { ZoomPan } from '../../zoom.js';
import { fanYears } from '../../fan-labels.js';
import { shownNameOrEmpty as personName } from '../../person-name.js';
import { emptyStateHtml } from '../empty-state.js';
import { tableEmptyState, type TableEmptyState } from './table-empty.js';
import { sourcePlaceLine } from '../../source-location.js';

interface Mounted {
    container: HTMLElement;
    lang: Language;
    bar: HTMLElement;
    /** The line under the bar offering "Split as suggested…" (Sources, spec 075 §3). */
    bulk: HTMLElement;
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
    /** ⧉ "Open in a new window" (spec 079 §1; hidden where windows are not offered). */
    windowBtn: HTMLButtonElement;
    /** The state drawn in place of the grid (§13a, 13e–13g). */
    empty: HTMLElement;
    /** Its kind as last drawn (the content changes only with it). */
    emptyKey: string;
    /** What the phone's ⋯ offers for unions (§3.2): expand, collapse or nothing. */
    unionsButton: 'expand' | 'collapse' | null;
}

/** "New from research" in a window, or off (16zk): the window is the chip's value. */
function setResearchNew(f: TableFilter, w: ResearchNewWindow | null): boolean {
    return setChip(f, 'xNew', !!w, w ? { values: [w] } : {});
}

/** The research chips' counts, kept while the research's environment and the window stay (§16.5 menus). */
let researchCounts: { env: ResearchTableEnv; window: ResearchNewWindow; counts: ReadonlyMap<ResearchChipId, number> } | null = null;

/** The research's part of the chips' row (§16.5): what the tree offers, whether the block is open, the counts on demand. */
function researchBarState(
    env: ResearchTableEnv, m: TableModel, filter: TableFilter, columns: readonly ColumnDef[], researchView: boolean,
): ResearchBarState | undefined {
    const offer = researchChipOffer(env);
    if (!offer.length) return undefined;
    const chipOn = filter.items.some(i => isChipItem(i) && isResearchChipId(i.chip));
    const window = newWindowOf(chipItem(filter, 'xNew'));
    return {
        offer,
        engaged: chipOn || researchView || columns.some(c => !!c.fromResearch),
        narrow: isTabletOrMobile(),
        live: env.input.live,
        counts: () => {
            if (researchCounts?.env !== env || researchCounts.window !== window) {
                researchCounts = { env, window, counts: researchChipCounts(env, m.persons.map(r => r.person), window) };
            }
            return researchCounts.counts;
        },
    };
}

/** Watches the bar's height for a followed research's card below it. */
let barWatch: ResizeObserver | null = null;

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
let view: {
    tree: string; model: TableModel; type: RowType; key: string; checks: number;
    /** The research's environment the rows were filtered or sorted by (research chips or columns, §16.5), else null. */
    research: unknown; kept: boolean; result: ShownRows;
} | null = null;

/** An edit opened from the table (§10.3): what it edits (the toast's name) and the records the edit may change, as stored before. */
let watching: { tree: string; name: () => string; keys: Map<string, string> } | null = null;

/** A person's name for "Saved: {name}", read when the edit is saved. */
function personNameOf(personId: PersonId): () => string {
    return () => {
        const p = DataManager.getPerson(personId);
        return p ? personName(p) : '';
    };
}
/** The person in focus when the table was entered (spec 073 U9): the next draw makes their row the active one. */
let focusOnEnter: { tree: string; person: PersonId } | null = null;
/**
 * A window opened from another window's Table (spec 079 §1): the state it
 * carried, taken over when this tree's table state is first read; then its
 * selected row is scrolled to at the next draw (`revealOnDraw`, the tree).
 */
let windowStart: { tree: string; state: TableWindowState } | null = null;
let revealOnDraw: string | null = null;

/**
 * The selection shared with other windows (spec 079 §2): whether it is
 * shared now (the selected row's look) and who hears this window's choice.
 */
export interface TableSelectionShare {
    active(): boolean;
    announce(personId: PersonId): void;
}
let selectionShare: TableSelectionShare | null = null;
/** Another window's selection that came during a cell's edit: taken when the edit ends. */
let pendingShared: { person: PersonId | null } | null = null;

/** The people a row is about, the main one first: a person; a union's partners; an event's people; a source none. */
function rowPeople(row: TableRow): PersonId[] {
    if (row.kind === 'person') return [row.id];
    if (row.kind === 'union') return [row.p1?.id, row.p2?.id].filter((id): id is PersonId => !!id);
    if (row.kind === 'event') return row.persons.map(p => p.id);
    return [];
}

/** Records changed (entity keys) whose rows light up at the next draw (§10.3). */
let flashNext: { tree: string; keys: readonly string[] } | null = null;
const BRIDGE_TOAST_MS = 8000;
let mounted: Mounted | null = null;
/** The coverage row's cells (§6.1) for the rows last drawn; computed when a column is first drawn. */
let coverage: { rows: readonly TableRow[]; cells: Map<string, CoverageCell> } | null = null;

function coverageOf(m: TableModel, type: RowType, rows: readonly TableRow[], col: ColumnDef, pass: UnionPredicate | null): CoverageCell {
    if (col.id === lockedColumn(type)) return coverageLabel();
    // §16.2: the research's signals are not facts to fill in.
    if (col.group === 'research') return { text: '–', low: false, title: strings.table.na };
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

/** The export's format last chosen (§11.1: CSV · XLSX), kept while the app runs. */
let exportFormat: ExportFormat = 'csv';
/** The open Export takes all rows without the filter (1110); each Export opens with the rows shown. */
let exportUnfiltered = false;

/** What an export takes from the table shown now (tableExportNow). */
interface TableExportNow {
    input: TableCsvInput;
    pinned: number;
    widths: readonly number[];
    view: string;
    checks: CheckIndex | null;
    files: Record<ExportFormat, string>;
    type: RowType;
    /** A filter or a search narrows the rows (1110): its words and all rows of the type; null without one. */
    filtered: { filter: string; total: number } | null;
}
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

/** The ≠ cells of each person for one research environment (§16.3), worked out when a row is drawn. */
const conflictCellsMemo = new WeakMap<ResearchTableEnv, Map<string, ConflictCell[]>>();

function personConflictCells(env: ResearchTableEnv, m: TableModel, id: PersonId): ConflictCell[] {
    let byPerson = conflictCellsMemo.get(env);
    if (!byPerson) conflictCellsMemo.set(env, byPerson = new Map());
    let cells = byPerson.get(id);
    if (!cells) {
        const row = m.personRows.get(id);
        const open = row ? researchOpenConflicts(env, row.person) : [];
        cells = row && open.length ? conflictCells(row.person, open, row.unions, conflictScope) : [];
        byPerson.set(id, cells);
    }
    return cells;
}

/** The union columns a couple's conflict can stand on (§16.3), in both tables. */
const CONFLICT_UNION_COLUMNS: ReadonlySet<string> = new Set(['wDate', 'wPlace', 'divDate', 'divPlace']);

/**
 * The ≠ of a line's cell (§16.3): a person's own fact on the person's row;
 * a couple's fact on its union's cell (the sub-row, or the row of a person
 * with one union; the Unions table's row), else on the Partner cell of the
 * person's row, where a collapsed person's union conflicts stand too.
 */
function conflictMarkAt(env: ResearchTableEnv, m: TableModel, line: GridLine, col: ColumnDef, value: CellValue): CellConflictMark | null {
    if (line.kind === 'more') return null;
    const row = line.row;
    let hits: ConflictCell[] = [];
    if (row.kind === 'person') {
        const cells = personConflictCells(env, m, row.id);
        if (!cells.length) return null;
        if (col.id === 'partner') {
            if (line.kind !== 'row') return null;
            hits = cells.filter(c => c.col === 'partner' || (line.union === null && line.expanded === false && !!c.union));
        } else if (col.unionScoped) {
            const u = lineUnion(line);
            hits = u ? cells.filter(c => c.col === col.id && c.union === u.id) : [];
        } else if (line.kind === 'row') {
            hits = cells.filter(c => c.col === col.id && !c.union);
        }
    } else if (row.kind === 'union' && CONFLICT_UNION_COLUMNS.has(col.id)) {
        for (const p of [row.union.person1Id, row.union.person2Id]) {
            hits.push(...personConflictCells(env, m, p).filter(c => c.col === col.id && c.union === row.union.id));
        }
    }
    if (!hits.length) return null;
    const what = [...new Set(hits.map(h => researchConflictWhat(h.conflict)))].join(', ');
    return { label: strings.table.res.conflictAria(value.na ? '' : cellText(value), what) };
}

/** The open conflicts a ≠ of a line's cell stands for (§16.3), the first of them first. */
function conflictsAt(env: ResearchTableEnv, m: TableModel, line: GridLine, col: ColumnDef): { personId: PersonId; conflictId: string }[] {
    if (line.kind === 'more') return [];
    const row = line.row;
    const ids = row.kind === 'person' ? [row.id] : row.kind === 'union' ? [row.union.person1Id, row.union.person2Id] : [];
    const out: { personId: PersonId; conflictId: string }[] = [];
    for (const id of ids) {
        for (const c of personConflictCells(env, m, id)) {
            const here = row.kind === 'union' ? c.col === col.id && c.union === row.union.id
                : col.id === 'partner' ? c.col === 'partner' || !!c.union
                : col.unionScoped ? c.col === col.id && c.union === lineUnion(line)?.id
                : c.col === col.id && !c.union;
            if (here && !out.some(o => o.conflictId === c.conflict.id)) out.push({ personId: id, conflictId: c.conflict.id });
        }
    }
    return out;
}

/**
 * The conflicts a ≠ opens (§16.3 → §16.4 Conflicts): those it stands for,
 * and on Partner or a union's cell of the People table also the partner's
 * conflicts of the same union (the Unions table names both partners already).
 */
function conflictsOpened(env: ResearchTableEnv, m: TableModel, line: GridLine, col: ColumnDef): { personId: PersonId; conflictId: string }[] {
    const out = conflictsAt(env, m, line, col);
    if (line.kind === 'more' || line.row.kind !== 'person' || (col.id !== 'partner' && !col.unionScoped)) return out;
    const row = line.row;
    const unions = col.id === 'partner' ? row.unions : [lineUnion(line)].filter((u): u is Partnership => !!u);
    for (const u of unions) {
        const other = u.person1Id === row.id ? u.person2Id : u.person1Id;
        for (const c of personConflictCells(env, m, other)) {
            const here = c.union === u.id && (col.id === 'partner' || c.col === col.id);
            if (here && !out.some(o => o.conflictId === c.conflict.id && o.personId === other)) out.push({ personId: other, conflictId: c.conflict.id });
        }
    }
    return out;
}

/** A research cell of a person's row that opens its bubble (§16.4): something drawn, not a live-only "–". */
function researchCellOpens(line: GridLine, col: ColumnDef, value: CellValue): boolean {
    if (line.kind !== 'row' || line.row.kind !== 'person' || col.group !== 'research') return false;
    const r = value.research;
    return !!r && !value.na && !r.liveOff && (r.parts.length > 0 || r.count !== undefined || !!r.signal);
}

/** Whom or what a finding is about, as Data quality names it: the subject (a place, a godparent), else its people. */
function findingAbout(issue: ValidationIssue, data: StromData): string {
    if (issue.subject) return issue.subject;
    const names = (issue.personIds ?? []).map(id => { const p = data.persons[id]; return p ? personName(p) || id : id; });
    return names.join(issue.type === 'possibleDuplicate' ? ' × ' : ', ');
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
    if (windowStart && windowStart.tree === tree) takeWindowStart(state);
    return state;
}

/** The state another window's Table carried (spec 079 §1), over this tree's table as it was left. */
function takeWindowStart(state: TableState): void {
    const start = windowStart;
    if (!start) return;
    windowStart = null;
    applyTableWindowState(state, start.state, storedViews());
    revealOnDraw = start.tree;
}

/** The working state last written, so a draw writes only a change. */
let keptWork = '';

/** Keep the tree's table for the next visit (§9.1); a read-only tree's views are for this opening only. */
function keepWork(tree: string, state: TableState): void {
    // A satellite window reads the main window's table state, never writes it: its filters and sort stay in it (spec 079).
    if (!tree || DataManager.isReadOnly() || DataManager.isWindowCopy()) return;
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
    // A research chip or a research column's sort reads the research: a new environment filters and sorts again.
    const byResearch = filter.items.some(i => isChipItem(i) && isResearchChipId(i.chip))
        || sort.some(s => !!columnById(type, s.col)?.fromResearch);
    const researchNow = byResearch ? m.ctx.research ?? null : null;
    const last = view && view.tree === tree && view.type === type && view.key === key ? view : null;
    if (last && last.model === m && last.checks === checksVersion && last.research === researchNow) return last.result;
    const f = filterRows(m, type, rowsOf(m, type), filter, q ? { query: q, columns } : undefined);
    const rows = sort.length ? sortRows(m, type, f.rows, sort, f.pass ? sortUnionOf(f.pass) : undefined) : f.rows;
    // §10.3: after a change of the data the rows stay in place, those that no longer
    // pass dimmed, until the sort, the filter or the view change. §16.6: so after a
    // change of the research's signals (the same model, a new environment) as well.
    const signals = !!last && last.model === m && last.research !== researchNow;
    const kept = last && (last.model.rev !== m.rev || last.kept || signals) ? keepOrder(m, last.result.rows, rows) : null;
    const result: ShownRows = kept ? { rows: kept.rows, pass: f.pass, stale: kept.stale } : { rows, pass: f.pass, stale: NONE };
    view = { tree, model: m, type, key, checks: checksVersion, research: researchNow, kept: !!kept, result };
    return result;
}

/**
 * ⌖ Show in tree leaves the Table for the family chart: a satellite window
 * shows one view (spec 079 §2, K1), so it has no such action.
 */
function treeActionOffered(): boolean {
    return getWindowRole() !== 'satellite';
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

/** The draw that takes the agent's ✓ away (§16.6). */
let agentDoneTimer: ReturnType<typeof setTimeout> | null = null;

/** The research's environment last given to the cells (§16) and what it was built from. */
let researchMemo: { key: readonly unknown[]; env: ResearchTableEnv } | null = null;

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** What changed in the app and was not sent, per person: worked out only when a cell asks (rSync). */
class LazyUnsent extends Map<PersonId, readonly ChangeKind[]> {
    private filled = false;
    constructor(private readonly load: () => PersonChange[] | null) { super(); }
    private fill(): void {
        if (this.filled) return;
        this.filled = true;
        for (const c of this.load() ?? []) if (!c.deleted && c.kinds.length) super.set(c.personId, c.kinds);
    }
    override get(id: PersonId): readonly ChangeKind[] | undefined { this.fill(); return super.get(id); }
    override has(id: PersonId): boolean { this.fill(); return super.has(id); }
    override get size(): number { this.fill(); return super.size; }
}

/** The other trees read for ⇄ In another tree (§16), for a tree and revision; and the read under way. */
let crossTrees: { key: string; match: ((p: Person) => readonly CrossTreeMatch[]) | null } | null = null;
let crossTreesLoading: string | null = null;

/** No edits here (13j): a read-only page or a locked tree. */
function tableReadOnly(): boolean {
    return DataManager.isReadOnly() || DataManager.isTreeLocked();
}

export const tableMethods = uiModule({
    /**
     * The research's environment for the cells (§16; null: no research tree):
     * the tree's kind, the live state, the lines' places, the unsent changes
     * (worked out when a cell asks). Built again only when one of them changed.
     */
    tableResearchEnv(data: StromData, rev: number, m: TableModel): ResearchTableEnv | null {
        if (!m.ctx.reliability.researchTree) { researchMemo = null; return null; }
        const kind = this.activeResearchArchive() ? 'archive' : 'research';
        const readOnly = DataManager.isReadOnly();
        const now = researchTableLive();
        const places = now.base ? directionPlacesKept(now.base) : null;
        const b = this.researchChangesBase();
        // §16.6: ✓ stands AGENT_DONE_MS after the agent left a person; the draw that drops it is asked for.
        const at = Date.now();
        const done = [...now.done].filter(([, t]) => at - t < AGENT_DONE_MS);
        this.tableAgentDoneLater(done.length ? Math.min(...done.map(([, t]) => t)) + AGENT_DONE_MS - at : null);
        const key = [
            data, rev, m, kind, readOnly, now.live, now.followed, now.waiting, now.working, now.queue, done.join(';'), places,
            b && b !== 'same' ? b.base : b, b && b !== 'same' ? b.key : '',
        ];
        if (researchMemo && sameKey(researchMemo.key, key)) return researchMemo.env;
        const input: ResearchTableInput = {
            kind, readOnly, live: now.live, followed: now.followed, waiting: now.waiting, working: now.working, queue: now.queue, done: new Map(done),
            livePlaces: places, unsent: new LazyUnsent(() => this.researchChangesNow()),
            conflictsOf: researchConflictsNow, materialsOf: materialsCountNow,
            generationOf: id => m.ctx.generations().get(id), now: at,
        };
        const env = researchTableEnv(data, input);
        researchMemo = { key, env };
        return env;
    },

    /**
     * What the research's bridge said changed (spec 057 §7.4): the table on
     * screen is drawn again when the agent's work or queue its cells read is
     * not the one drawn (following or not).
     */
    tableResearchAgentChanged(): void {
        if (TreeRenderer.getViewMode() !== 'table' || !researchMemo) return;
        const now = researchTableLive();
        const drawn = researchMemo.env.input;
        if (drawn.live === now.live && drawn.working === now.working && drawn.queue === now.queue) return;
        redrawTable(el => this.renderTableView(el));
    },

    /** Draw the table again once the oldest ✓ of the agent is due to go (§16.6; null: none stands). */
    tableAgentDoneLater(ms: number | null): void {
        if (agentDoneTimer) clearTimeout(agentDoneTimer);
        agentDoneTimer = null;
        if (ms === null) return;
        agentDoneTimer = setTimeout(() => {
            agentDoneTimer = null;
            if (TreeRenderer.getViewMode() === 'table') redrawTable(el => this.renderTableView(el));
        }, Math.max(0, ms) + 20);
    },

    /** When the research's state the cells show was taken (§16.2 "Research: as of …"): the tree's last load from it. */
    tableResearchWhen(tree: string): string {
        const at = Date.parse(TreeManager.getTreeMetadata(tree as TreeId)?.research?.syncedAt ?? '');
        if (!Number.isFinite(at)) return '';
        return new Date(at).toLocaleString(getCurrentLanguage(), { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    /**
     * ⇄ In another tree (§16): the other trees are read (cached by their
     * change stamps) when the column is shown, and the table drawn again when
     * they are; until then the cells are empty.
     */
    tableCrossTrees(tree: string, m: TableModel, shown: boolean): void {
        if (!shown || !tree || DataManager.isViewMode()) return;
        const key = `${tree}|${m.rev}|${m.data === DataManager.getData() ? 1 : 0}`;
        if (crossTrees?.key !== key && crossTreesLoading !== key) {
            crossTreesLoading = key;
            void getTreesDataForMatching(TreeManager).then(trees => {
                if (crossTreesLoading !== key) return;
                crossTreesLoading = null;
                crossTrees = { key, match: trees ? (p: Person) => findCrossTreeMatches(tree as TreeId, p, trees) : null };
                redrawTable(el => this.renderTableView(el));
            }, () => { if (crossTreesLoading === key) crossTreesLoading = null; });
        }
        const match = crossTrees?.key.startsWith(`${tree}|`) ? crossTrees.match : null;
        if (m.ctx.crossTree === match) return;
        m.ctx.crossTree = match;
        for (const row of m.persons) row.cache.delete('crossTree');
    },

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
        // §16.1: the research columns the tree offers, before its state is read (a column not offered is not in the catalog).
        const research = this.tableResearchEnv(data, rev, m);
        applyResearch(m, research);
        setResearchOffer(research ? researchOffer(research) : {});
        // §16.5: the research's views the tree offers, before its state is read (a view no longer offered falls back).
        setResearchViews(research && research.input.kind !== 'none' ? {
            overview: true,
            lines: research.lines.lines.map(l => ({ id: l.id, name: l.name })),
            exchange: research.input.kind === 'research' && !research.input.readOnly,
        } : null);
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
                onSelect: (key, row) => {
                    const s = stateOf(treeKey());
                    s.types[s.rowType].selected = key;
                    // Another window's selection waiting for an edit is older than this one.
                    pendingShared = null;
                    this.renderTableView(container);
                    const person = row ? personOfRow(row) : null;
                    if (person) selectionShare?.announce(person);
                },
                onEditClosed: () => {
                    // After the editor's own steps (Tab opens the next one: the selection keeps waiting).
                    queueMicrotask(() => {
                        if (!pendingShared || mounted?.grid.isEditing()) return;
                        this.tableSharedSelect(pendingShared.person);
                    });
                },
                onRowClick: (line, cell) => { if (isPhoneBar() || isCoarsePointer()) this.showTableRowSheet(line, cell); },
                // §6.2 by touch: the completeness bubble on a tap of its cell (a mouse has its title).
                onComp: (line, col, cell) => {
                    if (!isPhoneBar() && !isCoarsePointer()) return false;
                    this.showTableCompleteness(line, col, cell);
                    return true;
                },
                onRowAction: (action, line) => this.tableRowAction(action, line),
                onEditCell: (line, cell) => this.tableEditCell(line, cell.col),
                onName: (line, _col, name, anchor) => this.tableNameAction(line, name, anchor),
                onMoreCites: (_line, _col, ids, anchor) => this.showTableCites(ids, anchor),
                onRowMenu: (line, anchor, cell) => this.showTableRowMenu(line, anchor, cell),
                onIssue: (line, col, cell) => this.showTableFinding(line, col, cell),
                onFindings: (line, col, cell) => this.showTablePersonFindings(line, col, cell),
                onConflict: (line, col, mark) => this.showTableConflict(line, col, mark),
                onResearch: (line, col, cell) => this.showTableResearch(line, col, cell),
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
                // Who stands where in the lines, read anew through the bridge (§16.9).
                onDirectionPlaces(later);
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
                onResearchNew: (w) => this.changeTableFilter(f => setResearchNew(f, w)),
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
            // ⧉ (spec 079 §1, 1c): the Table with its state in a new window; this window stays on the Table.
            const windowBtn = createWindowButton(() => { openInNewWindow('table', this.tableWindowState()); });
            bar.querySelector('.tv-slot-window')!.appendChild(windowBtn);
            const empty = document.createElement('div');
            empty.className = 'tv-empty';
            empty.hidden = true;
            empty.addEventListener('click', (e) => {
                const act = (e.target as Element).closest<HTMLElement>('[data-empty-act]')?.dataset.emptyAct;
                if (act === 'add') this.showAddPersonModal();
                else if (act === 'quality') void this.showTreeValidationDialog(treeKey() as TreeId);
                else if (act === 'follow') this.showLiveResearchNow();
            });
            const bulk = document.createElement('div');
            bulk.className = 'table-bulk';
            bulk.hidden = true;
            container.append(bar, bulk, grid.el, empty, status);
            // A followed research's card stands below the bar: placed again when the bar's bottom moves
            // (the chips wrap, the research block opens, the window narrows).
            barWatch?.disconnect();
            let barBottom = -1;
            barWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
                const bottom = Math.round(bar.getBoundingClientRect().bottom);
                if (bottom === barBottom) return;
                barBottom = bottom;
                this.placeLivePanel?.();
            }) : null;
            barWatch?.observe(bar);
            mounted = {
                container, lang, bar, bulk, grid, status, colsBtn, drawn: '', display: null, filters, filterState: null, views, exportBtn, windowBtn,
                empty, emptyKey: '', unionsButton: null,
            };
        }

        const counts = rowCounts(m);
        const phone = isPhoneBar();
        mounted.windowBtn.hidden = !canOpenWindows();
        normalizeColumns(type, st);
        const display = displayColumns(type, st, phone);
        mounted.display = display;
        this.tableCrossTrees(tree, m, type === 'persons' && display.columns.some(c => c.id === 'crossTree'));
        const { rows, pass, stale } = viewRows(tree, m, type, st.filter, st.search, st.sort, display.columns);
        // Entered from another view (U9): the person in focus is the active row (the active one kept if it is theirs).
        let revealFocus: string | null = null;
        if (focusOnEnter) {
            // Sources are about no one: their table keeps its row.
            const want = focusOnEnter.tree === tree && type !== 'sources' ? focusOnEnter.person : null;
            focusOnEnter = null;
            if (want) {
                const current = st.selected ? rows.find(r => rowKey(r) === st.selected) : undefined;
                const row = current && rowPeople(current).includes(want) ? current : rows.find(r => rowPeople(r).includes(want));
                st.selected = row ? rowKey(row) : null;
                revealFocus = st.selected;
            }
        }
        // A window opened with another window's Table: its selected row in view.
        if (revealOnDraw === tree) {
            revealOnDraw = null;
            if (!revealFocus && st.selected && rows.some(r => rowKey(r) === st.selected)) revealFocus = st.selected;
        }
        const persons = type === 'persons';
        const lines = persons ? buildLines(rows, { collapse: st.unions, pass, revealed: new Set(st.revealedUnions) }) : undefined;
        const unionsButton = persons && hasMultiUnions(rows) ? (anyExpanded(st.unions, rows) ? 'collapse' : 'expand') : null;
        const summary = filterSummary(m, type, st.filter, st.search);
        const filterState: FilterBarState = {
            model: m, type, filter: st.filter, search: st.search, shown: rows.length, checking: !index || !!checks?.running, phone,
            research: persons && research ? researchBarState(research, m, st.filter, display.columns, isResearchViewId(state.open[type])) : undefined,
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
        this.renderTableSplitBar(mounted.bulk, type);
        updateStatus(mounted.status, type, rows.length, counts[type], st.sort, !!checks?.running, tableReadOnly());
        const researchShown = !!research && display.columns.some(c => c.group === 'research');
        updateResearchStatus(mounted.status, !research || !researchShown ? null
            : research.input.live ? { live: true, followed: !!research.input.followed } : { live: false, when: this.tableResearchWhen(tree) });
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
            canFollow: !!research && research.input.kind === 'research' && !research.input.readOnly && !research.input.live,
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
            actions: phone ? null : { edit: !tableReadOnly(), tree: treeActionOffered() },
            editableAt: !phone && this.tableInlineEdit() ? (line, col) => !!this.tableEditTarget(line, col) : undefined,
            liveOff: research ? new Set(display.columns
                .filter(c => c.group === 'research' && (c.id === 'rTasks' || c.id === 'rAgent') && researchColumnLiveOff(research, c.id as ResearchColumnId))
                .map(c => c.id)) : undefined,
            coverage: st.coverageRow ? (col) => coverageOf(m, type, rows, col, pass) : undefined,
            selected: st.selected,
            selectedShared: !!selectionShare?.active(),
            label: `${strings.viewModeSwitch.table} – ${strings.table.rows[type]}`,
            conflictAt: research ? (line, col, value) => conflictMarkAt(research, m, line, col, value) : undefined,
            researchAt: research ? researchCellOpens : undefined,
            agentAt: research?.input.live
                ? (line) => (line.kind === 'row' && line.row.kind === 'person' ? researchAgentRow(research, line.row.person) : null)
                : undefined,
            issueAt: index ? (line, col): CellIssueMark | null => {
                const f = lineFindings(index, m, line, col)[0];
                return f ? { severity: f.severity, label: translateValidationType(f.issue.type) } : null;
            } : undefined,
            bandCell: index ? (line, band) => {
                const row = line.row;
                const union = lineUnion(line);
                // A union's sub-row: only its union's cells (the person's findings stay on the person's row, §3).
                const ids = band.columns.filter(c => line.kind !== 'sub' || c.unionScoped).map(c => c.id);
                const sev = bandSeverity(index, row, ids,
                    id => (columnById(type, id)?.unionScoped ? union : null),
                    id => { const c = columnById(type, id); return c ? lineCell(m, line, c).text : ''; });
                return sev ? markHtml(sev) : '';
            } : undefined,
        }, restore);
        if (revealFocus) mounted.grid.revealKey(revealFocus);
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

    /**
     * The ≠ of a research conflict on a cell was clicked (§16.3): the bubble
     * Conflicts (§16.4) of the conflicts it stands for, a partner's of the
     * same union too, each with its Decide ›.
     */
    showTableConflict(line: GridLine, colPos: number, mark: HTMLElement): void {
        const col = mounted?.display?.columns[colPos];
        const env = researchMemo?.env;
        if (!col || !env || !model || !mounted || line.kind === 'more') return;
        const row = line.row;
        const rowPerson = row.kind === 'person' ? row.person
            : row.kind === 'union' ? row.p1 ?? env.data.persons[row.union.person1Id] : undefined;
        if (!rowPerson) return;
        const b = researchConflictBubble(env, rowPerson, conflictsOpened(env, model, line, col));
        if (!b) return;
        this.openTableResearchAt(env, b, line, colPos, () => (mark.isConnected ? mark : null), '.tv-conf');
    },

    /** A research cell was clicked, or Enter or Space pressed on it (§16.4): its bubble, the row selected. */
    showTableResearch(line: GridLine, colPos: number, cellEl: HTMLElement): void {
        const col = mounted?.display?.columns[colPos];
        const env = researchMemo?.env;
        if (!col || !env || !mounted || line.kind === 'more' || line.row.kind !== 'person') return;
        const b = researchBubble(env, line.row.person, col.id as ResearchColumnId, {
            onComputer: onComputer(), bridgeLive: this.researchOriginBridge() === 'live',
        });
        if (!b) return;
        this.openTableResearchAt(env, b, line, colPos, () => (cellEl.isConnected ? cellEl : null));
    },

    /**
     * A research bubble opened under its cell once the frame is drawn: the
     * click selects the row, and the grid drawn again for it may scroll, which
     * would close a bubble opened at once. The cell (or its mark) is found
     * anew, as the grid draws it then.
     */
    openTableResearchAt(env: ResearchTableEnv, b: ResearchBubble, line: GridLine, colPos: number,
        clicked: () => HTMLElement | null, part?: string): void {
        const cell = this.tableCellFinder(line, colPos);
        requestAnimationFrame(() => {
            if (!mounted?.container.isConnected) return;
            const now = cell();
            const at = clicked() ?? (part ? now?.querySelector<HTMLElement>(part) : null) ?? now;
            if (!at) return;
            this.openTableResearchBubble(env, b, { rect: at.getBoundingClientRect(), focusBack: cell, scroller: mounted.grid.el });
        });
    },

    /** A line's cell as the grid draws it now (it may have drawn again since it was clicked). */
    tableCellFinder(line: GridLine, colPos: number): () => HTMLElement | null {
        const grid = mounted?.grid;
        const key = lineKey(line);
        return () => (grid ? [...grid.el.querySelectorAll<HTMLElement>('.tv-row[data-key]')]
            .find(r => r.dataset.key === key)?.querySelector<HTMLElement>(`[aria-colindex="${colPos + 1}"]`) ?? null : null);
    },

    /** A finding's cell was clicked or Enter pressed on it (§7.4): the row selected, the bubble opened. */
    showTableFinding(line: GridLine, colPos: number, cell: HTMLElement): void {
        const m = model;
        const index = checks?.index;
        const col = mounted?.display?.columns[colPos];
        if (!m || !index || !col || !mounted) return;
        this.openTableFindings(line, colPos, cell, lineFindings(index, m, line, col), false);
    },

    /**
     * The Findings or Highest level cell of a person was clicked or Enter
     * pressed on it (§7.4): the bubble lists all of the person's findings,
     * each with its level, its text and whom or what it is about.
     */
    showTablePersonFindings(line: GridLine, colPos: number, cell: HTMLElement): void {
        const index = checks?.index;
        if (!index || line.kind !== 'row' || line.row.kind !== 'person') return;
        this.openTableFindings(line, colPos, cell, index.personAll(line.row.id), true);
    },

    /** The bubble (a phone: the sheet) of these findings at a cell; `about`: each says whom or what it is about. */
    openTableFindings(line: GridLine, colPos: number, cell: HTMLElement, list: readonly CellFinding[], about: boolean): void {
        if (!list.length || !mounted) return;
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
        const data = DataManager.getData();
        const shown = list.map(f => ({
            severity: f.severity, title: translateValidationType(f.issue.type), detail: f.issue.detail ?? '',
            ...(about ? { about: findingAbout(f.issue, data) } : {}),
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
        // §16.3: a research tree's legend ends with the block Research (an archive, a read-only copy: its marks from the data).
        const env = researchMemo?.env ?? null;
        const research = !env ? null : env.input.kind === 'research' && !env.input.readOnly ? 'full' : 'data';
        if (isPhoneBar()) {
            this.showTableSheet(sheetElement(title, legendHtml(research), 'legend', () => this.hideBottomSheet()));
            return;
        }
        openBubblePanel({
            rect: btn.getBoundingClientRect(), label: title, kind: 'legend', focusBack: () => btn,
            html: `<div class="tv-bub-title">${title}</div>${legendHtml(research)}`,
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
        this.showTableFilterForm(anchor, chipLabel(null, null, chip), form.el, apply);
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
            onResearchNew: (w) => this.changeTableFilter(f => setResearchNew(f, w)),
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
     * The person the table hands to the next view (spec 073 U9): the
     * active row's (a union's sub-row: its person; a union: a partner, the
     * one in focus if it is either; an event: its main person, or the one in
     * focus if the event is theirs too). Null: no active row, a row out of
     * view or a source: the focus stays.
     */
    tableFocusPerson(focus: PersonId | null): PersonId | null {
        const tree = treeKey();
        if (!view || view.tree !== tree) return null;
        const key = stateOf(tree).types[view.type].selected;
        const row = key ? view.result.rows.find(r => rowKey(r) === key) : undefined;
        if (!row) return null;
        const people = rowPeople(row).filter(id => !!DataManager.getPerson(id));
        if (focus && people.includes(focus)) return focus;
        return people[0] ?? null;
    },

    /** The Table's state for a new window (spec 079 §1): row type, view, filters, sort, search, selected row. */
    tableWindowState(): TableWindowState {
        return tableWindowStateOf(stateOf(treeKey()), storedViews());
    },

    /**
     * This window was opened with another window's Table state (spec 079 §1,
     * the satellite's `init`): taken over when the tree's table is first
     * read, or now (drawn again) when it was read already.
     */
    setTableWindowStart(treeId: string, raw: unknown): void {
        const state = readTableWindowState(raw);
        if (!state || !treeId) return;
        windowStart = { tree: treeId, state };
        if (!tableStateFor(treeId).restored) return;
        if (treeKey() !== treeId) return;
        stateOf(treeId);
        const el = document.getElementById('table-container');
        if (el && TreeRenderer.getViewMode() === 'table') this.renderTableView(el);
    },

    /** ⧉ in the Table's bar follows whether windows are offered (a resize, the pointer). */
    syncTableWindowButton(): void {
        if (mounted) mounted.windowBtn.hidden = !canOpenWindows();
    },

    /**
     * The table is being entered (spec 073 U9): the next draw makes the row
     * of the person in focus the active one and scrolls to it. The filter
     * and the search stay; a person they leave out: no row is active.
     */
    tableTakeFocus(person: PersonId | null): void {
        focusOnEnter = person ? { tree: treeKey(), person } : null;
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

    /** Who shares the Table's selection with other windows (spec 079 §2); null: no one. */
    setTableSelectionShare(share: TableSelectionShare | null): void {
        selectionShare = share;
    },

    /**
     * A person selected in another window (spec 079 §2): their row here is
     * the selected one (the row kept if it is theirs), scrolled to only when
     * out of view. During a cell's edit it waits for the edit's end; a person
     * the view leaves out: no row is selected, nothing said.
     */
    tableSharedSelect(personId: string | null): void {
        if (mounted?.grid.isEditing()) {
            pendingShared = { person: personId as PersonId | null };
            return;
        }
        pendingShared = null;
        if (!personId) return;
        const pid = personId as PersonId;
        const tree = treeKey();
        const state = stateOf(tree);
        const type = state.rowType;
        // Sources are about no one: their table keeps its row.
        if (type === 'sources') return;
        const st = state.types[type];
        const el = document.getElementById('table-container');
        const shown = el && TreeRenderer.getViewMode() === 'table' && view && view.tree === tree && view.type === type;
        if (!shown) {
            if (type === 'persons') st.selected = `p:${pid}`;
            return;
        }
        const rows = view!.result.rows;
        const current = st.selected ? rows.find(r => rowKey(r) === st.selected) : undefined;
        const row = current && rowPeople(current).includes(pid) ? current : rows.find(r => rowPeople(r).includes(pid));
        st.selected = row ? rowKey(row) : null;
        this.renderTableView(el!);
        if (row) mounted?.grid.revealKeyNearest(rowKey(row));
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
            if (!treeActionOffered()) return;
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
                meta: sourcePlaceLine(src, 'short'),
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

    /**
     * The cell's part of the row's menu and sheet (T54 F4): Copy · Only
     * "{value}" · Without "{value}"; an empty cell's only empty / only
     * filled; Copy alone for a cell without one value to compare.
     */
    tableCellChoices(line: GridLine, cell: GridCellRef | null): HeadMenuItem[] {
        if (!cell || !model || line.kind === 'more') return [];
        const type = stateOf(treeKey()).rowType;
        const choices = cellChoices(model, type, line, cell.col, cell.value);
        if (!choices) return [];
        const t = strings.table;
        const col = cell.col;
        const set = (item: ColumnFilter) => (): void => this.changeTableFilter(f => setColumnFilter(f, item), true);
        const out: HeadMenuItem[] = [];
        const copy = choices.copy;
        if (copy) out.push({ id: 'cellCopy', label: t.cell.copy, icon: '', hint: fanZoomModifier() === '⌘' ? '⌘C' : 'Ctrl+C', run: () => copyPlainText(copy) });
        if (choices.only) out.push({ id: 'cellOnly', label: t.cell.only(choices.label), icon: '', run: set(choices.only) });
        if (choices.without) out.push({ id: 'cellWithout', label: t.cell.without(choices.label), icon: '', run: set(choices.without) });
        if (choices.empty) {
            out.push(
                { id: 'cellEmpty', label: t.onlyEmpty, icon: '', run: () => this.changeTableFilter(f => setEmptyFilter(f, col, 'empty'), true) },
                { id: 'cellFilled', label: t.onlyFilled, icon: '', run: () => this.changeTableFilter(f => setEmptyFilter(f, col, 'filled'), true) },
            );
        }
        return out;
    },

    /** The cell's part as the first block of a row's sheet (T54 F4), none without one. */
    tableCellSheetBlocks(line: GridLine, cell: GridCellRef | null): { rows: { id: string; label: string; icon: string; run: () => void }[] }[] {
        const items = this.tableCellChoices(line, cell);
        return items.length ? [{ rows: items.map(i => ({ id: `tv-sheet-${i.id}`, label: i.label, icon: '', run: i.run })) }] : [];
    },

    /** The row's menu (§10.1): the cell's part (T54 F4) · Show in tree · Open person (Enter) · Edit… (double click) · Expand / Collapse unions. */
    showTableRowMenu(line: GridLine, anchor: HTMLElement, cell: GridCellRef | null = null): void {
        if (line.kind === 'more') return;
        if (isPhoneBar()) { this.showTableRowSheet(line, cell); return; }
        const t = strings.table;
        const run = (a: RowAction) => () => this.tableRowAction(a, line);
        const src = line.row.kind === 'source' ? line.row : null;
        const cellPart: MenuEntry[] = this.tableCellChoices(line, cell);
        // T54 F8: the cell edited in place, as F2 does.
        if (cell && this.tableEditTarget(line, cell.col)) {
            cellPart.push({ id: 'cell-edit', label: t.cell.edit, icon: '', hint: 'F2', run: () => { mounted?.grid.editActive(); } });
        }
        const entries: MenuEntry[] = cellPart.length ? [...cellPart, SEP] : [];
        if (src) entries.push({ id: 'open', label: t.act.openSource, icon: '▤', hint: 'Enter', run: run('open') });
        else {
            if (treeActionOffered()) entries.push({ id: 'tree', label: t.act.tree, icon: '⌖', run: run('tree') });
            entries.push({ id: 'open', label: t.act.open, icon: '▤', hint: 'Enter', run: run('open') });
        }
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
    showTableRowSheet(line: GridLine, cell: GridCellRef | null = null): void {
        if (line.kind === 'more') return;
        if (line.row.kind === 'source') { this.showTableSourceSheet(line, cell); return; }
        const personId = personOfRow(line.row);
        const person = personId ? DataManager.getPerson(personId) : null;
        if (!personId || !person) return;
        const t = strings.table;
        const ro = tableReadOnly();
        const run = (a: RowAction, l: GridLine = line) => () => this.tableRowAction(a, l);
        const rows = [
            ...(treeActionOffered() ? [{ label: t.act.tree, icon: '⌖', run: run('tree') }] : []),
            { label: t.act.open, icon: '▤', run: run('open') },
        ];
        if (!ro) rows.push({ label: t.act.edit, icon: '✎', run: run('edit') });
        const cellBlocks = this.tableCellSheetBlocks(line, cell);
        const blocks: { rows: typeof rows; divider?: boolean }[] = [...cellBlocks, cellBlocks.length ? { rows, divider: true } : { rows }];
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
    showTableSourceSheet(line: GridLine, cell: GridCellRef | null = null): void {
        if (line.kind === 'more' || line.row.kind !== 'source') return;
        const src = line.row.source;
        const t = strings.table;
        const run = (a: RowAction) => () => this.tableRowAction(a, line);
        const rows = [{ label: t.act.openSource, icon: '▤', run: run('open') }];
        if (!tableReadOnly()) rows.push({ label: t.act.edit, icon: '✎', run: run('edit') });
        const sub = sourcePlaceLine(src, 'short');
        const cellBlocks = this.tableCellSheetBlocks(line, cell);
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(src.title, [...cellBlocks, cellBlocks.length ? { rows, divider: true } : { rows }], sub ? { subtitle: sub } : {});
    },

    // -----------------------------------------------------------------------
    // A cell edited in place (T54 F8)

    /** Cells are edited in place: not in a read-only or locked tree, an archive, on a phone. */
    tableInlineEdit(): boolean {
        return !tableReadOnly() && !this.activeResearchArchive() && !isPhoneBar();
    },

    /** The fact a cell edits in place; null: not here (another cell, a person held by the research's bridge). */
    tableEditTarget(line: GridLine, col: ColumnDef): EditTarget | null {
        if (!this.tableInlineEdit()) return null;
        const t = editTargetOf(stateOf(treeKey()).rowType, line, col, model?.ctx);
        if (!t) return null;
        // A recorded age at the wedding: of a partner in the tree.
        if (t.agePersonId && !DataManager.getPerson(t.agePersonId)) return null;
        // As the person dialog: a locked person is not edited.
        if (t.personId) return DataManager.getPerson(t.personId) && !DataManager.isPersonLocked(t.personId) ? t : null;
        const u = t.unionId ? DataManager.getData().partnerships[t.unionId] : undefined;
        if (!u || DataManager.isPersonLocked(u.person1Id) || DataManager.isPersonLocked(u.person2Id)) return null;
        return t;
    },

    /** The cell's editor: its text, its kind, the place suggestions and the save. */
    tableEditCell(line: GridLine, col: ColumnDef): CellEditSpec | null {
        const t = this.tableEditTarget(line, col);
        if (!t) return null;
        closeHeadMenu();
        closeTableBubble(false);
        if (t.input === 'place') TreeRenderer.updatePlacesDatalist();
        return {
            value: editValueOf(DataManager.getData(), t),
            input: t.input,
            label: strings.table.cell.editLabel(columnLabel(col)),
            ...(t.input === 'place' ? { list: 'places-datalist' } : {}),
            ...(t.input === 'select' ? { options: editOptionsOf(t) ?? [] } : {}),
            // A satellite's edit carries the cell and its text: refused by the main window, the draft comes back (spec 079 §3.4).
            save: (text) => DataManager.runWithEditContext(
                DataManager.isWindowCopy() ? cellDraft(treeKey(), stateOf(treeKey()).rowType, lineKey(line), col.id, text) : null,
                () => this.tableSaveCell(t, text),
            ),
        };
    },

    /**
     * A cell's edit the main window refused (spec 079 §3.4, 3d): the fresh tree
     * is in; the editor opens again over that cell with the text typed, as a
     * kept draft (Enter saves it on the fresh tree, Esc drops it). An editor
     * open meanwhile stays and is framed. False when the cell is not shown.
     */
    tableReopenDraft(draft: CellDraft): boolean {
        if (TreeRenderer.getViewMode() !== 'table' || !mounted || treeKey() !== draft.tree) return false;
        if (stateOf(draft.tree).rowType !== draft.rowType) return false;
        return mounted.grid.reopenDraft(draft.key, draft.colId, draft.text, strings.win.draftKept);
    },

    /** A cell's editor open when the fresh tree came after a refused edit: it stays, framed as a draft (§3.4). */
    tableMarkOpenDraft(): boolean {
        return !!mounted && mounted.grid.markOpenDraft(strings.win.draftKept);
    },

    /**
     * Save a cell (T54 F8) as the person dialog and the relationships panel
     * save: one undo step, then the refresh of §10.3 (the row lit and kept in
     * place, "Saved: {name}"). Null: saved or unchanged; else the error said under the field.
     */
    tableSaveCell(t: EditTarget, text: string): string | null {
        const data = DataManager.getData();
        const res = editChangeOf(data, t, text);
        if (!res.ok) return res.error === 'date' ? strings.table.cell.badDate : strings.table.cell.nameNeeded;
        const change = res.change;
        if (!change) return null;
        const t2 = strings.undo;
        if (change.kind === 'union') {
            const u = data.partnerships[change.unionId];
            if (!u) return null;
            const a = DataManager.getPerson(u.person1Id);
            const b = DataManager.getPerson(u.person2Id);
            const personId = a ? u.person1Id : u.person2Id;
            watching = {
                tree: treeKey(), name: personNameOf(personId),
                keys: watchEdit(data, [...familyKeys(data, u.person1Id), ...familyKeys(data, u.person2Id), `u:${u.id}`]),
            };
            DataManager.runBatch(t2.editPartnership(auditPersonName(a), auditPersonName(b)), () => {
                DataManager.updatePartnership(change.unionId, change.updates);
            });
        } else {
            const id = change.personId;
            watching = { tree: treeKey(), name: personNameOf(id), keys: watchEdit(data, familyKeys(data, id)) };
            DataManager.runBatch(t2.editPerson(auditPersonName(DataManager.getPerson(id))), () => {
                if (change.kind === 'person') DataManager.updatePerson(id, change.updates);
                else if (change.kind === 'occupation') this.syncQuickEvent(id, 'occupation', 'note', change.value);
                else if (change.eventId) DataManager.updateLifeEvent(id, change.eventId, change.updates);
                else DataManager.addLifeEvent(id, { ...change.updates, type: change.type });
            });
        }
        TreeRenderer.render();
        this.refreshSearch();
        return null;
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
            if (list.research.length) entries.push(SEP, { heading: t.views.research }, ...list.research.map(item));
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
        if (list.research.length) blocks.push({ header: t.views.research, rows: list.research.map(row) });
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

    /**
     * What the table shows now as the export takes it (§11.2): rows, columns, pinning, findings, file names.
     * `unfiltered` (1110): all rows of the type in the sort shown, without the filter and the search.
     */
    tableExportNow(unfiltered = false): TableExportNow | null {
        if (!model) return null;
        const tree = treeKey();
        const state = stateOf(tree);
        const type = state.rowType;
        const st = state.types[type];
        const display = displayColumns(type, st, isPhoneBar());
        const shown = viewRows(tree, model, type, st.filter, st.search, st.sort, display.columns);
        const filter = filterSummary(model, type, st.filter, st.search);
        const every = rowsOf(model, type);
        const whole = unfiltered && !!filter;
        // A row kept after an edit that no longer passes (§10.3) is not part of the export.
        const rows = whole
            ? (st.sort.length ? sortRows(model, type, every, st.sort) : [...every])
            : shown.stale.size ? shown.rows.filter(r => !shown.stale.has(rowKey(r))) : shown.rows;
        const all = shownColumns(type, st, false);
        const treeName = (tree && TreeManager.getTreeMetadata(tree as TreeId)?.name) || '';
        const view = openViewOf(state, type, storedViews()).name;
        const now = new Date();
        return {
            input: { model, type, rows, columns: all.columns, pass: whole ? null : shown.pass },
            pinned: all.pinned, widths: all.widths, view,
            checks: checks && checks.tree === tree ? checks.index : null,
            files: { csv: tableCsvFileName(treeName, view, now, 'csv'), xlsx: tableCsvFileName(treeName, view, now, 'xlsx') },
            type,
            filtered: filter ? { filter, total: every.length } : null,
        };
    },

    /** Export (11a, 14d): a 380 px panel under the button; on a phone a sheet. CSV or XLSX, the last choice kept. */
    showTableExport(): void {
        if (!mounted) return;
        const now = this.tableExportNow();
        if (!now) return;
        const t = strings.table;
        exportUnfiltered = false;
        const csv = buildTableCsv(now.input);
        const all = now.filtered ? this.tableExportNow(true) : null;
        const sum: ExportSummary = {
            items: csv.items, columns: csv.columns, files: now.files,
            filtered: now.filtered && all ? { ...now.filtered, columnsAll: exportColumnCount(all.input) } : undefined,
        };
        const form = exportForm(now.type, sum, exportFormat, (f) => {
            exportFormat = f;
            const btn = form.closest('.tv-fpanel, .tv-fsheet')?.querySelector('.tv-fpanel-apply, .tv-fs-apply');
            if (btn) btn.textContent = exportDownloadLabel(f);
        }, (rows) => { exportUnfiltered = rows; });
        this.showTableFilterForm(mounted.exportBtn, '', form, () => this.downloadTableExport(), {
            applyLabel: exportDownloadLabel(exportFormat), ariaLabel: t.export, cls: 'tv-xpanel', noCancel: true,
        });
    },

    /** Download the CSV (§11.2) or the XLSX (§11.3) and say what went in (11b). */
    downloadTableExport(format: ExportFormat = exportFormat, unfiltered: boolean = exportUnfiltered): void {
        const now = this.tableExportNow(unfiltered);
        if (!now) return;
        let blob: Blob;
        let made: { items: number; lines: number; columns: number };
        if (format === 'xlsx') {
            const x = buildTableXlsx({ ...now.input, pinned: now.pinned, widths: now.widths, checks: now.checks, sheetName: now.view });
            blob = new Blob([x.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            made = x;
        } else {
            const c = buildTableCsv(now.input);
            blob = new Blob([c.csv], { type: 'text/csv;charset=utf-8' });
            made = c;
        }
        const file = now.files[format];
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        const k = ROW_KEY[now.type];
        const done = strings.table.exportedToast[k](file, made.items, made.lines, made.columns);
        // §16.7: the live-only research columns went out empty while the research is not followed.
        if (exportsNotLive(now.input.model, now.input.rows, now.input.columns)) {
            this.showToast(strings.table.res.exportNotLive, 6000, { title: done });
        } else {
            this.showToast(done, 5000);
        }
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
        if (state.action?.id === 'quality' || state.action?.id === 'follow') {
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'tv-empty-link';
            link.dataset.emptyAct = state.action.id;
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
