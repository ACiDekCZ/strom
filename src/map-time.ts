/**
 * Migration over time (P5 — the second half of the map, A6/O3).
 *
 * A pure data harvest: given a tree (and optionally the people currently in
 * scope), it gathers every DATED place reference — a birth, a death, an event,
 * a wedding — as one point per (year, place, person). The map view then reveals
 * these cumulatively along a time slider, so the family's movement across the
 * land becomes visible.
 *
 * No DOM, no network, no coordinates lookup: the keys are produced with the
 * same `placeKey` the coordinates registry uses, so a point lines up with its
 * pin in `data.places` by key. Whether a point can actually be DRAWN (has
 * coordinates) is the map view's business — this module only reads the tree.
 */

import { StromData, PersonId } from './types.js';
import { placeKey, collectPlaces, forEachPlaceFact, MapKind } from './places.js';
import { yearOf } from './dates.js';

/**
 * What kind of record a dated point came from — the map kinds (places.ts):
 * a baptism is a birth, a burial or a cremation a death, the steps to a
 * wedding (engagement, banns, licence, contract, settlement) the wedding.
 */
export type DatedPointKind = MapKind;

/** One dated place reference: a person was somewhere in a given year. */
export interface DatedPoint {
    year: number;
    placeKey: string;
    personId: PersonId;
    kind: DatedPointKind;
}

export interface DatedPlaceHarvest {
    /** Every dated point, sorted deterministically (year → place → kind → person). */
    points: DatedPoint[];
    /**
     * Places that DO have coordinates and are used in scope, but carry no
     * parseable date anywhere — they cannot sit on the time axis, so the map
     * owns up to them ("N places without a date are not shown") instead of
     * letting them vanish silently. Places with no coordinates are already
     * reported by the ordinary "without coordinates" status, so they are not
     * counted here.
     */
    undatedPlaceCount: number;
    /** Range of the slider, null when nothing is dated (the toggle stays off). */
    minYear: number | null;
    maxYear: number | null;
}

/**
 * Gather every dated place reference for the people in scope. Sources:
 *   - birthDate + birthPlace
 *   - deathDate + deathPlace
 *   - each life event's date + place
 *   - a wedding's startDate + startPlace — a point for BOTH partners in scope
 *   - a divorce's endDate + endPlace and each couple event's date + place —
 *     likewise for both partners
 * Each point carries its map kind (see DatedPointKind). `kinds` keeps only
 * the facts of those kinds: the points, the year range and
 * `undatedPlaceCount` come from them alone; without it every fact counts.
 *
 * A reference contributes a point only when it has BOTH a parseable year (flex
 * dates such as `~1880` or a `1880..1885` range resolve to their year/start)
 * AND a non-empty place. Missing either, it is skipped; a place whose every
 * reference is undated is tallied into `undatedPlaceCount` when it has a pin.
 */
export function collectDatedPlacePoints(
    data: StromData,
    personFilter?: ReadonlySet<PersonId>,
    kinds?: ReadonlySet<MapKind>,
): DatedPlaceHarvest {
    const kept = (id: PersonId): boolean => !personFilter || personFilter.has(id);
    const points: DatedPoint[] = [];

    forEachPlaceFact(data, fact => {
        if (kinds && !kinds.has(fact.kind)) return;
        const year = yearOf(fact.date);
        const place = fact.place?.trim();
        if (year === null || !place) return;
        const key = placeKey(place);
        if (!key) return;
        // A couple's fact happened to both partners: each one in scope gets a point.
        for (const personId of fact.persons) {
            if (kept(personId)) points.push({ year, placeKey: key, personId, kind: fact.kind });
        }
    });

    points.sort((a, b) =>
        a.year - b.year ||
        a.placeKey.localeCompare(b.placeKey) ||
        a.kind.localeCompare(b.kind) ||
        String(a.personId).localeCompare(String(b.personId)));

    let undatedPlaceCount = 0;
    if (data.places) {
        const datedKeys = new Set(points.map(p => p.placeKey));
        for (const [key] of collectPlaces(data, personFilter, kinds)) {
            if (data.places[key] && !datedKeys.has(key)) undatedPlaceCount++;
        }
    }

    const years = points.map(p => p.year);
    return {
        points,
        undatedPlaceCount,
        minYear: years.length ? Math.min(...years) : null,
        maxYear: years.length ? Math.max(...years) : null,
    };
}
