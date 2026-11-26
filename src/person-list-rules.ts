/**
 * Custom rules of lists of people (spec 136 phase 1): conditions joined in
 * groups "all" / "any" with "except", evaluated over the tree without the UI.
 *
 * A condition gives a set of people (no placeholders); a group gives the
 * intersection ('all') or the union ('any') of its plain items, minus the
 * union of its "except" items. A group of excepts only is empty. Each
 * condition's set is cached per lineage index (one per data revision), so
 * the counts of every row and the whole rule come from the same work.
 *
 * Conditions the Table's filter already knows (living / deceased, age at
 * death, no birth date, no source, the number of unions, the cells' empty /
 * filled) are worked out by the Table's own functions on its model; the
 * one-condition rules of spec 084 / 113 (family lines, ancestors,
 * descendants, research lines, Table filters, "added") by rulePersonIds.
 *
 * Dates: a condition on a date holds only when the whole span the date may
 * mean lies in the period ("about 1820" = 1818–1822, "before 1850" has no
 * start, "1840..1845" its two ends); a person without the date never holds.
 */

import type {
    CustomRule, ListTemplate, Person, PersonId, PersonList, RuleCond, RuleCondName, RuleGroup, RuleHasWhat, RuleNearEvent,
    RuleNode, RuleParamsMap, RulePeriod, RuleYears, StromData,
} from './types.js';
import { FAMILY_PRESETS, familyPresetOf, familySet, partnersOf, rodLabels, type LineageIndex, type RodId } from './lineage.js';
import { parseFlexDate, formatFlexDate } from './dates.js';
import { placeKey, townOfPlace } from './places.js';
import { collectHouses, houseTitle, type HouseFactKind, type TreeHouse } from './houses.js';
import { geoOfKey } from './live-follow-map.js';
import { personMediaIndex } from './media.js';
import { shownName } from './person-name.js';
import { getCurrentLanguage, strings } from './strings.js';
import { inLine } from './ui/table-view/table-research.js';
import { birthOrBaptism, cellOf, columnById, deathOrBurial } from './ui/table-view/table-columns.js';
import { cellPasses, foldText, personPassesChip, type ColumnFilter } from './ui/table-view/table-filter.js';
import type { PersonRow } from './ui/table-view/table-model.js';
import {
    addedTime, listPersonIds, personListsOf, researchLinesOfIndex, ruleCacheOf, rulePersonIds, startOfDay, tableModelOf,
    type ListEnv,
} from './person-lists.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The slack of an "about" date in years (as the participant match and the person card read it). */
const ABOUT_YEARS = 2;
/** A life without a known death is taken as this many years from the birth ("lived in a period"). */
export const LIFE_YEARS_WITHOUT_DEATH = 90;
/** The deepest a rule may nest (the root group = 1). */
export const RULE_MAX_DEPTH = 3;
/** The widest surroundings of a place in km. */
export const NEAR_MAX_KM = 500;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function realPerson(data: StromData, id: string | null | undefined): Person | null {
    if (!id) return null;
    const p = data.persons[id as PersonId];
    return p && !p.isPlaceholder ? p : null;
}

function realPeople(data: StromData): Person[] {
    const out: Person[] = [];
    for (const p of Object.values(data.persons)) if (p && !p.isPlaceholder) out.push(p);
    return out;
}

function setOf(ids: Iterable<string>, data: StromData): Set<PersonId> {
    const out = new Set<PersonId>();
    for (const id of ids) if (realPerson(data, id)) out.add(id as PersonId);
    return out;
}

function memo<T>(index: LineageIndex, name: string, make: () => T): T {
    const store = ruleCacheOf(index).ruleData;
    if (store.has(name)) return store.get(name) as T;
    const v = make();
    store.set(name, v);
    return v;
}

/** The years a date may mean, both ends included; null without a readable date. */
export function yearSpan(value: string | undefined): [number, number] | null {
    const d = parseFlexDate(value);
    if (!d) return null;
    let lo = d.year;
    let hi = d.end?.year ?? d.year;
    if (hi < lo) [lo, hi] = [hi, lo];
    if (d.end) return [lo, hi];
    switch (d.qualifier) {
        case '~': return [lo - ABOUT_YEARS, hi + ABOUT_YEARS];
        case '<': return [Number.NEGATIVE_INFINITY, hi];
        case '>': return [lo, Number.POSITIVE_INFINITY];
        default: return [lo, hi];
    }
}

/** The whole span lies in the period (a missing end of the period is open). */
function spanInside(span: [number, number] | null, y: RuleYears): boolean {
    if (!span) return false;
    if (y.from !== undefined && span[0] < y.from) return false;
    if (y.to !== undefined && span[1] > y.to) return false;
    return true;
}

function periodStart(period: RulePeriod, now: number): number {
    if ('hours' in period) return now - period.hours * HOUR_MS;
    if ('days' in period) return startOfDay(now) - (Math.max(1, period.days) - 1) * DAY_MS;
    return addedTime(period.since);
}

/** An occupation as the Statistics count it: the event's text, spaces tidied, folded. */
export function occupationsOf(p: Person): { key: string; label: string }[] {
    const out: { key: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const e of p.events ?? []) {
        if (e.type !== 'occupation') continue;
        const label = (e.note ?? '').trim().replace(/\s+/g, ' ');
        if (!label) continue;
        const key = foldText(label);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, label });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Places of people ("Place and surroundings", §3.3)
// ---------------------------------------------------------------------------

interface PlaceHit { key: string; name: string; ev: RuleNearEvent }

interface PlaceIndex {
    /** Each person's places by kind of event. */
    byPerson: Map<PersonId, PlaceHit[]>;
    /** Each place of the tree (by placeKey): a name as written and its people. */
    places: Map<string, { name: string; persons: Set<PersonId> }>;
}

function placeIndexOf(index: LineageIndex): PlaceIndex {
    return memo(index, 'places', () => {
        const data = index.data;
        const byPerson = new Map<PersonId, PlaceHit[]>();
        const places = new Map<string, { name: string; persons: Set<PersonId> }>();
        for (const p of realPeople(data)) {
            const hits: PlaceHit[] = [];
            const add = (name: string | undefined, ev: RuleNearEvent): void => {
                const n = name?.trim();
                if (!n) return;
                const key = placeKey(n);
                if (!key) return;
                hits.push({ key, name: n, ev });
                let pl = places.get(key);
                if (!pl) places.set(key, pl = { name: n, persons: new Set() });
                pl.persons.add(p.id);
            };
            const events = p.events ?? [];
            add(p.birthPlace, 'birth');
            for (const e of events) if (e.type === 'baptism' || e.type === 'birth') add(e.place, 'birth');
            for (const e of events) if (e.type === 'residence') add(e.place, 'residence');
            for (const uid of p.partnerships) add(data.partnerships[uid]?.startPlace, 'marriage');
            add(p.deathPlace, 'death');
            for (const e of events) if (e.type === 'burial' || e.type === 'death') add(e.place, 'death');
            if (hits.length) byPerson.set(p.id, hits);
        }
        return { byPerson, places };
    });
}

