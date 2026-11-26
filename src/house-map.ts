/**
 * The map of a house (spec 030 §4, K7.2): the section "Map" of the house page.
 *
 * Pure: `houseMapHtml` returns the section's body for the window (`app`:
 * the frame src/ui/house-map-ui.ts draws the tiles into) and for the saved
 * file (`file`: no map server at all, only the location in words and links
 * to open by hand). The layers are today's map (the app's own tiles) and
 * the research's layers (`/status.houses.layers`, §4.5) the house refers to
 * (`maps[].layer`) or whose frame holds its point; no other map server is
 * named in the app. A layer the research draws in one system only (`crs`)
 * goes into its own picture of the place when the app can convert into that
 * system, else it is left out.
 */

import type { HouseUserData } from './types.js';
import type { HouseResearch } from './house-bridge.js';
import type { LiveHouseLayer } from './research-link.js';
import type { TreeHouse } from './houses.js';
import { getStringsForLang, type Language } from './strings.js';
import { safeHttpUrl } from './validation.js';
import { TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL, TILE_SIZE, type TileRef } from './map.js';

/** The zoom a house is shown at (a street: the house and its neighbours). */
export const HOUSE_MAP_ZOOM = 17;
/** The zoom of a town when the house has no point of its own. */
export const HOUSE_MAP_TOWN_ZOOM = 14;
export const HOUSE_MAP_MIN_ZOOM = 12;
export const HOUSE_MAP_MAX_ZOOM = 19;

export type HouseMapViewKind = 'today' | 'tiles' | 'image';

/** One choice of the layer switch: today's map, a research's layer as tiles, or as a picture of the place. */
export interface HouseMapView {
    /** 'today' or the layer's id. */
    id: string;
    kind: HouseMapViewKind;
    label: string;
    layer?: LiveHouseLayer;
}

export interface HouseMapPoint { lat: number; lng: number }

/** What the map section gets (src/house-page.ts `mapHtml`). */
export interface HouseMapInput {
    mode: 'app' | 'file';
    lang: Language;
    house: TreeHouse;
    research: HouseResearch | null;
    /** The point the page may show: the app's always (a person's first), the file's only under K3.3; null none. */
    location: HouseMapPoint | null;
    layers: readonly LiveHouseLayer[];
    /** The town's point in the tree (shown when the house has none); the app only. */
    town?: HouseMapPoint | null;
    /** A person's word on the point (HouseUserData.location.how). */
    how?: NonNullable<HouseUserData['location']>['how'];
    /** The tree can be changed: Confirm location, Move the point. */
    canEdit?: boolean;
    /** The tree has a research that knows houses (the sentence of a map without its layers). */
    hasResearch?: boolean;
}

/** The systems a layer drawn in one system only can be shown in (its own picture of the place). */
export const HOUSE_MAP_IMAGE_CRS: readonly string[] = [];

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "čp. 16" → "16", "Kopřivná 12" stays: the point's label. */
export function housePointLabel(text: string): string {
    return text.replace(/^\s*(?:č\.\s*p\.|čp\.|cp\.|č\.\s*ev\.|ev\.\s*č\.)\s*/i, '').trim() || text;
}

/** Is the point inside a layer's frame ([west, south, east, north])? */
export function inLayerBox(layer: Pick<LiveHouseLayer, 'bbox'>, p: HouseMapPoint): boolean {
    const [w, s, e, n] = layer.bbox;
    return p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e;
}

/**
 * The layer switch (§4): today's map first, then the research's layers the
 * house refers to or whose frame holds its point; one in a system the app
 * cannot draw in (`crs` outside HOUSE_MAP_IMAGE_CRS) is left out. Tiles
 * before pictures of the place.
 */
export function houseMapViews(layers: readonly LiveHouseLayer[], research: HouseResearch | null, point: HouseMapPoint | null,
    lang: Language, imageCrs: readonly string[] = HOUSE_MAP_IMAGE_CRS): HouseMapView[] {
    const M = getStringsForLang(lang).houses.page.map;
    const named = new Set((research?.maps ?? []).map(m => m.layer).filter((id): id is string => !!id));
    const seen = new Set<string>();
    const tiles: HouseMapView[] = [];
    const images: HouseMapView[] = [];
    for (const l of layers) {
        if (seen.has(l.id) || !safeHttpUrl(l.url)) continue;
        if (!named.has(l.id) && !(point && inLayerBox(l, point))) continue;
        seen.add(l.id);
        const kind: HouseMapViewKind = l.crs ? 'image' : 'tiles';
        if (kind === 'image' && !imageCrs.includes(l.crs!)) continue;
        const label = l.kind === 'ortho' ? M.ortho : l.kind === 'ortho-1950' ? M.aerial : l.label;
        (kind === 'tiles' ? tiles : images).push({ id: l.id, kind, label, layer: l });
    }
    return [{ id: 'today', kind: 'today', label: M.today }, ...tiles, ...images];
}

