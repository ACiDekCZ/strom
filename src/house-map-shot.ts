/**
 * A cut of the map around a house for outputs (spec 145 T3): the book, the
 * saved house page and the family pages show a house's location as a picture
 * made once when the output is made, never as live tiles. Today's map is the
 * app's own tiles (OpenStreetMap) put together with the house's point and its
 * number; a research's historical layer (`/status.houses.layers`, the HTML
 * only) is one picture of the same frame from its service. Every picture is a
 * data URL, so the output works without the network.
 *
 * A picture made is kept (`ShotCache`, by the house, its point, the view, the
 * zoom and the size), so a print, a PDF or a gift made later needs no new
 * download: without the network a kept picture is used, without one the
 * output gives the coordinates and how sure the location is, with no error.
 * Nothing waits longer than its limit.
 *
 * Pure of the DOM: the loading of an image, the canvas and the cache are
 * injected (src/ui/house-map-shots.ts in the app, fakes in the tests).
 */

import type { HouseId } from './types.js';
import type { HouseResearch } from './house-bridge.js';
import type { LiveHouseLayer } from './research-link.js';
import { project, TILE_SIZE, tilesForViewport, tileUrl } from './map.js';
import {
    HOUSE_MAP_ZOOM, houseImageScale, houseImageUrl, houseMapAttribution, houseMapViews, housePointLabel, wmsGetMapUrl,
    type HouseMapPoint, type HouseMapView,
} from './house-map.js';
import { getStringsForLang, type Language } from './strings.js';

/** The picture's size in CSS pixels (a street around the house at HOUSE_MAP_ZOOM). */
export const HOUSE_SHOT_WIDTH = 600;
export const HOUSE_SHOT_HEIGHT = 300;
/** One picture waits this long at most. */
export const HOUSE_SHOT_TIMEOUT_MS = 10_000;
/** The key's version: a change of how a picture is drawn makes the kept ones old. */
const SHOT_KEY_VERSION = 1;

/** One picture of the place, ready for an output. */
export interface HouseMapShot {
    /** 'today' or the research's layer id. */
    view: string;
    /** "Today" / the layer's name. */
    label: string;
    /** data:image/png;base64,… (or image/jpeg for a layer's photo). */
    src: string;
    width: number;
    height: number;
    /** The attribution with the licence, whole as the terms want it. */
    attribution: string;
    /** The attribution's page (today's map), when there is one. */
    attributionUrl?: string;
}

/** The pictures of a house: today's map, and the research's historical layers (the HTML only). */
export interface HouseMapShots {
    today: HouseMapShot | null;
    layers: HouseMapShot[];
}

/** An image the canvas can draw. */
export type ShotImage = { width: number; height: number };

/** The part of a 2D context a picture is drawn with. */
export interface ShotContext {
    drawImage(image: ShotImage, x: number, y: number, w?: number, h?: number): void;
    beginPath(): void;
    arc(x: number, y: number, r: number, a0: number, a1: number): void;
    fill(): void;
    stroke(): void;
    fillText(text: string, x: number, y: number): void;
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
}

/** Where kept pictures live (IndexedDB in the app). */
export interface ShotCache {
    get(key: string): Promise<string | null>;
    put(key: string, src: string): Promise<void>;
}

export interface HouseShotDeps {
    /** Today's tiles may be fetched (the map's notice was acknowledged, the server did not refuse). */
    tilesAllowed: boolean;
    /** Today's tile (OpenStreetMap, the app's way of asking); throws when it does not come. */
    loadTile(url: string, signal: AbortSignal): Promise<ShotImage>;
    /** A research's layer picture (a WMS GetMap); throws when it does not come or is not a picture. */
    loadLayer(url: string, signal: AbortSignal): Promise<ShotImage>;
    /** A canvas of this size, read out as a data URL. */
    canvas(width: number, height: number): { ctx: ShotContext; toDataUrl(type: 'image/png' | 'image/jpeg'): string };
    cache: ShotCache;
    timeoutMs?: number;
}

/** The key a picture is kept under: the house, its point, the view, the zoom and the size. */
export function houseShotKey(houseId: HouseId, point: HouseMapPoint, view: string, zoom = HOUSE_MAP_ZOOM,
    width = HOUSE_SHOT_WIDTH, height = HOUSE_SHOT_HEIGHT): string {
    return `v${SHOT_KEY_VERSION}|${houseId}|${point.lat.toFixed(6)},${point.lng.toFixed(6)}|${view}|z${zoom}|${width}x${height}`;
}

