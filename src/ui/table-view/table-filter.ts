/**
 * Table view (spec 073 §8): filters, search and sorting of the rows.
 *
 * The filter is a tree with an operator (§8.2, §9.1: `{ op: 'and', items }`,
 * so P3 can add "or" and "not"); its items are the quick chips (§8.1) and the
 * column filters (§8.2), all joined by "and", and the search (§8.3) is one
 * more "and". A filter on a union column of the People table is judged for
 * each union apart (§3.3): a person passes when at least one union passes.
 *
 * Sorting works over the cells' sort keys (cached in the rows). Rows without
 * a value sort last in both directions; ties keep the base order, so the
 * order never wobbles between renders. No DOM here.
 */

import { cellOf, columnById, columnLabel, type ColumnDef, type ColumnKind, type SortSpec } from './table-columns.js';
import { rowsOf, type CellValue, type EventCategory, type EventRow, type PersonRow, type RowType, type TableModel, type TableRow } from './table-model.js';
import { cellFilled } from './table-coverage.js';
import { personPassesUnions, type UnionPredicate } from './table-subrows.js';
import { rodOf, type RodId } from '../../lineage.js';
import { RELIABILITY_ORDER } from '../../reliability.js';
import { strings } from '../../strings.js';
import type { EventParticipant, ParticipantRole, PersonId } from '../../types.js';
import { shownNameOrEmpty } from '../../person-name.js';

// ---------------------------------------------------------------------------
// The filter's shape (§8.2, §9.1). Part D stores it in `TableView.filter`.

/** The quick chips (§8.1), in their fixed order. */
export const CHIP_ORDER = ['living', 'deceased', 'blood', 'rod', 'gen', 'multiU', 'noBirth', 'uncertain', 'noSource', 'finding', 'unusual', 'unconfirmed'] as const;

/** The Events table's quick chips (§14.1), in their fixed order. */
export const EVENT_CHIP_ORDER = ['evBirth', 'evMarriage', 'evDeath', 'evOther', 'noSource'] as const;

/**
 * Every chip: the quick ones of both row types and the participant filter
 * (§14.1 "Godparent: {name} ×"), which is set from a participant's name in
 * a cell and is not in the quick row.
 */
export type ChipId = typeof CHIP_ORDER[number] | typeof EVENT_CHIP_ORDER[number] | 'participant';

/** The event chips that exclude each other (one family of events at a time). */
const EVENT_KIND_CHIPS: Readonly<Record<string, EventCategory>> = { evBirth: 'birth', evMarriage: 'marriage', evDeath: 'death', evOther: 'other' };

/**
 * A quick chip. Family line: the chosen lines (`values`, RodIds); Generation:
 * the range `from`–`to` (1-based). Participant: the `role` and the tree's
 * person (`personId`) or the name as written (`name`; with a person, the name
 * it had when chosen).
 */
export interface ChipFilter {
    chip: ChipId;
    values?: string[];
    from?: number;
    to?: number;
    role?: ParticipantRole;
    personId?: string;
    name?: string;
}

/**
 * A column filter (§8.2): text "contains" / "starts with"; a date by years
 * `from`–`to`; an age or a number `from`–`to` (bounds included); a pill or
 * an enumeration by `values`; and "only empty" / "only filled".
 */
export interface ColumnFilter {
    col: string;
    kind: ColumnKind;
    from?: number;
    to?: number;
    match?: 'contains' | 'starts';
    text?: string;
    values?: string[];
    empty?: true;
    filled?: true;
}

export type FilterItem = ChipFilter | ColumnFilter;

export interface TableFilter {
    op: 'and';
    items: FilterItem[];
}

export function emptyFilter(): TableFilter {
    return { op: 'and', items: [] };
}

export function isChipItem(item: FilterItem): item is ChipFilter {
    return 'chip' in item;
}

export function chipItem(filter: TableFilter, chip: ChipId): ChipFilter | null {
    return filter.items.find((i): i is ChipFilter => isChipItem(i) && i.chip === chip) ?? null;
}

export function columnItem(filter: TableFilter, col: string): ColumnFilter | null {
    return filter.items.find((i): i is ColumnFilter => !isChipItem(i) && i.col === col) ?? null;
}

export function columnItems(filter: TableFilter): ColumnFilter[] {
    return filter.items.filter((i): i is ColumnFilter => !isChipItem(i));
}

/** How a column is filtered (§8.2): text, a range (dates by years) or chosen values. */
export type FilterKind = 'text' | 'range' | 'values';

