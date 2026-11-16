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
import { cellOf, columnById, columnLabel, columnNote, dateCell, eventPersons, eventTypeLabel, setResearchOffer, sharedAgeRows, type SortSpec } from './table-columns.js';
import {
    applyResearch, isResearchChipId, researchChipCounts, researchChipOffer, researchColumnLiveOff, researchConflictWhat, researchOffer,
    researchAgentRow, researchOpenConflicts, researchTableEnv, type ResearchChipId, type ResearchColumnId, type ResearchNewWindow, type ResearchTableEnv, type ResearchTableInput,
} from './table-research.js';
import { onComputer, researchTableLive } from '../research-ui.js';
import { researchBubble, researchConflictBubble, type ResearchBubble } from './table-research-bubble.js';
import { AGENT_DONE_MS, materialsCountNow, researchConflictsNow } from '../../card-signals.js';
import { onDirectionPlaces } from '../../research-directions-write.js';
import { findCrossTreeMatches, getTreesDataForMatching, type CrossTreeMatch } from '../../cross-tree.js';
import type { ChangeKind, PersonChange } from '../../research-changes.js';
import {
    addOnlyFilter, addWithoutFilter, researchFilterIdle, CHECK_CHIPS, chipItem, chipLabel, clearFilter, columnItem, filterRows, filterSummary, isChipItem, newWindowOf, removeColumnItemAt, searchQuery, setChip, setParticipantFilter,
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
import { shareCopiesOf } from '../../shared-events.js';
import { sharedEventTitle } from '../../shared-event-editor.js';
import { TableGrid, type CellEditSpec, type GridCellRef, type RowAction } from './table-grid.js';
import { editChangeOf, editOptionsOf, editTargetOf, editValueOf, type EditTarget } from './table-edit.js';
import { cellChoices, copyPlainText } from './table-cell.js';
import { fanZoomModifier } from '../../fan-zoom.js';
import { createBar, createStatus, createWindowButton, fitBarRow, updateAgentNote, updateBar, updateNav, updateResearchStatus, updateScope, updateStatus } from './table-bar.js';
import { JumpHistory, jumpTargetCell, type JumpStep } from './table-jump.js';
import { PIN_MAX, TablePins, pinRanks, pinSvg } from './table-pins.js';
import { createNotice, showNotice } from './table-notice.js';
import { applyScopeCells, outsideScope, scopeCounts, scopeRows, tableScopeOf, type TableScope } from './table-scope.js';
import { LEAD_COLUMNS } from './table-columns.js';
import { listDisplayName, listKind } from '../../person-lists.js';
import { listKindIcon } from '../list-kind-icon.js';
import { applyTableWindowState, readTableWindowState, tableWindowStateOf, type TableWindowState } from './table-window-state.js';
import { canOpenWindows, openInNewWindow } from '../../windows/window-open.js';
import { getWindowRole } from '../../windows/window-role.js';
import { windowAgentFollow } from '../../windows/agent-follow-state.js';
import {
    canMoveColumn, canPinColumn, catalogColumns, displayColumns, hideColumn, lockedColumn, moveColumnBy, moveColumnRun, moveColumnTo,
    filterChanged, normalizeColumns, pinColumn, resetColumns, setColumnWidth, setGroupCollapsed, setGroupShown, showColumn, sortAdd, sortClick,
    columnSetupOf, shownColumns, sortOnly, sortShiftClick, tableStateFor, unpinColumn, type DisplayColumns, type RowTypeState, type TableState,
} from './table-state.js';
import { ColumnPanel } from './table-colpanel.js';
import {
    anyExpanded, buildLines, coverageUnionsOf, hasMultiUnions, isExpanded, setAllExpanded, setExpanded, sortUnionOf, type UnionPredicate,
} from './table-subrows.js';
import { columnCoverage, coverageCell, coverageLabel, type CoverageCell } from './table-coverage.js';
import type { ColumnDef } from './table-columns.js';
import { closeHeadMenu, headMenuItems, openHeadMenu, SEP, type HeadMenuItem, type MenuEntry } from './table-headmenu.js';
import { listMenuEntries, listSheetPage } from '../person-list-add.js';
import { issueCategory, translateValidationType, validateTreeData, type ValidationIssue } from '../../validation.js';
import { dismissalFor, dismissalKey } from '../../quality-dismiss.js';
import { QUALITY_CHANGED_EVENT } from '../quality-ui.js';
import type { Partnership, PartnershipId, Person, PersonId, PersonList, StromData, TableGroupKey, TableView, TreeId } from '../../types.js';
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
import { lineCell, lineKey, plainLines, type DrawLine, type GridLine } from './table-subrows.js';
import { groupedExportRows, groupedLines, groupingFits, groupKeysOfRow, groupRows, hasRepeats, multiValued, offeredGroupKeys, treeHasLines, type GroupOffer } from './table-group.js';
import { cellDraft, type CellDraft } from '../../windows/window-drafts.js';
import { cellText, isMouseLikePointer, markHtml, personLinks, type CellConflictMark, type CellIssueMark } from './table-grid.js';
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
import { shareDivergence } from '../../shared-events.js';
import { divergenceSentence, divergentPersons } from '../../shared-divergence.js';

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
    /** The strip for a person the filter hides (spec 103 2a). */
    notice: HTMLElement;
    /** The rows as last drawn, without a row shown for now: Save as list of people takes them (spec 084 §6). */
    saveRows: readonly TableRow[];
    /** The pinned rows outside the filter as last drawn (said, not saved, 6b). */
    pinOutside: ReadonlySet<string>;
    /** The groups of rows as last drawn (spec 084 §10): their keys, for Collapse / Expand all; null: not grouped. */
    groupKeys: readonly string[] | null;
}

/** Save as list of people is offered (spec 084 §6): the People and Unions tables of a tree that takes changes. */
function canSaveAsList(type: RowType): boolean {
    return (type === 'persons' || type === 'unions') && !DataManager.listsReadOnly();
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
    /** The scope the rows were narrowed by (spec 084 §9; a ticked box makes a new one). */
    scope: TableScope | null;
} | null = null;

/** An edit opened from the table (§10.3): what it edits (the toast's name) and the records the edit may change, as stored before. */
let watching: { tree: string; name: () => string; keys: Map<string, string>; message?: string } | null = null;

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
let pendingShared: { person: PersonId | null; scroll: boolean } | null = null;
/**
 * The agent's row this window last scrolled to (spec 097 §5, O4: once per
 * person of the agent; null: none yet, or the window paused or detached since).
 */
let agentRevealed: string | null = null;

/** The people a row is about, the main one first: a person; a union's partners; an event's people; a source none. */
function rowPeople(row: TableRow): PersonId[] {
    if (row.kind === 'person') return [row.id];
    if (row.kind === 'union') return [row.p1?.id, row.p2?.id].filter((id): id is PersonId => !!id);
    if (row.kind === 'event') return row.persons.map(p => p.id);
    return [];
}

/** Jumps by a person's name (spec 103 U3, decision D1): this window's history, of one tree (dropped when another one is drawn). */
const jumps = new JumpHistory();
let jumpsTree: string | null = null;
/** A person shown for now outside the filter (spec 103 2b), while the People table's filter, search, sort and view stay. */
let tempShown: { tree: string; person: PersonId; ctx: string } | null = null;
/** The jump the strip waits on (spec 103 2a); gone with a change of the row type or the People table's filter. */
let hiddenJump: { tree: string; step: JumpStep; ctx: string; outsideList?: boolean } | null = null;
/** A view opened with a list that is gone (spec 084 §9): said under the bar until closed or the scope changes (the tree's key). */
let scopeGone: string | null = null;
/** A row a jump goes to (spec 084 §10): its group is opened when it is closed. */
let openGroupFor: string | null = null;
/** A Table filter rule being edited in the Table (spec 084 §7, §9): ⋯ offers Save to the list. */
let ruleEdit: { tree: string; listId: string } | null = null;

/** A menu row of Scope (spec 084 §9): the whole tree, a list, Manage lists…; null between the parts. */
interface ScopeRow { id: string; label: string; iconHtml?: string; count?: number; current?: boolean; run: () => void }

/** What a row shown for now depends on: the People table's filter, search, sort and open view. */
function peopleCtx(state: TableState): string {
    const st = state.types.persons;
    return JSON.stringify([st.filter, searchQuery(st.search), st.sort, state.open.persons, st.scope]);
}

/** A row type's scope (spec 084 §9): its list, none for Sources or a list that is gone. */
function scopeOfType(state: TableState, type: RowType): TableScope | null {
    return type === 'sources' ? null : tableScopeOf(state.types[type].scope);
}

/** The sort a scope starts with (spec 084 §9): People in the list's order (# ↑). */
const LIST_SORT: readonly SortSpec[] = [{ col: 'num', dir: 'asc' }];

/**
 * Set the Table's scope (spec 084 §9): the list, or the whole tree (null),
 * for People, Unions and Events at once (Sources have none). The People
 * table takes the list's order; back on the whole tree, the list's order
 * gives way to the default view's sort. Returns whether anything changed.
 */
function setTableScope(state: TableState, listId: string | null): boolean {
    let changed = false;
    for (const type of ['persons', 'unions', 'events'] as const) {
        const st = state.types[type];
        if (st.scope === listId) continue;
        st.scope = listId;
        st.top = 0;
        changed = true;
        if (type !== 'persons') continue;
        if (listId) st.sort = LIST_SORT.map(x => ({ ...x }));
        else if (st.sort.some(x => x.col === 'num')) st.sort = st.sort.filter(x => x.col !== 'num');
    }
    if (changed) scopeGone = null;
    return changed;
}

/** A list of a row type's scope that is gone (deleted, an undo): back to the whole tree. True when one was. */
function dropGoneScopes(state: TableState): boolean {
    let gone = false;
    for (const type of ['persons', 'unions', 'events'] as const) {
        const st = state.types[type];
        if (!st.scope || DataManager.getPersonList(st.scope)) continue;
        st.scope = null;
        if (type === 'persons') st.sort = st.sort.filter(x => x.col !== 'num');
        gone = true;
    }
    return gone;
}

/** The scope's lead columns (spec 084 §9, §13d): # and, for a work list, Done. */
function leadColumnsOf(scope: TableScope): ColumnDef[] {
    return LEAD_COLUMNS.filter(c => c.id === 'num' || !!scope.cells.done);
}

/**
 * The columns drawn with a scope (spec 084 §9, §13d): # first and, for a
 * work list, Done, both pinned before the state's own; the drawn positions
 * of the others map to the state's as before.
 */
