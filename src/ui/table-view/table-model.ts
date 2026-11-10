/**
 * Table view (spec 073): the row model.
 *
 * Built once per data revision: one row per real person (placeholders left
 * out) and one per union with a real partner. Cells are computed lazily the
 * first time a column is read and kept in the row's cache until the next
 * revision (a new model). Nothing here touches the DOM, so it is unit-tested
 * in node and measured with the perf budget.
 */

import type { Partnership, PartnershipId, Person, PersonId, StromData } from '../../types.js';
import { parseFlexDate } from '../../dates.js';
import { assignGenerations } from '../../generations.js';
import { inferBirthUpperBounds, isLivingPerson } from '../../privacy.js';
import { buildLineages, rodLabels, type LineageIndex, type RodId } from '../../lineage.js';
import type { ReliabilityOptions } from '../../reliability.js';
import type { Language } from '../../strings.js';
import type { CheckIndex } from './table-checks.js';

/** What the rows of a table are. P2 adds events and sources, P3 places. */
export type RowType = 'persons' | 'unions';
export const ROW_TYPES: readonly RowType[] = ['persons', 'unions'];

/** A cell's mark (§7.3): a finding's level, or `unusual` for one marked "Not an error". */
export type CellSeverity = 'error' | 'warning' | 'info' | 'unusual';

/** A finding shown in a cell (filled by the checks, §7). */
export interface CellIssue {
    severity: CellSeverity;
    /** The finding's text (the bubble's first line). */
    message: string;
    /** The validation issue's key, for "Not an error". */
    key?: string;
}

/** One cell's value: what is shown, what sorts and filters, and how it reads. */
export interface CellValue {
    /** The text shown (plain; the grid escapes it). */
    text: string;
    /** Sort key; null sorts last in both directions. */
    sortKey: number | string | null;
    /** Nothing recorded. */
    empty: boolean;
    /** The column does not apply to the row (a death date of the living, a union field without a union). */
    na: boolean;
    /** A substitute value (§5.2): the baptism for a birth, the burial for a death. */
    subst: 'bap' | 'bur' | null;
    /** Computed by the app (ages, counts…), not recorded. */
    computed: boolean;
    /** An estimate ("≈ 67"). */
    approx: boolean;
    /** A date with a qualifier or a range (§5.3; not a finding). */
    uncertain: boolean;
    /** A finding in the cell (§7). */
    issue?: CellIssue;
    /**
     * A mark shown with the value without the cell being a finding's (§7: the
     * Findings and Highest level columns show the level of the row's findings).
     */
    mark?: CellSeverity;
    /** A faint value: no findings ("0"), the checks still running ("…"). */
    ghost?: boolean;
    /** A reliability step for pill columns. */
    pill?: string;
    /** A percentage for completeness columns (0–100). */
    percent?: number;
    /** The cell's tooltip, when it says more than the text. */
    title?: string;
    /** A date's qualifier as a short word shown before the text ("abt.", §5.3). */
    prefix?: string;
    /**
     * A count shown where a value of one union would be (§3.1: "3 unions" in
     * the Partner cell of a person whose unions are sub-rows).
     */
    aggregate?: boolean;
}

export interface PersonRow {
    kind: 'person';
    id: PersonId;
    person: Person;
    /** The person's unions, by date (undated last, in data order). */
    unions: Partnership[];
    cache: Map<string, CellValue>;
}

export interface UnionRow {
    kind: 'union';
    id: PartnershipId;
    union: Partnership;
    /** Partner 1: the partner who is a blood relative of the home person, else the union's first. */
    p1: Person | null;
    p2: Person | null;
    cache: Map<string, CellValue>;
}

export type TableRow = PersonRow | UnionRow;

/** Everything the columns compute from; the heavy indexes are built on first use. */
export interface TableContext {
    readonly data: StromData;
    readonly lang: Language;
    readonly homeId: PersonId | null;
    readonly year: number;
    readonly reliability: ReliabilityOptions;
    generations(): Map<string, number>;
    lineage(): { index: LineageIndex; labels: Map<RodId, string> };
    birthBounds(): Map<string, number>;
    living(p: Person): boolean;
    /** Blood relatives of the home person (ancestors and all their descendants). */
    blood(): Set<string>;
    person(id: PersonId | null | undefined): Person | null;
    /**
     * The tree's findings mapped to rows and cells (§7, table-checks.ts); null
     * while the checks run. Set by the view; a change drops the cached cells
     * of the check columns (applyChecks).
     */
    checks: CheckIndex | null;
}

export interface TableModel {
    readonly data: StromData;
    readonly rev: number;
    readonly ctx: TableContext;
    readonly persons: PersonRow[];
    readonly unions: UnionRow[];
    readonly personRows: Map<PersonId, PersonRow>;
    readonly unionRows: Map<PartnershipId, UnionRow>;
}

export interface BuildOptions {
    rev: number;
    homeId: PersonId | null;
    lang: Language;
    reliability?: ReliabilityOptions;
    /** The current year (living people); defaults to now. */
    year?: number;
}

