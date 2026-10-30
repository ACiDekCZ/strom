/**
 * Places of life in a small neighbourhood (spec 025 §1.3a, round 3): the
 * decision by the frame's content, distance rings, a nearby town, the arrow
 * to the regional city, the region's name, the "where in the country" inset,
 * places within 3 km (no map, distances and directions) and one place; living
 * protection through the new elements. Fictional people and villages
 * (Zálesí, Mlýnec, Rybníčky, Kozí Hrádek) at made-up positions; the towns,
 * rivers and regions come from the bundled Natural Earth extract (no network).
 */

import { describe, it, expect } from 'vitest';
import {
    collectPersonPlacePoints, planPlacesMap, placesMapHtml, compassSector, TINY_KM, type PlacePoint,
} from '../person-page-map.js';
import { towns, regionOf } from '../map-context.js';
import { PERSON_PAGE_MAP_CSS } from '../person-page-viz-css.js';
import { placeKey } from '../places.js';
import type { StromData, PersonId, PartnershipId, Person, Gender, PlaceGeo } from '../types.js';

const mk = (name: string, y: number, kind: PlacePoint['kind'] = 'event'): PlacePoint =>
    ({ placeKey: placeKey(name), place: name, sortKey: y + 0.1, year: y, kind });
const three = (): PlacePoint[] => [mk('Zálesí', 1800, 'birth'), mk('Mlýnec', 1830), mk('Rybníčky', 1866, 'death')];
const geoOf = (a: PlaceGeo, b: PlaceGeo, c: PlaceGeo): Record<string, PlaceGeo> =>
    ({ [placeKey('Zálesí')]: a, [placeKey('Mlýnec')]: b, [placeKey('Rybníčky')]: c });

/** Villages in the middle of Vysočina: no border or coast within the frame, Jihlava ~26 km east. */
const VYSOCINA = geoOf({ lat: 49.43, lon: 15.22 }, { lat: 49.47, lon: 15.30 }, { lat: 49.40, lon: 15.32 });
/** Near the Czech–Austrian border: the border crosses the frame. */
const BORDER = geoOf({ lat: 48.80, lon: 14.70 }, { lat: 48.65, lon: 14.90 }, { lat: 48.70, lon: 14.50 });
/** Within 3 km: Mlýnec ~1.6 km north-east, Rybníčky ~1.1 km south of Zálesí. */
const TINY = geoOf({ lat: 49.43, lon: 15.22 }, { lat: 49.442, lon: 15.232 }, { lat: 49.42, lon: 15.22 });
/** Kansas farms: a 20 km scale, Salina in the frame, Wichita south of it. */
const KANSAS = geoOf({ lat: 38.5, lon: -98.0 }, { lat: 38.7, lon: -97.6 }, { lat: 38.3, lon: -98.3 });

describe('small neighbourhood: the decision by the frame\'s content', () => {
    it('no border or coast in the frame → the orientation layer instead of the graticule', () => {
        const plan = planPlacesMap(three(), VYSOCINA, { kidPlaces: true });
        expect(plan.state).toBe('map');
        expect(plan.small).toBeDefined();
        const html = placesMapHtml(three(), VYSOCINA, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).toContain('pp-map--small');
        expect(html).not.toContain('pp-map-grid');
        expect(html).toContain('class="pp-map-ring"');
        expect(html.length).toBeLessThan(40_000);
    });

    it('a border in the frame → the usual map (graticule, attribution top right, no layer)', () => {
        const plan = planPlacesMap(three(), BORDER, { kidPlaces: true });
        expect(plan.small).toBeUndefined();
        expect(plan.where).toBeUndefined();
        const html = placesMapHtml(three(), BORDER, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).toContain('pp-map-grid');
        expect(html).toContain('pp-map-border');
        expect(html).toContain('<div class="pp-map-attr">obrysy Natural Earth</div>');
        expect(html).not.toContain('pp-map-ring');
        expect(html).not.toContain('pp-map-where');
    });
});