/** Enumerations filtered by their values (§8.2: union status, level), besides the pills. */
const VALUE_COLUMNS = new Set(['uStatus', 'topSev', 'gender', 'living', 'div', 'evid', 'certainty', 'rod']);

export function filterKindOf(col: ColumnDef): FilterKind {
    if (col.kind === 'pill' || VALUE_COLUMNS.has(col.id)) return 'values';
    if (col.kind === 'date' || col.kind === 'age' || col.kind === 'number' || col.kind === 'percent') return 'range';
    return 'text';
}

/** Whether a column filter says anything (an empty one is dropped). */
export function columnItemActive(item: ColumnFilter): boolean {
    return !!item.empty || !!item.filled || item.from !== undefined || item.to !== undefined
        || !!item.text?.trim() || (item.values?.length ?? 0) > 0;
}

/** Turn a quick chip on (with its choice) or off. Returns whether the filter changed. */
export function setChip(filter: TableFilter, chip: ChipId, on: boolean, choice: Omit<ChipFilter, 'chip'> = {}): boolean {
    const at = filter.items.findIndex(i => isChipItem(i) && i.chip === chip);
    if (!on) {
        if (at < 0) return false;
        filter.items.splice(at, 1);
        return true;
    }
    const item: ChipFilter = { chip, ...choice };
    if (at >= 0) {
        if (JSON.stringify(filter.items[at]) === JSON.stringify(item)) return false;
        filter.items[at] = item;
    } else {
        // Living and deceased exclude each other: the other goes off; so do the event families.
        const other = chip === 'living' ? 'deceased' : chip === 'deceased' ? 'living' : null;
        if (other) setChip(filter, other, false);
        if (chip in EVENT_KIND_CHIPS) for (const c of Object.keys(EVENT_KIND_CHIPS)) if (c !== chip) setChip(filter, c as ChipId, false);
        filter.items.push(item);
    }
    return true;
}

/** Set (or with an empty one, drop) a column's filter. */
export function setColumnFilter(filter: TableFilter, item: ColumnFilter): boolean {
    const at = filter.items.findIndex(i => !isChipItem(i) && i.col === item.col);
    const active = columnItemActive(item);
    if (at < 0 && !active) return false;
    if (at >= 0 && !active) { filter.items.splice(at, 1); return true; }
    if (at >= 0) {
        if (JSON.stringify(filter.items[at]) === JSON.stringify(item)) return false;
        filter.items[at] = item;
    } else filter.items.push(item);
    return true;
}

export function removeColumnFilter(filter: TableFilter, col: string): boolean {
    const at = filter.items.findIndex(i => !isChipItem(i) && i.col === col);
    if (at < 0) return false;
    filter.items.splice(at, 1);
    return true;
}

/** Only empty / only filled from the head menu or the coverage row: the column's filter becomes just that. */
export function setEmptyFilter(filter: TableFilter, col: ColumnDef, which: 'empty' | 'filled'): boolean {
    return setColumnFilter(filter, which === 'empty' ? { col: col.id, kind: col.kind, empty: true } : { col: col.id, kind: col.kind, filled: true });
}

export function clearFilter(filter: TableFilter): boolean {
    if (!filter.items.length) return false;
    filter.items = [];
    return true;
}

// ---------------------------------------------------------------------------
// Quick chips (§8.1)

/** Whether a chip applies to a row type and tree (§8.1: "Unconfirmed research" only in a research tree). */
export function chipAvailable(model: TableModel, type: RowType, chip: ChipId): boolean {
    if (type === 'events') return chip === 'participant' || (EVENT_CHIP_ORDER as readonly string[]).includes(chip);
    if (type !== 'persons' || !(CHIP_ORDER as readonly string[]).includes(chip)) return false;
    if (chip === 'unconfirmed') return model.ctx.reliability.researchTree;
    return true;
}

/** The quick chips a row type offers, in their fixed order (the participant filter is not one). */
export function availableChips(model: TableModel, type: RowType): ChipId[] {
    const order: readonly ChipId[] = type === 'events' ? EVENT_CHIP_ORDER : CHIP_ORDER;
    return order.filter(c => chipAvailable(model, type, c));
}

/** Chips that wait for the checks (§13i: disabled until the findings are computed). */
export const CHECK_CHIPS: readonly ChipId[] = ['finding', 'unusual'];

