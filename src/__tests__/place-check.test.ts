/**
 * The free check of locations (spec 034 §5). Fictional places and people only;
 * coordinates are made up around one spot (1° of latitude ≈ 111 km).
 */

import { describe, it, expect } from 'vitest';
import {
    checkPlaces, checkCandidate, nearOthers, distanceKm, labelDistrict, checkPlacesCached, placeCheckKey,
    PLACE_FAR_KM, PLACE_NEAR_KM,
} from '../place-check.js';
import { placeGeoHash } from '../place-records.js';
import { sanitizeBridgePlaces } from '../places-bridge.js';
import { placeIdentity } from '../place-identity.js';
import { StromData, Person, PersonId, PlaceGeo } from '../types.js';

const BASE = { lat: 49.6, lon: 15.2 };
/** A point `km` north of the base. */
const north = (km: number): { lat: number; lon: number } => ({ lat: BASE.lat + km / 111.195, lon: BASE.lon });

let seq = 0;
function person(lastName: string, birthPlace: string, birthDate: string, extra: Partial<Person> = {}): Person {
    const id = `p${++seq}` as PersonId;
    return {
        id, firstName: 'Jan', lastName, gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], birthPlace, birthDate, ...extra,
    } as Person;
}

/** The Lhoták family around Lhota 1820–1870, and one more place `far` km away. */
function tree(farKm: number, farGeo: Partial<PlaceGeo> = {}): StromData {
    const people = [
        person('Lhoták', 'Lhota', '1820'),
        person('Lhoták', 'Jinov', '1830'),
        person('Lhotáková', 'Lhotov', '1840'),
        person('Lhoták', 'Horní Lhota', '1850'),
        // A spelling of the family the tree groups.
        person('Lhotak', 'Lhotínek', '1860'),
    ];
    return {
        persons: Object.fromEntries(people.map(p => [p.id, p])),
        partnerships: {},
        surnameVariants: [['Lhoták', 'Lhotak']],
        places: {
            lhota: { ...BASE, label: 'Lhota, okres Jinov, Česko' },
            jinov: { ...north(3), label: 'Jinov, okres Jinov, Česko' },
            lhotov: { ...north(-4), label: 'Lhotov, okres Jinov, Česko' },
            'horni lhota': { ...north(2), label: 'Horní Lhota, okres Jinov, Česko' },
            lhotinek: { ...north(farKm), label: 'Lhotínek, okres Jinov, Česko', ...farGeo },
        },
    };
}