describe('small neighbourhood: the orientation layer', () => {
    it('rings of 5 and 10 km around place 1 (the 10 km one not on a phone)', () => {
        const plan = planPlacesMap(three(), VYSOCINA, { kidPlaces: true });
        const z = plan.places.find(p => p.num === 1)!;
        expect(plan.small!.rings).toMatchObject({ x: z.x, y: z.y, km: [5, 10] });
        expect(plan.small!.rings.r[0] / plan.small!.rings.km[0]).toBeCloseTo(plan.scale!.units / plan.scale!.km, 6);
        const html = placesMapHtml(three(), VYSOCINA, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).toContain('class="pp-map-ring pp-map-ring--2"');
        expect(html).toMatch(/class="pp-map-rl[" ][^>]*>5 km</);
        // The labels keep clear of the route and the points (here: not up and to the right, where Mlýnec is).
        for (const lab of plan.small!.rings.lab!) expect(lab.d).toBeDefined();
        expect(plan.small!.rings.lab![0].p).toBeDefined();
        const m = plan.places.find(p => p.num === 2)!;
        for (const q of [plan.small!.rings.lab![0].d!, plan.small!.rings.lab![0].p!]) expect(Math.hypot(q.x - m.x!, q.y - m.y!)).toBeGreaterThan(30);
        const phone = PERSON_PAGE_MAP_CSS.slice(PERSON_PAGE_MAP_CSS.indexOf('@media (max-width: 640px)'));
        expect(phone.slice(0, phone.indexOf('\n}'))).toContain('.pp-map-ring--2, .pp-map-rl--2, .pp-map-rl--d, .pp-map-anc, .pp-map-rvl { display: none; }');
    });

    it('a wide frame without borders (the Great Plains) takes larger rings', () => {
        const plan = planPlacesMap(three(), KANSAS, { kidPlaces: true });
        expect(plan.small).toBeDefined();
        expect(plan.small!.rings.km).toEqual([25, 50]);
    });

    it('the arrow to the regional city beyond the frame: name, km, the side it lies on', () => {
        const plan = planPlacesMap(three(), VYSOCINA, { kidPlaces: true });
        expect(plan.small!.arrow).toMatchObject({ name: 'Jihlava', dir: 'r' });
        expect(plan.small!.arrow!.km).toBeGreaterThanOrEqual(24);
        expect(plan.small!.arrow!.km).toBeLessThanOrEqual(28);
        const html = placesMapHtml(three(), VYSOCINA, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).toMatch(/<span class="pp-map-arrow pp-map-arrow--r" style="top:[\d.]+%">Jihlava \d+ km →<\/span>/);
        // Kansas: Wichita lies south (the larger component) → the bottom edge.
        const ks = planPlacesMap(three(), KANSAS, { kidPlaces: true });
        expect(ks.small!.arrow).toMatchObject({ name: 'Wichita', dir: 'd' });
        expect(placesMapHtml(three(), KANSAS, { lang: 'en', mode: 'file', kidPlaces: true })).toMatch(/Wichita \d+ km ↓/);
    });

    it('the nearest town in the frame (10 000+) as an anchor, never one of the person\'s places', () => {
        const plan = planPlacesMap(three(), KANSAS, { kidPlaces: true });
        expect(plan.small!.anchor?.name).toBe('Salina');
        const html = placesMapHtml(three(), KANSAS, { lang: 'en', mode: 'file', kidPlaces: true });
        expect(html).toMatch(/class="pp-map-anc"[^>]*>Salina</);
        // Salina is a place of the person: no anchor of that name.
        const salina = towns().find(t => t.name === 'Salina')!;
        const pts = [...three(), mk('Salina', 1900)];
        const geo = { ...KANSAS, [placeKey('Salina')]: { lat: salina.lat, lon: salina.lon } };
        expect(planPlacesMap(pts, geo, { kidPlaces: true }).small?.anchor?.name).not.toBe('Salina');
        // In the middle of Vysočina there is no town of 10 000+ in the data within the frame.
        expect(planPlacesMap(three(), VYSOCINA, { kidPlaces: true }).small!.anchor).toBeUndefined();
    });

    it('the region holding the whole frame, in the language of the page (the source name when none)', () => {
        const plan = planPlacesMap(three(), VYSOCINA, { kidPlaces: true });
        expect(plan.small!.region?.name).toBe('Vysočina');
        expect(placesMapHtml(three(), VYSOCINA, { lang: 'cs', mode: 'file', kidPlaces: true })).toContain('<span class="pp-map-region" aria-hidden="true">VYSOČINA</span>');
        expect(placesMapHtml(three(), VYSOCINA, { lang: 'de', mode: 'file', kidPlaces: true })).toContain('>KRAJ VYSOČINA</span>');
        expect(placesMapHtml(three(), KANSAS, { lang: 'en', mode: 'file', kidPlaces: true })).toContain('>KANSAS</span>');
        // Points in two regions: no name.
        expect(regionOf([{ lon: 15.5, lat: 49.4 }, { lon: 14.5, lat: 50.0 }])).toBeNull();
    });

    it('the "where in the country" inset with the frame, the attribution under it', () => {
        const plan = planPlacesMap(three(), VYSOCINA, { kidPlaces: true });
        expect(plan.where?.corner).toBe('br');
        expect(plan.where!.rect!.w).toBeGreaterThanOrEqual(5);
        const html = placesMapHtml(three(), VYSOCINA, { lang: 'en', mode: 'file', kidPlaces: true });
        expect(html).toMatch(/<div class="pp-map-where pp-map-where--br"><svg viewBox="0 0 150 86" role="img" aria-label="Location in the country"[^>]*><path class="pp-map-cty" d="M[^"]+"\/><rect class="pp-map-frame pp-map-wframe"/);
        expect(html).toContain('<span class="pp-map-wattr">outlines: Natural Earth</span>');
        expect(html).not.toContain('<div class="pp-map-attr">');
    });

    it('a far relative needs the world inset: no "where" inset (the world has the frame)', () => {
        const far: PlacePoint = { ...mk('Chicago', 1910, 'relative'), rel: { role: 'son', name: 'Kvido', id: 'k' as PersonId, ev: 'emigration' } };
        const geo = { ...VYSOCINA, [placeKey('Chicago')]: { lat: 41.88, lon: -87.63 } };
        const plan = planPlacesMap([...three(), far], geo, { kidPlaces: true });
        expect(plan.inset).toBeDefined();
        expect(plan.small).toBeDefined();
        expect(plan.where).toBeUndefined();
    });
});

