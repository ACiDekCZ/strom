/**
 * Country outlines as SVG paths for a static map frame (the person page's
 * places map, spec 025 §1). Pure: the outlines are bundled (Natural Earth,
 * public domain, src/map-outlines-data.ts) and nothing is fetched.
 *
 * At page build the lines are decoded once (cached), projected with Web
 * Mercator (the formula of src/map.ts), clipped to the frame + a margin and
 * thinned (points closer than 1.5 px to the previous one are dropped), so a
 * page carries only the few kilobytes its frame needs.
 */

import {
    OUTLINE_REGIONS_50M, OUTLINE_SCALE_50M, OUTLINE_SCALE_110M,
    BORDERS_50M, COAST_50M, BORDERS_110M, LAND_110M,
} from './map-outlines-data.js';

/** World pixels at zoom 0 (the world is 256 × 256), as map.ts project(geo, 0). */
export const WORLD = 256;
const MAX_LAT = 85.05112878;

export interface XY { x: number; y: number }

/** lon/lat → world pixel at zoom 0 (identical to map.ts `project(geo, 0)`). */
export function mercator(lon: number, lat: number): XY {
    const l = Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
    const sin = Math.sin((l * Math.PI) / 180);
    return { x: ((lon + 180) / 360) * WORLD, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * WORLD };
}

/** A decoded line: flat [lon, lat, lon, lat, …] with its bounding box. */
interface Line { c: Float64Array; w: number; s: number; e: number; n: number }

function decodeSet(text: string, scale: number): Line[] {
    const out: Line[] = [];
    for (const part of text.split(' ')) {
        if (!part) continue;
        const nums: number[] = [];
        let i = 0;
        while (i < part.length) {
            let shift = 0, result = 0, b: number;
            do {
                b = part.charCodeAt(i++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20 && i < part.length);
            nums.push(result & 1 ? ~(result >> 1) : result >> 1);
        }
        const c = new Float64Array(nums.length);
        let x = 0, y = 0, w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
        for (let k = 0; k + 1 < nums.length; k += 2) {
            x += nums[k]; y += nums[k + 1];
            const lon = x / scale, lat = y / scale;
            c[k] = lon; c[k + 1] = lat;
            if (lon < w) w = lon; if (lon > e) e = lon;
            if (lat < s) s = lat; if (lat > n) n = lat;
        }
        out.push({ c, w, s, e, n });
    }
    return out;
}

export type OutlineResolution = '50m' | '110m';

const cache = new Map<string, Line[]>();
function lines(name: 'borders50' | 'coast50' | 'borders110' | 'land110'): Line[] {
    let l = cache.get(name);
    if (!l) {
        l = name === 'borders50' ? decodeSet(BORDERS_50M, OUTLINE_SCALE_50M)
            : name === 'coast50' ? decodeSet(COAST_50M, OUTLINE_SCALE_50M)
                : name === 'borders110' ? decodeSet(BORDERS_110M, OUTLINE_SCALE_110M)
                    : decodeSet(LAND_110M, OUTLINE_SCALE_110M);
        cache.set(name, l);
    }
    return l;
}

/** Geographic bounds in degrees. */
export interface GeoBounds { west: number; south: number; east: number; north: number }

/**
 * The detail (1:50m) outlines cover the frame: it lies inside one detail
 * region and is not wider than a country-scale view; else the world (1:110m).
 */
export function outlineResolution(b: GeoBounds): OutlineResolution {
    if (b.east - b.west > 30) return '110m';
    return OUTLINE_REGIONS_50M.some(r => b.west >= r[0] && b.east <= r[2] && b.south >= r[1] && b.north <= r[3]) ? '50m' : '110m';
}

/** The frame: world pixels (zoom 0) → view units, `view = (world − origin) × k`. */
export interface OutlineView {
    x0: number;
    y0: number;
    k: number;
    width: number;
    height: number;
    /** Clip margin around the view, in view units (default 40). */
    margin?: number;
    /** Points closer than this to the previous kept one are dropped (default 1.5). */
    minStep?: number;
}

/** The geographic bounds a view (with its margin) covers. */
export function viewBounds(v: OutlineView): GeoBounds {
    const m = v.margin ?? 40;
    const toLon = (vx: number) => ((v.x0 + vx / v.k) / WORLD) * 360 - 180;
    const toLat = (vy: number) => {
        const n = Math.PI - 2 * Math.PI * ((v.y0 + vy / v.k) / WORLD);
        return (180 / Math.PI) * Math.atan(Math.sinh(n));
    };
    return { west: toLon(-m), east: toLon(v.width + m), north: toLat(-m), south: toLat(v.height + m) };
}

const r1 = (n: number): string => {
    const v = Math.round(n * 10) / 10;
    return (Object.is(v, -0) ? 0 : v).toString();
};

/** Does segment a→b touch the rectangle? (Liang–Barsky.) */
function segHitsRect(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return false; continue; }
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
}

function projectLine(l: Line, v: OutlineView): Float64Array {
    const out = new Float64Array(l.c.length);
    for (let i = 0; i + 1 < l.c.length; i += 2) {
        const p = mercator(l.c[i], l.c[i + 1]);
        out[i] = (p.x - v.x0) * v.k;
        out[i + 1] = (p.y - v.y0) * v.k;
    }
    return out;
}

function intersects(l: Line, b: GeoBounds): boolean {
    return !(l.e < b.west || l.w > b.east || l.n < b.south || l.s > b.north);
}

