/**
 * Table view (spec 073 §4.1): the column catalog.
 *
 * Every column of both row types with its group, label key, kind, width and
 * the function that computes its cell. A computed column (ages, counts,
 * completeness) is marked `computed`; a column of the Unions and Divorce
 * groups is `unionScoped` (in the People table it reads one union of the row:
 * the main row reads the first, the union sub-rows each their own — §3).
 */

import type { EventParticipant, LifeEvent, LifeEventType, ParticipantRole, Partnership, Person, PersonId } from '../../types.js';
import { parentSlots, partnershipSourceIds, personSourceIds } from '../../types.js';
import { ageRangeBetween, approxAgeBetween, flexDateParts, parseFlexDate, type DateQualifier } from '../../dates.js';
import { recordedAgeGap } from '../../recorded-age.js';
import { shownNameOrEmpty } from '../../person-name.js';
import { findRelationship } from '../../kinship.js';
import { rodOf, siblingsOf, sortByBirth } from '../../lineage.js';
import { sortLifeEvents, eventValueIsOnTag, coupleEventLabel } from '../../events.js';
import { lifeEventLabel } from '../../person-sources.js';
import { CARD_STATUS_CLASSES, cardStatus, factReliability, type ReliabilityStepName } from '../../reliability.js';
import { cardStatusLabel } from '../fact-status.js';
import { strings, type StringsType } from '../../strings.js';
import { safeWebUrl } from '../../validation.js';
import { sourceEntryText } from '../../source-location.js';
import { factCitations, sourceOnline, sourceReaders, type CitedSource } from './table-sources.js';
import { personGodparents } from './table-events.js';
import { givenNameOf } from '../../shared-with-line.js';
import {
    researchCell, sourceImageCell, sourceResearchIdCell, unionResearchCell, unionResearchIdCell, type ResearchColumnId, type UnionResearchColumnId,
} from './table-research.js';
import { dateNumber, type CellName, type CellValue, type EventRow, type PersonRow, type RowType, type SourceRow, type TableContext, type TableModel, type TableRow, type UnionRow } from './table-model.js';

export type ColumnKind = 'text' | 'date' | 'age' | 'number' | 'percent' | 'pill' | 'link';

/** Column groups in their order (People first, then the Unions table's own). */
export const PERSON_GROUPS = ['person', 'birth', 'parents', 'union', 'divorce', 'death', 'events', 'sources', 'rel', 'research', 'checks'] as const;
export const UNION_GROUPS = ['pair', 'wed', 'divorce', 'uextra', 'research'] as const;
export const EVENT_GROUPS = ['event', 'participants', 'source'] as const;
export const SOURCE_GROUPS = ['source', 'use', 'research'] as const;
export type ColumnGroup = typeof PERSON_GROUPS[number] | typeof UNION_GROUPS[number] | typeof EVENT_GROUPS[number] | typeof SOURCE_GROUPS[number];

export type ColumnLabelKey = keyof StringsType['table']['col'];

export interface ColumnDef {
    id: string;
    rowType: RowType;
    group: ColumnGroup;
    label: ColumnLabelKey;
    kind: ColumnKind;
    computed: boolean;
    unionScoped: boolean;
    phase: 1 | 2;
    /**
     * The column needs the research (§16.1): offered only when the tree
     * offers it (setResearchOffer), else not in the catalog at all.
     */
    fromResearch: boolean;
    /** Default width (px, desktop). */
    width: number;
    align: 'left' | 'right';
    /** The cell; `union` is the union a union-scoped People cell reads. */
    get(ctx: TableContext, row: TableRow, union: Partnership | null): CellValue;
}

// ---------------------------------------------------------------------------
// Cell builders

const EMPTY: CellValue = Object.freeze({ text: '', sortKey: null, empty: true, na: false, subst: null, computed: false, approx: false, uncertain: false }) as CellValue;

export function emptyCell(computed = false): CellValue {
    return { ...EMPTY, computed };
}

/** A cell the column does not apply to (§6.1: left out of coverage). */
export function naCell(text = '', computed = false): CellValue {
    return { ...EMPTY, na: true, text, computed, title: strings.table.na };
}

/**
 * A union without a wedding (T54 G5): partners, or separated partners. The
 * union form calls their dates the start and the end of the relationship;
 * the model's other views (timeline, person page) read them as unmarried.
 */
export function unionWithoutWedding(u: Pick<Partnership, 'status'>): boolean {
    return u.status === 'partners' || u.status === 'separated';
}

/**
 * A wedding's cell (T54 G5): in a union without a wedding an empty cell does
 * not apply ("–", the bubble says why; left out of coverage). A value stored
 * there anyway (the relationship's start, written in the union form) is shown
 * as it is.
 */
function weddingCell(u: Partnership, cell: CellValue): CellValue {
    return unionWithoutWedding(u) && cell.empty ? { ...naCell('', cell.computed), title: strings.table.naNoWedding } : cell;
}

function textCell(value: string | null | undefined, computed = false): CellValue {
    const text = (value ?? '').trim();
    if (!text) return emptyCell(computed);
    return { ...EMPTY, text, sortKey: text.toLocaleLowerCase(), empty: false, computed };
}

function numberCell(n: number | null | undefined, computed = true, text?: string): CellValue {
    if (n === null || n === undefined || !Number.isFinite(n)) return emptyCell(computed);
    return { ...EMPTY, text: text ?? String(n), sortKey: n, empty: false, computed };
}

/** A qualifier as the short word before a date (§5.3: "abt.", "bef.", "aft."). */
export function qualifierWord(q: DateQualifier): string {
    const w = strings.table.qual;
    return q === '~' ? w.about : q === '<' ? w.before : q === '>' ? w.after : '';
}

/**
 * A date cell (§5.3): the date as the app writes it, a range as "1920–1925",
 * a qualifier as a short word before it (`prefix`); qualified dates and
 * ranges are `uncertain` (shown with a dotted underline; not a finding).
 * Sorted by the start ("bef. 1950" = 1950). `subst` marks a baptism standing
 * for the birth, a burial for the death (§5.2).
 */
export function dateCell(ctx: TableContext, value: string | undefined, subst: 'bap' | 'bur' | null = null): CellValue {
    const parts = flexDateParts(value, ctx.lang);
    if (!value || !parts) return value?.trim() ? textCell(value) : emptyCell();
    const d = parseFlexDate(value)!;
    const prefix = qualifierWord(parts.qualifier);
    return {
        ...EMPTY, text: parts.main, sortKey: dateNumber(value), empty: false, subst,
        uncertain: !!d.qualifier || !!d.end, ...(prefix ? { prefix } : {}),
    };
}

/**
 * An age between two dates (§5.1): exact on day dates ("72"), a range
 * ("78–79") when either is a year, a month or a range, "≈ n" (the difference
 * of the years) when either is an estimate (~, <, >); nothing when the end
 * lies before the start (a finding, §7). `approxAlways`: a date stands in for
 * another (a baptism for the birth, a burial for the death), so the age is
 * always "≈ n" (§5.1; a range gives its upper end).
 */
export function ageCell(birth: string | undefined, end: string | undefined, approxAlways = false): CellValue {
    if (!birth || !end) return emptyCell(true);
    const b = parseFlexDate(birth);
    const e = parseFlexDate(end);
    if (!b || !e) return emptyCell(true);
    const range = ageRangeBetween(birth, end);
    if (range && !approxAlways) {
        const text = range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
        return { ...EMPTY, text, sortKey: range.min, empty: false, computed: true };
    }
    const years = range ? range.max : (b.qualifier || e.qualifier) ? approxAgeBetween(birth, end) : null;
    if (years === null) return emptyCell(true);
    return { ...EMPTY, text: `≈ ${years}`, sortKey: years, empty: false, computed: true, approx: true };
}

/** A person's birth date, else the baptism's standing in for it (§5.2). */
export function birthOrBaptism(p: Person): { date: string; subst: boolean } | null {
    if (p.birthDate) return { date: p.birthDate, subst: false };
    const bap = firstEvent(p, 'baptism')?.date;
    return bap ? { date: bap, subst: true } : null;
}

/** A person's death date, else the burial's standing in for it (§5.2). */
export function deathOrBurial(p: Person): { date: string; subst: boolean } | null {
    if (p.deathDate) return { date: p.deathDate, subst: false };
    const bur = firstEvent(p, 'burial')?.date;
    return bur ? { date: bur, subst: true } : null;
}

/** The age at an event from the birth (or the baptism, then "≈"; §5.1). */
function ageAt(p: Person | null | undefined, end: string | undefined, endSubst = false): CellValue {
    if (!p || !end) return emptyCell(true);
    const b = birthOrBaptism(p);
    return b ? ageCell(b.date, end, b.subst || endSubst) : emptyCell(true);
}

function gapCell(recorded: string | undefined, birth: string | undefined, event: string | undefined): CellValue {
    const gap = recordedAgeGap(recorded, birth, event);
    if (gap === null) return emptyCell(true);
    const text = gap > 0 ? `+${gap}` : gap < 0 ? `−${-gap}` : '0';
    return { ...EMPTY, text, sortKey: gap, empty: false, computed: true };
}

