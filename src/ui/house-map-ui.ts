/**
 * The map of the house page in the window (spec 030 §4, K7.2): draws the
 * frame src/house-map.ts left in the page (`.hmap-wrap[data-hmap]`) — the
 * tiles of the chosen layer, the point, the zoom, the layer switch — and
 * Move the point (dragged by mouse, touch or the arrow keys; Save / Cancel).
 *
 * The page is drawn anew whenever the tree or the research changes; the
 * map's state (zoom, layer, a point being moved) is kept here per house, so
 * a redraw in the middle of a move keeps the move.
 */

import { strings } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { pointInViewport, project, tilesForViewport, tileUrl, unproject } from '../map.js';
import {
    HOUSE_MAP_MAX_ZOOM, HOUSE_MAP_MIN_ZOOM, HOUSE_MAP_TOWN_ZOOM, HOUSE_MAP_ZOOM,
    houseImageScale, houseImageUrl, houseMapAttributionHtml, wmsTileUrl, type HouseMapPoint, type HouseMapView,
} from '../house-map.js';
import { loadMapTile, releaseMapTile } from './map-tiles.js';

interface HouseMapData {
    point: HouseMapPoint;
    own: boolean;
    label: string;
    views: HouseMapView[];
}

interface HouseMapState {
    houseId: string;
    zoom: number;
    view: string;
    /** The point being moved (Move the point), null: not moving. */
    moving: HouseMapPoint | null;
}

export interface HouseMapHooks {
    houseId: string;
    /** Save of a moved point: the person's point of the house. */
    onSave: (point: HouseMapPoint) => void;
    /** Confirm location: the research's point is right. */
    onConfirm: () => void;
    /** Draw the page anew (Cancel of a move: the line under the map as it was). */
    redraw: () => void;
}

let state: HouseMapState | null = null;
/** A house whose page opens with its point being moved ("Move the point" of the Map tab's house bubble). */
let pendingMove: string | null = null;

/** Forget the map's state (the page closed; a move asked for a page not yet open stays). */
export function resetHouseMapState(): void {
    if (state) pendingMove = null;
    state = null;
}

/** The next page of this house opens with its point being moved (the Map tab's "Move the point"). */
export function requestHouseMapMove(houseId: string): void {
    pendingMove = houseId;
}