const UNCONFIRMED_STEPS: ReadonlySet<string> = new Set(RELIABILITY_ORDER.slice(RELIABILITY_ORDER.indexOf('proven'), RELIABILITY_ORDER.indexOf('lead') + 1));

function col(type: RowType, id: string): ColumnDef {
    return columnById(type, id)!;
}

/** A participant's name for the participant filter: the tree person's shown name, else as written. */
function participantText(model: TableModel, x: EventParticipant): string {
    const p = x.personId ? model.ctx.person(x.personId) : null;
    return (p ? shownNameOrEmpty(p) : '') || (x.name ?? '');
}

const foldName = (text: string): string => foldText(text).replace(/\s+/g, ' ').trim();

/**
 * The participant filter of a participant (§14.1: "Godparent: {name}"): the
 * role and the tree's person, or for a name only the name as written.
 */
export function participantChip(model: TableModel, x: EventParticipant): Omit<ChipFilter, 'chip'> {
    const p = x.personId ? model.ctx.person(x.personId) : null;
    const name = participantText(model, x).trim();
    return p ? { role: x.role, personId: p.id, name } : { role: x.role, name };
}

/**
 * Whether an event has the participant of a participant filter in its role:
 * the tree's person by id; a name only by its letters (case, diacritics and
 * spaces aside), linked participants by their shown name.
 */
export function eventHasParticipant(model: TableModel, row: EventRow, item: ChipFilter): boolean {
    if (!item.role) return true;
    const want = item.personId ? null : foldName(item.name ?? '');
    if (want === '') return true;
    return row.participants.some(x => x.role === item.role
        && (item.personId ? x.personId === item.personId : foldName(participantText(model, x)) === want));
}

/** Filter the events by a participant (§14.1: "Godparent: {name} ×"); replaces the participant filter there was. */
export function setParticipantFilter(filter: TableFilter, model: TableModel, x: EventParticipant): boolean {
    return setChip(filter, 'participant', true, participantChip(model, x));
}

/** Whether an event passes one chip (§14.1). */
export function eventPassesChip(model: TableModel, row: EventRow, item: ChipFilter): boolean {
    if (item.chip === 'participant') return eventHasParticipant(model, row, item);
    if (item.chip === 'noSource') return row.sourceIds.length === 0;
    const cat = EVENT_KIND_CHIPS[item.chip];
    return cat ? row.category === cat : true;
}

/** Whether a person passes one chip. Chips on findings pass everyone while the checks run. */
export function personPassesChip(model: TableModel, row: PersonRow, item: ChipFilter): boolean {
    const ctx = model.ctx;
    const p = row.person;
    switch (item.chip) {
        case 'living': return ctx.living(p);
        case 'deceased': return !ctx.living(p);
        case 'blood': return ctx.blood().has(row.id);
        case 'rod': {
            if (!item.values?.length) return true;
            const rod = rodOf(ctx.lineage().index, row.id as PersonId);
            return !!rod && item.values.includes(rod);
        }
        case 'gen': {
            const g = ctx.generations().get(row.id);
            if (g === undefined) return false;
            const n = g + 1;
            return (item.from === undefined || n >= item.from) && (item.to === undefined || n <= item.to);
        }
        case 'multiU': return row.unions.length > 1;
        case 'noBirth': return !p.birthDate?.trim();
        case 'uncertain': return cellOf(model, row, col('persons', 'bDate')).uncertain || cellOf(model, row, col('persons', 'dDate')).uncertain;
        case 'noSource': return cellOf(model, row, col('persons', 'srcCount')).sortKey === 0;
        case 'finding': {
            if (!ctx.checks) return true;
            const top = ctx.checks.person(row.id).top;
            return top === 'error' || top === 'warning';
        }
        case 'unusual': return !ctx.checks || ctx.checks.person(row.id).unusual > 0;
        case 'unconfirmed':
            return ['relN', 'relB', 'relD'].some(id => {
                const pill = cellOf(model, row, col('persons', id)).pill;
                return !!pill && UNCONFIRMED_STEPS.has(pill);
            });
        default: return true;
    }
}

/** The family lines of the tree with their names (the Family line chip's choice), by name. */
export function rodChoices(model: TableModel): { id: RodId; label: string; n: number }[] {
    const { index, labels } = model.ctx.lineage();
    const counts = new Map<RodId, number>();
    for (const row of model.persons) {
        const rod = rodOf(index, row.id);
        if (rod) counts.set(rod, (counts.get(rod) ?? 0) + 1);
    }
    const coll = new Intl.Collator(model.ctx.lang, { sensitivity: 'base', numeric: true });
    return [...labels].filter(([id]) => counts.has(id))
        .map(([id, label]) => ({ id, label, n: counts.get(id)! }))
        .sort((a, b) => coll.compare(a.label, b.label));
}

