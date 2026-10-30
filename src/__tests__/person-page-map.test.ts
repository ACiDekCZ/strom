/**
 * Places of life (spec 025 §1): collecting the person's places, grouping and
 * numbering, the states, the frame and the world inset, the scale bar, label
 * sides, the list texts, living protection and the HTML hooks.
 * Pure, fictional data (Jan Fíšek of Čapkov; made-up coordinates).
 */

import { describe, it, expect } from 'vitest';
import {
    collectPersonPlacePoints, planPlacesMap, placesMapHtml, placeLabelSides, scaleBar, labelYears,
    ownEventsText, relativeEventsText, distanceKm, insetRects, insetLabels, SAFE, VIEW_W, VIEW_H, type PlacePoint,
} from '../person-page-map.js';
import { chartAnchorId } from '../person-page-chart.js';
import { placeKey } from '../places.js';
import { getStringsForLang } from '../strings.js';
import type { StromData, PersonId, PartnershipId, Person, Gender, Partnership, PlaceGeo } from '../types.js';

function p(id: string, first: string, last: string, gender: Gender, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra } as Person;
}

const GEO: Record<string, PlaceGeo> = {
    [placeKey('Čapkov')]: { lat: 49.60, lon: 15.20 },
    [placeKey('Lhotka')]: { lat: 49.66, lon: 15.36 },
    [placeKey('Kolín')]: { lat: 50.03, lon: 15.20 },
    [placeKey('Bystřice')]: { lat: 49.72, lon: 15.05 },
    [placeKey('Chicago')]: { lat: 41.88, lon: -87.63 },
    [placeKey('Wien')]: { lat: 48.21, lon: 16.37 },
};

function tree(): StromData {
    const persons: StromData['persons'] = {};
    const add = (x: Person) => { persons[x.id] = x; };
    add(p('jan', 'Jan', 'Fíšek', 'male', {
        birthDate: '1860-03-12', birthPlace: 'Čapkov', deathDate: '1920-02-01', deathPlace: 'Kolín',
        childIds: ['vaclav', 'eva'] as PersonId[], partnerships: ['u1' as PartnershipId],
        events: [
            { id: 'e1', type: 'baptism', date: '1860-03-13', place: 'Čapkov' },
            { id: 'e2', type: 'residence', date: '1890', place: 'Kolín' },
            { id: 'e3', type: 'burial', date: '1920-02-04', place: 'Kolín' },
            { id: 'e4', type: 'occupation', place: 'Kutná Hora' },
        ],
    }));
    add(p('roza', 'Rozálie', 'Fíšková', 'female', { birthDate: '1862', birthPlace: 'Bystřice', deathDate: '1930', partnerships: ['u1' as PartnershipId] }));
    add(p('vaclav', 'Václav', 'Fíšek', 'male', {
        birthDate: '1885', birthPlace: 'Lhotka', deathDate: '1968', deathPlace: 'Chicago', parentIds: ['jan', 'roza'] as PersonId[],
        events: [{ id: 'v1', type: 'emigration', date: '1913', place: 'Chicago' }],
    }));
    // A daughter marked living (a test of protection; the data is made up).
    add(p('eva', 'Eva', 'Fíšková', 'female', {
        birthDate: '1888', isDeceased: false, parentIds: ['jan', 'roza'] as PersonId[],
        events: [{ id: 'ev1', type: 'emigration', date: '1950', place: 'Wien' }],
    }));
    const u1: Partnership = { id: 'u1' as PartnershipId, person1Id: 'jan' as PersonId, person2Id: 'roza' as PersonId, childIds: ['vaclav', 'eva'] as PersonId[], status: 'married', startDate: '1883-05-01', startPlace: 'Lhotka' };
    return { version: 11, persons, partnerships: { u1 } as StromData['partnerships'] };
}

const JAN = 'jan' as PersonId;
const cs = getStringsForLang('cs');

