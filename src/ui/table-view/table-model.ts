/**
 * Table view (spec 073): the row model.
 *
 * Built once per data revision: one row per real person (placeholders left
 * out) and one per union with a real partner. Cells are computed lazily the
 * first time a column is read and kept in the row's cache until the next
 * revision (a new model). Nothing here touches the DOM, so it is unit-tested
 * in node and measured with the perf budget.
 */

import type { CoupleEvent, EventParticipant, LifeEvent, ParticipantRole, Partnership, PartnershipId, Person, PersonId, Source, StromData } from '../../types.js';
import { parseFlexDate } from '../../dates.js';
import { marriagesInOrder } from '../../marriage-order.js';
import { assignGenerations } from '../../generations.js';
import { inferBirthUpperBounds, isLivingPerson } from '../../privacy.js';
import { buildLineages, rodLabels, type LineageIndex, type RodId } from '../../lineage.js';
import type { ReliabilityOptions } from '../../reliability.js';
import type { Language } from '../../strings.js';
import type { CheckIndex } from './table-checks.js';
import type { ResearchTableEnv } from './table-research.js';
import type { CrossTreeMatch } from '../../cross-tree.js';
import { treeHasAnySource, unionsByPerson } from '../../evidence-level.js';
import { buildEventRows } from './table-events.js';
import { buildSourceRows } from './table-sources.js';

/** What the rows of a table are. P2 adds events and sources, P3 places. */
export type RowType = 'persons' | 'unions' | 'events' | 'sources';
export const ROW_TYPES: readonly RowType[] = ['persons', 'unions', 'events', 'sources'];

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
    /**
     * A web address the cell links to (§14.2 Online: a new window, only
     * http and https); `label` is what the link shows.
     */
    link?: { href: string; label: string };
    /**
     * A pill of dots before the text (§14.2 Read by the research: one dot per
     * reader, filled when read, as the reliability pill of spec 066).
     */
    dots?: boolean[];
    /**
     * The names the text lists (§14.1: the person or couple of an event, its
     * participants): each with the tree's person it is, when it is one (a
     * link), and the participant's role. The text is these names joined by
     * ", ".
     */
    names?: CellName[];
    /**
     * The further citations of a fact (§14.3): the cell shows the first
     * source's value and a pill "+N" whose bubble lists these (the cited ids).
     */
    moreSources?: string[];
    /** The research's cell (spec 073 §16, table-research.ts): its mark, count, parts and exported text. */
    research?: ResearchCellDetail;
}

/** The research signal a cell starts with, drawn as its mark (§16.3). */
export type ResearchSignal = 'wait' | 'ext' | 'conf' | 'q' | 'agent' | 'done' | 'queue' | 'new';

/** One piece of a research cell's text, with its look (§16.2, §16.9, §16.10). */
export interface ResearchCellPart {
    text: string;
    tone?: 'faint' | 'light' | 'primary' | 'accent' | 'ghost';
    weight?: 500 | 600;
    italic?: boolean;
}

/** What a research cell shows beyond its plain text (§16). */
export interface ResearchCellDetail {
    signal?: ResearchSignal;
    /** The count shown after the signal's mark (600). */
    count?: number;
    /** "+n": further kinds of signal (the Research column). */
    more?: number;
    /** The text after the mark and count, in pieces; joined they are the cell's text. */
    parts: ResearchCellPart[];
    /** The line the cell names (G…). */
    lineId?: string;
    /** A live-only column while the research is not followed: "–" faint, exported empty. */
    liveOff?: boolean;
    /** The text a CSV export writes (§16.7). */
    export: string;
}