/** "?" or "&" to add a query to a service's address. */
function querySep(url: string): string {
    if (!url.includes('?')) return '?';
    return url.endsWith('?') || url.endsWith('&') ? '' : '&';
}

/**
 * A WMS GetMap request of a layer: `bbox` = [minx, miny, maxx, maxy] in
 * `crs`'s units, easting before northing (EPSG:3857, EPSG:5514). Version
 * 1.3.0 names the system `CRS`, 1.1.1 `SRS`.
 */
export function wmsGetMapUrl(layer: Pick<LiveHouseLayer, 'url' | 'layers' | 'format'>, crs: string,
    bbox: readonly [number, number, number, number], width: number, height: number, version: '1.3.0' | '1.1.1' = '1.3.0'): string {
    const r = (n: number): string => (Math.round(n * 100) / 100).toString();
    return `${layer.url}${querySep(layer.url)}SERVICE=WMS&VERSION=${version}&REQUEST=GetMap`
        + `&LAYERS=${encodeURIComponent(layer.layers)}&STYLES=&FORMAT=${encodeURIComponent(layer.format ?? 'image/jpeg')}`
        + `&${version === '1.3.0' ? 'CRS' : 'SRS'}=${crs}&BBOX=${bbox.map(r).join(',')}`
        + `&WIDTH=${Math.round(width)}&HEIGHT=${Math.round(height)}`;
}

const MERC_HALF = Math.PI * 6378137;

/** A Web Mercator tile's frame in metres (EPSG:3857): [minx, miny, maxx, maxy]. */
export function tileBox3857(tile: Pick<TileRef, 'x' | 'y' | 'z'>): [number, number, number, number] {
    const size = (2 * MERC_HALF) / Math.pow(2, tile.z);
    const minx = -MERC_HALF + tile.x * size;
    const maxy = MERC_HALF - tile.y * size;
    return [minx, maxy - size, minx + size, maxy];
}

/** The tile of a research's layer (a WMS service that draws in Web Mercator). */
export function wmsTileUrl(layer: Pick<LiveHouseLayer, 'url' | 'layers' | 'format'>, tile: Pick<TileRef, 'x' | 'y' | 'z'>): string {
    return wmsGetMapUrl(layer, 'EPSG:3857', tileBox3857(tile), TILE_SIZE, TILE_SIZE);
}

/** What the map says under itself: its attribution with the licence, whole as the terms want it. */
export function houseMapAttribution(view: HouseMapView): { text: string; url?: string } {
    if (!view.layer) return { text: TILE_ATTRIBUTION, url: TILE_ATTRIBUTION_URL };
    const { attribution, license } = view.layer;
    return { text: attribution.includes(license) ? attribution : `${attribution} · ${license}` };
}

