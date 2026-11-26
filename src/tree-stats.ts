/**
 * Tree statistics (spec 138): the full frequency table of one topic over the
 * people of a scope, as pure functions over StromData (no DOM, no settings).
 * The Statistics window (src/ui/tree-stats-ui.ts) calls them topic by topic.
 *
 * Shared rules:
 * - Placeholders ("unknown parent" frames) never count and are never listed
 *   (K1.6), neither as people nor as partners or children of a couple.
 * - A topic counts units: people, couples (children per couple) or marriages
 *   (places of marriage). A couple or a marriage is in the scope when at least
 *   one of its real partners is; a click shows both partners.
 * - Every value of the topic is listed (no top N); only values somebody has.
 *   A unit without a value is "Not given" (`none`, `noneCount`).
 * - The share of a value is `count / known`: of the units with a value.
 * - Labels that need words (age groups, months, "no district known") come
 *   from `StatsContext.labels`; without them a neutral form is written.
 */

import type { CoupleEventType, Partnership, Person, PersonId, PlaceRecord, StromData } from './types.js';
import type { LineageIndex } from './lineage.js';
import { directLineIds } from './search-scope.js';
import { selectionPersonIds, type SelectionRef } from './view-selection.js';
import { parseFlexDate, ageBetween, ageRangeBetween, yearOf } from './dates.js';
import { ageBirthDate } from './recorded-age.js';
import { birthYearOf, deathAgeOf, deathDateOf } from './tree-overview.js';
import { feminineFormIn, isGapOnlyName, surnameKey, withSurnameRules } from './surnames.js';
import { knownStreets, placeKey, townOfPlace } from './places.js';
import { collectHouses, houseTitle, livedAtHouse, type TreeHouse } from './houses.js';
import { placeAliasMap, placeRecordOf, variantGroupKey, type PlaceGroupContext } from './place-groups.js';
import type { BridgePlaces } from './places-bridge.js';
import type { KnownStreets } from './streets.js';
import { foldText } from './ui/table-view/table-filter.js';
import { tableCsvField } from './ui/table-view/table-export.js';

// ==================== types (§0.2) ====================

export type StatsTopic = 'firstNames' | 'surnames' | 'birthPlaces' | 'deathPlaces' | 'marriagePlaces'
    | 'occupations' | 'religions' | 'deathAge' | 'firstMarriageAge' | 'firstChildAge' | 'childrenPerCouple' | 'births' | 'houses';

export type StatsGroupId = 'names' | 'places' | 'life' | 'time';

export const STATS_GROUPS: readonly { id: StatsGroupId; topics: readonly StatsTopic[] }[] = [
    { id: 'names', topics: ['firstNames', 'surnames'] },
    { id: 'places', topics: ['birthPlaces', 'deathPlaces', 'marriagePlaces', 'houses'] },
    { id: 'life', topics: ['occupations', 'religions', 'deathAge', 'firstMarriageAge', 'firstChildAge', 'childrenPerCouple'] },
    { id: 'time', topics: ['births'] },
];

/**
 * The groups and topics of a tree: Houses (spec 030 §15) only in a tree with
 * a house (a fact with a house number); the others always.
 */
export function statsGroupsOf(data: StromData, ctx: StatsContext): { id: StatsGroupId; topics: readonly StatsTopic[] }[] {
    const houses = (ctx.houses ??= collectHouses(data)).length > 0;
    return STATS_GROUPS.map(g => houses ? g : { id: g.id, topics: g.topics.filter(t => t !== 'houses') });
}

/** Every topic in the order of the groups. */
export const STATS_TOPICS: readonly StatsTopic[] = STATS_GROUPS.flatMap(g => g.topics);

export interface StatsOptions {
    /** First names (§3): whose names. */
    sex: 'male' | 'female' | 'unknown';
    /** §5: the first given name only, or every given name. */
    names: 'first' | 'each';
    /** §3, spec 010: birth surnames, or a married woman under her married surname too. */
    surnames: 'birth' | 'withMarried';
    /** §6: only with a hierarchy of places (`StatsTable.hasLevels`). */
    level: 'town' | 'district' | 'country';
    /** §3: births by decade or by month. */
    births: 'decade' | 'month';
}

/** A new window's options (§0.3). */
export const DEFAULT_STATS_OPTIONS: Readonly<StatsOptions> = {
    sex: 'male', names: 'first', surnames: 'birth', level: 'town', births: 'decade',
};

/** 'value' only for topics of ordered groups (age, decade, month, number of children). */
export type StatsSort = 'count' | 'name' | 'value';

/**
 * The statistics' scope: a window selection or a person's direct line (the
 * person, all their ancestors and all their descendants). Kept apart from
 * SelectionRef, which has no direct line.
 */
export type StatsScopeRef = SelectionRef | { kind: 'direct'; personId: PersonId };

export interface StatsScope {
    /** null = the whole tree. */
    ref: StatsScopeRef | null;
    /** Birth year (birthYearOf: the birth, else the baptism), both inclusive; either may be missing. */
    from?: number;
    to?: number;
}

