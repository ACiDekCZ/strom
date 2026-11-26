/**
 * The research's results of houses for a family book (spec 030 §8, K7.3):
 * when the book has the Houses chapter, the index of houses or a house as its
 * selection and the bridge offers `house`, the book reads the list of houses
 * (`GET /houses`) and the result of each of its houses the research has
 * (`GET /houses/<key>`), a few at a time. Any failure leaves the house (or
 * every house) without the research: the book is built from the tree, with
 * no error shown. Pure of the DOM; the reads are injected for the tests.
 */

import type { HouseId } from './types.js';
import type { TreeHouse } from './houses.js';
import { houseGroupIds } from './houses-view.js';
import { fetchHouse, fetchHouses, type HouseListRow, type HouseResearch } from './house-bridge.js';

/** How many results of houses are read at once. */
export const BOOK_HOUSE_READS = 4;

/** What the book got: each house's result, and the houses whose history the research has done. */
export interface BookHouseResearch {
    research: ReadonlyMap<HouseId, HouseResearch>;
    finished: ReadonlySet<HouseId>;
}

export interface BookHouseReads {
    list: (base: string) => Promise<{ ok: true; houses: readonly HouseListRow[] } | { ok: false }>;
    house: (base: string, key: string) => Promise<{ ok: true; house: HouseResearch } | { ok: false }>;
}

const bridgeReads: BookHouseReads = {
    list: base => fetchHouses(base),
    house: (base, key) => fetchHouse(base, key),
};

/** The research's row of a tree's house (any of its joined numbers), or null. */
function rowOf(house: TreeHouse, byKey: ReadonlyMap<string, HouseListRow>): HouseListRow | null {
    for (const id of houseGroupIds(house)) {
        const row = byKey.get(id);
        if (row) return row;
    }
    return null;
}

/**
 * Read the research's results of these houses (the book's): the list, then each house the research has a task
 * for, `limit` at a time. Never throws; a failed read leaves its house out.
 */
export async function loadBookHouseResearch(
    base: string, houses: readonly TreeHouse[], reads: BookHouseReads = bridgeReads, limit = BOOK_HOUSE_READS,
): Promise<BookHouseResearch> {
    const research = new Map<HouseId, HouseResearch>();
    const finished = new Set<HouseId>();
    if (!houses.length) return { research, finished };
    let rows: readonly HouseListRow[];
    try {
        const list = await reads.list(base);
        if (!list.ok) return { research, finished };
        rows = list.houses;
    } catch {
        return { research, finished };
    }
    const byKey = new Map(rows.map(r => [r.key, r]));
    const todo: { house: TreeHouse; key: string }[] = [];
    for (const house of houses) {
        const row = rowOf(house, byKey);
        if (!row || row.state === 'none') continue;
        if (row.state === 'done') finished.add(house.id);
        todo.push({ house, key: row.key });
    }
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < todo.length) {
            const job = todo[next++];
            try {
                const r = await reads.house(base, job.key);
                if (r.ok) research.set(job.house.id, r.house);
            } catch { /* built without it */ }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, todo.length)) }, worker));
    return { research, finished };
}
