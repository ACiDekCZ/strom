/**
 * "Find on the map" in a row of the Places dialog (spec 034 §6): the name is
 * asked in every form expandPlaceQuery writes out (one request per form, the
 * geocoder's interval between them, only the name goes out), and what comes
 * back is offered as at most five results A–E — what and where each is, how
 * far from the tree's other places, the form that found it and the app's
 * check of it (§5, a warned result at the bottom with its reason). A small
 * map beside the results (on a phone behind "Show on the map") shows them
 * among the tree's places; a click on a point picks it.
 *
 * Nothing found: a town nearby (the place is then "located by the town"),
 * placing by hand, and the research's way (◆ Look up), or, in a tree without
 * a research, one sentence about what a research does.
 *
 * Placing by hand: a map with a fixed cross in the middle; it is dragged
 * (or moved with the arrow keys) under the cross and the cross is described
 * by the tree's nearest place.
 *
 * Every location written here says who put it there: a pick, a town nearby
 * and a cross are `hand`, the app's own fallback to a town is `map`.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import type { PlaceGeo } from '../types.js';
import { knownStreets, townOfPlace } from '../places.js';
import { geocodeTown, placesCentroid, searchPlaceForms } from '../geocode.js';
import { expandPlaceQuery } from '../place-query.js';
import {
    crossDescription, findResults, findResultTexts, findTreePoints, otherForms, stampedGeo,
    type FindResult, type FindTreePoint,
} from '../place-find.js';
import {
    fitBounds, panCenter, pointInViewport, tilesForViewport, tileUrl, MAX_ZOOM, MIN_ZOOM, TILE_ATTRIBUTION,
} from '../map.js';
import { SettingsManager } from '../settings.js';
import { managerKnownStreets, managerPlaceUsage, managerResearchActions } from './places-manager-ui.js';
import { uiModule } from './module.js';

/** The small map beside the results (CSS px; on a phone it takes the panel's width). */
const MINI_W = 210;
const MINI_H = 200;
/** The small map never zooms in further than this (one result alone is not a street plan). */
const MINI_MAX_ZOOM = 13;
/** One arrow key moves the map of Place by hand this far (px). */
const HAND_STEP = 48;
/** The map of Place by hand starts this close to the tree's places. */
const HAND_ZOOM = 11;

/** A small map's view and its tiles, kept per element so a redraw only moves them. */
interface SmallMapView { center: PlaceGeo; zoom: number }
const tileCache = new WeakMap<HTMLElement, Map<string, HTMLImageElement>>();

/** The tiles may be drawn: the map background was shown once (the same notice as the map's). */
function tilesAllowed(): boolean {
    return SettingsManager.isMapTilesAcknowledged();
}

/** The size of a small map as laid out, else its nominal size (not laid out yet). */
function mapSize(el: HTMLElement, w: number, h: number): { width: number; height: number } {
    return { width: el.clientWidth || w, height: el.clientHeight || h };
}

/** Draw a small map's tiles (only when the background may load), kept by identity across redraws. */
function drawTiles(layer: HTMLElement, view: SmallMapView, width: number, height: number): void {
    if (!tilesAllowed()) return;
    const live = tileCache.get(layer) ?? new Map<string, HTMLImageElement>();
    tileCache.set(layer, live);
    const seen = new Set<string>();
    for (const t of tilesForViewport(view.center, view.zoom, width, height)) {
        const key = `${t.z}/${t.wx}/${t.y}`;
        seen.add(key);
        let img = live.get(key);
        if (!img) {
            img = document.createElement('img');
            img.className = 'map-tile';
            img.alt = '';
            img.draggable = false;
            img.src = tileUrl(t);
            layer.appendChild(img);
            live.set(key, img);
        }
        img.style.left = `${t.left}px`;
        img.style.top = `${t.top}px`;
    }
    for (const [key, img] of live) {
        if (!seen.has(key)) { img.remove(); live.delete(key); }
    }
}

/** The tree's places as grey dots of a small map. */
function dotsHtml(tree: readonly FindTreePoint[], view: SmallMapView, width: number, height: number, esc: (s: string) => string): string {
    return tree.map(p => {
        const at = pointInViewport(p, view.center, view.zoom, width, height);
        if (at.x < -8 || at.y < -8 || at.x > width + 8 || at.y > height + 8) return '';
        return `<span class="place-mini-dot" style="left:${at.x.toFixed(1)}px;top:${at.y.toFixed(1)}px" title="${esc(p.name)}"></span>`;
    }).join('');
}