/** The generations of the tree (1-based, the Generation column's numbers): lowest and highest. */
export function generationSpan(model: TableModel): { min: number; max: number } | null {
    let min = Infinity;
    let max = -Infinity;
    const gens = model.ctx.generations();
    for (const row of model.persons) {
        const g = gens.get(row.id);
        if (g === undefined) continue;
        min = Math.min(min, g + 1);
        max = Math.max(max, g + 1);
    }
    return min <= max ? { min, max } : null;
}

// ---------------------------------------------------------------------------
// Column filters (§8.2)

/** Lowercase without diacritics (§8.3: "Klikv" finds "Klikvová"). */
export function foldText(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

const folded = new WeakMap<CellValue, string>();

/** A cell's text folded for search and text filters (cached per cell). */
function foldedCell(value: CellValue): string {
    let f = folded.get(value);
    if (f === undefined) {
        f = foldText([value.prefix ?? '', value.text].filter(Boolean).join(' '));
        folded.set(value, f);
    }
    return f;
}

/** The value a values filter compares (§8.2): a pill's step, a level's mark, else the text. */
export function enumValueOf(value: CellValue): string {
    return value.pill ?? value.mark ?? value.text;
}

/** A date cell's year (its start, §8.2), else null. */
function yearOf(value: CellValue): number | null {
    return typeof value.sortKey === 'number' ? Math.floor(value.sortKey / 10000) : null;
}

/** Whether one cell passes a column filter (all its conditions). */
export function cellPasses(value: CellValue, item: ColumnFilter, kind: FilterKind): boolean {
    if (item.empty && (value.na || cellFilled(value))) return false;
    if (item.filled && !cellFilled(value)) return false;
    if (kind === 'range' && (item.from !== undefined || item.to !== undefined)) {
        if (value.na || value.empty) return false;
        const n = item.kind === 'date' ? yearOf(value) : typeof value.sortKey === 'number' ? value.sortKey : null;
        if (n === null) return false;
        if (item.from !== undefined && n < item.from) return false;
        if (item.to !== undefined && n > item.to) return false;
    }
    if (kind === 'text' && item.text?.trim()) {
        if (value.na || value.empty) return false;
        const q = foldText(item.text.trim());
        const t = foldedCell(value);
        if (item.match === 'starts' ? !t.startsWith(q) : !t.includes(q)) return false;
    }
    if (kind === 'values' && item.values?.length) {
        if (value.na || value.empty) return false;
        if (!item.values.includes(enumValueOf(value))) return false;
    }
    return true;
}

/** The values a values filter offers for a column (§8.2), with the text each shows, in the column's sort order. */
export function columnValues(model: TableModel, type: RowType, column: ColumnDef): { value: string; label: string }[] {
    const seen = new Map<string, { label: string; key: number | string | null }>();
    const add = (v: CellValue): void => {
        if (v.na || v.empty) return;
        const key = enumValueOf(v);
        if (!seen.has(key)) seen.set(key, { label: v.text, key: v.sortKey });
    };
    for (const row of rowsOf(model, type)) {
        if (column.unionScoped && row.kind === 'person') row.unions.forEach((_u, i) => add(cellOf(model, row, column, i)));
        else add(cellOf(model, row, column));
    }
    return [...seen].sort((a, b) => compareKeys(a[1].key ?? '', b[1].key ?? '')).map(([value, x]) => ({ value, label: x.label }));
}

// ---------------------------------------------------------------------------
// Applying the filter and the search

export interface FilterResult {
    /** The rows that pass, in the base order. */
    rows: TableRow[];
    /** The union filters of the People table (§3.3); null without one. */
    pass: UnionPredicate | null;
}

/** The search's folded query; '' below 2 characters (§8.3). */
export function searchQuery(text: string): string {
    const q = foldText(text.trim());
    return q.length >= 2 ? q : '';
}

/**
 * Whether a row matches the search (§8.3) in the text of the shown columns;
 * a person also in their unions' cells (sub-rows included).
 */
export function rowMatches(model: TableModel, row: TableRow, columns: readonly ColumnDef[], q: string): boolean {
    for (const c of columns) {
        if (c.unionScoped && row.kind === 'person') {
            for (let i = 0; i < row.unions.length; i++) if (foldedCell(cellOf(model, row, c, i)).includes(q)) return true;
        } else if (foldedCell(cellOf(model, row, c)).includes(q)) return true;
    }
    return false;
}

/**
 * The rows that pass the filter and the search, in their given order. The
 * union columns' filters of the People table give the union predicate
 * (each union apart, §3.3); the others judge the row. Chips on the findings
 * pass everyone while the checks run.
 */
export function filterRows(
    model: TableModel, type: RowType, rows: readonly TableRow[], filter: TableFilter,
    search?: { query: string; columns: readonly ColumnDef[] },
): FilterResult {
    const chips = filter.items.filter(isChipItem).filter(i => chipAvailable(model, type, i.chip));
    const cols = columnItems(filter)
        .map(item => ({ item, col: columnById(type, item.col) }))
        .filter((x): x is { item: ColumnFilter; col: ColumnDef } => !!x.col && columnItemActive(x.item))
        .map(x => ({ ...x, kind: filterKindOf(x.col) }));
    const unionCols = type === 'persons' ? cols.filter(x => x.col.unionScoped) : [];
    const rowCols = type === 'persons' ? cols.filter(x => !x.col.unionScoped) : cols;
    const pass: UnionPredicate | null = unionCols.length
        ? (row, i) => unionCols.every(x => cellPasses(cellOf(model, row, x.col, i), x.item, x.kind))
        : null;
    const q = search?.query ?? '';
    if (!chips.length && !cols.length && !q) return { rows: [...rows], pass: null };
    const out = rows.filter(row => {
        if (row.kind === 'person') {
            for (const c of chips) if (!personPassesChip(model, row, c)) return false;
            if (!personPassesUnions(row, pass)) return false;
        } else if (row.kind === 'event') {
            for (const c of chips) if (!eventPassesChip(model, row, c)) return false;
        }
        for (const x of rowCols) if (!cellPasses(cellOf(model, row, x.col), x.item, x.kind)) return false;
        if (q && !rowMatches(model, row, search!.columns, q)) return false;
        return true;
    });
    return { rows: out, pass };
}

/** The number of active filters (§8.1: "Filters (n)" counts chips and column filters). */
export function activeFilterCount(model: TableModel, type: RowType, filter: TableFilter): number {
    return filter.items.filter(i => (isChipItem(i) ? chipAvailable(model, type, i.chip) : !!columnById(type, i.col) && columnItemActive(i))).length;
}

// ---------------------------------------------------------------------------
// Words for the filters (chips, "Applies: …", §8.1, §13c)

function num(n: number): string {
    return String(n);
}

/** A chip's label (§8.1): active Family line and Generation say their choice. */
export function chipLabel(model: TableModel | null, item: ChipFilter | null, chip: ChipId): string {
    const t = strings.table;
    if (chip === 'participant' && item?.role) {
        const p = item.personId && model ? model.ctx.person(item.personId as PersonId) : null;
        return t.chipParticipant[item.role]((p ? shownNameOrEmpty(p) : '') || item.name || '');
    }
    if (chip === 'rod' && item?.values?.length && model) {
        const labels = model.ctx.lineage().labels;
        const names = item.values.map(v => labels.get(v as RodId)).filter((x): x is string => !!x);
        if (names.length) return t.chipRod(names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]);
    }
    if (chip === 'gen' && item && (item.from !== undefined || item.to !== undefined)) {
        return t.chipGen(item.from === item.to ? num(item.from!) : `${item.from !== undefined ? num(item.from) : ''}–${item.to !== undefined ? num(item.to) : ''}`);
    }
    return t.chip[chip];
}