describe('collectPersonPlacePoints', () => {
    it('collects own places (dated and undated) and the relatives\' places', () => {
        const pts = collectPersonPlacePoints(tree(), JAN, { now: 2026 });
        const own = pts.filter(x => !x.rel);
        expect(own.map(x => `${x.kind}:${x.eventType ?? ''}:${x.place}`)).toEqual(expect.arrayContaining([
            'birth::Čapkov', 'event:baptism:Čapkov', 'marriage::Lhotka', 'event:residence:Kolín', 'death::Kolín', 'event:burial:Kolín',
            'event:occupation:Kutná Hora',
        ]));
        expect(own.find(x => x.place === 'Kutná Hora')!.sortKey).toBeNull();
        const rel = pts.filter(x => x.rel);
        expect(rel.map(x => `${x.rel!.role}:${x.rel!.name}:${x.rel!.ev}:${x.place}`).sort()).toEqual([
            'daughter:Eva:emigration:Wien', 'son:Václav:death:Chicago', 'son:Václav:emigration:Chicago', 'wife:Rozálie:birth:Bystřice',
        ]);
    });

    it('uses the life timeline\'s sort keys (anchors line up with its rows)', () => {
        const birth = collectPersonPlacePoints(tree(), JAN, { now: 2026 }).find(x => x.kind === 'birth')!;
        expect(birth.sortKey).toBeCloseTo(1860.001, 3);
    });

    it('leaves out a relative\'s place that is one of the person\'s own', () => {
        const t = tree();
        t.persons['roza' as PersonId].birthPlace = 'Lhotka';
        const rel = collectPersonPlacePoints(t, JAN, { now: 2026 }).filter(x => x.rel);
        expect(rel.some(x => x.rel!.name === 'Rozálie')).toBe(false);
    });

    it('protected file: nothing from a living relative; a living person\'s page gives nothing', () => {
        const pts = collectPersonPlacePoints(tree(), JAN, { protect: true, now: 2026 });
        expect(pts.some(x => x.rel?.name === 'Eva')).toBe(false);
        expect(pts.some(x => x.rel?.name === 'Václav')).toBe(true);
        expect(collectPersonPlacePoints(tree(), 'eva' as PersonId, { protect: true, now: 2026 })).toEqual([]);
        // The living set of the page wins over the computed test.
        const withSet = collectPersonPlacePoints(tree(), JAN, { protect: true, living: new Set(['vaclav']) });
        expect(withSet.some(x => x.rel?.name === 'Václav')).toBe(false);
        expect(withSet.some(x => x.rel?.name === 'Eva')).toBe(true);
    });

    it('protected file: a marriage with a living partner gives no point', () => {
        const pts = collectPersonPlacePoints(tree(), JAN, { protect: true, living: new Set(['roza']) });
        expect(pts.some(x => x.kind === 'marriage')).toBe(false);
        expect(pts.some(x => x.rel?.name === 'Rozálie')).toBe(false);
    });
});

