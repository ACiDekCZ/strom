/**
 * Bundled country outlines (spec 025 §1.1): the projection matches the map's,
 * the resolution choice, clipping to the frame + margin, thinning, and the
 * size of a frame's paths.
 */

import { describe, it, expect } from 'vitest';
import { mercator, outlinePaths, outlineResolution, viewBounds, WORLD, type OutlineView } from '../map-outlines.js';
import { project } from '../map.js';

/** A view of `kmAcross` km around a point, 640 × 320 units. */
function viewAround(lat: number, lon: number, degAcross: number): OutlineView {
    const c = mercator(lon, lat);
    const k = 640 / ((degAcross / 360) * WORLD);
    return { x0: c.x - 320 / k, y0: c.y - 160 / k, k, width: 640, height: 320 };
}

/** All absolute coordinates a relative path visits. */
function pathPoints(d: string): [number, number][] {
    const out: [number, number][] = [];
    let x = 0, y = 0;
    for (const m of d.matchAll(/([Ml])(-?[\d.]+)[ ]?(-?[\d.]+)/g)) {
        const a = parseFloat(m[2]), b = parseFloat(m[3]);
        if (m[1] === 'M') { x = a; y = b; } else { x += a; y += b; }
        out.push([x, y]);
    }
    return out;
}

describe('map outlines', () => {
    it('projects like the application map (zoom 0)', () => {
        for (const g of [{ lat: 50.08, lon: 14.43 }, { lat: -33.9, lon: 151.2 }, { lat: 89, lon: -170 }]) {
            const a = mercator(g.lon, g.lat), b = project(g, 0);
            expect(a.x).toBeCloseTo(b.x, 9);
            expect(a.y).toBeCloseTo(b.y, 9);
        }
    });

    it('detail outlines for a neighbourhood in Europe or North America, the world ones elsewhere', () => {
        expect(outlineResolution({ west: 14, east: 16, south: 49, north: 50.5 })).toBe('50m');
        expect(outlineResolution({ west: -90, east: -86, south: 40, north: 43 })).toBe('50m');
        expect(outlineResolution({ west: 140, east: 152, south: -36, north: -30 })).toBe('110m');
        expect(outlineResolution({ west: -80, east: 20, south: 35, north: 60 })).toBe('110m'); // ocean-wide
    });

    it('view bounds cover the frame and its margin', () => {
        const v = viewAround(50, 15, 2);
        const b = viewBounds(v);
        expect(b.west).toBeLessThan(14);
        expect(b.east).toBeGreaterThan(16);
        expect(b.north).toBeGreaterThan(b.south);
    });

    it('clips to the frame + 40 units and keeps a neighbourhood small', () => {
        const v = viewAround(49.8, 15.5, 4); // Bohemia
        const o = outlinePaths(v, '50m');
        expect(o.borders.length).toBeGreaterThan(0);
        expect(o.land).toBe('');
        for (const [x, y] of pathPoints(o.borders + o.coast)) {
            // A clipped run keeps one point beyond the margin on each side at most: allow a segment's length.
            expect(x).toBeGreaterThan(-400);
            expect(x).toBeLessThan(1040);
            expect(y).toBeGreaterThan(-400);
            expect(y).toBeLessThan(720);
        }
        expect(o.borders.length + o.coast.length).toBeLessThan(40_000);
    });

    it('a coastal neighbourhood has a coastline', () => {
        const o = outlinePaths(viewAround(54.3, 18.6, 3), '50m'); // Gdańsk
        expect(o.coast.length).toBeGreaterThan(100);
    });

    it('the world map: land polygons (even-odd, closed), within size', () => {
        const v = viewAround(45, -30, 140);
        const o = outlinePaths({ ...v, width: 240, height: 120, k: v.k * 240 / 640, x0: v.x0, y0: v.y0 }, '110m', { land: true });
        expect(o.land.length).toBeGreaterThan(500);
        expect(o.land).toMatch(/z/);
        expect(o.land.length).toBeLessThan(40_000);
    });

    it('thinning: a coarser step gives a shorter path', () => {
        const v = viewAround(49.8, 15.5, 8);
        const fine = outlinePaths({ ...v, minStep: 0.5 }, '50m').borders.length;
        const coarse = outlinePaths({ ...v, minStep: 4 }, '50m').borders.length;
        expect(coarse).toBeLessThan(fine);
    });
});