/** The town of a place, as a key ("Mlýnky 12" and "Mlýnky" are one town). */
function townKey(name: string): string {
    return placeKey(townOfPlace(name)?.town ?? name);
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The place keys of the research records under the record of `key` (any depth), with the names of those records. */
function keysBelow(data: StromData, key: string): Set<string> {
    const out = new Set<string>();
    const rid = data.placeRefs?.[key];
    const records = data.placeRecords;
    if (!rid || !records) return out;
    const kids = new Map<string, string[]>();
    for (const r of Object.values(records)) {
        if (!r?.parent) continue;
        let l = kids.get(r.parent);
        if (!l) kids.set(r.parent, l = []);
        l.push(r.id);
    }
    const under = new Set<string>();
    const stack = [...(kids.get(rid) ?? [])];
    while (stack.length) {
        const id = stack.pop()!;
        if (under.has(id) || id === rid) continue;
        under.add(id);
        stack.push(...(kids.get(id) ?? []));
    }
    for (const [k, v] of Object.entries(data.placeRefs ?? {})) if (under.has(v)) out.add(k);
    for (const id of under) for (const n of records[id]?.names ?? []) { const k = placeKey(n.name); if (k) out.add(k); }
    return out;
}

/** Whether the place's research record has places under it ("including places under it" is offered then). */
export function placeHasBelow(data: StromData, key: string): boolean {
    const rid = data.placeRefs?.[key];
    return !!rid && Object.values(data.placeRecords ?? {}).some(r => r?.parent === rid);
}

/** Whether any place of the tree has a location (the surroundings work only then). */
export function treeHasPlaceCoords(data: StromData): boolean {
    if (Object.values(data.places ?? {}).some(g => g && Number.isFinite(g.lat) && Number.isFinite(g.lon))) return true;
    return Object.values(data.placeRecords ?? {}).some(r => !!r?.coords);
}

/** One place the surroundings of a condition take in (or would, with a location). */
export interface NearPlace { key: string; name: string; km: number | null; persons: number }

/**
 * The places a "Place and surroundings" condition takes in, nearest first
 * (`places`), and the tree's places without a location that may lie there
 * (`unplaced`: the same town as a place taken in, or under the same research
 * record), most people first. The center without a location (or km 0) takes
 * in only the place, the parts of its town and, with `below`, the places
 * under it. Never starts geocoding.
 */
export function nearPlaces(index: LineageIndex, p: RuleParamsMap['near']): { places: NearPlace[]; unplaced: NearPlace[] } {
    const data = index.data;
    const { places } = placeIndexOf(index);
    const matched = nearKeys(index, p);
    const center = p.km > 0 ? geoOfKey(data, p.placeKey) : null;
    const taken: NearPlace[] = [];
    for (const key of matched) {
        const pl = places.get(key);
        if (!pl) continue;
        const g = center ? geoOfKey(data, key) : null;
        taken.push({ key, name: pl.name, km: g && center ? Math.round(haversineKm(center, g)) : 0, persons: pl.persons.size });
    }
    taken.sort((a, b) => (a.km ?? 0) - (b.km ?? 0) || b.persons - a.persons || a.name.localeCompare(b.name));
    const unplaced: NearPlace[] = [];
    if (center) {
        const towns = new Set(taken.map(t => townKey(t.name)));
        const parents = new Set<string>();
        for (const t of taken) {
            const rid = data.placeRefs?.[t.key];
            const parent = rid ? data.placeRecords?.[rid]?.parent : undefined;
            if (parent) parents.add(parent);
        }
        for (const [key, pl] of places) {
            if (matched.has(key) || geoOfKey(data, key)) continue;
            const rid = data.placeRefs?.[key];
            const parent = rid ? data.placeRecords?.[rid]?.parent : undefined;
            if (towns.has(townKey(pl.name)) || (parent && parents.has(parent))) {
                unplaced.push({ key, name: pl.name, km: null, persons: pl.persons.size });
            }
        }
        unplaced.sort((a, b) => b.persons - a.persons || a.name.localeCompare(b.name));
    }
    return { places: taken, unplaced };
}

/**
 * The place keys a "Place and surroundings" condition takes in: the place,
 * the parts of its town (townOfPlace), with `below` the places under its
 * research record, and with km > 0 every place of the tree whose location
 * is at most km away. Places without a location count by name only.
 */
function nearKeys(index: LineageIndex, p: RuleParamsMap['near']): Set<string> {
    const data = index.data;
    const { places } = placeIndexOf(index);
    const out = new Set<string>([p.placeKey]);
    const town = townKey(p.placeName || p.placeKey);
    for (const [key, pl] of places) if (townKey(pl.name) === town || key === town) out.add(key);
    if (p.below) for (const k of keysBelow(data, p.placeKey)) out.add(k);
    const center = p.km > 0 ? geoOfKey(data, p.placeKey) : null;
    if (center) {
        for (const key of places.keys()) {
            if (out.has(key)) continue;
            const g = geoOfKey(data, key);
            if (g && haversineKm(center, g) <= p.km) out.add(key);
        }
    }
    return out;
}

/** The tree's places a condition can choose (a person's birth, death, marriage or residence place), most people first. */
export function rulePlaceChoices(index: LineageIndex): Array<{ key: string; name: string; persons: number }> {
    return memo(index, 'placeChoices', () => [...placeIndexOf(index).places.entries()]
        .map(([key, pl]) => ({ key, name: pl.name, persons: pl.persons.size }))
        .sort((a, b) => b.persons - a.persons || a.name.localeCompare(b.name)));
}

/**
 * The tree's occupations as the Statistics group them (by the folded text):
 * the most used spelling as the label, the other spellings, the people with it;
 * most people first.
 */
export function ruleOccupationChoices(index: LineageIndex): Array<{ key: string; label: string; forms: string[]; persons: number }> {
    return memo(index, 'occupationChoices', () => {
        const by = new Map<string, { forms: Map<string, number>; persons: number }>();
        for (const p of realPeople(index.data)) {
            for (const o of occupationsOf(p)) {
                let e = by.get(o.key);
                if (!e) by.set(o.key, e = { forms: new Map(), persons: 0 });
                e.persons++;
                e.forms.set(o.label, (e.forms.get(o.label) ?? 0) + 1);
            }
        }
        return [...by.entries()].map(([key, e]) => {
            const forms = [...e.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(f => f[0]);
            return { key, label: forms[0], forms: forms.slice(1), persons: e.persons };
        }).sort((a, b) => b.persons - a.persons || a.label.localeCompare(b.label));
    });
}

/** Whether a place key is still a place of the tree (a person's or a union's place, a located or researched place). */
/** The facts that say a person lived in a house (spec 030 §15): not an event of another kind (an occupation…). */
const LIVED_KINDS: ReadonlySet<HouseFactKind> = new Set<HouseFactKind>(['birth', 'marriage', 'census', 'residence', 'death']);

/** The tree's houses, read once per index: by id, and a house joined by hand under its own id too. */
function housesOf(index: LineageIndex): { list: TreeHouse[]; byId: Map<string, TreeHouse> } {
    return memo(index, 'houses', () => {
        const list = collectHouses(index.data);
        const byId = new Map<string, TreeHouse>(list.map(h => [h.id, h]));
        for (const h of list) for (const m of index.data.houses?.[h.id]?.merged ?? []) if (!byId.has(m)) byId.set(m, h);
        return { list, byId };
    });
}

/** The house of a "Lived in the house" condition (a house joined into another one is that one), or null. */
export function ruleHouseOf(index: LineageIndex, id: string): TreeHouse | null {
    return id ? housesOf(index).byId.get(id) ?? null : null;
}

/** The houses a "Lived in the house" condition offers: the tree's, by town and number, with their people. */
export function ruleHouseChoices(index: LineageIndex): Array<{ id: string; name: string; persons: number }> {
    return housesOf(index).list.filter(h => h.persons > 0).map(h => ({ id: h.id, name: houseTitle(h), persons: h.persons }));
}

/** The people with a birth, marriage, census, residence or death at the house, in the years when given (a fact without a year not then). */
export function livedInHouseIds(index: LineageIndex, p: RuleParamsMap['livedInHouse']): Set<PersonId> {
    const house = ruleHouseOf(index, p.house);
    const out = new Set<PersonId>();
    if (!house) return out;
    const y = p.years;
    const dated = !!y && (y.from !== undefined || y.to !== undefined);
    for (const f of house.facts) {
        if (!LIVED_KINDS.has(f.kind)) continue;
        if (dated && (f.year === undefined || (y!.from !== undefined && f.year < y!.from) || (y!.to !== undefined && f.year > y!.to))) continue;
        if (realPerson(index.data, f.personId)) out.add(f.personId);
    }
    return out;
}

function placeInTree(index: LineageIndex, key: string): boolean {
    const data = index.data;
    return placeIndexOf(index).places.has(key) || !!data.places?.[key] || !!data.placeRefs?.[key];
}

// ---------------------------------------------------------------------------
// One condition
// ---------------------------------------------------------------------------

/** What is missing for a condition to be complete (it cannot be saved then), or null. */
export type RuleNeed = 'person' | 'place' | 'list' | 'rod' | 'line' | 'years' | 'events' | 'km' | 'occupation' | 'text' | 'number' | 'period' | 'view';

export function condNeed(cond: RuleCond): RuleNeed | null {
    const years = (y: RuleYears): boolean => {
        const ok = (n: number | undefined): boolean => n === undefined || Number.isFinite(n);
        if (!ok(y.from) || !ok(y.to)) return false;
        if (y.from === undefined && y.to === undefined) return false;
        return y.from === undefined || y.to === undefined || y.from <= y.to;
    };
    const period = (p: RulePeriod): boolean => {
        if ('hours' in p) return p.hours === 24;
        if ('days' in p) return Number.isInteger(p.days) && p.days >= 1;
        return /^\d{4}-\d{2}-\d{2}$/.test(p.since ?? '') && Number.isFinite(addedTime(p.since));
    };
    switch (cond.c) {
        case 'family': case 'ancestors': case 'descendants': return cond.p.personId ? null : 'person';
        case 'rod': return cond.p.rodIds?.length ? null : 'rod';
        case 'line': return cond.p.directionId ? null : 'line';
        case 'list': return cond.p.listId ? null : 'list';
        case 'born': case 'died': case 'married': case 'livedIn': case 'deathAge': return years(cond.p) ? null : 'years';
        case 'near':
            if (!cond.p.placeKey) return 'place';
            if (!cond.p.events?.length) return 'events';
            return Number.isFinite(cond.p.km) && cond.p.km >= 0 && cond.p.km <= NEAR_MAX_KM ? null : 'km';
        case 'occupation': return cond.p.values?.length ? null : 'occupation';
        case 'text': return cond.p.query?.trim() ? null : 'text';
        case 'count': return Number.isInteger(cond.p.n) && cond.p.n >= 0 ? null : 'number';
        case 'added': case 'changed': return period(cond.p) ? null : 'period';
        case 'tableFilter': return cond.p.filter && Array.isArray(cond.p.filter.items) ? null : 'view';
        case 'livedInHouse':
            if (!cond.p.house) return 'place';
            return !cond.p.years || years(cond.p.years) ? null : 'years';
        case 'alive': case 'gender': case 'has': return null;
    }
}

/** A reference of a condition that is no longer in the tree (§11): the condition counts as empty. */
export interface MissingRef { kind: 'person' | 'place' | 'list' | 'rod' | 'line'; name: string; path: string }

/** The reference of a condition no longer in the tree (§11), or null. */
export function condMissing(index: LineageIndex, cond: RuleCond): Omit<MissingRef, 'path'> | null {
    const data = index.data;
    switch (cond.c) {
        case 'family': case 'ancestors': case 'descendants':
            return cond.p.personId && !data.persons[cond.p.personId] ? { kind: 'person', name: cond.p.personName || '?' } : null;
        case 'near':
            return cond.p.placeKey && !placeInTree(index, cond.p.placeKey) ? { kind: 'place', name: cond.p.placeName || cond.p.placeKey } : null;
        case 'livedInHouse':
            return cond.p.house && !ruleHouseOf(index, cond.p.house) ? { kind: 'place', name: cond.p.houseName || cond.p.house } : null;
        case 'list':
            return cond.p.listId && !personListsOf(data).some(l => l.id === cond.p.listId) ? { kind: 'list', name: cond.p.listName || '?' } : null;
        case 'rod':
            return cond.p.rodIds.length && !cond.p.rodIds.some(id => index.rods.has(id as RodId)) ? { kind: 'rod', name: cond.p.rodName || '?' } : null;
        case 'line':
            return cond.p.directionId && !researchLinesOfIndex(index).lines.some(l => l.id === cond.p.directionId)
                ? { kind: 'line', name: cond.p.lineName || cond.p.directionId } : null;
        default:
            return null;
    }
}

/** The cache key of a condition: its name and parameters, with the minute of now for the periods and the Table's home and language for a Table filter. */
export function condCacheKey(cond: RuleCond, env: ListEnv): string {
    const extra = cond.c === 'added' || cond.c === 'changed'
        ? Math.floor((env.now ?? Date.now()) / 60_000)
        : cond.c === 'tableFilter' || cond.c === 'alive' || cond.c === 'deathAge' || cond.c === 'has' || cond.c === 'count'
            ? `${env.homeId ?? ''}|${env.lang ?? getCurrentLanguage()}`
            : '';
    return JSON.stringify([cond.c, cond.p, extra]);
}

function personRow(index: LineageIndex, env: ListEnv, id: PersonId): PersonRow | null {
    return tableModelOf(index, env).personRows.get(id) ?? null;
}

/** Each person whose row passes `test` (the Table's model). */
function byRow(index: LineageIndex, env: ListEnv, test: (row: PersonRow) => boolean): Set<PersonId> {
    const model = tableModelOf(index, env);
    const out = new Set<PersonId>();
    for (const row of model.personRows.values()) {
        if (row.person.isPlaceholder) continue;
        if (test(row)) out.add(row.id as PersonId);
    }
    return out;
}

function byPerson(data: StromData, test: (p: Person) => boolean): Set<PersonId> {
    const out = new Set<PersonId>();
    for (const p of realPeople(data)) if (test(p)) out.add(p.id);
    return out;
}

/** A cell of the Table's person columns as the Table works it out. */
function cellTest(index: LineageIndex, env: ListEnv, colId: string, item: Omit<ColumnFilter, 'col' | 'kind'>, kind: 'range' | 'text' | 'presence'): (row: PersonRow) => boolean {
    const model = tableModelOf(index, env);
    const col = columnById('persons', colId)!;
    const filter: ColumnFilter = { col: colId, kind: col.kind ?? 'text', ...item };
    return row => cellPasses(cellOf(model, row, col), filter, kind);
}

/**
 * Whether a person has a fact (`have`) or lacks it. The birth and death
 * cells as the Table's "only filled" / "only empty" read them (a living
 * person's death is neither), no birth date and no source as its chips.
 */
function hasTest(index: LineageIndex, env: ListEnv, what: RuleHasWhat, have: boolean): (row: PersonRow) => boolean {
    const data = index.data;
    const model = tableModelOf(index, env);
    const cell = (colId: string): ((row: PersonRow) => boolean) => cellTest(index, env, colId, have ? { filled: true } : { empty: true }, 'text');
    const is = (test: (row: PersonRow) => boolean): ((row: PersonRow) => boolean) => row => test(row) === have;
    switch (what) {
        case 'birthDate': return is(row => !personPassesChip(model, row, { chip: 'noBirth' }));
        case 'birthPlace': return cell('bPlace');
        case 'deathDate': return cell('dDate');
        case 'deathPlace': return cell('dPlace');
        case 'photo': return is(row => !!row.person.photo);
        case 'source': return is(row => !personPassesChip(model, row, { chip: 'noSource' }));
        case 'parents': return is(row => row.person.parentIds.some(id => !!realPerson(data, id)));
        case 'partner': return is(row => partnersOf(data, row.person.id).some(id => !!realPerson(data, id)));
        case 'children': return is(row => row.person.childIds.some(id => !!realPerson(data, id)));
        case 'story': return is(row => !!row.person.story?.text?.trim());
        case 'note': return is(row => !!row.person.notes?.trim());
        case 'material': {
            const media = memo(index, 'media', () => personMediaIndex(data));
            return is(row => (media.get(row.person.id)?.length ?? 0) > 0);
        }
        case 'conflict': return is(row => (row.person.research?.conflicts ?? []).some(c => c.status !== 'decided'));
        case 'openTask': return is(row => (row.person.research?.waits?.length ?? 0) > 0);
    }
}

/** The people of a "lived in a period" condition: surely alive in some year of it. */
function livedSpan(p: Person, nowYear: number): [number, number] | null {
    const b = birthOrBaptism(p);
    const d = deathOrBurial(p);
    const bs = b ? yearSpan(b.date) : null;
    const ds = d ? yearSpan(d.date) : null;
    if (bs && ds) return [bs[1], ds[0]];
    if (bs) return [bs[1], Math.min(bs[1] + LIFE_YEARS_WITHOUT_DEATH, nowYear)];
    if (ds) return [ds[0], ds[0]];
    return null;
}

interface EvalState {
    /** The lists being worked out above this point (a loop gives nothing). */
    visiting: ReadonlySet<string>;
}

function condSet(index: LineageIndex, cond: RuleCond, env: ListEnv, st: EvalState): Set<PersonId> {
    if (condNeed(cond) || condMissing(index, cond)) return new Set();
    // A list's people depend on the lists above it (a loop), so they are not kept.
    const keep = cond.c !== 'list';
    const cache = ruleCacheOf(index).conds;
    const key = condCacheKey(cond, env);
    if (keep) {
        const hit = cache.get(key);
        if (hit) return hit;
    }
    const out = computeCond(index, cond, env, st);
    if (keep) cache.set(key, out);
    return out;
}

function computeCond(index: LineageIndex, cond: RuleCond, env: ListEnv, st: EvalState): Set<PersonId> {
    const data = index.data;
    const now = env.now ?? Date.now();
    switch (cond.c) {
        case 'family': {
            const { personName: _n, ...spec } = cond.p;
            return familySet(index, spec);
        }
        case 'ancestors':
        case 'descendants':
            return setOf(rulePersonIds(index, { kind: cond.c, personId: cond.p.personId, generations: cond.p.generations }, env), data);
        case 'rod':
            return setOf(rulePersonIds(index, { kind: 'rods', rodIds: cond.p.rodIds }, env), data);
        case 'line': {
            const lines = researchLinesOfIndex(index);
            if (lines.source === 'none') return new Set();
            return byPerson(data, p => inLine(lines, p, cond.p.directionId));
        }
        case 'tableFilter':
            return setOf(rulePersonIds(index, { kind: 'tableFilter', rowType: cond.p.rowType, filter: cond.p.filter, sort: cond.p.sort }, env), data);
        case 'list': {
            const target = personListsOf(data).find(l => l.id === cond.p.listId);
            if (!target || st.visiting.has(target.id)) return new Set();
            return setOf(listMembers(index, target, env, st), data);
        }
        case 'born':
            return byPerson(data, p => { const b = birthOrBaptism(p); return !!b && spanInside(yearSpan(b.date), cond.p); });
        case 'died':
            return byPerson(data, p => { const d = deathOrBurial(p); return !!d && spanInside(yearSpan(d.date), cond.p); });
        case 'married':
            return byPerson(data, p => p.partnerships.some(uid => spanInside(yearSpan(data.partnerships[uid]?.startDate), cond.p)));
        case 'livedIn': {
            const nowYear = new Date(now).getFullYear();
            const from = cond.p.from ?? Number.NEGATIVE_INFINITY;
            const to = cond.p.to ?? Number.POSITIVE_INFINITY;
            return byPerson(data, p => {
                const s = livedSpan(p, nowYear);
                return !!s && s[0] <= s[1] && s[0] <= to && s[1] >= from;
            });
        }
        case 'deathAge':
            return byRow(index, env, cellTest(index, env, 'dAge', { from: cond.p.from, to: cond.p.to }, 'range'));
        case 'alive': {
            const model = tableModelOf(index, env);
            return byRow(index, env, row => personPassesChip(model, row, { chip: cond.p.value }));
        }
        case 'near': {
            const keys = nearKeys(index, cond.p);
            const events = new Set(cond.p.events);
            const out = new Set<PersonId>();
            for (const [id, hits] of placeIndexOf(index).byPerson) {
                if (hits.some(h => events.has(h.ev) && keys.has(h.key))) out.add(id);
            }
            return out;
        }
        case 'livedInHouse': return livedInHouseIds(index, cond.p);
        case 'gender': {
            const v = cond.p.value;
            return byPerson(data, p => v === 'unknown' ? p.gender !== 'male' && p.gender !== 'female' : p.gender === v);
        }
        case 'occupation': {
            const values = new Set(cond.p.values);
            return byPerson(data, p => occupationsOf(p).some(o => values.has(o.key)));
        }
        case 'has':
            return byRow(index, env, hasTest(index, env, cond.p.what, cond.p.have));
        case 'count': {
            const { what, cmp, n } = cond.p;
            const ok = (k: number): boolean => cmp === 'min' ? k >= n : k <= n;
            if (what === 'children') return byPerson(data, p => ok(p.childIds.filter(id => !!realPerson(data, id)).length));
            const model = tableModelOf(index, env);
            const col = columnById('persons', what === 'marriages' ? 'uCount' : 'srcCount')!;
            return byRow(index, env, row => {
                const v = cellOf(model, row, col).sortKey;
                return ok(typeof v === 'number' ? v : 0);
            });
        }
        case 'text': {
            const q = foldText(cond.p.query.trim());
            const where = cond.p.where;
            return byPerson(data, p => (where !== 'note' && foldText(p.story?.text ?? '').includes(q))
                || (where !== 'story' && foldText(p.notes ?? '').includes(q)));
        }
        case 'added':
        case 'changed': {
            if (cond.c === 'added' && 'days' in cond.p) return setOf(rulePersonIds(index, { kind: 'added', days: cond.p.days }, env), data);
            const from = periodStart(cond.p, now);
            if (!Number.isFinite(from)) return new Set();
            const field = cond.c === 'added' ? 'addedAt' : 'changedAt';
            return byPerson(data, p => {
                const t = addedTime(p[field]);
                return Number.isFinite(t) && t >= from;
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Groups and whole rules
// ---------------------------------------------------------------------------

/**
 * The people of a condition or group (spec 136 D2), no placeholders. A
 * condition that is incomplete or refers to something no longer in the tree
 * is empty. The conditions' people are kept in the index's cache
 * (ruleCacheOf); `not` of `node` itself is ignored here: its group takes it away.
 */
export function evalNode(index: LineageIndex, node: RuleNode, env: ListEnv = {}): Set<PersonId> {
    return evalIn(index, node, env, { visiting: new Set() });
}

function evalIn(index: LineageIndex, node: RuleNode, env: ListEnv, st: EvalState): Set<PersonId> {
    if (node.t === 'cond') return condSet(index, node, env, st);
    const plus = node.items.filter(n => !n.not);
    const minus = node.items.filter(n => n.not);
    if (!plus.length) return new Set();
    let acc: Set<PersonId>;
    if (node.op === 'all') {
        const sets = plus.map(n => evalIn(index, n, env, st)).sort((a, b) => a.size - b.size);
        acc = new Set(sets[0]);
        for (const s of sets.slice(1)) {
            for (const id of acc) if (!s.has(id)) acc.delete(id);
            if (!acc.size) break;
        }
    } else {
        acc = new Set();
        for (const n of plus) for (const id of evalIn(index, n, env, st)) acc.add(id);
    }
    for (const n of minus) {
        if (!acc.size) break;
        for (const id of evalIn(index, n, env, st)) acc.delete(id);
    }
    return acc;
}

/** The people of a list whose people may come from a custom rule, with the lists above it (a loop gives nothing). */
function listMembers(index: LineageIndex, list: PersonList, env: ListEnv, st: EvalState): PersonId[] {
    if (list.custom?.auto) {
        const set = evalIn(index, list.custom.root, env, { visiting: new Set([...st.visiting, list.id]) });
        return orderOfTree(index.data, set);
    }
    return listPersonIds(index, list, env);
}

function orderOfTree(data: StromData, set: ReadonlySet<PersonId>): PersonId[] {
    const out: PersonId[] = [];
    for (const id of Object.keys(data.persons) as PersonId[]) if (set.has(id)) out.push(id);
    return out;
}

/**
 * The people of a custom rule in the tree's order (the list sorts them),
 * no duplicates, no placeholders. `listId`: the list the rule is of, so a
 * condition leading back to it gives nothing.
 */
export function customPersonIds(index: LineageIndex, custom: CustomRule, env: ListEnv = {}, listId?: string): PersonId[] {
    const set = evalIn(index, custom.root, env, { visiting: new Set(listId ? [listId] : []) });
    return orderOfTree(index.data, set);
}

/**
 * The counts of the preview (§6): each node's own count over the whole tree
 * (`nodes`, by path: '' the root, '0' its first item, '1.0' the first item of
 * its second…; null for an incomplete condition), the whole rule (`total`;
 * incomplete conditions are left out of it), and when the total is 0 in a
 * root group 'all', the path of the first item after which the result fell
 * to 0 (`zeroAt`, "0 here").
 */
export interface RuleCounts {
    total: number;
    nodes: Map<string, number | null>;
    zeroAt: string | null;
}

export function evalRuleCounts(index: LineageIndex, root: RuleGroup, env: ListEnv = {}, listId?: string): RuleCounts {
    const st: EvalState = { visiting: new Set(listId ? [listId] : []) };
    const nodes = new Map<string, number | null>();
    const walk = (node: RuleNode, path: string): void => {
        if (node.t === 'cond') {
            nodes.set(path, condNeed(node) ? null : evalIn(index, node, env, st).size);
            return;
        }
        node.items.forEach((n, i) => walk(n, path ? `${path}.${i}` : String(i)));
        nodes.set(path, evalIn(index, completeOnly(node), env, st).size);
    };
    walk(root, '');
    const total = nodes.get('') ?? 0;
    let zeroAt: string | null = null;
    if (total === 0 && root.op === 'all') {
        const clean = completeOnly(root);
        const order = root.items.map((n, i) => ({ n, i })).filter(x => clean.items.includes(x.n));
        const plus = order.filter(x => !x.n.not);
        const minus = order.filter(x => x.n.not);
        let acc: Set<PersonId> | null = null;
        for (const { n, i } of [...plus, ...minus]) {
            const s = evalIn(index, n, env, st);
            if (acc === null) acc = n.not ? new Set() : new Set(s);
            else if (n.not) for (const id of s) acc.delete(id);
            else for (const id of acc) if (!s.has(id)) acc.delete(id);
            if (acc.size === 0) { zeroAt = String(i); break; }
        }
    }
    return { total, nodes, zeroAt };
}

/** The group without its incomplete conditions (and groups left empty by them), as the preview counts it. */
function completeOnly(group: RuleGroup): RuleGroup {
    const items: RuleNode[] = [];
    for (const n of group.items) {
        if (n.t === 'cond') { if (!condNeed(n)) items.push(n); continue; }
        const g = completeOnly(n);
        if (g.items.length) items.push(g);
    }
    return { ...group, items };
}

// ---------------------------------------------------------------------------
// Checks: incomplete, depth, excepts, loops, missing references
// ---------------------------------------------------------------------------

/** Why a rule cannot be saved (the first issue a row has, by path as in RuleCounts). */
export type RuleIssue =
    | { kind: 'incomplete'; path: string; need: RuleNeed }
    | { kind: 'depth'; path: string }
    | { kind: 'empty'; path: string }
    | { kind: 'exceptFirst'; path: string }
    | { kind: 'exceptOnly'; path: string }
    | { kind: 'cycle'; path: string; names: string[] };

/**
 * Everything that keeps a rule from being saved (spec 136 D1, §5, §11): an
 * incomplete condition, a group deeper than RULE_MAX_DEPTH, an empty group,
 * an except as a group's first item or a group of excepts only, a list
 * condition leading in a loop back to `ctx.listId`. Empty = it can be saved.
 */
export function ruleIssues(root: RuleGroup, ctx: { lists?: readonly PersonList[]; listId?: string } = {}): RuleIssue[] {
    const out: RuleIssue[] = [];
    const walk = (node: RuleNode, path: string, depth: number): void => {
        if (node.t === 'cond') {
            const need = condNeed(node);
            if (need) out.push({ kind: 'incomplete', path, need });
            else if (node.c === 'list' && ctx.lists && ctx.listId) {
                const names = listCycle(ctx.lists, ctx.listId, node.p.listId);
                if (names) out.push({ kind: 'cycle', path, names });
            }
            return;
        }
        if (depth > RULE_MAX_DEPTH) { out.push({ kind: 'depth', path }); return; }
        if (!node.items.length) { out.push({ kind: 'empty', path }); return; }
        if (node.items[0].not) out.push({ kind: node.items.every(n => n.not) ? 'exceptOnly' : 'exceptFirst', path });
        node.items.forEach((n, i) => walk(n, path ? `${path}.${i}` : String(i), depth + 1));
    };
    walk(root, '', 1);
    return out;
}

/** The depth of a rule (the root group = 1). */
export function ruleDepth(node: RuleNode): number {
    if (node.t === 'cond') return 0;
    return 1 + Math.max(0, ...node.items.map(ruleDepth));
}

/** The references of a rule no longer in the tree (§11), each counted as an empty condition. */
export function customMissing(index: LineageIndex, custom: CustomRule | RuleGroup): MissingRef[] {
    const out: MissingRef[] = [];
    const walk = (node: RuleNode, path: string): void => {
        if (node.t === 'group') { node.items.forEach((n, i) => walk(n, path ? `${path}.${i}` : String(i))); return; }
        const m = condMissing(index, node);
        if (m) out.push({ ...m, path });
    };
    walk('root' in custom ? custom.root : custom, '');
    return out;
}

function listIdsOfRule(node: RuleNode, out: string[] = []): string[] {
    if (node.t === 'cond') { if (node.c === 'list' && node.p.listId) out.push(node.p.listId); return out; }
    for (const n of node.items) listIdsOfRule(n, out);
    return out;
}

/** The lists whose custom rule uses the list `listId` in a condition "Another list" (§11: asked before it is deleted). */
export function listUsedBy(lists: readonly PersonList[], listId: string): PersonList[] {
    return lists.filter(l => l.id !== listId && !!l.custom && listIdsOfRule(l.custom.root).includes(listId));
}

/**
 * Would a condition "Another list: `targetId`" in the list `listId` make a
 * loop (§11)? The names of the loop's lists from `listId` back to it
 * ("A → B → A"), or null. Follows the lists' custom rules.
 */
export function listCycle(lists: readonly PersonList[], listId: string, targetId: string): string[] | null {
    const byId = new Map(lists.map(l => [l.id, l]));
    const name = (id: string): string => byId.get(id)?.name || id;
    const seen = new Set<string>();
    const dfs = (id: string, path: string[]): string[] | null => {
        if (id === listId) return [...path, name(id)];
        if (seen.has(id)) return null;
        seen.add(id);
        const l = byId.get(id);
        if (!l?.custom) return null;
        for (const next of listIdsOfRule(l.custom.root)) {
            const found = dfs(next, [...path, name(id)]);
            if (found) return found;
        }
        return null;
    };
    return dfs(targetId, [name(listId)]);
}

// ---------------------------------------------------------------------------
// The one-condition rule (084) and the custom rule
// ---------------------------------------------------------------------------

/**
 * A one-condition rule as a custom rule's condition (§9 "Add condition…",
 * §15): ancestors / descendants become "Family of a person" with down 0 /
 * up 0, the direct line and no spouses (the same people; a generation limit
 * stays one); the other rules their own conditions.
 */
export function ruleToCustom(rule: import('./types.js').PersonListRule, index?: LineageIndex): RuleCond {
    const data = index?.data;
    switch (rule.kind) {
        case 'ancestors':
        case 'descendants': {
            const p = data?.persons[rule.personId];
            const personName = p ? shownName(p) : rule.personName ?? '';
            const g: number | 'all' = rule.generations ?? 'all';
            return {
                t: 'cond', c: 'family', p: {
                    personId: rule.personId, personName, via: 'both', width: 'line', spouses: 'none',
                    up: rule.kind === 'ancestors' ? g : 0, down: rule.kind === 'descendants' ? g : 0,
                },
            };
        }
        case 'rods': {
            const labels = index ? rodLabels(index) : null;
            const rodName = rule.rodIds.map(id => labels?.get(id as RodId) ?? '').filter(Boolean).join(', ');
            return { t: 'cond', c: 'rod', p: { rodIds: [...rule.rodIds], rodName } };
        }
        case 'line': {
            const line = index ? researchLinesOfIndex(index).lines.find(l => l.id === rule.directionId) : undefined;
            return { t: 'cond', c: 'line', p: { directionId: rule.directionId, lineName: line ? `${line.id} ${line.name}` : rule.lineName ?? rule.directionId } };
        }
        case 'tableFilter':
            return { t: 'cond', c: 'tableFilter', p: { viewName: '', rowType: rule.rowType, filter: rule.filter, sort: rule.sort } };
        case 'added':
            return { t: 'cond', c: 'added', p: { days: rule.days } };
    }
}

/**
 * The one-condition rule a custom rule is, when its root is a single plain
 * condition the tiles know (then it is stored as `rule`, as before), else
 * null. "Family of a person" is one only as ancestors or descendants (down 0
 * or up 0, the direct line, both parents, no spouses).
 */
export function customToRule(custom: CustomRule | RuleGroup): import('./types.js').PersonListRule | null {
    const root = 'root' in custom ? custom.root : custom;
    if (root.not || root.items.length !== 1) return null;
    const only = root.items[0];
    if (only.t !== 'cond' || only.not || condNeed(only)) return null;
    const gens = (d: number | 'all'): number | undefined => d === 'all' ? undefined : d;
    const named = (personName: string): { personName?: string } => personName ? { personName } : {};
    switch (only.c) {
        case 'family': {
            const p = only.p;
            if (p.width !== 'line' || p.spouses !== 'none' || p.via !== 'both') return null;
            if (p.down === 0 && p.up !== 0) return { kind: 'ancestors', personId: p.personId, ...withGen(gens(p.up)), ...named(p.personName) };
            if (p.up === 0 && p.down !== 0) return { kind: 'descendants', personId: p.personId, ...withGen(gens(p.down)), ...named(p.personName) };
            return null;
        }
        case 'ancestors':
        case 'descendants':
            return { kind: only.c, personId: only.p.personId, ...withGen(only.p.generations), ...named(only.p.personName) };
        case 'rod':
            return { kind: 'rods', rodIds: [...only.p.rodIds] };
        case 'line':
            return { kind: 'line', directionId: only.p.directionId, ...(only.p.lineName ? { lineName: only.p.lineName } : {}) };
        case 'tableFilter':
            return { kind: 'tableFilter', rowType: only.p.rowType, filter: only.p.filter, sort: only.p.sort };
        case 'added':
            return 'days' in only.p ? { kind: 'added', days: only.p.days } : null;
        default:
            return null;
    }
}

function withGen(g: number | undefined): { generations?: number } {
    return g === undefined ? {} : { generations: g };
}

/**
 * A rule without what belongs to one tree (D5, a template saved on the
 * device): people, places, lists, family lines and research lines are
 * emptied; the conditions stay, their parameter "to fill in".
 */
export function stripTemplateParams(root: RuleGroup): RuleGroup {
    const strip = (node: RuleNode): RuleNode => {
        if (node.t === 'group') return { ...node, items: node.items.map(strip) };
        switch (node.c) {
            case 'family': case 'ancestors': case 'descendants':
                return { ...node, p: { ...node.p, personId: '' as PersonId, personName: '' } } as RuleCond;
            case 'near': return { ...node, p: { ...node.p, placeKey: '', placeName: '' } };
            case 'livedInHouse': return { ...node, p: { ...structuredClone(node.p), house: '', houseName: '' } };
            case 'list': return { ...node, p: { listId: '', listName: '' } };
            case 'rod': return { ...node, p: { rodIds: [], rodName: '' } };
            case 'line': return { ...node, p: { directionId: '', lineName: '' } };
            default: return structuredClone(node);
        }
    };
    return strip(root) as RuleGroup;
}

/** A template saved on the device, ready to store (D5). */
export function makeListTemplate(id: string, name: string, root: RuleGroup, now: string): ListTemplate {
    return { id, name, root: stripTemplateParams(root), created: now };
}

/** The people and places of a rule filled in where they are empty (a template's "to fill in"). */
export function fillRuleParams(root: RuleGroup, fill: { person?: { id: PersonId; name: string }; place?: { key: string; name: string } }): RuleGroup {
    const walk = (node: RuleNode): RuleNode => {
        if (node.t === 'group') return { ...node, items: node.items.map(walk) };
        if ((node.c === 'family' || node.c === 'ancestors' || node.c === 'descendants') && !node.p.personId && fill.person) {
            return { ...node, p: { ...node.p, personId: fill.person.id, personName: fill.person.name } } as RuleCond;
        }
        if (node.c === 'near' && !node.p.placeKey && fill.place) {
            return { ...node, p: { ...node.p, placeKey: fill.place.key, placeName: fill.place.name } };
        }
        return node;
    };
    return walk(root) as RuleGroup;
}

/** The conditions of a rule that need a person / a place still empty (what a template asks for first). */
export function ruleNeeds(root: RuleGroup): RuleNeed[] {
    const out = new Set<RuleNeed>();
    const walk = (node: RuleNode): void => {
        if (node.t === 'group') { node.items.forEach(walk); return; }
        const need = condNeed(node);
        if (need) out.add(need);
    };
    walk(root);
    return [...out];
}

// ---------------------------------------------------------------------------
// In words (§8)
// ---------------------------------------------------------------------------

/** Words a Table filter (the UI words it with the filter's chips); default the number of its items. */
export type FilterWords = (p: RuleParamsMap['tableFilter']) => string;

function yearsText(y: RuleYears): string {
    return strings.lists.rules.years(y.from, y.to);
}

function periodText(p: RulePeriod): string {
    const t = strings.lists.rules.period;
    if ('hours' in p) return t.hours24;
    if ('days' in p) return t.days(p.days);
    return t.since(formatFlexDate(p.since, getCurrentLanguage()));
}

/** A missing reference's name: "{name} – missing". */
function gone(name: string, missing: boolean): string {
    return missing ? strings.lists.rules.gone(name || '?') : name;
}

/** One condition in words (spec 136 §3.2 "say"). */
export function condLabel(cond: RuleCond, index?: LineageIndex, filterWords?: FilterWords): string {
    const t = strings.lists.rules;
    const r = strings.lists.rule;
    const data = index?.data;
    const missing = index ? !!condMissing(index, cond) : false;
    const personName = (id: PersonId, stored: string): string => {
        const p = data?.persons[id];
        return gone(p ? shownName(p) : stored || '?', missing);
    };
    switch (cond.c) {
        case 'family': {
            const p = cond.p;
            const name = personName(p.personId, p.personName);
            const gen = (d: number | 'all'): number | undefined => d === 'all' ? undefined : d;
            if (p.width === 'line' && p.spouses === 'none' && p.via === 'both') {
                if (p.down === 0 && p.up !== 0) return r.anc(name, gen(p.up));
                if (p.up === 0 && p.down !== 0) return r.des(name, gen(p.down));
            }
            const preset = familyPresetOf(p);
            if (preset) return t.say.preset(t.preset[preset], name);
            const gens = (d: number | 'all'): string => d === 'all' ? t.allGen : t.gen(d);
            return t.say.family(name, gens(p.up), p.via, gens(p.down), p.width, p.cousins ?? 'all', p.spouses);
        }
        case 'ancestors':
            return r.anc(personName(cond.p.personId, cond.p.personName), cond.p.generations);
        case 'descendants':
            return r.des(personName(cond.p.personId, cond.p.personName), cond.p.generations);
        case 'rod': {
            const labels = index ? rodLabels(index) : null;
            const names = cond.p.rodIds.map(id => labels?.get(id as RodId) ?? '').filter(Boolean);
            return r.rod(gone(names.length ? names.join(', ') : cond.p.rodName || '?', missing));
        }
        case 'line': {
            const line = index ? researchLinesOfIndex(index).lines.find(l => l.id === cond.p.directionId) : undefined;
            return r.line(gone(line ? `${line.id} ${line.name}` : cond.p.lineName || cond.p.directionId, missing));
        }
        case 'list': {
            const list = data ? personListsOf(data).find(l => l.id === cond.p.listId) : undefined;
            return t.say.list(gone(list?.name || cond.p.listName || '?', missing));
        }
        case 'born': return t.say.born(yearsText(cond.p));
        case 'died': return t.say.died(yearsText(cond.p));
        case 'married': return t.say.married(yearsText(cond.p));
        case 'livedIn': {
            const { from, to } = cond.p;
            if (from !== undefined && to !== undefined && to - from === 99 && from % 100 === 1) return t.say.century((to / 100));
            return t.say.livedIn(yearsText(cond.p));
        }
        case 'deathAge': return t.say.deathAge(cond.p.from, cond.p.to);
        case 'alive': return t.say.alive[cond.p.value];
        case 'near': {
            const all = (['birth', 'death', 'marriage', 'residence'] as const).every(e => cond.p.events.includes(e));
            const events = all ? null : (['birth', 'death', 'marriage', 'residence'] as const).filter(e => cond.p.events.includes(e)).map(e => t.say.events[e]);
            return t.say.near(events, gone(cond.p.placeName || cond.p.placeKey, missing), cond.p.km, !!cond.p.below);
        }
        case 'livedInHouse': {
            const house = index ? ruleHouseOf(index, cond.p.house) : null;
            const y = cond.p.years;
            return t.say.livedInHouse(gone(house ? houseTitle(house) : cond.p.houseName || cond.p.house || '?', missing),
                y && (y.from !== undefined || y.to !== undefined) ? yearsText(y) : null);
        }
        case 'gender': return t.say.gender[cond.p.value];
        case 'occupation': return t.say.occupation((cond.p.labels.length ? cond.p.labels : cond.p.values).join(', '));
        case 'has': return (cond.p.have ? t.say.hasYes : t.say.hasNo)[cond.p.what];
        case 'count': return t.say.count(cond.p.what, cond.p.cmp, cond.p.n);
        case 'text': return t.say.text(cond.p.query.trim(), cond.p.where);
        case 'added': return t.say.added(periodText(cond.p));
        case 'changed': return t.say.changed(periodText(cond.p));
        case 'tableFilter': {
            const f = filterWords ? filterWords(cond.p) : cond.p.viewName || String(cond.p.filter.items.length);
            return cond.p.rowType === 'unions' ? r.unions(f) : r.filter(f);
        }
    }
}

/**
 * A condition or group in words (§8): a group in parentheses, its items
 * joined by "and" / "or", its excepts at the end ("except A or B").
 */
export function nodeLabel(node: RuleNode, index?: LineageIndex, filterWords?: FilterWords): string {
    if (node.t === 'cond') return condLabel(node, index, filterWords);
    const t = strings.lists.rules;
    const plus = node.items.filter(n => !n.not).map(n => nodeLabel(n, index, filterWords));
    const minus = node.items.filter(n => n.not).map(n => nodeLabel(n, index, filterWords));
    let text = plus.join(` ${node.op === 'all' ? t.and : t.or} `);
    if (minus.length) text += `${text ? ' ' : ''}${t.except} ${minus.join(` ${t.or} `)}`;
    return `(${text})`;
}

/**
 * A whole rule in words (§8): the root's items separated by " · ", each
 * after the first led by "and" / "or", the excepts at the end
 * (" · except A or B"). The first letter upper case.
 */
export function customLabel(custom: CustomRule | RuleGroup, index?: LineageIndex, filterWords?: FilterWords): string {
    const root = 'root' in custom ? custom.root : custom;
    const t = strings.lists.rules;
    const plus = root.items.filter(n => !n.not).map(n => nodeLabel(n, index, filterWords));
    const minus = root.items.filter(n => n.not).map(n => nodeLabel(n, index, filterWords));
    const parts = plus.map((s, i) => i === 0 ? s : `${root.op === 'all' ? t.and : t.or} ${s}`);
    if (minus.length) parts.push(`${t.except} ${minus.join(` ${t.or} `)}`);
    const text = parts.join(' · ');
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

// ---------------------------------------------------------------------------
// Re-exports for the UI parts
// ---------------------------------------------------------------------------

export { FAMILY_PRESETS, familyPresetOf, familySet };
export { customWithPersonMerged } from './person-lists-data.js';
export type { RuleCondName };
