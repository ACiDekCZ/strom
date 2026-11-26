/**
 * The search finds houses (spec 030 §15): the group "Houses" above the people
 * of the toolbar's search lists the tree's houses whose title, name, number
 * (an older one of a joined house too) or "town number" holds the query; a
 * person found by a house number on a fact leads to that house ("House ›").
 */

import type { StromData } from './types.js';
import { collectHouses, findHouse, houseContext, houseOfFact, houseTitle, type TreeHouse } from './houses.js';
import { normalizeSearchText as normalizeName } from './name-search.js';
import { houseKey } from './places.js';
import type { DetailMatch } from './search-filter.js';

/** How many houses the group shows. */
export const SEARCH_HOUSES_MAX = 5;

/** The tree's houses for a search, read once per data revision. */
export interface SearchHouses {
    houses: TreeHouse[];
    ctx: ReturnType<typeof houseContext>;
}

let cached: { data: StromData; rev: number; value: SearchHouses } | null = null;

/** The houses of `data` at revision `rev` (read again after a change). */
export function searchHousesOf(data: StromData, rev: number): SearchHouses {
    if (cached && cached.data === data && cached.rev === rev) return cached.value;
    const value = { houses: collectHouses(data), ctx: houseContext(data) };
    cached = { data, rev, value };
    return value;
}

/** The words a house is found by: its title, name, numbers and "town number" forms. */
function houseWords(h: TreeHouse): string[] {
    const town = h.ref.town;
    // "Bělokamen čp. 16" and "Bělokamen 16" (the number without its "čp.").
    const words = [houseTitle(h), `${town} ${h.text}`, `${town} ${houseKey(h.text)}`];
    if (h.name) words.push(h.name);
    for (const n of h.numbers) words.push(n.house, `${town} ${n.house}`, `${town} ${houseKey(n.house)}`);
    return words.map(w => normalizeName(w));
}

/**
 * The houses a query finds (normalized as the people's search does, at least
 * three letters), in the tree's order (town, then number), at most `max`.
 */
export function findHousesByQuery(houses: readonly TreeHouse[], query: string, max = SEARCH_HOUSES_MAX): TreeHouse[] {
    const q = normalizeName(query.trim());
    if (q.length < 3) return [];
    const out: TreeHouse[] = [];
    for (const h of houses) {
        if (out.length >= max) break;
        if (h.persons && houseWords(h).some(w => w.includes(q))) out.push(h);
    }
    return out;
}

/** The house a person's found-by line names (a house number on a fact), or null (a cause, a note…). */
export function houseOfDetailMatch(data: StromData, m: DetailMatch, s: SearchHouses): TreeHouse | null {
    if (!m.place?.trim()) return null;
    const ref = houseOfFact({ place: m.place, house: m.value }, s.ctx);
    return ref ? findHouse(data, ref.town, ref.house, s.houses) : null;
}