/** A column filter's words (§8.1: the chip "Age at marriage ≤ 15"). */
export function columnItemLabel(type: RowType, item: ColumnFilter): string {
    const c = columnById(type, item.col);
    const t = strings.table;
    const label = c ? columnLabel(c) : item.col;
    const kind = c ? filterKindOf(c) : 'text';
    const parts: string[] = [];
    if (kind === 'range' && (item.from !== undefined || item.to !== undefined)) {
        const f = item.from !== undefined ? num(item.from) : '';
        const to = item.to !== undefined ? num(item.to) : '';
        parts.push(f && to ? (f === to ? `= ${f}` : `${f}–${to}`) : f ? `≥ ${f}` : `≤ ${to}`);
    }
    if (kind === 'text' && item.text?.trim()) parts.push(item.match === 'starts' ? t.filterStarts(item.text.trim()) : t.filterContains(item.text.trim()));
    if (kind === 'values' && item.values?.length) parts.push(item.values.length > 2 ? `${item.values.length}×` : item.values.map(v => valueWord(c, v)).join(', '));
    if (item.empty) parts.push(t.filterEmpty);
    if (item.filled) parts.push(t.filterFilled);
    return `${label} ${parts.join(' · ')}`.trim();
}

/** A value of a values filter as words (a pill's step, a level). */
function valueWord(c: ColumnDef | undefined, v: string): string {
    if (c?.kind === 'pill') {
        const r = strings.reliability as unknown as Record<string, string>;
        return r[v] ?? v;
    }
    if (c?.id === 'topSev') return (strings.table.sev as Record<string, string>)[v] ?? v;
    return v;
}

