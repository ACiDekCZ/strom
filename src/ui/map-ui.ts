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

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { strings } from '../strings.js';
import { PersonId, PlaceGeo } from '../types.js';
import { collectPlaces, orphanedPlaceKeys, placeKey, PlaceUsage } from '../places.js';
import { collectDatedPlacePoints, DatedPlaceHarvest } from '../map-time.js';
import { yearOf } from '../dates.js';
import {
    fitBounds, panCenter, pinchZoomStep, pointInViewport, tileUrl, tilesForViewport, zoomAround,
    TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL,
} from '../map.js';
import { GEOCODER_NAME, geocodeCandidates, geocodePlaces } from '../geocode.js';
import { uiModule } from './module.js';

/** A place that has coordinates and therefore something to draw. */
export interface MappedPlace {
    key: string;
    usage: PlaceUsage;
    geo: PlaceGeo;
}

/** Which people the map covers. */
export type MapScope = 'view' | 'tree';

export const mapMethods = uiModule({
    /**
     * Places the map should show: everything with coordinates, for the chosen
     * scope. 'view' = the people currently on screen (what the user is looking
     * at), 'tree' = everybody.
     */
    mapPlaces(): MappedPlace[] {
        const data = DataManager.getData();
        const filter: ReadonlySet<PersonId> | undefined =
            this.mapScope === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();

        const mapped: MappedPlace[] = [];
        for (const [key, usage] of collectPlaces(data, filter)) {
            const geo = data.places?.[key];
            if (geo) mapped.push({ key, usage, geo });
        }
        return mapped.sort((a, b) => b.usage.count - a.usage.count || a.usage.display.localeCompare(b.usage.display));
    },

    /** Places in scope that have no coordinates yet — the geocoding to-do list. */
    mapMissingPlaces(): { key: string; usage: PlaceUsage }[] {
        const data = DataManager.getData();
        const filter: ReadonlySet<PersonId> | undefined =
            this.mapScope === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();
        return [...collectPlaces(data, filter)]
            .filter(([key]) => !data.places?.[key])
            .map(([key, usage]) => ({ key, usage }))
            .sort((a, b) => b.usage.count - a.usage.count);
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
                    <button type="button" class="map-fit" onclick="window.Strom.UI.fitMapToPlaces()"
                            aria-label="${strings.map.fit}" title="${strings.map.fit}">⤢</button>
                    <button type="button" class="map-time-toggle" onclick="window.Strom.UI.toggleMapTime()"
                            aria-pressed="false" aria-label="${strings.map.timeMode}" title="${strings.map.timeMode}">⏱</button>
                </div>
                <div class="map-scope">
                    <button type="button" id="map-scope-view" onclick="window.Strom.UI.setMapScope('view')">${strings.map.scopeView}</button>
                    <button type="button" id="map-scope-tree" onclick="window.Strom.UI.setMapScope('tree')">${strings.map.scopeTree}</button>
                </div>
                <div class="map-timebar" id="map-timebar" hidden>
                    <button type="button" class="map-time-play" aria-label="${strings.map.timePlay}" title="${strings.map.timePlay}">⏵</button>
                    <input type="range" class="map-time-range" aria-label="${strings.map.timeYear}" value="0" min="0" max="0">
                    <span class="map-time-year">0</span>
                </div>
                <div class="map-status" id="map-status"></div>
                <a class="map-attribution" href="${TILE_ATTRIBUTION_URL}" target="_blank" rel="noopener noreferrer">${TILE_ATTRIBUTION}</a>`;
            this.mapTileEls = new Map();  // fresh canvas: the old <img> refs are detached
            this.bindMapGestures(container);
            this.bindMapClicks(container);
            this.bindMapTime(container);
        }

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

        // In time mode, own up to places that carry no date and so cannot appear
        // on the timeline — honesty instead of a silently emptier map.
        if (this.mapTimeOn) {
            const undated = this.mapTimeHarvest().undatedPlaceCount;
            if (undated > 0) {
                box.innerHTML = `
                    <span class="map-status-text">${strings.map.timeUndated(undated)}</span>
                    <button type="button" class="secondary" onclick="window.Strom.UI.showPlacesManager()">${strings.map.managePlaces}</button>`;
                box.style.display = 'flex';
                return;
            }
        }

        const missing = this.mapMissingPlaces();
        if (places.length === 0 && missing.length === 0) {
            box.innerHTML = `<span class="map-status-text">${strings.map.noPlaces}</span>`;
            box.style.display = 'flex';
            return;
        }

        // The Places button stays even when everything is placed: a pin can be
        // in the wrong country, and that needs a way back.
        box.innerHTML = `
            <span class="map-status-text">${missing.length > 0
                ? strings.map.missing(places.length, missing.length)
                : strings.map.allPlaced(places.length)}</span>
            ${missing.length > 0
                ? `<button type="button" onclick="window.Strom.UI.startGeocoding()">${strings.map.lookUp(missing.length)}</button>`
                : ''}
            <button type="button" class="secondary" onclick="window.Strom.UI.showPlacesManager()">${strings.map.managePlaces}</button>`;
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
                img.src = tileUrl(t);
                layer.appendChild(img);
                live.set(key, img);
            }
            img.style.left = `${t.left}px`;
            img.style.top = `${t.top}px`;
        }
        for (const [key, img] of live) {
            if (!seen.has(key)) {
                img.remove();
                live.delete(key);
            }
        }
    },

    drawMapMarkers(container: HTMLElement, places: MappedPlace[]): void {
        const layer = container.querySelector('.map-markers') as HTMLElement | null;
        if (!layer || !this.mapCenter) return;

        // Time mode draws its own markers (cumulative, year-aware) plus the
        // migration lines; the ordinary marker set is ignored while it is on.
        if (this.mapTimeOn) { this.drawMapTimeLayer(container); return; }
        const lines = container.querySelector('.map-lines') as SVGElement | null;
        if (lines) lines.innerHTML = '';

        const { width, height } = this.mapViewportSize(container);

        layer.innerHTML = places.map(p => {
            const at = pointInViewport(p.geo, this.mapCenter!, this.mapZoom, width, height);
            // Skip what is far off-screen; keeps big trees light while panning.
            if (at.x < -200 || at.y < -200 || at.x > width + 200 || at.y > height + 200) return '';
            return `
                <button type="button" class="map-marker" data-key="${this.escapeHtml(p.key)}"
                        style="left:${Math.round(at.x)}px; top:${Math.round(at.y)}px;">
                    <span class="map-marker-dot">${p.usage.personIds.length}</span>
                    <span class="map-marker-label">${this.escapeHtml(p.usage.display)}</span>
                </button>`;
        }).join('');
    },

    // ==================== MIGRATION OVER TIME (P5) ====================

    /** The dated harvest for the map's current scope (view / whole tree). */
    mapTimeHarvest(): DatedPlaceHarvest {
        const data = DataManager.getData();
        const filter: ReadonlySet<PersonId> | undefined =
            this.mapScope === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();
        return collectDatedPlacePoints(data, filter);
    },

    /**
     * The dated points that actually have a pin, grouped per place and joined to
     * their coordinates and display name. Places with no coordinates are dropped
     * (nothing to draw) — matching the ordinary marker rule.
     */
    mapTimePlacesData(): { key: string; geo: PlaceGeo; display: string; points: { year: number; personId: PersonId }[] }[] {
        const geoByKey = new Map(this.mapPlaces().map(m => [m.key, m]));
        const byKey = new Map<string, { key: string; geo: PlaceGeo; display: string; points: { year: number; personId: PersonId }[] }>();
        for (const pt of this.mapTimeHarvest().points) {
            const base = geoByKey.get(pt.placeKey);
            if (!base) continue;
            let tp = byKey.get(pt.placeKey);
            if (!tp) {
                tp = { key: pt.placeKey, geo: base.geo, display: base.usage.display, points: [] };
                byKey.set(pt.placeKey, tp);
            }
            tp.points.push({ year: pt.year, personId: pt.personId });
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
        const data = DataManager.getData();
        const places = data.places ?? {};
        const filter: ReadonlySet<PersonId> | undefined =
            this.mapScope === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();
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
        const { width, height } = this.mapViewportSize(container);
        const year = this.mapTimeYear;

        markers.innerHTML = this.mapTimePlacesData().map(tp => {
            const upto = tp.points.filter(p => p.year <= year);
            if (upto.length === 0) return '';
            const persons = new Set(upto.map(p => p.personId)).size;
            // "Fresh" = something happened here within the last ten years (Y−10, Y].
            const fresh = upto.some(p => p.year > year - 10);
            const at = pointInViewport(tp.geo, this.mapCenter!, this.mapZoom, width, height);
            if (at.x < -200 || at.y < -200 || at.x > width + 200 || at.y > height + 200) return '';
            return `
                <button type="button" class="map-marker${fresh ? ' map-marker-fresh' : ''}" data-key="${this.escapeHtml(tp.key)}"
                        style="left:${Math.round(at.x)}px; top:${Math.round(at.y)}px;">
                    <span class="map-marker-dot">${persons}</span>
                    <span class="map-marker-label">${this.escapeHtml(tp.display)}</span>
                </button>`;
        }).join('');

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

        const bar = document.getElementById('map-timebar');
        if (bar) bar.hidden = !this.mapTimeOn;
        if (!this.mapTimeOn || !hasData) return;

        const range = document.querySelector('.map-time-range') as HTMLInputElement | null;
        if (range) {
            range.min = String(harvest.minYear);
            range.max = String(harvest.maxYear);
            // Keep the slider inside the (possibly re-scoped) range.
            this.mapTimeYear = Math.min(harvest.maxYear!, Math.max(harvest.minYear!, this.mapTimeYear));
            range.value = String(this.mapTimeYear);
        }
        this.updateMapTimeLabel();
        this.updateMapTimePlayIcon();
    },

    updateMapTimeLabel(): void {
        const label = document.querySelector('.map-time-year') as HTMLElement | null;
        if (label) label.textContent = String(this.mapTimeYear);
    },

    updateMapTimePlayIcon(): void {
        const play = document.querySelector('.map-time-play') as HTMLButtonElement | null;
        if (!play) return;
        play.textContent = this.mapTimePlaying ? '⏸' : '⏵';
        const label = this.mapTimePlaying ? strings.map.timePause : strings.map.timePlay;
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
            this.mapTimeYear = Number(range.value);
            this.updateMapTimeLabel();
            redraw();   // rAF-throttled, same as panning
        });
        const play = container.querySelector('.map-time-play') as HTMLButtonElement | null;
        play?.addEventListener('click', () => this.toggleMapTimePlay());
    },

    /** ⏱ toggle: reveal the timebar starting at the earliest year, or hide it. */
    toggleMapTime(): void {
        const harvest = this.mapTimeHarvest();
        if (harvest.minYear === null) return;   // nothing dated (button is disabled)
        if (!this.mapTimeOn) {
            this.mapTimeYear = harvest.minYear;   // begin at the beginning of the story
        }
        this.setMapTimeOn(!this.mapTimeOn);
    },

    /** Turn the mode on/off, tidying playback and redrawing the map. */
    setMapTimeOn(on: boolean): void {
        this.mapTimeOn = on;
        if (!on) this.stopMapTimePlay();
        this.closeMapPopup();
        const container = document.getElementById('map-container');
        this.renderMapTimeControls();
        if (container) this.drawMapMarkers(container, this.mapPlaces());
        this.renderMapStatus(this.mapPlaces());
    },

    /** ⏵/⏸: step the year forward once every ~120ms until the last year. */
    toggleMapTimePlay(): void {
        if (this.mapTimePlaying) { this.stopMapTimePlay(); return; }
        if (!this.mapTimeOn) return;
        const harvest = this.mapTimeHarvest();
        if (harvest.maxYear === null || harvest.minYear === null) return;
        // Reaching the end and pressing play again replays from the start.
        if (this.mapTimeYear >= harvest.maxYear) this.mapTimeYear = harvest.minYear;
        this.mapTimePlaying = true;
        this.updateMapTimePlayIcon();
        this.mapTimeTimer = window.setInterval(() => {
            const h = this.mapTimeHarvest();
            const el = document.getElementById('map-container');
            // Stop when the map is left, the mode is off, or the data is gone.
            if (!this.mapTimeOn || !el || el.style.display === 'none' || h.maxYear === null) {
                this.stopMapTimePlay();
                return;
            }
            if (this.mapTimeYear >= h.maxYear) { this.stopMapTimePlay(); return; }
            this.mapTimeYear++;
            this.syncMapTimeControls();
            this.drawMapMarkers(el, []);
        }, 120);
    },

    stopMapTimePlay(): void {
        if (this.mapTimeTimer !== null) {
            clearInterval(this.mapTimeTimer);
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

    /** Who is connected to a place — the panel shown when a marker is clicked. */
    showMapPlace(key: string): void {
        const place = this.mapPlaces().find(p => p.key === key);
        const popup = document.querySelector('.map-popup') as HTMLElement | null;
        if (!place || !popup) return;

        const people = place.usage.personIds
            .map(id => DataManager.getPerson(id))
            .filter((p): p is NonNullable<typeof p> => !!p)
            .map(p => `
                <button type="button" class="map-popup-person" data-person-id="${p.id}">
                    ${this.escapeHtml(`${p.firstName} ${p.lastName}`.trim() || '?')}
                </button>`)
            .join('');

        popup.innerHTML = `
            <div class="map-popup-head">
                <strong>${this.escapeHtml(place.usage.display)}</strong>
                <button type="button" class="map-popup-close" aria-label="${strings.buttons.close}">×</button>
            </div>
            ${place.geo.label ? `<div class="map-popup-label">${this.escapeHtml(place.geo.label)}</div>` : ''}
            <div class="map-popup-people">${people}</div>
            <button type="button" class="map-popup-fix" data-key="${this.escapeHtml(place.key)}">
                ${strings.map.wrongSpot}
            </button>`;
        popup.style.display = 'block';
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
            const person = target.closest('.map-popup-person') as HTMLElement | null;
            if (person?.dataset.personId) { this.focusFromMap(person.dataset.personId); return; }
            const fix = target.closest('.map-popup-fix') as HTMLElement | null;
            if (fix) this.showPlacesManager(fix.dataset.key);
        });
    },

    closeMapPopup(): void {
        const popup = document.querySelector('.map-popup') as HTMLElement | null;
        if (popup) popup.style.display = 'none';
    },

    /** Clicking a person on the map takes you to them in the family view. */
    focusFromMap(personId: string): void {
        this.closeMapPopup();
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

    fitMapToPlaces(): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        const places = this.mapPlaces();
        if (places.length === 0) return;
        const { width, height } = this.mapViewportSize(container);
        const fit = fitBounds(places.map(p => p.geo), width, height);
        this.mapCenter = fit.center;
        this.mapZoom = fit.zoom;
        this.drawMapTiles(container);
        this.drawMapMarkers(container, places);
    },

    zoomMap(delta: number): void {
        const container = document.getElementById('map-container');
        if (!container || !this.mapCenter) return;
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
            if ((e.target as HTMLElement).closest('.map-marker, .map-popup, .map-controls, .map-scope, .map-status, .map-timebar, .map-tiles-notice')) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
            e.preventDefault();
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

        const results = await geocodePlaces(names, {
            signal: controller.signal,
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
            if (key && geo) found.set(key, geo);
        }
        if (found.size > 0) DataManager.setPlaceGeos(found);

        const notFound = results.size - found.size;
        this.showToast(notFound > 0
            ? strings.map.doneWithMisses(found.size, notFound)
            : strings.map.done(found.size));

        this.mapCenter = null;  // reframe now that there is more to show
        TreeRenderer.render();
    },

    // ==================== PLACES MANAGER ====================

    /**
     * One home for everything about a place: what it is called, who it belongs
     * to, and where it sits on the map.
     *
     * It exists because both halves can go wrong and neither could be fixed:
     *   - a place the geocoder cannot find ("Kravaře u Č. Lípy" — a spelling
     *     only the family uses) had no way to get onto the map at all,
     *   - a place matched to the WRONG spot (a same-named town elsewhere) fell
     *     out of the "missing" list and became unreachable.
     *
     * Searching and renaming are kept apart on purpose. The search query is
     * throwaway — type the nearest town, take the coordinates. The name is the
     * record, and renaming it rewrites every use in the tree.
     */
    placesForManager(scope: MapScope): { key: string; usage: PlaceUsage; geo?: PlaceGeo }[] {
        const data = DataManager.getData();
        const filter: ReadonlySet<PersonId> | undefined =
            scope === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();
        return [...collectPlaces(data, filter)]
            .map(([key, usage]) => ({ key, usage, geo: data.places?.[key] }))
            // Unplaced first — those are the ones asking for attention.
            .sort((a, b) => Number(!!a.geo) - Number(!!b.geo)
                || b.usage.count - a.usage.count
                || a.usage.display.localeCompare(b.usage.display));
    },

    /**
     * @param focusKey scroll to this place and open its search straight away
     * @param parentDialogId dialog to return to on Escape/Close (tree manager)
     *
     * Opened from the map it follows the map's scope; opened from anywhere else
     * "this view" would mean nothing, so it covers the whole tree.
     */
    showPlacesManager(focusKey?: string, parentDialogId?: string): void {
        this.placesManagerScope = parentDialogId ? 'tree' : this.mapScope;
        this.placesManagerParent = parentDialogId ?? null;
        const places = this.placesForManager(this.placesManagerScope);
        if (places.length === 0) {
            this.showToast(strings.map.noPlacesAtAll);
            return;
        }
        // Coordinate entries no person/event/partnership refers to any more. They
        // never appear as rows (the list is built from used places), so the
        // footer action is the only handle on them.
        const orphanCount = orphanedPlaceKeys(DataManager.getData()).length;
        this.closeMapPopup();

        document.getElementById('places-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'places-modal';
        overlay.innerHTML = `
            <div class="modal places-modal">
                <div class="modal-header">
                    <h2>${strings.map.placesTitle}</h2>
                    <button class="close-btn" id="places-close-x">&times;</button>
                </div>
                <p class="places-intro">${strings.map.placesIntro}</p>
                <div class="places-list">
                    ${places.map(p => this.renderPlaceRow(p)).join('')}
                </div>
                <div class="modal-buttons places-footer">
                    <button type="button" class="secondary places-clean-orphans" id="places-clean-orphans"
                        ${orphanCount === 0 ? 'disabled' : ''}>${strings.map.cleanOrphans(orphanCount)}</button>
                    <button type="button" class="secondary" id="places-close">${strings.buttons.close}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = (): void => this.closePlacesManager();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#places-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#places-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#places-clean-orphans') as HTMLButtonElement).onclick = () => void this.cleanOrphanPlaces();
        overlay.querySelectorAll('.place-row').forEach(row => this.bindPlaceRow(row as HTMLElement));

        if (focusKey) {
            const row = overlay.querySelector(`.place-row[data-key="${CSS.escape(focusKey)}"]`) as HTMLElement | null;
            row?.scrollIntoView({ block: 'center' });
            (row?.querySelector('.place-change') as HTMLButtonElement | null)?.click();
        }

        // Same stack discipline as other child dialogs (see showAuditLog): the
        // parent hides while the manager is open and Escape/Close returns to it.
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('places-modal');
    },

    renderPlaceRow(p: { key: string; usage: PlaceUsage; geo?: PlaceGeo }): string {
        const pinned = p.geo
            ? `<div class="place-pin">
                   <span class="place-pin-label">📍 ${this.escapeHtml(p.geo.label ?? `${p.geo.lat.toFixed(3)}, ${p.geo.lon.toFixed(3)}`)}</span>
                   <button type="button" class="place-change secondary">${strings.map.changePin}</button>
                   <button type="button" class="place-remove secondary">${strings.map.removePin}</button>
               </div>`
            : `<div class="place-pin place-pin-none">
                   <span class="place-hint">${strings.map.notOnMap}</span>
                   <button type="button" class="place-change secondary">${strings.map.findOnMap}</button>
               </div>`;
        return `
            <div class="place-row${p.geo ? '' : ' place-row-unplaced'}" data-key="${this.escapeHtml(p.key)}">
                <div class="place-head">
                    <input type="text" class="place-name" value="${this.escapeHtml(p.usage.display)}"
                           aria-label="${strings.map.nameLabel}">
                    <button type="button" class="place-rename secondary" disabled>${strings.map.rename}</button>
                    <span class="place-count">${strings.map.usedBy(p.usage.personIds.length)}</span>
                </div>
                ${pinned}
                <div class="place-search" hidden>
                    <input type="text" class="place-query" value="${this.escapeHtml(p.usage.display)}"
                           aria-label="${strings.map.searchLabel}">
                    <button type="button" class="place-search-go">${strings.map.search}</button>
                </div>
                <div class="place-results"></div>
            </div>`;
    },

    bindPlaceRow(row: HTMLElement): void {
        const key = row.getAttribute('data-key') ?? '';
        const name = row.querySelector('.place-name') as HTMLInputElement;
        const renameBtn = row.querySelector('.place-rename') as HTMLButtonElement;
        const original = name.value;

        // Rename only lights up once the name actually differs — no accidental
        // tree-wide rewrite from clicking around.
        const sync = (): void => { renameBtn.disabled = name.value.trim() === original.trim() || !name.value.trim(); };
        name.oninput = sync;
        name.onkeydown = (e) => { if (e.key === 'Enter' && !renameBtn.disabled) { e.preventDefault(); renameBtn.click(); } };
        renameBtn.onclick = () => this.renamePlaceFromManager(key, name.value);

        const search = row.querySelector('.place-search') as HTMLElement;
        const query = row.querySelector('.place-query') as HTMLInputElement;
        const go = row.querySelector('.place-search-go') as HTMLButtonElement;
        const run = (): void => { void this.searchPlaceFromManager(key, query.value, row); };
        go.onclick = run;
        query.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };

        (row.querySelector('.place-change') as HTMLButtonElement).onclick = () => {
            search.hidden = false;
            query.focus();
            query.select();
        };
        const remove = row.querySelector('.place-remove') as HTMLButtonElement | null;
        if (remove) remove.onclick = () => this.removePlacePin(key);
    },

    closePlacesManager(): void {
        document.getElementById('places-modal')?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== 'places-modal');
        // Return to whoever opened the manager (tree manager), per stack rules.
        const parent = this.dialogStack[this.dialogStack.length - 1];
        if (parent) this.openDialogById(parent);
    },

    /** Redraw the dialog in place, keeping the map behind it in step. */
    refreshPlacesManager(focusKey?: string): void {
        this.mapCenter = null;  // what is on the map changed — reframe it
        TreeRenderer.render();
        if (document.getElementById('places-modal')) {
            this.showPlacesManager(focusKey, this.placesManagerParent ?? undefined);
        }
    },

    renamePlaceFromManager(key: string, newName: string): void {
        const changed = DataManager.renamePlaceTo(key, newName);
        if (changed === 0) return;
        this.showToast(strings.map.renamed(changed));
        this.refreshPlacesManager();
    },

    removePlacePin(key: string): void {
        DataManager.clearPlaceGeo(key);
        this.refreshPlacesManager();
    },

    /** Sweep coordinate entries nothing in the tree points at any more. Confirms
     *  with the count, then deletes via the normal mutation path (undo + audit
     *  + Undo toast) and redraws the manager. */
    async cleanOrphanPlaces(): Promise<void> {
        const count = orphanedPlaceKeys(DataManager.getData()).length;
        if (count === 0) return;
        if (!await this.showConfirm(strings.map.cleanOrphansConfirm(count))) return;
        const removed = DataManager.clearOrphanPlaces();
        if (removed > 0) this.showToast(strings.map.cleanOrphansDone(removed));
        this.refreshPlacesManager();
    },

    /** Search under whatever name the user typed and offer what comes back. */
    async searchPlaceFromManager(key: string, query: string, row: HTMLElement): Promise<void> {
        const results = row.querySelector('.place-results') as HTMLElement;
        const text = query.trim();
        if (!text || this.placeSearchBusy) return;
        // The typed name goes out too, so the same consent rule applies.
        if (!await this.confirmGeocoding(1)) return;

        results.innerHTML = `<span class="place-hint">${strings.map.searching}</span>`;
        this.placeSearchBusy = true;
        let candidates;
        try {
            candidates = await geocodeCandidates(text);
        } finally {
            this.placeSearchBusy = false;
        }
        if (candidates.length === 0) {
            results.innerHTML = `<span class="place-hint">${strings.map.noCandidates}</span>`;
            return;
        }

        results.innerHTML = candidates.map((c, i) => `
            <button type="button" class="place-candidate" data-index="${i}">
                ${this.escapeHtml(c.label ?? `${c.lat}, ${c.lon}`)}
            </button>`).join('');
        results.querySelectorAll('.place-candidate').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => {
                const geo = candidates[Number(btn.getAttribute('data-index'))];
                DataManager.setPlaceGeos(new Map([[key, geo]]));
                this.showToast(strings.map.matched(geo.label ?? ''));
                this.refreshPlacesManager();
            };
        });
    },

    cancelGeocoding(): void {
        this.mapGeocodeAbort?.abort();
        this.mapGeocodeAbort = null;
        this.mapGeocoding = null;
        TreeRenderer.render();
    },
});

