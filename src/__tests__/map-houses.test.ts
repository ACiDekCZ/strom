/**
 * The Family houses layer of the Map tab (spec 030 §9): which houses get a
 * point of their own and where, the switch, the bubble's summary, and the
 * town point's "⌂ N" counting only the houses without a point.
 */
import { describe, expect, it } from 'vitest';
import type { PersonId, PlaceGeo, StromData } from '../types.js';
import type { HouseResearch } from '../house-bridge.js';
import { collectHouses } from '../houses.js';
import { collectPlaces, groupTownPoints, placeKey, type MappedPlaceInput, type TownPoint } from '../places.js';
import { HOUSE_TOWN_GAP_PX, housesApartFromTowns, housesWithPoint, mapHouseLocation, mapHousePoints, mapHouseSummary, mapHousesSwitch } from '../map-houses.js';
import { HOUSE_ID, OLD_HOUSE_ID, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const P = (id: string) => id as PersonId;

describe('mapHouseLocation', () => {
    it('takes the point a person placed or confirmed, else the research’s, else none', () => {
        const data = houseTree();
        const research = houseResearch();
        expect(mapHouseLocation({ id: HOUSE_ID }, data.houses, research)).toEqual({ lat: 49.5, lon: 15.2, how: 'manual' });
        expect(mapHouseLocation({ id: OLD_HOUSE_ID }, data.houses, null)).toEqual({ lat: 49.6, lon: 15.3, how: 'confirmed' });
        expect(mapHouseLocation({ id: HOUSE_ID }, undefined, research)).toEqual({ lat: 49.51, lon: 15.21, how: 'research' });
        // Without the bridge (no result) only the person's point.
        expect(mapHouseLocation({ id: HOUSE_ID }, undefined, null)).toBeNull();
        // A broken point is no point.
        const broken = { ...research, location: { ...research.location!, lat: Number.NaN } } as HouseResearch;
        expect(mapHouseLocation({ id: HOUSE_ID }, {}, broken)).toBeNull();
    });
});

describe('mapHousePoints', () => {
    it('draws the houses with a point, numbered without "čp.", narrowed to the map’s people', () => {
        const data = houseTree();
        const houses = collectHouses(data);
        const all = mapHousePoints(houses, data.houses, () => null);
        expect(all.map(p => [p.id, p.label, p.how])).toEqual([
            [HOUSE_ID, '16', 'manual'],
            [OLD_HOUSE_ID, '3', 'confirmed'],
        ]);
        // Only Drahobud and Radegunda were at Mlýnkovice čp. 3.
        const scoped = mapHousePoints(houses, data.houses, () => null, new Set([P('drahobud')]));
        expect(scoped.map(p => p.id)).toEqual([OLD_HOUSE_ID]);
        expect(mapHousePoints(houses, data.houses, () => null, new Set([P('nobody')]))).toEqual([]);
    });

    it('takes the research’s point of a house without one of the person', () => {
        const data = houseTree();
        delete data.houses![HOUSE_ID].location;
        const houses = collectHouses(data);
        const research = houseResearch();
        const points = mapHousePoints(houses, data.houses, h => h.id === HOUSE_ID ? research : null);
        expect(points.find(p => p.id === HOUSE_ID)).toMatchObject({ lat: 49.51, lon: 15.21, how: 'research' });
        // Nothing read yet: only the confirmed house.
        expect(mapHousePoints(houses, data.houses, () => null).map(p => p.id)).toEqual([OLD_HOUSE_ID]);
    });

    it('lists a house’s joined numbers among the ids with a point', () => {
        const data = houseTree();
        data.persons[P('hostivit')].deathAddress = 'čp. 9';
        data.houses![HOUSE_ID].merged = ['belokamen|9'];
        const points = mapHousePoints(collectHouses(data), data.houses, () => null);
        expect(points.map(p => p.id)).toEqual([HOUSE_ID, OLD_HOUSE_ID]);
        expect([...housesWithPoint(points)].sort()).toEqual(['belokamen|9', HOUSE_ID, OLD_HOUSE_ID].sort());
    });
});

describe('mapHousesSwitch', () => {
    it('is shown only with a house point, on by default and as last switched', () => {
        expect(mapHousesSwitch(false, null)).toEqual({ shown: false, on: false });
        expect(mapHousesSwitch(false, true)).toEqual({ shown: false, on: false });
        expect(mapHousesSwitch(true, null)).toEqual({ shown: true, on: true });
        expect(mapHousesSwitch(true, true)).toEqual({ shown: true, on: true });
        expect(mapHousesSwitch(true, false)).toEqual({ shown: true, on: false });
    });
});

describe('mapHouseSummary', () => {
    it('joins the years, the surnames and the people', () => {
        const persons = (n: number) => `${n} people`;
        expect(mapHouseSummary({ period: { from: 1781, to: 1934 }, surnames: ['Prouzal', 'Kvitelka', 'Prouzal'], persons: 23 }, persons))
            .toBe('1781–1934 · Prouzal → Kvitelka → Prouzal · 23 people');
        expect(mapHouseSummary({ period: { from: 1900, to: 1900 }, surnames: [], persons: 1 }, persons)).toBe('1900 · 1 people');
        expect(mapHouseSummary({ surnames: [], persons: 0 }, persons)).toBe('');
    });
});

describe('groupTownPoints with houses drawn on their own', () => {
    const mapped = (data: StromData): MappedPlaceInput[] =>
        [...collectPlaces(data)].filter(([k]) => data.places?.[k]).map(([key, usage]) => ({ key, usage, geo: data.places![key] }));

    it('counts in the town’s tag only the houses without a point of their own', () => {
        const data = houseTree();
        // A second and a third house of Bělokamen, none with a point.
        data.persons[P('hostivit')].deathAddress = 'čp. 4';
        data.persons[P('lubor')].deathAddress = 'čp. 31';
        const exact: PlaceGeo = { lat: 49.5, lon: 15.2 };
        data.places = { [placeKey('Bělokamen')]: exact };
        const town = (withPoint?: ReadonlySet<string>) =>
            groupTownPoints(mapped(data), undefined, withPoint).find(p => p.type === 'town') as TownPoint;
        const plain = town();
        expect(plain.houses.map(h => h.house)).toEqual(['čp. 4', 'čp. 16', 'čp. 31']);
        expect(plain.houseCount).toBe(3);
        expect(plain.housesHere).toBe(3);
        const drawn = town(new Set([HOUSE_ID]));
        expect(drawn.houseCount).toBe(3);
        expect(drawn.housesHere).toBe(2);
        // A house of another town with a point changes nothing here.
        expect(town(new Set([OLD_HOUSE_ID])).housesHere).toBe(3);
    });
});

describe('housesApartFromTowns', () => {
    const town: PlaceGeo = { lat: 49.5, lon: 15.2 };
    // About 330 m north of the town's point.
    const near = { id: 'a', townKey: 'belokamen', lat: 49.503, lon: 15.2 };
    const towns = new Map([['belokamen', town]]);

    it('keeps a house over its town\'s point in the town at a town\'s zoom, draws it once zoomed in', () => {
        // Zoom 11 (the map of one town): ~7 px from the town's dot, under it.
        expect(housesApartFromTowns([near], towns, 11)).toEqual([]);
        // Zoom 14: ~55 px apart, its own pill.
        expect(housesApartFromTowns([near], towns, 14)).toEqual([near]);
    });

    it('measures the gap in screen pixels: under it the house stays in the town', () => {
        // Zoom 13: ~27 px apart, the pill (24 px) would still touch the town's dot (26 px).
        expect(HOUSE_TOWN_GAP_PX).toBeGreaterThanOrEqual(26);
        expect(housesApartFromTowns([near], towns, 13)).toEqual([]);
        expect(housesApartFromTowns([near], towns, 13, 26)).toEqual([near]);
    });

    it('a house whose town is not on the map keeps its pill', () => {
        expect(housesApartFromTowns([{ ...near, townKey: 'zalesi' }], towns, 5)).toHaveLength(1);
    });
});