/** "Applies: Deceased · Blood relatives · Age at marriage ≤ 15" (§13c) without the leading word. */
export function filterSummary(model: TableModel, type: RowType, filter: TableFilter, search = ''): string {
    const out: string[] = [];
    for (const i of filter.items) {
        if (isChipItem(i)) { if (chipAvailable(model, type, i.chip)) out.push(chipLabel(model, i, i.chip)); }
        else if (columnItemActive(i) && columnById(type, i.col)) out.push(columnItemLabel(type, i));
    }
    if (searchQuery(search)) out.push(`“${search.trim()}”`);
    return out.join(' · ');
}

// ---------------------------------------------------------------------------
// Search highlight (§8.3)

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A text as HTML with the search's matches in `<mark class="tv-hit">`
 * (folded query; diacritics and case ignored, the original letters kept).
 */
export function highlightHtml(text: string, q: string): string {
    if (!q || !text) return esc(text);
    // The folded text and where each of its characters comes from.
    let f = '';
    const from: number[] = [];
    let i = 0;
    for (const ch of text) {
        const part = foldText(ch);
        for (let k = 0; k < part.length; k++) from.push(i);
        f += part;
        i += ch.length;
    }
    from.push(text.length);
    let out = '';
    let last = 0;
    let at = f.indexOf(q);
    while (at >= 0) {
        const a = from[at];
        const endF = at + q.length;
        // The match ends after the original character holding its last folded one.
        let b = from[endF];
        if (b === undefined || b <= a) b = text.length;
        if (a >= last) {
            out += esc(text.slice(last, a)) + `<mark class="tv-hit">${esc(text.slice(a, b))}</mark>`;
            last = b;
        }
        at = f.indexOf(q, endF);
    }
    return out + esc(text.slice(last));
}

// ---------------------------------------------------------------------------
// Sorting (§8.4)

const collators = new Map<string, Intl.Collator>();

function collatorFor(lang?: string): Intl.Collator {
    const key = lang ?? '';
    let c = collators.get(key);
    if (!c) { c = new Intl.Collator(lang, { sensitivity: 'base', numeric: true }); collators.set(key, c); }
    return c;
}

let collator = collatorFor();

function compareKeys(a: number | string, b: number | string): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'number') return -1;
    if (typeof b === 'number') return 1;
    return collator.compare(a, b);
}

/**
 * The rows sorted by the specs (the first spec first); unknown columns are
 * skipped. A union column of the People table sorts each person by the union
 * `unionOf` gives (§3.3: the first passing one; default the first by date).
 */
export function sortRows(
    model: TableModel, type: RowType, rows: readonly TableRow[], specs: readonly SortSpec[],
    unionOf?: (row: TableRow) => number,
): TableRow[] {
    const cols = specs.map(s => ({ col: columnById(type, s.col), dir: s.dir === 'desc' ? -1 : 1 })).filter(x => !!x.col);
    if (!cols.length) return [...rows];
    collator = collatorFor(model.ctx.lang);
    const keyed = rows.map((row, i) => ({
        row, i,
        keys: cols.map(c => cellOf(model, row, c.col!, c.col!.unionScoped && unionOf ? unionOf(row) : undefined).sortKey),
    }));
    keyed.sort((x, y) => {
        for (let k = 0; k < cols.length; k++) {
            const a = x.keys[k], b = y.keys[k];
            if (a === null || a === '') { if (b === null || b === '') continue; return 1; }
            if (b === null || b === '') return -1;
            const c = compareKeys(a, b);
            if (c !== 0) return c * cols[k].dir;
        }
        return x.i - y.i;
    });
    return keyed.map(x => x.row);
}