function percentCell(filled: number, total: number): CellValue {
    if (total === 0) return naCell('', true);
    const percent = Math.round((filled / total) * 100);
    return { ...EMPTY, text: `${percent} %`, sortKey: percent, empty: false, computed: true, percent };
}

/** One field of a completeness group (§6.2): its name for the "missing" list and whether it is filled. */
type CompField = [keyof StringsType['table']['compField'], boolean];

/**
 * A completeness cell (§6.2): the share of filled fields, its bubble the
 * column's name with the percentage, what is missing and what it counts.
 */
function compCell(fields: readonly CompField[], label: ColumnLabelKey, list: keyof StringsType['table']['compList']): CellValue {
    const filled = fields.filter(f => f[1]).length;
    const cell = percentCell(filled, fields.length);
    if (cell.na) return cell;
    const s = strings.table;
    const missing = [...new Set(fields.filter(f => !f[1]).map(f => s.compField[f[0]]))];
    const title = [
        `${s.col[label]} ${cell.text}`,
        missing.length ? s.missing(missing.join(', ')) : s.missingNone,
        s.compCounts(s.compList[list]),
    ].join('\n');
    return { ...cell, title };
}

function yesNo(v: boolean): CellValue {
    const s = strings.table;
    return { ...EMPTY, text: v ? s.yes : s.no, sortKey: v ? 1 : 0, empty: false, computed: true };
}

function nameOf(p: Person | null | undefined): CellValue {
    if (!p) return emptyCell();
    const text = shownNameOrEmpty(p);
    if (!text) return emptyCell();
    const key = `${(p.lastName ?? '').toLocaleLowerCase()}\u0000${(p.firstName ?? '').toLocaleLowerCase()}`;
    return { ...EMPTY, text, sortKey: key, empty: false, personId: p.id };
}

// ---------------------------------------------------------------------------
// Person helpers

const firstEvent = (p: Person, type: LifeEventType): LifeEvent | undefined => (p.events ?? []).find(e => e.type === type);

function eventValue(e: LifeEvent): string {
    const v = eventValueIsOnTag(e.type) ? e.note : e.place || e.note || e.address;
    return (v ?? '').trim();
}

/** The values of a person's events of one type, newest first, each once (§4.1 Events). */
function eventValues(p: Person, type: LifeEventType): CellValue {
    const list = sortLifeEvents((p.events ?? []).filter(e => e.type === type)).reverse();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of list) {
        const v = eventValue(e);
        if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
    return textCell(out.join(', '));
}

function parentsOf(ctx: TableContext, p: Person): [Person | null, Person | null] {
    const parents = p.parentIds.map(id => ctx.data.persons[id]).filter((x): x is Person => !!x);
    return parentSlots(parents);
}

const asPerson = (row: TableRow): Person => (row as PersonRow).person;

function otherPartner(ctx: TableContext, u: Partnership | null, self: PersonId): Person | null {
    if (!u) return null;
    return ctx.person(u.person1Id === self ? u.person2Id : u.person1Id);
}

function witnessNames(ctx: TableContext, u: Partnership): CellValue {
    const names = (u.participants ?? []).filter(x => x.role === 'witness').map(x => {
        const p = x.personId ? ctx.data.persons[x.personId] : undefined;
        return p ? shownNameOrEmpty(p) : (x.name ?? '').trim();
    }).filter(Boolean);
    return textCell(names.join(', '));
}

/** Length of a union (§5.1): from the wedding to the divorce, else to the first death; both alive: nothing. */
function unionLength(ctx: TableContext, u: Partnership): CellValue {
    if (!u.startDate) return emptyCell(true);
    if (u.endDate) return ageCell(u.startDate, u.endDate);
    const deaths = [ctx.person(u.person1Id), ctx.person(u.person2Id)]
        .map(p => p?.deathDate).filter((d): d is string => !!d)
        .sort((a, b) => (dateNumber(a) ?? 0) - (dateNumber(b) ?? 0));
    return deaths.length ? ageCell(u.startDate, deaths[0]) : emptyCell(true);
}

/*
 * Completeness (§6.2, decision of 10 Nov point 5). A substitute value (a
 * baptism for the birth) does not fill a field.
 */
function oneUnionFields(u: Partnership, partner: Person | null): CompField[] {
    // A union without a wedding (T54 G5): the wedding's fields do not count, only the partner.
    if (unionWithoutWedding(u)) return [['partner', !!partner]];
    return [['wDate', !!u.startDate], ['wPlace', !!u.startPlace?.trim()], ['partner', !!partner], ['wSrc', (u.sourceIds?.length ?? 0) > 0]];
}

function unionComp(u: Partnership, partner: Person | null): CellValue {
    return compCell(oneUnionFields(u, partner), 'uComp', unionWithoutWedding(u) ? 'unionNoWedding' : 'union');
}

export function birthFields(ctx: TableContext, p: Person): CompField[] {
    const [father, mother] = parentsOf(ctx, p);
    return [['bDate', !!p.birthDate], ['bPlace', !!p.birthPlace?.trim()], ['father', !!father], ['mother', !!mother], ['bSrc', (p.birthSourceIds?.length ?? 0) > 0]];
}

export function deathFields(p: Person): CompField[] {
    return [['dDate', !!p.deathDate], ['dPlace', !!p.deathPlace?.trim()], ['dSrc', (p.deathSourceIds?.length ?? 0) > 0]];
}

/** The fields of all a person's unions together (§6.2). */
export function unionFields(ctx: TableContext, row: PersonRow): CompField[] {
    return row.unions.flatMap(u => oneUnionFields(u, otherPartner(ctx, u, row.id)));
}

/** Overall completeness (§6.2): birth, every union and (for the dead) death, weighted by their fields. */
export function personCompleteness(ctx: TableContext, row: PersonRow): CellValue {
    const living = ctx.living(row.person);
    return compCell([...birthFields(ctx, row.person), ...unionFields(ctx, row), ...(living ? [] : deathFields(row.person))], 'comp', 'all');
}

function personSources(row: PersonRow): number {
    const p = row.person;
    const ids = new Set<string>(personSourceIds(p));
    for (const e of p.events ?? []) for (const s of e.sourceIds ?? []) ids.add(s);
    for (const u of row.unions) for (const s of partnershipSourceIds(u)) ids.add(s);
    return ids.size;
}

/** The text field of a source a citation cell shows (§14.3, spec 075 U3 §3). */
const CITE_FIELD = { repo: 'repository', sig: 'callNumber', folio: 'folio', image: 'image', ref: 'reference' } as const;

/**
 * A citation cell (§14.3): the first cited source's archive, call number,
 * folio, image, other location (an older source: its whole location) or web
 * address (a link ↗); with more, the others' ids for the pill "+N". Sorted
 * and filtered by the first one's value; an older source leaves the call
 * number, folio and image empty.
 */
export function citeCell(cites: readonly CitedSource[], field: keyof typeof CITE_FIELD | 'url'): CellValue {
    if (!cites.length) return emptyCell();
    const first = cites[0].source;
    const cell = field === 'url' ? urlCell(first.url) : textCell(first[CITE_FIELD[field]]);
    return cites.length > 1 ? { ...cell, moreSources: cites.slice(1).map(c => c.id) } : cell;
}

/** Godparents (§14.5): the names of the birth's and the baptism's godparents, the tree's people as links to them. */
function godparentsCell(ctx: TableContext, p: Person): CellValue {
    return namesCell(personGodparents(p).map(x => {
        const n = participantCellName(ctx, x);
        return n.personId ? { text: n.text, personId: n.personId } : { text: n.text };
    }));
}

function reliabilityText(step: ReliabilityStepName): string {
    const r = strings.reliability;
    if (step === 'human') return r.human;
    if (step === 'proven') return r.proven;
    if (step === 'import') return r.import;
    if (step === 'none') return r.none;
    return strings.factStatus[step];
}

const RELIABILITY_RANK: Record<string, number> = { human: 0, proven: 1, probable: 2, possible: 3, import: 4, lead: 5, none: 6 };

/** The checks still run (§13i): "…", faint, sorted last. */
function checksPendingCell(): CellValue {
    return { ...EMPTY, text: '…', empty: false, computed: true, ghost: true, title: strings.table.checksRunning };
}

/** Findings (§7.2): the person's findings still reported, with the mark of the highest; "0" faint. */
function findingsCell(ctx: TableContext, row: TableRow): CellValue {
    if (!ctx.checks) return checksPendingCell();
    const f = ctx.checks.person(row.id);
    if (!f.n) return { ...EMPTY, text: '0', sortKey: 0, empty: false, computed: true, ghost: true };
    return { ...EMPTY, text: String(f.n), sortKey: f.n, empty: false, computed: true, ...(f.top ? { mark: f.top } : {}) };
}

