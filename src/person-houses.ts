/**
 * The houses of a person (spec 030 §12): which house of the tree an event's
 * address is, and the houses a person had facts at with the person's years
 * there. Read on the tree an output shows (a protected copy for a file), so
 * nothing of a protected person comes in. Pure.
 */

import { collectHouses, findHouse, houseContext, houseOfFact, type TreeHouse } from './houses.js';
import { forEachPlaceFact } from './places.js';
import type { HouseId, PersonId, StromData } from './types.js';

/** A person's house on the person page: the town, the house as the tree writes it, the person's years there. */
export interface PersonHouse {
    id: HouseId;
    town: string;
    text: string;
    from?: number;
    to?: number;
}

/** The tree's houses and the house of each place + address the tree writes. */
export interface TreeHouseIndex {
    houses: TreeHouse[];
    byAddress: Map<string, HouseId>;
}

const addressKey = (place: string, address: string): string => `${place.trim()}\u0000${address.trim()}`;

/** The houses of a tree and the house of every address its facts write (once per tree). */
export function treeHouseIndex(data: StromData): TreeHouseIndex {
    const houses = collectHouses(data);
    const byAddress = new Map<string, HouseId>();
    if (!houses.length) return { houses, byAddress };
    const ctx = houseContext(data);
    forEachPlaceFact(data, fact => {
        const place = fact.place?.trim();
        const address = fact.house?.trim();
        if (!place || !address) return;
        const key = addressKey(place, address);
        if (byAddress.has(key)) return;
        const ref = houseOfFact(fact, ctx);
        const house = ref ? findHouse(data, ref.town, ref.house, houses) : null;
        if (house) byAddress.set(key, house.id);
    });
    return { houses, byAddress };
}

/** The house an event's place and address are (null: no house of the tree). */
export function houseOfAddress(index: TreeHouseIndex, place: string | undefined, address: string | undefined): HouseId | null {
    if (!place?.trim() || !address?.trim()) return null;
    return index.byAddress.get(addressKey(place, address)) ?? null;
}

/** The houses a person had facts at, by the person's first year there (undated last). */
export function personHouses(index: TreeHouseIndex, personId: PersonId): PersonHouse[] {
    const out: PersonHouse[] = [];
    for (const h of index.houses) {
        if (!h.personIds.includes(personId)) continue;
        const years = h.facts.filter(f => f.personId === personId && f.year !== undefined).map(f => f.year!);
        out.push({
            id: h.id, town: h.ref.town, text: h.text,
            ...(years.length ? { from: Math.min(...years), to: Math.max(...years) } : {}),
        });
    }
    return out.sort((a, b) => (a.from ?? Number.POSITIVE_INFINITY) - (b.from ?? Number.POSITIVE_INFINITY)
        || a.town.localeCompare(b.town) || a.text.localeCompare(b.text));
}