describe('far: from the family’s other places', () => {
    it('a home village beside a family place is not far, though the family’s branch overseas holds most facts', () => {
        const chicago = { lat: 41.88, lon: -87.63 };
        const people = [
            ...['1891', '1895', '1900', '1905', '1910'].map(y => person('Horák', 'Lhota', y)),
            person('Horák', 'Jinov', '1900'),
            ...['1895', '1900', '1905', '1908', '1912', '1915', '1920'].map(y => person('Horák', 'Chicago', y)),
        ];
        const data: StromData = {
            persons: Object.fromEntries(people.map(p => [p.id, p])), partnerships: {},
            places: {
                lhota: { ...BASE, label: 'Lhota, okres Jinov, Česko' },
                jinov: { ...north(15), label: 'Jinov, okres Jinov, Česko' },
                chicago: { ...chicago, label: 'Chicago, Illinois, USA' },
            },
        } as StromData;
        const found = checkPlaces(data);
        expect(found.get('lhota')?.find(f => f.kind === 'far')).toBeUndefined();
        expect(found.get('jinov')?.find(f => f.kind === 'far')).toBeUndefined();
        // The branch's one place overseas, alone there, still asks for a check.
        expect(found.get('chicago')?.[0]).toMatchObject({ kind: 'far', family: 'Horák' });
    });

    it('a village 56 km from home is not far though a branch overseas pulls the family’s median there', () => {
        // Home, a village 56 km away (under PLACE_FAR_KM) and the emigrated branch in Chicago, most facts there.
        const chicago = { lat: 41.88, lon: -87.63 };
        const people = [
            ...['1890', '1896'].map(y => person('Horák', 'Lhota', y)),
            ...['1892', '1898'].map(y => person('Horák', 'Lhotínek', y)),
            ...['1894', '1900', '1902', '1904', '1906', '1910'].map(y => person('Horák', 'Chicago', y)),
        ];
        const data: StromData = {
            persons: Object.fromEntries(people.map(p => [p.id, p])), partnerships: {},
            places: {
                lhota: { ...BASE, label: 'Lhota, okres Jinov, Česko' },
                lhotinek: { ...north(56), label: 'Lhotínek, okres Jinov, Česko' },
                chicago: { ...chicago, label: 'Chicago, Illinois, USA' },
            },
        } as StromData;
        const found = checkPlaces(data);
        expect(found.get('lhotinek')?.find(f => f.kind === 'far')).toBeUndefined();
        expect(found.get('lhota')?.find(f => f.kind === 'far')).toBeUndefined();
        // Chicago is far from each of the family's other places; the distance is to the nearest.
        const chi = found.get('chicago')?.find(f => f.kind === 'far') as { km: number } | undefined;
        expect(chi).toBeDefined();
        expect(chi!.km).toBe(Math.round(Math.min(distanceKm(chicago, BASE), distanceKm(chicago, north(56)))));
    });

    it('marks a place beyond PLACE_FAR_KM with the family and its years', () => {
        const found = checkPlaces(tree(120)).get('lhotinek');
        expect(found?.[0]).toMatchObject({ kind: 'far', family: 'Lhoták', years: [1840, 1850] });
        expect((found?.[0] as { km: number }).km).toBeGreaterThan(115);
        expect(checkPlaces(tree(120)).has('lhota')).toBe(false);
    });

    it('names the family by its basic (masculine) form, the women\'s form joined to it (1103)', () => {
        // A Polish family: more facts of the women (Jaworska) than of the men; the far place is the men's.
        const people = [
            person('Jaworska', 'Wierzbno', '1890'), person('Jaworska', 'Wierzbno', '1895'),
            person('Jaworska', 'Zalesie', '1900'), person('Jaworski', 'Zalesie', '1898'),
            person('Jaworski', 'Odlegle', '1896'),
        ];
        const data: StromData = {
            persons: Object.fromEntries(people.map(p => [p.id, p])), partnerships: {},
            surnameVariants: [['Jaworski', 'Jaworsky', 'Jaworskij']],
            places: {
                wierzbno: { ...BASE, label: 'Wierzbno, Polska' },
                zalesie: { ...north(5), label: 'Zalesie, Polska' },
                odlegle: { ...north(150), label: 'Odległe, Polska' },
            },
        } as StromData;
        const far = checkPlaces(data).get('odlegle')?.[0];
        expect(far).toMatchObject({ kind: 'far', family: 'Jaworski' });
        expect((far as { km: number }).km).toBe(Math.round(distanceKm(north(150), north(5))));
    });

    it('a Czech family is named Lhoták though the women\'s Lhotáková holds most facts', () => {
        const people = [
            ...['1840', '1842', '1845'].map(y => person('Lhotáková', 'Lhota', y)),
            person('Lhoták', 'Jinov', '1841'), person('Lhotáková', 'Lhotínek', '1843'),
        ];
        const data: StromData = {
            persons: Object.fromEntries(people.map(p => [p.id, p])), partnerships: {},
            places: { lhota: { ...BASE, label: 'Lhota' }, jinov: { ...north(3), label: 'Jinov' }, lhotinek: { ...north(120), label: 'Lhotínek' } },
        } as StromData;
        expect(checkPlaces(data).get('lhotinek')?.[0]).toMatchObject({ kind: 'far', family: 'Lhoták' });
    });

    it('the threshold: just under it nothing, just over it marked', () => {
        // The family's nearest other place (1840–1850 here) is Horní Lhota at north(2).
        expect(checkPlaces(tree(PLACE_FAR_KM + 1)).has('lhotinek')).toBe(false);
        expect(checkPlaces(tree(PLACE_FAR_KM + 3)).get('lhotinek')?.[0].kind).toBe('far');
    });

    it('facts more than 20 years apart do not count', () => {
        const t = tree(120);
        const id = Object.values(t.persons).find(p => p.birthPlace === 'Lhotínek')!.id;
        t.persons[id].birthDate = '1900';
        expect(checkPlaces(t).has('lhotinek')).toBe(false);
    });

    it('another family’s places do not count', () => {
        const t = tree(120);
        const id = Object.values(t.persons).find(p => p.birthPlace === 'Lhotínek')!.id;
        t.persons[id].lastName = 'Jinovský';
        expect(checkPlaces(t).has('lhotinek')).toBe(false);
    });
});

