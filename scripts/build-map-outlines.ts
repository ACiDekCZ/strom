/**
 * Generates src/map-outlines-data.ts — the country outlines the person page's
 * places map draws (spec 025, §1). Run once, by hand, when the extract should
 * change; the output is committed, nothing is fetched at build or run time.
 *
 *   npm pack world-atlas@2.0.2 && tar xzf world-atlas-2.0.2.tgz
 *   npx tsx scripts/build-map-outlines.ts <dir with countries-50m.json, countries-110m.json, land-110m.json>
 *
 * Source: Natural Earth (public domain) as packaged in world-atlas 2.0.2
 * (TopoJSON, ISC, Michael Bostock). The script decodes the TopoJSON arcs and
 * keeps:
 *   - 1:50m country borders and coastlines inside the detail regions (Europe,
 *     North America): the neighbourhood map;
 *   - 1:110m land polygons and country borders for the whole world: the inset
 *     world map and neighbourhoods outside the detail regions.
 * Lines are simplified (Douglas–Peucker), quantized and stored as delta-coded
 * strings in the 5-bit chunk scheme of the "encoded polyline" format.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Pos = [number, number];
interface Topo {
    transform?: { scale: [number, number]; translate: [number, number] };
    arcs: number[][][];
    objects: Record<string, { type: string; geometries: Geometry[] }>;
}
interface Geometry { type: string; id?: string; arcs?: number[][] | number[][][] }

/** Detail regions of the 50m extract: [west, south, east, north] in degrees. Keep in sync with the data module. */
const REGIONS: [number, number, number, number][] = [
    [-25, 34, 50, 72],     // Europe (with Iceland, the Caucasus)
    [-170, 14, -52, 62],   // North America south of the Arctic (with Mexico, the Caribbean)
];

const dir = process.argv[2];
if (!dir) {
    console.error('usage: tsx scripts/build-map-outlines.ts <world-atlas dir>');
    process.exit(1);
}
const read = (name: string): Topo => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Topo;

function decodeArcs(t: Topo): Pos[][] {
    const s = t.transform?.scale ?? [1, 1];
    const tr = t.transform?.translate ?? [0, 0];
    return t.arcs.map(arc => {
        let x = 0, y = 0;
        return arc.map(([dx, dy]) => {
            if (t.transform) { x += dx; y += dy; return [x * s[0] + tr[0], y * s[1] + tr[1]] as Pos; }
            return [dx, dy] as Pos;
        });
    });
}

function ringsOf(g: Geometry): number[][][] {
    if (g.type === 'Polygon') return [g.arcs as number[][]];
    if (g.type === 'MultiPolygon') return g.arcs as number[][][];
    return [];
}

/** Arcs used once (coast) and arcs between two different geometries (borders). */
function classify(t: Topo, object: string): { borders: number[]; coast: number[] } {
    const users = new Map<number, Set<number>>();
    const uses = new Map<number, number>();
    t.objects[object].geometries.forEach((g, gi) => {
        for (const poly of ringsOf(g)) for (const ring of poly) for (const ref of ring) {
            const i = ref < 0 ? ~ref : ref;
            if (!users.has(i)) users.set(i, new Set());
            users.get(i)!.add(gi);
            uses.set(i, (uses.get(i) ?? 0) + 1);
        }
    });
    const borders: number[] = [];
    const coast: number[] = [];
    for (const [i, set] of users) {
        if (set.size >= 2) borders.push(i);
        else if ((uses.get(i) ?? 0) === 1) coast.push(i);
    }
    return { borders: borders.sort((a, b) => a - b), coast: coast.sort((a, b) => a - b) };
}

