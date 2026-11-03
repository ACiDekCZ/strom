/**
 * The small map of a place question in "Awaiting action": the view comes from
 * the question's own points (the location now and the suggestion, or the
 * candidates), never from every place of the family, with a smallest span;
 * pins on one spot stand apart. Fictional places only.
 */

import { describe, it, expect } from 'vitest';
import type { LiveWaiting } from '../research-link.js';
import { pointInViewport } from '../map.js';
import {
    WAITING_MAP_POINTS_ZOOM, spreadPins, waitingMapPoints, waitingMapView, type PlaceQuestion,
} from '../waiting-places.js';

const q = (extra: Partial<LiveWaiting>): PlaceQuestion =>
    ({ id: 'L0020', place: 'L0020', kind: 'place', what: '?', on: '', at: '', forms: ['Lhotov'], ...extra }) as PlaceQuestion;
// The family from Hamburg to Barcelona and Italy.
const family = [
    { lat: 53.55, lon: 9.99 }, { lat: 52.52, lon: 13.4 }, { lat: 41.39, lon: 2.17 }, { lat: 43.0, lon: 12.0 }, { lat: 48.85, lon: 2.35 },
    { lat: 49.5, lon: 15.1 }, { lat: 49.9, lon: 14.5 },
];
const W = 300, H = 260;
const inView = (p: { lat: number; lon: number }, v: { center: { lat: number; lon: number }; zoom: number }) => {
    const at = pointInViewport(p, v.center, v.zoom, W, H);
    return at.x >= 0 && at.x <= W && at.y >= 0 && at.y <= H;
};

describe('a place question\'s small map', () => {
    it('a conflict a few km apart: the view is the two points, not Europe, and not closer than ~15 km across', () => {
        const w = q({ question: 'conflict', current: { lat: 49.52, lon: 15.17 }, candidates: [{ id: 'c1', name: 'Lhotov', lat: 49.50, lon: 15.12 }] });
        const pts = waitingMapPoints(w);
        expect(pts).toHaveLength(2);
        const v = waitingMapView(pts, family, W, H);
        for (const p of pts) expect(inView(p, v)).toBe(true);
        // Close enough to tell the two apart: neither the whole family (zoom ~4) nor closer than the smallest span.
        expect(v.zoom).toBe(WAITING_MAP_POINTS_ZOOM);
        // Hamburg and Barcelona are out of it.
        expect(inView(family[0]!, v)).toBe(false);
        expect(inView(family[2]!, v)).toBe(false);
    });

    it('the same spot twice: the smallest span around it', () => {
        const at = { lat: 49.5, lon: 15.1 };
        const w = q({ question: 'conflict', current: at, candidates: [{ id: 'c1', name: 'Lhotov', ...at }] });
        expect(waitingMapView(waitingMapPoints(w), family, W, H).zoom).toBe(WAITING_MAP_POINTS_ZOOM);
    });

    it('far apart (another country): both in the view', () => {
        const w = q({ question: 'conflict', current: { lat: 48.2, lon: 16.37 }, candidates: [{ id: 'c1', name: 'Lhotov', lat: 49.5, lon: 15.1 }] });
        const pts = waitingMapPoints(w);
        const v = waitingMapView(pts, family, W, H);
        expect(v.zoom).toBeLessThan(WAITING_MAP_POINTS_ZOOM);
        for (const p of pts) expect(inView(p, v)).toBe(true);
    });

    it('where is: the candidates make the view; no point at all: the family\'s places', () => {
        const w = q({ question: 'propose', candidates: [
            { id: 'c1', name: 'Horní Lhota', lat: 49.6, lon: 15.2 }, { id: 'c2', name: 'Horní Lhota', lat: 49.3, lon: 16.0 },
        ] });
        const v = waitingMapView(waitingMapPoints(w), family, W, H);
        for (const p of waitingMapPoints(w)) expect(inView(p, v)).toBe(true);
        expect(inView(family[0]!, v)).toBe(false);
        const none = waitingMapView(waitingMapPoints(q({ question: 'propose' })), family, W, H);
        for (const p of family) expect(inView(p, none)).toBe(true);
    });

    it('pins on one spot stand apart, inside the map; pins apart stay where they are', () => {
        const [a, b] = spreadPins([{ x: 150, y: 130 }, { x: 150, y: 130 }], W, H);
        expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeGreaterThanOrEqual(25.9);
        expect(a!.x).toBeLessThan(b!.x);
        const [c, d] = spreadPins([{ x: 2, y: 2 }, { x: 4, y: 3 }], W, H);
        expect(Math.hypot(d!.x - c!.x, d!.y - c!.y)).toBeGreaterThanOrEqual(25.9);
        for (const p of [c!, d!]) expect(p.x >= 11 && p.y >= 11).toBe(true);
        expect(spreadPins([{ x: 10, y: 10 }, { x: 200, y: 200 }], W, H)).toEqual([{ x: 10, y: 10 }, { x: 200, y: 200 }]);
    });
});