describe('planPlacesMap', () => {
    const pts = () => collectPersonPlacePoints(tree(), JAN, { now: 2026 });

    it('groups by place and numbers by the first visit', () => {
        const plan = planPlacesMap(pts(), GEO, { kidPlaces: true });
        expect(plan.state).toBe('map');
        const own = plan.places.filter(x => !x.rel);
        expect(own.map(x => `${x.num}:${x.name}`)).toEqual(['1:Čapkov', '2:Lhotka', '3:Kolín']);
        expect(own[0].points.length).toBe(2); // birth + baptism
        expect(plan.noPos.map(x => x.name)).toEqual(['Kutná Hora']);
    });

    it('draws the migration path only through changes of place', () => {
        const plan = planPlacesMap(pts(), GEO, { kidPlaces: true });
        expect(plan.route.length).toBe(3);
    });

    it('fits the person\'s places into the safe area (visible on a phone too)', () => {
        const plan = planPlacesMap(pts(), GEO, { kidPlaces: true });
        for (const x of plan.places.filter(q => !q.rel)) {
            expect(x.x!).toBeGreaterThanOrEqual(SAFE.x0 - 0.01);
            expect(x.x!).toBeLessThanOrEqual(SAFE.x1 + 0.01);
            expect(x.y!).toBeGreaterThanOrEqual(SAFE.y0 - 0.01);
            expect(x.y!).toBeLessThanOrEqual(SAFE.y1 + 0.01);
        }
    });

    it('puts a far relative\'s place on the world inset, a near one on the main map', () => {
        const plan = planPlacesMap(pts(), GEO, { kidPlaces: true });
        const chicago = plan.places.find(x => x.name === 'Chicago')!;
        const bystrice = plan.places.find(x => x.name === 'Bystřice')!;
        expect(chicago.inset).toBeDefined();
        expect(chicago.x).toBeUndefined();
        expect(bystrice.x).toBeDefined();
        expect(plan.inset).toBeDefined();
        expect(plan.inset!.rect.w).toBeGreaterThanOrEqual(6);
    });

    it('inset labels never cover each other or another dot: Chicago moves to the left of New York', () => {
        // New York east of Chicago, a few units apart (as on the world inset).
        const labels = insetLabels([{ x: 63, y: 50, name: 'Chicago' }, { x: 74, y: 48, name: 'New York' }]);
        expect(labels.map(l => [l.name, l.side])).toEqual([['Chicago', 'l'], ['New York', 'r']]);
        // The phone's smaller inset has no room left of Chicago: that label is for wider screens only.
        expect(labels.map(l => l.phone)).toEqual([false, true]);
        const html = placesMapHtml(pts(), GEO, { lang: 'cs', mode: 'file', kidPlaces: true, ambiguous: new Set() });
        expect(html).toContain('class="pp-map-ilb');
        // Three in a cluster: none overlaps, a fourth never shows.
        const many = insetLabels([
            { x: 60, y: 50, name: 'Chicago' }, { x: 66, y: 52, name: 'New York' }, { x: 63, y: 46, name: 'Detroit' }, { x: 64, y: 49, name: 'Cleveland' },
        ]);
        expect(many.length).toBeLessThanOrEqual(3);
        expect(new Set(many.map(l => `${l.side}${l.v ?? ''}`)).size).toBe(many.length);
    });

    it('without the switch: no relatives, no inset', () => {
        const plan = planPlacesMap(pts(), GEO, { kidPlaces: false });
        expect(plan.places.every(x => !x.rel)).toBe(true);
        expect(plan.inset).toBeUndefined();
    });

    it('places of the person far apart: one map of all, no inset', () => {
        const t = tree();
        t.persons[JAN].events!.push({ id: 'e9', type: 'residence', date: '1900', place: 'Chicago' });
        const plan = planPlacesMap(collectPersonPlacePoints(t, JAN, { now: 2026 }), GEO, { kidPlaces: true });
        expect(plan.state).toBe('map');
        expect(plan.inset).toBeUndefined();
        expect(plan.places.find(x => x.name === 'Chicago')!.num).toBeGreaterThan(0);
        expect(plan.scale).toBeUndefined(); // a frame across the ocean has no scale bar
    });

    it('a minimum span of 25 km for places close together (just over 3 km apart; closer ones get no map)', () => {
        const geo = { [placeKey('Čapkov')]: { lat: 49.6, lon: 15.2 }, [placeKey('Lhotka')]: { lat: 49.6, lon: 15.25 } };
        const points: PlacePoint[] = [
            { placeKey: placeKey('Čapkov'), place: 'Čapkov', sortKey: 1860.1, year: 1860, kind: 'birth' },
            { placeKey: placeKey('Lhotka'), place: 'Lhotka', sortKey: 1900.1, year: 1900, kind: 'death' },
        ];
        const plan = planPlacesMap(points, geo, { kidPlaces: true });
        expect(plan.scale!.km).toBeLessThanOrEqual(10);
        const spanUnits = SAFE.x1 - SAFE.x0;
        // 25 km fill at most the safe width.
        const unitsPerKm = plan.scale!.units / plan.scale!.km;
        expect(25 * unitsPerKm).toBeLessThanOrEqual(spanUnits + 0.01);
    });

    it('moves the inset to the top left when the places sit in the bottom right', () => {
        const geo = {
            [placeKey('A')]: { lat: 49.5, lon: 14.0 },
            [placeKey('B')]: { lat: 49.0, lon: 17.0 },
            [placeKey('C')]: { lat: 50.0, lon: 15.6 },
            [placeKey('Far')]: { lat: 40.7, lon: -74.0 },
        };
        const mk = (name: string, y: number, kind: PlacePoint['kind'] = 'event'): PlacePoint => ({ placeKey: placeKey(name), place: name, sortKey: y, year: y, kind });
        const far: PlacePoint = { ...mk('Far', 1910, 'relative'), rel: { role: 'son', name: 'Karel', id: 'k' as PersonId, ev: 'emigration' } };
        const plan = planPlacesMap([mk('A', 1860, 'birth'), mk('C', 1880), mk('B', 1900, 'death'), far], geo, { kidPlaces: true });
        // B (south-east) lies under the bottom-right inset; the top left is free.
        const b = plan.places.find(x => x.name === 'B')!;
        const r = insetRects('br');
        expect(b.x! + 14 > r.d.x && b.y! + 14 > r.d.y).toBe(true);
        expect(plan.inset!.corner).toBe('tl');
        // Without anything in the bottom right, the inset stays there.
        const plan2 = planPlacesMap([mk('A', 1860, 'birth'), mk('C', 1880, 'death'), far], geo, { kidPlaces: true });
        expect(plan2.inset!.corner).toBe('br');
    });

    it('places on both sides of the 180th meridian: one narrow frame, east stays east (round 2, point 7)', () => {
        const geo = { [placeKey('Anadyr')]: { lat: 64.73, lon: 177.5 }, [placeKey('Nome')]: { lat: 64.5, lon: -165.4 } };
        const points: PlacePoint[] = [
            { placeKey: placeKey('Anadyr'), place: 'Anadyr', sortKey: 1860.1, year: 1860, kind: 'birth' },
            { placeKey: placeKey('Nome'), place: 'Nome', sortKey: 1920.1, year: 1920, kind: 'death' },
        ];
        const plan = planPlacesMap(points, geo, { kidPlaces: true });
        expect(plan.state).toBe('map');
        const a = plan.places.find(x => x.name === 'Anadyr')!, n = plan.places.find(x => x.name === 'Nome')!;
        // Nome lies east of Anadyr across the meridian, not on the far side of the world.
        expect(n.x!).toBeGreaterThan(a.x!);
        // The frame spans tens of degrees, not the whole world: a scale bar is shown.
        expect(plan.scale).toBeDefined();
        for (const p of [a, n]) {
            expect(p.x!).toBeGreaterThanOrEqual(SAFE.x0 - 0.01);
            expect(p.x!).toBeLessThanOrEqual(SAFE.x1 + 0.01);
        }
        // The map is drawn, not the list.
        const html = placesMapHtml(points, geo, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).toContain('class="pp-map"');
    });

    it('states: one place → none; one with a position → list; none with a position → noGeo', () => {
        const one: PlacePoint[] = [{ placeKey: placeKey('Čapkov'), place: 'Čapkov', sortKey: 1860.1, year: 1860, kind: 'birth' },
            { placeKey: placeKey('Čapkov'), place: 'Čapkov', sortKey: 1920.1, year: 1920, kind: 'death' }];
        expect(planPlacesMap(one, GEO, { kidPlaces: true }).state).toBe('none');
        const two: PlacePoint[] = [one[0], { placeKey: placeKey('Nowhere'), place: 'Nowhere', sortKey: 1920.1, year: 1920, kind: 'death' }];
        expect(planPlacesMap(two, GEO, { kidPlaces: true }).state).toBe('list');
        expect(planPlacesMap(two, {}, { kidPlaces: true }).state).toBe('noGeo');
        expect(planPlacesMap(two, undefined, { kidPlaces: true }).state).toBe('noGeo');
    });
});

