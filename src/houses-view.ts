/**
 * The Houses window's list (spec 030 §1, K1.2), without the DOM: the search
 * (town, number, surname), the chip "With history only", the sort, the towns
 * with their counts, and what joining or telling houses apart writes into
 * StromData.houses. The houses themselves come from collectHouses.
 */

import type { HouseId, HouseUserData, PersonId, StromData } from './types.js';
import { compareHouses, houseIsStreet, houseKey, placeKey } from './places.js';
import { foldSearch } from './history-manage.js';
import type { HouseNumber, TreeHouse } from './houses.js';

/** How the houses of a town are ordered: by number, the oldest first, the most people first. */
export type HousesSort = 'number' | 'oldest' | 'people';

export const HOUSES_SORTS: readonly HousesSort[] = ['number', 'oldest', 'people'];

export function readHousesSort(v: unknown): HousesSort {
    return HOUSES_SORTS.includes(v as HousesSort) ? v as HousesSort : 'number';
}

export interface HousesFilter {
    query: string;
    onlyHistory: boolean;
    /** One town only (its placeKey), when opened from a town. */
    town?: string;
}

/** A town of the window: its houses with history (sorted), the others under "More houses", its counts. */
export interface HouseTownGroup {
    townKey: string;
    /** The town as the tree writes it most. */
    town: string;
    /** Houses with history (over the threshold) that pass the filter, sorted. */
    houses: TreeHouse[];
    /** Houses below the threshold that pass the filter, by number. */
    more: TreeHouse[];
    /** Every house of the town (before the filter). */
    total: number;
    /** Houses with history of the town (before the filter). */
    withHistory: number;
    /** Distinct house numbers of the town (every number of every house). */
    numbers: number;
    /** Distinct people with a fact at a house of the town. */
    persons: number;
}

export interface HousesListResult {
    groups: HouseTownGroup[];
    /** Houses shown (after the filter). */
    shown: number;
    /** Every house (before the filter, within the town when one is chosen). */
    total: number;
    /** Towns with a house shown. */
    towns: number;
}

/** The search text of a house: its town, numbers, name, surnames and the surnames of its people. */
export function houseSearchText(house: TreeHouse, data?: StromData): string {
    const parts = [house.ref.town, house.text, ...house.numbers.map(n => n.house), house.name ?? '', ...house.surnames];
    if (data) {
        for (const id of house.personIds) {
            const p = data.persons[id];
            if (p?.lastName) parts.push(p.lastName);
            if (p?.marriedSurname) parts.push(p.marriedSurname);
        }
    }
    return foldSearch(parts.join(' \u0001 '));
}

/**
 * Does a house match the search: a number written any way ("16", "čp. 16")
 * is that house; otherwise every word of the query is in its town, numbers,
 * name or surnames (folded, without diacritics).
 */
export function houseMatches(house: TreeHouse, query: string, searchText?: string): boolean {
    const q = query.trim();
    if (!q) return true;
    if (/\d/.test(q)) {
        const key = houseKey(q);
        if (key && house.numbers.some(n => houseKey(n.house) === key)) return true;
    }
    const text = searchText ?? houseSearchText(house);
    return foldSearch(q).split(/\s+/).filter(Boolean).every(w => text.includes(w));
}

/** The houses in the order of the sort (ties by number). */
export function sortHouses(list: readonly TreeHouse[], sort: HousesSort): TreeHouse[] {
    const byNumber = (a: TreeHouse, b: TreeHouse): number => compareHouses(a.text, b.text);
    const from = (h: TreeHouse): number => h.period?.from ?? Number.POSITIVE_INFINITY;
    return [...list].sort((a, b) => {
        if (sort === 'oldest') return from(a) - from(b) || byNumber(a, b);
        if (sort === 'people') return b.persons - a.persons || byNumber(a, b);
        return byNumber(a, b);
    });
}

const mostOf = (m: ReadonlyMap<string, number>): string =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';

/**
 * The window's towns: each with its houses with history (sorted) and the
 * others (by number), the counts of the whole town, towns by their number of
 * houses (most first), then by name. A town with nothing left after the
 * filter is left out. `searchTexts` (by house id) saves building them again.
 */
