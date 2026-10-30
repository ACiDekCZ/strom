/**
 * Generates src/map-context-data.ts — the orientation layer of the person
 * page's places map for a small neighbourhood (spec 025, §1.3a): towns,
 * rivers, first-level regions and country polygons. Run once, by hand, when
 * the extract should change; the output is committed, nothing is fetched at
 * build or run time.
 *
 *   # Natural Earth 10m GeoJSON (github.com/nvkelso/natural-earth-vector, geojson/):
 *   #   ne_10m_populated_places_simple, ne_10m_rivers_lake_centerlines, ne_10m_admin_1_states_provinces
 *   # and the rivers' attribute table (10m_physical/ne_10m_rivers_lake_centerlines.dbf): their German
 *   # and English names (joined by RIVERNUM; the GeoJSON has no name_de)
 *   # world-atlas 2.0.2 (npm pack world-atlas@2.0.2): countries-50m.json
 *   npx tsx scripts/build-map-context.ts <dir with the NE GeoJSON> <world-atlas dir>
 *
 * Source: Natural Earth (public domain); the country polygons as packaged in
 * world-atlas 2.0.2 (TopoJSON, ISC, Michael Bostock). Kept:
 *   - towns: name, position, "big" (an admin-1 capital or POP_MAX ≥ 50 000) and
 *     the size class of POP_MAX; every town of the source (it holds only the
 *     notable ones), the whole world;
 *   - rivers and lake centrelines with SCALERANK ≤ 9, inside the detail regions
 *     (Europe, North America), with their English, German and Czech names
 *     (Czech from RIVER_NAMES_CS; a river without a name in a language stays
 *     unnamed there);
 *   - admin-1 regions inside the detail regions: name (+ English and German
 *     names when they differ and look sound) and a simplified polygon — just
 *     enough to tell whether a frame lies in one region;
 *   - country polygons (1:50m), simplified relative to the country's size: the
 *     "where in the country" inset.
 * Lines are simplified (Douglas–Peucker), quantized and stored as delta-coded
 * strings in the 5-bit chunk scheme of the "encoded polyline" format, as in
 * src/map-outlines-data.ts.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Pos = [number, number];

const [neDir, atlasDir] = process.argv.slice(2);
if (!neDir || !atlasDir) {
    console.error('usage: tsx scripts/build-map-context.ts <Natural Earth GeoJSON dir> <world-atlas dir>');
    process.exit(1);
}

/** Detail regions: [west, south, east, north] — the same as scripts/build-map-outlines.ts. */
const REGIONS: [number, number, number, number][] = [
    [-25, 34, 50, 72],
    [-170, 14, -52, 62],
];
const inRegions = (p: Pos): boolean => REGIONS.some(r => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]);

interface Feature { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }
const readGeo = (name: string): Feature[] =>
    (JSON.parse(readFileSync(join(neDir, `${name}.geojson`), 'utf8')) as { features: Feature[] }).features;

// ── shared encoding (as build-map-outlines.ts) ──

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

function encodeNum(v: number): string {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let out = '';
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return out + String.fromCharCode(n + 63);
}

function encodeLine(pts: Pos[], scale: number, minPts = 2): string {
    let px = 0, py = 0, out = '', count = 0;
    for (const [lon, lat] of pts) {
        const x = Math.round(lon * scale), y = Math.round(lat * scale);
        if (count && x === px && y === py) continue;
        out += encodeNum(x - px) + encodeNum(y - py);
        px = x; py = y; count++;
    }
    return count >= minPts ? out : '';
}

/** A ring simplified as an open line (first = last point kept), at least 4 points. */
function encodeRing(ring: Pos[], tol: number, scale: number): string {
    return encodeLine(simplify(ring, tol), scale, 4);
}