describe('scale bar and labels', () => {
    it('a round length 50–110 units long (40–120 px on desktop and phone)', () => {
        expect(scaleBar(10)).toEqual({ km: 5, units: 50 });
        expect(scaleBar(1).km).toBe(50);
        expect(scaleBar(0.3).km).toBe(200);
        for (const u of [0.07, 0.4, 2.2, 7, 31, 90]) {
            const s = scaleBar(u);
            expect(s.units).toBeGreaterThanOrEqual(45);
            expect(s.units).toBeLessThanOrEqual(125);
        }
    });

    it('label right of the point; left in the right third; left on a collision; else left out', () => {
        const o = { minX: 0, maxX: 640, minY: 0, maxY: 320, pxToUnit: 1 };
        expect(placeLabelSides([{ x: 100, y: 100, w: 60 }], o)).toEqual(['r']);
        expect(placeLabelSides([{ x: 500, y: 100, w: 60 }], o)).toEqual(['l']);
        // The third point: its right side hits the second point, its left side the first label.
        const sides = placeLabelSides([
            { x: 100, y: 100, w: 80 },
            { x: 300, y: 100, w: 80 },
            { x: 220, y: 100, w: 70 },
        ], o);
        expect(sides).toEqual(['r', 'r', 'hide']);
        // A right side off the view flips left even in the left part.
        expect(placeLabelSides([{ x: 400, y: 100, w: 300 }], { ...o, maxX: 640 })).toEqual(['l']);
        // An obstacle (the inset) on the right sends the label left.
        expect(placeLabelSides([{ x: 300, y: 100, w: 60 }], { ...o, obstacles: [{ x: 310, y: 80, w: 100, h: 40 }] })).toEqual(['l']);
    });

    it('label years: desktop up to three, else first–last; phone first–last', () => {
        const mk = (y: number | null): PlacePoint => ({ placeKey: 'x', place: 'X', sortKey: y, year: y, kind: 'event' });
        expect(labelYears([mk(1860), mk(1883)])).toEqual({ d: '1860, 1883', p: '1860–1883' });
        expect(labelYears([mk(1860), mk(1870), mk(1880), mk(1890)])).toEqual({ d: '1860–1890', p: '1860–1890' });
        expect(labelYears([mk(null)])).toEqual({ d: '', p: '' });
        // A worded date keeps its word ("před 1965"), not inside first–last; a range keeps its first year.
        const w = (y: number, yearLabel: string): PlacePoint => ({ ...mk(y), yearLabel });
        expect(labelYears([w(1965, 'před 1965')])).toEqual({ d: 'před 1965', p: 'před 1965' });
        expect(labelYears([w(1965, 'před 1965'), mk(2001)])).toEqual({ d: 'před 1965, 2001', p: '1965–2001' });
        expect(labelYears([w(1950, '1950–1960')])).toEqual({ d: '1950', p: '1950' });
    });
});