export function houseTownGroups(houses: readonly TreeHouse[], filter: HousesFilter, sort: HousesSort,
    searchTexts?: ReadonlyMap<HouseId, string>, lang?: string): HousesListResult {
    const town = filter.town ? placeKey(filter.town) : '';
    const byTown = new Map<string, TreeHouse[]>();
    for (const h of houses) {
        if (town && h.townKey !== town) continue;
        const list = byTown.get(h.townKey) ?? [];
        list.push(h);
        byTown.set(h.townKey, list);
    }
    const collator = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    const groups: HouseTownGroup[] = [];
    let shown = 0;
    let total = 0;
    for (const [townKey, list] of byTown) {
        total += list.length;
        const names = new Map<string, number>();
        const numbers = new Set<string>();
        const persons = new Set<PersonId>();
        for (const h of list) {
            names.set(h.ref.town, (names.get(h.ref.town) ?? 0) + h.facts.length);
            for (const n of h.numbers) numbers.add(houseKey(n.house));
            for (const p of h.personIds) persons.add(p);
        }
        const passing = list.filter(h => (!filter.onlyHistory || h.overThreshold)
            && houseMatches(h, filter.query, searchTexts?.get(h.id)));
        if (passing.length === 0) continue;
        shown += passing.length;
        groups.push({
            townKey,
            town: mostOf(names),
            houses: sortHouses(passing.filter(h => h.overThreshold), sort),
            more: sortHouses(passing.filter(h => !h.overThreshold), 'number'),
            total: list.length,
            withHistory: list.filter(h => h.overThreshold).length,
            numbers: numbers.size,
            persons: persons.size,
        });
    }
    groups.sort((a, b) => b.total - a.total || collator.compare(a.town, b.town) || (a.townKey < b.townKey ? -1 : 1));
    return { groups, shown, total, towns: groups.length };
}

/** The number a house goes by now (its own, the last of its numbers in time when they are dated). */
export function houseCurrentNumber(house: Pick<TreeHouse, 'text'>): string {
    return house.text;
}

/**
 * The house's other numbers, oldest first, as "formerly" shows them: the
 * number alone ("9" of "čp. 9"), a street with its number whole. Its own
 * number and repeats are left out.
 */
export function houseFormerNumbers(house: Pick<TreeHouse, 'text'>, numbers: readonly HouseNumber[]): string[] {
    const own = houseKey(house.text);
    const seen = new Set<string>([own]);
    const out: string[] = [];
    for (const n of numbers) {
        const key = houseKey(n.house);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(houseIsStreet(n.house) ? n.house.trim() : key);
    }
    return out;
}

// ==================== JOINED / TOLD APART (StromData.houses) ====================

type HouseChanges = Record<HouseId, HouseUserData | undefined>;

const without = (list: readonly HouseId[] | undefined, ids: ReadonlySet<HouseId>): HouseId[] | undefined => {
    const next = (list ?? []).filter(x => !ids.has(x));
    return next.length ? next : undefined;
};

function entry(base: HouseUserData | undefined, patch: Partial<HouseUserData>): HouseUserData | undefined {
    const next: HouseUserData = { ...(base ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof HouseUserData)[]) if (next[k] === undefined) delete next[k];
    return Object.keys(next).length ? next : undefined;
}

/**
 * "Merge with another house…": the house `other` (with whatever was joined
 * into it) becomes a former number of `into`. A word that told the two apart
 * goes (on both sides). Returns the changed entries only.
 */
export function mergeHouseChanges(user: Readonly<Record<HouseId, HouseUserData>> | undefined, into: HouseId, other: HouseId): HouseChanges {
    if (into === other) return {};
    const out: HouseChanges = {};
    const here = user?.[into];
    const merged = [...new Set([...(here?.merged ?? []), other])];
    out[into] = entry(here, { merged, split: without(here?.split, new Set([other])) });
    const there = user?.[other];
    if (there?.split?.includes(into)) out[other] = entry(there, { split: without(there.split, new Set([into])) });
    return out;
}

/**
 * "It is a different house…": the number `member` leaves the house `house`
 * (whose numbers are `group`, the ids joined into it) and stays apart from
 * it: no entry joins it any more, it joins none of the group, and the house
 * keeps the word in `split` (a proposal of the research to join them again
 * is refused too). A number the research only proposes (not a house of the
 * tree) just gets the word. Returns the changed entries only.
 */
export function splitHouseChanges(user: Readonly<Record<HouseId, HouseUserData>> | undefined, house: HouseId, member: HouseId,
    group: readonly HouseId[] = []): HouseChanges {
    if (house === member) return {};
    const out: HouseChanges = {};
    const gone = new Set([member]);
    for (const [id, e] of Object.entries(user ?? {})) {
        if (id === member || id === house || !e.merged?.includes(member)) continue;
        out[id] = entry(e, { merged: without(e.merged, gone) });
    }
    const own = user?.[member];
    const ofGroup = new Set<HouseId>([house, ...group]);
    if (own?.merged?.some(x => ofGroup.has(x))) out[member] = entry(own, { merged: without(own.merged, ofGroup) });
    const here = user?.[house];
    out[house] = entry(here, { merged: without(here?.merged, gone), split: [...new Set([...(here?.split ?? []), member])] });
    return out;
}

/** The ids of the tree's houses that make up a house (its own and those joined into it), from its numbers. */
export function houseGroupIds(house: Pick<TreeHouse, 'id' | 'townKey' | 'numbers'>): HouseId[] {
    const ids = new Set<HouseId>([house.id]);
    for (const n of house.numbers) if (n.source !== 'research') ids.add(`${house.townKey}|${houseKey(n.house)}`);
    return [...ids];
}