export interface StatsRow {
    /** The value's key (place group, surname key, lowercased name, "30", "1870"…). */
    key: string;
    /** The value as shown. */
    label: string;
    /** A surname's form of the other sex ("Ostrožná"): "also Ostrožná". */
    alt?: string;
    /** A unified place's spellings in the counted facts, most used first (≥ 2: "4 spellings"). */
    forms?: string[];
    /** The order by value (age, year, month, number of children); otherwise 0. */
    order: number;
    /** People (couples for children per couple, marriages for places of marriage). */
    count: number;
    /** The people a click shows (both partners of a couple or marriage). */
    ids: PersonId[];
    /** "No district known" / "no country known" (§6): shown dimmed, always last. */
    muted?: boolean;
}

export interface StatsTable {
    topic: StatsTopic;
    rows: StatsRow[];
    /** "Not given": the people without a value (both partners of a couple or marriage without one). */
    none: PersonId[];
    /** Units without a value: the count of the "Not given" row (= units − known). */
    noneCount: number;
    /** Total: people, couples or marriages in the scope, "Not given" included. */
    units: number;
    /** Units with a value: the base of the share. */
    known: number;
    /** The sum of the rows' counts (more than `known` with every name, occupations, married surnames). */
    occurrences: number;
    /** §6: the level choice applies (a hierarchy of places and a place of the topic with a record). */
    hasLevels: boolean;
    /** Houses (spec 030 §15): the house one family held longest, and how many houses with history somebody married into. */
    houses?: HouseStats;
}

export interface HouseStats {
    longest?: { id: string; title: string; years: number };
    marriedIn: { houses: number; of: number };
}

/** Words for values of ordered groups and of the level (§3, §6); the window passes them in the app's language. */
export interface StatsValueLabels {
    ageGroup(from: number, to: number): string;
    ageTop(from: number): string;
    decade(from: number): string;
    /** 1–12. */
    month(m: number): string;
    children(n: number): string;
    childrenTop: string;
    noDistrict: string;
    noCountry: string;
}

export interface StatsContext {
    placeGroups: PlaceGroupContext;
    known?: KnownStreets;
    /** The tree has place records of the research (§6). */
    hasHierarchy: boolean;
    /** The language for lowercasing names and comparing labels (default: the runtime's). */
    lang?: string;
    labels?: StatsValueLabels;
    /** The tree's houses, read at the first table of houses. */
    houses?: TreeHouse[];
}

/** The context of a tree: its place groups, streets and whether it has a hierarchy of places. */
export function statsContext(data: StromData, opts: { live?: BridgePlaces | null; lang?: string; labels?: StatsValueLabels } = {}): StatsContext {
    const known = knownStreets(data);
    const hasHierarchy = Object.keys(data.placeRecords ?? {}).length > 0 || Object.keys(opts.live?.places ?? {}).length > 0;
    return {
        placeGroups: { data, live: opts.live ?? null, aliases: placeAliasMap(data), known },
        known, hasHierarchy,
        ...(opts.lang ? { lang: opts.lang } : {}),
        ...(opts.labels ? { labels: opts.labels } : {}),
    };
}

/** Topics whose values are ordered groups: sorted by value by default, "A–Z" not offered. */
const VALUE_TOPICS: ReadonlySet<StatsTopic> = new Set<StatsTopic>(['deathAge', 'firstMarriageAge', 'firstChildAge', 'childrenPerCouple', 'births']);

/** Whether a topic's values are ordered groups (sort by value instead of A–Z). */
export function isValueTopic(topic: StatsTopic): boolean {
    return VALUE_TOPICS.has(topic);
}

export function defaultSort(topic: StatsTopic, _opts: StatsOptions): StatsSort {
    return VALUE_TOPICS.has(topic) ? 'value' : 'count';
}

// ==================== scope (§7) ====================

const realPerson = (data: StromData, id: PersonId): Person | null => {
    const p = data.persons[id];
    return p && !p.isPlaceholder ? p : null;
};

/**
 * The real people of a scope, and — with a period — how many of the scope
 * have no birth year (they fall out of the period). A gone selection is empty.
 */
export function scopePersonIds(data: StromData, index: LineageIndex, scope: StatsScope): { ids: PersonId[]; noYear: number } {
    let base: Iterable<PersonId>;
    const ref = scope.ref;
    if (!ref) base = Object.keys(data.persons) as PersonId[];
    else if (ref.kind === 'direct') base = realPerson(data, ref.personId) ? directLineIds(index, ref.personId) : [];
    else base = selectionPersonIds(data, index, ref) ?? [];
    const period = scope.from !== undefined || scope.to !== undefined;
    const ids: PersonId[] = [];
    let noYear = 0;
    for (const id of base) {
        const p = realPerson(data, id);
        if (!p) continue;
        if (period) {
            const y = birthYearOf(p)?.year;
            if (y === undefined) { noYear++; continue; }
            if (scope.from !== undefined && y < scope.from) continue;
            if (scope.to !== undefined && y > scope.to) continue;
        }
        ids.push(id);
    }
    return { ids, noYear };
}

