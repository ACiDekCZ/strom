/**
 * The results of the Places dialog's search (spec 034 §6): order, the
 * warnings at the bottom, at most five, "found as", distances and the
 * description of the cross. Fictional places and people only; coordinates
 * are made up around one spot (1° of latitude ≈ 111 km).
 */

import { describe, it, expect } from 'vitest';
import {
    findResults, findResultTexts, findTreePoints, crossDescription, compassDir, aboutKm, wholeKm, otherForms,
    nearestTreePlace, stampedGeo, FIND_MAX, type FindTreePoint,
} from '../place-find.js';
import type { FormCandidate } from '../geocode.js';
import { StromData, Person, PersonId } from '../types.js';
import { placeGeoHash } from '../place-records.js';

const BASE = { lat: 49.6, lon: 15.2 };
const KM_LAT = 111.195;
/** A point `km` north (negative: south) of the base. */
const north = (km: number): { lat: number; lon: number } => ({ lat: BASE.lat + km / KM_LAT, lon: BASE.lon });
/** A point `dn` km north and `de` km east of `from`. */
const offset = (from: { lat: number; lon: number }, dn: number, de: number): { lat: number; lon: number } => ({
    lat: from.lat + dn / KM_LAT,
    lon: from.lon + de / (KM_LAT * Math.cos(from.lat * Math.PI / 180)),
});

let seq = 0;
function person(lastName: string, birthPlace: string, birthDate: string): Person {
    const id = `p${++seq}` as PersonId;
    return {
        id, firstName: 'Jan', lastName, gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], birthPlace, birthDate,
    } as Person;
}

/** The Lhoták family around Lhota; H. Lhota (1855) has no location yet. */
function tree(): StromData {
    const people = [
        person('Lhoták', 'Lhota', '1820'),
        person('Lhoták', 'Lhotov', '1840'),
        person('Lhoták', 'Horní Lhota', '1850'),
        person('Lhoták', 'Jinov', '1860'),
        person('Lhoták', 'H. Lhota', '1855'),
    ];
    return {
        persons: Object.fromEntries(people.map(p => [p.id, p])),
        partnerships: {},
        places: {
            lhota: { ...BASE, label: 'Lhota, okres Jinov, Česko' },
            lhotov: { ...north(-4), label: 'Lhotov, okres Jinov, Česko' },
            'horni lhota': { ...north(2), label: 'Horní Lhota, okres Jinov, Česko' },
            jinov: { ...north(6), label: 'Jinov, okres Jinov, Česko' },
        },
    };
}

const NAMES: Record<string, string> = { lhota: 'Lhota', lhotov: 'Lhotov', 'horni lhota': 'Horní Lhota', jinov: 'Jinov' };

function hit(form: string, at: { lat: number; lon: number }, label: string, kind: string, settlement: boolean, address?: { name?: string; district?: string; country?: string }): FormCandidate {
    return { form, candidate: { geo: { ...at, label }, settlement, kind, ...(address ? { place: address } : {}) } };
}

/** Six results of "H. Lhota" and its forms, in the order the map gave them. */
function found(): FormCandidate[] {
    return [
        hit('H. Lhota', north(118), 'Hornolhotská, Jinov, Česko', 'road', false),
        hit('Horní Lhota', north(120), 'Horní Lhota, okres Lhotín, Česko', 'village', true, { name: 'Horní Lhota', district: 'okres Lhotín', country: 'Česko' }),
        hit('Horní Lhota', north(-1), 'Horní Lhota, okres Lhotov, Česko', 'village', true, { name: 'Horní Lhota', district: 'okres Lhotov', country: 'Česko' }),
        hit('Horní Lhota', north(30), 'Horní Lhota, Jinov, okres Jinov, Česko', 'suburb', true),
        hit('Hořejší Lhota', north(10), 'Hořejší Lhota, okres Jinov, Česko', 'village', true),
        hit('H. Lhota', north(1), 'Lhotská, Lhota, okres Jinov, Česko', 'road', false),
    ];
}

function results() {
    const data = tree();
    const points = findTreePoints(data, 'h lhota', k => NAMES[k]);
    return findResults({ found: found(), query: 'H. Lhota', key: 'h lhota', data, tree: points });
}

