/**
 * Map maths (src/map.ts). Everything here is pure, so the checks are against
 * known real-world coordinates rather than snapshots of our own output.
 */

import { describe, it, expect } from 'vitest';
import {
    fitBounds, panCenter, pinchZoomStep, pointInViewport, project, tileUrl, tilesForViewport, unproject, zoomAround,
    MAX_ZOOM, MIN_ZOOM, PINCH_ZOOM_IN_RATIO, PINCH_ZOOM_OUT_RATIO, TILE_SIZE,
} from '../map.js';

const PRAGUE = { lat: 50.0755, lon: 14.4378 };
const LONDON = { lat: 51.5074, lon: -0.1278 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

describe('project / unproject', () => {
    it('puts the null island at the centre of the world', () => {
        const p = project({ lat: 0, lon: 0 }, 0);
        expect(p.x).toBeCloseTo(TILE_SIZE / 2, 6);
        expect(p.y).toBeCloseTo(TILE_SIZE / 2, 6);
    });

    it('places Prague east of Greenwich and north of the equator', () => {
        const prague = project(PRAGUE, 8);
        const greenwich = project({ lat: 0, lon: 0 }, 8);
        expect(prague.x).toBeGreaterThan(greenwich.x);
        expect(prague.y).toBeLessThan(greenwich.y);  // y grows southwards
    });

    it('round-trips coordinates through the projection', () => {
        for (const place of [PRAGUE, LONDON, SYDNEY]) {
            const back = unproject(project(place, 12), 12);
            expect(back.lat).toBeCloseTo(place.lat, 6);
            expect(back.lon).toBeCloseTo(place.lon, 6);
        }
    });

    it('clamps the poles instead of producing infinity', () => {
        // Web Mercator sends the poles to infinity; project() clamps just short
        // of them, landing on the top edge of the world (0, give or take float
        // noise) rather than blowing up.
        const north = project({ lat: 90, lon: 0 }, 4);
        expect(Number.isFinite(north.y)).toBe(true);
        expect(north.y).toBeCloseTo(0, 6);

        const south = project({ lat: -90, lon: 0 }, 4);
        expect(Number.isFinite(south.y)).toBe(true);
        expect(south.y).toBeCloseTo(TILE_SIZE * 16, 6);  // world height at zoom 4
    });
});

describe('tilesForViewport', () => {
    it('covers the viewport with tiles at the requested zoom', () => {
        const tiles = tilesForViewport(PRAGUE, 6, 800, 600);
        expect(tiles.length).toBeGreaterThan(0);
        expect(tiles.every(t => t.z === 6)).toBe(true);
        // Every pixel of the viewport must be behind some tile.
        expect(Math.min(...tiles.map(t => t.left))).toBeLessThanOrEqual(0);
        expect(Math.min(...tiles.map(t => t.top))).toBeLessThanOrEqual(0);
        expect(Math.max(...tiles.map(t => t.left)) + TILE_SIZE).toBeGreaterThanOrEqual(800);
        expect(Math.max(...tiles.map(t => t.top)) + TILE_SIZE).toBeGreaterThanOrEqual(600);
    });

    it('never asks for a tile outside the world grid', () => {
        for (const zoom of [MIN_ZOOM, 5, 10]) {
            const count = Math.pow(2, zoom);
            for (const t of tilesForViewport(SYDNEY, zoom, 1200, 900)) {
                expect(t.x).toBeGreaterThanOrEqual(0);
                expect(t.x).toBeLessThan(count);
                expect(t.y).toBeGreaterThanOrEqual(0);
                expect(t.y).toBeLessThan(count);
            }
        }
    });

    it('drops tiles above the north pole rather than clamping them', () => {
        // Near the top of the world the viewport hangs over the edge.
        const tiles = tilesForViewport({ lat: 85, lon: 0 }, 3, 800, 600);
        expect(tiles.every(t => t.y >= 0)).toBe(true);
    });

    it('wraps around the date line so panning keeps drawing', () => {
        const tiles = tilesForViewport({ lat: 0, lon: 179.9 }, 3, 800, 600);
        const count = Math.pow(2, 3);
        expect(tiles.every(t => t.x >= 0 && t.x < count)).toBe(true);
        expect(new Set(tiles.map(t => t.x)).size).toBeGreaterThan(1);
    });

    it('builds an OpenStreetMap tile URL', () => {
        expect(tileUrl({ x: 4, y: 5, z: 3, wx: 4, left: 0, top: 0 }))
            .toBe('https://tile.openstreetmap.org/3/4/5.png');
    });

    it('gives each tile a stable unwrapped column, distinct even where x wraps', () => {
        // Straddling the date line: two columns wrap to the same tile x but keep
        // different wx, so tile diffing never confuses them for one <img>.
        const tiles = tilesForViewport({ lat: 0, lon: 179.9 }, 3, 800, 600);
        const count = Math.pow(2, 3);
        for (const t of tiles) expect(((t.wx % count) + count) % count).toBe(t.x);
        // wx is unique per drawn tile position; x need not be.
        const wxKeys = tiles.map(t => `${t.wx}/${t.y}`);
        expect(new Set(wxKeys).size).toBe(tiles.length);
    });
});

describe('pinchZoomStep', () => {
    it('does not step until the fingers cross a threshold', () => {
        expect(pinchZoomStep(105, 100).step).toBe(0);   // barely spread
        expect(pinchZoomStep(90, 100).step).toBe(0);    // barely pinched
    });

    it('steps in when the spread grows past the in-ratio', () => {
        const r = pinchZoomStep(100 * PINCH_ZOOM_IN_RATIO, 100);
        expect(r.step).toBe(1);
        expect(r.baseline).toBe(100 * PINCH_ZOOM_IN_RATIO);   // rebaselined for the next step
    });

    it('steps out when the spread shrinks past the out-ratio', () => {
        const r = pinchZoomStep(100 * PINCH_ZOOM_OUT_RATIO, 100);
        expect(r.step).toBe(-1);
        expect(r.baseline).toBe(100 * PINCH_ZOOM_OUT_RATIO);
    });

    it('carries the baseline through when it does not step', () => {
        expect(pinchZoomStep(110, 100).baseline).toBe(100);
    });

    it('adopts the first real spread instead of stepping from nothing', () => {
        // First move of a pinch: no baseline yet, so it only records one.
        const r = pinchZoomStep(150, 0);
        expect(r.step).toBe(0);
        expect(r.baseline).toBe(150);
    });

    it('takes repeated steps as the fingers keep spreading', () => {
        let baseline = 100;
        let steps = 0;
        for (const spread of [150, 230, 350]) {   // each comfortably past 1.4× the last
            const r = pinchZoomStep(spread, baseline);
            baseline = r.baseline;
            steps += r.step;
        }
        expect(steps).toBe(3);
    });
});

describe('pointInViewport', () => {
    it('puts the centre place in the middle of the viewport', () => {
        const at = pointInViewport(PRAGUE, PRAGUE, 10, 800, 600);
        expect(at.x).toBeCloseTo(400, 6);
        expect(at.y).toBeCloseTo(300, 6);
    });

    it('puts a place east of centre to the right', () => {
        const at = pointInViewport({ lat: 50.0755, lon: 15.5 }, PRAGUE, 10, 800, 600);
        expect(at.x).toBeGreaterThan(400);
    });
});

describe('panCenter', () => {
    it('dragging right moves the map east-to-west (centre goes west)', () => {
        const moved = panCenter(PRAGUE, 10, 100, 0);
        expect(moved.lon).toBeLessThan(PRAGUE.lon);
        expect(moved.lat).toBeCloseTo(PRAGUE.lat, 6);
    });

    it('is reversible', () => {
        const there = panCenter(PRAGUE, 10, 120, -80);
        const back = panCenter(there, 10, -120, 80);
        expect(back.lat).toBeCloseTo(PRAGUE.lat, 6);
        expect(back.lon).toBeCloseTo(PRAGUE.lon, 6);
    });
});

describe('zoomAround', () => {
    it('keeps the anchored spot under the same pixel', () => {
        const anchor = { x: 200, y: 150 };
        const before = pointInViewport(LONDON, PRAGUE, 5, 800, 600);
        // Anchor on London's pixel, then zoom in there.
        const next = zoomAround(PRAGUE, 5, 6, before, 800, 600);
        const after = pointInViewport(LONDON, next.center, next.zoom, 800, 600);
        expect(after.x).toBeCloseTo(before.x, 4);
        expect(after.y).toBeCloseTo(before.y, 4);
        expect(anchor).toBeTruthy();
    });

    it('refuses to zoom past the limits', () => {
        expect(zoomAround(PRAGUE, MAX_ZOOM, MAX_ZOOM + 3, { x: 0, y: 0 }, 800, 600).zoom).toBe(MAX_ZOOM);
        expect(zoomAround(PRAGUE, MIN_ZOOM, MIN_ZOOM - 3, { x: 0, y: 0 }, 800, 600).zoom).toBe(MIN_ZOOM);
    });
});

describe('fitBounds', () => {
    it('frames a single place at a readable zoom, not the maximum', () => {
        const fit = fitBounds([PRAGUE], 800, 600);
        expect(fit.center.lat).toBeCloseTo(PRAGUE.lat, 6);
        expect(fit.zoom).toBeGreaterThan(MIN_ZOOM);
        expect(fit.zoom).toBeLessThan(MAX_ZOOM);
    });

    it('fits every place inside the padded viewport', () => {
        const places = [PRAGUE, LONDON, SYDNEY];
        const fit = fitBounds(places, 800, 600);
        for (const place of places) {
            const at = pointInViewport(place, fit.center, fit.zoom, 800, 600);
            expect(at.x).toBeGreaterThanOrEqual(0);
            expect(at.x).toBeLessThanOrEqual(800);
            expect(at.y).toBeGreaterThanOrEqual(0);
            expect(at.y).toBeLessThanOrEqual(600);
        }
    });

    it('zooms closer on places that are near each other', () => {
        const near = fitBounds([PRAGUE, { lat: 50.08, lon: 14.44 }], 800, 600);
        const far = fitBounds([PRAGUE, SYDNEY], 800, 600);
        expect(near.zoom).toBeGreaterThan(far.zoom);
    });

    it('survives having nothing to frame', () => {
        const fit = fitBounds([], 800, 600);
        expect(Number.isFinite(fit.center.lat)).toBe(true);
        expect(fit.zoom).toBe(MIN_ZOOM);
    });
});