function withLeadColumns(d: DisplayColumns, scope: TableScope | null): DisplayColumns {
    if (!scope) return d;
    const leads = leadColumnsOf(scope);
    return {
        columns: [...leads, ...d.columns], widths: [...leads.map(c => c.width), ...d.widths], pinned: d.pinned + leads.length,
        bands: [...leads.map(() => null), ...d.bands], starts: [...leads.map(() => 0), ...d.starts], ends: [...leads.map(() => 0), ...d.ends],
    };
}

/**
 * The rows with a person shown for now (spec 103 2b) where the sort (else
 * the table's own order) puts them; the rows unchanged when they show the
 * person already or there is no such person.
 */
function withTempRow(m: TableModel, rows: readonly TableRow[], person: PersonId, sort: readonly SortSpec[], pass: UnionPredicate | null): readonly TableRow[] {
    const temp = m.personRows.get(person);
    if (!temp || rows.includes(temp)) return rows;
    const order = sort.length ? sortRows(m, 'persons', [...rows, temp], sort, pass ? sortUnionOf(pass) : undefined) : rowsOf(m, 'persons');
    const shown = new Set<TableRow>(rows);
    let before: TableRow | null = null;
    for (const r of order) {
        if (r === temp) break;
        if (shown.has(r)) before = r;
    }
    const at = before ? rows.indexOf(before) + 1 : 0;
    return [...rows.slice(0, at), temp, ...rows.slice(at)];
}

/**
 * Rows pinned under the head (spec 103 §3): this window's, of one tree and
 * one row type, never in a view (decisions D5, D7).
 */
const pins = new TablePins();

/** Records changed (entity keys) whose rows light up at the next draw (§10.3). */
let flashNext: { tree: string; keys: readonly string[] } | null = null;
const BRIDGE_TOAST_MS = 8000;
let mounted: Mounted | null = null;
/** The coverage row's cells (§6.1) for the rows last drawn; computed when a column is first drawn. */
let coverage: { rows: readonly TableRow[]; cells: Map<string, CoverageCell> } | null = null;