// ── towns ──
const SCALE_TOWN = 100;   // 0.01° (≈ 1 km)
/** Known typos of the source, corrected (the names show on the map). */
const TOWN_FIX: Record<string, string> = { 'Pizen': 'Plzeň', 'Usti Nad Labem': 'Ústí nad Labem' };
/** Size class of a population: 10·log10 (steps of about 26 %), 0 for none. */
const popClass = (pop: number): number => (pop > 0 ? Math.round(10 * Math.log10(pop)) : 0);
const towns = readGeo('ne_10m_populated_places_simple')
    .map(f => f.properties as { name: string; latitude: number; longitude: number; pop_max: number; featurecla: string })
    .map(p => ({
        name: (TOWN_FIX[p.name] ?? p.name).replace(/[|]/g, ' ').trim(),
        lon: p.longitude, lat: p.latitude,
        big: /admin-[01] capital/i.test(p.featurecla) || p.pop_max >= 50_000,
        pop: popClass(p.pop_max),
    }))
    .filter(t => t.name)
    .sort((a, b) => a.lon - b.lon || a.lat - b.lat);
let townCoords = '';
{
    let px = 0, py = 0;
    for (const t of towns) {
        const x = Math.round(t.lon * SCALE_TOWN), y = Math.round(t.lat * SCALE_TOWN);
        townCoords += encodeNum(x - px) + encodeNum(y - py) + encodeNum(t.pop);
        px = x; py = y;
    }
}
const townNames = towns.map(t => (t.big ? '*' : '') + t.name).join('|');

// ── rivers ──
const SCALE_RIVER = 200;  // 0.005°
const TOL_RIVER = 0.01;
/** Czech names of the rivers a Czech reader knows by a Czech name, by the English name (Natural Earth has no name_cs). */
const RIVER_NAMES_CS: Record<string, string> = {
    Elbe: 'Labe', Vltava: 'Vltava', Morava: 'Morava', Oder: 'Odra', Danube: 'Dunaj', Thaya: 'Dyje', Dyje: 'Dyje',
    Ohre: 'Ohře', 'Ohře': 'Ohře', Eger: 'Ohře', Sazava: 'Sázava', 'Sázava': 'Sázava', Berounka: 'Berounka',
    Vistula: 'Visla', Rhine: 'Rýn', Main: 'Mohan', Inn: 'Inn', Vah: 'Váh', 'Váh': 'Váh', Tisza: 'Tisa',
};
/** The attribute table of a shapefile (dBASE III): one record of trimmed strings per feature. */
function readDbf(path: string): Record<string, string>[] {
    const b = readFileSync(path);
    const n = b.readUInt32LE(4), hlen = b.readUInt16LE(8), rlen = b.readUInt16LE(10);
    const fields: { name: string; len: number }[] = [];
    for (let off = 32; b[off] !== 0x0d; off += 32) {
        fields.push({ name: b.toString('latin1', off, off + 11).split('\0')[0], len: b[off + 16] });
    }
    const out: Record<string, string>[] = [];
    for (let i = 0; i < n; i++) {
        let pos = hlen + i * rlen + 1;
        const rec: Record<string, string> = {};
        for (const f of fields) { rec[f.name] = b.toString('utf8', pos, pos + f.len).replace(/\0/g, '').trim(); pos += f.len; }
        out.push(rec);
    }
    return out;
}
/** English and German names by RIVERNUM (the first record that has them). */
const riverNames = new Map<string, { en: string; de: string }>();
for (const r of readDbf(join(neDir, 'ne_10m_rivers_lake_centerlines.dbf'))) {
    const num = r.rivernum, cur = riverNames.get(num);
    if (!cur) riverNames.set(num, { en: r.name_en, de: r.name_de });
    else { cur.en ||= r.name_en; cur.de ||= r.name_de; }
}
const cleanName = (n: unknown): string => String(n ?? '').replace(/[\t|]/g, ' ').trim();
/** One entry per set of names: "English|German|Czech\tline line …" (any name may be empty). */
const riverByName = new Map<string, string[]>();
for (const f of readGeo('ne_10m_rivers_lake_centerlines')) {
    const p = f.properties as { name?: string | null; name_en?: string | null; rivernum?: number; scalerank: number };
    if (p.scalerank > 9) continue;
    const joined = riverNames.get(String(p.rivernum ?? ''));
    const en = cleanName(joined?.en || p.name_en);
    const de = cleanName(joined?.de);
    const name = `${en}|${de}|${RIVER_NAMES_CS[en] ?? ''}`;
    const parts = (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]) as Pos[][];
    for (const line of parts) {
        // The runs inside the detail regions.
        let cur: Pos[] = [];
        const flush = () => {
            if (cur.length >= 2) {
                const enc = encodeLine(simplify(cur, TOL_RIVER), SCALE_RIVER);
                if (enc) riverByName.set(name, [...(riverByName.get(name) ?? []), enc]);
            }
            cur = [];
        };
        for (const pt of line) { if (inRegions(pt)) cur.push(pt); else flush(); }
        flush();
    }
}
const rivers = [...riverByName].map(([name, lines]) => `${name}\t${lines.join(' ')}`);

