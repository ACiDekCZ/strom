/**
 * The "Family houses" layer of the Map tab (spec 030 §9), its pure part: which
 * houses of the tree get a point of their own and where. The DOM is
 * src/ui/map-houses-ui.ts.
 *
 * A house's point is the one a person placed or confirmed (HouseUserData.location),
 * else the research's (`HouseResearch.location`, read over the bridge; without the
 * bridge only the person's). The research's 1950s aerial photos are never drawn
 * here: the layer is a layer of points on today's map.
 */

import type { HouseResearch } from './house-bridge.js';
import { housePointLabel } from './house-map.js';
import { project } from './map.js';
import type { TreeHouse } from './houses.js';
import { houseGroupIds } from './houses-view.js';
import type { HouseId, HouseUserData, PersonId, PlaceGeo } from './types.js';

/** Where a house stands on the map, and who says so. */
export interface MapHouseLocation {
    lat: number;
    lon: number;
    how: 'manual' | 'confirmed' | 'research';
}

/** A house drawn as a point of its own. */
export interface MapHousePoint {
    id: HouseId;
    /** Its id and the ids of the numbers joined into it (the town point leaves them all out of its count). */
    ids: HouseId[];
    townKey: string;
    /** "16", "Kopřivná 12": the number on the point. */
    label: string;
    lat: number;
    lon: number;
    how: MapHouseLocation['how'];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The point of a house: the person's (placed or confirmed), else the research's; null: none known. */
export function mapHouseLocation(
    house: Pick<TreeHouse, 'id'>, user: Readonly<Record<HouseId, HouseUserData>> | undefined, research: HouseResearch | null | undefined,
): MapHouseLocation | null {
    const own = user?.[house.id]?.location;
    if (own && finite(own.lat) && finite(own.lng)) return { lat: own.lat, lon: own.lng, how: own.how };
    const r = research?.location;
    if (r && finite(r.lat) && finite(r.lon)) return { lat: r.lat, lon: r.lon, how: 'research' };
    return null;
}

/**
 * The houses drawn as points: those with a point (mapHouseLocation), with
 * somebody of `scope` among their people (undefined: the whole tree). In the
 * tree's order of houses.
 */
export function mapHousePoints(
    houses: readonly TreeHouse[],
    user: Readonly<Record<HouseId, HouseUserData>> | undefined,
    researchOf: (house: TreeHouse) => HouseResearch | null | undefined,
    scope?: ReadonlySet<PersonId>,
): MapHousePoint[] {
    const out: MapHousePoint[] = [];
    for (const h of houses) {
        if (scope && !h.personIds.some(id => scope.has(id))) continue;
        const at = mapHouseLocation(h, user, researchOf(h));
        if (!at) continue;
        out.push({ id: h.id, ids: houseGroupIds(h), townKey: h.townKey, label: housePointLabel(h.text), lat: at.lat, lon: at.lon, how: at.how });
    }
    return out;
}

/**
 * How far (CSS px) a house's pill must stand from its town's point to be drawn: the town's dot is 26 px, the pill 24 px,
 * and nearer the pill would cover the town's dot (its ⌂ count and its click).
 */
export const HOUSE_TOWN_GAP_PX = 30;

/**
 * The houses drawn apart from their town at this zoom: a house nearer its town's point than `gap` px stays in the town
 * point (counted by its ⌂ and listed in its bubble) until the map is zoomed in. A town not on the map keeps its houses.
 */
export function housesApartFromTowns<T extends Pick<MapHousePoint, 'townKey' | 'lat' | 'lon'>>(
    points: readonly T[], towns: ReadonlyMap<string, PlaceGeo>, zoom: number, gap = HOUSE_TOWN_GAP_PX,
): T[] {
    return points.filter(p => {
        const town = towns.get(p.townKey);
        if (!town) return true;
        const a = project({ lat: p.lat, lon: p.lon }, zoom);
        const b = project(town, zoom);
        return Math.hypot(a.x - b.x, a.y - b.y) >= gap;
    });
}

/** The house ids that have a point of their own (each house's joined numbers too): a town point counts the others. */
export function housesWithPoint(points: readonly Pick<MapHousePoint, 'ids'>[]): Set<string> {
    const out = new Set<string>();
    for (const p of points) for (const id of p.ids) out.add(id);
    return out;
}

/**
 * The layer's switch: shown only when some house of the tree has a point;
 * on by default, else as last switched on this device (`stored`).
 */
export function mapHousesSwitch(anyPoint: boolean, stored: boolean | null): { shown: boolean; on: boolean } {
    return { shown: anyPoint, on: anyPoint && stored !== false };
}

/** "1781–1934 · Prouzal → Kvitelka → Prouzal · 23 people": what the house bubble says of a house under its title. */
export function mapHouseSummary(house: Pick<TreeHouse, 'period' | 'surnames' | 'persons'>, persons: (n: number) => string): string {
    const years = house.period ? (house.period.from === house.period.to ? `${house.period.from}` : `${house.period.from}–${house.period.to}`) : '';
    return [years, house.surnames.join(' → '), house.persons > 0 ? persons(house.persons) : ''].filter(Boolean).join(' · ');
}
