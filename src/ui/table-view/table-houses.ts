/**
 * The Table's House column (spec 030 §15): a person's birth house, an event's
 * house — the tree's house a fact's place and address name (as the Houses
 * window collects them). The cell names the house ("Bělokamen čp. 16") and
 * leads to its page; a fact written with an older number of the house says it
 * faint in brackets ("(9)"). Sorted by town, then by number.
 */

import type { StromData } from '../../types.js';
import { collectHouses, findHouse, houseContext, houseOfFact, houseTitle, type TreeHouse } from '../../houses.js';
import { houseKey } from '../../places.js';
import type { CellValue } from './table-model.js';

/** A fact's house: the tree's house, its place in the town-and-number order, the older number the fact names. */
export interface TableHouse {
    house: TreeHouse;
    rank: number;
    old?: string;
}

export interface TableHouses {
    /** The house of a fact's place and address (null: none with a number, or not a house of the tree). */
    of(place: string | undefined, address: string | undefined): TableHouse | null;
}

/** The tree's houses for one model: read at the first fact asked about. */
export function tableHouses(data: StromData): TableHouses {
    let all: { houses: TreeHouse[]; rank: Map<string, number>; ctx: ReturnType<typeof houseContext> } | null = null;
    return {
        of(place, address) {
            if (!place?.trim()) return null;
            if (!all) {
                const houses = collectHouses(data);
                all = { houses, rank: new Map(houses.map((h, i) => [h.id, i])), ctx: houseContext(data) };
            }
            const ref = houseOfFact({ place, ...(address?.trim() ? { house: address } : {}) }, all.ctx);
            const house = ref ? findHouse(data, ref.town, ref.house, all.houses) : null;
            if (!ref || !house) return null;
            const said = houseKey(ref.house);
            return { house, rank: all.rank.get(house.id) ?? Number.MAX_SAFE_INTEGER, ...(said !== houseKey(house.text) ? { old: said } : {}) };
        },
    };
}

const NONE: CellValue = { text: '', sortKey: null, empty: true, na: false, subst: null, computed: true, approx: false, uncertain: false };

/** The House cell: the house's title (with the older number) as a link to its page, sorted by town and number. */
export function houseCell(found: TableHouse | null): CellValue {
    if (!found) return NONE;
    const title = houseTitle(found.house);
    return {
        ...NONE,
        text: found.old ? `${title} (${found.old})` : title,
        sortKey: found.rank,
        empty: false,
        house: { id: found.house.id, title, ...(found.old ? { old: found.old } : {}) },
    };
}