// ── admin-1 regions ──
const SCALE_ADM = 40;     // 0.025°
const TOL_ADM = 0.03;
/** Smallest frame a map draws: 25 km across the safe area = 37.5 × 18.75 km; a smaller region can never hold it. */
const MIN_REGION_KM2 = 700;
const soundName = (n: unknown, base: string): string => {
    if (typeof n !== 'string') return '';
    const s = n.trim();
    if (!s || s === base || s.endsWith('-') || /^Okres /.test(s) || /[|\t]/.test(s)) return '';
    return s;
};
/** Area of a ring in km² (equirectangular at its mean latitude; enough to sort out the small ones). */
function ringKm2(r: Pos[]): number {
    const lat0 = r.reduce((a, q) => a + q[1], 0) / r.length;
    const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * kx) * (r[i][1] * ky) - (r[i][0] * kx) * (r[j][1] * ky);
    return Math.abs(a) / 2;
}
const regions: string[] = [];
for (const f of readGeo('ne_10m_admin_1_states_provinces')) {
    const p = f.properties as Record<string, unknown>;
    const lon = p.longitude as number, lat = p.latitude as number;
    if (!inRegions([lon, lat])) continue;
    const name = String(p.name ?? '').replace(/[|\t]/g, ' ').trim();
    if (!name) continue;
    const polys = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]) as Pos[][][];
    if (Math.max(...polys.map(poly => ringKm2(poly[0]))) < MIN_REGION_KM2) continue;
    // Outer rings only (holes are rare at this level and do not change the test much); parts
    // too small to hold a frame are left out, a big region is simplified more.
    const big = polys.filter(poly => ringKm2(poly[0]) >= MIN_REGION_KM2).map(poly => poly[0]);
    const span = Math.max(...big.map(r => Math.max(Math.max(...r.map(q => q[0])) - Math.min(...r.map(q => q[0])), Math.max(...r.map(q => q[1])) - Math.min(...r.map(q => q[1])))));
    const rings = big.map(r => encodeRing(r, Math.max(TOL_ADM, span / 150), SCALE_ADM)).filter(Boolean);
    if (!rings.length) continue;
    regions.push(`${name}|${soundName(p.name_en, name)}|${soundName(p.name_de, name)}\t${rings.join(' ')}`);
}

