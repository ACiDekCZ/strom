/**
 * Houses of the tree (spec 030 K1.1–K1.2, K3.2): worked out from the facts,
 * never stored. A house is a town and a house number (`HouseId`,
 * `<placeKey of the town>|<houseKey of the house>`), the same key the research
 * computes. A fact is at a house when its house field holds a house with a
 * number (the town is then the fact's place), or when its place holds one by
 * the research's rules (townOfPlace: "Bělokamen čp. 16", "Bělokamen,
 * Kopřivná 12"; a number alone after the town only where the Places dialog
 * offers it, never a part of a town like "Praha 5"). A street with its number
 * is a house; a text without a number ("mlýn", "Kopřivná") is none.
 *
 * What a person said about a house (StromData.houses, data version 27) joins
 * houses under another number (`merged`), tells them apart (`split`) and names
 * them; the research's results stay in the research (src/house-bridge.ts).
 */

import type { HouseId, HouseUserData, PersonId, StromData } from './types.js';
import { yearOf } from './dates.js';
import {
    bareOffers, coupleEventKind, compareHouses, factHouse, forEachPlaceFact, houseHasNumber, houseKey, knownStreets, placeKey,
    townOfPlace, type PlaceFact,
} from './places.js';
import type { KnownStreets } from './streets.js';

/** A house as the tree writes it: the town (the place's text) and the house's key (houseKey). */
export interface HouseRef {
    town: string;
    house: string;
}

/** What a fact at a house is. */
export type HouseFactKind = 'birth' | 'death' | 'marriage' | 'residence' | 'census' | 'event';

/** One person's fact at a house (a couple's fact is one for each partner). */
export interface HouseFact {
    personId: PersonId;
    year?: number;
    kind: HouseFactKind;
    /** The fact's field (PlaceFact.ref): `birth:<person>`, `event:<event id>`, `wedding:<union>`… */
    factRef: string;
}

/** One number of a house over time: the tree's own, a house joined by hand, or the research's. */
export interface HouseNumber {
    /** The number as written ("16", "čp. 9", "Kopřivná 12"). */
    house: string;
    from?: number;
    to?: number;
    source: 'tree' | 'merge' | 'research';
}

/** Someone who came into the house by marriage (K1.2): see `marriedInOf`. */
export interface HouseMarriedIn {
    personId: PersonId;
    year?: number;
    sex: 'm' | 'f';
}

/** A house of the tree, worked out from its facts (collectHouses). */
export interface TreeHouse {
    id: HouseId;
    ref: HouseRef;
    /** placeKey of the town (the part of `id` before `|`). */
    townKey: string;
    /** The house as the tree writes it most ("čp. 16"). */
    text: string;
    /** A person's name of the house (HouseUserData.name), when given. */
    name?: string;
    /** Its numbers over time, oldest first: the tree's own and those of houses joined by hand. */
    numbers: HouseNumber[];
    /** Every fact at the house (houses joined by hand included), by year (without a year last). */
    facts: HouseFact[];
    /** The surnames of the house in the order they came (consecutive repeats once): "Prouzal → Kvitelka → Prouzal". */
    surnames: string[];
    /** The first and the last year of its facts (none without a dated fact). */
    period?: { from: number; to: number };
    /** The generations of the people of the house (parent → child within it; partners are one generation). */
    generations: number;
    /** How many people have a fact there. */
    persons: number;
    /** Those people, by their first year there. */
    personIds: PersonId[];
    /** Who came into the house by marriage, by year. */
    marriedIn: HouseMarriedIn[];
    /** The longest time one family (people of the house linked as parent, child or partner) has facts there, in years. */
    familyYears?: number;
    /** A house with history: at least 2 generations or 30 years (isOverThreshold). */
    overThreshold: boolean;
}

/** The fewest generations that make a house one with history. */
export const HOUSE_THRESHOLD_GENERATIONS = 2;
/** The fewest years that make a house one with history. */
export const HOUSE_THRESHOLD_YEARS = 30;

