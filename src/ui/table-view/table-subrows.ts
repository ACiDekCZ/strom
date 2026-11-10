/**
 * Table view (spec 073 §3): the union sub-rows of the People table.
 *
 * A person with one union shows it in the person's own row. A person with
 * two or more has a row with the person's data (the Partner cell says
 * "3 unions", the other union cells stay empty) and below it one sub-row per
 * union, by the wedding date (undated last). Collapsed, the person's row
 * shows the first union (the first that passes the filter) and a pill with
 * the count. The collapse state (all, with exceptions per person) belongs to
 * the view (§9: `unions: { collapsed, except }`).
 *
 * The filter of a union column is judged for each union apart (§3.3): a
 * person shows when at least one union passes; the unions that do not pass
 * are hidden under a quiet "n outside the filter · show" line, which shows
 * them dimmed until the filter changes. Sorting by a union column sorts the
 * people by their first passing union. Pure functions, no DOM.
 */

import { strings } from '../../strings.js';
import { cellOf, emptyCell, type ColumnDef } from './table-columns.js';
import { rowKey, type CellValue, type PersonRow, type TableModel, type TableRow } from './table-model.js';

/** The collapse state of the sub-rows (§3.2): all collapsed or not, and the people that are the other way. */
export interface UnionCollapse {
    collapsed: boolean;
    /** Person ids whose state is the opposite of `collapsed`. */
    except: string[];
}

export function defaultUnionCollapse(): UnionCollapse {
    return { collapsed: false, except: [] };
}

/** Whether a person's unions show as sub-rows. */
export function isExpanded(st: UnionCollapse, personId: string): boolean {
    return st.except.includes(personId) ? st.collapsed : !st.collapsed;
}

/** Expand or collapse one person (an exception to the overall state, or none when it matches it). */
export function setExpanded(st: UnionCollapse, personId: string, expanded: boolean): boolean {
    if (isExpanded(st, personId) === expanded) return false;
    const exception = expanded === st.collapsed;
    st.except = exception ? [...st.except, personId] : st.except.filter(id => id !== personId);
    return true;
}

export function toggleExpanded(st: UnionCollapse, personId: string): boolean {
    return setExpanded(st, personId, !isExpanded(st, personId));
}

/** "Expand unions" / "Collapse unions" (§3.2) and `*` / Shift+`*` (§3.4): everyone, no exceptions. */
export function setAllExpanded(st: UnionCollapse, expanded: boolean): boolean {
    if (st.collapsed === !expanded && !st.except.length) return false;
    st.collapsed = !expanded;
    st.except = [];
    return true;
}

/** Whether any of the rows' people with several unions is expanded (the head's button says Collapse then). */
export function anyExpanded(st: UnionCollapse, rows: readonly TableRow[]): boolean {
    return rows.some(r => r.kind === 'person' && r.unions.length > 1 && isExpanded(st, r.id));
}

/** Whether any of the rows' people has several unions (the head's button shows only then). */
export function hasMultiUnions(rows: readonly TableRow[]): boolean {
    return rows.some(r => r.kind === 'person' && r.unions.length > 1);
}

// ---------------------------------------------------------------------------
// Filter and sort by union (§3.3). Part C2 builds the predicate from the
// filters of the union columns and passes it here.

/** Whether one union of a person (its index in `row.unions`) passes the union filters. */
export type UnionPredicate = (row: PersonRow, unionIndex: number) => boolean;

/** The indexes of a person's unions that pass (all of them without a predicate), in date order. */
export function passingUnions(row: PersonRow, pass?: UnionPredicate | null): number[] {
    const all = row.unions.map((_u, i) => i);
    return pass ? all.filter(i => pass(row, i)) : all;
}

/**
 * Whether a person passes the union filters (§3.3): at least one union
 * passes. With no union filter, everyone passes; with one, a person without
 * a union does not (the union columns do not apply to the person).
 */
export function personPassesUnions(row: PersonRow, pass?: UnionPredicate | null): boolean {
    if (!pass) return true;
    return passingUnions(row, pass).length > 0;
}

/**
 * The union a person's union columns sort by (§3.3): the first passing one
 * (the first by date without a filter). For `sortRows`' `unionOf`.
 */
export function sortUnionOf(pass?: UnionPredicate | null): (row: TableRow) => number {
    return (row) => {
        if (row.kind !== 'person' || !pass) return 0;
        return passingUnions(row, pass)[0] ?? 0;
    };
}