function stitch(arcs: Pos[][], ring: number[]): Pos[] {
    const out: Pos[] = [];
    for (const ref of ring) {
        const a = ref < 0 ? [...arcs[~ref]].reverse() : arcs[ref];
        out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
}

function perpDist(p: Pos, a: Pos, b: Pos): number {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function simplify(pts: Pos[], tol: number): Pos[] {
    if (pts.length <= 2) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
        const [s, e] = stack.pop()!;
        let max = 0, idx = -1;
        for (let i = s + 1; i < e; i++) {
            const d = perpDist(pts[i], pts[s], pts[e]);
            if (d > max) { max = d; idx = i; }
        }
        if (idx >= 0 && max > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
}

const inRegion = (p: Pos, r: [number, number, number, number]): boolean =>
    p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];

/** The parts of a line inside any detail region (one point of margin each side). */
function clipToRegions(line: Pos[]): Pos[][] {
    const inside = line.map(p => REGIONS.some(r => inRegion(p, r)));
    const parts: Pos[][] = [];
    let cur: Pos[] = [];
    for (let i = 0; i < line.length; i++) {
        const keep = inside[i] || (i > 0 && inside[i - 1]) || (i + 1 < line.length && inside[i + 1]);
        if (keep) cur.push(line[i]);
        else if (cur.length) { if (cur.length > 1) parts.push(cur); cur = []; }
    }
    if (cur.length > 1) parts.push(cur);
    return parts;
}

function encodeNum(v: number): string {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let out = '';
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return out + String.fromCharCode(n + 63);
}

/** One line: quantized [lon, lat] deltas; repeated points dropped. */
function encodeLine(pts: Pos[], scale: number): string {
    let px = 0, py = 0, out = '', count = 0;
    for (const [lon, lat] of pts) {
        const x = Math.round(lon * scale), y = Math.round(lat * scale);
        if (count && x === px && y === py) continue;
        out += encodeNum(x - px) + encodeNum(y - py);
        px = x; py = y; count++;
    }
    return count >= 2 ? out : '';
}

function encodeSet(lines: Pos[][], tol: number, scale: number): string[] {
    return lines.map(l => encodeLine(simplify(l, tol), scale)).filter(Boolean);
}

// ── 1:50m, detail regions ──
const t50 = read('countries-50m.json');
const a50 = decodeArcs(t50);
const c50 = classify(t50, 'countries');
const lines50 = (ids: number[]) => ids.flatMap(i => clipToRegions(a50[i]));
const SCALE_50 = 200;        // 0.005° (≈ 0.5 km)
const TOL_50 = 0.008;
const borders50 = encodeSet(lines50(c50.borders), TOL_50, SCALE_50);
const coast50 = encodeSet(lines50(c50.coast), TOL_50, SCALE_50);

// ── 1:110m, the world ──
const t110 = read('countries-110m.json');
const a110 = decodeArcs(t110);
const c110 = classify(t110, 'countries');
const SCALE_110 = 20;        // 0.05°
const TOL_110 = 0.08;
const borders110 = encodeSet(c110.borders.map(i => a110[i]), TOL_110, SCALE_110);
const tl = read('land-110m.json');
const al = decodeArcs(tl);
const landRings: Pos[][] = [];
for (const g of tl.objects.land.geometries) for (const poly of ringsOf(g)) for (const ring of poly) landRings.push(stitch(al, ring));
const land110 = encodeSet(landRings, TOL_110, SCALE_110);

const chunk = (arr: string[]): string => {
    // Lines of about 1000 characters: one per line of source, readable diffs.
    const rows: string[] = [];
    let cur = '';
    for (const s of arr) {
        if (cur && cur.length + s.length > 1000) { rows.push(cur); cur = ''; }
        cur += (cur ? ' ' : '') + s;
    }
    if (cur) rows.push(cur);
    return '[\n' + rows.map(r => '    ' + JSON.stringify(r) + ',').join('\n') + '\n].join(\' \')';
};

const out = `/**
 * Country outlines for the person page's places map (spec 025, §1).
 *
 * GENERATED by scripts/build-map-outlines.ts — do not edit by hand.
 *
 * Source: Natural Earth (https://www.naturalearthdata.com), public domain,
 * as packaged in world-atlas 2.0.2 (TopoJSON; ISC License, Copyright
 * 2013-2019 Michael Bostock). Natural Earth: "Free vector and raster map data
 * @ naturalearthdata.com."
 *
 * Every string is a space-separated list of lines; a line is [lon, lat]
 * pairs, quantized to 1/SCALE degree and delta-coded in the 5-bit chunk
 * scheme of the encoded-polyline format (characters 63–126).
 */

/** 1:50m detail regions, [west, south, east, north] in degrees. */
export const OUTLINE_REGIONS_50M: readonly (readonly [number, number, number, number])[] = ${JSON.stringify(REGIONS)};

export const OUTLINE_SCALE_50M = ${SCALE_50};
export const OUTLINE_SCALE_110M = ${SCALE_110};

/** 1:50m country borders inside the detail regions. */
export const BORDERS_50M = ${chunk(borders50)};

/** 1:50m coastlines inside the detail regions. */
export const COAST_50M = ${chunk(coast50)};

/** 1:110m country borders, the world. */
export const BORDERS_110M = ${chunk(borders110)};

/** 1:110m land polygons (closed rings), the world. */
export const LAND_110M = ${chunk(land110)};
`;

const target = join(process.cwd(), 'src', 'map-outlines-data.ts');
writeFileSync(target, out);
const size = (a: string[]) => a.reduce((n, s) => n + s.length + 1, 0);
console.log(`borders50 ${borders50.length} lines ${size(borders50)} B; coast50 ${coast50.length} lines ${size(coast50)} B`);
console.log(`borders110 ${borders110.length} lines ${size(borders110)} B; land110 ${land110.length} rings ${size(land110)} B`);
console.log(`wrote ${target} (${out.length} B)`);