/**
 * The research's historical layers of a house (the HTML's pictures beside today's map): the layer switch's views
 * (houseMapViews: a layer in a system the app cannot convert into is left out) but today's map and today's
 * orthophoto.
 */
export function historicalHouseViews(layers: readonly LiveHouseLayer[], research: HouseResearch | null, point: HouseMapPoint,
    lang: Language): HouseMapView[] {
    return houseMapViews(layers, research, point, lang).filter(v => v.kind !== 'today' && v.layer && v.layer.kind !== 'ortho');
}

/** The tiles of today's map around a point, placed in a picture of this size. */
export function todayShotTiles(point: HouseMapPoint, zoom = HOUSE_MAP_ZOOM, width = HOUSE_SHOT_WIDTH, height = HOUSE_SHOT_HEIGHT):
    { url: string; left: number; top: number }[] {
    return tilesForViewport({ lat: point.lat, lon: point.lng }, zoom, width, height)
        .map(t => ({ url: tileUrl(t), left: Math.round(t.left), top: Math.round(t.top) }));
}

const MERC_HALF = Math.PI * 6378137;

/** The frame of a picture around a point in Web Mercator metres (EPSG:3857): [minx, miny, maxx, maxy]. */
export function shotBox3857(point: HouseMapPoint, zoom = HOUSE_MAP_ZOOM, width = HOUSE_SHOT_WIDTH, height = HOUSE_SHOT_HEIGHT):
    [number, number, number, number] {
    const c = project({ lat: point.lat, lon: point.lng }, zoom);
    const mpp = (2 * MERC_HALF) / (TILE_SIZE * Math.pow(2, zoom));
    const x = -MERC_HALF + c.x * mpp;
    const y = MERC_HALF - c.y * mpp;
    return [x - (width / 2) * mpp, y - (height / 2) * mpp, x + (width / 2) * mpp, y + (height / 2) * mpp];
}

/** The address of a layer's picture of the frame (one GetMap): in Web Mercator, or in the layer's own system. */
export function layerShotUrl(layer: LiveHouseLayer, point: HouseMapPoint, zoom = HOUSE_MAP_ZOOM,
    width = HOUSE_SHOT_WIDTH, height = HOUSE_SHOT_HEIGHT): string | null {
    if (layer.crs) {
        const m = houseImageScale(zoom);
        return houseImageUrl(layer, point, width * m, height * m, width, height);
    }
    return wmsGetMapUrl(layer, 'EPSG:3857', shotBox3857(point, zoom, width, height), width, height);
}

/** The house's point with its number in the middle of the picture (the app's map pin, drawn). */
function drawPin(ctx: ShotContext, label: string, width: number, height: number): void {
    const x = width / 2, y = height / 2;
    const r = label.length > 3 ? 15 : 12;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#9a3412';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${label.length > 3 ? 10 : 12}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.slice(0, 5), x, y + 0.5);
}

/** Run `job` with its own abort signal, given up after `ms` (null then) or when it throws. */
async function limited<T>(ms: number, job: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const late = new Promise<null>(resolve => { timer = setTimeout(() => { ctrl.abort(); resolve(null); }, ms); });
    try {
        return await Promise.race([job(ctrl.signal), late]);
    } catch {
        return null;
    } finally {
        if (timer !== null) clearTimeout(timer);
        ctrl.abort();
    }
}

async function cached(cache: ShotCache, key: string): Promise<string | null> {
    try { return await cache.get(key); } catch { return null; }
}

async function keep(cache: ShotCache, key: string, src: string): Promise<void> {
    try { await cache.put(key, src); } catch { /* kept for this output only */ }
}

/**
 * Today's map around a house's point: the kept picture, else its tiles put together with the point (only when
 * tiles may be fetched); null when neither (no network, no consent, a tile that did not come, the limit).
 */
export async function todayHouseShot(houseId: HouseId, houseText: string, point: HouseMapPoint, lang: Language,
    deps: HouseShotDeps): Promise<HouseMapShot | null> {
    const M = getStringsForLang(lang).houses.page.map;
    const shot = (src: string): HouseMapShot => ({
        view: 'today', label: M.today, src, width: HOUSE_SHOT_WIDTH, height: HOUSE_SHOT_HEIGHT,
        attribution: M.osmAttribution, attributionUrl: houseMapAttribution({ id: 'today', kind: 'today', label: M.today }).url,
    });
    const key = houseShotKey(houseId, point, 'today');
    const kept = await cached(deps.cache, key);
    if (kept) return shot(kept);
    if (!deps.tilesAllowed) return null;
    const src = await limited(deps.timeoutMs ?? HOUSE_SHOT_TIMEOUT_MS, async signal => {
        const tiles = todayShotTiles(point);
        const images = await Promise.all(tiles.map(t => deps.loadTile(t.url, signal)));
        const { ctx, toDataUrl } = deps.canvas(HOUSE_SHOT_WIDTH, HOUSE_SHOT_HEIGHT);
        tiles.forEach((t, i) => ctx.drawImage(images[i], t.left, t.top, TILE_SIZE, TILE_SIZE));
        drawPin(ctx, housePointLabel(houseText), HOUSE_SHOT_WIDTH, HOUSE_SHOT_HEIGHT);
        return toDataUrl('image/png');
    });
    if (!src) return null;
    await keep(deps.cache, key, src);
    return shot(src);
}