describe('Keep and the research’s confirmation', () => {
    it('a location kept ("Keep") is not checked while it stays', () => {
        const at = north(120);
        expect(checkPlaces(tree(120, { keptAt: placeGeoHash(at) })).has('lhotinek')).toBe(false);
        // Moved since: checked again.
        expect(checkPlaces(tree(120, { keptAt: placeGeoHash(north(110)) })).has('lhotinek')).toBe(true);
    });

    it('a location the research confirmed is not checked while it stays', () => {
        const t = tree(120);
        t.placeRecords = { L1: { id: 'L1', names: [{ name: 'Lhotínek' }], coords: north(120), verified: '2026-11-01' } };
        t.placeRefs = { lhotinek: 'L1' };
        expect(checkPlaces(t).has('lhotinek')).toBe(false);
        t.placeRecords.L1.coords = north(100);
        expect(checkPlaces(t).has('lhotinek')).toBe(true);
    });

    it('a location the research confirmed live (the bridge, no GEDCOM records) is not checked while it stays', () => {
        const t = tree(120);
        const live = (at: { lat: number; lon: number }) => sanitizeBridgePlaces({
            places: { L0007: { name: 'Lhotínek', state: 'identified', by: 'research', coords: at, verified: '2026-11-02' } },
            forms: { 'Lhotínek': { place: 'L0007' } },
        })!;
        // The same spot (within the tolerance of the tree's records): exempt.
        expect(checkPlaces(t, { live: live({ lat: north(120).lat + 0.0003, lon: BASE.lon }) }).has('lhotinek')).toBe(false);
        // Confirmed somewhere else: the location here is checked.
        expect(checkPlaces(t, { live: live(north(100)) }).has('lhotinek')).toBe(true);
        // Without the bridge: checked.
        expect(checkPlaces(t).has('lhotinek')).toBe(true);
        // Through the cache too, and the state the dialog shows is "verified", not "check".
        const l = live(north(120));
        const checks = checkPlacesCached(t, l);
        expect(checks.has('lhotinek')).toBe(false);
        expect(checkPlacesCached(t).has('lhotinek')).toBe(true);
        expect(placeIdentity('lhotinek', { data: t, live: l, checks }).state).toBe('verified');
    });
});