/** The id of a house: the town's placeKey and the house's houseKey ("Bělokamen", "čp. 16" → "belokamen|16"). */
export function houseIdOf(town: string, house: string): HouseId {
    return `${placeKey(town)}|${houseKey(house)}`;
}

/** The town part of a house's id. */
export function houseTownKey(id: HouseId): string {
    const i = id.indexOf('|');
    return i < 0 ? id : id.slice(0, i);
}

/** What a reading of the tree's places needs to tell a house: its known streets and where a number alone is a house. */
export interface HouseContext {
    known: KnownStreets;
    offer: (u: { display: string }, key: string) => boolean;
}

export function houseContext(data: StromData): HouseContext {
    const known = knownStreets(data);
    return { known, offer: bareOffers(data, known) };
}

/**
 * The house of a fact (its place and its house field), or null when it is at
 * no house with a number. The town is the fact's place, or the place's town
 * when the place itself holds the house; the house is the house field, or the
 * place's house (with the field's street or number, as the map joins them).
 */
export function houseOfFact(fact: { place?: string; house?: string }, ctx: HouseContext): HouseRef | null {
    const place = fact.place?.trim();
    if (!place) return null;
    const had = fact.house?.trim() || undefined;
    const parsed = townOfPlace(place, ctx.known);
    if (parsed && (!parsed.bare || ctx.offer({ display: place }, placeKey(place)))) {
        const text = had ? factHouse(parsed.house, had) ?? parsed.house : parsed.house;
        return houseHasNumber(text) && placeKey(parsed.town) ? { town: parsed.town, house: text } : null;
    }
    return had && houseHasNumber(had) ? { town: place, house: had } : null;
}

function factKind(fact: PlaceFact): HouseFactKind {
    if (fact.ref.startsWith('birth:')) return 'birth';
    if (fact.ref.startsWith('death:')) return 'death';
    if (fact.ref.startsWith('wedding:')) return 'marriage';
    if (fact.event) {
        const t = fact.event.type;
        if (t === 'residence') return 'residence';
        if (t === 'census') return 'census';
        if (t === 'birth' || t === 'baptism') return 'birth';
        if (t === 'death' || t === 'burial' || t === 'cremation') return 'death';
        return 'event';
    }
    if (fact.coupleEvent) {
        const t = fact.coupleEvent.type;
        if (t === 'residence') return 'residence';
        if (t === 'census') return 'census';
        return coupleEventKind(t) === 'wedding' ? 'marriage' : 'event';
    }
    return 'event';
}

/** Whether a tree has at least one house with a number (the Houses window is offered only then, K1.1). */
export function hasNumberedHouse(data: StromData): boolean {
    const ctx = houseContext(data);
    let found = false;
    forEachPlaceFact(data, fact => {
        if (found || !fact.persons.some(id => data.persons[id] && !data.persons[id].isPlaceholder)) return;
        if (houseOfFact(fact, ctx)) found = true;
    });
    return found;
}

/** A house with history: at least 2 generations or 30 years of facts (spec 030, decision of 26 Nov). */
export function isOverThreshold(house: Pick<TreeHouse, 'generations' | 'period'>): boolean {
    return house.generations >= HOUSE_THRESHOLD_GENERATIONS
        || (!!house.period && house.period.to - house.period.from >= HOUSE_THRESHOLD_YEARS);
}

interface Acc {
    towns: Map<string, number>;
    texts: Map<string, number>;
    facts: HouseFact[];
}

const KIND_ORDER: Readonly<Record<HouseFactKind, number>> = { birth: 0, marriage: 1, residence: 2, census: 3, event: 4, death: 5 };

function compareFacts(a: HouseFact, b: HouseFact): number {
    const ya = a.year ?? Number.POSITIVE_INFINITY;
    const yb = b.year ?? Number.POSITIVE_INFINITY;
    return ya - yb || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
        || (a.factRef < b.factRef ? -1 : a.factRef > b.factRef ? 1 : 0)
        || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0);
}

