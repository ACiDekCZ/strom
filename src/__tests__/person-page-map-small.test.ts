/**
 * Places of life in a small neighbourhood (spec 025 §1.3a, round 3): the
 * decision by the frame's content, distance rings, a nearby town, the arrow
 * to the regional city, the region's name, the "where in the country" inset,
 * places within 3 km (no map, distances and directions) and one place; living
 * protection through the new elements. Fictional people and villages
 * (Zálesí, Mlýnec, Rybníčky, Kozákov) at made-up positions; the towns,
 * rivers and regions come from the bundled Natural Earth extract (no network).
 */

import { describe, it, expect } from 'vitest';
import {
    collectPersonPlacePoints, planPlacesMap, placesMapHtml, compassSector, regionWidthPx, TINY_KM, type PlacePoint,
} from '../person-page-map.js';
import { towns, rivers, riverName, regionOf } from '../map-context.js';
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

    it('the biggest town in the frame as an anchor, never one of the person\'s places', () => {
        const plan = planPlacesMap(three(), KANSAS, { kidPlaces: true });
        expect(plan.small!.anchor?.name).toBe('Salina');
        const html = placesMapHtml(three(), KANSAS, { lang: 'en', mode: 'file', kidPlaces: true });
        expect(html).toMatch(/class="pp-map-anc"[^>]*>Salina</);
        // Salina is a place of the person: no anchor of that name.
        const salina = towns().find(t => t.name === 'Salina')!;
        const pts = [...three(), mk('Salina', 1900)];
        const geo = { ...KANSAS, [placeKey('Salina')]: { lat: salina.lat, lon: salina.lon } };
        expect(planPlacesMap(pts, geo, { kidPlaces: true }).small?.anchor?.name).not.toBe('Salina');
        // In the middle of Vysočina there is no town of the data within the frame: no anchor.
        expect(planPlacesMap(three(), VYSOCINA, { kidPlaces: true }).small!.anchor).toBeUndefined();
    });

    it('round 4: the biggest town in the frame, not the nearest one, and of any size (no 10 000 limit)', () => {
        // By Stans (Nidwalden, under 10 000 people in the data): Sarnen, a size class bigger, 13 km off.
        const town = (n: string) => towns().find(t => t.name === n)!;
        expect(town('Stans').pop).toBeLessThan(40);
        expect(town('Sarnen').pop).toBeGreaterThan(town('Stans').pop);
        const byStans = geoOf({ lat: 46.97, lon: 8.42 }, { lat: 46.92, lon: 8.36 }, { lat: 46.90, lon: 8.45 });
        const plan = planPlacesMap(three(), byStans, { kidPlaces: true });
        expect(plan.small).toBeDefined();
        expect(plan.small!.anchor?.name).toBe('Sarnen');
        // By Altdorf, the only town of the data in the frame, also under 10 000: the anchor all the same.
        const byAltdorf = geoOf({ lat: 46.86, lon: 8.62 }, { lat: 46.82, lon: 8.66 }, { lat: 46.80, lon: 8.60 });
        expect(town('Altdorf').pop).toBeLessThan(40);
        expect(planPlacesMap(three(), byAltdorf, { kidPlaces: true }).small?.anchor?.name).toBe('Altdorf');
    });

    it('the region holding the whole frame, in the language of the page (the source name when none)', () => {
        const plan = planPlacesMap(three(), VYSOCINA, { kidPlaces: true });
        expect(plan.small!.region?.name).toBe('Vysočina');
        expect(placesMapHtml(three(), VYSOCINA, { lang: 'cs', mode: 'file', kidPlaces: true })).toContain('<span class="pp-map-region" style="--fd:22px;--fp:15px" aria-hidden="true">VYSOČINA</span>');
        expect(placesMapHtml(three(), VYSOCINA, { lang: 'de', mode: 'file', kidPlaces: true })).toContain('>KRAJ VYSOČINA</span>');
        expect(placesMapHtml(three(), KANSAS, { lang: 'en', mode: 'file', kidPlaces: true })).toContain('>KANSAS</span>');
        // Points in two regions: no name.
        expect(regionOf([{ lon: 15.5, lat: 49.4 }, { lon: 14.5, lat: 50.0 }])).toBeNull();
    });

    it('round 4: the region at the top centre, never shortened: a smaller size when long, none when it fits no size', () => {
        const css = PERSON_PAGE_MAP_CSS;
        expect(css).toMatch(/\.pp-map-region \{[^}]*top: 40px;[^}]*font-size: var\(--fd, 22px\)/);
        expect(css).toMatch(/@media \(max-width: 640px\) \{[^@]*\.pp-map-region \{ top: 14px; font-size: var\(--fp, 15px\)/);
        expect(css).not.toContain('pp-map-region--long');
        // "KRAJ VYSOČINA" (13 letters) fits desktop at 22 px and a phone at 15 px (70 % of 343 px = 240 px).
        expect(regionWidthPx('KRAJ VYSOČINA', 15)).toBeLessThanOrEqual(240);
        const de = planPlacesMap(three(), VYSOCINA, { kidPlaces: true, lang: 'de' });
        expect(de.small!.regionFont).toEqual({ d: 22, p: 15 });
        const ks = planPlacesMap(three(), KANSAS, { kidPlaces: true, lang: 'en' });
        expect(ks.small!.regionFont).toEqual({ d: 22, p: 15 });
        // The size steps by 2 px down to 16 (phone 12) by the width; past them the name is not drawn.
        const fits = (n: number, sizes: number[], box: number) => sizes.find(z => regionWidthPx('X'.repeat(n), z) <= box * 0.7);
        expect(fits(20, [22, 20, 18, 16], 680)).toBe(22);
        expect(fits(25, [22, 20, 18, 16], 680)).toBe(18);
        expect(fits(40, [22, 20, 18, 16], 680)).toBeUndefined();
        expect(fits(17, [15, 13, 12], 343)).toBe(13);
    });

    it('round 4: the region is not drawn where it would cover a place\'s label', () => {
        // Three places in a row high up, one far below: Mlýnec's label has room only above it, where the name would go.
        const row = [...three(), mk('Kozákov', 1890)];
        const geo = {
            ...geoOf({ lat: 49.52, lon: 15.39 }, { lat: 49.52, lon: 15.45 }, { lat: 49.52, lon: 15.51 }),
            [placeKey('Kozákov')]: { lat: 49.40, lon: 15.45 },
        };
        const plan = planPlacesMap(row, geo, { kidPlaces: true, lang: 'cs' });
        expect(plan.small?.region?.name).toBe('Vysočina');
        expect(plan.places.find(p => p.name === 'Mlýnec')!.side).toEqual({ d: 'a', p: 'a' });
        expect(plan.small!.regionFont).toEqual({});
        expect(placesMapHtml(row, geo, { lang: 'cs', mode: 'file', kidPlaces: true })).not.toContain('pp-map-region');
        // Without the row the name is drawn.
        expect(placesMapHtml(three(), VYSOCINA, { lang: 'cs', mode: 'file', kidPlaces: true })).toContain('pp-map-region');
    });

    it('round 4: a river is named in the language of the page only (Czech from the dictionary, German from the data, never English instead)', () => {
        const elbe = rivers().find(r => r.names.en === 'Elbe')!;
        expect(riverName(elbe, 'cs')).toBe('Labe');
        expect(riverName(elbe, 'de')).toBe('Elbe');
        const vltava = rivers().find(r => r.names.en === 'Vltava')!;
        expect([riverName(vltava, 'cs'), riverName(vltava, 'de'), riverName(vltava, 'en')]).toEqual(['Vltava', 'Moldau', 'Vltava']);
        // The Czech Morava is "March" in German; the Serbian one is not the Czech Morava.
        expect(rivers().filter(r => r.names.cs === 'Morava').map(r => r.names.de)).toEqual(['March']);
        // A river with no Czech name stays unnamed in Czech.
        const warta = rivers().find(r => r.names.en === 'Warta')!;
        expect(riverName(warta, 'cs')).toBe('');
        expect(riverName(warta, 'de')).toBe('Warthe');
        // On a map by the Vltava south of Prague: "Vltava" in Czech, "Moldau" in German.
        const byVltava = geoOf({ lat: 49.80, lon: 14.38 }, { lat: 49.86, lon: 14.45 }, { lat: 49.76, lon: 14.46 });
        const cs = planPlacesMap(three(), byVltava, { kidPlaces: true, lang: 'cs' });
        const de = planPlacesMap(three(), byVltava, { kidPlaces: true, lang: 'de' });
        if (cs.small?.river) {
            expect(cs.small.river.name).toBe('Vltava');
            expect(de.small!.river!.name).toBe('Moldau');
        }
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
        expect(cs).not.toContain('class="pp-map pp-wide');
        expect(cs).toContain('<p class="pp-map-sub">Místa leží do 3 km od sebe.</p>');
        // Round 4: place 1 by its badge, not by an inflected name.
        expect(cs).toContain('<b class="pp-map-name">Mlýnec</b><span class="pp-map-from"> · 2 km SV od <span class="pp-mini" role="img" aria-label="místa 1">1</span></span>');
        expect(cs).toContain('<b class="pp-map-name">Rybníčky</b><span class="pp-map-from"> · 1 km J od <span class="pp-mini" role="img" aria-label="místa 1">1</span></span>');
        expect(cs).not.toContain('od místa Zálesí');
        expect(cs).toMatch(/<div class="pp-map-where pp-map-where--side"><svg[^>]*><path class="pp-map-cty" d="M[^"]+"\/><circle class="pp-map-wdot"/);
        const en = placesMapHtml(three(), TINY, { lang: 'en', mode: 'file', kidPlaces: true });
        expect(en).toContain('The places lie within 3 km of each other.');
        expect(en).toContain(' · 2 km NE of <span class="pp-mini" role="img" aria-label="place 1">1</span>');
        expect(en).toContain(' · 1 km S of <span class="pp-mini" role="img" aria-label="place 1">1</span>');
        const de = placesMapHtml(three(), TINY, { lang: 'de', mode: 'file', kidPlaces: true });
        expect(de).toContain('Die Orte liegen höchstens 3 km voneinander entfernt.');
        expect(de).toContain(' · 2 km NO von <span class="pp-mini" role="img" aria-label="Ort 1">1</span>');
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
 * A second union with Bětuška (living) was made in Kozákov in 1920; their
 * daughter Radmila (living) emigrated to Salina (Kansas).
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
        kvido.childIds = ['radmila' as PersonId];
        persons['betuska' as PersonId] = p('betuska', 'Bětuška', 'Zálesáková', 'female', { birthDate: '1902', birthPlace: 'Vrbětín', isDeceased: false, partnerships: ['u1' as PartnershipId], childIds: ['radmila' as PersonId] });
        persons['radmila' as PersonId] = p('radmila', 'Radmila', 'Zálesáková', 'female', {
            birthDate: '1940', isDeceased: false, parentIds: ['kvido', 'betuska'] as PersonId[],
            events: [{ id: 'l1', type: 'emigration', date: '1960', place: 'Salina' }],
        });
        partnerships['u1' as PartnershipId] = {
            id: 'u1' as PartnershipId, person1Id: 'kvido' as PersonId, person2Id: 'betuska' as PersonId, childIds: ['radmila' as PersonId],
            status: 'married', startDate: '1920-06-06', startPlace: 'Kozákov',
        };
    }
    return { version: 11, persons, partnerships };
}

describe('living protection through the new elements', () => {
    const salina = towns().find(t => t.name === 'Salina')!;
    const geo = (base: Record<string, PlaceGeo>): Record<string, PlaceGeo> => ({
        ...base,
        [placeKey('Kozákov')]: { lat: 49.425, lon: 15.215 },
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
            expect(open).toContain('Kozákov');
            const prot = html(tree(true), true);
            expect(prot).toBe(html(tree(false), false));
            for (const hidden of ['Kozákov', 'Vrbětín', 'Salina', 'Bětuška', 'Radmila']) expect(prot).not.toContain(hidden);
        });
    }

    it('the unprotected page with the living union: its place comes first and is "place 1" of the distances', () => {
        const g = geo(TINY);
        const html = placesMapHtml(collectPersonPlacePoints(tree(true), KID, { now: 2026 }), g, { lang: 'en', mode: 'file', kidPlaces: false });
        expect(html).toMatch(/data-pp-map-place="zalesi"[^>]*><span class="pp-map-badge" aria-hidden="true">1<\/span>/);
        expect(html).toContain(' of <span class="pp-mini" role="img" aria-label="place 1">1</span>');
        const prot = placesMapHtml(collectPersonPlacePoints(tree(true), KID, { protect: true, now: 2026 }), g, { lang: 'en', mode: 'file', kidPlaces: false });
        expect(prot).not.toContain('Kozákov');
    });
});