/** One name of a cell that lists people (§14.1). */
export interface CellName {
    text: string;
    /** The tree's person (not a placeholder) the name is; none: only a name as written. */
    personId?: PersonId;
    /** A participant's role (the participants' columns). */
    role?: ParticipantRole;
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

/** Where an event row comes from (§14.1): a person's own field, a person's event, a union's field or event. */
export type EventSource = 'birth' | 'death' | 'life' | 'marriage' | 'divorce' | 'couple';

/** The quick chips' families of events (§14.1: births and baptisms, marriages, deaths and burials, other). */
export type EventCategory = 'birth' | 'marriage' | 'death' | 'other';

/** One copy of a person's event that an event row stands for (§14.1: one event of several people). */
export interface EventRef {
    personId: PersonId;
    eventId: string;
}

/**
 * One event (§14.1): a person's event of any type, the birth and the death,
 * a union's wedding and divorce (both partners) and a couple's events. The
 * same event recorded at several people (spec 053: a census of a household)
 * is one row, its people in `persons`.
 */
export interface EventRow {
    kind: 'event';
    /** Stable key: `b:` / `d:` + person, `l:` + person + `:` + event, `w:` / `v:` + union, `c:` + union + `:` + event. */
    id: string;
    source: EventSource;
    /** The event's type: a LifeEventType, a CoupleEventType, or `marriage` / `divorce`. */
    type: string;
    category: EventCategory;
    /** Whose event it is (real people only), in data order; a union's: its partners. */
    persons: Person[];
    /** The union of a wedding, a divorce or a couple's event. */
    union: Partnership | null;
    /** The event itself (a person's or a couple's); for several people the first copy. */
    event: LifeEvent | CoupleEvent | null;
    /** Each person's copy of a person's event (one for one person). */
    refs: EventRef[];
    date?: string;
    place?: string;
    /** The sources cited on the event. */
    sourceIds: string[];
    /** Godparents, witnesses, the officiant and others (of all copies, each once). */
    participants: EventParticipant[];
    cache: Map<string, CellValue>;
}

/**
 * One source of the tree's catalog (§14.2) with how much of the tree it
 * documents: the people whose facts cite it and the facts that do.
 */
export interface SourceRow {
    kind: 'source';
    id: string;
    source: Source;
    /** The real people (no placeholders) a cited fact belongs to; a union's fact: both partners. */
    persons: number;
    /** The facts that cite it: a person's citations, the birth, the death, each event, a wedding, a divorce, a couple's event. */
    facts: number;
    cache: Map<string, CellValue>;
}

export type TableRow = PersonRow | UnionRow | EventRow | SourceRow;

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
    /**
     * The research's cells read this (§16, table-research.ts); null: a tree
     * without research. Set by the view; a change drops the cached research
     * cells (applyResearch).
     */
    research: ResearchTableEnv | null;
    /** The other trees a person is in (§16 crossTree); null: not read. Set by the view, like `research`. */
    crossTree: ((p: Person) => readonly CrossTreeMatch[]) | null;
    /** Whether the tree has any source (the person's status mark, §16 personStatus). */
    hasSources(): boolean;
    /** Each person's unions (the person's status mark). */
    unionsOf(): Map<string, Partnership[]>;
}

export interface TableModel {
    readonly data: StromData;
    readonly rev: number;
    readonly ctx: TableContext;
    readonly persons: PersonRow[];
    readonly unions: UnionRow[];
    readonly personRows: Map<PersonId, PersonRow>;
    readonly unionRows: Map<PartnershipId, UnionRow>;
    /** The event rows (§14.1), built on first use. */
    readonly events: EventRow[];
    readonly eventRows: Map<string, EventRow>;
    /** The source rows (§14.2), built on first use with the counts of their use. */
    readonly sources: SourceRow[];
    readonly sourceRows: Map<string, SourceRow>;
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
    let hasSources: boolean | undefined;
    let unions: Map<string, Partnership[]> | null = null;
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
        research: null,
        crossTree: null,
        hasSources: () => hasSources ??= treeHasAnySource(data),
        unionsOf: () => unions ??= unionsByPerson(data),
    };
}