/** People of a scope by sex (the counts of the Sex choice, §5). */
export function sexCounts(data: StromData, ids: readonly PersonId[]): Record<StatsOptions['sex'], number> {
    const out = { male: 0, female: 0, unknown: 0 };
    for (const id of ids) {
        const p = realPerson(data, id);
        if (p) out[sexOf(p)]++;
    }
    return out;
}

const sexOf = (p: Person): StatsOptions['sex'] => (p.gender === 'male' || p.gender === 'female' ? p.gender : 'unknown');

// ==================== the tally ====================

interface Bucket {
    label: string;
    order: number;
    /** Label candidates and how often each was seen (the most used one is shown). */
    spellings: Map<string, number>;
    /** Raw spellings of a place, with counts. */
    forms?: Map<string, number>;
    alt?: string;
    count: number;
    ids: PersonId[];
    idSet: Set<PersonId>;
    muted?: boolean;
}

/** Counts units per value; a unit counts once per value however often it has it. */
class Tally {
    readonly buckets = new Map<string, Bucket>();
    readonly none: PersonId[] = [];
    private readonly noneSet = new Set<PersonId>();
    noneCount = 0;
    units = 0;
    known = 0;

    add(key: string, spelling: string, ids: readonly PersonId[], extra: { order?: number; form?: string; muted?: boolean } = {}): void {
        let b = this.buckets.get(key);
        if (!b) {
            b = { label: spelling, order: extra.order ?? 0, spellings: new Map(), count: 0, ids: [], idSet: new Set(), ...(extra.muted ? { muted: true } : {}) };
            this.buckets.set(key, b);
        }
        b.spellings.set(spelling, (b.spellings.get(spelling) ?? 0) + 1);
        if (extra.form !== undefined) {
            b.forms ??= new Map();
            b.forms.set(extra.form, (b.forms.get(extra.form) ?? 0) + 1);
        }
        b.count++;
        for (const id of ids) {
            if (b.idSet.has(id)) continue;
            b.idSet.add(id);
            b.ids.push(id);
        }
    }

    addNone(ids: readonly PersonId[]): void {
        this.noneCount++;
        for (const id of ids) {
            if (this.noneSet.has(id)) continue;
            this.noneSet.add(id);
            this.none.push(id);
        }
    }

    table(topic: StatsTopic, hasLevels = false, label?: (key: string, b: Bucket) => string): StatsTable {
        const rows: StatsRow[] = [];
        let occurrences = 0;
        for (const [key, b] of this.buckets) {
            occurrences += b.count;
            const row: StatsRow = { key, label: label ? label(key, b) : mostUsed(b.spellings), order: b.order, count: b.count, ids: b.ids };
            if (b.alt) row.alt = b.alt;
            if (b.forms) row.forms = [...b.forms.entries()].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0])).map(([f]) => f);
            if (b.muted) row.muted = true;
            rows.push(row);
        }
        return {
            topic, rows: sortRows(rows, 'count', undefined), none: this.none, noneCount: this.noneCount,
            units: this.units, known: this.known, occurrences, hasLevels,
        };
    }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The most used spelling; a tie to the first alphabetically. */
function mostUsed(spellings: ReadonlyMap<string, number>): string {
    let best = '';
    let n = -1;
    for (const [s, c] of spellings) {
        if (c > n || (c === n && s.localeCompare(best) < 0)) { best = s; n = c; }
    }
    return best;
}

// ==================== names (§5) and surnames (§3) ====================