/** Today's date as a location is stamped with it. */
const DATE_NOW = (): Date => new Date();

/** The last search of a row, to come back to from Place by hand's Cancel. */
const lastFind = new WeakMap<HTMLElement, () => void>();

export const placesFindMethods = uiModule({
    /** The tree's located places other than `key`, named as the dialog names them. */
    placeFindTree(key: string): FindTreePoint[] {
        return findTreePoints(DataManager.getData(), key, k => managerPlaceUsage(k)?.display);
    },

    /**
     * Search under the name typed in every form the map may know it by and
     * offer the results. Nothing found and the name holds a house: the town
     * is looked up instead (the app's own fallback, as the automatic run does)
     * and its location attached "by the town".
     */
    async searchPlaceFromManager(key: string, query: string, row: HTMLElement): Promise<void> {
        const results = row.querySelector('.place-results') as HTMLElement;
        const text = query.trim();
        if (!text || this.placeSearchBusy) return;
        // The typed name goes out too, so the same consent rule applies.
        if (!await this.confirmGeocoding(1)) return;

        const data = DataManager.getData();
        const lang = getCurrentLanguage();
        // The history of places knows other names of it (the research's name, `also`): asked too.
        const hist = this.placesHistoryAliases([key]).get(key);
        const also = hist ? [hist[0]!, ...hist.slice(2)] : [];
        const forms = expandPlaceQuery(text, lang, data, also);
        results.innerHTML = `<span class="place-hint">${this.escapeHtml(strings.map.searching)}</span>`;
        this.placeSearchBusy = true;
        let found: Awaited<ReturnType<typeof searchPlaceForms>> = [];
        let byTown: PlaceGeo | null = null;
        try {
            found = await searchPlaceForms(forms);
            if (found.length === 0) {
                const parsed = townOfPlace(text, knownStreets(data));
                if (parsed) byTown = await geocodeTown(parsed.town, { centroid: placesCentroid(data.places) });
            }
        } finally {
            this.placeSearchBusy = false;
        }
        if (!row.isConnected) return;   // the dialog was redrawn meanwhile
        if (byTown?.byTown) {
            this.attachPlaceByTown(key, stampedGeo(byTown, 'map', { now: DATE_NOW() }), byTown.byTown);
            return;
        }
        const tree = this.placeFindTree(key);
        const also2 = otherForms(forms, text);
        if (found.length === 0) {
            const show = (): void => this.renderPlaceFindEmpty(key, text, also2, row);
            lastFind.set(row, show);
            show();
            return;
        }
        const list = findResults({ found, query: text, key, data: DataManager.getData(), tree });
        const show = (): void => this.renderPlaceFindResults(key, list, also2, tree, row);
        lastFind.set(row, show);
        show();
    },

    /** The results A–E, the small map and "None fits?". */
    renderPlaceFindResults(key: string, list: readonly FindResult[], also: readonly string[], tree: readonly FindTreePoint[], row: HTMLElement): void {
        const results = row.querySelector('.place-results') as HTMLElement;
        const d = strings.places.dialog;
        const lang = getCurrentLanguage();
        const esc = (s: string): string => this.escapeHtml(s);
        const tried = also.length
            ? `<div class="place-tried"><span class="place-tried-label">${esc(d.tried)}</span>${also.map(f => `<span class="place-tried-chip">${esc(f)}</span>`).join('')}</div>`
            : '';
        const rows = list.map((r, i) => {
            const t = findResultTexts(r, lang);
            const tone = r.warnings.length ? 'warn' : r.near ? 'near' : 'plain';
            return `
                <button type="button" class="place-candidate place-result" data-index="${i}" data-tone="${tone}">
                    <span class="place-result-letter" aria-hidden="true">${r.letter}</span>
                    <span class="place-result-text">
                        <strong>${esc(r.name)}</strong>
                        ${t.sub ? `<span class="place-candidate-sub">${esc(t.sub)}</span>` : ''}
                        ${t.distance || r.near || t.foundAs ? `<span class="place-result-km">${[
                            t.distance ? `<span>${esc(t.distance)}</span>` : '',
                            r.near && !r.warnings.length ? `<span class="place-result-near">⌖ ${esc(d.near)}</span>` : '',
                            t.foundAs ? `<em class="place-result-as">${esc(t.foundAs)}</em>` : '',
                        ].join('')}</span>` : ''}
                        ${t.warning ? `<span class="place-result-warn">! ${esc(t.warning)}</span>` : ''}
                    </span>
                </button>`;
        }).join('');
        results.innerHTML = `
            <div class="place-found">
                ${tried}
                <button type="button" class="link place-mini-toggle" aria-expanded="false">⌖ ${esc(d.showOnMap)}</button>
                <div class="place-found-body">
                    <div class="place-found-list">${rows}</div>
                    <div class="place-mini" role="group" aria-label="${esc(d.miniLabel)}">
                        <div class="place-mini-map"><div class="place-mini-tiles"></div><div class="place-mini-marks"></div></div>
                        <span class="place-mini-legend"><span class="place-mini-dot is-legend" aria-hidden="true"></span>${esc(d.miniLegend)}</span>
                    </div>
                </div>
                <button type="button" class="link place-none-fits">${esc(d.noneFits)}</button>
            </div>`;
        results.querySelectorAll<HTMLButtonElement>('.place-result').forEach(btn => {
            btn.onclick = () => this.pickPlaceResult(key, list[Number(btn.dataset.index)]!);
        });
        const found = results.querySelector('.place-found') as HTMLElement;
        const mini = results.querySelector('.place-mini-map') as HTMLElement;
        const toggle = results.querySelector('.place-mini-toggle') as HTMLButtonElement;
        toggle.onclick = () => {
            const open = !found.classList.contains('is-map-open');
            found.classList.toggle('is-map-open', open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.textContent = `⌖ ${open ? d.hideMap : d.showOnMap}`;
            if (open) this.drawPlaceMini(mini, key, list, tree);
        };
        (results.querySelector('.place-none-fits') as HTMLButtonElement).onclick = () => this.openPlaceByHand(key, row);
        this.drawPlaceMini(mini, key, list, tree);
    },

    /** The small map: the tree's places grey, the results lettered (near: primary, warned: ochre); a click picks. */
    drawPlaceMini(el: HTMLElement, key: string, list: readonly FindResult[], tree: readonly FindTreePoint[]): void {
        const { width, height } = mapSize(el, MINI_W, MINI_H);
        const points = [...list.map(r => r.candidate.geo), ...tree];
        const fit = fitBounds(points, width, height, 22);
        const view: SmallMapView = { center: fit.center, zoom: Math.min(fit.zoom, MINI_MAX_ZOOM) };
        drawTiles(el.querySelector('.place-mini-tiles') as HTMLElement, view, width, height);
        const esc = (s: string): string => this.escapeHtml(s);
        const pins = list.map((r, i) => {
            const at = pointInViewport(r.candidate.geo, view.center, view.zoom, width, height);
            const tone = r.warnings.length ? 'warn' : r.near ? 'near' : 'plain';
            return `<button type="button" class="place-mini-pin" data-index="${i}" data-tone="${tone}" style="left:${at.x.toFixed(1)}px;top:${at.y.toFixed(1)}px" title="${esc(r.name)}" aria-label="${esc(`${r.letter}: ${r.name}`)}">${r.letter}</button>`;
        }).join('');
        const marks = el.querySelector('.place-mini-marks') as HTMLElement;
        marks.innerHTML = dotsHtml(tree, view, width, height, esc) + pins;
        marks.querySelectorAll<HTMLButtonElement>('.place-mini-pin').forEach(b => {
            b.onclick = () => this.pickPlaceResult(key, list[Number(b.dataset.index)]!);
        });
    },

    /**
     * A result picked: its location, put there by hand. A town for a place
     * with a house stands "by the town". A result the check warned about was
     * picked knowingly: its warning is answered (no Check mark).
     */
    pickPlaceResult(key: string, r: FindResult): void {
        const c = r.candidate;
        const geo = stampedGeo(c.geo, 'hand', { keep: r.warnings.length > 0, now: DATE_NOW() });
        const usage = managerPlaceUsage(key);
        const parsed = c.settlement && usage ? townOfPlace(usage.display, managerKnownStreets()) : null;
        if (parsed) {
            this.attachPlaceByTown(key, { ...geo, byTown: parsed.town }, parsed.town);
            return;
        }
        // An exact point: no longer "by the town".
        DataManager.setPlaceGeos(new Map([[key, geo]]));
        this.showToast(strings.map.matched(c.geo.label ?? r.name));
        this.refreshPlacesManager();
    },

    /** Nothing found: what was asked, a town nearby, placing by hand and the research's way. */
    renderPlaceFindEmpty(key: string, query: string, also: readonly string[], row: HTMLElement): void {
        const results = row.querySelector('.place-results') as HTMLElement;
        const d = strings.places.dialog;
        const esc = (s: string): string => this.escapeHtml(s);
        const researchId = this.placesResearchContext().researchId;
        let research = '';
        if (managerResearchActions()) {
            research = `
                <div class="place-empty-research">
                    <button type="button" class="place-empty-look">◆ ${esc(strings.places.research.look)}</button>
                    <p class="place-card-note">${esc(d.twoWays)}</p>
                </div>`;
        } else if (!researchId) {
            // A tree without a research: its one mention (§10).
            research = `
                <p class="place-empty-research place-card-note">${esc(d.resLine)}
                    <button type="button" class="link place-empty-more">${esc(d.resMore)} ›</button></p>`;
        }
        results.innerHTML = `
            <div class="place-empty">
                <p class="place-empty-head">${esc(d.emptyHead(query, [...also]))}</p>
                <div class="place-near">
                    <label class="place-field-label">${esc(d.nearTown)}
                        <span class="place-search-row">
                            <input type="text" class="place-near-town" placeholder="${esc(d.nearTownPh)}" autocomplete="off" spellcheck="false">
                            <button type="button" class="place-near-go">${esc(strings.map.search)}</button>
                        </span>
                    </label>
                    <p class="place-card-note place-near-note">${esc(d.nearNote)}</p>
                </div>
                <div class="place-card-buttons"><button type="button" class="secondary place-pin-open">✛ ${esc(d.pinBtn)}</button></div>
                ${research}
            </div>`;
        const input = results.querySelector('.place-near-town') as HTMLInputElement;
        const run = (): void => { void this.attachNearTown(key, input.value, row); };
        (results.querySelector('.place-near-go') as HTMLButtonElement).onclick = run;
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
        (results.querySelector('.place-pin-open') as HTMLButtonElement).onclick = () => this.openPlaceByHand(key, row);
        const look = results.querySelector<HTMLButtonElement>('.place-empty-look');
        if (look) look.onclick = () => void this.queuePlaces([key], false);
        const more = results.querySelector<HTMLButtonElement>('.place-empty-more');
        if (more) more.onclick = () => { this.closePlacesManager(); this.showResearchInfoDialog(); };
    },

    /** "A town nearby": the town's location, attached by the town, by hand. */
    async attachNearTown(key: string, town: string, row: HTMLElement): Promise<void> {
        const name = town.trim();
        if (!name || this.placeSearchBusy) return;
        if (!await this.confirmGeocoding(1)) return;
        const note = row.querySelector('.place-near-note') as HTMLElement | null;
        if (note) note.textContent = strings.map.searching;
        this.placeSearchBusy = true;
        let geo: PlaceGeo | null = null;
        try {
            geo = await geocodeTown(name, { centroid: placesCentroid(DataManager.getData().places) });
        } finally {
            this.placeSearchBusy = false;
        }
        if (!row.isConnected) return;
        if (!geo) {
            if (note) {
                note.textContent = strings.places.dialog.nearNone(name);
                note.dataset.tone = 'warn';
            }
            return;
        }
        const by = geo.byTown ?? name;
        this.attachPlaceByTown(key, stampedGeo({ ...geo, byTown: by }, 'hand', { now: DATE_NOW() }), by);
    },

    /**
     * Place by hand: a map in the panel with a cross in the middle; the map
     * moves under it (drag, arrow keys, + / −), the tree's places guide, and
     * the cross is described by the nearest one.
     */
    openPlaceByHand(key: string, row: HTMLElement): void {
        const results = row.querySelector('.place-results') as HTMLElement;
        const d = strings.places.dialog;
        const lang = getCurrentLanguage();
        const esc = (s: string): string => this.escapeHtml(s);
        const tree = this.placeFindTree(key);
        const data = DataManager.getData();
        const own = data.places?.[key];
        const centroid = placesCentroid(data.places);
        let view: SmallMapView = own ? { center: { lat: own.lat, lon: own.lon }, zoom: HAND_ZOOM }
            : centroid ? { center: { lat: centroid.lat, lon: centroid.lon }, zoom: HAND_ZOOM }
                : { center: { lat: 30, lon: 0 }, zoom: MIN_ZOOM };
        results.innerHTML = `
            <div class="place-hand">
                <p class="place-card-head">${esc(d.pinHead)}</p>
                <div class="place-hand-map" tabindex="0" role="application" aria-label="${esc(d.pinMapLabel)}">
                    <div class="place-mini-tiles"></div>
                    <div class="place-mini-marks"></div>
                    <span class="place-hand-cross" aria-hidden="true"></span>
                    <span class="place-hand-zoom">
                        <button type="button" class="place-hand-in" aria-label="${esc(d.zoomIn)}" title="${esc(d.zoomIn)}">+</button>
                        <button type="button" class="place-hand-out" aria-label="${esc(d.zoomOut)}" title="${esc(d.zoomOut)}">−</button>
                    </span>
                    ${tilesAllowed() ? `<span class="place-hand-attr">${esc(TILE_ATTRIBUTION)}</span>` : ''}
                </div>
                <p class="place-hand-at" aria-live="polite"></p>
                <div class="place-card-buttons">
                    <button type="button" class="primary place-hand-here">${esc(d.pinHere)}</button>
                    <button type="button" class="secondary place-hand-cancel">${esc(strings.buttons.cancel)}</button>
                </div>
                <p class="place-card-note">${esc(d.pinBig)}</p>
            </div>`;
        const map = results.querySelector('.place-hand-map') as HTMLElement;
        const tiles = map.querySelector('.place-mini-tiles') as HTMLElement;
        const marks = map.querySelector('.place-mini-marks') as HTMLElement;
        const at = results.querySelector('.place-hand-at') as HTMLElement;
        const draw = (): void => {
            const { width, height } = mapSize(map, 300, 240);
            drawTiles(tiles, view, width, height);
            marks.innerHTML = dotsHtml(tree, view, width, height, esc);
            at.textContent = crossDescription(view.center, tree, lang);
        };
        const pan = (dx: number, dy: number): void => {
            view = { ...view, center: panCenter(view.center, view.zoom, dx, dy) };
            draw();
        };
        const zoom = (step: number): void => {
            view = { ...view, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom + step)) };
            draw();
        };
        (map.querySelector('.place-hand-in') as HTMLButtonElement).onclick = () => zoom(1);
        (map.querySelector('.place-hand-out') as HTMLButtonElement).onclick = () => zoom(-1);
        map.onkeydown = (e) => {
            const step: Record<string, [number, number]> = {
                ArrowLeft: [HAND_STEP, 0], ArrowRight: [-HAND_STEP, 0], ArrowUp: [0, HAND_STEP], ArrowDown: [0, -HAND_STEP],
            };
            const move = step[e.key];
            if (move) { e.preventDefault(); pan(move[0], move[1]); return; }
            if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1); }
            else if (e.key === '-') { e.preventDefault(); zoom(-1); }
        };
        let drag: { id: number; x: number; y: number } | null = null;
        map.onpointerdown = (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
            map.setPointerCapture(e.pointerId);
            map.classList.add('is-dragging');
        };
        map.onpointermove = (e) => {
            if (!drag || drag.id !== e.pointerId) return;
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            drag = { ...drag, x: e.clientX, y: e.clientY };
            pan(dx, dy);
        };
        const end = (e: PointerEvent): void => {
            if (!drag || drag.id !== e.pointerId) return;
            drag = null;
            map.classList.remove('is-dragging');
        };
        map.onpointerup = end;
        map.onpointercancel = end;
        (results.querySelector('.place-hand-here') as HTMLButtonElement).onclick = () => {
            const geo = stampedGeo({ lat: view.center.lat, lon: view.center.lon }, 'hand', { now: DATE_NOW() });
            DataManager.setPlaceGeos(new Map([[key, geo]]));
            this.showToast(d.pinned(managerPlaceUsage(key)?.display ?? ''));
            this.refreshPlacesManager();
        };
        (results.querySelector('.place-hand-cancel') as HTMLButtonElement).onclick = () => {
            const back = lastFind.get(row);
            if (back) back();
            else results.innerHTML = '';
        };
        draw();
        map.focus({ preventScroll: true });
    },
});