/**
 * The unions of a person in the marriage order the diagram counts
 * (marriagesInOrder: union 1 is the "1. ∞" of the badge and the hover
 * card); "?" stand-in families and unions missing from the person's list
 * after them, in data order.
 */
export function unionsInMarriageOrder(data: StromData, personId: PersonId, unions: readonly Partnership[]): Partnership[] {
    const rank = new Map<PartnershipId, number>(marriagesInOrder(data, personId).map((id, i) => [id, i]));
    const listed = data.persons[personId]?.partnerships ?? [];
    const late = (id: PartnershipId): number => {
        const i = listed.indexOf(id);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return unions
        .map((u, i) => ({ u, i, r: rank.get(u.id), d: late(u.id) }))
        .sort((a, b) => {
            if (a.r !== undefined && b.r !== undefined) return a.r - b.r;
            if (a.r !== undefined) return -1;
            if (b.r !== undefined) return 1;
            return a.d - b.d || a.i - b.i;
        })
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
        const row: PersonRow = { kind: 'person', id: p.id, person: p, unions: own ? unionsInMarriageOrder(data, p.id, own) : [], cache: new Map() };
        persons.push(row);
        personRows.set(p.id, row);
    }
    let events: { rows: EventRow[]; byId: Map<string, EventRow> } | null = null;
    const ev = () => events ??= buildEventRows(data);
    let sources: { rows: SourceRow[]; byId: Map<string, SourceRow> } | null = null;
    const src = () => sources ??= buildSourceRows(data);
    return {
        data, rev: opts.rev, ctx, persons, unions, personRows, unionRows,
        get events() { return ev().rows; },
        get eventRows() { return ev().byId; },
        get sources() { return src().rows; },
        get sourceRows() { return src().byId; },
    };
}

/** Whether a model still matches the data (same object, same revision). */
export function modelIsCurrent(model: TableModel | null, data: StromData, rev: number, homeId: PersonId | null, lang: Language): model is TableModel {
    return !!model && model.data === data && model.rev === rev && model.ctx.homeId === homeId && model.ctx.lang === lang;
}

export function rowsOf(model: TableModel, type: RowType): TableRow[] {
    return type === 'persons' ? model.persons : type === 'unions' ? model.unions : type === 'events' ? model.events : model.sources;
}

/** A row type's key of the count texts (`strings.table.countOf.p|u|e|s`, `showN`, the export's). */
export const ROW_KEY: Readonly<Record<RowType, 'p' | 'u' | 'e' | 's'>> = { persons: 'p', unions: 'u', events: 'e', sources: 's' };

/** The number of rows of each type (§2: the Rows switch). */
export function rowCounts(model: TableModel | null): Record<RowType, number> {
    return {
        persons: model?.persons.length ?? 0, unions: model?.unions.length ?? 0,
        events: model?.events.length ?? 0, sources: model?.sources.length ?? 0,
    };
}

/** A row's stable key (selection, DOM). */
export function rowKey(row: TableRow): string {
    return row.kind === 'person' ? `p:${row.id}` : row.kind === 'union' ? `u:${row.id}` : row.kind === 'event' ? `e:${row.id}` : `s:${row.id}`;
}

/** The same row in another model (by its kind and id); null when it is gone. */
export function sameRow(model: TableModel, row: TableRow): TableRow | null {
    if (row.kind === 'person') return model.personRows.get(row.id) ?? null;
    if (row.kind === 'union') return model.unionRows.get(row.id) ?? null;
    if (row.kind === 'source') return model.sourceRows.get(row.id) ?? null;
    return model.eventRows.get(row.id) ?? null;
}

/** The person a row is about: the person; a union's first partner; an event's first person; a source none. */
export function rowPersonId(row: TableRow): PersonId | null {
    if (row.kind === 'person') return row.id;
    if (row.kind === 'union') return row.p1?.id ?? row.p2?.id ?? null;
    if (row.kind === 'source') return null;
    return row.persons[0]?.id ?? null;
}