/** A research's layer around a house's point: the kept picture, else one GetMap with the point drawn; null when not. */
export async function layerHouseShot(houseId: HouseId, houseText: string, point: HouseMapPoint, view: HouseMapView,
    deps: HouseShotDeps): Promise<HouseMapShot | null> {
    const layer = view.layer;
    if (!layer) return null;
    const a = houseMapAttribution(view);
    const shot = (src: string): HouseMapShot => ({
        view: view.id, label: view.label, src, width: HOUSE_SHOT_WIDTH, height: HOUSE_SHOT_HEIGHT, attribution: a.text,
    });
    const key = houseShotKey(houseId, point, view.id);
    const kept = await cached(deps.cache, key);
    if (kept) return shot(kept);
    const url = layerShotUrl(layer, point);
    if (!url) return null;
    const src = await limited(deps.timeoutMs ?? HOUSE_SHOT_TIMEOUT_MS, async signal => {
        const image = await deps.loadLayer(url, signal);
        const { ctx, toDataUrl } = deps.canvas(HOUSE_SHOT_WIDTH, HOUSE_SHOT_HEIGHT);
        ctx.drawImage(image, 0, 0, HOUSE_SHOT_WIDTH, HOUSE_SHOT_HEIGHT);
        drawPin(ctx, housePointLabel(houseText), HOUSE_SHOT_WIDTH, HOUSE_SHOT_HEIGHT);
        // A photo of the place is smaller as JPEG; a map's lines stay sharp as PNG.
        return toDataUrl(layer.kind?.startsWith('ortho') ? 'image/jpeg' : 'image/png');
    });
    if (!src) return null;
    await keep(deps.cache, key, src);
    return shot(src);
}

/** What one output asks for a house: its point (as outputs may show it) and whether the historical layers too. */
export interface HouseShotRequest {
    houseId: HouseId;
    houseText: string;
    point: HouseMapPoint;
    research: HouseResearch | null;
    /** The HTML: the research's historical layers beside today's map (the book: today's map only). */
    layers?: readonly LiveHouseLayer[];
}

/** The pictures of one house: today's map, and its historical layers when asked for. Never throws. */
export async function houseShots(req: HouseShotRequest, lang: Language, deps: HouseShotDeps): Promise<HouseMapShots> {
    const today = await todayHouseShot(req.houseId, req.houseText, req.point, lang, deps).catch(() => null);
    const views = req.layers?.length ? historicalHouseViews(req.layers, req.research, req.point, lang) : [];
    const layers: HouseMapShot[] = [];
    for (const v of views) {
        const s = await layerHouseShot(req.houseId, req.houseText, req.point, v, deps).catch(() => null);
        if (s) layers.push(s);
    }
    return { today, layers };
}

/**
 * The pictures of several houses (an output's), `limit` houses at a time, all within `totalMs`: what is not done by
 * then is left without a picture (its coordinates still shown). Houses without any picture are left out of the map.
 */
export async function houseShotsFor(reqs: readonly HouseShotRequest[], lang: Language, deps: HouseShotDeps,
    opts: { limit?: number; totalMs?: number } = {}): Promise<Map<HouseId, HouseMapShots>> {
    const out = new Map<HouseId, HouseMapShots>();
    if (!reqs.length) return out;
    let next = 0;
    let over = false;
    const worker = async (): Promise<void> => {
        while (!over && next < reqs.length) {
            const req = reqs[next++];
            const got = await houseShots(req, lang, deps);
            if (!over && (got.today || got.layers.length)) out.set(req.houseId, got);
        }
    };
    const all = Promise.all(Array.from({ length: Math.max(1, Math.min(opts.limit ?? 2, reqs.length)) }, worker));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const late = new Promise<void>(resolve => { timer = setTimeout(() => { over = true; resolve(); }, opts.totalMs ?? 30_000); });
    try { await Promise.race([all, late]); } finally { if (timer !== null) clearTimeout(timer); }
    return new Map(out);
}
