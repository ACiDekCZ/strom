/**
 * The Table's rows grouped by one value (spec 084 §10, §11): the values a
 * row type can be grouped by, each row's group(s) and the groups in their
 * order. A row with several values (research lines, occupations, a union in
 * both partners' family lines) is in each of its groups (10c). Worked out in
 * one pass over the shown rows; nothing here touches the DOM.
 */

import type { Person, PersonId, TableGroupKey } from '../../types.js';
import { rodOf } from '../../lineage.js';
import { eventValueIsOnTag } from '../../events.js';
import { addedTime } from '../../person-lists-data.js';
import { strings } from '../../strings.js';
import { cellOf, columnById } from './table-columns.js';
import { lineOffered, offeredLines, researchLinesOf, type ResearchLinesModel } from './table-research.js';
import { rowKey, type RowType, type TableModel, type TableRow } from './table-model.js';
import type { DrawLine, GridLine } from './table-subrows.js';

/** The grouping of a row type (`TableView.group`): its value and the closed groups' keys. */
export interface TableGrouping {
    by: TableGroupKey;
    collapsed: string[];
}

/** The key of the group of rows without the value ("no value", "earlier"); always last. */
export const NO_VALUE_KEY = '∅';

const PERSON_KEYS: readonly TableGroupKey[] = [
    'lines', 'rod', 'surname', 'bPlace', 'bCentury', 'bDecade', 'gen', 'sex', 'occ', 'addedDay', 'addedMonth', 'addedYear', 'done',
];
const UNION_KEYS: readonly TableGroupKey[] = ['wDecade', 'wPlace', 'uRods', 'kids'];
const EVENT_KEYS: readonly TableGroupKey[] = ['evType', 'evDecade', 'evPlace'];

/** The values a row type can be grouped by (none for sources). */
export function groupKeysOf(type: RowType): readonly TableGroupKey[] {
    return type === 'persons' ? PERSON_KEYS : type === 'unions' ? UNION_KEYS : type === 'events' ? EVENT_KEYS : [];
}

/** What the tree offers now: research lines only with lines, Done / left only in a work list's scope. */
export interface GroupOffer {
    lines: boolean;
    work: boolean;
}

/** The values the Group by menu offers for a row type. */
export function offeredGroupKeys(type: RowType, offer: GroupOffer): TableGroupKey[] {
    return groupKeysOf(type).filter(k => (k !== 'lines' || offer.lines) && (k !== 'done' || offer.work));
}

/** Whether a stored grouping applies to a row type now. */
export function groupingFits(type: RowType, g: TableGrouping | null | undefined, offer: GroupOffer): g is TableGrouping {
    return !!g && offeredGroupKeys(type, offer).includes(g.by);
}

/** Whether a row can be in several groups of this value (the status line then counts different people). */
export function multiValued(by: TableGroupKey): boolean {
    return by === 'lines' || by === 'occ' || by === 'uRods';
}

/** One group of rows. */
export interface RowGroup {
    /** Stored in `collapsed`; NO_VALUE_KEY for the rows without the value. */
    key: string;
    label: string;
    /** "no value" / "earlier": shown in italics, last. */
    special: boolean;
    rows: TableRow[];
}

interface GroupValue {
    key: string;
    label: string;
    sort: number | string;
}

/** What one grouping pass needs beyond the model. */
interface GroupEnv {
    model: TableModel;
    lines: ResearchLinesModel | null;
    done: ReadonlySet<string> | null;
    lang: string;
    fmt: Map<string, string>;
}

const linesMemo = new WeakMap<object, ResearchLinesModel>();

function linesOf(model: TableModel): ResearchLinesModel {
    const live = model.ctx.research?.lines;
    if (live) return live;
    let m = linesMemo.get(model.data);
    if (!m) { m = researchLinesOf(model.data); linesMemo.set(model.data, m); }
    return m;
}

/** Whether the tree has research lines to group by. */
export function treeHasLines(model: TableModel): boolean {
    const m = linesOf(model);
    return m.source !== 'none' && offeredLines(m).length > 0;
}

function yearOf(sortKey: number | string | null): number | null {
    return typeof sortKey === 'number' && Number.isFinite(sortKey) ? Math.floor(sortKey / 10000) : null;
}

function span(year: number | null, size: 10 | 100): GroupValue[] {
    if (year === null) return [];
    const from = Math.floor(year / size) * size;
    return [{ key: String(from), label: `${from}–${from + size - 1}`, sort: from }];
}

function textValue(text: string): GroupValue[] {
    const t = text.trim();
    return t ? [{ key: t, label: t, sort: t }] : [];
}

function columnText(env: GroupEnv, type: RowType, row: TableRow, col: string): string {
    const c = columnById(type, col);
    return c ? cellOf(env.model, row, c).text : '';
}