describe('list texts', () => {
    it('merges a birth and a baptism of one year, a death and a burial', () => {
        const pts = collectPersonPlacePoints(tree(), JAN, { now: 2026 });
        const capkov = pts.filter(x => x.place === 'Čapkov' && !x.rel);
        expect(ownEventsText(capkov, cs, 'cs')).toBe('narození a křest 1860');
        const kolin = pts.filter(x => x.place === 'Kolín' && !x.rel).sort((a, b) => a.sortKey! - b.sortKey!);
        expect(ownEventsText(kolin, cs, 'cs')).toBe('bydliště 1890, úmrtí a pohřeb 1920');
        const lhotka = pts.filter(x => x.place === 'Lhotka' && !x.rel);
        expect(ownEventsText(lhotka, cs, 'cs')).toBe('sňatek – Rozálie Fíšková 1883');
    });

    it('a relative\'s row: role, first name, events with years', () => {
        const pts = collectPersonPlacePoints(tree(), JAN, { now: 2026 }).filter(x => x.place === 'Chicago');
        expect(relativeEventsText(pts, cs)).toBe('Václav (syn): vystěhování 1913, úmrtí 1968');
        expect(relativeEventsText(pts, getStringsForLang('en'))).toBe('Václav (son): emigration 1913, death 1968');
    });
});