/** Highest level (§7.2): the mark and its word; "unusual" when every finding is marked "Not an error". */
function topSeverityCell(ctx: TableContext, row: TableRow): CellValue {
    if (!ctx.checks) return checksPendingCell();
    const f = ctx.checks.person(row.id);
    const sev = f.top ?? (f.unusual ? 'unusual' : null);
    if (!sev) return emptyCell(true);
    const rank = { error: 3, warning: 2, info: 1, unusual: 0.5 }[sev];
    return { ...EMPTY, text: strings.table.sev[sev], sortKey: rank, empty: false, computed: true, mark: sev };
}

/** Unusual, checked (§7.5): the person's findings marked "Not an error", with ☆. */
function unusualCell(ctx: TableContext, row: TableRow): CellValue {
    if (!ctx.checks) return checksPendingCell();
    const n = ctx.checks.person(row.id).unusual;
    return n ? { ...EMPTY, text: String(n), sortKey: n, empty: false, computed: true, mark: 'unusual' } : emptyCell(true);
}

function pillCell(ctx: TableContext, holder: Person | Partnership | null, fact: string): CellValue {
    if (!holder) return naCell();
    const r = factReliability(ctx.data, holder, fact, ctx.reliability);
    if (!r) return emptyCell(true);
    return { ...EMPTY, text: reliabilityText(r.step), sortKey: RELIABILITY_RANK[r.step] ?? 9, empty: false, computed: true, pill: r.step };
}

function deathOnly(ctx: TableContext, row: TableRow, compute: (p: Person) => CellValue, naText = ''): CellValue {
    const p = asPerson(row);
    return ctx.living(p) ? naCell(naText, true) : compute(p);
}

/** The research columns of people with their widths (§16.2, §16.9, §16.10), in the catalog's order. */
const RESEARCH_DEFS: readonly (readonly [ResearchColumnId, number])[] = [
    ['rSum', 100], ['rWait', 196], ['rConf', 170], ['rHyp', 96], ['rTasks', 170], ['rAgent', 220], ['rMat', 92], ['rLine', 240],
    ['rEdge', 260], ['rSearched', 260], ['rSync', 330], ['rOrig', 250], ['rStory', 190], ['rWhere', 300], ['rNew', 260], ['rAvail', 300],
    ['rParish', 280], ['rEst', 210],
];

/** The research columns of unions (16zg). */
const UNION_RESEARCH_DEFS: readonly (readonly [UnionResearchColumnId, number])[] = [['rLine', 240], ['rAgent', 220], ['rConf', 170]];

function researchPersonCell(ctx: TableContext, row: TableRow, id: ResearchColumnId): CellValue {
    return ctx.research ? researchCell(ctx.research, asPerson(row), id) : emptyCell();
}

/** ⇄ In another tree (§16.0): the other trees the person is in, by name; sorted by their number. */
function crossTreeCell(ctx: TableContext, p: Person): CellValue {
    const matches = ctx.crossTree?.(p) ?? [];
    const names = [...new Set(matches.map(m => m.treeName))];
    if (!names.length) return emptyCell();
    return { ...EMPTY, text: names.join(', '), sortKey: names.length, empty: false };
}

/** Person status (§16.0): the card's one mark of sources and reliability in words; sorted strongest first. */
function personStatusCell(ctx: TableContext, p: Person): CellValue {
    const st = cardStatus(ctx.data, p, { ...ctx.reliability, treeHasSources: ctx.hasSources(), unions: ctx.unionsOf() });
    if (!st) return emptyCell();
    return { ...textCell(cardStatusLabel(st)), sortKey: CARD_STATUS_CLASSES.indexOf(st.cls) };
}

// ---------------------------------------------------------------------------
// The catalog

type Def = Omit<ColumnDef, 'rowType' | 'computed' | 'unionScoped' | 'phase' | 'align' | 'kind' | 'fromResearch'> & Partial<Pick<ColumnDef, 'computed' | 'unionScoped' | 'kind' | 'align' | 'fromResearch'>>;

function cols(rowType: RowType, defs: Def[]): ColumnDef[] {
    return defs.map(d => {
        const kind = d.kind ?? 'text';
        const numeric = kind === 'age' || kind === 'number' || kind === 'percent';
        return {
            computed: false, phase: 1 as const, ...d, rowType, kind, fromResearch: d.fromResearch ?? d.group === 'research',
            unionScoped: d.unionScoped ?? (rowType === 'persons' && (d.group === 'union' || d.group === 'divorce')),
            align: d.align ?? (numeric ? 'right' : 'left'),
        };
    });
}

/** A union-scoped People cell: the union it reads, or "does not apply" without one. */
const inUnion = (fn: (ctx: TableContext, row: PersonRow, u: Partnership) => CellValue, computed = false) =>
    (ctx: TableContext, row: TableRow, u: Partnership | null): CellValue => u ? fn(ctx, row as PersonRow, u) : naCell('', computed);