describe('findResults', () => {
    it('orders near → towns → parts of towns, the warned ones last (in the same order), at most five, lettered', () => {
        const r = results();
        expect(r).toHaveLength(FIND_MAX);
        expect(r.map(x => x.letter)).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect(r.map(x => [x.name, x.kind, x.near, x.warnings.length > 0])).toEqual([
            ['Horní Lhota', 'settlement', true, false],
            ['Hořejší Lhota', 'settlement', true, false],
            ['Horní Lhota', 'suburb', false, false],
            ['Lhotská', 'road', true, true],
            ['Horní Lhota', 'settlement', false, true],
        ]);
        // The sixth (a far street) does not fit.
        expect(r.some(x => x.name === 'Hornolhotská')).toBe(false);
    });

    it('a warning: the far result and the label say why', () => {
        const r = results();
        // The label's first part is not the place (it names Lhota only after it).
        expect(r[3]!.warnings).toEqual([{ kind: 'label', type: 'area' }]);
        expect(findResultTexts(r[3]!, 'en').warning).toBe('The map found an area, not a town.');
        expect(r[4]!.warnings[0]).toMatchObject({ kind: 'far', family: 'Lhoták' });
        const t = findResultTexts(r[4]!, 'en');
        expect(t.warning).toMatch(/^11\d km from the other places of the Lhoták family in 1840–1860\.$/);
        expect(t.distance).toMatch(/^11\d km from the family’s other places$/);
    });

    it('found under another form: "found as"; under the typed one: nothing', () => {
        const r = results();
        expect(r[0]!.foundAs).toBe('Horní Lhota');
        expect(findResultTexts(r[0]!, 'cs').foundAs).toBe('nalezeno jako Horní Lhota');
        expect(r[3]!.foundAs).toBeUndefined();
        expect(findResultTexts(r[3]!, 'en').foundAs).toBe('');
        expect(otherForms(['H. Lhota', 'Horní Lhota', 'Hořejší Lhota'], 'H. Lhota')).toEqual(['Horní Lhota', 'Hořejší Lhota']);
    });

    it('the lines: kind · district, country; the distance from the nearest place of the tree', () => {
        const [a, b] = results();
        expect(findResultTexts(a!, 'en')).toMatchObject({ sub: 'town · okres Lhotov, Česko', distance: '1 km from Lhota', warning: '' });
        // Without address parts the rest of the label says where.
        expect(findResultTexts(b!, 'cs')).toMatchObject({ sub: 'obec · okres Jinov, Česko', distance: '4 km od místa Jinov' });
    });

    it('a result at a place of the tree, and a tree with no other place', () => {
        const data = tree();
        const points = findTreePoints(data, 'h lhota', k => NAMES[k]);
        const [at] = findResults({ found: [hit('H. Lhota', offset(BASE, 0.1, 0.1), 'Lhota, Česko', 'village', true)], query: 'H. Lhota', key: 'h lhota', data, tree: points });
        expect(findResultTexts(at!, 'en').distance).toBe('right at Lhota');
        const [none] = findResults({ found: [hit('H. Lhota', BASE, 'Lhota', 'village', true)], query: 'H. Lhota', key: 'h lhota', data: { persons: {}, partnerships: {} }, tree: [] });
        expect(none!.distance).toBeUndefined();
        expect(none!.near).toBe(false);
    });

    it('findTreePoints leaves the place itself out', () => {
        const data = tree();
        expect(findTreePoints(data, 'lhota', k => NAMES[k]).map(p => p.key)).not.toContain('lhota');
        expect(findTreePoints(data, 'x', () => undefined)).toEqual([]);
    });
});

describe('the cross of Place by hand', () => {
    const LHOTOV: FindTreePoint = { key: 'lhotov', name: 'Lhotov', ...BASE };
    const JINOV: FindTreePoint = { key: 'jinov', name: 'Jinov', ...offset(BASE, 0, 40) };

    it('the eight directions', () => {
        const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
        dirs.forEach(([n, e], i) => expect(compassDir(BASE, offset(BASE, n! * 5, e! * 5))).toBe(i));
        // Close to a boundary: 20° east of north is still north.
        expect(compassDir(BASE, offset(BASE, 10, 3.6))).toBe(0);
        expect(compassDir(BASE, offset(BASE, 10, 4.3))).toBe(1);
    });

    it('rounding: whole under 10, to 5 under 100, to 10 above; at least 1', () => {
        expect([aboutKm(0.6), aboutKm(3.4), aboutKm(9.4), aboutKm(12), aboutKm(47.4), aboutKm(123), aboutKm(126)]).toEqual([1, 3, 9, 10, 45, 120, 130]);
        expect([wholeKm(0.2), wholeKm(4.4), wholeKm(118.6)]).toEqual([1, 4, 119]);
    });

    it('says it by the nearest place of the tree', () => {
        const sw = offset(BASE, -3 / Math.SQRT2, -3 / Math.SQRT2);
        expect(crossDescription(sw, [LHOTOV, JINOV], 'en')).toBe('Cross: about 3 km south-west of Lhotov');
        expect(crossDescription(sw, [LHOTOV, JINOV], 'cs')).toBe('Kříž: asi 3 km jihozápadně od místa Lhotov');
        expect(crossDescription(sw, [LHOTOV, JINOV], 'de')).toBe('Kreuz: etwa 3 km südwestlich von Lhotov');
        expect(crossDescription(offset(BASE, 0, 36), [LHOTOV, JINOV], 'en')).toBe('Cross: about 4 km west of Jinov');
        expect(crossDescription(offset(BASE, 47.4, 0), [LHOTOV], 'en')).toBe('Cross: about 45 km north of Lhotov');
        expect(nearestTreePlace(offset(BASE, 0, 36), [LHOTOV, JINOV])?.point.name).toBe('Jinov');
    });

    it('right at a place, and with no place to say it by', () => {
        expect(crossDescription(offset(BASE, 0.2, 0.1), [LHOTOV], 'en')).toBe('Cross: at Lhotov');
        expect(crossDescription({ lat: 49.61234, lon: 15.4 }, [], 'en')).toBe('Cross: 49.6123, 15.4000');
    });
});

describe('stampedGeo', () => {
    const now = new Date('2026-11-02T10:00:00Z');
    const geo = { lat: 49.6, lon: 15.2, label: 'Lhota, Česko', keptAt: 'old' };

    it('says who put the location there and when; an earlier Keep never carries over', () => {
        expect(stampedGeo(geo, 'map', { now })).toEqual({ lat: 49.6, lon: 15.2, label: 'Lhota, Česko', origin: 'map', at: '2026-11-02' });
        expect(stampedGeo(geo, 'hand', { now })).toMatchObject({ origin: 'hand', at: '2026-11-02' });
        expect(stampedGeo(geo, 'hand', { now }).keptAt).toBeUndefined();
    });

    it('a warned result picked knowingly: its warning answered', () => {
        expect(stampedGeo(geo, 'hand', { keep: true, now }).keptAt).toBe(placeGeoHash(geo));
    });
});