/** A flex date as a number for sorting (range: its start; qualifier ignored; null: no date). */
export function dateNumber(value?: string): number | null {
    const d = parseFlexDate(value);
    if (!d) return null;
    return d.year * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0);
}

function realPerson(data: StromData, id: PersonId | null | undefined): Person | null {
    if (!id) return null;
    const p = data.persons[id];
    return p && !p.isPlaceholder ? p : null;
}

function bloodOf(data: StromData, homeId: PersonId | null): Set<string> {
    const out = new Set<string>();
    if (!homeId || !data.persons[homeId]) return out;
    const ancestors: PersonId[] = [];
    const seenUp = new Set<string>([homeId]);
    const up: PersonId[] = [homeId];
    while (up.length) {
        const id = up.pop()!;
        ancestors.push(id);
        for (const pid of data.persons[id]?.parentIds ?? []) {
            if (!seenUp.has(pid) && data.persons[pid]) { seenUp.add(pid); up.push(pid); }
        }
    }
    const down: PersonId[] = [...ancestors];
    for (const id of ancestors) out.add(id);
    while (down.length) {
        const id = down.pop()!;
        for (const cid of data.persons[id]?.childIds ?? []) {
            if (!out.has(cid) && data.persons[cid]) { out.add(cid); down.push(cid); }
        }
    }
    return out;
}

function makeContext(data: StromData, opts: BuildOptions): TableContext {
    let gens: Map<string, number> | null = null;
    let lin: { index: LineageIndex; labels: Map<RodId, string> } | null = null;
    let bounds: Map<string, number> | null = null;
    let blood: Set<string> | null = null;
    const livingCache = new Map<string, boolean>();
    const year = opts.year ?? new Date().getFullYear();
    return {
        data, lang: opts.lang, homeId: opts.homeId, year,
        reliability: opts.reliability ?? { researchTree: false, originFeature: false },
        generations: () => gens ??= assignGenerations(data),
        lineage: () => {
            if (!lin) { const index = buildLineages(data); lin = { index, labels: rodLabels(index) }; }
            return lin;
        },
        birthBounds: () => bounds ??= inferBirthUpperBounds(data),
        living(p) {
            let v = livingCache.get(p.id);
            if (v === undefined) { v = isLivingPerson(p, year, this.birthBounds()); livingCache.set(p.id, v); }
            return v;
        },
        blood: () => blood ??= bloodOf(data, opts.homeId),
        person: id => realPerson(data, id),
        checks: null,
    };
}

/** The unions of a person by date; undated ones last, in data order. */
export function unionsByDate(unions: readonly Partnership[]): Partnership[] {
    return unions
        .map((u, i) => ({ u, i, k: dateNumber(u.startDate) }))
        .sort((a, b) => a.k === null ? (b.k === null ? a.i - b.i : 1) : b.k === null ? -1 : a.k - b.k || a.i - b.i)
        .map(x => x.u);
}

/** Build the rows of both row types for one data revision. */
export function buildTableModel(data: StromData, opts: BuildOptions): TableModel {
    const ctx = makeContext(data, opts);
    const unionsOf = new Map<string, Partnership[]>();
    const unions: UnionRow[] = [];
    const unionRows = new Map<PartnershipId, UnionRow>();
    for (const u of Object.values(data.partnerships ?? {})) {
        const a = realPerson(data, u.person1Id);
        const b = realPerson(data, u.person2Id);
        if (!a && !b) continue;
        for (const p of [a, b]) {
            if (!p) continue;
            const list = unionsOf.get(p.id);
            if (list) list.push(u); else unionsOf.set(p.id, [u]);
        }
        const row: UnionRow = { kind: 'union', id: u.id, union: u, p1: a ?? b, p2: a ? b : null, cache: new Map() };
        unions.push(row);
        unionRows.set(u.id, row);
    }
    const persons: PersonRow[] = [];
    const personRows = new Map<PersonId, PersonRow>();
    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        const own = unionsOf.get(p.id);
        const row: PersonRow = { kind: 'person', id: p.id, person: p, unions: own ? unionsByDate(own) : [], cache: new Map() };
        persons.push(row);
        personRows.set(p.id, row);
    }
    return { data, rev: opts.rev, ctx, persons, unions, personRows, unionRows };
}

/** Whether a model still matches the data (same object, same revision). */
export function modelIsCurrent(model: TableModel | null, data: StromData, rev: number, homeId: PersonId | null, lang: Language): model is TableModel {
    return !!model && model.data === data && model.rev === rev && model.ctx.homeId === homeId && model.ctx.lang === lang;
}

export function rowsOf(model: TableModel, type: RowType): TableRow[] {
    return type === 'persons' ? model.persons : model.unions;
}

/** A row's stable key (selection, DOM). */
export function rowKey(row: TableRow): string {
    return row.kind === 'person' ? `p:${row.id}` : `u:${row.id}`;
}