/** One path string ("M…l…") of polylines clipped to the view + margin and thinned. */
function polylinePath(set: Line[], v: OutlineView): string {
    const m = v.margin ?? 40;
    const step = v.minStep ?? 1.5;
    const x0 = -m, y0 = -m, x1 = v.width + m, y1 = v.height + m;
    const b = viewBounds(v);
    let d = '';
    for (const l of set) {
        if (!intersects(l, b)) continue;
        const p = projectLine(l, v);
        const n = p.length / 2;
        // Runs of consecutive segments that touch the clip rectangle.
        let run: number[] = [];
        const flush = () => {
            if (run.length >= 2) d += pathOf(p, run, step, false);
            run = [];
        };
        for (let i = 0; i + 1 < n; i++) {
            if (segHitsRect(p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3], x0, y0, x1, y1)) {
                if (!run.length) run.push(i);
                run.push(i + 1);
            } else flush();
        }
        flush();
    }
    return d;
}

/** "M x y l dx dy …" for the points `idx` of `p`, dropping points closer than `step`. */
function pathOf(p: Float64Array, idx: number[], step: number, close: boolean): string {
    const keep: number[] = [idx[0]];
    for (let k = 1; k < idx.length; k++) {
        const i = idx[k], j = keep[keep.length - 1];
        const last = k === idx.length - 1;
        if (Math.hypot(p[2 * i] - p[2 * j], p[2 * i + 1] - p[2 * j + 1]) >= step || (last && !close)) keep.push(i);
    }
    if (keep.length < 2) return '';
    let px = Math.round(p[2 * keep[0]] * 10) / 10, py = Math.round(p[2 * keep[0] + 1] * 10) / 10;
    let s = `M${r1(px)} ${r1(py)}`;
    for (let k = 1; k < keep.length; k++) {
        const x = Math.round(p[2 * keep[k]] * 10) / 10, y = Math.round(p[2 * keep[k] + 1] * 10) / 10;
        const dx = x - px, dy = y - py;
        if (dx === 0 && dy === 0) continue;
        s += `l${r1(dx)}${dy < 0 ? '' : ' '}${r1(dy)}`;
        px = x; py = y;
    }
    return close ? s + 'z' : s;
}

/** Sutherland–Hodgman: a projected ring clipped to the rectangle. */
function clipRing(p: Float64Array, x0: number, y0: number, x1: number, y1: number): number[] {
    let pts: number[] = Array.from(p);
    const edges: [(x: number, y: number) => boolean, (ax: number, ay: number, bx: number, by: number) => [number, number]][] = [
        [(x) => x >= x0, (ax, ay, bx, by) => [x0, ay + (by - ay) * (x0 - ax) / (bx - ax)]],
        [(x) => x <= x1, (ax, ay, bx, by) => [x1, ay + (by - ay) * (x1 - ax) / (bx - ax)]],
        [(_x, y) => y >= y0, (ax, ay, bx, by) => [ax + (bx - ax) * (y0 - ay) / (by - ay), y0]],
        [(_x, y) => y <= y1, (ax, ay, bx, by) => [ax + (bx - ax) * (y1 - ay) / (by - ay), y1]],
    ];
    for (const [inside, cut] of edges) {
        const out: number[] = [];
        const n = pts.length / 2;
        if (!n) break;
        for (let i = 0; i < n; i++) {
            const cx = pts[2 * i], cy = pts[2 * i + 1];
            const j = (i + n - 1) % n;
            const px = pts[2 * j], py = pts[2 * j + 1];
            const cin = inside(cx, cy), pin = inside(px, py);
            if (cin) {
                if (!pin) out.push(...cut(px, py, cx, cy));
                out.push(cx, cy);
            } else if (pin) out.push(...cut(px, py, cx, cy));
        }
        pts = out;
    }
    return pts;
}

/** Land polygons clipped to the view + margin, as one even-odd path. */
function polygonPath(set: Line[], v: OutlineView): string {
    const m = v.margin ?? 40;
    const step = v.minStep ?? 1.5;
    const b = viewBounds(v);
    let d = '';
    for (const l of set) {
        if (!intersects(l, b)) continue;
        const clipped = clipRing(projectLine(l, v), -m, -m, v.width + m, v.height + m);
        if (clipped.length < 6) continue;
        const arr = Float64Array.from(clipped);
        d += pathOf(arr, Array.from({ length: arr.length / 2 }, (_, i) => i), step, true);
    }
    return d;
}

export interface OutlinePaths {
    /** Country borders (a dashed line). */
    borders: string;
    /** Coastlines (1:50m; the 1:110m view draws land instead). */
    coast: string;
    /** Land polygons, even-odd (1:110m only). */
    land: string;
}

/**
 * The outlines of a view at the given resolution, as SVG path data. A view
 * across the 180th meridian (its longitudes past ±180, as the person page's
 * map frames places on both sides of it) also gets the world's copy there.
 */
export function outlinePaths(v: OutlineView, res: OutlineResolution, want: { land?: boolean } = {}): OutlinePaths {
    const out: OutlinePaths = { borders: '', coast: '', land: '' };
    for (const shift of [0, WORLD, -WORLD]) {
        const sv = shift ? { ...v, x0: v.x0 - shift } : v;
        if (shift) {
            const b = viewBounds(sv);
            if (b.east < -180 || b.west > 180) continue;
        }
        const one = outlinePathsOnce(sv, res, want);
        out.borders += one.borders;
        out.coast += one.coast;
        out.land += one.land;
    }
    return out;
}

function outlinePathsOnce(v: OutlineView, res: OutlineResolution, want: { land?: boolean }): OutlinePaths {
    if (res === '50m') {
        return { borders: polylinePath(lines('borders50'), v), coast: polylinePath(lines('coast50'), v), land: '' };
    }
    return {
        borders: polylinePath(lines('borders110'), v),
        coast: want.land ? '' : polygonPath(lines('land110'), v).replace(/z/g, ''),
        land: want.land ? polygonPath(lines('land110'), v) : '',
    };
}