/** A given name's words: split on white space, quotes around a word and a trailing comma dropped; a hyphenated name stays one word. */
function nameWords(text: string | undefined): string[] {
    return (text ?? '').trim().split(/\s+/)
        .map(w => w.replace(/^["'„“”‚‘’«»]+|["'„“”‚‘’«»,;]+$/gu, ''))
        .filter(w => /\p{L}/u.test(w));
}

function firstNameRows(data: StromData, ids: readonly PersonId[], opts: StatsOptions, ctx: StatsContext): StatsTable {
    const t = new Tally();
    const lower = (s: string): string => s.toLocaleLowerCase(ctx.lang);
    for (const id of ids) {
        const p = realPerson(data, id);
        if (!p || sexOf(p) !== opts.sex) continue;
        t.units++;
        const words = nameWords(p.firstName);
        if (!words.length) { t.addNone([id]); continue; }
        t.known++;
        const counted = opts.names === 'first' ? [words[0]!] : words;
        const seen = new Set<string>();
        for (const w of counted) {
            const key = lower(w);
            if (seen.has(key)) continue;
            seen.add(key);
            t.add(key, w, [id]);
        }
    }
    return t.table('firstNames');
}

/**
 * Surnames by family: a masculine and a feminine form of one surname
 * (Ostrožný – Ostrožná, Novák – Nováková, by the tree's rules) count
 * together under the masculine form's key. Only forms the tree has join.
 */
function surnameRows(data: StromData, ids: readonly PersonId[], opts: StatsOptions): StatsTable {
    return withSurnameRules(data, () => {
        const t = new Tally();
        // Each written surname's family key: its masculine form's key when the feminine pair is in the tree.
        const familyOf = new Map<string, string>();
        const present = new Set<string>();
        const names: string[] = [];
        const usable = (s: string | undefined): string => {
            const v = (s ?? '').trim();
            return v && !isGapOnlyName(v) ? v : '';
        };
        for (const id of ids) {
            const p = realPerson(data, id);
            if (!p) continue;
            for (const s of [p.lastName, opts.surnames === 'withMarried' && p.gender === 'female' ? p.marriedSurname : undefined]) {
                const v = usable(s);
                if (v && !present.has(surnameKey(v))) { present.add(surnameKey(v)); names.push(v); }
            }
        }
        for (const n of names) {
            const k = surnameKey(n);
            if (!familyOf.has(k)) familyOf.set(k, k);
            const fem = feminineFormIn(n, data);
            const fk = fem ? surnameKey(fem) : '';
            if (fk && fk !== k && present.has(fk)) familyOf.set(fk, familyOf.get(k)!);
        }
        // Spellings per key within a family: the most used form is the label (a tie: the masculine one),
        // the other key's most used spelling the alt form.
        const keyForms = new Map<string, Map<string, Map<string, number>>>();
        for (const id of ids) {
            const p = realPerson(data, id);
            if (!p) continue;
            t.units++;
            const own = usable(p.lastName);
            const married = opts.surnames === 'withMarried' && p.gender === 'female' ? usable(p.marriedSurname) : '';
            const list = [own, married].filter(Boolean);
            if (!list.length) { t.addNone([id]); continue; }
            t.known++;
            const seen = new Set<string>();
            for (const s of list) {
                const k = surnameKey(s);
                const fam = familyOf.get(k) ?? k;
                if (seen.has(fam)) continue;
                seen.add(fam);
                t.add(fam, s, [id]);
                const byKey = keyForms.get(fam) ?? new Map<string, Map<string, number>>();
                const forms = byKey.get(k) ?? new Map<string, number>();
                forms.set(s, (forms.get(s) ?? 0) + 1);
                byKey.set(k, forms);
                keyForms.set(fam, byKey);
            }
        }
        for (const [fam, b] of t.buckets) {
            const byKey = keyForms.get(fam);
            if (!byKey || byKey.size < 2) continue;
            const totals = [...byKey.entries()]
                .map(([k, forms]) => ({ k, n: [...forms.values()].reduce((a, c) => a + c, 0), label: mostUsed(forms) }))
                .sort((a, x) => x.n - a.n || Number(x.k === fam) - Number(a.k === fam) || cmp(a.label, x.label));
            b.label = totals[0]!.label;
            b.alt = totals[1]!.label;
        }
        return t.table('surnames', false, (_k, b) => (b.alt ? b.label : mostUsed(b.spellings)));
    });
}

// ==================== places (§6) ====================

interface PlaceRead {
    /** The unified place's key. */
    key: string;
    /** The place's name to show: the record's today's name, else the town or the spelling. */
    name: string;
    /** As written in the fact. */
    form: string;
    rec: PlaceRecord | null;
}

const placeCache = new WeakMap<StatsContext, Map<string, PlaceRead | null>>();

/**
 * A place as one value: the place group's key (the research's record, a
 * rename that unites spellings), else its town (streets and house numbers
 * belong to the town), else its spelling's key.
 */
function readPlace(raw: string | undefined, ctx: StatsContext): PlaceRead | null {
    const form = (raw ?? '').trim();
    if (!form) return null;
    let cache = placeCache.get(ctx);
    if (!cache) { cache = new Map(); placeCache.set(ctx, cache); }
    if (cache.has(form)) return cache.get(form)!;
    const pg = ctx.placeGroups;
    let out: PlaceRead | null = null;
    const k = placeKey(form);
    if (k) {
        const town = townOfPlace(form, ctx.known ?? pg.known);
        const townKey = town ? placeKey(town.town) : '';
        const recOf = (key: string): PlaceRecord | null => (key ? placeRecordOf(key, pg) : null);
        const own = variantGroupKey(k, pg);
        if (own) {
            const rec = recOf(k) ?? (pg.aliases?.get(k) ? recOf(pg.aliases.get(k)!) : null);
            out = { key: `g:${own}`, name: rec?.names[0]?.name ?? form, form, rec };
        } else if (town && townKey && townKey !== k) {
            const g = variantGroupKey(townKey, pg);
            const rec = recOf(townKey) ?? (g && pg.aliases?.get(townKey) ? recOf(pg.aliases.get(townKey)!) : null);
            out = { key: `g:${g ?? townKey}`, name: rec?.names[0]?.name ?? town.town.trim(), form, rec };
        } else {
            out = { key: `g:${k}`, name: form, form, rec: null };
        }
    }
    cache.set(form, out);
    return out;
}

const MAX_PARENT_STEPS = 12;

function recordById(id: string, ctx: StatsContext): PlaceRecord | null {
    const pg = ctx.placeGroups;
    return pg.live?.places[id] ?? pg.data.placeRecords?.[id] ?? null;
}

/** The record and its parents, nearest first (a part of a town → the town → …). */
function recordChain(rec: PlaceRecord, ctx: StatsContext): PlaceRecord[] {
    const out = [rec];
    const seen = new Set([rec.id]);
    let cur = rec;
    for (let i = 0; i < MAX_PARENT_STEPS && cur.parent && !seen.has(cur.parent); i++) {
        const next = recordById(cur.parent, ctx);
        if (!next) break;
        seen.add(next.id);
        out.push(next);
        cur = next;
    }
    return out;
}

/** A jurisdiction of one of the kinds, valid in the year (no year: the first one). */
function jurisdictionIn(chain: readonly PlaceRecord[], kinds: readonly string[], year: number | null): string | null {
    for (const kind of kinds) {
        for (const rec of chain) {
            const list = (rec.jurisdictions ?? []).filter(j => j.kind === kind && j.name?.trim());
            if (!list.length) continue;
            const hit = year === null ? list[0]
                : list.find(j => (j.from === undefined || j.from <= year) && (j.to === undefined || year <= j.to));
            if (hit) return hit.name.trim();
        }
    }
    return null;
}

/** The value of a place at the level: the town, its district or its country (§6); muted when the record does not say. */
function placeAtLevel(place: PlaceRead, level: StatsOptions['level'], year: number | null, ctx: StatsContext): { key: string; name: string; muted?: boolean } {
    if (level === 'town') return { key: place.key, name: place.name };
    const chain = place.rec ? recordChain(place.rec, ctx) : [];
    if (level === 'district') {
        const d = chain.length ? jurisdictionIn(chain, ['district', 'civil'], year) : null;
        return d ? { key: `d:${placeKey(d)}`, name: d } : { key: '~noDistrict', name: ctx.labels?.noDistrict ?? '–', muted: true };
    }
    let c = chain.length ? jurisdictionIn(chain, ['state'], year) : null;
    if (!c && chain.length > 1) c = chain[chain.length - 1]!.names[0]?.name?.trim() || null;
    return c ? { key: `c:${placeKey(c)}`, name: c } : { key: '~noCountry', name: ctx.labels?.noCountry ?? '–', muted: true };
}

/** A person's place of birth (else the baptism's, the birth event's) or death (else the death event's, the burial's, the cremation's). */
function personPlace(p: Person, kind: 'birth' | 'death'): { place: string; year: number | null } | null {
    if (kind === 'birth') {
        const year = birthYearOf(p)?.year ?? null;
        if (p.birthPlace?.trim()) return { place: p.birthPlace, year };
        for (const type of ['birth', 'baptism']) {
            const e = p.events?.find(x => x.type === type && x.place?.trim());
            if (e) return { place: e.place!, year: yearOf(e.date) ?? year };
        }
        return null;
    }
    const year = yearOf(deathDateOf(p));
    if (p.deathPlace?.trim()) return { place: p.deathPlace, year };
    for (const type of ['death', 'burial', 'cremation']) {
        const e = p.events?.find(x => x.type === type && x.place?.trim());
        if (e) return { place: e.place!, year: yearOf(e.date) ?? year };
    }
    return null;
}

function personPlaceRows(data: StromData, ids: readonly PersonId[], kind: 'birth' | 'death', opts: StatsOptions, ctx: StatsContext): StatsTable {
    const reads: { id: PersonId; place: PlaceRead; year: number | null }[] = [];
    const t = new Tally();
    for (const id of ids) {
        const p = realPerson(data, id);
        if (!p) continue;
        t.units++;
        const f = personPlace(p, kind);
        const place = f ? readPlace(f.place, ctx) : null;
        if (!place) { t.addNone([id]); continue; }
        t.known++;
        reads.push({ id, place, year: f!.year });
    }
    const hasLevels = ctx.hasHierarchy && reads.some(r => r.place.rec);
    const level = hasLevels ? opts.level : 'town';
    for (const r of reads) {
        const v = placeAtLevel(r.place, level, r.year, ctx);
        t.add(v.key, v.name, [r.id], { form: r.place.form, ...(v.muted ? { muted: true } : {}) });
    }
    return t.table(kind === 'birth' ? 'birthPlaces' : 'deathPlaces', hasLevels, placeLabel);
}

/** A place row's label: the record's name or the town as read (the first spelling seen of the group). */
const placeLabel = (_key: string, b: Bucket): string => mostUsed(b.spellings);

const WEDDING_STEPS: ReadonlySet<string> = new Set<CoupleEventType>(
    ['engagement', 'banns', 'marriageLicence', 'marriageContract', 'marriageSettlement']);

/** A marriage: a married or divorced union, or one with a step to a wedding (banns, a contract…). */
function isMarriage(u: Partnership): boolean {
    return u.status === 'married' || u.status === 'divorced' || (u.events ?? []).some(e => WEDDING_STEPS.has(e.type));
}

/** The union's real partners. */
function realPartners(data: StromData, u: Partnership): PersonId[] {
    return [u.person1Id, u.person2Id].filter(id => !!realPerson(data, id));
}

/** The unions with at least one real partner in the scope. */
function unionsInScope(data: StromData, ids: readonly PersonId[]): Partnership[] {
    const inScope = new Set(ids);
    const out: Partnership[] = [];
    for (const u of Object.values(data.partnerships ?? {})) {
        if (realPartners(data, u).some(id => inScope.has(id))) out.push(u);
    }
    return out;
}

function marriagePlaceRows(data: StromData, ids: readonly PersonId[], opts: StatsOptions, ctx: StatsContext): StatsTable {
    const t = new Tally();
    const reads: { ids: PersonId[]; place: PlaceRead; year: number | null }[] = [];
    for (const u of unionsInScope(data, ids)) {
        if (!isMarriage(u)) continue;
        t.units++;
        const who = realPartners(data, u);
        let raw: string | undefined;
        let date: string | undefined;
        if ((u.status === 'married' || u.status === 'divorced') && u.startPlace?.trim()) { raw = u.startPlace; date = u.startDate; }
        else {
            const e = (u.events ?? []).find(x => WEDDING_STEPS.has(x.type) && x.place?.trim());
            if (e) { raw = e.place; date = e.date ?? u.startDate; }
        }
        const place = readPlace(raw, ctx);
        if (!place) { t.addNone(who); continue; }
        t.known++;
        reads.push({ ids: who, place, year: yearOf(date) });
    }
    const hasLevels = ctx.hasHierarchy && reads.some(r => r.place.rec);
    const level = hasLevels ? opts.level : 'town';
    for (const r of reads) {
        const v = placeAtLevel(r.place, level, r.year, ctx);
        t.add(v.key, v.name, r.ids, { form: r.place.form, ...(v.muted ? { muted: true } : {}) });
    }
    return t.table('marriagePlaces', hasLevels, placeLabel);
}

// ==================== occupations, religions ====================

function eventNoteRows(data: StromData, ids: readonly PersonId[], type: 'occupation' | 'religion'): StatsTable {
    const t = new Tally();
    for (const id of ids) {
        const p = realPerson(data, id);
        if (!p) continue;
        t.units++;
        const values = (p.events ?? []).filter(e => e.type === type).map(e => (e.note ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean);
        if (!values.length) { t.addNone([id]); continue; }
        t.known++;
        const seen = new Set<string>();
        for (const v of values) {
            const key = foldText(v);
            if (seen.has(key)) continue;
            seen.add(key);
            t.add(key, v, [id]);
        }
    }
    return t.table(type === 'occupation' ? 'occupations' : 'religions');
}

// ==================== ages (§3) ====================

/** Years per age group. */
export const AGE_GROUP_YEARS = 5;
/** The first age of the open top group ("100 and over"). */
export const AGE_TOP = 100;

/**
 * Whole years between two dates for a group: the lowest age the dates allow
 * (a range across a group's border falls into the lower group); an estimate
 * ("~1850") the plain difference; "before" / "after" dates say too little.
 */
function groupAge(birth: string | undefined, end: string | undefined): number | null {
    const b = parseFlexDate(birth);
    const e = parseFlexDate(end);
    if (!b || !e || b.qualifier === '<' || b.qualifier === '>' || e.qualifier === '<' || e.qualifier === '>') return null;
    const range = ageRangeBetween(birth, end);
    if (range) return range.min;
    return ageBetween(birth, end)?.years ?? null;
}

function addAge(t: Tally, id: PersonId, age: number | null, ctx: StatsContext): void {
    if (age === null || age < 0) { t.addNone([id]); return; }
    t.known++;
    const from = Math.min(Math.floor(age / AGE_GROUP_YEARS) * AGE_GROUP_YEARS, AGE_TOP);
    const label = from >= AGE_TOP
        ? (ctx.labels?.ageTop(AGE_TOP) ?? `${AGE_TOP}+`)
        : (ctx.labels?.ageGroup(from, from + AGE_GROUP_YEARS - 1) ?? `${from}–${from + AGE_GROUP_YEARS - 1}`);
    t.add(from >= AGE_TOP ? `${AGE_TOP}+` : `${from}-${from + AGE_GROUP_YEARS - 1}`, label, [id], { order: from });
}

function deathAgeRows(data: StromData, ids: readonly PersonId[], ctx: StatsContext): StatsTable {
    const t = new Tally();
    for (const id of ids) {
        const p = realPerson(data, id);
        if (!p) continue;
        t.units++;
        const age = deathAgeOf(p);
        let years: number | null = null;
        if (age) years = age.from === 'dates' ? (groupAge(ageBirthDate(p), deathDateOf(p)) ?? age.years) : age.years;
        addAge(t, id, years, ctx);
    }
    return t.table('deathAge');
}

/** First day a date allows, as a sortable number (yyyymmdd). */
function dateOrder(value: string | undefined): number | null {
    const d = parseFlexDate(value);
    if (!d) return null;
    return d.year * 10000 + (d.month ?? 1) * 100 + (d.day ?? 1);
}

/** The earliest of the dates (by the first day each allows). */
function earliest(dates: readonly (string | undefined)[]): string | undefined {
    let best: string | undefined;
    let bestN = Infinity;
    for (const d of dates) {
        const n = dateOrder(d);
        if (n !== null && n < bestN) { best = d; bestN = n; }
    }
    return best;
}

function firstMarriageAgeRows(data: StromData, ids: readonly PersonId[], ctx: StatsContext): StatsTable {
    const t = new Tally();
    for (const id of ids) {
        const p = realPerson(data, id);
        if (!p) continue;
        t.units++;
        const dates = p.partnerships.map(uid => data.partnerships[uid])
            .filter((u): u is Partnership => !!u && (u.status === 'married' || u.status === 'divorced'))
            .map(u => u.startDate);
        const wedding = earliest(dates);
        addAge(t, id, wedding ? groupAge(ageBirthDate(p), wedding) : null, ctx);
    }
    return t.table('firstMarriageAge');
}

const isBioChild = (child: Person, parentId: PersonId): boolean => {
    const r = child.parentRelTypes?.[parentId];
    return r === undefined || r === 'biological';
};

function firstChildAgeRows(data: StromData, ids: readonly PersonId[], ctx: StatsContext): StatsTable {
    const t = new Tally();
    for (const id of ids) {
        const p = realPerson(data, id);
        if (!p) continue;
        t.units++;
        const births = p.childIds.map(cid => realPerson(data, cid))
            .filter((c): c is Person => !!c && isBioChild(c, id))
            .map(c => ageBirthDate(c));
        const first = earliest(births);
        addAge(t, id, first ? groupAge(ageBirthDate(p), first) : null, ctx);
    }
    return t.table('firstChildAge');
}

// ==================== couples, births ====================

/** The first number of children in the open top group ("10 or more"). */
export const CHILDREN_TOP = 10;

function childrenPerCoupleRows(data: StromData, ids: readonly PersonId[], ctx: StatsContext): StatsTable {
    const t = new Tally();
    for (const u of unionsInScope(data, ids)) {
        t.units++;
        t.known++;
        const n = new Set(u.childIds.filter(c => !!realPerson(data, c))).size;
        const top = n >= CHILDREN_TOP;
        const label = top ? (ctx.labels?.childrenTop ?? `${CHILDREN_TOP}+`) : (ctx.labels?.children(n) ?? String(n));
        t.add(top ? `${CHILDREN_TOP}+` : String(n), label, realPartners(data, u), { order: top ? CHILDREN_TOP : n });
    }
    return t.table('childrenPerCouple');
}

function birthRows(data: StromData, ids: readonly PersonId[], opts: StatsOptions, ctx: StatsContext): StatsTable {
    const t = new Tally();
    for (const id of ids) {
        const p = realPerson(data, id);
        if (!p) continue;
        t.units++;
        if (opts.births === 'month') {
            const d = parseFlexDate(p.birthDate);
            if (!d || d.month === undefined) { t.addNone([id]); continue; }
            t.known++;
            t.add(`m${d.month}`, ctx.labels?.month(d.month) ?? String(d.month), [id], { order: d.month });
            continue;
        }
        const y = birthYearOf(p)?.year;
        if (y === undefined) { t.addNone([id]); continue; }
        t.known++;
        const from = Math.floor(y / 10) * 10;
        t.add(String(from), ctx.labels?.decade(from) ?? `${from}–${from + 9}`, [id], { order: from });
    }
    return t.table('births');
}

// ==================== the table ====================

/** The frequency table of a topic over the people of a scope (scopePersonIds). */
/**
 * Houses (spec 030 §15): a house's row counts the people of the scope with a
 * birth, marriage, census, residence or death there (a person under each of
 * the houses); "Not given" are those at none. Under the table the house one
 * family held longest and the share of the houses with history somebody
 * married into (of those with a person of the scope).
 */
function houseRows(data: StromData, ids: readonly PersonId[], ctx: StatsContext): StatsTable {
    const houses = ctx.houses ??= collectHouses(data);
    const t = new Tally();
    const scope = new Set<PersonId>();
    for (const id of ids) if (realPerson(data, id)) scope.add(id);
    const housed = new Set<PersonId>();
    let longest: HouseStats['longest'];
    const marriedIn = { houses: 0, of: 0 };
    for (const h of houses) {
        const here = [...livedAtHouse(h)].filter(id => scope.has(id));
        if (!here.length) continue;
        const title = houseTitle(h);
        for (const id of here) { t.add(h.id, title, [id]); housed.add(id); }
        if (h.familyYears !== undefined && h.familyYears > 0 && (!longest || h.familyYears > longest.years)) longest = { id: h.id, title, years: h.familyYears };
        if (h.overThreshold) {
            marriedIn.of++;
            if (h.marriedIn.length) marriedIn.houses++;
        }
    }
    for (const id of scope) {
        t.units++;
        if (housed.has(id)) t.known++; else t.addNone([id]);
    }
    return { ...t.table('houses'), houses: { ...(longest ? { longest } : {}), marriedIn } };
}

export function statsTable(data: StromData, ids: readonly PersonId[], topic: StatsTopic, opts: StatsOptions, ctx: StatsContext): StatsTable {
    switch (topic) {
        case 'firstNames': return firstNameRows(data, ids, opts, ctx);
        case 'surnames': return surnameRows(data, ids, opts);
        case 'birthPlaces': return personPlaceRows(data, ids, 'birth', opts, ctx);
        case 'deathPlaces': return personPlaceRows(data, ids, 'death', opts, ctx);
        case 'marriagePlaces': return marriagePlaceRows(data, ids, opts, ctx);
        case 'occupations': return eventNoteRows(data, ids, 'occupation');
        case 'religions': return eventNoteRows(data, ids, 'religion');
        case 'deathAge': return deathAgeRows(data, ids, ctx);
        case 'firstMarriageAge': return firstMarriageAgeRows(data, ids, ctx);
        case 'firstChildAge': return firstChildAgeRows(data, ids, ctx);
        case 'childrenPerCouple': return childrenPerCoupleRows(data, ids, ctx);
        case 'births': return birthRows(data, ids, opts, ctx);
        case 'houses': return houseRows(data, ids, ctx);
    }
}

// ==================== sort, search, share (§4) ====================

/**
 * Rows in an order: by count (most first; a tie A–Z), A–Z (the language's
 * collation) or by value (age, year, month, number of children ascending).
 * "No district / country known" stays last.
 */
export function sortRows(rows: readonly StatsRow[], sort: StatsSort, lang: string | undefined): StatsRow[] {
    const coll = new Intl.Collator(lang || undefined);
    const byName = (a: StatsRow, b: StatsRow): number => coll.compare(a.label, b.label) || cmp(a.key, b.key);
    const by: (a: StatsRow, b: StatsRow) => number = sort === 'count'
        ? (a, b) => b.count - a.count || byName(a, b)
        : sort === 'name' ? byName
            : (a, b) => a.order - b.order || byName(a, b);
    return [...rows].sort((a, b) => Number(!!a.muted) - Number(!!b.muted) || by(a, b));
}

/** The rows matching a search (no case, no diacritics) in their label, other form or spellings. */
export function searchRows(rows: readonly StatsRow[], query: string): StatsRow[] {
    const q = foldText(query.trim());
    if (!q) return [...rows];
    return rows.filter(r => foldText(r.label).includes(q)
        || (r.alt !== undefined && foldText(r.alt).includes(q))
        || (r.forms ?? []).some(f => foldText(f).includes(q)));
}

/** A row's share in percent of the units with a value (null: no base). */
export function rowShare(table: StatsTable, row: StatsRow): number | null {
    return table.known > 0 ? (row.count / table.known) * 100 : null;
}

/** A share as the app writes it: one decimal place in the language's notation, no grouping. */
export function shareText(share: number, lang: string): string {
    return share.toLocaleString(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1, useGrouping: false });
}

// ==================== CSV (§9) ====================

/** The CSV's words, in the app's language. */
export interface StatsCsvTexts {
    /** The first line: what the table is ("Statistics: First names – men, first name · Scope: … · Tree: … · 23. 11. 2026"). */
    desc: string;
    /** Value, Count, Share %. */
    head: readonly [string, string, string];
    none: string;
    total: string;
    /** The rows are a search's matches: no "Not given" line. */
    searching?: boolean;
}

const BOM = '\uFEFF';

/**
 * The CSV of a table as shown (`rows`: in the shown order, while searching
 * only the matches): a BOM, `;`, CRLF, formulas neutralised (the Table's
 * export, src/ui/table-view/table-export.ts), the share with the language's
 * decimal mark. Then "Not given" (not while searching, not when nobody) and
 * the total of units. Counts and shares are numbers the app writes: never
 * quoted, so "24,1" stays a number for a spreadsheet.
 */
export function statsCsv(table: StatsTable, rows: readonly StatsRow[], t: StatsCsvTexts, lang: string): string {
    const lines: string[][] = [[tableCsvField(t.desc)], t.head.map(tableCsvField)];
    for (const r of rows) {
        const share = rowShare(table, r);
        lines.push([tableCsvField(r.label), String(r.count), share === null ? '' : shareText(share, lang)]);
    }
    if (!t.searching && table.noneCount > 0) lines.push([tableCsvField(t.none), String(table.noneCount), '']);
    lines.push([tableCsvField(t.total), String(table.units), '']);
    return BOM + lines.map(l => l.join(';')).join('\r\n') + '\r\n';
}
