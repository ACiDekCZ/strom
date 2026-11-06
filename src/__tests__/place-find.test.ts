/**
 * The results of the Places dialog's search (spec 034 §6): order, the
 * warnings at the bottom, at most five, "found as", distances and the
 * description of the cross. Fictional places and people only; coordinates
 * are made up around one spot (1° of latitude ≈ 111 km).
 */

import { describe, it, expect } from 'vitest';
import {
    findResults, findResultTexts, findTreePoints, crossDescription, compassDir, aboutKm, wholeKm, otherForms,
    nearestTreePlace, stampedGeo, FIND_MAX, miniMapFit, treeCountry, labelCountry, type FindTreePoint,
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
        hit('Horní Lhota', north(33), 'Horní Lhota, Jinov, okres Jinov, Česko', 'suburb', true),
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
        // Far from the family: it may be another place of the same name.
        expect(t.warning).toMatch(/^11\d km from the other places of the Lhoták family in 1840–1860\. Possibly another place of the same name\.$/);
        expect(findResultTexts(r[4]!, 'cs').warning).toMatch(/ Možná jiné místo stejného jména\.$/);
        // Other warnings say only their reason.
        expect(findResultTexts(r[3]!, 'cs').warning).not.toMatch(/stejného jména/);
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

    it('the lines: kind · district, country; the distance from the nearest place of the family (Lhota of 1820 is not one in 1855)', () => {
        const [a, b] = results();
        expect(findResultTexts(a!, 'en')).toMatchObject({ sub: 'town · okres Lhotov, Česko', distance: '3 km from Lhotov', warning: '' });
        // Without address parts the rest of the label says where.
        expect(findResultTexts(b!, 'cs')).toMatchObject({ sub: 'obec · okres Jinov, Česko', distance: '4 km od místa Jinov' });
    });

    it('a result at a place of the tree, and a tree with no other place', () => {
        const data = tree();
        const points = findTreePoints(data, 'h lhota', k => NAMES[k]);
        const [at] = findResults({ found: [hit('H. Lhota', offset(north(6), 0.1, 0.1), 'Jinov, Česko', 'village', true)], query: 'H. Lhota', key: 'h lhota', data, tree: points });
        expect(findResultTexts(at!, 'en').distance).toBe('right at Jinov');
        const [none] = findResults({ found: [hit('H. Lhota', BASE, 'Lhota', 'village', true)], query: 'H. Lhota', key: 'h lhota', data: { persons: {}, partnerships: {} }, tree: [] });
        expect(none!.distance).toBeUndefined();
        expect(none!.near).toBe(false);
    });

    it('measured by the family’s places, as the check measures: beside another branch’s village is not near (1106)', () => {
        // The Lhoták family lives around Lhota; the Vrbas family (another branch) at Bělov, 40 km north.
        const data = tree();
        const vrbas = [person('Vrbas', 'Bělov', '1850'), person('Vrbas', 'Bělovec', '1852')];
        for (const p of vrbas) data.persons[p.id] = p;
        data.places!['belov'] = { ...north(40), label: 'Bělov, okres Bělov, Česko' };
        data.places!['belovec'] = { ...north(44), label: 'Bělovec, okres Bělov, Česko' };
        const names = { ...NAMES, belov: 'Bělov', belovec: 'Bělovec' };
        const points = findTreePoints(data, 'h lhota', k => names[k as keyof typeof names]);
        const [r] = findResults({ found: [hit('H. Lhota', north(42), 'Horní Lhota, okres Bělov, Česko', 'village', true)], query: 'H. Lhota', key: 'h lhota', data, tree: points });
        // 2 km from Bělov, but 36 km from the family's nearest place (Jinov): said by the family's place, not near.
        expect(findResultTexts(r!, 'en').distance).toBe('36 km from Jinov');
        expect(r!.near).toBe(false);
        expect(r!.warnings).toEqual([]);
        // A place no family can be measured by: the whole tree.
        const lone = { ...data, persons: { ...data.persons } };
        const loner = person('Zrnek', 'Lhotka', '1700');
        lone.persons[loner.id] = loner;
        const [t] = findResults({ found: [hit('Lhotka', north(41.5), 'Lhotka, okres Bělov, Česko', 'village', true)], query: 'Lhotka', key: 'lhotka', data: lone, tree: findTreePoints(lone, 'lhotka', k => names[k as keyof typeof names]) });
        expect(findResultTexts(t!, 'en').distance).toBe('1 km from Bělov');
    });

    it('far away (another country, hundreds of km): after the others; the small map fits the tree’s country (1106)', () => {
        // The Lhoták family around Lhota in Česko; one branch emigrated to Italia (Lhotaro, 700 km south-west).
        const data = tree();
        const em = person('Lhoták', 'Lhotaro', '1856');
        data.persons[em.id] = em;
        data.places!['lhotaro'] = { ...offset(BASE, -500, -500), label: 'Lhotaro, Veneto, Italia' };
        const names = { ...NAMES, lhotaro: 'Lhotaro' };
        const points = findTreePoints(data, 'h lhota', k => names[k as keyof typeof names]);
        expect(treeCountry(points)).toBe('Česko');
        expect(points.find(p => p.key === 'lhotaro')?.country).toBe('Italia');
        const cz = (n: number, at: { lat: number; lon: number }) => hit('H. Lhota', at, `Horní Lhota, okres L${n}, Česko`, 'village', true, { name: 'Horní Lhota', district: `okres L${n}`, country: 'Česko' });
        const hr = hit('H. Lhota', offset(BASE, -520, 120), 'Horní Lhota, Primorska, Chorvatsko', 'village', true, { name: 'Horní Lhota', district: 'Primorska', country: 'Chorvatsko' });
        const list = findResults({ found: [hr, cz(1, north(120)), cz(2, north(-1))], query: 'H. Lhota', key: 'h lhota', data, tree: points });
        // Croatia: far away, last, though the map gave it first; Česko's 120 km one is warned, not far away.
        expect(list.map(r => [r.letter, r.where, r.away])).toEqual([
            ['A', 'okres L2, Česko', false],
            ['B', 'okres L1, Česko', false],
            ['C', 'Primorska, Chorvatsko', true],
        ]);
        expect(list[1]!.warnings[0]?.kind).toBe('far');
        // The small map: the results in Česko and the tree's places there; neither Croatia nor Italia.
        const fit = miniMapFit(list, points);
        expect(fit).toHaveLength(2 + 4);
        expect(fit.every(g => g.lat > 49)).toBe(true);
        // Every result far away: the map shows them all.
        const abroad = findResults({ found: [hr], query: 'H. Lhota', key: 'h lhota', data, tree: points });
        expect(abroad[0]!.away).toBe(true);
        expect(miniMapFit(abroad, points)[0]).toMatchObject({ lat: hr.candidate.geo.lat });
    });

    it('far away without a country to tell it by: farther than 300 km; a border village near the family is not (1106)', () => {
        const data = tree();
        const bare = Object.fromEntries(Object.entries(data.places!).map(([k, g]) => [k, { lat: g.lat, lon: g.lon }]));
        data.places = bare;
        const points = findTreePoints(data, 'h lhota', k => NAMES[k]);
        expect(treeCountry(points)).toBeUndefined();
        const at = (lbl: string, p: { lat: number; lon: number }) => hit('H. Lhota', p, lbl, 'village', true);
        const list = findResults({ found: [at('Horní Lhota', north(-400)), at('Horní Lhota', north(200)), at('Horní Lhota', north(-1))], query: 'H. Lhota', key: 'h lhota', data, tree: points });
        expect(list.map(r => r.away)).toEqual([false, false, true]);
        // Another country but beside the family's places: not far away.
        const border = findResults({ found: [hit('H. Lhota', north(-10), 'Horní Lhota, Lhotland', 'village', true, { country: 'Lhotland' })], query: 'H. Lhota', key: 'h lhota', data: tree(), tree: findTreePoints(tree(), 'h lhota', k => NAMES[k]) });
        expect(border[0]!.away).toBe(false);
        expect(labelCountry('Lhota')).toBeUndefined();
        expect(labelCountry('Lhota, okres Jinov, Česko')).toBe('Česko');
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