// ── country polygons (world-atlas countries-50m) ──
interface Topo {
    transform: { scale: [number, number]; translate: [number, number] };
    arcs: number[][][];
    objects: { countries: { geometries: { type: string; id?: string; arcs?: number[][] | number[][][] }[] } };
}
const topo = JSON.parse(readFileSync(join(atlasDir, 'countries-50m.json'), 'utf8')) as Topo;
const arcs: Pos[][] = topo.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * topo.transform.scale[0] + topo.transform.translate[0], y * topo.transform.scale[1] + topo.transform.translate[1]] as Pos; });
});
const stitch = (ring: number[]): Pos[] => {
    const out: Pos[] = [];
    for (const ref of ring) {
        const a = ref < 0 ? [...arcs[~ref]].reverse() : arcs[ref];
        out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
};
const SCALE_CTRY = 50;    // 0.02°
const countries: string[] = [];
for (const g of topo.objects.countries.geometries) {
    const polys = g.type === 'Polygon' ? [g.arcs as number[][]] : g.type === 'MultiPolygon' ? (g.arcs as number[][][]) : [];
    const outer = polys.map(poly => stitch(poly[0]));
    if (!outer.length) continue;
    const lons = outer.flat().map(p => p[0]), lats = outer.flat().map(p => p[1]);
    // The biggest part's span sets the tolerance: the inset is ~150 px across.
    const main = outer.reduce((a, b) => (b.length > a.length ? b : a));
    const span = Math.max(Math.max(...main.map(p => p[0])) - Math.min(...main.map(p => p[0])), Math.max(...main.map(p => p[1])) - Math.min(...main.map(p => p[1])));
    const tol = Math.max(0.03, span / 200);
    const rings = outer.map(r => encodeRing(r, tol, SCALE_CTRY)).filter(Boolean);
    if (rings.length && Number.isFinite(Math.min(...lons)) && Number.isFinite(Math.min(...lats))) countries.push(rings.join(' '));
}

const chunk = (s: string): string => {
    const rows: string[] = [];
    for (let i = 0; i < s.length; i += 1000) rows.push(s.slice(i, i + 1000));
    return '[\n' + rows.map(r => '    ' + JSON.stringify(r) + ',').join('\n') + "\n].join('')";
};
const list = (arr: string[]): string => '[\n' + arr.map(r => '    ' + JSON.stringify(r) + ',').join('\n') + '\n]';

const out = `/**
 * Orientation layer of the person page's places map for a small neighbourhood
 * (spec 025, §1.3a): towns, rivers, first-level regions, country polygons.
 *
 * GENERATED by scripts/build-map-context.ts — do not edit by hand.
 *
 * Source: Natural Earth (https://www.naturalearthdata.com), public domain:
 * ne_10m_populated_places_simple, ne_10m_rivers_lake_centerlines,
 * ne_10m_admin_1_states_provinces; country polygons as packaged in
 * world-atlas 2.0.2 (TopoJSON; ISC License, Copyright 2013-2019 Michael
 * Bostock). Natural Earth: "Free vector and raster map data @
 * naturalearthdata.com."
 *
 * Coordinates are [lon, lat] pairs quantized to 1/SCALE degree and delta-coded
 * in the 5-bit chunk scheme of the encoded-polyline format (characters 63–126);
 * a space separates lines (rings). Decoded lazily (src/map-context.ts).
 */

export const TOWN_SCALE = ${SCALE_TOWN};
/** Town names in the order of TOWN_COORDS, "|"-separated; "*" marks a big town (a regional capital or 50 000+). */
export const TOWN_NAMES = ${chunk(townNames)};
/** Per town a delta-coded [lon, lat] pair and its size class (10·log10 POP_MAX, not delta-coded). */
export const TOWN_COORDS = ${chunk(townCoords)};

export const RIVER_SCALE = ${SCALE_RIVER};
/** "English|German|Czech<TAB>line line …" per river (the detail regions only; an empty name = none in that language). */
export const RIVERS: readonly string[] = ${list(rivers)};

export const REGION_SCALE = ${SCALE_ADM};
/** "name|English|German<TAB>ring ring …" per first-level region (the detail regions only; empty = as name). */
export const REGIONS: readonly string[] = ${list(regions)};

export const COUNTRY_SCALE = ${SCALE_CTRY};
/** "ring ring …" per country (outer rings of its parts). */
export const COUNTRIES: readonly string[] = ${list(countries)};
`;

const target = join(process.cwd(), 'src', 'map-context-data.ts');
writeFileSync(target, out);
const size = (a: string[] | string) => (typeof a === 'string' ? a.length : a.reduce((n, s) => n + s.length + 1, 0));
console.log(`towns ${towns.length}: names ${size(townNames)} B, coords ${size(townCoords)} B`);
console.log(`rivers ${rivers.length}: ${size(rivers)} B; regions ${regions.length}: ${size(regions)} B; countries ${countries.length}: ${size(countries)} B`);
console.log(`wrote ${target} (${Buffer.byteLength(out)} B)`);