describe('placesMapHtml', () => {
    const pts = () => collectPersonPlacePoints(tree(), JAN, { now: 2026 });

    it('map, inset, scale, attribution, numbered points and the list', () => {
        const html = placesMapHtml(pts(), GEO, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).toMatch(/^<section class="pp-sec pp-sec--places pp-places" id="pp-sec-places">/);
        expect(html).toContain('class="pp-map"');
        expect(html).toContain('pp-map-inset');
        expect(html).toContain('obrysy Natural Earth');
        expect(html).toContain('class="pp-map-scale"');
        expect(html).toContain('class="pp-map-route"');
        expect((html.match(/class="pp-map-pt( is-sel)?"/g) ?? []).length).toBe(3);
        expect(html).toContain('pp-map-pt--rel');
        expect(html).toContain('Bez polohy na mapě: Kutná Hora (povolání)');
        expect(html).toContain('Václav (syn): vystěhování 1913, úmrtí 1968');
        // No external references (no tiles, no links to map services).
        expect(html).not.toMatch(/https?:\/\//);
    });

    it('rows carry the timeline anchor of the place\'s first event', () => {
        const html = placesMapHtml(pts(), GEO, { lang: 'cs', mode: 'file', kidPlaces: true });
        const birth = pts().find(x => x.kind === 'birth')!;
        expect(html).toContain(`data-pp-map-place="${placeKey('Čapkov')}" data-pp-osa="${chartAnchorId(birth.sortKey!)}"`);
    });

    it('window: the switch and the open button; file: neither', () => {
        const app = placesMapHtml(pts(), GEO, { lang: 'en', mode: 'app', kidPlaces: true });
        expect(app).toContain('data-pp-switch="kidPlaces"');
        expect(app).toContain('aria-checked="true"');
        expect(app).toContain('data-pp-action="map:open"');
        expect(app).toContain('Places of life');
        const file = placesMapHtml(pts(), GEO, { lang: 'en', mode: 'file', kidPlaces: true });
        expect(file).not.toContain('data-pp-switch');
        expect(file).not.toContain('map:open');
    });

    it('the selected place is highlighted on the map and in the list', () => {
        const html = placesMapHtml(pts(), GEO, { lang: 'cs', mode: 'app', kidPlaces: true, selected: placeKey('Lhotka') });
        expect(html).toMatch(/class="pp-map-pt is-sel"[^>]*data-pp-map-place="lhotka"/);
        expect(html).toMatch(/class="pp-map-row is-sel"[^>]*data-pp-map-place="lhotka"/);
    });

    it('ambiguous names are marked in the "not on the map" row', () => {
        const html = placesMapHtml(pts(), GEO, { lang: 'cs', mode: 'file', kidPlaces: true, ambiguous: new Set([placeKey('Kutná Hora')]) });
        expect(html).toContain('Kutná Hora (povolání – název odpovídá více obcím)');
    });

    it('no position at all: the list with dashed circles and the note (window two sentences, file one)', () => {
        const app = placesMapHtml(pts(), {}, { lang: 'cs', mode: 'app', kidPlaces: true });
        expect(app).not.toContain('class="pp-map"');
        expect(app).toContain('pp-map-badge--none');
        expect(app).toContain('Místa zatím nemají polohu, proto se mapa neukazuje. Polohu lze doplnit v Místech.');
        const file = placesMapHtml(pts(), {}, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(file).toContain('Místa zatím nemají polohu, proto se mapa neukazuje.');
        expect(file).not.toContain('Polohu lze doplnit');
    });

    it('one place with a position: the list only', () => {
        const html = placesMapHtml(pts(), { [placeKey('Kolín')]: GEO[placeKey('Kolín')] }, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).not.toContain('class="pp-map"');
        expect(html).toContain('pp-map-list');
    });

    it('at most one place: no section', () => {
        const t = tree();
        const lone = p('x', 'Lone', 'One', 'male', { birthDate: '1900', birthPlace: 'Čapkov' });
        t.persons[lone.id] = lone;
        expect(placesMapHtml(collectPersonPlacePoints(t, lone.id, { now: 2026 }), GEO, { lang: 'cs', mode: 'file', kidPlaces: true })).toBe('');
    });

    it('protected file: the living daughter\'s place is nowhere in the page', () => {
        const html = placesMapHtml(collectPersonPlacePoints(tree(), JAN, { protect: true, now: 2026 }), GEO, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).not.toContain('Wien');
        expect(html).not.toContain('Eva');
        expect(placesMapHtml(collectPersonPlacePoints(tree(), JAN, { now: 2026 }), GEO, { lang: 'cs', mode: 'file', kidPlaces: true })).toContain('Eva');
    });

    it('escapes place and person names', () => {
        const t = tree();
        t.persons[JAN].birthPlace = 'Čap<kov> & "co"';
        t.persons[JAN].events![0].place = 'Čap<kov> & "co"';
        const geo = { ...GEO, [placeKey('Čap<kov> & "co"')]: GEO[placeKey('Čapkov')] };
        const html = placesMapHtml(collectPersonPlacePoints(t, JAN, { now: 2026 }), geo, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html).toContain('Čap&lt;kov&gt; &amp; &quot;co&quot;');
        expect(html).not.toContain('<kov>');
    });

    it('stays small: the outlines of a neighbourhood map are a few kB', () => {
        const html = placesMapHtml(pts(), GEO, { lang: 'cs', mode: 'file', kidPlaces: true });
        expect(html.length).toBeGreaterThan(5_000);
        expect(html.length).toBeLessThan(40_000);
    });

    it('the view constants: 2 : 1', () => {
        expect(VIEW_W / VIEW_H).toBe(2);
        expect(distanceKm({ lat: 50, lon: 14 }, { lat: 50, lon: 15 })).toBeGreaterThan(70);
    });
});