function columnSortKey(env: GroupEnv, type: RowType, row: TableRow, col: string): number | string | null {
    const c = columnById(type, col);
    return c ? cellOf(env.model, row, c).sortKey : null;
}

function rodValue(env: GroupEnv, id: PersonId): GroupValue | null {
    const { index, labels } = env.model.ctx.lineage();
    const rod = rodOf(index, id);
    const label = rod ? labels.get(rod) : undefined;
    return rod && label ? { key: rod, label, sort: label } : null;
}

function occupations(p: Person): string[] {
    const out = new Set<string>();
    for (const e of p.events ?? []) {
        if (e.type !== 'occupation') continue;
        const v = (eventValueIsOnTag(e.type) ? e.note : e.place || e.note || e.address)?.trim();
        if (v) out.add(v);
    }
    return [...out];
}

/** The added date's group (day, month or year); none before the date was recorded ("earlier"). */
function addedValue(env: GroupEnv, p: Person, by: 'addedDay' | 'addedMonth' | 'addedYear'): GroupValue[] {
    const t = addedTime(p.addedAt);
    if (!Number.isFinite(t)) return [];
    const d = new Date(t);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = by === 'addedYear' ? String(y) : by === 'addedMonth' ? `${y}-${String(m).padStart(2, '0')}` : `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let label = env.fmt.get(key);
    if (label === undefined) {
        label = by === 'addedYear' ? String(y)
            : d.toLocaleDateString(env.lang, by === 'addedMonth' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' });
        env.fmt.set(key, label);
    }
    return [{ key, label, sort: key }];
}

/** A row's groups for one value (none: the "no value" group). */
function valuesOf(env: GroupEnv, type: RowType, by: TableGroupKey, row: TableRow): GroupValue[] {
    const t = strings.table;
    if (row.kind === 'person') {
        const p = row.person;
        switch (by) {
            case 'lines': {
                const m = env.lines;
                if (!m || m.source === 'none') return [];
                const seen = new Set<string>();
                const out: GroupValue[] = [];
                for (const place of m.placesOf(p.refn)) {
                    let id = place.role === 'line' || place.role === 'partner' ? place.line : undefined;
                    if (place.role === 'branch') id = m.branches.find(b => b.id === place.branch)?.line ?? place.line;
                    // An ended line has no group (as no chip or view).
                    const i = id ? m.lines.findIndex(l => l.id === id && lineOffered(l)) : -1;
                    if (i < 0 || seen.has(id!)) continue;
                    seen.add(id!);
                    const line = m.lines[i];
                    out.push({ key: line.id, label: `${line.id} ${line.name}`, sort: i });
                }
                return out;
            }
            case 'rod': { const v = rodValue(env, row.id); return v ? [v] : []; }
            case 'surname': return textValue(columnText(env, type, row, 'surname'));
            case 'bPlace': return textValue(columnText(env, type, row, 'bPlace'));
            case 'bCentury': return span(yearOf(columnSortKey(env, type, row, 'bDate')), 100);
            case 'bDecade': return span(yearOf(columnSortKey(env, type, row, 'bDate')), 10);
            case 'gen': {
                const g = env.model.ctx.generations().get(row.id);
                return g === undefined ? [] : [{ key: String(g + 1), label: t.chipGen(String(g + 1)), sort: g + 1 }];
            }
            case 'sex':
                return p.gender === 'male' || p.gender === 'female'
                    ? [{ key: p.gender, label: strings.gender[p.gender], sort: p.gender === 'male' ? 0 : 1 }] : [];
            case 'occ': return occupations(p).map(v => ({ key: v, label: v, sort: v }));
            case 'addedDay': case 'addedMonth': case 'addedYear': return addedValue(env, p, by);
            case 'done': {
                if (!env.done) return [];
                return env.done.has(row.id) ? [{ key: 'done', label: t.chip.done, sort: 1 }] : [{ key: 'left', label: t.chip.left, sort: 0 }];
            }
            default: return [];
        }
    }
    if (row.kind === 'union') {
        switch (by) {
            case 'wDecade': return span(yearOf(columnSortKey(env, type, row, 'wDate')), 10);
            case 'wPlace': return textValue(columnText(env, type, row, 'wPlace'));
            case 'uRods': {
                const out: GroupValue[] = [];
                for (const p of [row.p1, row.p2]) {
                    const v = p ? rodValue(env, p.id) : null;
                    if (v && !out.some(o => o.key === v.key)) out.push(v);
                }
                return out;
            }
            case 'kids': {
                const n = row.union.childIds.length;
                return [{ key: String(n), label: t.groupKids(n), sort: n }];
            }
            default: return [];
        }
    }
    if (row.kind === 'event') {
        switch (by) {
            case 'evType': {
                const label = columnText(env, type, row, 'evType');
                return label ? [{ key: row.type, label, sort: label }] : [];
            }
            case 'evDecade': return span(yearOf(columnSortKey(env, type, row, 'evDate')), 10);
            case 'evPlace': return textValue(row.place ?? '');
            default: return [];
        }
    }
    return [];
}

/** The label of the group of rows without the value. */
function noValueLabel(by: TableGroupKey): string {
    return by === 'addedDay' || by === 'addedMonth' || by === 'addedYear' ? strings.table.earlier : strings.table.groupNoValue;
}

/**
 * The shown rows in their groups (one pass): ascending by the value (time,
 * number, alphabet), "no value" / "earlier" last; the rows keep their
 * order (the table's sort) inside each group. Empty groups never show.
 */
export function groupRows(model: TableModel, type: RowType, by: TableGroupKey, rows: readonly TableRow[], done: ReadonlySet<string> | null = null): RowGroup[] {
    const env: GroupEnv = {
        model, lines: by === 'lines' ? linesOf(model) : null, done, lang: model.ctx.lang, fmt: new Map(),
    };
    const groups = new Map<string, RowGroup & { sort: number | string }>();
    let none: RowGroup | null = null;
    for (const row of rows) {
        const values = valuesOf(env, type, by, row);
        if (!values.length) {
            none ??= { key: NO_VALUE_KEY, label: noValueLabel(by), special: true, rows: [] };
            none.rows.push(row);
            continue;
        }
        for (const v of values) {
            let g = groups.get(v.key);
            if (!g) { g = { key: v.key, label: v.label, special: false, rows: [], sort: v.sort }; groups.set(v.key, g); }
            g.rows.push(row);
        }
    }
    const collator = new Intl.Collator(model.ctx.lang, { sensitivity: 'base', numeric: true });
    const out = [...groups.values()].sort((a, b) => {
        if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
        return collator.compare(String(a.sort), String(b.sort)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    }).map(({ sort: _s, ...g }) => g as RowGroup);
    if (none) out.push(none);
    return out;
}

/** The groups a row is in (a jump into a closed group opens it, §10). */
export function groupKeysOfRow(model: TableModel, type: RowType, by: TableGroupKey, row: TableRow, done: ReadonlySet<string> | null = null): string[] {
    const env: GroupEnv = { model, lines: by === 'lines' ? linesOf(model) : null, done, lang: model.ctx.lang, fmt: new Map() };
    const values = valuesOf(env, type, by, row);
    return values.length ? values.map(v => v.key) : [NO_VALUE_KEY];
}

/** Whether any row is in more than one group (the status line counts different rows then, 10c). */
export function hasRepeats(groups: readonly RowGroup[], shown: number): boolean {
    let n = 0;
    for (const g of groups) n += g.rows.length;
    return n > shown;
}

/**
 * The flat CSV of a grouped table (§10): each row of each group in the
 * group's order, the group's value first; a row in several groups is
 * written once per group.
 */
export function groupedExportRows(groups: readonly RowGroup[]): { group: string; row: TableRow }[] {
    const out: { group: string; row: TableRow }[] = [];
    for (const g of groups) for (const row of g.rows) out.push({ group: g.label, row });
    return out;
}

/** The keys of the rows in collapsed groups that are in no open group (a jump to one opens its group). */
export function hiddenByGroups(groups: readonly RowGroup[], collapsed: ReadonlySet<string>): Set<string> {
    const open = new Set<string>();
    const closed = new Set<string>();
    for (const g of groups) for (const r of g.rows) (collapsed.has(g.key) ? closed : open).add(rowKey(r));
    for (const k of open) closed.delete(k);
    return closed;
}

/**
 * The lines drawn for groups (spec 084 §10): each group's header, then its
 * rows' lines unless it is closed. A row in several groups keeps its own key
 * at its first drawn place; its later places are marked with the group's key
 * (`dup`), so a jump and the selection find the first one.
 */
export function groupedLines(
    groups: readonly RowGroup[],
    collapsed: ReadonlySet<string>,
    linesOf: (rows: readonly TableRow[]) => readonly GridLine[],
): DrawLine[] {
    const out: DrawLine[] = [];
    const seen = new Set<string>();
    for (const g of groups) {
        const shut = collapsed.has(g.key);
        out.push({ kind: 'group', key: g.key, label: g.label, special: g.special, count: g.rows.length, collapsed: shut });
        if (shut) continue;
        for (const l of linesOf(g.rows)) out.push(seen.has(rowKey(l.row)) ? { ...l, dup: g.key } : l);
        for (const r of g.rows) seen.add(rowKey(r));
    }
    return out;
}