const most = (m: ReadonlyMap<string, number>): string =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];

/** The facts of every house of the tree by its id, before houses joined by hand. */
function gatherHouses(data: StromData): Map<HouseId, Acc> {
    const ctx = houseContext(data);
    const out = new Map<HouseId, Acc>();
    forEachPlaceFact(data, fact => {
        const ref = houseOfFact(fact, ctx);
        if (!ref) return;
        const persons = fact.persons.filter(id => data.persons[id] && !data.persons[id].isPlaceholder);
        if (persons.length === 0) return;
        const id = houseIdOf(ref.town, ref.house);
        const acc = out.get(id) ?? { towns: new Map<string, number>(), texts: new Map<string, number>(), facts: [] };
        acc.towns.set(ref.town, (acc.towns.get(ref.town) ?? 0) + 1);
        acc.texts.set(ref.house, (acc.texts.get(ref.house) ?? 0) + 1);
        const year = yearOf(fact.date) ?? undefined;
        const kind = factKind(fact);
        for (const personId of persons) acc.facts.push({ personId, ...(year !== undefined ? { year } : {}), kind, factRef: fact.ref });
        out.set(id, acc);
    });
    return out;
}

/** The ids of every house of the tree (before houses joined by hand). */
export function houseIdsOf(data: StromData): Set<HouseId> {
    return new Set(gatherHouses(data).keys());
}

/**
 * Which house each house is joined into by the person's word (HouseUserData.merged),
 * never across a `split` of either side. A house joined into one that is itself
 * joined further goes to the last; a circle stays where it was first met.
 */
function joinedInto(user: Readonly<Record<HouseId, HouseUserData>> | undefined, present: ReadonlySet<HouseId>): Map<HouseId, HouseId> {
    const parent = new Map<HouseId, HouseId>();
    if (!user) return parent;
    const root = (id: HouseId): HouseId => {
        const seen = new Set<HouseId>();
        let at = id;
        while (parent.has(at) && !seen.has(at)) {
            seen.add(at);
            at = parent.get(at)!;
        }
        return at;
    };
    const apart = (a: HouseId, b: HouseId): boolean => !!user[a]?.split?.includes(b) || !!user[b]?.split?.includes(a);
    for (const id of Object.keys(user).sort()) {
        if (!present.has(id)) continue;
        for (const other of user[id]!.merged ?? []) {
            if (other === id || !present.has(other) || apart(id, other)) continue;
            const r = root(id);
            if (root(other) === r) continue;
            // `other` (with whatever was joined into it) goes into this house's own house.
            const ro = root(other);
            if (ro !== r) parent.set(ro, r);
        }
    }
    const out = new Map<HouseId, HouseId>();
    for (const id of present) {
        const r = root(id);
        if (r !== id) out.set(id, r);
    }
    return out;
}

/**
 * The generations of a set of people: a person is one generation below a
 * parent among them, partners among them are one generation (the deeper of
 * the two). The count is the deepest level (1 for people without a parent or a
 * partner among them).
 */