describe('places within 3 km and one place', () => {
    it('within 3 km: no map, the list with distance and direction from place 1, the subtitle, the inset with a dot', () => {
        const plan = planPlacesMap(three(), TINY, { kidPlaces: true });
        expect(plan.state).toBe('tiny');
        expect(plan.places.map(p => [p.name, p.num, p.from1 ?? null])).toEqual([
            ['Zálesí', 1, null], ['Mlýnec', 2, { km: 2, dir: 1 }], ['Rybníčky', 3, { km: 1, dir: 4 }],
        ]);
        expect(plan.where?.dot).toBeDefined();
        const cs = placesMapHtml(three(), TINY, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(cs).not.toContain('class="pp-map"');
        expect(cs).toContain('<p class="pp-map-sub">Místa leží do 3 km od sebe.</p>');
        expect(cs).toContain('<b class="pp-map-name">Mlýnec</b><span class="pp-map-from"> · 2 km SV od místa Zálesí</span>');
        expect(cs).toContain('<b class="pp-map-name">Rybníčky</b><span class="pp-map-from"> · 1 km J od místa Zálesí</span>');
        expect(cs).toMatch(/<div class="pp-map-where pp-map-where--side"><svg[^>]*><path class="pp-map-cty" d="M[^"]+"\/><circle class="pp-map-wdot"/);
        const en = placesMapHtml(three(), TINY, { lang: 'en', mode: 'file', kidPlaces: true });
        expect(en).toContain('The places lie within 3 km of each other.');
        expect(en).toContain(' · 2 km NE of Zálesí');
        expect(en).toContain(' · 1 km S of Zálesí');
        const de = placesMapHtml(three(), TINY, { lang: 'de', mode: 'file', kidPlaces: true });
        expect(de).toContain('Die Orte liegen höchstens 3 km voneinander entfernt.');
        expect(de).toContain(' · 2 km NO von Zálesí');
        // The window keeps the open button.
        expect(placesMapHtml(three(), TINY, { lang: 'cs', mode: 'app', kidPlaces: true })).toContain('data-pp-action="map:open"');
    });

    it('just over 3 km apart: the map', () => {
        const geo = geoOf({ lat: 49.43, lon: 15.22 }, { lat: 49.43, lon: 15.265 }, { lat: 49.43, lon: 15.23 });
        expect(TINY_KM).toBe(3);
        expect(planPlacesMap(three(), geo, { kidPlaces: true }).state).toBe('map');
    });

    it('compass sectors: N, NE … NW', () => {
        const o = { lat: 50, lon: 15 };
        const at = (dlat: number, dlon: number) => compassSector(o, { lat: 50 + dlat, lon: 15 + dlon * 1.556 });
        expect([at(1, 0), at(1, 1), at(0, 1), at(-1, 1), at(-1, 0), at(-1, -1), at(0, -1), at(1, -1)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('one place with a position: the list beside the inset with a dot', () => {
        const pts = [mk('Zálesí', 1800, 'birth'), mk('Vrbětín', 1830)];
        const plan = planPlacesMap(pts, VYSOCINA, { kidPlaces: true });
        expect(plan.state).toBe('list');
        expect(plan.where?.dot).toBeDefined();
        const html = placesMapHtml(pts, VYSOCINA, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).toContain('<div class="pp-map-brief">');
        expect(html).toContain('pp-map-wdot');
        expect(html).not.toContain('pp-map-sub');
    });
});

// ─── Living protection (§1.7) ───────────────────────────────────────────────

function p(id: string, first: string, last: string, gender: Gender, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra } as Person;
}

/**
 * Kvido Zálesák (1900–1975): born in Zálesí, lived in Mlýnec, died in Rybníčky.
 * A second union with Bětuška (living) was made in Kozí Hrádek in 1920; their
 * daughter Ludmila (living) emigrated to Salina (Kansas).
 */
function tree(withLiving: boolean): StromData {
    const kvido = p('kvido', 'Kvido', 'Zálesák', 'male', {
        birthDate: '1900-03-03', birthPlace: 'Zálesí', deathDate: '1975-05-05', deathPlace: 'Rybníčky',
        events: [{ id: 'k1', type: 'residence', date: '1930', place: 'Mlýnec' }],
    });
    const persons = { kvido } as unknown as StromData['persons'];
    const partnerships: StromData['partnerships'] = {} as StromData['partnerships'];
    if (withLiving) {
        kvido.partnerships = ['u1' as PartnershipId];
        kvido.childIds = ['ludmila' as PersonId];
        persons['betuska' as PersonId] = p('betuska', 'Bětuška', 'Zálesáková', 'female', { birthDate: '1902', birthPlace: 'Vrbětín', isDeceased: false, partnerships: ['u1' as PartnershipId], childIds: ['ludmila' as PersonId] });
        persons['ludmila' as PersonId] = p('ludmila', 'Ludmila', 'Zálesáková', 'female', {
            birthDate: '1940', isDeceased: false, parentIds: ['kvido', 'betuska'] as PersonId[],
            events: [{ id: 'l1', type: 'emigration', date: '1960', place: 'Salina' }],
        });
        partnerships['u1' as PartnershipId] = {
            id: 'u1' as PartnershipId, person1Id: 'kvido' as PersonId, person2Id: 'betuska' as PersonId, childIds: ['ludmila' as PersonId],
            status: 'married', startDate: '1920-06-06', startPlace: 'Kozí Hrádek',
        };
    }
    return { version: 11, persons, partnerships };
}

describe('living protection through the new elements', () => {
    const salina = towns().find(t => t.name === 'Salina')!;
    const geo = (base: Record<string, PlaceGeo>): Record<string, PlaceGeo> => ({
        ...base,
        [placeKey('Kozí Hrádek')]: { lat: 49.425, lon: 15.215 },
        [placeKey('Vrbětín')]: { lat: 49.435, lon: 15.21 },
        [placeKey('Salina')]: { lat: salina.lat, lon: salina.lon },
    });
    const KID = 'kvido' as PersonId;

    for (const [label, base] of [['within 3 km', TINY], ['a small neighbourhood', VYSOCINA]] as const) {
        it(`${label}: the protected page is the page without the living (no row, no distance, no anchor from them)`, () => {
            const g = geo(base);
            const html = (t: StromData, protect: boolean) =>
                placesMapHtml(collectPersonPlacePoints(t, KID, { protect, now: 2026 }), g, { lang: 'cs', mode: 'file', kidPlaces: true });
            const open = html(tree(true), false);
            expect(open).toContain('Kozí Hrádek');
            const prot = html(tree(true), true);
            expect(prot).toBe(html(tree(false), false));
            for (const hidden of ['Kozí Hrádek', 'Vrbětín', 'Salina', 'Bětuška', 'Ludmila']) expect(prot).not.toContain(hidden);
        });
    }

    it('the unprotected page with the living union: its place comes first and is "place 1" of the distances', () => {
        const g = geo(TINY);
        const html = placesMapHtml(collectPersonPlacePoints(tree(true), KID, { now: 2026 }), g, { lang: 'en', mode: 'file', kidPlaces: false });
        expect(html).toContain(' of Zálesí');
        const prot = placesMapHtml(collectPersonPlacePoints(tree(true), KID, { protect: true, now: 2026 }), g, { lang: 'en', mode: 'file', kidPlaces: false });
        expect(prot).not.toContain('Kozí Hrádek');
    });
});
