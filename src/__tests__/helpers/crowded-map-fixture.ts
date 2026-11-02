/**
 * A fictional tree whose map of places is crowded (1102): the family pages'
 * sample tree, Josef Fíšek moving through 46 made-up hamlets within a few km
 * of each other (one big cluster), two small groups of made-up villages near
 * each other in the north-east (two clusters side by side) and a far village
 * that widens the frame. Every name and position is made up.
 */

import { PersonId } from '../../types.js';
import { placeKey } from '../../places.js';
import { familyPagesFixture, FamilyPagesFixture } from './family-pages-fixture.js';

const HEADS = ['Mlh', 'Vrš', 'Kozl', 'Bříd', 'Žab', 'Pstruž', 'Dřín', 'Hloh'];
const TAILS = ['ovec', 'ínek', 'ůvka', 'iště', 'ánky', 'ečná'];

/** The made-up hamlets of the big cluster, in the order Josef lived there. */
export const CROWDED_HAMLETS: readonly string[] = HEADS.flatMap(h => TAILS.map(t => `${h}${t}`)).slice(0, 46);
/** The two groups of villages side by side (north-east). */
export const NEAR_GROUP_A: readonly string[] = ['Horní Hýlov', 'Dolní Hýlov', 'Hýlovský Mlýn'];
export const NEAR_GROUP_B: readonly string[] = ['Sýkorník', 'Malý Sýkorník'];
/** A far village that widens the frame. */
export const FAR_VILLAGE = 'Vranní Lhota';

export function crowdedMapFixture(): FamilyPagesFixture {
    const fx = familyPagesFixture();
    const { data, ids } = fx;
    const places = { ...(data.places ?? {}) };
    CROWDED_HAMLETS.forEach((name, i) => {
        places[placeKey(name)] = { lat: 50.00 + Math.floor(i / 7) * 0.004, lon: 15.45 + (i % 7) * 0.006 };
    });
    NEAR_GROUP_A.forEach((name, i) => { places[placeKey(name)] = { lat: 50.31 + i * 0.006, lon: 15.75 + i * 0.008 }; });
    NEAR_GROUP_B.forEach((name, i) => { places[placeKey(name)] = { lat: 50.17 + i * 0.006, lon: 15.80 + i * 0.008 }; });
    places[placeKey(FAR_VILLAGE)] = { lat: 50.45, lon: 16.35 };
    const josef = data.persons[ids.josef as PersonId]!;
    const moves = [...CROWDED_HAMLETS, ...NEAR_GROUP_A, ...NEAR_GROUP_B, FAR_VILLAGE];
    josef.events = [
        ...(josef.events ?? []),
        ...moves.map((place, i) => ({ id: `jo-res-${i}`, type: 'residence' as const, date: String(1841 + i), place })), // 1841–1892
    ];
    data.places = places;
    return fx;
}