/** A column's coverage cell; the first drawn column (`firstId`, whichever it is; spec 082 K2.1) carries the row's label. */
function coverageOf(m: TableModel, rows: readonly TableRow[], col: ColumnDef, pass: UnionPredicate | null, firstId: string | undefined): CoverageCell {
    if (col.id === firstId) return coverageLabel();
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

/**
 * A shared event whose copies differ (spec 085 4b): its sentence as the
 * detail ("Census 1921 · Zbyhněv Hurdálek: date differs …") and the label of
 * Separate; nothing for other findings or when the copies agree by now.
 */
function sharedFinding(issue: ValidationIssue, data: StromData): { detail: string; shared: { separateLabel: string } } | null {
    const d = issue.type === 'sharedCopiesDiffer' && issue.shareId ? shareDivergence(data, issue.shareId) : null;
    if (!d) return null;
    const off = divergentPersons(d).length;
    const v = strings.validation;
    return { detail: divergenceSentence(data, d), shared: { separateLabel: off === 1 ? v.separateCopy : v.separateCopies(off) } };
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
    scope: TableScope | null = null,
): ShownRows {
    const q = searchQuery(search);
    const byChecks = sort.some(s => CHECK_COLUMNS.includes(s.col))
        || filter.items.some(i => isChipItem(i) && CHECK_CHIPS.includes(i.chip));
    const key = JSON.stringify([filter, q, q ? columns.map(c => c.id) : 0, sort, scope?.listId ?? null]);
    const checksVersion = byChecks ? m.ctx.checks?.version ?? 0 : 0;
    // A research chip or a research column's sort reads the research: a new environment filters and sorts again.
    const byResearch = filter.items.some(i => isChipItem(i) && isResearchChipId(i.chip))
        || sort.some(s => !!columnById(type, s.col)?.fromResearch);
    const researchNow = byResearch ? m.ctx.research ?? null : null;
    const last = view && view.tree === tree && view.type === type && view.key === key ? view : null;
    if (last && last.model === m && last.checks === checksVersion && last.research === researchNow && last.scope === scope) return last.result;
    // The scope (spec 084 §9) narrows the rows before the filter: People in the list's order.
    const f = filterRows(m, type, scopeRows(m, type, scope), filter, q ? { query: q, columns } : undefined);
    const rows = sort.length ? sortRows(m, type, f.rows, sort, f.pass ? sortUnionOf(f.pass) : undefined) : f.rows;
    // §10.3: after a change of the data the rows stay in place, those that no longer
    // pass dimmed, until the sort, the filter or the view change. §16.6: so after a
    // change of the research's signals (the same model, a new environment) as well.
    const signals = !!last && last.model === m && (last.research !== researchNow || last.scope !== scope);
    // A person out of the list (removed, the list's rule) leaves at once: the scope is not a filter to dim by.
    const previous = last && scope ? last.result.rows.filter(r => !outsideScope(r, scope)) : last?.result.rows ?? [];
    const kept = last && (last.model.rev !== m.rev || last.kept || signals) ? keepOrder(m, previous, rows) : null;
    const result: ShownRows = kept ? { rows: kept.rows, pass: f.pass, stale: kept.stale } : { rows, pass: f.pass, stale: NONE };
    view = { tree, model: m, type, key, checks: checksVersion, research: researchNow, scope, kept: !!kept, result };
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

/**
 * Once the source opened from the table (its viewer, its editor, the editor
 * from the viewer and back) is closed, the table's active cell has the focus
 * again, unless something else took it meanwhile.
 */
function focusTableAfterSource(): void {
    const viewer = document.getElementById('source-viewer-modal');
    const editor = document.getElementById('source-editor-modal');
    const open = (): boolean => !!viewer?.classList.contains('active') || !!editor?.classList.contains('active');
    if (!open()) return;
    const watch = new MutationObserver(() => {
        if (open()) return;
        watch.disconnect();
        // After the table's redraw of a saved change (one frame).
        requestAnimationFrame(() => {
            const focused = document.activeElement;
            // The dialog gives the focus back to the row's icon that opened it, which hides
            // right after under the pointer (§10.1) and leaves the focus nowhere: not a taker.
            const taken = focused instanceof Element && focused !== document.body
                && !focused.closest('.tv-act') && focused.getClientRects().length > 0;
            if (taken) return;
            if (TreeRenderer.getViewMode() !== 'table') return;
            mounted?.grid.activeCell()?.el?.focus({ preventScroll: true });
        });
    });
    for (const el of [viewer, editor]) if (el) watch.observe(el, { attributes: true, attributeFilter: ['class'] });
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
        const places = now.places;
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
     * The research's environment of the open tree now, the Table shown or
     * not (null: no research tree): another window's bubble action is checked
     * against it (spec 097 §5).
     */
    tableResearchEnvNow(): ResearchTableEnv | null {
        const data = DataManager.getData();
        const lang = getCurrentLanguage();
        const homeId = TreeRenderer.getFocusPersonId();
        const rev = DataManager.getRevision();
        if (!modelIsCurrent(model, data, rev, homeId, lang)) {
            model = buildTableModel(data, { rev, homeId, lang, reliability: this.reliabilityOptionsNow() });
        }
        return this.tableResearchEnv(data, rev, model);
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

    /**
     * The agent's row in another window that follows the agent (spec 097 §5,
     * O4): an attached window scrolls it into the middle of the body when the
     * agent moves on to another person and the row is not all seen (the
     * active cell, the selection and the focus stay); a paused or detached one
     * does not scroll. While following (attached or paused), a row the filter
     * hides is said in the status line with Show for now (not scrolled to);
     * a pinned row is seen under the head.
     */
    tableAgentRow(follow: ReturnType<typeof windowAgentFollow>, agentKey: string | null, inRows: boolean, pinned: boolean): void {
        if (!mounted) return;
        if (follow !== 'attached') agentRevealed = null;
        const hidden = (follow === 'attached' || follow === 'paused') && !!agentKey && !inRows && !pinned;
        updateAgentNote(mounted.status, hidden ? agentKey : null);
        if (follow !== 'attached' || !agentKey || agentKey === agentRevealed || hidden) return;
        agentRevealed = agentKey;
        if (inRows && !pinned) mounted.grid.revealKey(agentKey, 'center', { smooth: true, keepSelection: true });
    },

    /** "Show for now" of the agent's hidden row (spec 097 §5, spec 103 2b): the row shown for now, scrolled to as the agent's. */
    tableShowAgentRow(): void {
        const person = this.liveFollowTarget();
        if (!person) return;
        const tree = treeKey();
        const state = stateOf(tree);
        if (state.rowType !== 'persons') return;
        tempShown = { tree, person, ctx: peopleCtx(state) };
        const el = document.getElementById('table-container');
        if (!el || TreeRenderer.getViewMode() !== 'table') return;
        // The note's button goes: the focus stays in the table, not on the page.
        const fromNote = !!document.activeElement?.closest('.tv-status-agent');
        this.renderTableView(el);
        // Asked for (paused too): the row in the middle when not seen, the selection kept.
        mounted?.grid.revealKey(`p:${person}`, 'center', { smooth: true, keepSelection: true });
        if (fromNote) mounted?.grid.el.focus({ preventScroll: true });
    },

    /** This window's following of the agent changed (attached, paused, detached; spec 097 §5): the Table looks again. */
    tableAgentFollowChanged(): void {
        redrawTable(el => this.renderTableView(el));
    },

    /**
     * Another window's mirror of the agent's state changed (spec 097 K1.3):
     * the research's link or status may make the tree a research tree here
     * now (the model is built again), and the research's cells and views
     * read the main window's work.
     */
    tableResearchMirrorChanged(): void {
        if (TreeRenderer.getViewMode() !== 'table') return;
        const opts = this.reliabilityOptionsNow();
        if (model && (model.ctx.reliability.researchTree !== opts.researchTree || model.ctx.reliability.originFeature !== opts.originFeature)) model = null;
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
        // A view's list that is gone (spec 084 §9): the whole tree, said under the bar.
        if (dropGoneScopes(state)) scopeGone = tree;
        const type = state.rowType;
        const st = state.types[type];
        const scope = scopeOfType(state, type);
        // # and Done read the People table's scope; the work list's chips too.
        applyScopeCells(m, scopeOfType(state, 'persons'));
        // Jumps by a name (spec 103 U3): another tree drops the history, the row shown for now and the strip.
        if (jumpsTree !== tree) {
            jumps.clear();
            jumpsTree = tree;
            tempShown = null;
            hiddenJump = null;
        }
        // Pinned rows (spec 103 §3): another tree or row type drops them.
        pins.use(tree, type);
        const pctx = peopleCtx(state);
        if (tempShown && (tempShown.tree !== tree || type !== 'persons' || tempShown.ctx !== pctx)) tempShown = null;
        if (hiddenJump && (hiddenJump.tree !== tree || hiddenJump.ctx !== `${type}|${pctx}`)) hiddenJump = null;

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
                onHistory: (d) => { this.tableHistory(d, false); },
                onScopeMenu: (anchor) => this.showTableScopeMenu(anchor),
            });
            const notice = createNotice({
                onShow: () => { if (hiddenJump) this.tableRunJump(hiddenJump.step, true, true); },
                onClear: () => {
                    const h = hiddenJump;
                    if (!h) return;
                    const pst = stateOf(treeKey()).types.persons;
                    clearFilter(pst.filter);
                    pst.search = '';
                    filterChanged(pst);
                    pst.top = 0;
                    this.tableRunJump(h.step, false, true);
                },
                onWhole: () => {
                    const h = hiddenJump;
                    if (!h) return;
                    setTableScope(stateOf(treeKey()), null);
                    this.tableRunJump(h.step, false, true);
                },
                onClose: () => {
                    hiddenJump = null;
                    scopeGone = null;
                    showNotice(notice, null);
                    mounted?.grid.el.focus({ preventScroll: true });
                },
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
                        this.tableSharedSelect(pendingShared.person, pendingShared.scroll);
                    });
                },
                // A tap opens the row's sheet; a mouse or a pen only selects, on any device (its menu is the right button's).
                onRowClick: (line, cell, pointer) => {
                    if (!isMouseLikePointer(pointer) && (isPhoneBar() || isCoarsePointer())) this.showTableRowSheet(line, cell);
                },
                // §6.2 by touch: the completeness bubble on a tap of its cell (a mouse or a pen has its title).
                onComp: (line, col, cell, pointer) => {
                    if (isMouseLikePointer(pointer) || (!isPhoneBar() && !isCoarsePointer())) return false;
                    this.showTableCompleteness(line, col, cell);
                    return true;
                },
                onRowAction: (action, line) => this.tableRowAction(action, line),
                onEditCell: (line, cell) => this.tableEditCell(line, cell.col),
                onName: (line, col, name, anchor) => this.tableNameAction(line, name, anchor, col),
                onPickName: (line, col, names, anchor) => this.tableLinkPick(line, col, names, anchor),
                onHistory: (d) => this.tableHistory(d, true),
                onMoreCites: (_line, _col, ids, anchor) => this.showTableCites(ids, anchor),
                onSharedAges: (line, anchor) => { if (line.kind !== 'more' && line.row.kind === 'event') this.showTableSharedAges(line.row, anchor); },
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
                onToggleRowGroup: (key, open) => this.toggleTableRowGroup(key, open),
                onHeadMenu: (colId, anchor) => this.showTableHeadMenu(colId, anchor),
                onHeadSort: (colId, add) => this.changeTableColumns(st => (add ? sortShiftClick(st, colId) : sortClick(st, colId))),
                onCoverageCell: (colId, anchor) => this.showTableCoverageMenu(colId, anchor),
                onCoverageHelp: (anchor) => this.showTableCoverageHelp(anchor),
                // §13c: the search counts among what applies, so it goes too.
                onClearFilters: () => this.changeTableFilter((f, st) => {
                    const searched = st.search !== '';
                    st.search = '';
                    return clearFilter(f) || searched;
                }, true),
                onResize: (colId, width) => this.changeTableColumns(st => setColumnWidth(st, colId, width)),
                onMoveColumn: (colId, offset) => this.changeTableColumns((st, t) => moveColumnBy(t, st, colId, offset)),
                onCheck: (line) => this.toggleTableDone(line),
                onThumb: (line) => { if (line.kind !== 'more' && line.row.kind === 'union') this.openUnionPhotoViewer(line.row.id); },
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
            status.querySelector('.tv-status-agent-show')!.addEventListener('click', () => this.tableShowAgentRow());
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
                onEditColumn: (col, at, anchor) => this.showTableColumnFilter(col, anchor, at),
                onRemoveColumn: (at) => this.changeTableFilter(f => removeColumnItemAt(f, at)),
                onClear: () => this.changeTableFilter(f => clearFilter(f), true),
                onUnpinAll: () => this.changeTablePins(() => pins.clear()),
                onUngroup: () => this.setTableGroupBy(null),
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
            container.append(bar, notice, bulk, grid.el, empty, status);
            // A followed research's card stands below the bar: placed again when the bar's bottom moves
            // (the chips wrap, the research block opens, the window narrows).
            barWatch?.disconnect();
            let barBottom = -1;
            let containerWidth = -1;
            barWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
                // A new width (the window, a side panel): row 1 fitted again before the card is placed.
                // The container's width is watched (not the bar's), so the bar's new height comes deeper, in the same frame.
                const width = Math.round(container.getBoundingClientRect().width);
                if (width !== containerWidth) { containerWidth = width; fitBarRow(bar); }
                const bottom = Math.round(bar.getBoundingClientRect().bottom);
                if (bottom === barBottom) return;
                barBottom = bottom;
                this.placeLivePanel?.();
            }) : null;
            barWatch?.observe(bar);
            barWatch?.observe(container);
            // The fonts' final widths: fitted again once they are in.
            void document.fonts?.ready.then(() => { if (mounted?.bar === bar) fitBarRow(bar); });
            mounted = {
                container, lang, bar, bulk, grid, status, colsBtn, drawn: '', display: null, filters, filterState: null, views, exportBtn, windowBtn,
                empty, emptyKey: '', unionsButton: null, notice, saveRows: [], pinOutside: new Set(), groupKeys: null,
            };
        }

        // The row types count what the scope has (spec 084 §9); Sources count the whole tree's.
        const countScope = scope ?? (type === 'sources' ? scopeOfType(state, 'persons') : null);
        const counts = countScope ? scopeCounts(m, countScope) : rowCounts(m);
        const phone = isPhoneBar();
        mounted.windowBtn.hidden = !canOpenWindows();
        // ⋯ wider than a phone offers Group by (spec 084 §10) and Save as list of people (§6):
        // with neither (no rows of the type, or Sources), no ⋯.
        const groupOffer = this.tableGroupOffer(m, scope);
        mounted.bar.querySelector('.tv-slot-more')?.classList.toggle('is-empty', !this.tableRuleList()
            && (counts[type] === 0 || (!canSaveAsList(type) && !offeredGroupKeys(type, groupOffer).length)));
        normalizeColumns(type, st);
        const display = withLeadColumns(displayColumns(type, st, phone), type === 'persons' ? scope : null);
        mounted.display = display;
        this.tableCrossTrees(tree, m, type === 'persons' && display.columns.some(c => c.id === 'crossTree'));
        const { rows, pass, stale } = viewRows(tree, m, type, st.filter, st.search, st.sort, display.columns, scope);
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
        // A person shown for now outside the filter (spec 103 2b): in the rows, not in their count.
        const shownRows = persons && tempShown ? withTempRow(m, rows, tempShown.person, st.sort, pass) : rows;
        const temp = shownRows !== rows && tempShown ? new Set([`p:${tempShown.person}`]) : undefined;
        // The rows under group headers (spec 084 §10): the jump's or the focus's row opens its group.
        const grouping = groupingFits(type, st.group, groupOffer) ? st.group : null;
        const groups = grouping ? groupRows(m, type, grouping.by, shownRows, scope?.cells.done ?? null) : null;
        if (grouping && groups) {
            for (const want of [openGroupFor, revealFocus]) {
                const row = want ? shownRows.find(r => rowKey(r) === want) : undefined;
                if (!row) continue;
                const keys = groupKeysOfRow(m, type, grouping.by, row, scope?.cells.done ?? null);
                if (keys.length && keys.every(k => grouping.collapsed.includes(k))) grouping.collapsed = grouping.collapsed.filter(k => k !== keys[0]);
            }
        }
        openGroupFor = null;
        const lineOpts = { collapse: st.unions, pass, revealed: new Set(st.revealedUnions) };
        const lines: readonly DrawLine[] | undefined = groups && grouping
            ? groupedLines(groups, new Set(grouping.collapsed), rows => (persons ? buildLines(rows, lineOpts) : plainLines(rows)))
            : persons ? buildLines(shownRows, lineOpts) : undefined;
        mounted.groupKeys = groups ? groups.map(g => g.key) : null;
        const pinned = this.tablePinnedLines(m, type, st, state.open[type], shownRows, pass, phone);
        mounted.saveRows = rows;
        mounted.pinOutside = pinned?.outside ?? new Set();
        // Pinned rows and a row shown for now outside the list (spec 084 §9): "outside the list".
        const outsideList = scope ? new Set([...(pinned?.lines ?? []).map(l => l.row), ...shownRows.filter(r => temp?.has(rowKey(r)))]
            .filter(r => outsideScope(r, scope)).map(rowKey)) : undefined;
        const unionsButton = persons && hasMultiUnions(rows) ? (anyExpanded(st.unions, rows) ? 'collapse' : 'expand') : null;
        const summary = filterSummary(m, type, st.filter, st.search);
        // Another window following the agent (spec 097 §5): the agent's row tinted, scrolled to, or said hidden.
        const follow = windowAgentFollow();
        const agentPerson = follow && research?.input.live ? this.liveFollowTarget() : null;
        const agentKey = agentPerson && persons && m.personRows.has(agentPerson) ? `p:${agentPerson}` : null;
        const filterState: FilterBarState = {
            model: m, type, filter: st.filter, search: st.search, shown: rows.length, checking: !index || !!checks?.running, phone,
            pinned: phone ? 0 : pins.count(),
            grouped: grouping ? strings.table.groupKey[grouping.by] : null,
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
        const scopeList = scopeOfType(state, type === 'sources' ? 'persons' : type)?.list ?? null;
        updateScope(mounted.bar, {
            list: type !== 'sources' && scopeList ? { name: listDisplayName(scopeList), kind: listKind(scopeList) } : null,
            disabled: type === 'sources',
        });
        this.renderTableSplitBar(mounted.bulk, type);
        updateStatus(mounted.status, type, rows.length, counts[type], st.sort, !!checks?.running, tableReadOnly(),
            groups && grouping ? { n: groups.length, distinct: persons && multiValued(grouping.by) && hasRepeats(groups, shownRows.length) ? shownRows.length : null } : null);
        const researchShown = !!research && display.columns.some(c => c.group === 'research');
        updateResearchStatus(mounted.status, !research || !researchShown ? null
            : research.input.live ? { live: true, followed: !!research.input.followed } : { live: false, when: this.tableResearchWhen(tree) });
        mounted.unionsButton = unionsButton;
        const openView = openViewOf(state, type, data.tableViews);
        const treeCounts = rowCounts(m);
        this.drawTableEmpty(tableEmptyState({
            persons: treeCounts.persons, unions: treeCounts.unions, events: treeCounts.events, sources: treeCounts.sources, type, viewId: openView.id, viewChanged: viewChanged(openView, st),
            search: st.search, shown: shownRows.length, checksDone: !!index && !checks?.running,
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
            model: m, type, rows: shownRows, columns: display.columns, widths: display.widths, pinned: display.pinned, sort: st.sort, homeId,
            links: type === 'persons' || type === 'unions', temp,
            pinLines: pinned?.lines, pinnedKeys: pinned?.keys, pinOutside: pinned?.outside, outsideList,
            listPeople: type === 'unions' && scope ? scope.cells.pos : undefined,
            bands: display.bands, coverageRow: st.coverageRow, editableHead: !phone,
            hit: searchQuery(st.search),
            filtered: new Set(st.filter.items.filter((i): i is Exclude<typeof i, { chip: ChipId }> => !isChipItem(i) && columnItemActive(i)).map(i => i.col)),
            noMatch: !shownRows.length && summary
                ? { title: strings.table.noMatch, text: strings.table.applies(summary), action: strings.table.clearFilters }
                : null,
            lines, subRows: persons, unionsButton, stale, stickyGroups: phone && !!groups,
            actions: phone ? null : { edit: !tableReadOnly(), tree: treeActionOffered() },
            editableAt: !phone && this.tableInlineEdit() ? (line, col) => !!this.tableEditTarget(line, col) : undefined,
            liveOff: research ? new Set(display.columns
                .filter(c => c.group === 'research' && (c.id === 'rTasks' || c.id === 'rAgent') && researchColumnLiveOff(research, c.id as ResearchColumnId))
                .map(c => c.id)) : undefined,
            coverage: st.coverageRow ? (col) => (LEAD_COLUMNS.includes(col) ? null : coverageOf(m, rows, col, pass, display.columns.find(c => !LEAD_COLUMNS.includes(c))?.id)) : undefined,
            selected: st.selected,
            selectedShared: !!selectionShare?.active(),
            label: `${strings.viewModeSwitch.table} – ${strings.table.rows[type]}`,
            conflictAt: research ? (line, col, value) => conflictMarkAt(research, m, line, col, value) : undefined,
            researchAt: research ? researchCellOpens : undefined,
            agentAt: research?.input.live
                ? (line) => (line.kind === 'row' && line.row.kind === 'person' ? researchAgentRow(research, line.row.person) : null)
                : undefined,
            agentKey,
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
        this.tableAgentRow(follow, agentKey, shownRows.some(r => rowKey(r) === agentKey), !!pinned?.keys.has(agentKey ?? ''));
        if (scopeGone && scopeGone !== tree) scopeGone = null;
        showNotice(mounted.notice, hiddenJump ? hiddenJump.step.to.label : scopeGone ? '' : null,
            hiddenJump?.outsideList ? 'list' : !hiddenJump && scopeGone ? 'gone' : 'filter');
        updateNav(mounted.bar, jumps.any(), jumps.canBack() ? jumps.backLabel() : null, jumps.canForward() ? jumps.forwardLabel() : null);
        if (flashNext) {
            const lit = flashNext.tree === tree ? rowKeysFor(data, type, flashNext.keys, type === 'events' ? m.events : undefined) : null;
            flashNext = null;
            if (lit?.size) mounted.grid.flash(lit);
        }
        panel?.panel.update(type, st);
        const open = openViewOf(state, type, data.tableViews);
        mounted.views.update({
            name: open.name, builtin: isBuiltinId(open.id), changed: viewChanged(open, st), readOnly: DataManager.isReadOnly(),
            researchIdle: researchFilterIdle(m, type, st.filter),
        });
        fitBarRow(mounted.bar);
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
        return () => grid?.drawnCell(key, colPos) ?? null;
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
        const findCell = (): HTMLElement | null => grid.drawnCell(cellKey, colPos);
        // The cell as drawn now: a select draws the rows anew (T54 H8).
        const rect = (findCell() ?? cell).getBoundingClientRect();
        const data = DataManager.getData();
        const shown = list.map(f => {
            const shared = sharedFinding(f.issue, data);
            return {
                severity: f.severity, title: translateValidationType(f.issue.type), detail: shared?.detail ?? f.issue.detail ?? '',
                ...(about ? { about: findingAbout(f.issue, data) } : {}),
                ...(shared ? { shared: shared.shared } : {}),
            };
        });
        const act = (what: string, i: number): void => {
            const f = list[i];
            if (!f) return;
            if (what === 'dismiss') this.dismissTableFinding(f, treeId);
            else if (what === 'restore') this.restoreTableFinding(f, treeId);
            else if (what === 'unify' && f.issue.shareId) {
                const opener = this.divergentCopyOf(f.issue.shareId)?.personId ?? null;
                this.showSharedUnify(f.issue.shareId, opener, () => this.remapTableChecks());
            } else if (what === 'separate' && f.issue.shareId) {
                if (this.separateDivergentShared(f.issue.shareId)) this.remapTableChecks();
            } else if (what === 'open' && f.issue.shareId) {
                const copy = this.divergentCopyOf(f.issue.shareId);
                if (copy) this.openEventEditorFor(copy.personId, copy.eventId);
            } else if (what === 'quality') {
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
        // # and Done of a scope (spec 084 §9, §13d) only sort: they are not moved, pinned, filtered or hidden.
        const lead = LEAD_COLUMNS.includes(col);
        if (lead) entries.splice(3);
        const note = lead ? '' : columnNote(col);
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

    /**
     * A column's filter (8d): a panel under the head or its chip; on a phone a
     * sheet. A chip edits its own item (`at`, one of the column's exclusions
     * too, spec 103 K1.2); the head the column's main filter.
     */
    showTableColumnFilter(colId: string, anchor: HTMLElement, at = -1): void {
        if (!model) return;
        const state = stateOf(treeKey());
        const type = state.rowType;
        const col = columnById(type, colId);
        if (!col) return;
        const filter = state.types[type].filter;
        const own = filter.items[at];
        const target = own && !isChipItem(own) && own.col === colId ? own : columnItem(filter, colId);
        const form = columnFilterForm(model, type, col, target);
        // The item stays the one edited, wherever it is in the items when the form applies.
        const apply = (): void => this.changeTableFilter(f => setColumnFilter(f, form.read(), target ? f.items.indexOf(target) : -1));
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
            onRemoveColumn: (at) => this.changeTableFilter(f => removeColumnItemAt(f, at)),
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

    /** ⧉ in the Table's bar follows whether windows are offered (a resize). */
    syncTableWindowButton(): void {
        if (!mounted) return;
        mounted.windowBtn.hidden = !canOpenWindows();
        fitBarRow(mounted.bar);
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
     * the view leaves out: no row is selected, nothing said. `scroll` false:
     * the row is selected where it is (the window follows the agent, spec 097 §4).
     */
    tableSharedSelect(personId: string | null, scroll = true): void {
        if (mounted?.grid.isEditing()) {
            pendingShared = { person: personId as PersonId | null, scroll };
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
        if (row && scroll) mounted?.grid.revealKeyNearest(rowKey(row));
    },

    // -----------------------------------------------------------------------
    // The row's actions (§10)

    /** ⌖ show in the tree, ▤ open the person, ✎ edit (a sub-row or a union row: the relationships panel at that union). */
    tableRowAction(action: RowAction, line: GridLine): void {
        if (line.row.kind === 'source') {
            closeHeadMenu();
            if (action !== 'tree') this.openTableSource(line.row, action === 'edit');
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

    /** A source row's Open source (the source itself) and Edit (its editor) (§14.2). */
    openTableSource(row: SourceRow, edit = false): void {
        this.openTableSourceId(row.id, edit);
    },

    /**
     * A source by its id (§14.2, §14.3): the source itself (its excerpts, Edit
     * in it when the tree can be changed), or with `edit` straight its editor;
     * a locked or read-only tree shows the source only. Closed, the table is
     * where it was, its active cell focused again.
     */
    openTableSourceId(id: string, edit = false): void {
        const data = DataManager.getData();
        if (!data.sources?.[id]) return;
        // Nothing of the manager's stack stands between the table and the source.
        this.clearDialogStack();
        if (tableReadOnly()) {
            this.showSourceViewer(id, null, { readOnly: DataManager.isTreeLocked() });
        } else {
            watching = { tree: treeKey(), name: () => DataManager.getData().sources?.[id]?.title ?? '', keys: watchEdit(data, [`s:${id}`]) };
            if (edit) {
                this.sourceEditorContext = null;
                this.reopenViewerAfterEditor = null;
                this.showEditSourceModal(id);
            } else {
                this.showSourceViewer(id, null);
            }
        }
        focusTableAfterSource();
    },

    /**
     * The pill "+N" of a citation cell (§14.3): the further cited sources, a
     * click (a tap on a phone's sheet) opens that source.
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
     * A shared event's ages (spec 085 §4, 4a): a field per person with the
     * age written in that person's copy (the computed one as its hint).
     * Enter saves the changed ones in one undo step, Escape closes; a
     * read-only table, an archive or a locked person shows them only.
     */
    showTableSharedAges(row: EventRow, anchor: HTMLElement): void {
        closeHeadMenu();
        const ctx = model?.ctx;
        if (!ctx) return;
        const rows = sharedAgeRows(ctx, row);
        if (!rows.length) return;
        const editable = !tableReadOnly() && !this.activeResearchArchive() && !rows.some(r => DataManager.isPersonLocked(r.personId));
        const t = strings.table;
        const html = `<div class="tv-ages-title">${escHtml(t.agePerPerson)}</div><div class="tv-ages-list">`
            + rows.map((r, i) => {
                const id = `tv-age-${i}`;
                const value = editable
                    ? `<input id="${id}" class="tv-ages-input" type="text" inputmode="numeric" autocomplete="off" maxlength="40" data-i="${i}"`
                        + ` value="${escHtml(r.recorded)}" placeholder="${escHtml(r.computed)}">`
                    : `<span class="tv-ages-value">${escHtml(r.recorded || r.computed || '–')}</span>`;
                return `<label class="tv-ages-row" for="${id}"><span class="tv-ages-name">${escHtml(r.name)}</span>${value}</label>`;
            }).join('') + '</div>';
        const el = openBubblePanel({
            rect: anchor.getBoundingClientRect(), label: t.agePerPerson, kind: 'ages', html,
            focusBack: () => (anchor.isConnected ? anchor : null), scroller: mounted?.grid.el,
        });
        if (!editable) return;
        el.querySelector<HTMLInputElement>('.tv-ages-input')?.focus({ preventScroll: true });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || !(e.target as Element).closest?.('.tv-ages-input')) return;
            e.preventDefault();
            const own = new Map<PersonId, { age: string | undefined }>();
            for (const input of el.querySelectorAll<HTMLInputElement>('.tv-ages-input')) {
                const r = rows[Number(input.dataset.i)];
                const v = input.value.trim();
                if (r && v !== r.recorded) own.set(r.personId, { age: v || undefined });
            }
            closeTableBubble(true);
            if (!own.size) return;
            const first = rows[0];
            const data = DataManager.getData();
            watching = { tree: treeKey(), name: personNameOf(first.personId), keys: watchEdit(data, rows.flatMap(r => familyKeys(data, r.personId))) };
            if (!DataManager.saveSharedEvent(first.personId, first.eventId, { common: {}, own })) { watching = null; return; }
            TreeRenderer.render();
            this.refreshSearch();
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
    // -----------------------------------------------------------------------
    // Jumps by a person's name (spec 103 U3)

    /**
     * The step of a jump from a cell to a person's row in the People table
     * (spec 103 §1, 3): where it starts, the line and cell it lands on (the
     * Partner cell on the union's line through a partner, else Name; D2), the
     * union opened for it (D3).
     */
    tableJumpStep(line: GridLine, col: ColumnDef, personId: PersonId): JumpStep | null {
        const m = model;
        const target = DataManager.getPerson(personId);
        const prow = m?.personRows.get(personId);
        if (!m || !target || !prow || line.kind === 'more') return null;
        const state = stateOf(treeKey());
        const people = rowPeople(line.row);
        const origin = people.find(id => id !== personId) ?? null;
        const from = [origin, ...people].map(id => (id ? DataManager.getPerson(id) : null)).find(Boolean);
        let via = col.id;
        let unionId: string | null = null;
        if (line.row.kind === 'union' && (col.id === 'p1' || col.id === 'p2')) {
            via = 'partner';
            unionId = line.row.id;
        } else if (line.row.kind === 'person' && col.id === 'partner' && line.union !== null) {
            unionId = line.row.unions[line.union]?.id ?? null;
        }
        const pst = state.types.persons;
        const shown = displayColumns('persons', pst, isPhoneBar()).columns.map(c => c.id);
        const unionIndex = unionId ? prow.unions.findIndex(u => u.id === unionId) : -1;
        const cell = jumpTargetCell(via, shown, unionIndex, prow.unions.length);
        const grid = mounted?.grid.el;
        return {
            from: {
                rowType: state.rowType, row: rowKey(line.row), key: lineKey(line), col: col.id,
                scrollTop: grid?.scrollTop ?? 0, scrollLeft: grid?.scrollLeft ?? 0, label: from ? personName(from) : '',
            },
            to: {
                personId, key: cell.sub ? `p:${personId}#u${cell.sub}` : `p:${personId}`, col: cell.col,
                origin: cell.col === 'name' ? null : origin, label: personName(target),
                expanded: cell.sub && !isExpanded(pst.unions, personId) ? personId : undefined,
            },
        };
    },

    /** Whether the People table shows a person now (its filter and search pass them). */
    tablePersonShown(personId: PersonId): boolean {
        const m = model;
        if (!m) return false;
        const tree = treeKey();
        const pst = stateOf(tree).types.persons;
        const state = stateOf(tree);
        const scope = scopeOfType(state, 'persons');
        const columns = withLeadColumns(displayColumns('persons', pst, isPhoneBar()), scope).columns;
        return viewRows(tree, m, 'persons', pst.filter, pst.search, pst.sort, columns, scope).rows.some(r => r.kind === 'person' && r.id === personId);
    },

    /**
     * Whether a person's row is pinned in the People table now (spec 103 §3):
     * a jump to them while the filter hides them lands on their pinned row.
     */
    tablePersonPinned(personId: PersonId): boolean {
        const tree = treeKey();
        return stateOf(tree).rowType === 'persons' && !isPhoneBar() && pins.holds(tree, 'persons', `p:${personId}`);
    },

    /**
     * A click (or Enter) on a person's name: the jump, or the strip when the
     * filter hides them (spec 103 2a); a pinned person the filter hides is
     * seen in the pinned rows, so the jump goes to that row, no strip.
     */
    tableJumpBy(line: GridLine, col: ColumnDef, personId: PersonId): void {
        closeHeadMenu();
        const step = this.tableJumpStep(line, col, personId);
        if (!step) return;
        if (this.tablePersonShown(personId) || this.tablePersonPinned(personId)) { this.tableRunJump(step, false, true); return; }
        const tree = treeKey();
        const state = stateOf(tree);
        // Outside the People table's list (spec 084 §9): "Not in the list", with Whole tree.
        const scope = scopeOfType(state, 'persons');
        const row = model?.personRows.get(personId);
        hiddenJump = { tree, step, ctx: `${state.rowType}|${peopleCtx(state)}`, outsideList: !!scope && !!row && outsideScope(row, scope) };
        const el = document.getElementById('table-container');
        if (el && TreeRenderer.getViewMode() === 'table') this.renderTableView(el);
    },

    /**
     * A jump (spec 103 §1, 4): the People table, the person's row (shown for
     * now outside the filter with `temp`), their union opened (D3), the cell
     * in the middle and focused, the row lit; a new step when `record`.
     */
    tableRunJump(step: JumpStep, temp: boolean, record: boolean): void {
        const tree = treeKey();
        const state = stateOf(tree);
        const pst = state.types.persons;
        hiddenJump = null;
        step.to.temp = temp;
        if (record) {
            if (jumpsTree !== tree) { jumps.clear(); jumpsTree = tree; }
            jumps.push(step);
        }
        if (step.to.expanded) setExpanded(pst.unions, step.to.personId, true);
        state.rowType = 'persons';
        pst.selected = `p:${step.to.personId}`;
        openGroupFor = pst.selected;
        if (temp) tempShown = { tree, person: step.to.personId as PersonId, ctx: peopleCtx(state) };
        const el = document.getElementById('table-container');
        if (!el || TreeRenderer.getViewMode() !== 'table') return;
        this.renderTableView(el);
        const grid = mounted?.grid;
        const cols = mounted?.display?.columns ?? [];
        if (!grid) return;
        const name = Math.max(0, cols.findIndex(c => c.id === 'name'));
        const at = cols.findIndex(c => c.id === step.to.col);
        grid.flash([`p:${step.to.personId}`]);
        if (grid.jumpTo(step.to.key, at < 0 ? name : at, step.to.origin) || grid.jumpTo(`p:${step.to.personId}`, name, null)) return;
        // Not in the body (the filter hides them) but pinned: their row in the pinned rows.
        if (!grid.jumpToPin(step.to.key, at < 0 ? name : at, step.to.origin)) grid.jumpToPin(`p:${step.to.personId}`, name, null);
    },

    /**
     * ‹ / › and Alt+← / Alt+→ (spec 103 §1, 6): back to where the last jump
     * started (its row type, scroll and cell; the union it opened closed, the
     * row it showed for now gone), or the jump again. False: no step.
     */
    tableHistory(dir: -1 | 1, focus: boolean): boolean {
        const tree = treeKey();
        if (jumpsTree !== tree) return false;
        if (dir > 0) {
            const step = jumps.forward();
            if (!step) return false;
            const pid = step.to.personId as PersonId;
            this.tableRunJump(step, !this.tablePersonPinned(pid) && (step.to.temp || !this.tablePersonShown(pid)), false);
            return true;
        }
        const step = jumps.back();
        if (!step) return false;
        const state = stateOf(tree);
        hiddenJump = null;
        if (step.to.expanded) setExpanded(state.types.persons.unions, step.to.personId, false);
        if (step.to.temp && tempShown?.person === step.to.personId) tempShown = null;
        const from = step.from;
        state.rowType = from.rowType;
        const fst = state.types[from.rowType];
        fst.selected = from.row;
        fst.top = from.scrollTop;
        fst.left = from.scrollLeft;
        const el = document.getElementById('table-container');
        if (!el || TreeRenderer.getViewMode() !== 'table') return true;
        this.renderTableView(el);
        const grid = mounted?.grid;
        if (!grid) return true;
        const at = Math.max(0, (mounted?.display?.columns ?? []).findIndex(c => c.id === from.col));
        grid.flash([from.row]);
        grid.restoreCell(from.key, at, from.scrollTop, from.scrollLeft, focus);
        return true;
    },

    /** Enter on a cell naming several of the tree's people (spec 103 1i): "Go to…" with each one. */
    tableLinkPick(line: GridLine, col: ColumnDef, names: readonly CellName[], anchor: HTMLElement): void {
        const entries: MenuEntry[] = names.filter(n => !!n.personId).map((n, i) => ({
            id: `link${i}`, label: n.text, icon: '', run: () => this.tableJumpBy(line, col, n.personId as PersonId),
        }));
        if (entries.length) openHeadMenu(anchor, strings.table.link.pick, '', entries);
    },

    tableNameAction(line: GridLine, name: CellName, anchor: HTMLElement, col?: ColumnDef): void {
        closeHeadMenu();
        const role = name.role;
        // A person's link in the People and Unions tables (spec 103 U3): a jump to their row.
        const type = stateOf(treeKey()).rowType;
        if (!role && name.personId && col && (type === 'persons' || type === 'unions')) {
            this.tableJumpBy(line, col, name.personId as PersonId);
            return;
        }
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
        // Go to {name} (spec 103, decision D6 c): first, the jump to their row in the People table.
        const goTo = (): void => { if (personId && col) this.tableJumpBy(line, col, personId as PersonId); };
        if (isPhoneBar() || isCoarsePointer()) {
            const rows = personId && col ? [{ label: t.link.goTo(name.text), icon: '→', run: goTo }] : [];
            rows.push({ label: t.filterParticipant[role](name.text), icon: '', run: filter });
            if (personId) rows.push({ label: t.act.open, icon: '▤', run: open });
            this.noteBottomSheetTrigger();
            this.hideBottomSheet();
            this.presentMenuSheet(name.text, [{ rows }]);
            return;
        }
        const entries: MenuEntry[] = personId && col ? [{ id: 'goTo', label: t.link.goTo(name.text), icon: '→', run: goTo }] : [];
        entries.push({ id: 'participant', label: t.filterParticipant[role](name.text), icon: '', run: filter });
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
        // Only adds its value to the column's, Without one more exclusion (spec 103 K1.1, K1.3).
        const only = (item: ColumnFilter) => (): void => this.changeTableFilter(f => addOnlyFilter(f, item), true);
        const without = (item: ColumnFilter) => (): void => this.changeTableFilter(f => addWithoutFilter(f, item), true);
        const out: HeadMenuItem[] = [];
        const copy = choices.copy;
        if (copy) out.push({ id: 'cellCopy', label: t.cell.copy, icon: '', hint: fanZoomModifier() === '⌘' ? '⌘C' : 'Ctrl+C', run: () => copyPlainText(copy) });
        if (choices.only) out.push({ id: 'cellOnly', label: t.cell.only(choices.label), icon: '', run: only(choices.only) });
        if (choices.without) out.push({ id: 'cellWithout', label: t.cell.without(choices.label), icon: '', run: without(choices.without) });
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
    /**
     * The pinned rows' lines for the grid (spec 103 §3): rows gone from the
     * data drop out; in the table's order, kept until the sort, the filter,
     * the search or the view change (D7 a); a person with their union
     * sub-rows as the body draws them (D5 a); those the filter hides marked.
     * Null with none, and on a phone (no pins there).
     */
    tablePinnedLines(
        m: TableModel, type: RowType, st: RowTypeState, view: unknown, shown: readonly TableRow[], pass: UnionPredicate | null, phone: boolean,
    ): { lines: readonly GridLine[]; keys: ReadonlySet<string>; outside: ReadonlySet<string> } | null {
        if (!pins.count()) return null;
        const byKey = new Map(rowsOf(m, type).map(r => [rowKey(r), r] as const));
        pins.prune(k => byKey.has(k));
        if (!pins.count() || phone) return null;
        const shownKeys = shown.map(rowKey);
        const shownSet = new Set(shownKeys);
        const ctx = JSON.stringify([st.filter, searchQuery(st.search), st.sort, view]);
        const order = pins.ordered(ctx, keys => pinRanks(keys, shownKeys, () => {
            const hidden = keys.filter(k => !shownSet.has(k)).map(k => byKey.get(k)!);
            const all = st.sort.length ? sortRows(m, type, [...shown, ...hidden], st.sort, pass ? sortUnionOf(pass) : undefined) : rowsOf(m, type);
            return all.map(rowKey);
        }));
        const rows = order.map(k => byKey.get(k)).filter((r): r is TableRow => !!r);
        const lines = type === 'persons' ? buildLines(rows, { collapse: st.unions, pass, revealed: new Set(st.revealedUnions) }) : plainLines(rows);
        return { lines, keys: new Set(order), outside: new Set(order.filter(k => !shownSet.has(k))) };
    },

    /** Pin or unpin rows (spec 103 §3) and draw; the focus stays in its cell. */
    changeTablePins(change: () => unknown): void {
        change();
        if (mounted) this.renderTableView(mounted.container);
    },

    /**
     * The rows of a text selected across several rows of the grid (spec 103
     * 3g: the grid selects cells one at a time, a range is the selected
     * text), their row keys, each once; empty without one across rows.
     */
    tableAreaRowKeys(): string[] {
        const grid = mounted?.grid.el;
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (!grid || !sel || sel.isCollapsed || !sel.rangeCount) return [];
        const range = sel.getRangeAt(0);
        if (!grid.contains(range.commonAncestorContainer)) return [];
        const keys = [...grid.querySelectorAll<HTMLElement>('.tv-body .tv-row[data-key]')]
            .filter(r => range.intersectsNode(r)).map(r => r.dataset.key!.split('#')[0]);
        const out = [...new Set(keys)];
        return out.length > 1 ? out : [];
    },

    /**
     * The row menu's pin item (spec 103 3b, 3g, 3h): Pin row, Pin rows (n)
     * for a selected range the click is in, Unpin row on a pinned row;
     * disabled with why when the pins would go over PIN_MAX. None on a phone.
     */
    tableRowPinEntry(line: GridLine, area: readonly string[]): HeadMenuItem | null {
        if (isPhoneBar()) return null;
        const t = strings.table.pinRow;
        const key = rowKey(line.row);
        const icon = pinSvg(14);
        const many = area.length > 1 && area.includes(key) && pins.fresh(area).length ? area : null;
        if (!many && pins.has(key)) return { id: 'unpin', label: t.unpin, icon: '', iconHtml: icon, run: () => this.changeTablePins(() => pins.unpin(key)) };
        const keys = many ?? [key];
        const can = pins.canPin(keys);
        return {
            id: 'pin', label: many ? t.many(many.length) : t.one, icon: '', iconHtml: icon,
            ...(can ? {} : { disabled: true, title: t.limit }),
            run: () => { if (pins.count() + pins.fresh(keys).length <= PIN_MAX) this.changeTablePins(() => pins.pin(keys)); },
        };
    },

    /**
     * "Add to list ›" of a row's menu (spec 084 §4): its own menu of the
     * fixed lists. One person: ✓ where they are; a range selected across
     * rows: "Add n people to a list", each person once, no ✓. A union
     * brings both partners, an event its people; a source none.
     */
    tableRowListEntry(line: GridLine, area: readonly string[], anchor: HTMLElement): HeadMenuItem | null {
        if (line.kind === 'more' || !model || DataManager.listsReadOnly()) return null;
        const type = stateOf(treeKey()).rowType;
        const many = area.length > 1 && area.includes(rowKey(line.row));
        const byKey = many ? new Map(rowsOf(model, type).map(r => [rowKey(r), r] as const)) : null;
        const rows = byKey ? area.map(k => byKey.get(k)).filter((r): r is TableRow => !!r) : [line.row];
        const ids = [...new Set(rows.flatMap(rowPeople))];
        if (!ids.length) return null;
        const c = strings.contextMenu;
        const label = many ? strings.table.act.toListN(ids.length) : c.toList;
        return {
            id: 'to-list', label, icon: '', hint: '›',
            run: () => {
                const menu = openHeadMenu(anchor, '', '', listMenuEntries(this, ids,
                    () => this.showNewPersonList({ personIds: ids }), ids.length > 1 ? c.newListWithMany : c.newListWith));
                menu.setAttribute('aria-label', label);
            },
        };
    },

    /**
     * Save as list of people (spec 084 §6): the People or Unions table's
     * people in the order of its rows (filter and sort, no row shown for
     * now; a union's both partners, each person once), the filter and sort
     * as a copy for an automatic list, the pinned rows outside the filter said.
     */
    saveTableAsList(): void {
        if (!mounted || !model) return;
        const state = stateOf(treeKey());
        const type = state.rowType;
        if (!canSaveAsList(type) || (type !== 'persons' && type !== 'unions')) return;
        const st = state.types[type];
        const ids = [...new Set(mounted.saveRows.flatMap(rowPeople))];
        const byKey = new Map(rowsOf(model, type).map(r => [rowKey(r), r] as const));
        const outside = [...mounted.pinOutside].map(k => byKey.get(k)).filter((r): r is TableRow => !!r)
            .flatMap(rowPeople).map(id => DataManager.getPerson(id)).filter((p): p is Person => !!p).map(p => personName(p));
        const open = viewList(state, storedViews(), DataManager.isReadOnly());
        const name = [...open.builtin, ...open.research, ...open.custom].find(v => v.active)?.name;
        this.showNewPersonList({
            source: type === 'unions' ? 'unions' : 'table',
            rule: (() => { const v = viewFromState(type, st, '', '', ''); return { kind: 'tableFilter' as const, rowType: type, filter: v.filter, sort: v.sort }; })(),
            personIds: ids, pinOut: outside.join(', '), ...(name ? { name } : {}),
        });
    },

    /** The rows of Scope ▾ and the phone's Scope › (spec 084 §9): Whole tree, the lists, Manage lists…. */
    tableScopeRows(): ScopeRow[] {
        const state = stateOf(treeKey());
        const current = scopeOfType(state, state.rowType)?.listId ?? null;
        const t = strings.table;
        const rows: ScopeRow[] = [{ id: 'scope-whole', label: t.scopeWhole, current: !current, run: () => this.setTableScopeTo(null) }];
        for (const l of DataManager.getPersonLists()) {
            rows.push({
                id: `scope-${l.id}`, label: listDisplayName(l), iconHtml: listKindIcon(listKind(l), 16), count: DataManager.getPersonListIds(l.id).length,
                current: l.id === current, run: () => this.setTableScopeTo(l.id),
            });
        }
        // A read-only export shows the scope without Manage lists… (spec 084 §9).
        if (!DataManager.isReadOnly()) rows.push({ id: 'scope-manage', label: t.scopeManage, run: () => this.showPersonLists(current ? { listId: current } : {}) });
        return rows;
    },

    /** Scope ▾ (spec 084 §9): Whole tree ✓, the lists with their kind and count (✓ on the chosen one), Manage lists…. */
    showTableScopeMenu(anchor: HTMLElement): void {
        const rows = this.tableScopeRows();
        const item = (r: ScopeRow): MenuEntry => ({
            id: r.id, label: r.label, icon: '', ...(r.iconHtml ? { iconHtml: r.iconHtml } : {}), checked: !!r.current,
            ...(r.count !== undefined && !r.current ? { hint: String(r.count) } : {}), run: r.run,
        });
        const manage = rows.find(r => r.id === 'scope-manage');
        const lists = rows.filter(r => r.id !== 'scope-whole' && r !== manage);
        const entries: MenuEntry[] = [item(rows[0])];
        if (lists.length) entries.push(SEP, { heading: strings.lists.title }, ...lists.map(item));
        if (manage) entries.push(SEP, item(manage));
        const menu = openHeadMenu(anchor, strings.table.scope, '', entries);
        menu.classList.add('tv-scope-menu');
    },

    /** The phone's Scope › page rows (spec 084 §9). */
    tableScopeSheetRows(): { id: string; label: string; icon: string; iconHtml?: string; value?: string; ariaLabel?: string; run: () => void }[] {
        return this.tableScopeRows().map(r => ({
            id: r.id, label: r.label, icon: '', ...(r.iconHtml ? { iconHtml: r.iconHtml } : {}),
            value: r.current ? '✓' : r.count !== undefined ? String(r.count) : '',
            ...(r.current ? { ariaLabel: `${r.label} ✓` } : {}), run: r.run,
        }));
    },

    /** Choose the Table's scope (spec 084 §9): a list, or the whole tree (null); the pinned rows stay. */
    setTableScopeTo(listId: string | null): void {
        const state = stateOf(treeKey());
        if (state.rowType === 'sources') return;
        if (!setTableScope(state, listId)) return;
        tempShown = null;
        hiddenJump = null;
        if (mounted) this.renderTableView(mounted.container);
    },

    /**
     * Open in Table (spec 084 §9) from the lists: the People table in the
     * list's scope; `noSource` (the "N without citation" tile) with the chip
     * of people without a source.
     */
    openTableInScope(listId: string, opts: { noSource?: boolean } = {}): void {
        if (!DataManager.getPersonList(listId)) return;
        const state = stateOf(treeKey());
        setTableScope(state, listId);
        state.rowType = 'persons';
        tempShown = null;
        hiddenJump = null;
        const st = state.types.persons;
        if (opts.noSource && setChip(st.filter, 'noSource', true)) filterChanged(st);
        this.showTableNow();
    },

    /**
     * Edit rule… of a list made from a Table filter (spec 084 §7, §9): the
     * Table with the rule's filter and sort on the whole tree; its ⋯ offers
     * Save to the list.
     */
    openTableForRule(listId: string): void {
        const list = DataManager.getPersonList(listId);
        const rule = list?.rule;
        if (!rule || rule.kind !== 'tableFilter') return;
        const tree = treeKey();
        const state = stateOf(tree);
        setTableScope(state, null);
        const st = state.types[rule.rowType];
        st.filter = { op: 'and', items: structuredClone(rule.filter.items) as unknown as TableFilter['items'] };
        st.sort = rule.sort.map(x => ({ col: x.col, dir: x.dir === -1 ? 'desc' : 'asc' }));
        filterChanged(st);
        st.top = 0;
        state.rowType = rule.rowType;
        tempShown = null;
        hiddenJump = null;
        ruleEdit = { tree, listId };
        this.showTableNow();
    },

    /** The Table on screen, drawn anew. */
    showTableNow(): void {
        if (TreeRenderer.getViewMode() !== 'table') { this.setDisplayViewMode('table'); return; }
        const el = document.getElementById('table-container');
        if (el) this.renderTableView(el);
    },

    /** The list whose Table filter rule is being edited here (spec 084 §7), while the Table shows its row type. */
    tableRuleList(): PersonList | null {
        const tree = treeKey();
        if (!ruleEdit || ruleEdit.tree !== tree || DataManager.listsReadOnly()) return null;
        const list = DataManager.getPersonList(ruleEdit.listId);
        if (!list?.rule || list.rule.kind !== 'tableFilter') { ruleEdit = null; return null; }
        return stateOf(tree).rowType === list.rule.rowType ? list : null;
    },

    /** Save to the list {n} (spec 084 §7): the rule takes the Table's filter and sort as they are now. */
    saveTableRule(): void {
        const list = this.tableRuleList();
        if (!list || list.rule?.kind !== 'tableFilter') return;
        const type = list.rule.rowType;
        const st = stateOf(treeKey()).types[type];
        const v = viewFromState(type, st, '', '', '');
        if (!DataManager.setPersonListRule(list.id, { kind: 'tableFilter', rowType: type, filter: v.filter, sort: v.sort }, list.dynamic)) return;
        ruleEdit = null;
        this.showToast(strings.lists.toast.saved(listDisplayName(list)));
        if (mounted) this.renderTableView(mounted.container);
    },

    /** A work list's Done box (spec 084 §13d): the person ticked off or back, one undo step. */
    toggleTableDone(line: GridLine): void {
        if (line.kind !== 'row' || line.row.kind !== 'person' || DataManager.listsReadOnly()) return;
        const scope = scopeOfType(stateOf(treeKey()), 'persons');
        if (!scope?.cells.done || !scope.cells.pos.has(line.row.id)) return;
        DataManager.togglePersonListDone(scope.listId, line.row.id);
    },

    /**
     * Remove from the list (spec 084 §9d): in the scope of a fixed list, the
     * row's person (or the people of a range selected across rows) out of it.
     */
    tableRowRemoveIds(line: GridLine, area: readonly string[]): PersonId[] {
        if (line.kind === 'more' || DataManager.listsReadOnly() || !model) return [];
        const state = stateOf(treeKey());
        if (state.rowType !== 'persons') return [];
        const scope = scopeOfType(state, 'persons');
        if (!scope?.fixed) return [];
        const keys = area.length && area.includes(rowKey(line.row)) ? area : [rowKey(line.row)];
        return keys.filter(k => k.startsWith('p:')).map(k => k.slice(2) as PersonId).filter(id => scope.cells.pos.has(id));
    },

    removeTableRowsFromList(ids: PersonId[]): void {
        const scope = scopeOfType(stateOf(treeKey()), 'persons');
        if (scope?.fixed && ids.length) DataManager.removePersonsFromList(scope.listId, ids);
    },

    showTableRowMenu(line: GridLine, anchor: HTMLElement, cell: GridCellRef | null = null): void {
        if (line.kind === 'more') return;
        if (isPhoneBar()) { this.showTableRowSheet(line, cell); return; }
        const t = strings.table;
        const run = (a: RowAction) => () => this.tableRowAction(a, line);
        const src = line.row.kind === 'source' ? line.row : null;
        // A text selected across rows (spec 103 3g): the cell's part is Copy only, its text.
        const area = isPhoneBar() ? [] : this.tableAreaRowKeys();
        const areaText = area.length ? window.getSelection()?.toString() ?? '' : '';
        const cellPart: MenuEntry[] = area.length
            ? [{ id: 'cellCopy', label: t.cell.copy, icon: '', hint: fanZoomModifier() === '⌘' ? '⌘C' : 'Ctrl+C', run: () => copyPlainText(areaText) }]
            : this.tableCellChoices(line, cell);
        // T54 F8: the cell edited in place, as F2 does.
        if (!area.length && cell && this.tableEditTarget(line, cell.col)) {
            cellPart.push({ id: 'cell-edit', label: t.cell.edit, icon: '', hint: 'F2', run: () => { mounted?.grid.editActive(); } });
        }
        const entries: MenuEntry[] = cellPart.length ? [...cellPart, SEP] : [];
        if (src) entries.push({ id: 'open', label: t.act.openSource, icon: '▤', hint: 'Enter', run: run('open') });
        else {
            if (treeActionOffered()) entries.push({ id: 'tree', label: t.act.tree, icon: '⌖', run: run('tree') });
            entries.push({ id: 'open', label: t.act.open, icon: '▤', hint: 'Enter', run: run('open') });
        }
        if (!tableReadOnly()) entries.push({ id: 'edit', label: t.act.edit, icon: '✎', hint: t.dblClickHint, run: run('edit') });
        // Pin or unpin the row (spec 103 3b), after Edit, before the unions.
        const pin = this.tableRowPinEntry(line, area);
        if (pin) entries.push(SEP, pin);
        // Add to list › (spec 084 §4, 4c): the row's people, or those of a range selected across rows.
        const toList = this.tableRowListEntry(line, area, anchor);
        if (toList) entries.push(SEP, toList);
        // Remove from the list (spec 084 §9d): in the scope of a fixed list.
        const out = this.tableRowRemoveIds(line, area);
        if (out.length) entries.push({ id: 'listRemove', label: strings.lists.remove, icon: '', run: () => this.removeTableRowsFromList(out) });
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
        // A tablet's sheet pins the row too (spec 103 §3; a phone has no pins).
        const pin = this.tableRowPinEntry(line, []);
        const pinRows = pin ? [{ label: pin.label, icon: '', iconHtml: pin.iconHtml, ...(pin.disabled ? { sub: pin.title } : {}), run: pin.disabled ? () => {} : pin.run }] : [];
        const cellBlocks = this.tableCellSheetBlocks(line, cell);
        // People in the cell (spec 103 §4): Go to {name} for each of the tree's people the cell names, first.
        const type = stateOf(treeKey()).rowType;
        const links = cell && cell.col.id !== 'name' && (type === 'persons' || type === 'unions') ? personLinks(cell.value) : [];
        const linkBlocks = links.length ? [{
            header: t.link.inCell,
            rows: links.map(n => ({ label: t.link.goTo(n.text), icon: '→', value: '›', run: () => this.tableJumpBy(line, cell!.col, n.personId as PersonId) })),
        }] : [];
        const blocks: { rows: typeof rows; divider?: boolean }[] = [
            ...cellBlocks.map((b, i) => (i === 0 && linkBlocks.length ? { ...b, divider: true } : b)),
            cellBlocks.length || linkBlocks.length ? { rows, divider: true } : { rows },
            ...(pinRows.length ? [{ rows: pinRows, divider: true }] : []),
        ];
        // Add to list › (spec 084 §4, 15e): a second page of the sheet; the row's people (no range by touch).
        const people = rowPeople(line.row);
        if (people.length && !DataManager.listsReadOnly()) {
            const c = strings.contextMenu;
            const page = listSheetPage(this, people, () => this.showNewPersonList({ personIds: people }),
                people.length > 1 ? c.newListWithMany : c.newListWith);
            const out = this.tableRowRemoveIds(line, []);
            blocks.push({
                rows: [{ label: c.toList, icon: '', run: () => {}, page } as typeof rows[number],
                    ...(out.length ? [{ label: strings.lists.remove, icon: '', run: () => this.removeTableRowsFromList(out) }] : [])],
                divider: true,
            });
        }
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
        this.presentMenuSheet(title, [...linkBlocks, ...blocks], sub ? { subtitle: sub } : {});
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
        } else if (change.kind === 'lifeEvent') {
            // A shared event's common field goes to every copy (spec 085 §4), in one undo step.
            const id = change.personId;
            const ev = DataManager.getPerson(id)?.events?.find(e => e.id === change.eventId);
            if (!ev) return null;
            const copies = ev.shareId ? shareCopiesOf(data, ev.shareId) : [];
            const ids = copies.length ? copies.map(c => c.personId) : [id];
            watching = { tree: treeKey(), name: personNameOf(id), keys: watchEdit(data, ids.flatMap(p => familyKeys(data, p))) };
            if (ids.length >= 2) {
                // The toast of the save says for how many ("Date: changed for 4 people (Census 1921)."), not "Saved: {name}".
                const title = sharedEventTitle(ev, strings.events.types[ev.type]);
                const word = strings.validation.sharedFields[change.field];
                watching.message = strings.events.sharedCellChanged(word.charAt(0).toLocaleUpperCase() + word.slice(1), title, ids.length);
            }
            const n = DataManager.updateSharedCommonField(id, change.eventId, change.field, change.value);
            if (n === 0) { watching = null; return null; }
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
        this.showToast(w.message ?? strings.table.savedToast(w.name()));
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
            // Save as list of people (spec 084 §6): after Delete, behind its own separator.
            if (canSaveAsList(state.rowType)) entries.push(SEP, { id: 'saveList', label: strings.lists.saveAs, icon: '', run: () => this.saveTableAsList() });
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

    /** The coverage row's label "filled" (T54 H9, H12): what the row counts and why a share is bold; a phone: the sheet. */
    showTableCoverageHelp(anchor: HTMLElement): void {
        const t = strings.table;
        const body = `<div class="tv-bub-note">${escHtml(t.coverageHelp)}</div>`;
        if (isPhoneBar()) {
            this.showTableSheet(sheetElement(t.coverageRow, body, 'legend', () => this.hideBottomSheet()));
            return;
        }
        openBubblePanel({ rect: anchor.getBoundingClientRect(), label: t.coverageRow, kind: 'legend', focusBack: () => anchor, html: body });
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
        // The scope's rows only (spec 084 §9), People with the scope's # and Done first as drawn (§12).
        const scope = scopeOfType(state, type);
        const shown = viewRows(tree, model, type, st.filter, st.search, st.sort, display.columns, scope);
        const filter = filterSummary(model, type, st.filter, st.search);
        const every = scopeRows(model, type, scope);
        const whole = unfiltered && !!filter;
        // A row kept after an edit that no longer passes (§10.3) is not part of the export.
        const rows = whole
            ? (st.sort.length ? sortRows(model, type, every, st.sort) : [...every])
            : shown.stale.size ? shown.rows.filter(r => !shown.stale.has(rowKey(r))) : shown.rows;
        const own = shownColumns(type, st, false);
        const leads = type === 'persons' && scope ? leadColumnsOf(scope) : [];
        if (leads.length) applyScopeCells(model, scope);
        const all = leads.length
            ? { columns: [...leads, ...own.columns], widths: [...leads.map(c => c.width), ...own.widths], pinned: own.pinned + leads.length }
            : own;
        const treeName = (tree && TreeManager.getTreeMetadata(tree as TreeId)?.name) || '';
        const view = openViewOf(state, type, storedViews()).name;
        const now = new Date();
        return {
            input: { model, type, rows, columns: all.columns, pass: whole ? null : shown.pass, groups: this.tableExportGroups(model, type, st, scope, rows) },
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

    /**
     * ⋯ of a list › Export › CSV (spec 084 §12): downloaded at once — the
     * People table's columns as the Table has them, # first (and Done of a
     * work list), the list's people in its order, `{tree}_{list}_{day}.csv`.
     */
    exportPersonListCsv(listId: string): void {
        const list = DataManager.getPersonList(listId);
        const scope = tableScopeOf(listId);
        if (!list || !scope) return;
        const data = DataManager.getData();
        const lang = getCurrentLanguage();
        const homeId = TreeRenderer.getFocusPersonId();
        const rev = DataManager.getRevision();
        const tree = treeKey();
        if (!modelIsCurrent(model, data, rev, homeId, lang)) {
            model = buildTableModel(data, { rev, homeId, lang, reliability: this.reliabilityOptionsNow() });
        }
        const m = model!;
        applyChecks(m, this.tableChecksFor(tree, data, rev));
        applyResearch(m, this.tableResearchEnv(data, rev, m));
        const before = m.ctx.scope;
        applyScopeCells(m, scope);
        try {
            const st = stateOf(tree).types.persons;
            const columns = [...leadColumnsOf(scope), ...shownColumns('persons', st, false).columns];
            const csv = buildTableCsv({ model: m, type: 'persons', rows: scopeRows(m, 'persons', scope), columns, pass: null });
            const treeName = (tree && TreeManager.getTreeMetadata(tree as TreeId)?.name) || '';
            const file = tableCsvFileName(treeName, listDisplayName(list), new Date(), 'csv');
            const url = URL.createObjectURL(new Blob([csv.csv], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = file;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            this.showToast(strings.table.exportedToast.p(file, csv.items, csv.lines, csv.columns), 5000);
        } finally {
            m.ctx.scope = before;
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

    /**
     * ⋯ of the Table. Wider than a phone (spec 084 §6) a menu under it:
     * Save as list of people (the People and Unions tables of a tree that
     * takes changes); D4 puts Group by › and Collapse / Expand all groups
     * above it, behind a separator. On a phone (12a) a sheet: Save as list
     * of people, then Columns, Export, Coverage row and Expand or Collapse unions.
     */
    /** What Group by offers (spec 084 §10): Research line in a tree with research lines, Done in a work list's scope. */
    tableGroupOffer(m: TableModel, scope: TableScope | null): GroupOffer {
        return { lines: treeHasLines(m), work: !!scope?.cells.done };
    },

    /** The export's rows in their groups (spec 084 §10: flat, the group first); null: not grouped. */
    tableExportGroups(m: TableModel, type: RowType, st: RowTypeState, scope: TableScope | null, rows: readonly TableRow[]): { group: string; row: TableRow }[] | null {
        if (!groupingFits(type, st.group, this.tableGroupOffer(m, scope))) return null;
        return groupedExportRows(groupRows(m, type, st.group.by, rows, scope?.cells.done ?? null));
    },

        /** Group the rows by a value (spec 084 §10), null: no grouping; the groups start open. */
    setTableGroupBy(by: TableGroupKey | null): void {
        this.changeTableColumns((st) => {
            if ((st.group?.by ?? null) === by) return false;
            st.group = by ? { by, collapsed: [] } : null;
            return true;
        });
    },

    /** One group opened (true) or closed (false) by its header. */
    toggleTableRowGroup(key: string, open: boolean): void {
        this.changeTableColumns((st) => {
            if (!st.group) return false;
            const shut = st.group.collapsed.includes(key);
            if (shut !== open) return false;
            st.group = { by: st.group.by, collapsed: open ? st.group.collapsed.filter(k => k !== key) : [...st.group.collapsed, key] };
            return true;
        });
    },

    /** Collapse all groups (true) or expand them all (false). */
    setTableGroupsCollapsed(collapse: boolean): void {
        const keys = mounted?.groupKeys;
        this.changeTableColumns((st) => {
            if (!st.group || !keys) return false;
            st.group = { by: st.group.by, collapsed: collapse ? [...keys] : [] };
            return true;
        });
    },

    /** Group by's choices (spec 084 §10): No grouping, then the keys the row type offers, the chosen one ticked. */
    tableGroupChoices(): { id: string; label: string; current: boolean; run: () => void }[] {
        const state = stateOf(treeKey());
        const type = state.rowType;
        const st = state.types[type];
        const scope = scopeOfType(state, type);
        const offer = model ? this.tableGroupOffer(model, scope) : { lines: false, work: false };
        const by = groupingFits(type, st.group, offer) ? st.group.by : null;
        const t = strings.table;
        return [
            { id: 'group-none', label: t.groupNone, current: !by, run: () => this.setTableGroupBy(null) },
            ...offeredGroupKeys(type, offer).map(k => ({ id: `group-${k}`, label: t.groupKey[k], current: by === k, run: () => this.setTableGroupBy(k) })),
        ];
    },

    showTableMoreMenu(): void {
        const state = stateOf(treeKey());
        const st = state.types[state.rowType];
        const t = strings.table;
        const saveList = canSaveAsList(state.rowType);
        const groupChoices = this.tableGroupChoices();
        const groupedBy = groupChoices.find(c => c.current && c.id !== 'group-none')?.label ?? null;
        // Editing a Table filter rule (spec 084 §7, §9): its list takes the filter as it is now.
        const ruleList = this.tableRuleList();
        const saveRule = ruleList ? { label: strings.lists.saveRule(listDisplayName(ruleList)), run: () => this.saveTableRule() } : null;
        if (!isPhoneBar()) {
            const anchor = mounted?.bar.querySelector<HTMLElement>('.tv-more-menu-btn');
            const hasRows = !!rowCounts(model)[state.rowType];
            const canGroup = hasRows && groupChoices.length > 1;
            if (!anchor || (!saveRule && (!hasRows || (!saveList && !canGroup)))) return;
            const entries: MenuEntry[] = [];
            // Group by › and Collapse / Expand all groups (spec 084 §10), then the saves.
            if (canGroup) {
                entries.push({
                    id: 'groupBy', label: t.groupBy, icon: '', hint: `${groupedBy ?? ''} ›`,
                    run: () => {
                        const sub: MenuEntry[] = groupChoices.map(c => ({ id: c.id, label: c.label, icon: '', checked: c.current, run: c.run }));
                        sub.splice(1, 0, SEP);
                        openHeadMenu(anchor, t.groupBy, '', sub);
                    },
                });
                entries.push({ id: 'groupsCollapse', label: t.groupsCollapse, icon: '', disabled: !groupedBy, run: () => this.setTableGroupsCollapsed(true) });
                entries.push({ id: 'groupsExpand', label: t.groupsExpand, icon: '', disabled: !groupedBy, run: () => this.setTableGroupsCollapsed(false) });
            }
            if ((saveRule || (saveList && hasRows)) && entries.length) entries.push(SEP);
            if (saveRule) entries.push({ id: 'saveRule', label: saveRule.label, icon: '', run: saveRule.run });
            if (saveList && hasRows) entries.push({ id: 'saveList', label: strings.lists.saveAs, icon: '', run: () => this.saveTableAsList() });
            openHeadMenu(anchor, '', '', entries);
            return;
        }
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
        // The phone's ⋯ starts with Scope › (spec 084 §9; not for Sources) and the saves.
        const first: { label: string; run: () => void; value?: string; id?: string; page?: { title: string; rows: { label: string; run: () => void; value?: string; iconHtml?: string; icon?: string; id?: string; ariaLabel?: string }[] } }[] = [];
        if (state.rowType !== 'sources') {
            const scope = scopeOfType(state, state.rowType);
            first.push({
                id: 'tv-scope-row', label: t.scope, value: scope ? listDisplayName(scope.list) : t.scopeWhole,
                run: () => {}, page: { title: t.scope, rows: this.tableScopeSheetRows() },
            });
        }
        // Group by › (spec 084 §10): its page lists the choices, the chosen one ticked.
        if (groupChoices.length > 1 && rowCounts(model)[state.rowType]) {
            first.push({
                id: 'tv-group-row', label: t.groupBy, value: groupedBy ?? t.groupNone, run: () => {},
                page: {
                    title: t.groupBy,
                    rows: groupChoices.map(c => ({
                        id: c.id, label: c.label, icon: '', value: c.current ? '✓' : '', ...(c.current ? { ariaLabel: `${c.label} ✓` } : {}), run: c.run,
                    })),
                },
            });
        }
        if (saveRule) first.push({ label: saveRule.label, run: saveRule.run });
        if (saveList) first.push({ label: strings.lists.saveAs, run: () => this.saveTableAsList() });
        this.presentMenuSheet(t.moreActions, first.length ? [{ rows: first }, { rows, divider: true }] : [{ rows }]);
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