describe('multi, district, label', () => {
    it('multi: the geocoder chose among more towns — not for a pick by hand', () => {
        expect(checkPlaces(tree(2, { townChoices: 2 })).get('lhotinek')).toEqual([{ kind: 'multi', count: 2 }]);
        expect(checkPlaces(tree(2, { townChoices: 4 })).get('lhotinek')).toEqual([{ kind: 'multi', count: 4 }]);
        expect(checkPlaces(tree(2, { townChoices: 2, origin: 'hand' })).has('lhotinek')).toBe(false);
    });

    it('district: the record’s parish against the label’s district', () => {
        const t = tree(2);
        t.places!.lhotinek.label = 'Lhotínek, okres Łotów, Polsko';
        t.placeRecords = { L1: { id: 'L1', names: [{ name: 'Lhotínek' }], jurisdictions: [{ kind: 'parish', name: 'Lhotov', from: 1784 }] } };
        t.placeRefs = { lhotinek: 'L1' };
        expect(checkPlaces(t).get('lhotinek')).toEqual([{ kind: 'district', expected: 'Lhotov', actual: 'Łotów', jurisdiction: 'parish' }]);
        // The label names the parish town: fits.
        t.places!.lhotinek.label = 'Lhotínek, Lhotov, okres Jinov, Česko';
        expect(checkPlaces(t).has('lhotinek')).toBe(false);
        expect(labelDistrict('Jinov, Landkreis Lhotau, Bayern')).toBe('Lhotau');
        expect(labelDistrict('Lhota, Česko')).toBeUndefined();
    });

    it('label: a street, a part of a town, another town', () => {
        const t = tree(2);
        t.places!.lhotinek.label = 'Dlouhá ulice, Lhotínek, okres Jinov, Česko';
        expect(checkPlaces(t).get('lhotinek')).toEqual([{ kind: 'label', type: 'street' }]);
        t.places!.lhotinek.label = 'Zahrádky, Lhotínek, okres Jinov, Česko';
        expect(checkPlaces(t).get('lhotinek')).toEqual([{ kind: 'label', type: 'area' }]);
        t.places!.lhotinek.label = 'Jinov, okres Jinov, Česko';
        expect(checkPlaces(t).get('lhotinek')).toEqual([{ kind: 'label', type: 'other-town' }]);
    });

    it('label: an abbreviation spelled out or a shared word is the place', () => {
        const t = tree(2);
        const id = Object.values(t.persons).find(p => p.birthPlace === 'Horní Lhota')!.id;
        t.persons[id].birthPlace = 'H. Lhota';
        t.places = { ...t.places, 'h lhota': { ...north(2), label: 'Horní Lhota, okres Jinov, Česko' } };
        delete t.places['horni lhota'];
        expect(checkPlaces(t).has('h lhota')).toBe(false);
    });
});

describe('checkCandidate, nearOthers, distance', () => {
    it('checks a search result before it is taken', () => {
        const t = tree(2);
        expect(checkCandidate(t, 'lhotinek', { ...north(150), label: 'Lhotínek, okres Łotów, Polsko' })[0])
            .toMatchObject({ kind: 'far', family: 'Lhoták' });
        expect(checkCandidate(t, 'lhotinek', { ...north(5), label: 'Lhotínek, okres Jinov, Česko' })).toEqual([]);
    });

    it('nearOthers: within PLACE_NEAR_KM of the family’s places, else of the tree’s', () => {
        const t = tree(2);
        expect(nearOthers(t, 'lhotinek', north(PLACE_NEAR_KM - 3))).toBe(true);
        expect(nearOthers(t, 'lhotinek', north(PLACE_NEAR_KM + 8))).toBe(false);
        expect(nearOthers(t, 'nowhere', north(1))).toBe(true);
        expect(nearOthers({ persons: {}, partnerships: {} }, 'x', BASE)).toBe(false);
    });

    it('distanceKm', () => {
        expect(Math.round(distanceKm(BASE, north(100)))).toBe(100);
    });

    it('the cache follows what the check reads', () => {
        const t = tree(120);
        const a = checkPlacesCached(t);
        expect(checkPlacesCached(t)).toBe(a);
        const key = placeCheckKey(t);
        t.places!.lhotinek = { ...north(3), label: 'Lhotínek, okres Jinov, Česko' };
        expect(placeCheckKey(t)).not.toBe(key);
        expect(checkPlacesCached(t).has('lhotinek')).toBe(false);
    });
});
