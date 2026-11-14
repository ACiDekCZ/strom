/**
 * Map view (A6): the family's places plotted on a real map.
 *
 * Two things are deliberately separated here:
 *   - COORDINATES are data. They are looked up once, with the user's explicit
 *     consent, and stored in their own tree file — after that the map knows
 *     where everything is even with no internet.
 *   - TILES (the map picture itself) cannot fit in a single HTML file, so they
 *     are loaded from OpenStreetMap while the map is open. Without internet the
 *     view says so instead of pretending.
 *
 * The maths lives in src/map.ts, the network call in src/geocode.ts; this
 * module is the DOM and the flow. See src/ui/module.ts for the composition
 * pattern.
 */

import { stampedGeo } from '../place-find.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { placeOriginBadge, type PlaceIdentity } from '../place-identity.js';
import { checkFindingText, placeFormerLine, placeLocationLabel } from '../places-dialog.js';
import { mapBarState, mapBubbleResearch, type MapBarAction } from '../place-actions.js';
import { researchBridgeAgentLabel } from './research-open-mark.js';
import { placeGeoHash } from '../place-records.js';
import { PersonId, PlaceGeo } from '../types.js';
import {
    collectPlaces, placeKey, PlaceUsage, MapKind, MAP_KINDS, isMapKind, groupTownPoints, knownStreets, MapPoint, TownPoint,
    mapPointHasPerson, mapPointRowCount, soloPersons, type PlaceShare,
} from '../places.js';
import { sharedNames } from '../shared-with-line.js';
import { lifeEventLabel } from '../person-sources.js';
import { getWindowRole } from '../windows/window-role.js';
import { PERSON_CHOSEN_EVENT } from '../windows/window-selection.js';
import { KIND_MARK, houseMatches, kindMarks } from '../map-bubble.js';
import { MQ_MOBILE, MQ_PHONE_BAR } from '../breakpoints.js';
import { collectDatedPlacePoints, DatedPlaceHarvest, datedRowCount } from '../map-time.js';
import { yearOf } from '../dates.js';
import { pickMapLabels, type LabelBox } from '../map-labels.js';
import { mapSpellingPlaces } from '../place-groups.js';
import {
    fitBounds, panCenter, pinchZoomStep, pointInViewport, tileUrl, tilesForViewport, zoomAround,
    TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL,
} from '../map.js';
import { GEOCODER_NAME, geocodePlaces, placesCentroid } from '../geocode.js';
import { uiModule } from './module.js';
import { loadMapTile, mapTilesBlocked, onMapTilesChange, releaseMapTile } from './map-tiles.js';

import { iconSvg } from '../icons.js';
import { shownName } from '../person-name.js';
/** A place that has coordinates and therefore something to draw. */
export interface MappedPlace {
    key: string;
    usage: PlaceUsage;
    geo: PlaceGeo;
}

/** Which people the map covers. */
export type MapScope = 'view' | 'tree';

/** Recomputes --map-floor for the current map canvas (see watchMapFloor). */
let mapFloorUpdate: (() => void) | null = null;

/** The map point whose bubble is open (a place key or 'town:…'), null when closed. */
let openPoint: string | null = null;
/** The open town bubble's house search, and the houses (houseKey, NO_HOUSE) shown with all their people. */
let townQuery = '';
let townExpanded = new Set<string>();
/** openPoint of a bubble of the research's work alone (no map point of its own). */
const WORK_BUBBLE = '\u0001work:';
/** The "no house number" group in townExpanded. */
const NO_HOUSE = '\u0000';
/** Above this many houses a town bubble gets its search and shortens each house's people. */
const TOWN_BIG = 30;
/** The phone's menu of kinds is open. */
let kindsMenuOpen = false;
let kindTipTimer: number | null = null;
/** Escape and the click outside the menu of kinds are listened to once, for every map canvas. */
let mapKeysBound = false;
/** The document-wide space bar (play/pause on the map) is bound once. */
let mapTimeKeysBound = false;

/** The one-time offer of Migration over time was spent on this device (spec 054 §4). */
const TIME_TIP_KEY = 'strom.map.timeTipSeen';
function mapTimeTipSeen(): boolean {
    try { return localStorage.getItem(TIME_TIP_KEY) === '1'; } catch { return true; }
}
/** Spent once: written only the first time (a satellite window that turns the mode on stores nothing). */
function markMapTimeTipSeen(): void {
    try { if (localStorage.getItem(TIME_TIP_KEY) !== '1') localStorage.setItem(TIME_TIP_KEY, '1'); } catch { /* no storage: the offer goes with the page */ }
}
/** The map listens once for the tile server's refusal (its note), for every map canvas. */
let mapTilesBound = false;

/** Per tree: the places the map's own lookup asked for and did not find (this page's life). */
const geocodeMissed = new Map<string, Set<string>>();
/** How old the research's places may be when the map opens before it reads them again. */
const LIVE_MAX_AGE_MS = 15000;

/** The first sentence of a text (the bubble's one line of "Why here"). */
function firstSentence(text: string): string {
    const m = /^.*?[.!?](?=\s|$)/s.exec(text.trim());
    return (m ? m[0] : text).trim();
}

/** A drawn map point: a place or a town with its houses. */
interface MapMarkerInfo {
    key: string;
    geo: PlaceGeo;
    display: string;
    /** Houses of a town point (the "⌂ N" tag), 0 for a place. */
    houses: number;
}


/**
 * Nearby points: hide the names that would cover another name or another
 * point's dot (kept by people, most first). A hidden name stays in the
 * marker's accessible name and shows on hover or focus. Phones show no names.
 */
export function declutterMapLabels(layer: HTMLElement): void {
    if (window.matchMedia(MQ_MOBILE).matches) return;
    const markers = Array.from(layer.querySelectorAll<HTMLElement>('.map-marker'));
    if (markers.length < 2) return;
    const box = (el: Element | null): LabelBox => {
        const r = el?.getBoundingClientRect();
        return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : { left: 0, top: 0, right: 0, bottom: 0 };
    };
    const candidates = markers.map(m => ({
        label: box(m.querySelector('.map-marker-label')),
        own: Array.from(m.querySelectorAll('.map-marker-dot, .map-marker-check, .map-marker-houses')).map(box),
        weight: Number(m.querySelector('.map-marker-dot')?.textContent) || 0,
    }));
    const keep = pickMapLabels(candidates);
    markers.forEach((m, i) => m.querySelector('.map-marker-label')?.classList.toggle('is-crowded', !keep[i]));
}