export const PERSON_COLUMNS: readonly ColumnDef[] = cols('persons', [
    // Person
    { id: 'name', group: 'person', label: 'name', width: 250, get: (_c, r) => nameOf(asPerson(r)) },
    // The given name alone (T54 G10): offered, not shown by default; edited in place as the dialog's field.
    { id: 'firstName', group: 'person', label: 'firstName', width: 150, get: (_c, r) => textCell(asPerson(r).firstName) },
    { id: 'surname', group: 'person', label: 'surname', width: 150, get: (_c, r) => textCell(asPerson(r).marriedSurname || asPerson(r).lastName) },
    { id: 'birthSurname', group: 'person', label: 'birthSurname', width: 150, get: (_c, r) => textCell(asPerson(r).lastName) },
    { id: 'marriedSurname', group: 'person', label: 'marriedSurname', width: 150, get: (_c, r) => textCell(asPerson(r).marriedSurname) },
    { id: 'titles', group: 'person', label: 'titles', width: 110, get: (_c, r) => textCell([asPerson(r).titleBefore, asPerson(r).titleAfter].filter(Boolean).join(' ')) },
    {
        id: 'gender', group: 'person', label: 'gender', width: 100, get: (_c, r) => {
            const g = asPerson(r).gender;
            return g === 'male' || g === 'female' ? textCell(strings.gender[g]) : emptyCell();
        },
    },
    { id: 'living', group: 'person', label: 'living', width: 80, computed: true, get: (c, r) => yesNo(c.living(asPerson(r))) },
    { id: 'question', group: 'person', label: 'question', width: 220, get: (_c, r) => textCell(asPerson(r).question) },
    { id: 'crossTree', group: 'person', label: 'crossTree', width: 190, get: (c, r) => crossTreeCell(c, asPerson(r)) },
    {
        id: 'researchId', group: 'person', label: 'researchId', width: 110, get: (_c, r) => {
            const ref = asPerson(r).refn?.trim();
            return textCell(ref && /^P\d{1,7}$/.test(ref) ? ref : '');
        },
    },
    // The person's user reference number (GEDCOM REFN) as the file or the form wrote it; offered, not shown by default.
    { id: 'refn', group: 'person', label: 'refn', width: 130, get: (_c, r) => textCell(asPerson(r).refn) },
    {
        id: 'gen', group: 'person', label: 'gen', width: 84, kind: 'number', computed: true, get: (c, r) => {
            const g = c.generations().get(r.id);
            return numberCell(g === undefined ? null : g + 1);
        },
    },
    {
        id: 'kin', group: 'person', label: 'kin', width: 170, computed: true, get: (c, r) => {
            if (!c.homeId) return emptyCell(true);
            if (r.id === c.homeId) return { ...textCell(strings.table.kinSelf, true), sortKey: '\u0000' };
            const rel = findRelationship(c.data, c.homeId, r.id as PersonId);
            return textCell(rel?.term[c.lang] ?? '', true);
        },
    },
    {
        id: 'rod', group: 'person', label: 'rod', width: 120, computed: true, get: (c, r) => {
            const { index, labels } = c.lineage();
            const rod = rodOf(index, r.id as PersonId);
            return textCell(rod ? labels.get(rod) : '', true);
        },
    },
    // Birth and baptism
    {
        id: 'bDate', group: 'birth', label: 'bDate', width: 140, kind: 'date', get: (c, r) => {
            const p = asPerson(r);
            if (p.birthDate) return dateCell(c, p.birthDate);
            const bap = firstEvent(p, 'baptism');
            return bap?.date ? dateCell(c, bap.date, 'bap') : emptyCell();
        },
    },
    {
        id: 'bPlace', group: 'birth', label: 'bPlace', width: 220, get: (_c, r) => {
            const p = asPerson(r);
            if (p.birthPlace?.trim()) return textCell(p.birthPlace);
            const place = firstEvent(p, 'baptism')?.place?.trim();
            return place ? { ...textCell(place), subst: 'bap' } : emptyCell();
        },
    },
    { id: 'bAddr', group: 'birth', label: 'bAddr', width: 180, get: (_c, r) => textCell(asPerson(r).birthAddress) },
    { id: 'bapDate', group: 'birth', label: 'bapDate', width: 120, kind: 'date', get: (c, r) => dateCell(c, firstEvent(asPerson(r), 'baptism')?.date) },
    { id: 'bapPlace', group: 'birth', label: 'bapPlace', width: 180, get: (_c, r) => textCell(firstEvent(asPerson(r), 'baptism')?.place) },
    { id: 'godparents', group: 'birth', label: 'godparents', width: 220, get: (c, r) => godparentsCell(c, asPerson(r)) },
    {
        id: 'fAge', group: 'birth', label: 'fAge', width: 104, kind: 'age', computed: true, get: (c, r) => {
            const [father] = parentsOf(c, asPerson(r));
            const b = birthOrBaptism(asPerson(r));
            return father ? ageAt(father, b?.date, b?.subst) : naCell('', true);
        },
    },
    {
        id: 'mAge', group: 'birth', label: 'mAge', width: 104, kind: 'age', computed: true, get: (c, r) => {
            const [, mother] = parentsOf(c, asPerson(r));
            const b = birthOrBaptism(asPerson(r));
            return mother ? ageAt(mother, b?.date, b?.subst) : naCell('', true);
        },
    },
    {
        id: 'bComp', group: 'birth', label: 'bComp', width: 124, kind: 'percent', computed: true,
        get: (c, r) => compCell(birthFields(c, asPerson(r)), 'bComp', 'birth'),
    },
    // Parents
    { id: 'father', group: 'parents', label: 'father', width: 190, get: (c, r) => nameOf(parentsOf(c, asPerson(r))[0]) },
    { id: 'mother', group: 'parents', label: 'mother', width: 190, get: (c, r) => nameOf(parentsOf(c, asPerson(r))[1]) },
    {
        id: 'sibs', group: 'parents', label: 'sibs', width: 104, kind: 'number', computed: true, get: (c, r) => {
            const p = asPerson(r);
            return p.parentIds.length ? numberCell(siblingsOf(c.data, p.id).filter(id => c.person(id)).length) : naCell('', true);
        },
    },
    {
        id: 'sibOrder', group: 'parents', label: 'sibOrder', width: 110, kind: 'number', computed: true, get: (c, r) => {
            const p = asPerson(r);
            if (!p.parentIds.length) return naCell('', true);
            const all = sortByBirth(c.data, [p.id, ...siblingsOf(c.data, p.id).filter(id => c.person(id))]);
            return numberCell(all.indexOf(p.id) + 1);
        },
    },
    // Unions
    { id: 'uCount', group: 'union', label: 'uCount', width: 92, kind: 'number', computed: true, unionScoped: false, get: (_c, r) => numberCell((r as PersonRow).unions.length) },
    { id: 'partner', group: 'union', label: 'partner', width: 200, get: inUnion((c, r, u) => nameOf(otherPartner(c, u, r.id))) },
    { id: 'wDate', group: 'union', label: 'wDate', width: 120, kind: 'date', get: inUnion((c, _r, u) => weddingCell(u, dateCell(c, u.startDate))) },
    { id: 'wPlace', group: 'union', label: 'wPlace', width: 200, get: inUnion((_c, _r, u) => weddingCell(u, textCell(u.startPlace))) },
    { id: 'wAge', group: 'union', label: 'wAge', width: 96, kind: 'age', computed: true, get: inUnion((_c, r, u) => weddingCell(u, ageAt(r.person, u.startDate)), true) },
    { id: 'wAgeRec', group: 'union', label: 'wAgeRec', width: 104, get: inUnion((_c, r, u) => weddingCell(u, textCell(u.ages?.[r.id]))) },
    { id: 'wAgeDiff', group: 'union', label: 'wAgeDiff', width: 104, kind: 'number', computed: true, get: inUnion((_c, r, u) => weddingCell(u, gapCell(u.ages?.[r.id], r.person.birthDate, u.startDate)), true) },
    { id: 'pAge', group: 'union', label: 'pAge', width: 104, kind: 'age', computed: true, get: inUnion((c, r, u) => weddingCell(u, ageAt(otherPartner(c, u, r.id), u.startDate)), true) },
    {
        id: 'pAgeRec', group: 'union', label: 'pAgeRec', width: 104, get: inUnion((c, r, u) => {
            const other = otherPartner(c, u, r.id);
            return weddingCell(u, other ? textCell(u.ages?.[other.id]) : emptyCell());
        }),
    },
    {
        id: 'pAgeDiff', group: 'union', label: 'pAgeDiff', width: 104, kind: 'number', computed: true, get: inUnion((c, r, u) => {
            const other = otherPartner(c, u, r.id);
            return weddingCell(u, other ? gapCell(u.ages?.[other.id], other.birthDate, u.startDate) : emptyCell(true));
        }, true),
    },
    { id: 'uStatus', group: 'union', label: 'uStatus', width: 120, get: inUnion((_c, _r, u) => textCell(strings.partnershipStatus[u.status])) },
    { id: 'witnesses', group: 'union', label: 'witnesses', width: 230, get: inUnion((c, _r, u) => weddingCell(u, witnessNames(c, u))) },
    { id: 'uLen', group: 'union', label: 'uLen', width: 96, kind: 'age', computed: true, get: inUnion((c, _r, u) => unionLength(c, u), true) },
    { id: 'uKids', group: 'union', label: 'uKids', width: 88, kind: 'number', computed: true, get: inUnion((_c, _r, u) => numberCell(u.childIds.length), true) },
    { id: 'uComp', group: 'union', label: 'uComp', width: 124, kind: 'percent', computed: true, get: inUnion((c, r, u) => unionComp(u, otherPartner(c, u, r.id)), true) },
    // Divorce
    { id: 'div', group: 'divorce', label: 'div', width: 88, computed: true, get: inUnion((_c, _r, u) => yesNo(u.status === 'divorced' || !!u.endDate), true) },
    { id: 'divDate', group: 'divorce', label: 'divDate', width: 120, kind: 'date', get: inUnion((c, _r, u) => dateCell(c, u.endDate)) },
    { id: 'divPlace', group: 'divorce', label: 'divPlace', width: 180, get: inUnion((_c, _r, u) => textCell(u.endPlace)) },
    // Death and burial
    {
        id: 'dDate', group: 'death', label: 'dDate', width: 140, kind: 'date', get: (c, r) => deathOnly(c, r, p => {
            if (p.deathDate) return dateCell(c, p.deathDate);
            const bur = firstEvent(p, 'burial');
            return bur?.date ? dateCell(c, bur.date, 'bur') : emptyCell();
        }),
    },
    {
        id: 'dPlace', group: 'death', label: 'dPlace', width: 210, get: (c, r) => deathOnly(c, r, p => {
            if (p.deathPlace?.trim()) return textCell(p.deathPlace);
            const place = firstEvent(p, 'burial')?.place?.trim();
            return place ? { ...textCell(place), subst: 'bur' } : emptyCell();
        }),
    },
    { id: 'dCause', group: 'death', label: 'dCause', width: 180, get: (c, r) => deathOnly(c, r, p => textCell(p.deathCause)) },
    { id: 'dAddr', group: 'death', label: 'dAddr', width: 180, get: (c, r) => deathOnly(c, r, p => textCell(p.deathAddress)) },
    { id: 'burDate', group: 'death', label: 'burDate', width: 124, kind: 'date', get: (c, r) => deathOnly(c, r, p => dateCell(c, firstEvent(p, 'burial')?.date)) },
    { id: 'burPlace', group: 'death', label: 'burPlace', width: 180, get: (c, r) => deathOnly(c, r, p => textCell(firstEvent(p, 'burial')?.place)) },
    {
        id: 'dAge', group: 'death', label: 'dAge', width: 100, kind: 'age', computed: true, get: (c, r) => deathOnly(c, r, p => {
            const d = deathOrBurial(p);
            return d ? ageAt(p, d.date, d.subst) : emptyCell(true);
        }),
    },
    { id: 'dAgeRec', group: 'death', label: 'dAgeRec', width: 110, get: (c, r) => deathOnly(c, r, p => textCell(p.deathAge)) },
    { id: 'dAgeDiff', group: 'death', label: 'dAgeDiff', width: 110, kind: 'number', computed: true, get: (c, r) => deathOnly(c, r, p => gapCell(p.deathAge, p.birthDate, p.deathDate)) },
    {
        id: 'dComp', group: 'death', label: 'dComp', width: 124, kind: 'percent', computed: true,
        get: (c, r) => deathOnly(c, r, p => compCell(deathFields(p), 'dComp', 'death'), strings.table.living),
    },
    // Events
    { id: 'occ', group: 'events', label: 'occ', width: 140, get: (_c, r) => eventValues(asPerson(r), 'occupation') },
    { id: 'res', group: 'events', label: 'res', width: 180, get: (_c, r) => eventValues(asPerson(r), 'residence') },
    { id: 'rel', group: 'events', label: 'rel', width: 140, get: (_c, r) => eventValues(asPerson(r), 'religion') },
    { id: 'mil', group: 'events', label: 'mil', width: 160, get: (_c, r) => eventValues(asPerson(r), 'military') },
    { id: 'emi', group: 'events', label: 'emi', width: 200, get: (_c, r) => eventValues(asPerson(r), 'emigration') },
    { id: 'edu', group: 'events', label: 'edu', width: 160, get: (_c, r) => eventValues(asPerson(r), 'education') },
    // Sources
    { id: 'srcCount', group: 'sources', label: 'srcCount', width: 92, kind: 'number', computed: true, get: (_c, r) => numberCell(personSources(r as PersonRow)) },
    // The citations of the birth, the marriage (the union of the row or sub-row) and the death (§14.3).
    { id: 'bArch', group: 'sources', label: 'bArch', width: 200, get: (c, r) => citeCell(factCitations(c.data, 'birth', asPerson(r)), 'repo') },
    { id: 'bSig', group: 'sources', label: 'bSig', width: 160, get: (c, r) => citeCell(factCitations(c.data, 'birth', asPerson(r)), 'sig') },
    { id: 'bFolio', group: 'sources', label: 'bFolio', width: 180, get: (c, r) => citeCell(factCitations(c.data, 'birth', asPerson(r)), 'folio') },
    { id: 'bImage', group: 'sources', label: 'bImage', width: 130, get: (c, r) => citeCell(factCitations(c.data, 'birth', asPerson(r)), 'image') },
    { id: 'bRef', group: 'sources', label: 'bRef', width: 230, get: (c, r) => citeCell(factCitations(c.data, 'birth', asPerson(r)), 'ref') },
    { id: 'bUrl', group: 'sources', label: 'bUrl', width: 200, kind: 'link', get: (c, r) => citeCell(factCitations(c.data, 'birth', asPerson(r)), 'url') },
    { id: 'wArch', group: 'sources', label: 'wArch', width: 200, unionScoped: true, get: inUnion((c, _r, u) => citeCell(factCitations(c.data, 'marriage', u), 'repo')) },
    { id: 'wSig', group: 'sources', label: 'wSig', width: 160, unionScoped: true, get: inUnion((c, _r, u) => citeCell(factCitations(c.data, 'marriage', u), 'sig')) },
    { id: 'wFolio', group: 'sources', label: 'wFolio', width: 180, unionScoped: true, get: inUnion((c, _r, u) => citeCell(factCitations(c.data, 'marriage', u), 'folio')) },
    { id: 'wImage', group: 'sources', label: 'wImage', width: 130, unionScoped: true, get: inUnion((c, _r, u) => citeCell(factCitations(c.data, 'marriage', u), 'image')) },
    { id: 'wRef', group: 'sources', label: 'wRef', width: 230, unionScoped: true, get: inUnion((c, _r, u) => citeCell(factCitations(c.data, 'marriage', u), 'ref')) },
    { id: 'wUrl', group: 'sources', label: 'wUrl', width: 200, kind: 'link', unionScoped: true, get: inUnion((c, _r, u) => citeCell(factCitations(c.data, 'marriage', u), 'url')) },
    { id: 'dArch', group: 'sources', label: 'dArch', width: 200, get: (c, r) => deathOnly(c, r, p => citeCell(factCitations(c.data, 'death', p), 'repo')) },
    { id: 'dSig', group: 'sources', label: 'dSig', width: 160, get: (c, r) => deathOnly(c, r, p => citeCell(factCitations(c.data, 'death', p), 'sig')) },
    { id: 'dFolio', group: 'sources', label: 'dFolio', width: 180, get: (c, r) => deathOnly(c, r, p => citeCell(factCitations(c.data, 'death', p), 'folio')) },
    { id: 'dImage', group: 'sources', label: 'dImage', width: 130, get: (c, r) => deathOnly(c, r, p => citeCell(factCitations(c.data, 'death', p), 'image')) },
    { id: 'dRef', group: 'sources', label: 'dRef', width: 230, get: (c, r) => deathOnly(c, r, p => citeCell(factCitations(c.data, 'death', p), 'ref')) },
    { id: 'dUrl', group: 'sources', label: 'dUrl', width: 200, kind: 'link', get: (c, r) => deathOnly(c, r, p => citeCell(factCitations(c.data, 'death', p), 'url')) },
    // Reliability and research
    { id: 'relN', group: 'rel', label: 'relN', width: 150, kind: 'pill', computed: true, get: (c, r) => pillCell(c, asPerson(r), 'name') },
    { id: 'relB', group: 'rel', label: 'relB', width: 150, kind: 'pill', computed: true, get: (c, r) => pillCell(c, asPerson(r), 'birth') },
    { id: 'relD', group: 'rel', label: 'relD', width: 150, kind: 'pill', computed: true, get: (c, r) => c.living(asPerson(r)) ? naCell('', true) : pillCell(c, asPerson(r), 'death') },
    { id: 'relW', group: 'rel', label: 'relW', width: 150, kind: 'pill', computed: true, unionScoped: true, get: (c, _r, u) => u ? weddingCell(u, pillCell(c, u, 'marriage')) : pillCell(c, u, 'marriage') },
    {
        id: 'evid', group: 'rel', label: 'evid', width: 124, computed: true, get: (_c, r) => {
            const row = r as PersonRow;
            const n = personSources(row);
            const p = row.person;
            const birthCited = (p.birthSourceIds?.length ?? 0) > 0 || (p.events ?? []).some(e => (e.type === 'birth' || e.type === 'baptism') && (e.sourceIds?.length ?? 0) > 0);
            const hasDeath = !!p.deathDate || !!p.deathPlace?.trim();
            const deathCited = (p.deathSourceIds?.length ?? 0) > 0 || (p.events ?? []).some(e => (e.type === 'death' || e.type === 'burial') && (e.sourceIds?.length ?? 0) > 0);
            const level = n === 0 ? 'none' : birthCited && (!hasDeath || deathCited) ? 'full' : 'partial';
            const rank = level === 'full' ? 2 : level === 'partial' ? 1 : 0;
            return { ...textCell(strings.table.evidence[level], true), sortKey: rank };
        },
    },
    {
        id: 'certainty', group: 'rel', label: 'certainty', width: 140, computed: true, get: (_c, r) => {
            const p = asPerson(r);
            const order = ['lead', 'possible', 'probable', 'proven'] as const;
            const have = [p.birthStatus, p.deathStatus].filter((s): s is typeof order[number] => !!s);
            if (!have.length) return emptyCell(true);
            const weakest = have.reduce((a, b) => order.indexOf(a) <= order.indexOf(b) ? a : b);
            return { ...textCell(strings.factStatus[weakest], true), sortKey: order.indexOf(weakest) };
        },
    },
    { id: 'personStatus', group: 'rel', label: 'personStatus', width: 190, get: (c, r) => personStatusCell(c, asPerson(r)) },
    // Research (§16.2, §16.8–§16.10): only in a research tree, all hidden by default
    ...RESEARCH_DEFS.map(([id, width]): Def => ({ id, group: 'research', label: id, width, get: (c, r) => researchPersonCell(c, r, id) })),
    // Checks (filled by §7)
    { id: 'nFind', group: 'checks', label: 'nFind', width: 92, kind: 'number', computed: true, get: (c, r) => findingsCell(c, r) },
    { id: 'topSev', group: 'checks', label: 'topSev', width: 130, computed: true, get: (c, r) => topSeverityCell(c, r) },
    { id: 'unusual', group: 'checks', label: 'unusual', width: 130, kind: 'number', computed: true, get: (c, r) => unusualCell(c, r) },
    {
        id: 'comp', group: 'checks', label: 'comp', width: 124, kind: 'percent', computed: true,
        get: (c, r) => personCompleteness(c, r as PersonRow),
    },
]);

