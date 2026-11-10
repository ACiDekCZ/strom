/**
 * Table view (spec 073 §4.1): the column catalog.
 *
 * Every column of both row types with its group, label key, kind, width and
 * the function that computes its cell. A computed column (ages, counts,
 * completeness) is marked `computed`; a column of the Unions and Divorce
 * groups is `unionScoped` (in the People table it reads one union of the row:
 * the main row reads the first, the union sub-rows each their own — §3).
 */

import type { LifeEvent, LifeEventType, Partnership, Person, PersonId } from '../../types.js';
import { parentSlots, partnershipSourceIds, personSourceIds } from '../../types.js';
import { ageRangeBetween, approxAgeBetween, flexDateParts, parseFlexDate, type DateQualifier } from '../../dates.js';
import { recordedAgeGap } from '../../recorded-age.js';
import { shownNameOrEmpty } from '../../person-name.js';
import { findRelationship } from '../../kinship.js';
import { rodOf, siblingsOf, sortByBirth } from '../../lineage.js';
import { sortLifeEvents, eventValueIsOnTag } from '../../events.js';
import { factReliability, type ReliabilityStepName } from '../../reliability.js';
import { strings, type StringsType } from '../../strings.js';
import { dateNumber, type CellValue, type PersonRow, type RowType, type TableContext, type TableModel, type TableRow, type UnionRow } from './table-model.js';

export type ColumnKind = 'text' | 'date' | 'age' | 'number' | 'percent' | 'pill' | 'link';

/** Column groups in their order (People first, then the Unions table's own). */
export const PERSON_GROUPS = ['person', 'birth', 'parents', 'union', 'divorce', 'death', 'events', 'sources', 'rel', 'checks'] as const;
export const UNION_GROUPS = ['pair', 'wed', 'divorce', 'uextra'] as const;
export type ColumnGroup = typeof PERSON_GROUPS[number] | typeof UNION_GROUPS[number];

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
    return { ...EMPTY, text, sortKey: key, empty: false };
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
    return [['wDate', !!u.startDate], ['wPlace', !!u.startPlace?.trim()], ['partner', !!partner], ['wSrc', (u.sourceIds?.length ?? 0) > 0]];
}