export const mapMethods = uiModule({
    /**
     * Places the map should show: everything with coordinates, for the chosen
     * scope. 'view' = the people currently on screen (what the user is looking
     * at), 'tree' = everybody.
     */
    mapPlaces(): MappedPlace[] {
        const data = DataManager.getData();
        const filter: ReadonlySet<PersonId> | undefined =
            this.mapEffectiveScope() === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();

        const mapped: MappedPlace[] = [];
        // A shared event is one row of a bubble, counted once (spec 085 §2f).
        const places = collectPlaces(data, filter, this.mapKinds(), DataManager.getSharedEventIndex());
        for (const p of this.mapSpellings(places).places) {
            if (p.geo) mapped.push({ key: p.key, usage: p.usage, geo: p.geo });
        }
        return mapped.sort((a, b) => b.usage.count - a.usage.count || a.usage.display.localeCompare(b.usage.display));
    },

    /** Places in scope that have no coordinates yet — the geocoding to-do list. */
    mapMissingPlaces(): { key: string; usage: PlaceUsage }[] {
        const data = DataManager.getData();
        const filter: ReadonlySet<PersonId> | undefined =
            this.mapEffectiveScope() === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();
        return this.mapSpellings(collectPlaces(data, filter, this.mapKinds())).places
            .filter(p => !p.geo)
            .map(({ key, usage }) => ({ key, usage }))
            .sort((a, b) => b.usage.count - a.usage.count);
    },

    /**
     * The places in scope with each place's spellings as one (§4, a research
     * record or the other names written down by Unify): one point, one entry
     * of the missing. `keyOf` maps a joined spelling to its point.
     */
    mapSpellings(places: ReadonlyMap<string, PlaceUsage>): { places: { key: string; usage: PlaceUsage; geo?: PlaceGeo }[]; keyOf: Map<string, string> } {
        const data = DataManager.getData();
        const entries = [...places].map(([key, usage]) => ({ key, usage, geo: data.places?.[key] }));
        return mapSpellingPlaces(data, entries, knownStreets(data));
    },

    /** The map point a place is drawn as: a spelling of a place joined to it (§4), else the place itself. */
    mapPointKeyOf(key: string): string {
        return this.mapSpellings(collectPlaces(DataManager.getData())).keyOf.get(key) ?? key;
    },

    /** The kinds of places the map shows (chips above it), kept on this device. */
    mapKinds(): ReadonlySet<MapKind> {
        return new Set(SettingsManager.getMapKinds());
    },

    /** The map's points: the places, the houses of a town found by the town grouped into one point. */
    mapPoints(places?: MappedPlace[]): MapPoint[] {
        return groupTownPoints(places ?? this.mapPlaces(), knownStreets(DataManager.getData()));
    },

    /** Draw the whole view. Called by the renderer whenever the map is on. */
    renderMapView(container: HTMLElement): void {
        if (!container.querySelector('.map-canvas')) {
            container.innerHTML = `
                <div class="map-canvas">
                    <div class="map-tiles"></div>
                    <svg class="map-lines" aria-hidden="true"></svg>
                    <div class="map-markers"></div>
                    <div class="map-popup" style="display:none;"></div>
                </div>
                <div class="map-controls">
                    <button type="button" class="map-zoom-in" onclick="window.Strom.UI.zoomMap(1)"
                            aria-label="${strings.map.zoomIn}" title="${strings.map.zoomIn}">+</button>
                    <button type="button" class="map-zoom-out" onclick="window.Strom.UI.zoomMap(-1)"
                            aria-label="${strings.map.zoomOut}" title="${strings.map.zoomOut}">−</button>
                    <button type="button" class="map-fit" onclick="window.Strom.UI.fitMapToPlaces(true)"
                            aria-label="${strings.map.fit}" title="${strings.map.fit}">⤢</button>
                    <button type="button" class="map-time-toggle sel-opt" onclick="window.Strom.UI.toggleMapTime()"
                            aria-pressed="false" aria-label="${strings.map.timeMode}" title="${strings.map.timeMode}"><span class="map-time-toggle-icon" aria-hidden="true">${iconSvg('timer')}</span><span class="map-time-toggle-text" aria-hidden="true">${strings.map.timeModeShort}</span></button>
                </div>
                <div class="map-topleft">
                    <div class="map-scope sel-seg">
                        <button type="button" id="map-scope-view" class="sel-opt" data-sel-form="seg" onclick="window.Strom.UI.setMapScope('view')">${strings.map.scopeView}</button>
                        <button type="button" id="map-scope-tree" class="sel-opt" data-sel-form="seg" onclick="window.Strom.UI.setMapScope('tree')">${strings.map.scopeTree}</button>
                    </div>
                    <div class="map-path-chip" hidden>
                        <button type="button" class="map-path-chip-open" title="${strings.map.pathChange}" aria-haspopup="dialog" aria-expanded="false"
                                onclick="window.Strom.UI.openMapPathPicker('chip')"><span class="map-path-chip-mark" aria-hidden="true">◎</span><span class="map-path-chip-pre">${strings.map.pathChip}</span><strong class="map-path-chip-name"></strong><span class="map-path-chip-caret" aria-hidden="true">▾</span></button>
                        <button type="button" class="map-path-chip-clear" aria-label="${strings.map.pathClear}" title="${strings.map.pathClear}"
                                onclick="window.Strom.UI.clearMapPath()">×</button>
                    </div>
                    ${this.mapKindsHtml()}
                </div>
                <div class="map-timebar" id="map-timebar" hidden>
                    <button type="button" class="map-time-play" aria-label="${strings.map.timePlay}" title="${strings.map.timePlay}">${iconSvg('play')}</button>
                    <div class="map-time-track">
                        <div class="map-time-slider">
                            <div class="map-timebar-marks" hidden></div>
                            <input type="range" class="map-time-range" aria-label="${strings.map.timeYear}" value="0" min="0" max="0">
                        </div>
                        <div class="map-time-caption" aria-live="polite" hidden></div>
                    </div>
                    <span class="map-time-year">0</span>
                    <button type="button" class="map-path-btn" aria-label="${strings.map.pathPick}" title="${strings.map.pathPick}" aria-haspopup="dialog" aria-expanded="false"
                            onclick="window.Strom.UI.openMapPathPicker('bar')"><span class="map-path-btn-mark" aria-hidden="true">◎</span><span class="map-path-btn-text">${strings.map.pathPick}</span></button>
                </div>
                <div class="map-status" id="map-status"></div>
                <a class="map-attribution" href="${TILE_ATTRIBUTION_URL}" target="_blank" rel="noopener noreferrer">${TILE_ATTRIBUTION}</a>`;
            this.mapTileEls = new Map();  // fresh canvas: the old <img> refs are detached
            this.bindMapGestures(container);
            this.bindMapClicks(container);
            this.bindMapTime(container);
            this.bindMapKinds(container);
            this.watchMapFloor(container);
        }
        this.renderMapKinds();

        document.getElementById('map-scope-view')?.classList.toggle('active', this.mapScope !== 'tree');
        document.getElementById('map-scope-tree')?.classList.toggle('active', this.mapScope === 'tree');

        // First open: the background tiles come from openstreetmap.org, and the
        // tile requests themselves reveal which area the family lived in. In an
        // app that promises "family data stays local", that is worth one
        // sentence before anything is fetched.
        if (!SettingsManager.isMapTilesAcknowledged()) {
            this.renderMapTilesNotice(container);
            return;
        }
        container.querySelector('.map-tiles-notice')?.remove();

        const places = this.mapPlaces();
        // First open (or a scope with nothing framed yet): frame what we have.
        if (!this.mapCenter && places.length > 0) this.fitMapToPlaces();
        if (!this.mapCenter) this.mapCenter = { lat: 50, lon: 15 };

        this.renderMapTimeControls();
        this.drawMapTiles(container);
        this.drawMapMarkers(container, places);
        this.renderMapStatus(places);
        this.renderMapTimeTip();
        // Following the research: where it works now and its trail, over the markers.
        this.applyMapFollowMarks();
        // The states the research knows (check marks, to confirm) come with its places.
        void this.refreshPlacesLive(LIVE_MAX_AGE_MS);
    },

    /** The research's places changed: the open map redraws its marks, bar and bubble. */
    refreshMapPlaceStates(): void {
        if (document.querySelector('#map-container .map-canvas')) this.refreshMapContent();
    },

    /** The bar's actions after the map's own lookup. */
    mapBarAction(action: MapBarAction): void {
        if (action === 'geocode') { void this.startGeocoding(); return; }
        if (action === 'confirm') { this.openWaitingPlaces(); return; }
        if (action === 'research') {
            // Where its steps do not go here (another computer, a phone, an older research): say where they go.
            const note = this.placesResearchNote(this.placesResearchContext().access);
            if (note) { this.showToast(note, 8000); return; }
        }
        this.showPlacesManager(undefined, undefined, undefined, { unplaced: action === 'research' });
        if (action === 'research' && document.getElementById('places-modal')) this.openPlacesBulk('look');
    },

    /**
     * Toasts and offers sit bottom-centre, where the map keeps its status bar
     * and time bar: publish how far up those reach (--map-floor) so the notes
     * rise above them instead of covering "Look up" and "Places".
     */
    watchMapFloor(container: HTMLElement): void {
        if (typeof ResizeObserver === 'undefined') return;
        const bars = ['.map-status', '.map-timebar']
            .map(sel => container.querySelector(sel))
            .filter((el): el is HTMLElement => el !== null);
        const update = () => {
            let floor = 0;
            for (const el of bars) {
                const r = el.getBoundingClientRect();
                if (r.height > 0) floor = Math.max(floor, window.innerHeight - r.top);
            }
            document.documentElement.style.setProperty('--map-floor', `${Math.round(floor)}px`);
            // The time bar stands above the status bar, whose height grows when
            // its sentence wraps (a phone, the family path note): publish how
            // far up the status bar reaches inside the map.
            const status = bars[0]?.matches('.map-status') ? bars[0] : null;
            const sr = status?.getBoundingClientRect();
            const reach = sr && sr.height > 0 ? container.getBoundingClientRect().bottom - sr.top : 0;
            container.style.setProperty('--map-status-reach', `${Math.round(reach)}px`);
            // The top left ends before the column of controls (its timer carries a word).
            const controls = container.querySelector<HTMLElement>('.map-controls');
            if (controls && controls.offsetWidth > 0) container.style.setProperty('--map-controls-w', `${controls.offsetWidth}px`);
            // The legend of the path's lines reaches down to the time bar.
            this.positionMapLinesLegend();
            this.positionMapTimeTip();
        };
        const ro = new ResizeObserver(update);
        bars.forEach(el => ro.observe(el));
        const controlsEl = container.querySelector('.map-controls');
        if (controlsEl) ro.observe(controlsEl);
        // The canvas can be rebuilt: one window listener, pointing at the latest.
        if (!mapFloorUpdate) {
            window.addEventListener('resize', () => mapFloorUpdate?.());
            // The phone's research strip moves the status bar without resizing it.
            window.addEventListener('strom:live-strip', () => mapFloorUpdate?.());
        }
        mapFloorUpdate = update;
    },

    // ==================== KINDS OF PLACES (chips above the map) ====================

    /**
     * The kinds switch: four chips under the scope (computer, tablet), one
     * button with a menu on a phone and a phone held sideways — CSS shows one
     * of them. Built once with the canvas; renderMapKinds keeps its state.
     */
    mapKindsHtml(): string {
        const m = strings.map;
        const chips = MAP_KINDS.map(k => `
            <button type="button" class="map-kind" data-kind="${k}" aria-pressed="true">
                <span class="map-kind-check" aria-hidden="true">✓</span>
                <span class="map-kind-mark" aria-hidden="true">${KIND_MARK[k]}</span>
                <span class="map-kind-label">${this.escapeHtml(m.kinds[k])}</span>
            </button>`).join('');
        const rows = MAP_KINDS.map(k => `
            <button type="button" class="map-kinds-row" role="checkbox" data-kind="${k}" aria-checked="true">
                <span class="map-kinds-box" aria-hidden="true">✓</span>
                <span class="map-kind-mark" aria-hidden="true">${KIND_MARK[k]}</span>
                <span class="map-kinds-text">
                    <span class="map-kinds-name">${this.escapeHtml(m.kinds[k])}</span>
                    <span class="map-kinds-hint">${this.escapeHtml(m.kindHint[k])}</span>
                </span>
            </button>`).join('');
        return `
            <div class="map-kinds" role="group" aria-label="${this.escapeHtml(m.kindsAria)}">${chips}</div>
            <div class="map-kinds-wrap">
                <button type="button" class="map-kinds-btn" aria-expanded="false" aria-haspopup="true">
                    <span class="map-kinds-btn-marks" aria-hidden="true"></span>
                    <span class="map-kinds-btn-label"></span>
                    <span class="map-kinds-btn-caret" aria-hidden="true">▾</span>
                </button>
                <div class="map-kinds-menu" role="group" aria-label="${this.escapeHtml(m.kindsAria)}" hidden>
                    ${rows}
                    <p class="map-kinds-last" hidden>${this.escapeHtml(m.kindsLastOn)}</p>
                </div>
            </div>`;
    },

    /** Push the kinds switched on onto the chips, the phone's button and its menu. */
    renderMapKinds(): void {
        const root = document.querySelector('#map-container .map-topleft');
        if (!root) return;
        const m = strings.map;
        const on = this.mapKinds();
        const all = on.size === MAP_KINDS.length;
        root.querySelectorAll<HTMLElement>('.map-kind, .map-kinds-row').forEach(el => {
            const kind = el.dataset.kind;
            if (!isMapKind(kind)) return;
            const pressed = on.has(kind);
            const locked = pressed && on.size === 1;
            const chip = el.classList.contains('map-kind');
            el.setAttribute(chip ? 'aria-pressed' : 'aria-checked', String(pressed));
            if (locked) el.setAttribute('aria-disabled', 'true');
            else el.removeAttribute('aria-disabled');
            // The menu says it in its own line (no hover on touch).
            if (chip) el.title = locked ? `${m.kindHint[kind]}. ${m.kindsLastOn}` : m.kindHint[kind];
        });
        const btn = root.querySelector('.map-kinds-btn') as HTMLElement | null;
        if (btn) {
            btn.classList.toggle('filtered', !all);
            btn.setAttribute('aria-expanded', String(kindsMenuOpen));
            const marks = btn.querySelector('.map-kinds-btn-marks') as HTMLElement;
            marks.textContent = all ? '' : kindMarks(on);
            (btn.querySelector('.map-kinds-btn-label') as HTMLElement).textContent =
                all ? m.kindsAll : m.kindsSome(on.size, MAP_KINDS.length);
        }
        const menu = root.querySelector('.map-kinds-menu') as HTMLElement | null;
        if (menu) {
            menu.hidden = !kindsMenuOpen;
            (menu.querySelector('.map-kinds-last') as HTMLElement).hidden = on.size !== 1;
        }
    },

    /** Clicks on the chips, the phone's button and its rows. */
    bindMapKinds(container: HTMLElement): void {
        const root = container.querySelector('.map-topleft') as HTMLElement | null;
        root?.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.closest('.map-kinds-btn')) { this.toggleMapKindsMenu(); return; }
            const kind = (target.closest('.map-kind, .map-kinds-row') as HTMLElement | null)?.dataset.kind;
            if (isMapKind(kind)) this.toggleMapKind(kind);
        });
        if (mapKeysBound) return;
        mapKeysBound = true;
        // Outside the menu (and its button), a press closes it.
        document.addEventListener('pointerdown', (e: PointerEvent) => {
            if (!kindsMenuOpen) return;
            if ((e.target as Element | null)?.closest?.('.map-kinds-wrap')) return;
            this.toggleMapKindsMenu(false);
        }, true);
        // Escape closes the menu of kinds first, then the open bubble.
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            const map = document.getElementById('map-container');
            if (!map || map.getClientRects().length === 0) return;
            if (document.querySelector('.modal-overlay.active')) return;
            if (this.mapPathPickerOpen()) {
                e.preventDefault();
                this.closeMapPathPicker(true);
                return;
            }
            if (this.mapLinesUndatedOpen()) {
                e.preventDefault();
                this.closeMapLinesUndated(true);
                return;
            }
            if (this.mapLinesSheetOpen()) {
                e.preventDefault();
                this.closeMapLinesSheet(true);
                return;
            }
            if (kindsMenuOpen) {
                e.preventDefault();
                this.toggleMapKindsMenu(false);
                (map.querySelector('.map-kinds-btn') as HTMLElement | null)?.focus();
                return;
            }
            if (openPoint) {
                e.preventDefault();
                this.closeMapPopup();
                return;
            }
            // Then a pinned line of the ancestors' path lets go.
            if (this.mapLineFocus !== null && this.mapPathOn()) {
                e.preventDefault();
                this.mapLineFocus = null;
                this.refreshMapPath();
            }
        });
    },

    /** Open or close the phone's menu of kinds; open, it never reaches over the bars at the bottom. */
    toggleMapKindsMenu(open: boolean = !kindsMenuOpen): void {
        kindsMenuOpen = open;
        this.renderMapKinds();
        const container = document.getElementById('map-container');
        const menu = container?.querySelector('.map-kinds-menu') as HTMLElement | null;
        if (!container || !menu || !open) return;
        menu.style.maxHeight = '';
        // As far down as the time bar or the status bar, whichever reaches higher.
        let floor = container.getBoundingClientRect().bottom;
        for (const sel of ['.map-status', '.map-timebar']) {
            const r = (container.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect();
            if (r && r.height > 0) floor = Math.min(floor, r.top);
        }
        const room = Math.floor(floor - menu.getBoundingClientRect().top - 8);
        if (room > 0 && menu.scrollHeight > room) menu.style.maxHeight = `${Math.max(room, 96)}px`;
    },

    /** Switch one kind on or off; the last one on stays (its chip says why). */
    toggleMapKind(kind: MapKind): void {
        const on = new Set(this.mapKinds());
        if (on.has(kind)) {
            if (on.size === 1) { this.showMapKindTip(kind); return; }
            on.delete(kind);
        } else {
            on.add(kind);
        }
        SettingsManager.setMapKinds([...on]);
        townExpanded = new Set();
        this.refreshMapContent();
    },

    /**
     * A click on the last chip on: its hint and why it stays, under the chip
     * for a moment — a tablet has no hover for the title.
     */
    showMapKindTip(kind: MapKind): void {
        const group = document.querySelector('#map-container .map-kinds') as HTMLElement | null;
        const chip = group?.querySelector(`.map-kind[data-kind="${kind}"]`) as HTMLElement | null;
        if (!group || !chip || chip.getClientRects().length === 0) return;
        group.querySelector('.map-kind-tip')?.remove();
        const tip = document.createElement('div');
        tip.className = 'map-kind-tip';
        tip.setAttribute('role', 'status');
        tip.innerHTML = `<span>${this.escapeHtml(strings.map.kindHint[kind])}</span>`
            + `<span class="map-kind-tip-why">${this.escapeHtml(strings.map.kindsLastOn)}</span>`;
        tip.style.left = `${chip.offsetLeft}px`;
        group.appendChild(tip);
        if (kindTipTimer !== null) clearTimeout(kindTipTimer);
        kindTipTimer = window.setTimeout(() => { tip.remove(); kindTipTimer = null; }, 3500);
    },

    /** Redraw what the kinds decide: the points, the bar, the time range and an open bubble. */
    refreshMapContent(): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        this.renderMapKinds();
        if (!SettingsManager.isMapTilesAcknowledged()) return;
        const places = this.mapPlaces();
        this.renderMapTimeControls();
        this.drawMapMarkers(container, places);
        this.renderMapStatus(places);
        if (!openPoint) return;
        const key = openPoint;
        const still = this.mapPoints(places).some(p => p.key === key);
        if (still) this.showMapPlace(key, { pan: false });
        else this.closeMapPopup();
    },

    /**
     * The bar along the bottom: what is on the map, what is missing, and the
     * one button that offers to look the missing places up.
     */
    renderMapStatus(places: MappedPlace[]): void {
        const box = document.getElementById('map-status');
        if (!box) return;

        if (this.mapGeocoding) {
            const { done, total, place } = this.mapGeocoding;
            box.innerHTML = `
                <span class="map-status-text">${strings.map.geocodingProgress(done, total, this.escapeHtml(place))}</span>
                <button type="button" class="secondary" onclick="window.Strom.UI.cancelGeocoding()">${strings.buttons.cancel}</button>`;
            box.style.display = 'flex';
            return;
        }

        // Tiles need the network. Say so plainly rather than showing a blank
        // canvas and letting the user wonder what broke. Markers and the
        // Places manager work on stored coordinates, so they stay available.
        if (!navigator.onLine) {
            box.innerHTML = `
                <span class="map-status-text">${strings.map.offline}</span>
                <button type="button" class="secondary" onclick="window.Strom.UI.showPlacesManager()">${strings.map.managePlaces}</button>`;
            box.style.display = 'flex';
            return;
        }

        // In time mode the family path is drawn from the births: without them
        // the bar says why the lines are gone, so it does not look broken.
        const pathOn = this.mapPathOn();
        const pathNote = this.mapTimeOn && !pathOn && !this.mapKinds().has('birth') ? ` ${strings.map.noFamilyPath}` : '';

        // In time mode, own up to places that carry no date and so cannot appear
        // on the timeline — honesty instead of a silently emptier map.
        // With the ancestors' path the ones off the timeline are the legend's (its foot).
        if (this.mapTimeOn && !pathOn) {
            const undated = this.mapTimeHarvest().undatedPlaceCount;
            if (undated > 0) {
                box.innerHTML = `
                    <span class="map-status-text">${strings.map.timeUndated(undated)}${pathNote}</span>
                    <button type="button" class="secondary" onclick="window.Strom.UI.showPlacesManager()">${strings.map.managePlaces}</button>`;
                box.style.display = 'flex';
                return;
            }
        }

        const missing = this.mapMissingPlaces();
        if (places.length === 0 && missing.length === 0) {
            // With kinds off, the places may all be of those kinds: say that, not "no places".
            const text = this.mapKinds().size < MAP_KINDS.length ? strings.map.noPlacesOfKinds : strings.map.noPlaces;
            box.innerHTML = `<span class="map-status-text">${text}</span>`;
            box.style.display = 'flex';
            return;
        }

        // The Places button stays even when everything is placed: a pin can be
        // in the wrong country, and that needs a way back. After the map's own
        // lookup the places it did not find go on to the research (§7).
        const treeId = DataManager.getCurrentTreeId();
        const missed = (treeId && geocodeMissed.get(treeId)) || new Set<string>();
        const research = this.placesResearchContext();
        const input = {
            shown: places.length, missing: missing.length, missingTried: missing.filter(p => missed.has(p.key)).length,
            access: research.access, confirm: 0, look: 0,
        };
        // With a research: what it could look up (as Places' preview: no location or not identified,
        // nothing queued twice, spec 058); "N to confirm" counts only after the lookup.
        if (input.missing > 0 && research.access !== 'none') {
            const after = input.missingTried >= input.missing;
            const ids = this.placeIdentitiesNow([...(after ? places.map(p => p.key) : []), ...missing.map(p => p.key)]);
            input.look = missing.filter(p => { const st = ids.get(p.key)?.state; return st === 'none' || st === 'undet'; }).length;
            if (after) input.confirm = [...ids.values()].filter(id => id.state === 'confirm').length;
        }
        const bar = mapBarState(input);
        const confirm = input.confirm;
        const actions = bar.actions;
        const om = strings.places.onMap;
        const text = bar.after ? om.notFound(places.length, missing.length)
            : missing.length > 0 ? strings.map.missing(places.length, missing.length) : strings.map.allPlaced(places.length);
        const button = (a: MapBarAction): string => {
            const go = `onclick="window.Strom.UI.mapBarAction('${a}')"`;
            switch (a) {
                case 'geocode': return `<button type="button" ${go}>${strings.map.lookUp(missing.length)}</button>`;
                // An agent's work asked through the bridge (queued, nothing runs yet): the AI badge alone.
                case 'research': return `<button type="button" class="map-status-research" ${go} title="${this.escapeHtml(om.lookResearchTitle)}">${researchBridgeAgentLabel(bar.after ? om.lookResearch(input.look) : om.lookResearchShort)}</button>`;
                case 'confirm': return `<button type="button" class="secondary map-status-confirm" ${go} title="${this.escapeHtml(om.confirmTitle)}"><span aria-hidden="true">?</span> ${this.escapeHtml(om.confirm(confirm))}</button>`;
                case 'places': return `<button type="button" class="secondary" ${go}>${strings.map.managePlaces}</button>`;
            }
        };
        box.innerHTML = `
            <span class="map-status-text">${this.escapeHtml(text)}${pathNote}</span>
            ${actions.map(button).join('')}`;
        box.classList.toggle('is-after', bar.after);
        box.style.display = 'flex';
    },

    drawMapTiles(container: HTMLElement): void {
        const layer = container.querySelector('.map-tiles') as HTMLElement | null;
        if (!layer || !this.mapCenter) return;
        const { width, height } = this.mapViewportSize(container);

        // Diffed, not rebuilt. Each tile <img> is keyed by its stable identity
        // (z/wx/y) and kept across draws: panning only re-positions the existing,
        // already-decoded images and adds/removes the few at the edges. Rebuilding
        // the whole layer instead flashed the background black for a frame while
        // even cached images re-decoded.
        const wanted = tilesForViewport(this.mapCenter, this.mapZoom, width, height);
        const live = this.mapTileEls;
        const seen = new Set<string>();
        for (const t of wanted) {
            const key = `${t.z}/${t.wx}/${t.y}`;
            seen.add(key);
            let img = live.get(key);
            if (!img) {
                img = document.createElement('img');
                img.className = 'map-tile';
                img.alt = '';
                img.draggable = false;
                loadMapTile(img, tileUrl(t));
                layer.appendChild(img);
                live.set(key, img);
            }
            img.style.left = `${t.left}px`;
            img.style.top = `${t.top}px`;
        }
        for (const [key, img] of live) {
            if (!seen.has(key)) {
                releaseMapTile(img);
                img.remove();
                live.delete(key);
            }
        }
        this.renderMapTilesBlocked(container);
        if (!mapTilesBound) {
            mapTilesBound = true;
            onMapTilesChange(() => {
                const open = document.getElementById('map-container');
                if (open?.querySelector('.map-canvas')) this.renderMapTilesBlocked(open);
            });
        }
    },

    /**
     * The tile server refused the background: one plain note on the map
     * instead of a grid of "Access blocked" pictures. The points, the bar and
     * the attribution stay; the note lets clicks through to the map.
     */
    renderMapTilesBlocked(container: HTMLElement): void {
        const note = container.querySelector('.map-tiles-blocked');
        if (!mapTilesBlocked()) { note?.remove(); return; }
        if (note) return;
        const el = document.createElement('div');
        el.className = 'map-tiles-blocked';
        el.setAttribute('role', 'status');
        el.textContent = strings.map.tilesBlocked;
        // Right above the tiles: the points, lines and bubble are drawn over it.
        container.querySelector('.map-tiles')?.after(el);
    },

    drawMapMarkers(container: HTMLElement, places: MappedPlace[]): void {
        const layer = container.querySelector('.map-markers') as HTMLElement | null;
        if (!layer || !this.mapCenter) return;

        // Time mode draws its own markers (cumulative, year-aware) plus the
        // migration lines; the ordinary marker set is ignored while it is on.
        if (this.mapTimeOn) {
            this.drawMapTimeLayer(container);
            this.positionMapFollow(container);
            return;
        }
        const lines = container.querySelector('.map-lines') as SVGElement | null;
        if (lines) lines.innerHTML = '';

        const { width, height } = this.mapViewportSize(container);

        const points = this.mapPoints(places);
        const ids = this.placeIdentitiesNow(points.map(p => this.mapMarkerInfo(p).key));
        const lang = getCurrentLanguage();
        layer.innerHTML = points.map(p => {
            const info = this.mapMarkerInfo(p);
            // The bubble's rows: a person per own facts, a shared event once (spec 085 §2f).
            const persons = mapPointRowCount(p);
            const id = ids.get(info.key);
            const check = id?.state === 'check' ? this.mapCheckReason(id, lang) : undefined;
            return this.mapMarkerHtml(info, persons, false, width, height, check);
        }).join('');
        this.markMapWindowSelected(layer, points);
        declutterMapLabels(layer);
        this.positionMapFollow(container);
    },

    /** The places of the person selected in another window (spec 079 §2): their markers bigger, ringed. */
    markMapWindowSelected(layer: HTMLElement, points: MapPoint[]): void {
        const id = TreeRenderer.getWindowSelected();
        const keys = new Set(id ? points.filter(p => mapPointHasPerson(p, id)).map(p => this.mapMarkerInfo(p).key) : []);
        layer.querySelectorAll<HTMLElement>('.map-marker[data-key]').forEach(m => {
            m.classList.toggle('map-marker-window-selected', keys.has(m.dataset.key ?? ''));
        });
    },

    /**
     * A person selected in another window, on the map: their places marked;
     * the map moves (its zoom kept) only when none of them is in view. Null:
     * the marks go.
     */
    revealMapPerson(personId: string | null): void {
        const container = document.getElementById('map-container');
        const layer = container?.querySelector<HTMLElement>('.map-markers');
        if (!container || !layer || !this.mapCenter || this.mapTimeOn) return;
        const points = this.mapPoints();
        this.markMapWindowSelected(layer, points);
        if (!personId) return;
        const own = points.filter(p => mapPointHasPerson(p, personId));
        if (own.length === 0) return;
        const { width, height } = this.mapViewportSize(container);
        const inView = own.some(p => {
            const at = pointInViewport(p.geo, this.mapCenter!, this.mapZoom, width, height);
            return at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height;
        });
        if (inView) return;
        this.mapCenter = fitBounds(own.map(p => p.geo), width, height).center;
        this.closeMapPopup();
        this.drawMapTiles(container);
        this.drawMapMarkers(container, this.mapPlaces());
    },

    /**
     * What a marker shows of a point: where, its name, its houses. A town that
     * is a place of its own keeps that place's key (the life timeline, links
     * and the Places dialog know it by it); only a group of house places is
     * 'town:…'.
     */
    mapMarkerInfo(p: MapPoint): MapMarkerInfo {
        return p.type === 'town'
            ? { key: p.ownKey ?? p.key, geo: p.geo, display: p.town, houses: p.houseCount }
            : { key: p.key, geo: p.geo, display: p.usage.display, houses: 0 };
    },

    /** Why a place has the Check mark, in one line. */
    mapCheckReason(id: PlaceIdentity, lang: ReturnType<typeof getCurrentLanguage>): string {
        const first = id.checks?.[0];
        return first ? checkFindingText(first, lang) : id.checkWhy ?? strings.places.state.check;
    },

    /**
     * One marker: the dot with its people, a town's "⌂ N" tag, the name under
     * it; `check`: the Check mark ("!" on the dot's top right) with its reason.
     */
    mapMarkerHtml(info: MapMarkerInfo, persons: number, fresh: boolean, width: number, height: number, check?: string): string {
        const at = pointInViewport(info.geo, this.mapCenter!, this.mapZoom, width, height);
        // Skip what is far off-screen; keeps big trees light while panning.
        if (at.x < -200 || at.y < -200 || at.x > width + 200 || at.y > height + 200) return '';
        return `
            <button type="button" class="map-marker${fresh ? ' map-marker-fresh' : ''}${info.houses > 0 ? ' map-marker-town' : ''}" data-key="${this.escapeHtml(info.key)}"
                    style="left:${Math.round(at.x)}px; top:${Math.round(at.y)}px;">
                <span class="map-marker-dot">${persons}</span>
                ${check !== undefined ? `<span class="map-marker-check" role="img" aria-label="${this.escapeHtml(strings.places.onMap.checkMark(check))}" title="${this.escapeHtml(strings.places.onMap.checkMark(check))}">!</span>` : ''}
                ${info.houses >= 2 ? `<span class="map-marker-houses"><span aria-hidden="true">⌂</span> ${info.houses}</span>` : ''}
                <span class="map-marker-label">${this.escapeHtml(info.display)}</span>
            </button>`;
    },

    // ==================== MIGRATION OVER TIME (P5) ====================

    /** The dated harvest for the map's current scope (view / whole tree). */
    mapTimeHarvest(): DatedPlaceHarvest {
        const data = DataManager.getData();
        const filter: ReadonlySet<PersonId> | undefined =
            this.mapEffectiveScope() === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();
        return collectDatedPlacePoints(data, filter, this.mapKinds(), DataManager.getSharedEventIndex());
    },

    /**
     * The dated points that actually have a pin, grouped per map point (a
     * town's houses in its one point) and joined to its coordinates and name.
     * Places with no coordinates are dropped (nothing to draw) — matching the
     * ordinary marker rule.
     */
    mapTimePlacesData(): (MapMarkerInfo & { points: { year: number; personId: PersonId; shareId?: string }[] })[] {
        const pointOf = new Map<string, MapMarkerInfo>();
        for (const p of this.mapPoints()) {
            const info = this.mapMarkerInfo(p);
            for (const key of p.type === 'town' ? p.placeKeys : [p.key]) pointOf.set(key, info);
        }
        const byKey = new Map<string, MapMarkerInfo & { points: { year: number; personId: PersonId; shareId?: string }[] }>();
        for (const pt of this.mapTimeHarvest().points) {
            const base = pointOf.get(pt.placeKey);
            if (!base) continue;
            let tp = byKey.get(base.key);
            if (!tp) {
                tp = { ...base, points: [] };
                byKey.set(base.key, tp);
            }
            tp.points.push({ year: pt.year, personId: pt.personId, ...(pt.shareId ? { shareId: pt.shareId } : {}) });
        }
        return [...byKey.values()];
    },

    /**
     * Parent→child birthplace segments for a given year: the family's route
     * across the land. Both birthplaces must have coordinates, both a parseable
     * year, and differ. Siblings tracing the same route collapse to one line
     * (keyed placeA→placeB) at the strongest opacity. Opacity fades with the
     * child's age at year Y: 1.0 fresh, down to 0.15 at 60+ years.
     */
    mapMigrationSegments(year: number): { from: PlaceGeo; to: PlaceGeo; opacity: number }[] {
        // The path runs between birthplaces: no births on the map, no path.
        if (!this.mapKinds().has('birth')) return [];
        const data = DataManager.getData();
        const places = data.places ?? {};
        const filter: ReadonlySet<PersonId> | undefined =
            this.mapEffectiveScope() === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();
        const kept = (id: PersonId): boolean => !filter || filter.has(id);

        const byKey = new Map<string, { from: PlaceGeo; to: PlaceGeo; opacity: number }>();
        for (const child of Object.values(data.persons)) {
            if (!kept(child.id)) continue;
            const cYear = yearOf(child.birthDate);
            const cRaw = child.birthPlace?.trim();
            if (cYear === null || cYear > year || !cRaw) continue;
            const cKey = placeKey(cRaw);
            const cGeo = places[cKey];
            if (!cGeo) continue;

            for (const pid of child.parentIds) {
                if (!kept(pid)) continue;
                const parent = data.persons[pid];
                const pRaw = parent?.birthPlace?.trim();
                if (!parent || !pRaw || yearOf(parent.birthDate) === null) continue;
                const pKey = placeKey(pRaw);
                if (pKey === cKey) continue;
                const pGeo = places[pKey];
                if (!pGeo) continue;

                const age = year - cYear;
                const opacity = Math.max(0.15, 1 - (Math.max(0, age) / 60) * 0.85);
                const segKey = `${pKey}->${cKey}`;
                const existing = byKey.get(segKey);
                if (!existing) byKey.set(segKey, { from: pGeo, to: cGeo, opacity });
                else existing.opacity = Math.max(existing.opacity, opacity);
            }
        }
        return [...byKey.values()];
    },

    /** Draw both the cumulative markers and the migration lines for the year. */
    drawMapTimeLayer(container: HTMLElement): void {
        const markers = container.querySelector('.map-markers') as HTMLElement | null;
        const lines = container.querySelector('.map-lines') as SVGElement | null;
        if (!markers || !this.mapCenter) return;
        // A chosen person: the ancestors' path in the colours of their lines.
        if (this.mapPathOn()) { this.drawMapPathLayer(container); return; }
        const { width, height } = this.mapViewportSize(container);
        const year = this.mapTimeYear;

        markers.innerHTML = this.mapTimePlacesData().map(tp => {
            const upto = tp.points.filter(p => p.year <= year);
            if (upto.length === 0) return '';
            // The bubble's rows so far: a shared event once (spec 085 §2f).
            const persons = datedRowCount(upto);
            // "Fresh" = something happened here within the last ten years (Y−10, Y].
            const fresh = upto.some(p => p.year > year - 10);
            return this.mapMarkerHtml(tp, persons, fresh, width, height);
        }).join('');
        declutterMapLabels(markers);

        if (!lines) return;
        const margin = 100;
        const inView = (p: { x: number; y: number }): boolean =>
            p.x >= -margin && p.y >= -margin && p.x <= width + margin && p.y <= height + margin;
        const drawable = this.mapMigrationSegments(year)
            .map(s => ({
                a: pointInViewport(s.from, this.mapCenter!, this.mapZoom, width, height),
                b: pointInViewport(s.to, this.mapCenter!, this.mapZoom, width, height),
                opacity: s.opacity,
            }))
            // Density guard: keep only lines with an endpoint near the viewport,
            // then a hard cap so a huge tree can never flood the SVG.
            .filter(s => inView(s.a) || inView(s.b))
            .sort((a, b) => b.opacity - a.opacity)
            .slice(0, 400);
        lines.innerHTML = drawable.map(s =>
            `<line x1="${Math.round(s.a.x)}" y1="${Math.round(s.a.y)}" x2="${Math.round(s.b.x)}" y2="${Math.round(s.b.y)}"`
            + ` stroke="var(--primary)" stroke-width="2" stroke-opacity="${s.opacity.toFixed(3)}" />`).join('');
    },

    /** Sync the toggle button, the timebar visibility and the slider bounds. */
    renderMapTimeControls(): void {
        const harvest = this.mapTimeHarvest();
        const hasData = harvest.minYear !== null && harvest.maxYear !== null;
        const toggle = document.querySelector('.map-time-toggle') as HTMLButtonElement | null;
        if (toggle) {
            // Nothing dated → the whole feature has nothing to show.
            if (!hasData && this.mapTimeOn) this.setMapTimeOn(false);
            toggle.disabled = !hasData;
            toggle.setAttribute('aria-pressed', String(this.mapTimeOn));
            toggle.classList.toggle('active', this.mapTimeOn);
            toggle.title = hasData ? strings.map.timeMode : strings.map.timeModeEmpty;
        }

        // The mode on (by its button, the offer, a path): the one-time offer is spent.
        if (this.mapTimeOn) this.dismissMapTimeTip(false);
        const bar = document.getElementById('map-timebar');
        if (bar) bar.hidden = !this.mapTimeOn;
        this.renderMapPathChip();
        this.renderMapLinesLegend();
        if (!this.mapTimeOn || !hasData) return;

        // With the ancestors' path: its range (yearFrom → yearTo); none when no ancestor is on the map.
        const pathOn = this.mapPathOn();
        const bounds = this.mapTimeBounds();
        const range = document.querySelector('.map-time-range') as HTMLInputElement | null;
        const play = document.querySelector('.map-time-play') as HTMLButtonElement | null;
        if (bounds) {
            // Keep the slider inside the (possibly re-scoped) range.
            this.mapTimeYear = Math.min(bounds.max, Math.max(bounds.min, this.mapTimeYear));
        }
        if (range) {
            range.min = String(bounds?.min ?? this.mapTimeYear);
            range.max = String(bounds?.max ?? this.mapTimeYear);
            range.value = String(this.mapTimeYear);
            range.disabled = !bounds;
        }
        if (play) {
            play.disabled = !bounds;
            play.setAttribute('aria-disabled', String(!bounds));
        }
        const pathBtn = document.querySelector('#map-container .map-path-btn') as HTMLElement | null;
        if (pathBtn) pathBtn.hidden = pathOn;
        bar?.classList.toggle('has-path', pathOn);
        this.updateMapTimeLabel();
        this.updateMapTimePlayIcon();
        this.renderMapTimeMarks();
        this.renderMapTimeCaption();
    },

    updateMapTimeLabel(): void {
        const label = document.querySelector('.map-time-year') as HTMLElement | null;
        if (label) label.textContent = String(this.mapTimeYear);
    },

    updateMapTimePlayIcon(): void {
        const play = document.querySelector('.map-time-play') as HTMLButtonElement | null;
        if (!play) return;
        const label = this.mapTimePlaying ? strings.map.timePause : strings.map.timePlay;
        // The word beside the icon on a desktop and a tablet; a phone keeps the icon alone (CSS).
        // Both words stand in one grid cell, the other one hidden, so the button keeps the width
        // of the longer one in every language and the slider does not move when it changes.
        const word = (text: string, on: boolean): string =>
            `<span class="map-time-play-word"${on ? '' : ' data-off'}>${this.escapeHtml(text)}</span>`;
        play.innerHTML = `${iconSvg(this.mapTimePlaying ? 'pause' : 'play')}<span class="map-time-play-text" aria-hidden="true">`
            + `${word(strings.map.timePlay, !this.mapTimePlaying)}${word(strings.map.timePause, this.mapTimePlaying)}</span>`;
        play.setAttribute('aria-label', label);
        play.title = label;
    },

    /** Bind the timebar controls once, when the canvas is first built. */
    bindMapTime(container: HTMLElement): void {
        const range = container.querySelector('.map-time-range') as HTMLInputElement | null;
        let queued = false;
        const redraw = (): void => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                this.drawMapMarkers(container, []);
            });
        };
        range?.addEventListener('input', () => {
            // Moving the slider pauses the playback at the chosen year.
            if (this.mapTimePlaying) this.stopMapTimePlay();
            this.mapTimeYear = Number(range.value);
            this.updateMapTimeLabel();
            this.renderMapTimeCaption();
            redraw();   // rAF-throttled, same as panning
        });
        // The slider's keys: arrows ±1 year, PageUp/PageDown ±10, Home/End the beginning and the end.
        range?.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const bounds = this.mapTimeBounds();
            if (!bounds || range.disabled) return;
            const y = this.mapTimeYear;
            const next: Record<string, number> = {
                ArrowRight: y + 1, ArrowUp: y + 1, ArrowLeft: y - 1, ArrowDown: y - 1,
                PageUp: y + 10, PageDown: y - 10, Home: bounds.min, End: bounds.max,
            };
            if (!(e.key in next)) return;
            e.preventDefault();
            this.setMapTimeYear(next[e.key]);
        });
        // A mark above the slider (a line's earliest ancestor, the target): pause and jump there.
        container.querySelector('.map-timebar-marks')?.addEventListener('click', (e: Event) => {
            const mark = (e.target as HTMLElement).closest('.map-timebar-mark') as HTMLElement | null;
            if (mark?.dataset.year) this.setMapTimeYear(Number(mark.dataset.year));
        });
        // The path's dead end: "Choose another person" opens the choice above the bar.
        container.querySelector('.map-time-caption')?.addEventListener('click', (e: Event) => {
            if ((e.target as HTMLElement).closest('.map-time-caption-other')) this.openMapPathPicker('bar');
        });
        const play = container.querySelector('.map-time-play') as HTMLButtonElement | null;
        play?.addEventListener('click', () => this.toggleMapTimePlay());
        if (mapTimeKeysBound) return;
        mapTimeKeysBound = true;
        // The space bar anywhere on the map (not in a field, not on a button of its own) plays or pauses.
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== ' ' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            const map = document.getElementById('map-container');
            if (!map || map.getClientRects().length === 0 || !this.mapTimeOn) return;
            if (document.querySelector('.modal-overlay.active') || this.mapPathPickerOpen()) return;
            const t = e.target as HTMLElement | null;
            const onPage = !t || t === document.body || t === document.documentElement || map.contains(t);
            if (!onPage) return;
            if (t && t !== document.body && t.closest('textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [role="button"], [role="checkbox"], input:not([type="range"])')) return;
            e.preventDefault();
            this.toggleMapTimePlay();
        });
    },

    /** Set the year by hand (a key on the slider, a mark): the playback pauses, the map shows that year. */
    setMapTimeYear(year: number): void {
        const bounds = this.mapTimeBounds();
        if (!this.mapTimeOn || !bounds) return;
        if (this.mapTimePlaying) this.stopMapTimePlay();
        this.mapTimeYear = Math.min(bounds.max, Math.max(bounds.min, Math.round(year)));
        this.syncMapTimeControls();
        this.renderMapTimeCaption();
        const container = document.getElementById('map-container');
        if (container) this.drawMapMarkers(container, []);
    },

    /**
     * The one-time offer of Migration over time (spec 054 §4): on the map,
     * while the mode was never on and the tree has two or more dated places
     * with a location; a card left of the timer (a phone: across the width
     * above the status bar), the timer ringed. "Try it" turns the mode on
     * (no person), "Not now" closes it; either way it never comes again.
     */
    renderMapTimeTip(): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        const toggle = container.querySelector<HTMLButtonElement>('.map-time-toggle');
        let tip = container.querySelector<HTMLElement>('.map-time-tip');
        const show = !!toggle && !toggle.disabled && !this.mapTimeOn && !mapTimeTipSeen()
            && SettingsManager.isMapTilesAcknowledged() && this.mapTimePlacesData().length >= 2;
        toggle?.classList.toggle('is-tip', show);
        if (!show) { tip?.remove(); return; }
        if (!tip) {
            const m = strings.map;
            const esc = (t: string): string => this.escapeHtml(t);
            tip = document.createElement('section');
            tip.className = 'map-time-tip';
            tip.setAttribute('aria-labelledby', 'map-time-tip-title');
            tip.innerHTML = `<h3 class="map-time-tip-title" id="map-time-tip-title"><span aria-hidden="true">◷</span> ${esc(m.timeTipTitle)}</h3>`
                + `<p class="map-time-tip-text">${esc(m.timeTipText)}</p>`
                + `<div class="map-time-tip-acts"><button type="button" class="map-time-tip-try">${esc(m.timeTipTry)}</button>`
                + `<button type="button" class="map-time-tip-later">${esc(m.timeTipLater)}</button></div>`;
            tip.addEventListener('click', (e: Event) => {
                const t = e.target as HTMLElement;
                if (t.closest('.map-time-tip-try')) {
                    this.dismissMapTimeTip(false);
                    this.toggleMapTime();
                    container.querySelector<HTMLElement>('.map-time-toggle')?.focus();
                } else if (t.closest('.map-time-tip-later')) {
                    this.dismissMapTimeTip(true);
                }
            });
            container.appendChild(tip);
        }
        this.positionMapTimeTip();
    },

    /** Left of the timer, its top a little above the button's; a phone's card is placed by CSS. */
    positionMapTimeTip(): void {
        const container = document.getElementById('map-container');
        const tip = container?.querySelector<HTMLElement>('.map-time-tip');
        const toggle = container?.querySelector<HTMLElement>('.map-time-toggle');
        if (!container || !tip || !toggle) return;
        if (window.matchMedia(MQ_PHONE_BAR).matches) {
            tip.style.removeProperty('right');
            tip.style.removeProperty('top');
            return;
        }
        const box = container.getBoundingClientRect();
        const r = toggle.getBoundingClientRect();
        tip.style.right = `${Math.round(box.right - r.left + 10)}px`;
        tip.style.top = `${Math.round(Math.max(8, r.top - box.top - 14))}px`;
    },

    /** The offer is spent (the mode turned on or "Not now"); `refocus`: to the timer. */
    dismissMapTimeTip(refocus: boolean): void {
        markMapTimeTipSeen();
        const container = document.getElementById('map-container');
        const tip = container?.querySelector('.map-time-tip');
        const toggle = container?.querySelector<HTMLElement>('.map-time-toggle');
        toggle?.classList.remove('is-tip');
        if (!tip) return;
        tip.remove();
        if (refocus) toggle?.focus();
    },

    /** Timer toggle: reveal the timebar starting at the earliest year, or hide it. */
    toggleMapTime(): void {
        const harvest = this.mapTimeHarvest();
        if (harvest.minYear === null) return;   // nothing dated (button is disabled)
        if (!this.mapTimeOn) {
            this.mapTimeYear = harvest.minYear;   // begin at the beginning of the story
        }
        this.setMapTimeOn(!this.mapTimeOn);
        // Back on with a chosen person: its path from its beginning.
        const bounds = this.mapTimeOn && this.mapPathOn() ? this.mapTimeBounds() : null;
        if (bounds) {
            this.mapTimeYear = bounds.min;
            this.refreshMapPath();
        }
    },

    /** Turn the mode on/off, tidying playback and redrawing the map. */
    setMapTimeOn(on: boolean): void {
        this.mapTimeOn = on;
        if (!on) this.stopMapTimePlay();
        if (!on) this.closeMapPathPicker(false);
        this.closeMapPopup();
        const container = document.getElementById('map-container');
        this.renderMapTimeControls();
        if (container) this.drawMapMarkers(container, this.mapPlaces());
        this.renderMapStatus(this.mapPlaces());
    },

    /**
     * Play/pause. Without a chosen person the year steps forward once every
     * ~120ms until the last year; with the ancestors' path the whole range
     * plays in 24 s, a year in which someone came onto the map lasting five
     * times an empty one (pathPlaySchedule), and stops at the target.
     */
    toggleMapTimePlay(): void {
        if (this.mapTimePlaying) { this.stopMapTimePlay(); return; }
        if (!this.mapTimeOn) return;
        const bounds = this.mapTimeBounds();
        if (!bounds) return;
        // Reaching the end and pressing play again replays from the start.
        if (this.mapTimeYear >= bounds.max) {
            this.mapTimeYear = bounds.min;
            this.syncMapTimeControls();
            this.renderMapTimeCaption();
            const el = document.getElementById('map-container');
            if (el) this.drawMapMarkers(el, []);
        }
        this.mapTimePlaying = true;
        this.updateMapTimePlayIcon();
        if (this.mapPathOn()) { this.playMapPath(); return; }
        this.mapTimeTimer = window.setInterval(() => {
            const b = this.mapTimeBounds();
            const el = document.getElementById('map-container');
            // Stop when the map is left, the mode is off, or the data is gone.
            if (!this.mapTimeOn || !el || el.style.display === 'none' || !b) {
                this.stopMapTimePlay();
                return;
            }
            if (this.mapTimeYear >= b.max) { this.stopMapTimePlay(); return; }
            this.mapTimeYear++;
            this.syncMapTimeControls();
            this.renderMapTimeCaption();
            this.drawMapMarkers(el, []);
        }, 120);
    },

    stopMapTimePlay(): void {
        if (this.mapTimeTimer !== null) {
            clearInterval(this.mapTimeTimer);
            clearTimeout(this.mapTimeTimer);
            this.mapTimeTimer = null;
        }
        this.mapTimePlaying = false;
        this.updateMapTimePlayIcon();
    },

    /** Push the current year onto the slider and its label (playback tick). */
    syncMapTimeControls(): void {
        const range = document.querySelector('.map-time-range') as HTMLInputElement | null;
        if (range) range.value = String(this.mapTimeYear);
        this.updateMapTimeLabel();
    },

    /** One-time notice shown instead of the map until the user has read it. */
    renderMapTilesNotice(container: HTMLElement): void {
        let notice = container.querySelector('.map-tiles-notice') as HTMLElement | null;
        if (!notice) {
            notice = document.createElement('div');
            notice.className = 'map-tiles-notice';
            container.appendChild(notice);
        }
        notice.innerHTML = `
            <div class="map-tiles-notice-card">
                <p>${strings.map.tilesNotice}</p>
                <button type="button" onclick="window.Strom.UI.acknowledgeMapTiles()">${strings.map.tilesNoticeOk}</button>
            </div>`;
        const box = document.getElementById('map-status');
        if (box) box.style.display = 'none';
    },

    acknowledgeMapTiles(): void {
        SettingsManager.setMapTilesAcknowledged();
        TreeRenderer.render();
    },

    mapViewportSize(container: HTMLElement): { width: number; height: number } {
        const rect = container.getBoundingClientRect();
        // Fall back to something sane when measured before layout (jsdom, hidden).
        return { width: Math.round(rect.width) || 800, height: Math.round(rect.height) || 600 };
    },

    /**
     * Who is connected to a point — the bubble shown when a marker is clicked.
     * `key` is a point's key or a place of a town point (the life timeline
     * opens a place, the map may show it within its town). `pan: false` keeps
     * the map where it is (a redraw of the open bubble).
     */
    showMapPlace(key: string, opts: { pan?: boolean } = {}): void {
        const popup = document.querySelector('.map-popup') as HTMLElement | null;
        if (!popup) return;
        const points = this.mapPoints();
        key = points.some(p => p.key === key) ? key : this.mapPointKeyOf(key);
        const point = points.find(p => p.key === key)
            ?? points.find(p => p.type === 'town' && p.placeKeys.includes(key));
        // The ancestors' path (spec 054): its lines met here and its people by the year shown.
        const path = this.mapTimeOn && this.mapPathOn() ? this.mapPathBubbleParts(point?.key ?? key) : null;
        if (!point) {
            if (path) this.showMapPathPlace(popup, key, path, opts);
            return;
        }
        if (point.key !== openPoint) {
            townQuery = '';
            townExpanded = new Set();
            this.resetMapPopupPerson();
        }
        openPoint = point.key;
        popup.classList.remove('map-work-bubble');

        const m = strings.map;
        const on = this.mapKinds();
        const only = on.size < MAP_KINDS.length
            ? ` · ${m.kindsOnly(MAP_KINDS.filter(k => on.has(k)).map(k => m.kinds[k]))}` : '';
        const name = point.type === 'town' ? point.town : point.usage.display;
        const geo = point.geo;
        // The place's identity (spec 034 §7): who placed it, its name today, its former names.
        const lang = getCurrentLanguage();
        const idKey = point.type === 'town' ? point.ownKey : point.key;
        const id = idKey ? this.placeIdentitiesNow([idKey]).get(idKey) : undefined;
        const located = id && id.located ? id : undefined;
        const where = located ? placeLocationLabel(located, geo, lang) : geo.label;
        const label = [where, geo.byTown ? m.byTownShort(geo.byTown) : ''].filter(Boolean).join(' · ');
        const former = located ? placeFormerLine(located, name, lang) : '';
        const origin = located?.origin
            ? placeOriginBadge(located.origin, lang, located.origin === 'research' ? located.at : undefined, { small: true }) : '';
        const town = point.type === 'town' && !path;
        const big = town && point.type === 'town' && point.houseCount > TOWN_BIG;
        const summary = point.type === 'town'
            ? m.townSummary(point.houseCount, point.personCount) + only
            : (only ? m.usedBy(point.usage.personIds.length) + only : '');

        popup.innerHTML = `
            <div class="map-popup-grip" aria-hidden="true"></div>
            <div class="map-popup-top">
                <div class="map-popup-head">
                    <strong>${this.escapeHtml(name)}</strong>
                    <button type="button" class="map-popup-close" aria-label="${strings.buttons.close}">×</button>
                </div>
                ${origin ? `<div class="map-popup-origin">${origin}</div>` : ''}
                ${label ? `<div class="map-popup-label">${this.escapeHtml(label)}</div>` : ''}
                ${former ? `<div class="map-popup-former">${this.escapeHtml(former)}</div>` : ''}
                ${summary && !path ? `<div class="map-popup-summary">${this.escapeHtml(summary)}</div>` : ''}
                ${path ? path.tags + path.implex : ''}
                ${big ? `
                <label class="map-popup-search">
                    <span class="map-popup-search-icon" aria-hidden="true">⌕</span>
                    <input type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"
                           placeholder="${this.escapeHtml(m.houseSearch)}" aria-label="${this.escapeHtml(m.houseSearch)}"
                           value="${this.escapeHtml(townQuery)}">
                    <span class="map-popup-search-count" aria-live="polite"></span>
                </label>` : ''}
            </div>
            ${this.mapPopupResearchHtml(point, located)}
            <div class="map-popup-body${town ? ' map-popup-houses' : ''}">
                ${path ? path.rows : point.type === 'town' ? '' : `<div class="map-popup-people${this.mapTimeOn ? ' is-rows' : ''}">${this.mapPopupPeople(
                    [...soloPersons(point.usage)], Infinity, '')}${this.mapPopupShares(point.usage.shares ?? [])}</div>`}
            </div>
            <div class="map-popup-foot">
                <button type="button" class="map-popup-fix" data-key="${this.escapeHtml(point.type === 'town' ? point.ownKey ?? point.key : point.key)}">${m.wrongSpot}</button>
            </div>`;
        // Following the research: the runs at work here, right under the place's head.
        this.mapPopupWork(popup, point.key);
        if (town && point.type === 'town') {
            this.renderMapTownList(point);
            const input = popup.querySelector('.map-popup-search input') as HTMLInputElement | null;
            input?.addEventListener('input', () => {
                townQuery = input.value;
                this.renderMapTownList(point);
            });
        }
        this.openMapPopupAt(popup, geo, opts);
    },

    /** Show the filled bubble: in the middle of the map, a phone's sheet along the bottom. */
    openMapPopupAt(popup: HTMLElement, geo: PlaceGeo, opts: { pan?: boolean }): void {
        popup.style.display = 'flex';
        // A phone: a sheet along the bottom, and the point moves up above it; the bar steps aside meanwhile.
        const sheet = window.matchMedia(MQ_MOBILE).matches;
        popup.classList.toggle('map-popup--sheet', sheet);
        document.getElementById('map-container')?.classList.toggle('map-sheet-open', sheet);
        // One sheet at a time: the legend's sheets give way to the bubble.
        if (sheet) this.closeMapLinesSheets();
        if (sheet && opts.pan !== false) this.panMapAboveSheet(geo);
    },

    /** A point only the ancestors' path draws (none of the scope's points): its name, lines and people. */
    showMapPathPlace(popup: HTMLElement, key: string, path: { tags: string; implex: string; rows: string }, opts: { pan?: boolean }): void {
        const geo = this.mapPathModel()?.points.get(key);
        if (!geo) return;
        if (key !== openPoint) this.resetMapPopupPerson();
        openPoint = key;
        popup.classList.remove('map-work-bubble');
        const name = this.mapPathLocate().display.get(key) ?? geo.label ?? '';
        popup.innerHTML = `
            <div class="map-popup-grip" aria-hidden="true"></div>
            <div class="map-popup-top">
                <div class="map-popup-head">
                    <strong>${this.escapeHtml(name)}</strong>
                    <button type="button" class="map-popup-close" aria-label="${strings.buttons.close}">×</button>
                </div>
                ${path.tags}${path.implex}
            </div>
            <div class="map-popup-body">${path.rows}</div>`;
        this.openMapPopupAt(popup, geo, opts);
    },

    /**
     * A bubble of the research's work alone (spec 043 §5.4): a place worked on
     * that is not one of the map's points now. Closes like any bubble.
     */
    showMapWorkBubble(html: string, geo: PlaceGeo | { lat: number; lon: number }, session: number): void {
        const popup = document.querySelector('.map-popup') as HTMLElement | null;
        if (!popup) return;
        openPoint = `${WORK_BUBBLE}${session}`;
        popup.innerHTML = html;
        popup.classList.add('map-work-bubble');
        this.fillMapWorkTimes(popup);
        popup.style.display = 'flex';
        const sheet = window.matchMedia(MQ_MOBILE).matches;
        popup.classList.toggle('map-popup--sheet', sheet);
        document.getElementById('map-container')?.classList.toggle('map-sheet-open', sheet);
        if (sheet) this.closeMapLinesSheets();
        if (sheet) this.panMapAboveSheet({ lat: geo.lat, lon: geo.lon });
    },

    /**
     * What the research adds to a bubble (§7): the one line of why the
     * research put it here with "Why here ›", the Check block with Keep /
     * Change / Check, Check for a place the map found, Look up for
     * the houses located by the town. The research's steps only with the research here; a phone
     * says where it goes instead.
     */
    mapPopupResearchHtml(point: MapPoint, id: PlaceIdentity | undefined): string {
        const om = strings.places.onMap;
        const d = strings.places.dialog;
        const r = strings.places.research;
        const access = this.placesResearchContext().access;
        const esc = (t: string): string => this.escapeHtml(t);
        const key = esc(id ? (point.type === 'town' ? point.ownKey ?? point.key : point.key) : point.key);
        const note = (text: string): string => `<p class="map-popup-note">${esc(text)}</p>`;
        const diamond = (cls: string, label: string, data = ''): string =>
            `<button type="button" class="${cls}" data-key="${key}"${data}>${esc(label)}</button>`;
        const parts: string[] = [];
        if (id) {
            const b = mapBubbleResearch(id, access);
            if (b.whyHere && !b.check) {
                const why = id.why ? firstSentence(id.why) : '';
                parts.push(`<div class="map-popup-why">${why ? `<p>${esc(why)}</p>` : ''}<button type="button" class="map-popup-whymore" data-key="${key}">${esc(om.whyHere)}</button></div>`);
            }
            if (b.check) {
                const reason = this.mapCheckReason(id, getCurrentLanguage());
                parts.push(`<div class="map-popup-check" role="group" aria-label="${esc(strings.places.state.check)}">
                    <p class="map-popup-check-why"><span class="map-popup-check-mark" aria-hidden="true">!</span> ${esc(reason)}</p>
                    <div class="map-popup-actions">
                        <button type="button" class="map-popup-keep" data-key="${key}">${esc(d.keep)}</button>
                        <button type="button" class="secondary map-popup-change" data-key="${key}">${esc(d.change)}</button>
                        ${b.checkResearch ? diamond('secondary map-popup-checkres', r.check) : ''}
                    </div>
                    ${b.note ? note(om.phoneCheck) : ''}
                </div>`);
            } else if (b.checkResearch) {
                parts.push(`<div class="map-popup-actions">${diamond('secondary map-popup-checkres', r.check)}</div>`);
            } else if (b.note) {
                parts.push(note(om.phoneCheck));
            }
        }
        if (point.type === 'town' && access !== 'none') {
            const houses = point.houses.flatMap(h => h.placeKeys.filter(k => k !== point.ownKey));
            if (houses.length) {
                if (access === 'ok') {
                    const all = collectPlaces(DataManager.getData());
                    const names = houses.slice(0, 3).map(k => all.get(k)?.display ?? k).join(', ')
                        + (houses.length > 3 ? ` +${houses.length - 3}` : '');
                    parts.push(`<div class="map-popup-actions">${diamond('secondary map-popup-look', om.lookHouses(names), ` data-keys="${esc(JSON.stringify(houses))}"`)}</div>`);
                } else {
                    parts.push(note(strings.places.menu.note));
                }
            }
        }
        return parts.length ? `<div class="map-popup-research">${parts.join('')}</div>` : '';
    },

    /** "Keep" in the bubble: the location stays, the mark goes (undoable); the map keeps its frame. */
    keepPlaceOnMap(key: string): void {
        const geo = DataManager.getData().places?.[key];
        if (!geo) return;
        DataManager.setPlaceGeos(new Map([[key, { ...geo, keptAt: placeGeoHash(geo) }]]), strings.places.dialog.kept);
        this.showToast(strings.places.dialog.kept);
        this.refreshMapContent();
    },

    /** The bubble of a town point ('town:…'): its houses, each with its people. */
    showMapTown(key: string): void {
        this.showMapPlace(key);
    },

    /**
     * The houses of the open town bubble, in natural order, narrowed by its
     * search; above TOWN_BIG houses each house shows its first 3 people and
     * "+ N more" (the "no house number" group its first 6).
     */
    renderMapTownList(point: TownPoint): void {
        const popup = document.querySelector('.map-popup') as HTMLElement | null;
        const body = popup?.querySelector('.map-popup-houses') as HTMLElement | null;
        if (!popup || !body) return;
        const m = strings.map;
        const big = point.houseCount > TOWN_BIG;
        const q = big ? townQuery.trim() : '';
        const houses = q ? point.houses.filter(h => houseMatches(h.house, q)) : point.houses;
        const count = popup.querySelector('.map-popup-search-count') as HTMLElement | null;
        if (count) count.textContent = q ? m.houseHits(houses.length) : '';
        const rows = houses.map(h => `
            <div class="map-popup-house">
                <div class="map-popup-house-head"><span class="map-popup-house-no">${this.escapeHtml(h.house)}</span><span class="map-popup-house-bytown">${this.escapeHtml(strings.places.onMap.byTown)}</span></div>
                <div class="map-popup-people">${this.mapPopupPeople([...h.solo], big ? 3 : Infinity, h.key)}${this.mapPopupShares(h.shares)}</div>
            </div>`).join('');
        const none = q && houses.length === 0 ? `<p class="map-popup-none">${this.escapeHtml(m.houseSearchNone)}</p>` : '';
        const noHouse = !q && point.noHouse.size > 0 ? `
            <div class="map-popup-nohouse">
                <div class="map-popup-nohouse-title">${this.escapeHtml(`${m.noHouseNumber} · ${m.usedBy(point.noHouse.size)}`)}</div>
                <div class="map-popup-people">${this.mapPopupPeople([...point.noHouseSolo], big ? 6 : Infinity, NO_HOUSE)}${this.mapPopupShares(point.noHouseShares)}</div>
            </div>` : '';
        body.innerHTML = rows + none + noHouse;
    },

    /**
     * People of a bubble as buttons, the marks of their kinds before the name
     * (only the kinds on); past `limit` a "+ N more" that shows the rest of
     * this group (`group` = its key in townExpanded).
     */
    mapPopupPeople(entries: readonly (readonly [PersonId, ReadonlySet<MapKind>])[], limit: number, group: string): string {
        const m = strings.map;
        const on = this.mapKinds();
        const people = entries
            .map(([id, kinds]) => ({ person: DataManager.getPerson(id), kinds }))
            .filter((e): e is { person: NonNullable<typeof e.person>; kinds: ReadonlySet<MapKind> } => !!e.person);
        const shown = townExpanded.has(group) ? people : people.slice(0, limit);
        const html = shown.map(({ person, kinds }) => {
            const name = shownName(person);
            const marks = kindMarks(kinds, on);
            // Migration over time: a row that unfolds its actions (Person page, Path to this person).
            if (this.mapTimeOn) return this.mapPopupPathRow(person.id, name, this.mapPopupBirthYear(person.id), '', false, marks);
            const what = MAP_KINDS.filter(k => kinds.has(k) && on.has(k)).map(k => m.kinds[k]).join(', ');
            return `
                <button type="button" class="map-popup-person" data-person-id="${this.escapeHtml(person.id)}"
                        title="${this.escapeHtml(what ? `${name} · ${what}` : name)}">${marks
                    ? `<span class="map-popup-marks" aria-hidden="true">${marks}</span>` : ''}${this.escapeHtml(name)}</button>`;
        }).join('');
        const rest = people.length - shown.length;
        return html + (rest > 0
            ? `<button type="button" class="map-popup-more" data-group="${this.escapeHtml(group)}">${this.escapeHtml(m.morePeople(rest))}</button>`
            : '');
    },

    /**
     * The shared events of a bubble (spec 085 §2f), each one row however many
     * persons it has: "1921 Census · Prokop, Terezie, Bohumil, Anežka", the
     * given names leading to those persons (the whole name where two share a
     * given name), in the order of its "Shared with"; by year.
     */
    mapPopupShares(rows: readonly PlaceShare[]): string {
        if (rows.length === 0) return '';
        const esc = (t: string): string => this.escapeHtml(t);
        const data = DataManager.getData();
        const on = this.mapKinds();
        const year = (r: PlaceShare): number => yearOf(r.event.date) ?? Number.MAX_SAFE_INTEGER;
        return [...rows].sort((a, b) => year(a) - year(b)).map(r => {
            const names = sharedNames(data, r.personIds);
            if (names.length === 0) return '';
            const y = yearOf(r.event.date);
            const what = lifeEventLabel(r.event);
            const last = names.length - 1;
            const who = names.map((n, i) => `<span class="map-popup-share-item"><button type="button" class="map-popup-share-name" data-person-id="${esc(n.personId)}" title="${esc(n.full)}">${esc(n.text)}</button>${i < last ? ',' : ''}</span>`).join(' ');
            const marks = kindMarks(new Set([r.kind]), on);
            return `<div class="map-popup-share" data-share="${esc(r.shareId)}">`
                + (marks ? `<span class="map-popup-marks" aria-hidden="true">${marks}</span>` : '')
                + `<span class="map-popup-share-year">${y !== null ? y : ''}</span>`
                + `<span class="map-popup-share-text"><span class="map-popup-share-what">${esc(what)} ·</span> ${who}</span></div>`;
        }).join('');
    },

    /** Move the map so the point of an opened sheet stands at about 18 % of its height, above the sheet. */
    panMapAboveSheet(geo: PlaceGeo): void {
        const container = document.getElementById('map-container');
        if (!container || !this.mapCenter) return;
        const { width, height } = this.mapViewportSize(container);
        const at = pointInViewport(geo, this.mapCenter, this.mapZoom, width, height);
        this.mapCenter = panCenter(this.mapCenter, this.mapZoom, 0, Math.round(height * 0.18 - at.y));
        this.drawMapTiles(container);
        this.drawMapMarkers(container, this.mapPlaces());
    },

    /**
     * Open the map on one place (T17, a place in the life timeline): centred
     * at town level, its panel of people open. A place the current scope does
     * not cover switches the map to the whole tree.
     */
    showPlaceOnMap(key: string): void {
        key = this.mapPointKeyOf(key);
        const geo = DataManager.getData().places?.[key];
        if (!geo) return;
        if (!this.mapPlaces().some(p => p.key === key)) this.mapScope = 'tree';
        // Hidden by the kinds switched off: the place's own kinds come on too.
        if (!this.mapPlaces().some(p => p.key === key)) {
            const usage = collectPlaces(DataManager.getData()).get(key);
            const on = new Set(this.mapKinds());
            for (const kinds of usage?.kinds.values() ?? []) kinds.forEach(k => on.add(k));
            SettingsManager.setMapKinds([...on]);
        }
        this.mapCenter = { lat: geo.lat, lon: geo.lon };
        this.mapZoom = 11;
        this.closeMapPopup();
        TreeRenderer.presetViewMode('map');
        void TreeRenderer.renderAsync().then(() => this.showMapPlace(key));
    },

    /** Delegated clicks for map content that is re-rendered as HTML strings.
     *  Place keys are user data — they must never be spliced into inline JS. */
    bindMapClicks(container: HTMLElement): void {
        const markers = container.querySelector('.map-markers') as HTMLElement | null;
        markers?.addEventListener('click', (e: Event) => {
            const btn = (e.target as HTMLElement).closest('.map-marker') as HTMLElement | null;
            if (btn?.dataset.key !== undefined) this.showMapPlace(btn.dataset.key);
        });
        const popup = container.querySelector('.map-popup') as HTMLElement | null;
        popup?.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.closest('.map-popup-close')) { this.closeMapPopup(); return; }
            // A name of a shared event's row goes to that person (spec 085 §2f).
            const shareName = target.closest<HTMLElement>('.map-popup-share-name');
            if (shareName?.dataset.personId) { this.focusFromMap(shareName.dataset.personId); return; }
            const person = target.closest('.map-popup-person') as HTMLElement | null;
            if (person?.hasAttribute('aria-expanded')) { this.toggleMapPopupPerson(person); return; }
            if (person?.dataset.personId) { this.focusFromMap(person.dataset.personId); return; }
            const pact = target.closest<HTMLElement>('.map-popup-act');
            if (pact?.dataset.personId) {
                const id = pact.dataset.personId as PersonId;
                if (pact.dataset.pact === 'path') this.setMapPathTarget(id);
                else { this.closeMapPopup(); this.showPersonPage(id); }
                return;
            }
            // The person a run works on: the family view, as following goes there (spec 043 §1.2).
            const worked = target.closest('.map-work-person') as HTMLElement | null;
            if (worked?.dataset.personId) {
                this.closeMapPopup();
                if (this.liveFollowView()) this.followToPerson(worked.dataset.personId as PersonId);
                else this.focusFromMap(worked.dataset.personId);
                return;
            }
            const more = target.closest('.map-popup-more') as HTMLElement | null;
            if (more && openPoint) {
                townExpanded.add(more.dataset.group ?? '');
                const point = this.mapPoints().find(p => p.key === openPoint);
                if (point?.type === 'town') this.renderMapTownList(point);
                else this.showMapPlace(openPoint, { pan: false });
                return;
            }
            const fix = target.closest('.map-popup-fix') as HTMLElement | null;
            if (fix) { this.showPlacesManager(fix.dataset.key); return; }
            const act = target.closest<HTMLElement>('.map-popup-keep, .map-popup-change, .map-popup-checkres, .map-popup-whymore, .map-popup-look');
            const key = act?.dataset.key;
            if (!act || key === undefined) return;
            if (act.classList.contains('map-popup-keep')) this.keepPlaceOnMap(key);
            else if (act.classList.contains('map-popup-change')) this.showPlacesManager(key);
            else if (act.classList.contains('map-popup-whymore')) this.showPlacesManager(key, undefined, undefined, { focus: 'why' });
            else if (act.classList.contains('map-popup-checkres')) void this.queuePlaces([key], true);
            else {
                let keys: string[] = [];
                try { keys = JSON.parse(act.dataset.keys ?? '[]') as string[]; } catch { /* none */ }
                void this.queuePlaces(keys, false);
            }
        });
        // A click on the map itself (not a drag) closes the bubble.
        let downAt: { x: number; y: number } | null = null;
        container.addEventListener('pointerdown', (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; }, true);
        container.addEventListener('click', (e: MouseEvent) => {
            if (!openPoint) return;
            // A button the bubble re-rendered under the click ("+ N more") is
            // no longer in the page: that click was inside the bubble.
            if (!(e.target as Node).isConnected) return;
            if ((e.target as HTMLElement).closest('.map-marker, .map-marker-work, .map-follow-notices, .follow-legend-host, .map-popup, .map-path-picker, .map-lines-legend, .map-lines-chip, .map-lines-und, .map-time-tip, .map-controls, .map-topleft, .map-status, .map-timebar, .map-tiles-notice, .map-attribution')) return;
            if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
            this.closeMapPopup();
        });
    },

    closeMapPopup(): void {
        openPoint = null;
        document.getElementById('map-container')?.classList.remove('map-sheet-open');
        const popup = document.querySelector('.map-popup') as HTMLElement | null;
        if (popup) {
            popup.style.display = 'none';
            popup.classList.remove('map-work-bubble');
        }
    },

    /**
     * Clicking a person on the map takes the view to them in the family view.
     * A satellite's map selects them instead (spec 079 §2): their places
     * marked, the choice shared; the view switcher leads to the family.
     */
    focusFromMap(personId: string): void {
        this.closeMapPopup();
        if (getWindowRole() === 'satellite') {
            TreeRenderer.setWindowSelected(personId as PersonId);
            window.dispatchEvent(new CustomEvent(PERSON_CHOSEN_EVENT, { detail: { personId } }));
            return;
        }
        TreeRenderer.presetViewMode('family');
        TreeRenderer.setFocus(personId as PersonId);
    },

    setMapScope(scope: MapScope): void {
        if (this.mapScope === scope) return;
        this.mapScope = scope;
        this.closeMapPopup();
        this.mapCenter = null;  // reframe for the new set of places
        TreeRenderer.render();
    },

    /** Frame every place; `byUser`: the Fit button (following there then stops panning the map). */
    fitMapToPlaces(byUser = false): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        if (byUser) this.noteMapMovedByUser();
        // With the ancestors' path the Fit button frames the path.
        if (this.mapPathOn()) { this.fitMapToPath(); return; }
        const places = this.mapPlaces();
        if (places.length === 0) return;
        const { width, height } = this.mapViewportSize(container);
        const fit = fitBounds(places.map(p => p.geo), width, height);
        this.mapCenter = fit.center;
        this.mapZoom = fit.zoom;
        this.drawMapTiles(container);
        this.drawMapMarkers(container, places);
    },

    /** The + / − buttons. */
    zoomMap(delta: number): void {
        const container = document.getElementById('map-container');
        if (!container || !this.mapCenter) return;
        this.noteMapMovedByUser();
        const { width, height } = this.mapViewportSize(container);
        const next = zoomAround(
            this.mapCenter, this.mapZoom, this.mapZoom + delta,
            { x: width / 2, y: height / 2 }, width, height,
        );
        this.mapCenter = next.center;
        this.mapZoom = next.zoom;
        this.closeMapPopup();
        this.drawMapTiles(container);
        this.drawMapMarkers(container, this.mapPlaces());
    },

    /** Drag to pan, pinch (or wheel) to zoom — what everyone expects from a map. */
    bindMapGestures(container: HTMLElement): void {
        // Active pointers by id. One = drag/pan; two = pinch zoom. Tracking them
        // ourselves (rather than a single-pointer flag) lets a second finger land
        // mid-drag without the map lurching.
        const pointers = new Map<number, { x: number; y: number }>();
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        let pinching = false;
        let pinchBaseline = 0;   // finger spread measured at the last zoom step
        // Where a drag started: past a few px it moves the map by hand (following there pauses its panning).
        let dragFrom: { x: number; y: number } | null = null;

        // Redraws re-position tiles/markers, so during a gesture they are
        // coalesced to one per frame instead of one per pointer event.
        let redrawQueued = false;
        const queueRedraw = (): void => {
            if (redrawQueued) return;
            redrawQueued = true;
            requestAnimationFrame(() => {
                redrawQueued = false;
                this.drawMapTiles(container);
                this.drawMapMarkers(container, this.mapPlaces());
            });
        };

        const spread = (): number => {
            const [a, b] = [...pointers.values()];
            return Math.hypot(a.x - b.x, a.y - b.y);
        };

        container.addEventListener('pointerdown', (e: PointerEvent) => {
            if ((e.target as HTMLElement).closest('.map-marker, .map-marker-work, .map-follow-notices, .follow-legend-host, .map-popup, .map-path-picker, .map-lines-legend, .map-lines-chip, .map-lines-und, .map-time-tip, .map-controls, .map-topleft, .map-status, .map-timebar, .map-tiles-notice')) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 1) dragFrom = { x: e.clientX, y: e.clientY };
            try { container.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
            if (pointers.size === 1) {
                dragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
                container.classList.add('map-dragging');
            } else if (pointers.size === 2) {
                // Second finger down: stop panning and start a pinch. Panning is
                // paused so the frame the finger lands does not also pan-jump.
                dragging = false;
                pinching = true;
                pinchBaseline = spread();
                container.classList.remove('map-dragging');
                this.closeMapPopup();
            }
        });
        container.addEventListener('pointermove', (e: PointerEvent) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (pinching && pointers.size >= 2 && this.mapCenter) {
                const { step, baseline } = pinchZoomStep(spread(), pinchBaseline);
                pinchBaseline = baseline;
                if (step !== 0) {
                    this.noteMapMovedByUser();
                    const [a, b] = [...pointers.values()];
                    const rect = container.getBoundingClientRect();
                    const next = zoomAround(
                        this.mapCenter, this.mapZoom, this.mapZoom + step,
                        { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
                        Math.round(rect.width), Math.round(rect.height),
                    );
                    this.mapCenter = next.center;
                    this.mapZoom = next.zoom;
                    queueRedraw();
                }
                return;
            }

            if (dragging && this.mapCenter) {
                if (dragFrom && Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) > 4) {
                    dragFrom = null;
                    this.noteMapMovedByUser();
                }
                this.mapCenter = panCenter(this.mapCenter, this.mapZoom, e.clientX - lastX, e.clientY - lastY);
                lastX = e.clientX;
                lastY = e.clientY;
                queueRedraw();
            }
        });
        const endPointer = (e: PointerEvent): void => {
            if (!pointers.has(e.pointerId)) return;
            pointers.delete(e.pointerId);
            try { container.releasePointerCapture(e.pointerId); } catch { /* already released */ }
            if (pointers.size < 2) pinching = false;
            if (pointers.size === 1) {
                // Back to one finger: resume panning from where it rests, so
                // lifting one pinch finger does not snap the map.
                const [p] = [...pointers.values()];
                dragging = true;
                lastX = p.x;
                lastY = p.y;
                container.classList.add('map-dragging');
            } else if (pointers.size === 0) {
                dragging = false;
                container.classList.remove('map-dragging');
            }
        };
        container.addEventListener('pointerup', endPointer);
        container.addEventListener('pointercancel', endPointer);

        container.addEventListener('wheel', (e: WheelEvent) => {
            if (!this.mapCenter) return;
            // The choice of a person scrolls its own list.
            if ((e.target as HTMLElement).closest('.map-path-picker, .map-lines-legend, .map-lines-und, .map-time-tip')) return;
            e.preventDefault();
            this.noteMapMovedByUser();
            const rect = container.getBoundingClientRect();
            const next = zoomAround(
                this.mapCenter, this.mapZoom, this.mapZoom + (e.deltaY < 0 ? 1 : -1),
                { x: e.clientX - rect.left, y: e.clientY - rect.top },
                Math.round(rect.width), Math.round(rect.height),
            );
            this.mapCenter = next.center;
            this.mapZoom = next.zoom;
            this.closeMapPopup();
            this.drawMapTiles(container);
            this.drawMapMarkers(container, this.mapPlaces());
        }, { passive: false });
    },

    // ==================== GEOCODING (opt-in, place names only) ====================

    /**
     * Ask before the first lookup ever. This is the only feature that sends
     * anything out of the app, so the question is explicit about what leaves
     * (place names), where it goes, and that it happens once.
     */
    async confirmGeocoding(count: number): Promise<boolean> {
        if (SettingsManager.isGeocodingAllowed()) return true;
        const ok = await this.showConfirm(
            strings.map.consentBody(count, GEOCODER_NAME),
            strings.map.consentTitle,
            { ok: strings.map.consentConfirm },
        );
        if (ok) SettingsManager.setGeocodingAllowed(true);
        return ok;
    },

    async startGeocoding(): Promise<void> {
        const missing = this.mapMissingPlaces();
        if (missing.length === 0 || this.mapGeocoding) return;
        if (!await this.confirmGeocoding(missing.length)) return;
        if (this.mapGeocoding) return;   // second click raced the consent dialog

        // The run takes ~1.1 s per place — minutes on a big tree. The answers
        // belong to the tree that asked, not to whatever is open when they land.
        const treeId = DataManager.getCurrentTreeId();

        const controller = new AbortController();
        this.mapGeocodeAbort = controller;
        this.mapGeocoding = { done: 0, total: missing.length, place: missing[0].usage.display };
        this.renderMapStatus(this.mapPlaces());

        // Ask for the spelling the family uses most — that is the one most
        // likely to be a real place name rather than a typo. The registry key
        // is carried alongside, so the answer lands on the right entry however
        // the name is spelled.
        const names = missing.map(m => m.usage.display);
        const keyOfName = new Map(missing.map(m => [m.usage.display, m.key]));
        const data = DataManager.getData();

        const results = await geocodePlaces(names, {
            signal: controller.signal,
            // A place with a house the geocoder does not know is looked up by its town (§4).
            townFallback: { centroid: placesCentroid(data.places), known: knownStreets(data) },
            // Of several towns of a place's name, the one nearest the tree's other places (A6.5.1).
            treePlaces: data.places,
            onProgress: (done, total) => {
                this.mapGeocoding = { done, total, place: names[Math.min(done, total - 1)] };
                this.renderMapStatus(this.mapPlaces());
            },
        });

        this.mapGeocoding = null;
        this.mapGeocodeAbort = null;

        if (DataManager.getCurrentTreeId() !== treeId) return;   // tree switched mid-run

        const found = new Map<string, PlaceGeo>();
        for (const [name, geo] of results) {
            const key = keyOfName.get(name);
            // Taken by the app from the geocoder (spec 034), dated.
            if (key && geo) found.set(key, stampedGeo(geo, 'map'));
        }
        if (found.size > 0) DataManager.setPlaceGeos(found);
        if (treeId) {
            const missed = geocodeMissed.get(treeId) ?? new Set<string>();
            for (const [name, geo] of results) {
                const key = keyOfName.get(name);
                if (key && !geo) missed.add(key);
                else if (key) missed.delete(key);
            }
            geocodeMissed.set(treeId, missed);
        }

        const notFound = results.size - found.size;
        const byTown = [...found.values()].filter(g => g.byTown).length;
        // The places still without a location are one tap away: the dialog with its "No location" chip.
        this.showToast(strings.map.geocodeDone(found.size, byTown, notFound), notFound > 0 ? 10000 : 6000, {
            action: {
                label: strings.map.managePlaces,
                run: () => this.showPlacesManager(undefined, undefined, undefined, { unplaced: notFound > 0 }),
            },
        });

        this.mapCenter = null;  // reframe now that there is more to show
        TreeRenderer.render();
    },

    cancelGeocoding(): void {
        this.mapGeocodeAbort?.abort();
        this.mapGeocodeAbort = null;
        this.mapGeocoding = null;
        TreeRenderer.render();
    },
});

