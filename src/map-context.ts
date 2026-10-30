/**
 * The orientation layer of a small neighbourhood map (spec 025, §1.3a):
 * towns, rivers, first-level regions and country polygons, from the bundled
 * Natural Earth extract (public domain, src/map-context-data.ts). Pure; each
 * set is decoded on first use (when a map is built, never at start-up) and
 * cached.
 */

import {
    TOWN_SCALE, TOWN_NAMES, TOWN_COORDS, RIVER_SCALE, RIVERS, REGION_SCALE, REGIONS, COUNTRY_SCALE, COUNTRIES,
} from './map-context-data.js';
import { decodeLines, type GeoLine, type GeoBounds } from './map-outlines.js';

export interface Town {
    name: string; lon: number; lat: number;
    /** A regional capital or a city of 50 000+. */
    big: boolean;
    /** Size class of the population (10·log10 POP_MAX, 0 unknown): a bigger town has a higher one. */
    pop: number;
}
/** A river's names in the app's languages; '' where the data have none (the river is then drawn unnamed). */
export interface River { names: { en: string; de: string; cs: string }; lines: GeoLine[] }
export interface Region { name: string; en: string; de: string; rings: GeoLine[] }

let townCache: Town[] | null = null;
let riverCache: River[] | null = null;
let regionCache: Region[] | null = null;
let countryCache: GeoLine[][] | null = null;

/** The notable towns of Natural Earth, the whole world. */
export function towns(): Town[] {
    if (townCache) return townCache;
    const names = TOWN_NAMES.split('|');
    const out: Town[] = [];
    let i = 0, x = 0, y = 0;
    const next = (): number => {
        let shift = 0, result = 0, b: number;
        do {
            b = TOWN_COORDS.charCodeAt(i++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20 && i < TOWN_COORDS.length);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    for (const raw of names) {
        if (i >= TOWN_COORDS.length) break;
        x += next(); y += next();
        const pop = next();
        const big = raw.startsWith('*');
        out.push({ name: big ? raw.slice(1) : raw, lon: x / TOWN_SCALE, lat: y / TOWN_SCALE, big, pop });
    }
    townCache = out;
    return out;
}

/** Rivers and lake centrelines of Europe and North America. */
export function rivers(): River[] {
    if (riverCache) return riverCache;
    riverCache = RIVERS.map(row => {
        const tab = row.indexOf('\t');
        const [en = '', de = '', cs = ''] = row.slice(0, tab).split('|');
        return { names: { en, de, cs }, lines: decodeLines(row.slice(tab + 1), RIVER_SCALE) };
    });
    return riverCache;
}

/** A river's name in a language: never another language's name ('' = draw it unnamed). */
export function riverName(r: River, lang: string): string {
    return lang === 'cs' ? r.names.cs : lang === 'de' ? r.names.de : r.names.en;
}

function regions(): Region[] {
    if (regionCache) return regionCache;
    regionCache = REGIONS.map(row => {
        const tab = row.indexOf('\t');
        const [name, en, de] = row.slice(0, tab).split('|');
        return { name, en: en || name, de: de || name, rings: decodeLines(row.slice(tab + 1), REGION_SCALE) };
    });
    return regionCache;
}

function countries(): GeoLine[][] {
    if (countryCache) return countryCache;
    countryCache = COUNTRIES.map(row => decodeLines(row, COUNTRY_SCALE));
    return countryCache;
}

/** Even-odd point-in-ring test over the rings of one area. */
function inRings(rings: readonly GeoLine[], lon: number, lat: number): boolean {
    let inside = false;
    for (const r of rings) {
        if (lon < r.w || lon > r.e || lat < r.s || lat > r.n) continue;
        const c = r.c, n = c.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = c[2 * i], yi = c[2 * i + 1], xj = c[2 * j], yj = c[2 * j + 1];
            if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
        }
    }
    return inside;
}

const normLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * The first-level region (kraj, Land, state …) that holds every given point,
 * or null when the points span two regions or lie outside the data (only
 * Europe and North America; regions smaller than the smallest frame left out).
 */
export function regionOf(pts: readonly { lon: number; lat: number }[]): Region | null {
    if (!pts.length) return null;
    const first = { lon: normLon(pts[0].lon), lat: pts[0].lat };
    const hit = regions().find(r => inRings(r.rings, first.lon, first.lat));
    if (!hit) return null;
    return pts.every(p => inRings(hit.rings, normLon(p.lon), p.lat)) ? hit : null;
}

/** The region's name in a language (the source's name when it has none for it). */
export function regionName(r: Region, lang: string): string {
    return lang === 'en' ? r.en : lang === 'de' ? r.de : r.name;
}

/**
 * The country at a point: the parts of its polygon near the part that holds
 * the point (a part whose centre lies far outside it — an overseas territory,
 * Alaska beside the contiguous states — left out), or null.
 * A point just off a simplified coast takes the country whose part is nearest
 * (within ~30 km).
 */
export function countryAt(lon0: number, lat: number): GeoLine[] | null {
    const lon = normLon(lon0);
    const all = countries();
    let parts: GeoLine[] | undefined;
    let main: GeoLine | undefined;
    for (const c of all) {
        const ring = c.find(r => inRings([r], lon, lat));
        if (ring) { parts = c; main = ring; break; }
    }
    if (!parts || !main) {
        let best = 0.3;
        for (const c of all) {
            for (const r of c) {
                if (lon < r.w - best || lon > r.e + best || lat < r.s - best || lat > r.n + best) continue;
                for (let i = 0; i + 1 < r.c.length; i += 2) {
                    const d = Math.hypot((r.c[i] - lon) * Math.cos((lat * Math.PI) / 180), r.c[i + 1] - lat);
                    if (d < best) { best = d; parts = c; main = r; }
                }
            }
        }
    }
    if (!parts || !main) return null;
    const m = main;
    const pad = Math.max(1, 0.15 * Math.max(m.e - m.w, m.n - m.s));
    return parts.filter(r => {
        if (r === m) return true;
        const cx = (r.w + r.e) / 2, cy = (r.s + r.n) / 2;
        return cx >= m.w - pad && cx <= m.e + pad && cy >= m.s - pad && cy <= m.n + pad;
    });
}

/** Bounds of a set of rings. */
export function ringsBounds(rings: readonly GeoLine[]): GeoBounds {
    return {
        west: Math.min(...rings.map(r => r.w)), east: Math.max(...rings.map(r => r.e)),
        south: Math.min(...rings.map(r => r.s)), north: Math.max(...rings.map(r => r.n)),
    };
}