function unionComp(u: Partnership, partner: Person | null): CellValue {
    return compCell(oneUnionFields(u, partner), 'uComp', 'union');
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

function reliabilityText(step: ReliabilityStepName): string {
    const r = strings.reliability;
    if (step === 'human') return r.human;
    if (step === 'proven') return r.proven;
    if (step === 'import') return r.import;
    if (step === 'none') return r.none;
    return strings.factStatus[step];
}

const RELIABILITY_RANK: Record<string, number> = { human: 0, proven: 1, probable: 2, possible: 3, import: 4, lead: 5, none: 6 };

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

// ---------------------------------------------------------------------------
// The catalog

type Def = Omit<ColumnDef, 'rowType' | 'computed' | 'unionScoped' | 'phase' | 'align' | 'kind'> & Partial<Pick<ColumnDef, 'computed' | 'unionScoped' | 'kind' | 'align'>>;

function cols(rowType: RowType, defs: Def[]): ColumnDef[] {
    return defs.map(d => {
        const kind = d.kind ?? 'text';
        const numeric = kind === 'age' || kind === 'number' || kind === 'percent';
        return {
            computed: false, phase: 1 as const, ...d, rowType, kind,
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
    {
        id: 'researchId', group: 'person', label: 'researchId', width: 110, get: (_c, r) => {
            const ref = asPerson(r).refn?.trim();
            return textCell(ref && /^P\d{1,7}$/.test(ref) ? ref : '');
        },
    },
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
    { id: 'wDate', group: 'union', label: 'wDate', width: 120, kind: 'date', get: inUnion((c, _r, u) => dateCell(c, u.startDate)) },
    { id: 'wPlace', group: 'union', label: 'wPlace', width: 200, get: inUnion((_c, _r, u) => textCell(u.startPlace)) },
    { id: 'wAge', group: 'union', label: 'wAge', width: 96, kind: 'age', computed: true, get: inUnion((_c, r, u) => ageAt(r.person, u.startDate), true) },
    { id: 'wAgeRec', group: 'union', label: 'wAgeRec', width: 104, get: inUnion((_c, r, u) => textCell(u.ages?.[r.id])) },
    { id: 'wAgeDiff', group: 'union', label: 'wAgeDiff', width: 104, kind: 'number', computed: true, get: inUnion((_c, r, u) => gapCell(u.ages?.[r.id], r.person.birthDate, u.startDate), true) },
    { id: 'pAge', group: 'union', label: 'pAge', width: 104, kind: 'age', computed: true, get: inUnion((c, r, u) => ageAt(otherPartner(c, u, r.id), u.startDate), true) },
    {
        id: 'pAgeRec', group: 'union', label: 'pAgeRec', width: 104, get: inUnion((c, r, u) => {
            const other = otherPartner(c, u, r.id);
            return other ? textCell(u.ages?.[other.id]) : emptyCell();
        }),
    },
    {
        id: 'pAgeDiff', group: 'union', label: 'pAgeDiff', width: 104, kind: 'number', computed: true, get: inUnion((c, r, u) => {
            const other = otherPartner(c, u, r.id);
            return other ? gapCell(u.ages?.[other.id], other.birthDate, u.startDate) : emptyCell(true);
        }, true),
    },
    { id: 'uStatus', group: 'union', label: 'uStatus', width: 120, get: inUnion((_c, _r, u) => textCell(strings.partnershipStatus[u.status])) },
    { id: 'witnesses', group: 'union', label: 'witnesses', width: 230, get: inUnion((c, _r, u) => witnessNames(c, u)) },
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
    // Reliability and research
    { id: 'relN', group: 'rel', label: 'relN', width: 150, kind: 'pill', computed: true, get: (c, r) => pillCell(c, asPerson(r), 'name') },
    { id: 'relB', group: 'rel', label: 'relB', width: 150, kind: 'pill', computed: true, get: (c, r) => pillCell(c, asPerson(r), 'birth') },
    { id: 'relD', group: 'rel', label: 'relD', width: 150, kind: 'pill', computed: true, get: (c, r) => c.living(asPerson(r)) ? naCell('', true) : pillCell(c, asPerson(r), 'death') },
    { id: 'relW', group: 'rel', label: 'relW', width: 150, kind: 'pill', computed: true, unionScoped: true, get: (c, _r, u) => pillCell(c, u, 'marriage') },
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
    // Checks (filled by §7)
    { id: 'nFind', group: 'checks', label: 'nFind', width: 92, kind: 'number', computed: true, get: () => emptyCell(true) },
    { id: 'topSev', group: 'checks', label: 'topSev', width: 130, computed: true, get: () => emptyCell(true) },
    { id: 'unusual', group: 'checks', label: 'unusual', width: 130, computed: true, get: () => emptyCell(true) },
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

export const UNION_COLUMNS: readonly ColumnDef[] = cols('unions', [
    { id: 'p1', group: 'pair', label: 'p1', width: 220, get: (c, r) => nameOf(unionPartners(c, asUnion(r)).p1) },
    { id: 'p2', group: 'pair', label: 'p2', width: 220, get: (c, r) => nameOf(unionPartners(c, asUnion(r)).p2) },
    { id: 'wDate', group: 'wed', label: 'wDate', width: 124, kind: 'date', get: (c, r) => dateCell(c, asUnion(r).union.startDate) },
    { id: 'wPlace', group: 'wed', label: 'wPlace', width: 210, get: (_c, r) => textCell(asUnion(r).union.startPlace) },
    { id: 'age1', group: 'wed', label: 'age1', width: 92, kind: 'age', computed: true, get: (c, r) => partnerAge(c, r, 1) },
    { id: 'rec1', group: 'wed', label: 'rec1', width: 100, get: (c, r) => partnerRec(c, r, 1) },
    { id: 'age2', group: 'wed', label: 'age2', width: 92, kind: 'age', computed: true, get: (c, r) => partnerAge(c, r, 2) },
    { id: 'rec2', group: 'wed', label: 'rec2', width: 100, get: (c, r) => partnerRec(c, r, 2) },
    { id: 'uStatus', group: 'wed', label: 'uStatus', width: 116, get: (_c, r) => textCell(strings.partnershipStatus[asUnion(r).union.status]) },
    { id: 'witnesses', group: 'wed', label: 'witnesses', width: 220, get: (c, r) => witnessNames(c, asUnion(r).union) },
    { id: 'relW', group: 'wed', label: 'relW', width: 150, kind: 'pill', computed: true, get: (c, r) => pillCell(c, asUnion(r).union, 'marriage') },
    { id: 'div', group: 'divorce', label: 'div', width: 88, computed: true, get: (_c, r) => yesNo(asUnion(r).union.status === 'divorced' || !!asUnion(r).union.endDate) },
    { id: 'divDate', group: 'divorce', label: 'divDate', width: 120, kind: 'date', get: (c, r) => dateCell(c, asUnion(r).union.endDate) },
    { id: 'divPlace', group: 'divorce', label: 'divPlace', width: 180, get: (_c, r) => textCell(asUnion(r).union.endPlace) },
    { id: 'uKids', group: 'uextra', label: 'uKids', width: 88, kind: 'number', computed: true, get: (_c, r) => numberCell(asUnion(r).union.childIds.length) },
    { id: 'uLen', group: 'uextra', label: 'uLen', width: 96, kind: 'age', computed: true, get: (c, r) => unionLength(c, asUnion(r).union) },
    { id: 'srcCount', group: 'uextra', label: 'srcCount', width: 92, kind: 'number', computed: true, get: (_c, r) => numberCell(partnershipSourceIds(asUnion(r).union).length) },
    { id: 'uComp', group: 'uextra', label: 'uComp', width: 124, kind: 'percent', computed: true, get: (c, r) => unionComp(asUnion(r).union, unionPartners(c, asUnion(r)).p2) },
]);

const BY_TYPE: Record<RowType, ReadonlyMap<string, ColumnDef>> = {
    persons: new Map(PERSON_COLUMNS.map(c => [c.id, c])),
    unions: new Map(UNION_COLUMNS.map(c => [c.id, c])),
};

export function columnsOf(type: RowType): readonly ColumnDef[] {
    return type === 'persons' ? PERSON_COLUMNS : UNION_COLUMNS;
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
        case 'relN': case 'relB': case 'relD': case 'relW': return f.rel;
        case 'nFind': case 'topSev': case 'unusual': return f.checks;
    }
    return (f as Record<string, string>)[col.id] ?? '';
}

/**
 * A cell as plain text (search, CSV, width fitting): the substitute's label
 * and a date's qualifier word in front of the value; "–" for a cell the
 * column does not apply to.
 */
export function cellPlainText(value: CellValue): string {
    if (value.na && !value.text) return '–';
    const s = strings.table.subst;
    const parts = [value.subst === 'bap' ? s.bapShort : value.subst === 'bur' ? s.burShort : '', value.prefix ?? '', value.text];
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
};

/** Phone (≤ 640): the name column pinned at 156 px, the others at 0.8 of their width (min 70; §1.4). */
export function phoneWidth(col: ColumnDef, width: number, pinned: boolean): number {
    if (pinned && (col.id === 'name' || col.id === 'p1')) return 156;
    return Math.max(70, Math.round(width * 0.8));
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