/** Partners of a union row as Partner 1 / Partner 2 (§2b). */
export function unionPartners(ctx: TableContext, row: UnionRow): { p1: Person | null; p2: Person | null } {
    const { p1, p2 } = row;
    if (!p1 || !p2) return { p1, p2 };
    const blood = ctx.blood();
    return !blood.has(p1.id) && blood.has(p2.id) ? { p1: p2, p2: p1 } : { p1, p2 };
}

const asUnion = (row: TableRow): UnionRow => row as UnionRow;

function partnerAge(ctx: TableContext, row: TableRow, k: 1 | 2): CellValue {
    const r = asUnion(row);
    const p = unionPartners(ctx, r)[k === 1 ? 'p1' : 'p2'];
    return p ? ageAt(p, r.union.startDate) : naCell('', true);
}

function partnerRec(ctx: TableContext, row: TableRow, k: 1 | 2): CellValue {
    const r = asUnion(row);
    const p = unionPartners(ctx, r)[k === 1 ? 'p1' : 'p2'];
    return p ? textCell(r.union.ages?.[p.id]) : naCell();
}

/** A wedding's cell of a union row (T54 G5). */
const wedOf = (row: TableRow, cell: CellValue): CellValue => weddingCell(asUnion(row).union, cell);

export const UNION_COLUMNS: readonly ColumnDef[] = cols('unions', [
    { id: 'p1', group: 'pair', label: 'p1', width: 220, get: (c, r) => nameOf(unionPartners(c, asUnion(r)).p1) },
    { id: 'p2', group: 'pair', label: 'p2', width: 220, get: (c, r) => nameOf(unionPartners(c, asUnion(r)).p2) },
    { id: 'uResearchId', group: 'pair', label: 'researchId', width: 110, fromResearch: true, get: (c, r) => c.research ? unionResearchIdCell(asUnion(r).union) : emptyCell() },
    { id: 'wDate', group: 'wed', label: 'wDate', width: 124, kind: 'date', get: (c, r) => wedOf(r, dateCell(c, asUnion(r).union.startDate)) },
    { id: 'wPlace', group: 'wed', label: 'wPlace', width: 210, get: (_c, r) => wedOf(r, textCell(asUnion(r).union.startPlace)) },
    { id: 'age1', group: 'wed', label: 'age1', width: 92, kind: 'age', computed: true, get: (c, r) => wedOf(r, partnerAge(c, r, 1)) },
    { id: 'rec1', group: 'wed', label: 'rec1', width: 100, get: (c, r) => wedOf(r, partnerRec(c, r, 1)) },
    { id: 'age2', group: 'wed', label: 'age2', width: 92, kind: 'age', computed: true, get: (c, r) => wedOf(r, partnerAge(c, r, 2)) },
    { id: 'rec2', group: 'wed', label: 'rec2', width: 100, get: (c, r) => wedOf(r, partnerRec(c, r, 2)) },
    { id: 'uStatus', group: 'wed', label: 'uStatus', width: 116, get: (_c, r) => textCell(strings.partnershipStatus[asUnion(r).union.status]) },
    { id: 'witnesses', group: 'wed', label: 'witnesses', width: 220, get: (c, r) => wedOf(r, witnessNames(c, asUnion(r).union)) },
    { id: 'relW', group: 'wed', label: 'relW', width: 150, kind: 'pill', computed: true, get: (c, r) => wedOf(r, pillCell(c, asUnion(r).union, 'marriage')) },
    { id: 'div', group: 'divorce', label: 'div', width: 88, computed: true, get: (_c, r) => yesNo(asUnion(r).union.status === 'divorced' || !!asUnion(r).union.endDate) },
    { id: 'divDate', group: 'divorce', label: 'divDate', width: 120, kind: 'date', get: (c, r) => dateCell(c, asUnion(r).union.endDate) },
    { id: 'divPlace', group: 'divorce', label: 'divPlace', width: 180, get: (_c, r) => textCell(asUnion(r).union.endPlace) },
    { id: 'uKids', group: 'uextra', label: 'uKids', width: 88, kind: 'number', computed: true, get: (_c, r) => numberCell(asUnion(r).union.childIds.length) },
    { id: 'uLen', group: 'uextra', label: 'uLen', width: 96, kind: 'age', computed: true, get: (c, r) => unionLength(c, asUnion(r).union) },
    { id: 'srcCount', group: 'uextra', label: 'srcCount', width: 92, kind: 'number', computed: true, get: (_c, r) => numberCell(partnershipSourceIds(asUnion(r).union).length) },
    { id: 'uComp', group: 'uextra', label: 'uComp', width: 124, kind: 'percent', computed: true, get: (c, r) => unionComp(asUnion(r).union, unionPartners(c, asUnion(r)).p2) },
    // Research (16zg): only in a research tree
    ...UNION_RESEARCH_DEFS.map(([id, width]): Def => ({
        id, group: 'research', label: id, width, get: (c, r) => c.research ? unionResearchCell(c.research, asUnion(r).union, id) : emptyCell(),
    })),
]);