export function generationsOf(data: StromData, people: ReadonlySet<PersonId>): number {
    if (people.size === 0) return 0;
    const level = new Map<PersonId, number>();
    for (const id of people) level.set(id, 1);
    const partnersOf = (id: PersonId): PersonId[] => (data.persons[id]?.partnerships ?? [])
        .map(u => data.partnerships[u])
        .filter(Boolean)
        .map(u => (u!.person1Id === id ? u!.person2Id : u!.person1Id))
        .filter(p => people.has(p));
    // Levels only grow, by at most the number of people (a cycle in bad data stops there).
    for (let round = 0; round <= people.size + 1; round++) {
        let changed = false;
        for (const id of people) {
            let l = level.get(id)!;
            for (const parent of data.persons[id]?.parentIds ?? []) {
                if (people.has(parent)) l = Math.max(l, level.get(parent)! + 1);
            }
            for (const p of partnersOf(id)) l = Math.max(l, level.get(p)!);
            if (l > level.get(id)! && l <= people.size) {
                level.set(id, l);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return Math.max(...level.values());
}

/** The longest time one family has facts at the house: people linked as parent, child or partner among them. */
function familyYearsOf(data: StromData, years: ReadonlyMap<PersonId, number[]>): number | undefined {
    const parent = new Map<PersonId, PersonId>();
    const find = (id: PersonId): PersonId => {
        let at = id;
        while (parent.get(at) !== undefined && parent.get(at) !== at) at = parent.get(at)!;
        return at;
    };
    const join = (a: PersonId, b: PersonId): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
    };
    for (const id of years.keys()) {
        parent.set(id, parent.get(id) ?? id);
        const person = data.persons[id];
        for (const p of person?.parentIds ?? []) if (years.has(p)) { parent.set(p, parent.get(p) ?? p); join(id, p); }
        for (const u of person?.partnerships ?? []) {
            const union = data.partnerships[u];
            const other = union && (union.person1Id === id ? union.person2Id : union.person1Id);
            if (other && years.has(other)) { parent.set(other, parent.get(other) ?? other); join(id, other); }
        }
    }
    const span = new Map<PersonId, { from: number; to: number; people: number }>();
    for (const [id, ys] of years) {
        const r = find(id);
        const s = span.get(r) ?? { from: Number.POSITIVE_INFINITY, to: Number.NEGATIVE_INFINITY, people: 0 };
        for (const y of ys) {
            s.from = Math.min(s.from, y);
            s.to = Math.max(s.to, y);
        }
        s.people++;
        span.set(r, s);
    }
    let best: number | undefined;
    for (const s of span.values()) {
        if (s.people < 2 || !Number.isFinite(s.from)) continue;
        const n = s.to - s.from;
        if (n > 0 && (best === undefined || n > best)) best = n;
    }
    return best;
}

/**
 * Who came into the house by marriage (K1.2, "přiženil se" / "přivdala se"):
 * a man or a woman with a fact at the house who was not born there (no birth
 * fact of theirs at it) and whose partner is of the house — born there, or
 * there before them (the partner's first year at the house earlier than
 * theirs). The year is that marriage's (the earliest such one), else their
 * first year at the house. People of unknown sex are not marked (the mark
 * says "he married in" or "she married in").
 */
function marriedInOf(data: StromData, facts: readonly HouseFact[]): HouseMarriedIn[] {
    const born = new Set<PersonId>();
    const first = new Map<PersonId, number>();
    const people = new Set<PersonId>();
    for (const f of facts) {
        people.add(f.personId);
        if (f.kind === 'birth') born.add(f.personId);
        if (f.year !== undefined && (first.get(f.personId) ?? Number.POSITIVE_INFINITY) > f.year) first.set(f.personId, f.year);
    }
    const out: HouseMarriedIn[] = [];
    for (const id of people) {
        const person = data.persons[id];
        if (!person || born.has(id) || (person.gender !== 'male' && person.gender !== 'female')) continue;
        let year: number | undefined;
        let found = false;
        for (const u of person.partnerships ?? []) {
            const union = data.partnerships[u];
            if (!union) continue;
            const other = union.person1Id === id ? union.person2Id : union.person1Id;
            if (!people.has(other)) continue;
            const mine = first.get(id);
            const theirs = first.get(other);
            const ofHouse = born.has(other) || (mine !== undefined && theirs !== undefined && theirs < mine);
            if (!ofHouse) continue;
            found = true;
            const y = yearOf(union.startDate) ?? undefined;
            if (y !== undefined && (year === undefined || y < year)) year = y;
        }
        if (!found) continue;
        year ??= first.get(id);
        out.push({ personId: id, ...(year !== undefined ? { year } : {}), sex: person.gender === 'male' ? 'm' : 'f' });
    }
    return out.sort((a, b) => (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY)
        || (a.personId < b.personId ? -1 : 1));
}

/**
 * The surnames of a house in the order they came: the men's (the name the
 * house went by), each person at their first year there, consecutive repeats
 * once; the women's when no man is there. Undated people come last.
 */
function surnamesOf(data: StromData, order: readonly PersonId[]): string[] {
    const name = (id: PersonId): string => (data.persons[id]?.lastName ?? '').trim();
    const men = order.filter(id => data.persons[id]?.gender === 'male' && name(id));
    const list = (men.length ? men : order.filter(id => name(id))).map(name);
    return list.filter((n, i) => i === 0 || n !== list[i - 1]);
}

/**
 * Every house of the tree with a number, from its facts (K1.1–K1.2): what the
 * Houses window, the house page and the book list. Houses a person joined
 * (StromData.houses[id].merged) are one, under the house that names them;
 * `split` keeps two apart. Ordered by the town's key, then by house
 * (compareHouses).
 */
export function collectHouses(data: StromData): TreeHouse[] {
    const gathered = gatherHouses(data);
    const user = data.houses;
    const into = joinedInto(user, new Set(gathered.keys()));
    const groups = new Map<HouseId, HouseId[]>();
    for (const id of gathered.keys()) {
        const root = into.get(id) ?? id;
        const list = groups.get(root) ?? [];
        list.push(id);
        groups.set(root, list);
    }
    const out: TreeHouse[] = [];
    for (const [id, members] of groups) {
        const own = gathered.get(id)!;
        const facts: HouseFact[] = [];
        const numbers: HouseNumber[] = [];
        for (const m of members) {
            const acc = gathered.get(m)!;
            facts.push(...acc.facts);
            const years = acc.facts.map(f => f.year).filter((y): y is number => y !== undefined);
            numbers.push({
                house: most(acc.texts),
                ...(years.length ? { from: Math.min(...years), to: Math.max(...years) } : {}),
                source: m === id ? 'tree' : 'merge',
            });
        }
        facts.sort(compareFacts);
        numbers.sort((a, b) => (a.from ?? Number.POSITIVE_INFINITY) - (b.from ?? Number.POSITIVE_INFINITY)
            || compareHouses(a.house, b.house));
        const years = new Map<PersonId, number[]>();
        for (const f of facts) {
            const ys = years.get(f.personId) ?? [];
            if (f.year !== undefined) ys.push(f.year);
            years.set(f.personId, ys);
        }
        const firstYear = (pid: PersonId): number => Math.min(...(years.get(pid) ?? []), Number.POSITIVE_INFINITY);
        const personIds = [...years.keys()].sort((a, b) => firstYear(a) - firstYear(b));
        const dated = facts.filter(f => f.year !== undefined).map(f => f.year!);
        const period = dated.length ? { from: Math.min(...dated), to: Math.max(...dated) } : undefined;
        const generations = generationsOf(data, new Set(personIds));
        const familyYears = familyYearsOf(data, years);
        const name = user?.[id]?.name?.trim();
        const town = most(own.towns);
        const text = most(own.texts);
        out.push({
            id,
            ref: { town, house: houseKey(text) },
            townKey: houseTownKey(id),
            text,
            ...(name ? { name } : {}),
            numbers,
            facts,
            surnames: surnamesOf(data, personIds),
            ...(period ? { period } : {}),
            generations,
            persons: personIds.length,
            personIds,
            marriedIn: marriedInOf(data, facts),
            ...(familyYears !== undefined ? { familyYears } : {}),
            overThreshold: isOverThreshold({ generations, period }),
        });
    }
    return out.sort((a, b) => (a.townKey < b.townKey ? -1 : a.townKey > b.townKey ? 1 : 0) || compareHouses(a.text, b.text));
}

/** The facts that say a person lived in a house (spec 030 §15: the lists' rule, the statistics): not another event (an occupation…). */
export const LIVED_FACT_KINDS: ReadonlySet<HouseFactKind> = new Set<HouseFactKind>(['birth', 'marriage', 'census', 'residence', 'death']);

/** The people with a birth, marriage, census, residence or death at the house, in the years when given (then a fact without a year does not count). */
export function livedAtHouse(house: Pick<TreeHouse, 'facts'>, years?: { from?: number; to?: number }): Set<PersonId> {
    const dated = !!years && (years.from !== undefined || years.to !== undefined);
    const out = new Set<PersonId>();
    for (const f of house.facts) {
        if (!LIVED_FACT_KINDS.has(f.kind)) continue;
        if (dated && (f.year === undefined || (years!.from !== undefined && f.year < years!.from) || (years!.to !== undefined && f.year > years!.to))) continue;
        out.add(f.personId);
    }
    return out;
}

/**
 * The house as the tree writes it, its number kept on one line with the word
 * before it: "čp.\u00a016", "Haus Nr.\u00a016", "Kopřivná\u00a012" (a text
 * without a number, or a number alone, unchanged). For what is shown, never
 * for what is written to the data or compared.
 */
export function houseLabel(text: string): string {
    return text.replace(/^(\D*\S)\s+(?=\d)/u, '$1\u00a0');
}

/** "Bělokamen čp.\u00a016": the town and the house as the tree writes it, the number kept to its marker (houseLabel). */
export function houseTitle(h: Pick<TreeHouse, 'ref' | 'text'>): string {
    return `${h.ref.town} ${houseLabel(h.text)}`;
}

/** "Bělokamen čp. 16 · U Prouzalů": the house and its name after the farm, when it has one (a book's title). */
export function houseNamedTitle(h: Pick<TreeHouse, 'ref' | 'text' | 'name'>): string {
    return h.name ? `${houseTitle(h)} · ${h.name}` : houseTitle(h);
}

/**
 * The house a selection names by its town and house (a book of a house, spec
 * 030 §8), or null: the house of that key, else the house a number of that
 * town was joined into.
 */
export function findHouse(data: StromData, place: string, house: string, houses: readonly TreeHouse[] = collectHouses(data)): TreeHouse | null {
    const id = houseIdOf(place, house);
    const exact = houses.find(h => h.id === id);
    if (exact) return exact;
    const town = placeKey(place);
    const key = houseKey(house);
    return houses.find(h => h.townKey === town && h.numbers.some(n => houseKey(n.house) === key)) ?? null;
}

/**
 * The facts of a house as its rows (year, event, person): one row per person
 * and fact, by year (undated last). `limit` keeps the first ones.
 */
export function houseFacts(house: Pick<TreeHouse, 'facts'>, limit?: number): HouseFact[] {
    const seen = new Set<string>();
    const out: HouseFact[] = [];
    for (const f of house.facts) {
        const key = `${f.personId}\u0000${f.factRef}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
        if (limit !== undefined && out.length >= limit) break;
    }
    return out;
}

/**
 * The parts of the line of interesting facts of a house (K3.2, "One family
 * for {n} years · {k} house numbers · oldest record {y}"), in that order,
 * each only when it says something: one family over a year at least, two
 * numbers or more, an oldest dated record. The UI writes the words.
 */
export type HouseInterestingItem =
    | { kind: 'family'; years: number }
    | { kind: 'numbers'; count: number }
    | { kind: 'oldest'; year: number };

export function houseInteresting(house: Pick<TreeHouse, 'familyYears' | 'numbers' | 'period'>): HouseInterestingItem[] {
    const out: HouseInterestingItem[] = [];
    if (house.familyYears !== undefined && house.familyYears > 0) out.push({ kind: 'family', years: house.familyYears });
    const numbers = new Set(house.numbers.map(n => houseKey(n.house))).size;
    if (numbers >= 2) out.push({ kind: 'numbers', count: numbers });
    if (house.period) out.push({ kind: 'oldest', year: house.period.from });
    return out;
}

/** A number of a house as the research sends it (HouseResearch.numbers, src/house-bridge.ts). */
export interface ResearchHouseNumber {
    number: string;
    from?: string;
    to?: string;
    proposed?: boolean;
}

/**
 * A house's numbers with the research's (K1.1a): a number the research found
 * and that is not a proposal still waiting for a person's word joins the
 * list as `research`, unless the tree has it already or a person told that
 * house apart (`split`). Oldest first.
 */
export function withResearchNumbers(house: Pick<TreeHouse, 'id' | 'numbers'>, research: readonly ResearchHouseNumber[],
    user?: HouseUserData): HouseNumber[] {
    const town = houseTownKey(house.id);
    const have = new Set(house.numbers.map(n => houseKey(n.house)));
    const out = [...house.numbers];
    for (const n of research) {
        const text = n.number.trim();
        if (!text || n.proposed) continue;
        const key = houseKey(text);
        if (have.has(key) || user?.split?.includes(`${town}|${key}`)) continue;
        have.add(key);
        const from = yearOf(n.from) ?? undefined;
        const to = yearOf(n.to) ?? undefined;
        out.push({ house: text, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), source: 'research' });
    }
    return out.sort((a, b) => (a.from ?? Number.POSITIVE_INFINITY) - (b.from ?? Number.POSITIVE_INFINITY)
        || compareHouses(a.house, b.house));
}

// ==================== STORED (StromData.houses) ====================

const HOUSE_ID_RE = /^[^|]{1,200}\|[^|]{1,200}$/;
const REVEAL_ID_RE = /^[A-Za-z0-9_.-]{1,40}$/;

export function isHouseId(v: unknown): v is HouseId {
    return typeof v === 'string' && HOUSE_ID_RE.test(v) && v === v.trim();
}

/** One house's data as stored, checked: only valid fields, none = null. */
export function sanitizeHouseUserData(id: HouseId, value: unknown): HouseUserData | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const out: HouseUserData = {};
    if (typeof v.name === 'string' && v.name.trim()) out.name = v.name.trim().slice(0, 200);
    const ids = (list: unknown): HouseId[] => Array.isArray(list)
        ? [...new Set(list.filter((x): x is HouseId => isHouseId(x) && x !== id))].slice(0, 200) : [];
    const merged = ids(v.merged);
    if (merged.length) out.merged = merged;
    const split = ids(v.split);
    if (split.length) out.split = split;
    const loc = v.location as Record<string, unknown> | undefined;
    if (loc && typeof loc === 'object' && typeof loc.lat === 'number' && typeof loc.lng === 'number'
        && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180
        && (loc.how === 'manual' || loc.how === 'confirmed')) {
        out.location = { lat: loc.lat, lng: loc.lng, how: loc.how };
    }
    if (Array.isArray(v.revealInOutputs)) {
        const reveal = [...new Set(v.revealInOutputs.filter((x): x is string => typeof x === 'string' && REVEAL_ID_RE.test(x)))].slice(0, 1000);
        if (reveal.length) out.revealInOutputs = reveal;
    }
    if (v.hideLocation === true) out.hideLocation = true;
    return Object.keys(out).length ? out : null;
}

/** StromData.houses as stored, checked (data version 27): valid houses with something said; none = undefined. */
export function sanitizeHouses(value: unknown): Record<HouseId, HouseUserData> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const out: Record<HouseId, HouseUserData> = {};
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!isHouseId(id)) continue;
        const clean = sanitizeHouseUserData(id, entry);
        if (clean) out[id] = clean;
    }
    return Object.keys(out).length ? out : undefined;
}

/**
 * What was said about houses is the tree's own, not the research's: a
 * version the research sends keeps the previous state's. A GEDCOM file
 * carries only a house's name and the houses joined to it (`_HOUSE`,
 * src/ged-houses.ts): those of a house the file names come from the file,
 * everything else (houses told apart, the location, events revealed, the
 * houses the file does not name) stays as it was. Returns `next` itself when
 * nothing is carried.
 */
export function keepHouses(next: StromData, previous: StromData): StromData {
    if (!previous.houses || !Object.keys(previous.houses).length) return next;
    const out = structuredClone(previous.houses) as Record<HouseId, HouseUserData>;
    for (const [id, theirs] of Object.entries(next.houses ?? {})) {
        const entry: HouseUserData = out[id] ?? {};
        if (theirs.name) entry.name = theirs.name;
        if (theirs.merged?.length) entry.merged = [...new Set([...(entry.merged ?? []), ...theirs.merged])].filter(m => !entry.split?.includes(m));
        if (Object.keys(entry).length) out[id] = entry;
    }
    return { ...next, houses: out };
}

/** What was said about the houses of a part of the tree (its facts' houses); none = undefined. */
export function housesFor(part: StromData, houses: Readonly<Record<HouseId, HouseUserData>> | undefined): Record<HouseId, HouseUserData> | undefined {
    if (!houses) return undefined;
    const ids = houseIdsOf(part);
    const out: Record<HouseId, HouseUserData> = {};
    for (const [id, entry] of Object.entries(houses)) if (ids.has(id)) out[id] = structuredClone(entry);
    return Object.keys(out).length ? out : undefined;
}

/**
 * What was said about houses when another tree is merged in: a house only
 * the incoming tree speaks of is taken whole; for a house both speak of, ours
 * keeps its name and location, the houses joined and told apart are the
 * union of both, except an incoming join that ours told apart (or an incoming
 * word that tells apart what ours joined), which is left out.
 */
export function mergeIncomingHouses(ours: Readonly<Record<HouseId, HouseUserData>> | undefined,
    incoming: Readonly<Record<HouseId, HouseUserData>> | undefined): Record<HouseId, HouseUserData> | undefined {
    const clean = sanitizeHouses(incoming);
    if (!clean) return ours ? structuredClone(ours) as Record<HouseId, HouseUserData> : undefined;
    const out: Record<HouseId, HouseUserData> = ours ? structuredClone(ours) as Record<HouseId, HouseUserData> : {};
    const joined = (a: HouseId, b: HouseId): boolean => !!(ours?.[a]?.merged?.includes(b) || ours?.[b]?.merged?.includes(a));
    const apart = (a: HouseId, b: HouseId): boolean => !!(ours?.[a]?.split?.includes(b) || ours?.[b]?.split?.includes(a));
    for (const [id, theirs] of Object.entries(clean)) {
        const merged = (theirs.merged ?? []).filter(x => !apart(id, x));
        const split = (theirs.split ?? []).filter(x => !joined(id, x));
        const mine = out[id];
        if (!mine) {
            const next: HouseUserData = { ...theirs };
            if (merged.length) next.merged = merged; else delete next.merged;
            if (split.length) next.split = split; else delete next.split;
            if (Object.keys(next).length) out[id] = next;
            continue;
        }
        const union = (a: readonly HouseId[] | undefined, b: readonly HouseId[]): HouseId[] => [...new Set([...(a ?? []), ...b])];
        const m = union(mine.merged, merged);
        const s = union(mine.split, split);
        const r = [...new Set([...(mine.revealInOutputs ?? []), ...(theirs.revealInOutputs ?? [])])];
        if (m.length) mine.merged = m;
        if (s.length) mine.split = s;
        if (r.length) mine.revealInOutputs = r;
        if (!mine.name && theirs.name) mine.name = theirs.name;
        if (!mine.location && theirs.location) mine.location = theirs.location;
        // A location hidden by hand on either side stays hidden (spec 145 T3).
        if (theirs.hideLocation) mine.hideLocation = true;
    }
    return Object.keys(out).length ? out : undefined;
}
