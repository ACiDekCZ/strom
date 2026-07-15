/**
 * Slippy-map maths (A6). Pure functions only — no DOM, no network.
 *
 * The app has no runtime dependencies and ships as one HTML file, so a map
 * library is not an option: this module is the whole engine. It converts
 * lat/lon to Web Mercator pixels, works out which tiles a viewport needs, and
 * frames a set of points. src/ui/map-ui.ts turns that into <img> tiles.
 *
 * Tiles are the only part that needs the internet — everything a tree knows
 * about its places (the coordinates) lives in its own file.
 */

import { PlaceGeo } from './types.js';

/** Standard raster tile edge, in CSS pixels. */
export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;

/** Web Mercator cannot represent the poles; this is the usual cutoff. */
const MAX_LAT = 85.05112878;

export interface Point { x: number; y: number }

/** One tile to draw, with where it goes relative to the viewport's top-left. */
export interface TileRef {
    x: number;
    y: number;
    z: number;
    /** CSS offset inside the map container. */
    left: number;
    top: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** lat/lon → absolute world pixel at `zoom` (origin = top-left of the world). */
export function project(geo: PlaceGeo, zoom: number): Point {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const lat = clamp(geo.lat, -MAX_LAT, MAX_LAT);
    const sin = Math.sin((lat * Math.PI) / 180);
    return {
        x: ((geo.lon + 180) / 360) * scale,
        y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
    };
}

/** World pixel → lat/lon. Inverse of project(). */
export function unproject(p: Point, zoom: number): PlaceGeo {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const n = Math.PI - 2 * Math.PI * (p.y / scale);
    return {
        lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
        lon: (p.x / scale) * 360 - 180,
    };
}

/**
 * Every tile needed to cover a `width`×`height` viewport centred on `center`.
 * Tiles outside the world are dropped; the x axis wraps so panning across the
 * date line keeps drawing.
 */
export function tilesForViewport(center: PlaceGeo, zoom: number, width: number, height: number): TileRef[] {
    const z = Math.round(clamp(zoom, MIN_ZOOM, MAX_ZOOM));
    const c = project(center, z);
    // World pixel at the viewport's top-left corner.
    const originX = c.x - width / 2;
    const originY = c.y - height / 2;
    const count = Math.pow(2, z);

    const tiles: TileRef[] = [];
    const firstX = Math.floor(originX / TILE_SIZE);
    const lastX = Math.floor((originX + width) / TILE_SIZE);
    const firstY = Math.floor(originY / TILE_SIZE);
    const lastY = Math.floor((originY + height) / TILE_SIZE);

    for (let ty = firstY; ty <= lastY; ty++) {
        if (ty < 0 || ty >= count) continue;  // above the north pole / below the south
        for (let tx = firstX; tx <= lastX; tx++) {
            tiles.push({
                x: ((tx % count) + count) % count,  // wrap around the date line
                y: ty,
                z,
                left: tx * TILE_SIZE - originX,
                top: ty * TILE_SIZE - originY,
            });
        }
    }
    return tiles;
}

/** Where a place sits inside the viewport, in CSS pixels from its top-left. */
export function pointInViewport(geo: PlaceGeo, center: PlaceGeo, zoom: number, width: number, height: number): Point {
    const p = project(geo, zoom);
    const c = project(center, zoom);
    return { x: p.x - c.x + width / 2, y: p.y - c.y + height / 2 };
}

/** Move the centre by a screen-pixel drag (dragging right moves the map right). */
export function panCenter(center: PlaceGeo, zoom: number, dx: number, dy: number): PlaceGeo {
    const c = project(center, zoom);
    return unproject({ x: c.x - dx, y: c.y - dy }, zoom);
}

/**
 * Zoom while keeping `anchor` (a viewport pixel, e.g. the mouse) over the same
 * spot on the ground — the behaviour every map has.
 */
export function zoomAround(center: PlaceGeo, zoom: number, nextZoom: number, anchor: Point, width: number, height: number): { center: PlaceGeo; zoom: number } {
    const z2 = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (z2 === zoom) return { center, zoom };
    const ground = unproject(
        { x: project(center, zoom).x - width / 2 + anchor.x, y: project(center, zoom).y - height / 2 + anchor.y },
        zoom,
    );
    // Keep `ground` under the same anchor pixel at the new zoom.
    const g2 = project(ground, z2);
    const c2 = { x: g2.x - anchor.x + width / 2, y: g2.y - anchor.y + height / 2 };
    return { center: unproject(c2, z2), zoom: z2 };
}

/**
 * Frame all `points` in a `width`×`height` viewport. A single point gets a
 * sensible town-level zoom rather than the maximum, so it keeps some context.
 */
export function fitBounds(points: PlaceGeo[], width: number, height: number, padding = 60): { center: PlaceGeo; zoom: number } {
    if (points.length === 0) return { center: { lat: 50, lon: 15 }, zoom: MIN_ZOOM };
    if (points.length === 1) return { center: points[0], zoom: 11 };

    const lats = points.map(p => clamp(p.lat, -MAX_LAT, MAX_LAT));
    const lons = points.map(p => p.lon);
    const center = unproject(
        {
            x: (project({ lat: 0, lon: Math.min(...lons) }, 0).x + project({ lat: 0, lon: Math.max(...lons) }, 0).x) / 2,
            y: (project({ lat: Math.min(...lats), lon: 0 }, 0).y + project({ lat: Math.max(...lats), lon: 0 }, 0).y) / 2,
        },
        0,
    );

    // Largest zoom where the whole span still fits inside the padded viewport.
    const usableW = Math.max(50, width - padding * 2);
    const usableH = Math.max(50, height - padding * 2);
    let best = MIN_ZOOM;
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
        const xs = points.map(p => project(p, z).x);
        const ys = points.map(p => project(p, z).y);
        if (Math.max(...xs) - Math.min(...xs) > usableW) break;
        if (Math.max(...ys) - Math.min(...ys) > usableH) break;
        best = z;
    }
    return { center, zoom: best };
}

/**
 * OpenStreetMap raster tile. Tiles are fetched by the browser as plain images
 * when the map is open — that is the only thing the map needs online, and it
 * carries no data about the tree beyond which area is being looked at.
 */
export function tileUrl(tile: TileRef): string {
    return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
}

/** Required by the OSM tile policy and shown in the map corner. */
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors';
export const TILE_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';