// ---------------------------------------------------------------------------
// Events (§14.1)

const asEvent = (row: TableRow): EventRow => row as EventRow;

/** An event's people as the cell lists them: a union's blood relative first (as Partner 1, §2b). */
export function eventPersons(ctx: TableContext, row: EventRow): Person[] {
    const list = row.persons;
    if (list.length === 2 && row.union) {
        const blood = ctx.blood();
        if (!blood.has(list[0].id) && blood.has(list[1].id)) return [list[1], list[0]];
    }
    return list;
}

/** The type of an event as its row shows it (the app's names; a custom event its own label). */
export function eventTypeLabel(row: EventRow): string {
    const k = strings.table.evKind;
    switch (row.source) {
        case 'birth': return strings.events.types.birth;
        case 'death': return strings.events.types.death;
        case 'marriage': return row.type === 'marriage' ? k.marriage : k.partnersStart;
        case 'divorce': return row.type === 'divorce' ? k.divorce : k.partnersEnd;
        case 'couple': return row.event ? coupleEventLabel(row.event as Parameters<typeof coupleEventLabel>[0]) : '';
        case 'life': return row.event ? lifeEventLabel(row.event as LifeEvent) : '';
    }
}

/** A cell listing names (§14.1): the text joined by ", ", each name with its tree person when it is one. */
function namesCell(names: CellName[], sortKey?: string): CellValue {
    const shown = names.filter(n => n.text);
    if (!shown.length) return emptyCell();
    const text = shown.map(n => n.text).join(', ');
    return { ...EMPTY, text, sortKey: sortKey ?? text.toLocaleLowerCase(), empty: false, names: shown };
}

/** A participant's name: the tree's person when linked (not a placeholder), else the name as written. */
export function participantCellName(ctx: TableContext, x: EventParticipant): CellName {
    const p = x.personId ? ctx.person(x.personId) : null;
    if (p) return { text: shownNameOrEmpty(p) || (x.name ?? '').trim(), personId: p.id, role: x.role };
    return { text: (x.name ?? '').trim(), role: x.role };
}

function participantsCell(ctx: TableContext, row: TableRow, role: ParticipantRole): CellValue {
    return namesCell(asEvent(row).participants.filter(x => x.role === role).map(x => participantCellName(ctx, x)));
}

function whoCell(ctx: TableContext, row: TableRow): CellValue {
    const r = asEvent(row);
    const persons = eventPersons(ctx, r);
    const first = persons[0];
    const key = first ? `${(first.lastName ?? '').toLocaleLowerCase()}\u0000${(first.firstName ?? '').toLocaleLowerCase()}` : undefined;
    const whole = namesCell(persons.map(p => ({ text: shownNameOrEmpty(p), personId: p.id })), key);
    if (!r.shareId || persons.length < 2 || whole.empty) return whole;
    return sharedWhoCell(persons, whole);
}

/** Up to this many persons of a shared event are named in its row; more: the first two and "+N" (4a). */
export const SHARED_ROW_NAMES = 4;
const SHARED_ROW_HEAD = 2;

/**
 * The Persons cell of a shared event (spec 085 §4, 4a): the given names
 * (the whole name where two share one), the badge "4 people", from five
 * persons on the first two and "+N". The text stays the whole names.
 */
function sharedWhoCell(persons: readonly Person[], whole: CellValue): CellValue {
    const given = persons.map(p => givenNameOf(p));
    const seen = new Map<string, number>();
    for (const g of given) if (g) seen.set(g, (seen.get(g) ?? 0) + 1);
    const shown = persons.length > SHARED_ROW_NAMES ? persons.slice(0, SHARED_ROW_HEAD) : persons;
    const names: CellName[] = shown.map((p, i) => {
        const full = shownNameOrEmpty(p);
        const g = given[i];
        const text = g && seen.get(g) === 1 ? g : full;
        return { text: text || full, personId: p.id, ...(text !== full ? { title: full } : {}) };
    }).filter(n => n.text);
    return { ...whole, names, title: whole.text, shared: { count: persons.length, more: persons.length - shown.length } };
}

/** One person's age at a shared event (4a): as written in their copy, else computed. */
export interface SharedAgeRow {
    personId: PersonId;
    eventId: string;
    name: string;
    /** The age written in the person's copy ('' none). */
    recorded: string;
    /** The age computed from the birth ('' unknown). */
    computed: string;
}

/** A shared event's persons with their own ages, in the order of the Persons cell (4a); [] for any other row. */
export function sharedAgeRows(ctx: TableContext, row: EventRow): SharedAgeRow[] {
    if (row.source !== 'life' || !row.shareId) return [];
    const persons = eventPersons(ctx, row);
    if (persons.length < 2) return [];
    const out: SharedAgeRow[] = [];
    for (const p of persons) {
        for (const ref of row.refs) {
            if (ref.personId !== p.id) continue;
            const ev = (p.events ?? []).find(e => e.id === ref.eventId);
            if (!ev) continue;
            const c = row.date ? eventAge(p, row.date) : null;
            out.push({ personId: p.id, eventId: ref.eventId, name: shownNameOrEmpty(p), recorded: ev.age?.trim() ?? '', computed: c && !c.empty ? c.text : '' });
        }
    }
    return out;
}

const DAY = 86_400_000;