/**
 * The union rows a column's coverage counts (§3.3, §6.1): the passing unions
 * of each person (all without a filter).
 */
export function coverageUnionsOf(pass?: UnionPredicate | null): (row: PersonRow) => readonly number[] {
    return (row) => passingUnions(row, pass);
}

// ---------------------------------------------------------------------------
// The lines the grid draws

/** A person's (or a union's) own row. */
export interface MainLine {
    kind: 'row';
    row: TableRow;
    /** The union the union columns read; null: the unions are sub-rows (the Partner cell gives their count). */
    union: number | null;
    /** The person's number of unions (0 for a union row). */
    n: number;
    /** Expanded (true) or collapsed (false) for a person with 2+ unions; null otherwise. */
    expanded: boolean | null;
}

/** One union of a person with 2+ unions (§3.1). */
export interface SubLine {
    kind: 'sub';
    row: PersonRow;
    union: number;
    /** 1-based position of the union among the person's (by date) and their number. */
    k: number;
    n: number;
    /** A union outside the filter, shown on request (§3.3). */
    dimmed: boolean;
}

/** "n outside the filter · show" under a person's last shown sub-row (§3.3). */
export interface MoreLine {
    kind: 'more';
    row: PersonRow;
    hidden: number;
}

export type GridLine = MainLine | SubLine | MoreLine;

export interface LineOptions {
    collapse: UnionCollapse;
    /** The union filters (§3.3); none: every union passes. */
    pass?: UnionPredicate | null;
    /** People whose hidden unions were asked for ("show"), until the filter changes. */
    revealed?: ReadonlySet<string>;
}

/** A row's lines without sub-rows (the Unions table, or the People table before part B's options). */
export function plainLines(rows: readonly TableRow[]): GridLine[] {
    return rows.map(row => ({ kind: 'row', row, union: row.kind === 'person' ? 0 : null, n: row.kind === 'person' ? row.unions.length : 0, expanded: null }));
}

/** The lines of the shown rows (§3.1–§3.3), in the rows' order. */
export function buildLines(rows: readonly TableRow[], opts: LineOptions): GridLine[] {
    const out: GridLine[] = [];
    for (const row of rows) {
        if (row.kind !== 'person') { out.push({ kind: 'row', row, union: null, n: 0, expanded: null }); continue; }
        const n = row.unions.length;
        if (n < 2) { out.push({ kind: 'row', row, union: 0, n, expanded: null }); continue; }
        const passing = passingUnions(row, opts.pass);
        if (!isExpanded(opts.collapse, row.id)) {
            out.push({ kind: 'row', row, union: passing[0] ?? 0, n, expanded: false });
            continue;
        }
        out.push({ kind: 'row', row, union: null, n, expanded: true });
        const hidden = n - passing.length;
        const reveal = hidden > 0 && !!opts.revealed?.has(row.id);
        const shown = reveal ? row.unions.map((_u, i) => i) : passing;
        const ok = new Set(passing);
        for (const i of shown) out.push({ kind: 'sub', row, union: i, k: i + 1, n, dimmed: !ok.has(i) });
        if (hidden > 0 && !reveal) out.push({ kind: 'more', row, hidden });
    }
    return out;
}

/** A line's key (DOM, focus): the row's key, a sub-row's union and the "more" line apart. */
export function lineKey(line: GridLine): string {
    const key = rowKey(line.row);
    if (line.kind === 'sub') return `${key}#u${line.k}`;
    if (line.kind === 'more') return `${key}#more`;
    return key;
}

/** A line's level in the treegrid (§3.4): 1 for a row, 2 under a person. */
export function lineLevel(line: GridLine): 1 | 2 {
    return line.kind === 'row' ? 1 : 2;
}

/**
 * One cell of a line (§3.1): a person's row reads the person's columns and,
 * collapsed or with one union, the union columns of that union; expanded, the
 * Partner cell gives the number of unions and the other union cells stay
 * empty. A sub-row reads only its union; the person's cells stay empty.
 */
export function lineCell(model: TableModel, line: GridLine, col: ColumnDef): CellValue {
    if (line.kind === 'more') return emptyCell();
    if (line.kind === 'sub') return col.unionScoped ? cellOf(model, line.row, col, line.union) : emptyCell();
    if (line.union === null && line.row.kind === 'person' && col.unionScoped) {
        if (col.id !== 'partner') return emptyCell(col.computed);
        return { ...emptyCell(), text: strings.table.unionsN(line.n), empty: false, aggregate: true };
    }
    return cellOf(model, line.row, col, line.union ?? 0);
}