/** The state of the map now (tests, the page). */
export function houseMapState(): Readonly<HouseMapState> | null {
    return state;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const geo = (p: HouseMapPoint) => ({ lat: p.lat, lon: p.lng });

function readData(wrap: HTMLElement): HouseMapData | null {
    try {
        const d = JSON.parse(wrap.dataset.hmap ?? '') as HouseMapData;
        return d && d.point && Array.isArray(d.views) ? d : null;
    } catch {
        return null;
    }
}

/** Draw the map of the page under `root` (no map there: nothing). */
export function mountHouseMap(root: ParentNode, hooks: HouseMapHooks): void {
    const wrap = root.querySelector<HTMLElement>('.hmap-wrap[data-hmap]');
    const data = wrap ? readData(wrap) : null;
    if (!wrap || !data) return;
    if (state?.houseId !== hooks.houseId) {
        state = { houseId: hooks.houseId, zoom: data.own ? HOUSE_MAP_ZOOM : HOUSE_MAP_TOWN_ZOOM, view: 'today', moving: null };
    }
    if (!data.views.some(v => v.id === state!.view)) state.view = 'today';
    const s = state;
    const startMove = pendingMove === hooks.houseId;
    pendingMove = null;
    if (startMove) {
        s.moving = { ...data.point };
        s.view = 'today';
    }
    const frame = wrap.querySelector<HTMLElement>('.hmap')!;
    const tiles = frame.querySelector<HTMLElement>('.hmap-tiles')!;
    const pin = frame.querySelector<HTMLElement>('.hpt')!;

    const size = (): { w: number; h: number } => ({ w: frame.clientWidth || 680, h: frame.clientHeight || 280 });
    const view = (): HouseMapView => data.views.find(v => v.id === s.view) ?? data.views[0];
    const shown = (): HouseMapPoint => s.moving ?? data.point;

    const drawTiles = (): void => {
        for (const img of tiles.querySelectorAll('img')) releaseMapTile(img as HTMLImageElement);
        tiles.innerHTML = '';
        frame.querySelector('.hmap-notice')?.remove();
        const v = view();
        const { w, h } = size();
        if (v.kind === 'today' && !SettingsManager.isMapTilesAcknowledged()) {
            // The first map of the app: the same sentence as the Map tab before anything is fetched.
            const notice = document.createElement('div');
            notice.className = 'hmap-notice';
            notice.innerHTML = `<p>${esc(strings.map.tilesNotice)}</p><button type="button" class="hp-mini hmap-notice-ok">${esc(strings.map.tilesNoticeOk)}</button>`;
            notice.querySelector('button')!.addEventListener('click', () => {
                SettingsManager.setMapTilesAcknowledged();
                drawTiles();
            });
            frame.appendChild(notice);
            return;
        }
        if (v.kind === 'image' && v.layer) {
            // A picture of the place in the layer's own system (S-JTSK), the house in the middle.
            const m = houseImageScale(s.zoom);
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const k = Math.min(1, 2048 / Math.max(w * dpr, h * dpr));
            const url = houseImageUrl(v.layer, data.point, w * m, h * m, w * dpr * k, h * dpr * k);
            if (!url) return;
            const img = document.createElement('img');
            img.className = 'hmap-img';
            img.alt = strings.houses.page.map.aerialAlt;
            img.decoding = 'async';
            img.referrerPolicy = 'strict-origin-when-cross-origin';
            img.src = url;
            tiles.appendChild(img);
            return;
        }
        const minZoom = v.layer?.minZoom ?? HOUSE_MAP_MIN_ZOOM;
        if (s.zoom < minZoom) s.zoom = Math.min(HOUSE_MAP_MAX_ZOOM, minZoom);
        for (const t of tilesForViewport(geo(data.point), s.zoom, w, h)) {
            const img = document.createElement('img');
            img.alt = '';
            img.decoding = 'async';
            img.style.left = `${Math.round(t.left)}px`;
            img.style.top = `${Math.round(t.top)}px`;
            tiles.appendChild(img);
            if (v.kind === 'today') loadMapTile(img, tileUrl(t));
            else if (v.layer) {
                img.referrerPolicy = 'strict-origin-when-cross-origin';
                img.src = wmsTileUrl(v.layer, t);
            }
        }
    };

    const placePin = (): void => {
        const { w, h } = size();
        const p = pointInViewport(geo(shown()), geo(data.point), s.zoom, w, h);
        pin.style.left = `${Math.round(p.x)}px`;
        pin.style.top = `${Math.round(p.y)}px`;
    };

    const drawChrome = (): void => {
        const v = view();
        for (const b of wrap.querySelectorAll<HTMLElement>('[data-hmap-view]')) b.setAttribute('aria-checked', String(b.dataset.hmapView === v.id));
        const attr = frame.querySelector<HTMLElement>('.hmap-attr');
        if (attr) attr.innerHTML = houseMapAttributionHtml(v);
        const zin = frame.querySelector<HTMLButtonElement>('.hmap-zin');
        const zout = frame.querySelector<HTMLButtonElement>('.hmap-zout');
        if (zin) zin.disabled = s.zoom >= HOUSE_MAP_MAX_ZOOM;
        if (zout) zout.disabled = s.zoom <= Math.max(HOUSE_MAP_MIN_ZOOM, v.layer?.minZoom ?? 0);
        const moving = !!s.moving;
        pin.classList.toggle('drag', moving);
        if (moving) {
            pin.tabIndex = 0;
            pin.setAttribute('role', 'button');
            pin.setAttribute('aria-roledescription', strings.houses.page.map.move);
            if (!data.own) {
                pin.classList.remove('town');
                pin.classList.add('main');
                pin.textContent = data.label;
            }
        }
        const pos = wrap.querySelector<HTMLElement>('.hmap-pos');
        if (pos && moving && !pos.querySelector('.hmap-move-hint')) {
            const M = strings.houses.page.map;
            pos.innerHTML = `<span class="hmap-move-hint">${esc(M.moveHint)}</span><span class="hmap-acts">`
                + `<button type="button" class="hmap-act" data-hmap-act="save">${esc(strings.buttons.save)}</button>`
                + `<button type="button" class="hmap-act" data-hmap-act="cancel">${esc(strings.buttons.cancel)}</button></span>`;
        }
    };

    const draw = (): void => {
        drawTiles();
        placePin();
        drawChrome();
    };

    // The point's place in the frame → a point on the ground.
    const toGround = (x: number, y: number): HouseMapPoint => {
        const { w, h } = size();
        const c = project(geo(data.point), s.zoom);
        const g = unproject({ x: c.x - w / 2 + x, y: c.y - h / 2 + y }, s.zoom);
        return { lat: Math.round(g.lat * 1e6) / 1e6, lng: Math.round(g.lon * 1e6) / 1e6 };
    };
    const pinXY = (): { x: number; y: number } => ({ x: parseFloat(pin.style.left) || 0, y: parseFloat(pin.style.top) || 0 });
    const moveTo = (x: number, y: number): void => {
        const { w, h } = size();
        s.moving = toGround(Math.min(w, Math.max(0, x)), Math.min(h, Math.max(0, y)));
        placePin();
    };

    wrap.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const layer = t.closest<HTMLElement>('[data-hmap-view]');
        if (layer) {
            s.view = layer.dataset.hmapView ?? 'today';
            draw();
            return;
        }
        if (t.closest('.hmap-zin') || t.closest('.hmap-zout')) {
            s.zoom = Math.min(HOUSE_MAP_MAX_ZOOM, Math.max(HOUSE_MAP_MIN_ZOOM, s.zoom + (t.closest('.hmap-zin') ? 1 : -1)));
            draw();
            return;
        }
        const act = t.closest<HTMLElement>('[data-hmap-act]')?.dataset.hmapAct;
        if (act === 'move') {
            s.moving = { ...data.point };
            // A picture of the place cannot place a point: today's map for the move.
            if (view().kind === 'image') s.view = 'today';
            draw();
            pin.focus({ preventScroll: true });
        } else if (act === 'save' && s.moving) {
            const p = s.moving;
            s.moving = null;
            hooks.onSave(p);
        } else if (act === 'cancel') {
            s.moving = null;
            hooks.redraw();
        } else if (act === 'confirm') {
            hooks.onConfirm();
        }
    });

    // Dragging the point: mouse and touch alike (pointer events), only while moving.
    let drag: { id: number; dx: number; dy: number } | null = null;
    pin.addEventListener('pointerdown', (e) => {
        if (!s.moving) return;
        e.preventDefault();
        const r = frame.getBoundingClientRect();
        const at = pinXY();
        drag = { id: e.pointerId, dx: e.clientX - r.left - at.x, dy: e.clientY - r.top - at.y };
        pin.setPointerCapture?.(e.pointerId);
        pin.classList.add('dragging');
    });
    pin.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const r = frame.getBoundingClientRect();
        moveTo(e.clientX - r.left - drag.dx, e.clientY - r.top - drag.dy);
    });
    const end = (e: PointerEvent): void => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        pin.classList.remove('dragging');
    };
    pin.addEventListener('pointerup', end);
    pin.addEventListener('pointercancel', end);
    pin.addEventListener('keydown', (e) => {
        if (!s.moving) return;
        const step = e.shiftKey ? 16 : 4;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        const at = pinXY();
        moveTo(at.x + d[0], at.y + d[1]);
    });

    draw();
    if (startMove) {
        wrap.scrollIntoView?.({ block: 'center' });
        pin.focus({ preventScroll: true });
    }
}