/** Days between two exact day dates (no qualifier, no range); null otherwise. */
function daysBetween(from: string | undefined, to: string | undefined): number | null {
    const a = parseFlexDate(from);
    const b = parseFlexDate(to);
    if (!a || !b || a.qualifier || b.qualifier || a.end || b.end || !a.month || !a.day || !b.month || !b.day) return null;
    const n = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);
    return n >= 0 ? n : null;
}

/** One person's age at an event: years as elsewhere (§5.1); under a year from exact days, the days ("12 d"). */
function eventAge(p: Person, date: string | undefined): CellValue {
    const cell = ageAt(p, date);
    if (cell.sortKey === 0 && p.birthDate) {
        const days = daysBetween(p.birthDate, date);
        if (days !== null && days < 366) return { ...cell, text: strings.table.ageDays(days), sortKey: days / 366 };
    }
    return cell;
}

/** Age at the event (§14.1): of its person; of several, each in the order of the names ("–" unknown). */
function eventAgeCell(ctx: TableContext, row: TableRow): CellValue {
    const r = asEvent(row);
    if (r.source === 'birth') return naCell('', true);
    const shared = sharedAgeRows(ctx, r);
    if (shared.length) {
        // A shared event (4a): each one's own age as written, else computed, "42 · 38 · 15 · 11".
        const parts = shared.map(a => a.recorded || a.computed);
        if (!parts.some(Boolean)) return { ...emptyCell(true), sharedAges: true };
        const first = parts.find(Boolean)!;
        const n = parseInt(first, 10);
        return {
            ...EMPTY, text: parts.map(t => t || '–').join(' · '), sortKey: Number.isFinite(n) ? n : first, empty: false,
            computed: !shared.some(a => a.recorded), sharedAges: true,
        };
    }
    if (!r.date) return emptyCell(true);
    const persons = eventPersons(ctx, r);
    if (persons.length === 1) return eventAge(persons[0], r.date);
    const cells = persons.map(p => eventAge(p, r.date));
    const known = cells.filter(c => !c.empty);
    if (!known.length) return emptyCell(true);
    return {
        ...EMPTY, text: cells.map(c => c.empty ? '–' : c.text).join(', '), sortKey: known[0].sortKey, empty: false,
        computed: true, approx: known.some(c => c.approx),
    };
}

/** What an event says besides its date and place: an occupation, a title (the value), else the cause. */
function eventValueCell(row: TableRow): CellValue {
    const r = asEvent(row);
    if (r.source === 'death') return textCell(r.persons[0]?.deathCause);
    const e = r.event;
    if (!e) return emptyCell();
    if (r.source === 'life' && eventValueIsOnTag((e as LifeEvent).type)) return textCell(e.note);
    return textCell(e.cause);
}

/**
 * The sources cited on the event: "title, call number, folio, image, other
 * location" (an older source: "title, location"), several joined by "; " (§14.1).
 */
function eventSourceCell(ctx: TableContext, row: TableRow): CellValue {
    const out: string[] = [];
    for (const id of asEvent(row).sourceIds) {
        const src = ctx.data.sources?.[id];
        if (!src) continue;
        const text = [src.title?.trim(), src.callNumber?.trim(), sourceEntryText(src, ', ')].filter(Boolean).join(', ');
        if (text && !out.includes(text)) out.push(text);
    }
    return textCell(out.join('; '));
}

/** The reliability pill of the event's fact (§4.1 Reliability): the person's, the union's. */
function eventPill(ctx: TableContext, row: TableRow): CellValue {
    const r = asEvent(row);
    switch (r.source) {
        case 'birth': return pillCell(ctx, r.persons[0] ?? null, 'birth');
        case 'death': return pillCell(ctx, r.persons[0] ?? null, 'death');
        case 'life': return pillCell(ctx, r.persons[0] ?? null, `event:${r.refs[0]?.eventId ?? ''}`);
        case 'marriage': return pillCell(ctx, r.union, 'marriage');
        case 'divorce': return pillCell(ctx, r.union, 'divorce');
        case 'couple': return pillCell(ctx, r.union, `event:${r.event?.id ?? ''}`);
    }
}

export const EVENT_COLUMNS: readonly ColumnDef[] = cols('events', [
    {
        id: 'evType', group: 'event', label: 'evType', width: 130, get: (_c, r) => textCell(eventTypeLabel(asEvent(r))),
    },
    { id: 'evWho', group: 'event', label: 'evWho', width: 210, get: (c, r) => whoCell(c, r) },
    { id: 'evDate', group: 'event', label: 'evDate', width: 120, kind: 'date', get: (c, r) => dateCell(c, asEvent(r).date) },
    { id: 'evPlace', group: 'event', label: 'evPlace', width: 210, get: (_c, r) => textCell(asEvent(r).place) },
    { id: 'evAge', group: 'event', label: 'evAge', width: 110, kind: 'age', computed: true, get: (c, r) => eventAgeCell(c, r) },
    { id: 'evValue', group: 'event', label: 'evValue', width: 180, get: (_c, r) => eventValueCell(r) },
    { id: 'godparents', group: 'participants', label: 'godparents', width: 250, get: (c, r) => participantsCell(c, r, 'godparent') },
    { id: 'witnesses', group: 'participants', label: 'witnesses', width: 200, get: (c, r) => participantsCell(c, r, 'witness') },
    { id: 'officiants', group: 'participants', label: 'officiants', width: 170, get: (c, r) => participantsCell(c, r, 'officiant') },
    { id: 'others', group: 'participants', label: 'others', width: 200, get: (c, r) => participantsCell(c, r, 'other') },
    { id: 'evSource', group: 'source', label: 'evSource', width: 300, get: (c, r) => eventSourceCell(c, r) },
    { id: 'evRel', group: 'source', label: 'evRel', width: 150, kind: 'pill', computed: true, get: (c, r) => eventPill(c, r) },
]);

/** The participants' columns by role (§14.1: the participant filter, the recurring godparent). */
export const PARTICIPANT_COLUMNS: Readonly<Record<ParticipantRole, string>> = {
    godparent: 'godparents', witness: 'witnesses', officiant: 'officiants', other: 'others',
};

// ---------------------------------------------------------------------------
// Sources (§14.2)

const asSource = (row: TableRow): SourceRow => row as SourceRow;