/** The attribution's HTML (inside `.hmap-attr`). */
export function houseMapAttributionHtml(view: HouseMapView): string {
    const a = houseMapAttribution(view);
    return a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.text)}</a>` : esc(a.text);
}

/** The line under the map: where the point comes from and how sure it is. */
export function housePositionText(input: Pick<HouseMapInput, 'lang' | 'location' | 'how' | 'research'>): string {
    const M = getStringsForLang(input.lang).houses.page.map;
    if (!input.location) return M.noPos;
    if (input.how === 'manual') return M.posManual;
    const loc = input.research?.location;
    if (input.how === 'confirmed' || loc?.confirmed) return M.posConfirmed;
    if (!loc) return M.posManual;
    if (loc.certainty === 'high') return loc.how === 'today-number' ? M.posHigh : M.posSure;
    return M.posUnsure;
}

/** Is the point the research's and not sure (Confirm location)? */
export function houseLocationUnsure(input: Pick<HouseMapInput, 'location' | 'how' | 'research'>): boolean {
    const loc = input.research?.location;
    return !!input.location && !input.how && !!loc && !loc.confirmed && loc.certainty !== 'high';
}

/** The maps to open by hand (`maps[].manual`): "Cadastral map, list 3 ↗". */
function manualMapsHtml(research: HouseResearch | null, lang: Language): string {
    const M = getStringsForLang(lang).houses.page.map;
    const kinds = M.kinds as Readonly<Record<string, string>>;
    const links = (research?.maps ?? []).flatMap(m => {
        const url = m.manual && m.url ? safeHttpUrl(m.url) : null;
        if (!url) return [];
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* safeHttpUrl checked it */ }
        const label = [kinds[m.kind] ?? host, m.sheet].filter(Boolean).join(', ');
        return [`<a class="hmap-man-a" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`];
    });
    return links.length ? `<span class="hmap-man"><span class="hmap-mu">${esc(M.manual)}</span>${links.join('')}</span>` : '';
}

/** "49.6118° N, 15.2251° E". */
function coordsText(p: HouseMapPoint): string {
    const f = (n: number): string => (Math.round(Math.abs(n) * 1e4) / 1e4).toFixed(4);
    return `${f(p.lat)}° ${p.lat >= 0 ? 'N' : 'S'}, ${f(p.lng)}° ${p.lng >= 0 ? 'E' : 'W'}`;
}

/**
 * The section's body: '' = no section. The app's frame (`.hmap`, drawn by
 * src/ui/house-map-ui.ts) carries the point, the town's point and the
 * layers as data; the file only the location in words with its links.
 */
export function houseMapHtml(input: HouseMapInput): string {
    const M = getStringsForLang(input.lang).houses.page.map;
    const manual = manualMapsHtml(input.research, input.lang);
    if (input.mode === 'file') {
        // No map server in the file: the location in words, links to open by hand (K3.3: only with the location).
        const p = input.location;
        if (!p) return '';
        const osm = `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(5)}&mlon=${p.lng.toFixed(5)}#map=18/${p.lat.toFixed(5)}/${p.lng.toFixed(5)}`;
        return `<div class="hmap-u hmap-u--file"><span class="hmap-pos"><span>${esc(housePositionText(input))}</span>`
            + `<span class="hmap-coords">${esc(coordsText(p))} · <a href="${esc(osm)}" target="_blank" rel="noopener noreferrer">OpenStreetMap ↗</a></span></span>`
            + `${manual}</div>`;
    }
    const point = input.location ?? input.town ?? null;
    if (!point) return '';
    const views = houseMapViews(input.layers, input.research, input.location, input.lang);
    const label = housePointLabel(input.house.text);
    const switcher = views.length > 1
        ? `<div class="sel-seg hmap-layers" role="radiogroup" aria-label="${esc(M.layers)}">`
            + views.map((v, i) => `<button type="button" class="sel-opt hmap-layer" data-sel-form="seg" role="radio" aria-checked="${i === 0}"`
                + ` data-hmap-view="${esc(v.id)}">${esc(v.label)}</button>`).join('') + '</div>'
        : input.hasResearch ? `<p class="hmap-note">${esc(M.onlyToday)}</p>` : '';
    const acts = input.canEdit ? [
        houseLocationUnsure(input) ? `<button type="button" class="hmap-act" data-hmap-act="confirm">${esc(M.confirmPos)}</button>` : '',
        `<button type="button" class="hmap-act" data-hmap-act="move">${esc(M.move)}</button>`,
    ].join('') : '';
    const data = {
        point, own: !!input.location, label,
        views: views.map(v => ({ id: v.id, kind: v.kind, label: v.label, ...(v.layer ? { layer: v.layer } : {}) })),
    };
    return `<div class="hmap-wrap" data-hmap="${esc(JSON.stringify(data))}">`
        + (switcher ? `<div class="hmap-top">${switcher}</div>` : '')
        + `<div class="hmap${input.location ? '' : ' hmap--town'}">`
        + '<div class="hmap-tiles" aria-hidden="true"></div>'
        + `<span class="hpt${input.location ? ' main' : ' town'}" role="img" aria-label="${esc(M.point(input.house.text))}" style="left:50%;top:50%">${esc(input.location ? label : '')}</span>`
        + `<span class="hmap-zoom"><button type="button" class="hmap-zin" aria-label="${esc(getStringsForLang(input.lang).map.zoomIn)}">+</button>`
        + `<button type="button" class="hmap-zout" aria-label="${esc(getStringsForLang(input.lang).map.zoomOut)}">−</button></span>`
        + `<span class="hmap-attr">${houseMapAttributionHtml(views[0])}</span>`
        + '</div>'
        + `<div class="hmap-u"><span class="hmap-pos"><span class="hmap-pos-t">${esc(housePositionText(input))}</span>`
        + (acts ? `<span class="hmap-acts">${acts}</span>` : '') + '</span>'
        + manual + '</div></div>';
}