/** A web address as the Online cell shows it: without the scheme and a trailing slash. */
export function shortUrl(url: string): string {
    return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

/**
 * A web address cell (§14.2 Online, §14.3 a citation's URL): the address, a
 * link ↗ into a new window when it is a web address (http/https; one
 * written without the scheme opens as https).
 */
function urlCell(value: string | undefined): CellValue {
    const cell = textCell(value);
    if (cell.empty) return cell;
    const href = safeWebUrl(cell.text);
    return href ? { ...cell, link: { href, label: shortUrl(cell.text) } } : cell;
}

/** The Online cell of a source: where it is online (sourceOnline), else what its URL field holds. */
function sourceUrlCell(src: SourceRow['source']): CellValue {
    return urlCell(sourceOnline(src)?.text ?? src.url);
}

/** Read by the research (§14.2): one dot per reader of the transcript, "2 readers"; else "no" (counted as empty). */
function readersCell(row: TableRow): CellValue {
    const src = asSource(row).source;
    const n = sourceReaders(src);
    const s = strings.table;
    if (!n || !src.readBy) return { ...EMPTY, text: s.no, sortKey: 0 };
    return {
        ...EMPTY, text: s.readers(n), sortKey: n, empty: false,
        dots: [true, n > 1], title: strings.sources.readBy[src.readBy],
    };
}

export const SOURCE_COLUMNS: readonly ColumnDef[] = cols('sources', [
    { id: 'srcTitle', group: 'source', label: 'srcTitle', width: 280, get: (_c, r) => textCell(asSource(r).source.title) },
    { id: 'srcResearchId', group: 'source', label: 'researchId', width: 110, fromResearch: true, get: (c, r) => c.research ? sourceResearchIdCell(asSource(r).source) : emptyCell() },
    { id: 'srcRepo', group: 'source', label: 'srcRepo', width: 200, get: (_c, r) => textCell(asSource(r).source.repository) },
    // Where the entry stands (spec 075 U3 §3): call number, folio, image, then the other location (an older source: its whole location).
    // The image's id is srcImageNo: srcImage is the research's column of where the scan is, kept for saved views.
    { id: 'srcSig', group: 'source', label: 'srcSig', width: 120, get: (_c, r) => textCell(asSource(r).source.callNumber) },
    { id: 'srcFolio', group: 'source', label: 'srcFolio', width: 120, get: (_c, r) => textCell(asSource(r).source.folio) },
    { id: 'srcImageNo', group: 'source', label: 'srcImageNo', width: 80, get: (_c, r) => textCell(asSource(r).source.image) },
    { id: 'srcRef', group: 'source', label: 'srcRef', width: 170, get: (_c, r) => textCell(asSource(r).source.reference) },
    { id: 'srcUrl', group: 'source', label: 'srcUrl', width: 230, kind: 'link', get: (_c, r) => sourceUrlCell(asSource(r).source) },
    { id: 'srcPersons', group: 'use', label: 'srcPersons', width: 90, kind: 'number', computed: true, get: (_c, r) => numberCell(asSource(r).persons) },
    { id: 'srcFacts', group: 'use', label: 'srcFacts', width: 90, kind: 'number', computed: true, get: (_c, r) => numberCell(asSource(r).facts) },
    { id: 'srcRead', group: 'use', label: 'srcRead', width: 160, get: (_c, r) => readersCell(r) },
    { id: 'srcTranscript', group: 'use', label: 'srcTranscript', width: 90, get: (_c, r) => yesNo(!!asSource(r).source.transcript?.trim()) },
    { id: 'srcRecDate', group: 'use', label: 'srcRecDate', width: 130, kind: 'date', get: (c, r) => dateCell(c, asSource(r).source.recordDate) },
    // Research (16zm): only in a research tree
    { id: 'srcImage', group: 'research', label: 'srcImage', width: 250, get: (c, r) => c.research ? sourceImageCell(asSource(r).source) : emptyCell() },
]);

const BY_TYPE: Record<RowType, ReadonlyMap<string, ColumnDef>> = {
    persons: new Map(PERSON_COLUMNS.map(c => [c.id, c])),
    unions: new Map(UNION_COLUMNS.map(c => [c.id, c])),
    events: new Map(EVENT_COLUMNS.map(c => [c.id, c])),
    sources: new Map(SOURCE_COLUMNS.map(c => [c.id, c])),
};

/** The research columns the tree on screen offers, per row type (§16.1; none without research). */
let offer: Record<RowType, ReadonlySet<string>> = { persons: new Set(), unions: new Set(), events: new Set(), sources: new Set() };

/** Set what the tree on screen offers of the research columns (the view, before it reads its state). */
export function setResearchOffer(next: Partial<Record<RowType, Iterable<string>>>): void {
    offer = {
        persons: new Set(next.persons ?? []), unions: new Set(next.unions ?? []),
        events: new Set(next.events ?? []), sources: new Set(next.sources ?? []),
    };
}

/** Whether the tree on screen offers a column (§16.1: a research column only in a research tree that has it). */
export function columnOffered(col: ColumnDef): boolean {
    return !col.fromResearch || offer[col.rowType].has(col.id);
}

export function columnsOf(type: RowType): readonly ColumnDef[] {
    return type === 'persons' ? PERSON_COLUMNS : type === 'unions' ? UNION_COLUMNS : type === 'events' ? EVENT_COLUMNS : SOURCE_COLUMNS;
}

export function columnById(type: RowType, id: string): ColumnDef | undefined {
    return BY_TYPE[type].get(id);
}

export function columnLabel(col: ColumnDef): string {
    return strings.table.col[col.label];
}

/**
 * The sentence under a computed column's name in its header menu (§4.6,
 * "Computed from …"; part B fills it with §5's `table.computedFrom`). Empty
 * for a column that is not computed.
 */
export function columnNote(col: ColumnDef): string {
    if (!col.computed) return '';
    const s = strings.table;
    const what = noteWhat(col);
    return what ? s.computedFrom(what) : '';
}

/** What a computed column is computed from (§5.1, `table.computedFrom`). */
function noteWhat(col: ColumnDef): string {
    const s = strings.table;
    const f = s.from;
    switch (col.id) {
        case 'bComp': return s.compList.birth;
        case 'dComp': return s.compList.death;
        case 'uComp': return s.compList.union;
        case 'comp': return s.compList.all;
        case 'age1': case 'age2': return f.pAge;
        case 'srcCount': return col.rowType === 'unions' ? f.uSrcCount : f.srcCount;
        case 'relN': case 'relB': case 'relD': case 'relW': case 'evRel': return f.rel;
        case 'nFind': case 'topSev': case 'unusual': return f.checks;
    }
    return (f as Record<string, string>)[col.id] ?? '';
}

/**
 * A cell as plain text (search, CSV, width fitting): the substitute's label
 * and a date's qualifier word in front of the value, further citations
 * as "(+2)" after it (§14.3, as the pill shows them); "–" for a cell the
 * column does not apply to.
 */
export function cellPlainText(value: CellValue): string {
    if (value.na && !value.text) return '–';
    const s = strings.table.subst;
    const more = value.moreSources?.length ? `(+${value.moreSources.length})` : '';
    const parts = [value.subst === 'bap' ? s.bapShort : value.subst === 'bur' ? s.burShort : '', value.prefix ?? '', value.text, more];
    return parts.filter(Boolean).join(' ');
}

export function groupLabel(group: ColumnGroup): string {
    return strings.table.group[group];
}

/** One column's sort direction. */
export interface SortSpec { col: string; dir: 'asc' | 'desc' }

/** A row type's default view (built-in *Overview* for people, *Marriages* for unions; §4.2, §2b). */
export interface DefaultView {
    columns: string[];
    widths: Record<string, number>;
    /** Number of leading columns pinned to the left. */
    pinned: number;
    sort: SortSpec[];
}

export const DEFAULT_VIEWS: Record<RowType, DefaultView> = {
    persons: {
        columns: ['name', 'bDate', 'bPlace', 'dDate', 'dAge', 'partner', 'wDate', 'wAge', 'nFind', 'comp'],
        widths: { name: 250, bDate: 130, bPlace: 200, dDate: 130, dAge: 90, partner: 190, wDate: 120, wAge: 90, nFind: 84, comp: 120 },
        pinned: 1,
        sort: [{ col: 'bDate', dir: 'asc' }],
    },
    unions: {
        columns: ['p1', 'p2', 'wDate', 'wPlace', 'age1', 'rec1', 'age2', 'rec2', 'uStatus', 'witnesses', 'divDate', 'uKids', 'uLen', 'srcCount', 'uComp'],
        widths: {},
        pinned: 2,
        sort: [{ col: 'wDate', dir: 'asc' }],
    },
    events: {
        columns: ['evType', 'evWho', 'evDate', 'evPlace', 'evAge', 'godparents', 'witnesses', 'officiants', 'evSource'],
        widths: { evType: 120, evWho: 210, evDate: 110, evPlace: 210, evAge: 110, godparents: 250, witnesses: 170, officiants: 170, evSource: 300 },
        pinned: 2,
        sort: [{ col: 'evDate', dir: 'asc' }],
    },
    sources: {
        columns: ['srcTitle', 'srcRepo', 'srcSig', 'srcFolio', 'srcImageNo', 'srcRef', 'srcUrl', 'srcPersons', 'srcFacts'],
        widths: {},
        pinned: 1,
        sort: [{ col: 'srcTitle', dir: 'asc' }],
    },
};

/**
 * The least phone width of a column kind: the longest date ("28. 12. 1888")
 * or age range ("15–16") whole beside a finding's mark (16 px + 6 px gap and
 * the cell's 2 × 10 px padding).
 */
const PHONE_MIN_WIDTH: Partial<Record<ColumnKind, number>> = { date: 124, age: 92 };

/** The phone width of Line and Sync at most: right after the pinned name they end inside a 390 px screen. */
const PHONE_LINE_WIDTH = 222;

/** Phone (≤ 640): the name column pinned at 156 px, the others at 0.8 of their width (min 70, a date or age more; §1.4). */
export function phoneWidth(col: ColumnDef, width: number, pinned: boolean): number {
    if (pinned && (col.id === 'name' || col.id === 'p1' || col.id === 'srcTitle')) return 156;
    if (pinned && col.id === 'evType') return 96;
    if (pinned && col.id === 'evWho') return 140;
    // Research: 96 in the group; widened (the Research view, sorted and filtered by it) its head keeps its name (de 135 px).
    if (col.id === 'rSum') return width > 100 ? 136 : 96;
    // The Line and Exchange views put Line or Sync right after the pinned name: both whole on a 390 px phone (156 + 222 + a 12 px edge).
    if (col.id === 'rLine' || col.id === 'rSync') return Math.min(PHONE_LINE_WIDTH, Math.round(width * 0.8));
    return Math.max(PHONE_MIN_WIDTH[col.kind] ?? 70, Math.round(width * 0.8));
}

/**
 * One cell of a row. A union-scoped People column reads the row's union
 * `unionIndex` (the main row: the first one; §3 sub-rows: their own); a
 * person without unions gets "does not apply". Cached per row until the
 * model is rebuilt.
 */
export function cellOf(model: TableModel, row: TableRow, col: ColumnDef, unionIndex?: number): CellValue {
    const scoped = row.kind === 'person' && col.unionScoped;
    const idx = scoped ? (unionIndex ?? 0) : 0;
    const key = scoped && idx > 0 ? `${col.id}#${idx}` : col.id;
    const hit = row.cache.get(key);
    if (hit) return hit;
    let value: CellValue;
    if (scoped) {
        const u = (row as PersonRow).unions[idx] ?? null;
        value = u ? col.get(model.ctx, row, u) : naCell('', col.computed);
    } else value = col.get(model.ctx, row, null);
    row.cache.set(key, value);
    return value;
}
