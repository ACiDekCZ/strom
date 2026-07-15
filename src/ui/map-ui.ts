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
import { collectPlaces, PlaceUsage } from '../places.js';
import {
    fitBounds, panCenter, pointInViewport, tileUrl, tilesForViewport, zoomAround,
    TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL,
} from '../map.js';
import { GEOCODER_NAME, geocodePlaces } from '../geocode.js';
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
                </div>
                <div class="map-scope">
                    <button type="button" id="map-scope-view" onclick="window.Strom.UI.setMapScope('view')">${strings.map.scopeView}</button>
                    <button type="button" id="map-scope-tree" onclick="window.Strom.UI.setMapScope('tree')">${strings.map.scopeTree}</button>
                </div>
                <div class="map-status" id="map-status"></div>
                <a class="map-attribution" href="${TILE_ATTRIBUTION_URL}" target="_blank" rel="noopener noreferrer">${TILE_ATTRIBUTION}</a>`;
            this.bindMapGestures(container);
        }

        document.getElementById('map-scope-view')?.classList.toggle('active', this.mapScope !== 'tree');
        document.getElementById('map-scope-tree')?.classList.toggle('active', this.mapScope === 'tree');

        const places = this.mapPlaces();
        // First open (or a scope with nothing framed yet): frame what we have.
        if (!this.mapCenter && places.length > 0) this.fitMapToPlaces();
        if (!this.mapCenter) this.mapCenter = { lat: 50, lon: 15 };

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
        // canvas and letting the user wonder what broke.
        if (!navigator.onLine) {
            box.innerHTML = `<span class="map-status-text">${strings.map.offline}</span>`;
            box.style.display = 'flex';
            return;
        }

        const missing = this.mapMissingPlaces();
        if (places.length === 0 && missing.length === 0) {
            box.innerHTML = `<span class="map-status-text">${strings.map.noPlaces}</span>`;
            box.style.display = 'flex';
            return;
        }
        if (missing.length === 0) {
            box.style.display = 'none';
            return;
        }

        box.innerHTML = `
            <span class="map-status-text">${strings.map.missing(places.length, missing.length)}</span>
            <button type="button" onclick="window.Strom.UI.startGeocoding()">${strings.map.lookUp(missing.length)}</button>`;
        box.style.display = 'flex';
    },

    drawMapTiles(container: HTMLElement): void {
        const layer = container.querySelector('.map-tiles') as HTMLElement | null;
        if (!layer || !this.mapCenter) return;
        const { width, height } = this.mapViewportSize(container);

        // Rebuilt per draw; the browser serves already-seen tiles from its cache,
        // so panning does not re-download anything.
        layer.innerHTML = tilesForViewport(this.mapCenter, this.mapZoom, width, height)
            .map(t => `<img class="map-tile" src="${tileUrl(t)}" alt="" draggable="false" loading="lazy"
                        style="left:${t.left}px; top:${t.top}px;">`)
            .join('');
    },

    drawMapMarkers(container: HTMLElement, places: MappedPlace[]): void {
        const layer = container.querySelector('.map-markers') as HTMLElement | null;
        if (!layer || !this.mapCenter) return;
        const { width, height } = this.mapViewportSize(container);

        layer.innerHTML = places.map(p => {
            const at = pointInViewport(p.geo, this.mapCenter!, this.mapZoom, width, height);
            // Skip what is far off-screen; keeps big trees light while panning.
            if (at.x < -200 || at.y < -200 || at.x > width + 200 || at.y > height + 200) return '';
            return `
                <button type="button" class="map-marker" data-key="${this.escapeHtml(p.key)}"
                        style="left:${Math.round(at.x)}px; top:${Math.round(at.y)}px;"
                        onclick="window.Strom.UI.showMapPlace('${this.escapeHtml(p.key)}')">
                    <span class="map-marker-dot">${p.usage.personIds.length}</span>
                    <span class="map-marker-label">${this.escapeHtml(p.usage.display)}</span>
                </button>`;
        }).join('');
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
                <button type="button" class="map-popup-person" onclick="window.Strom.UI.focusFromMap('${p.id}')">
                    ${this.escapeHtml(`${p.firstName} ${p.lastName}`.trim() || '?')}
                </button>`)
            .join('');

        popup.innerHTML = `
            <div class="map-popup-head">
                <strong>${this.escapeHtml(place.usage.display)}</strong>
                <button type="button" class="map-popup-close" onclick="window.Strom.UI.closeMapPopup()" aria-label="close">×</button>
            </div>
            ${place.geo.label ? `<div class="map-popup-label">${this.escapeHtml(place.geo.label)}</div>` : ''}
            <div class="map-popup-people">${people}</div>`;
        popup.style.display = 'block';
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

    /** Drag to pan, wheel to zoom — what everyone expects from a map. */
    bindMapGestures(container: HTMLElement): void {
        let dragging = false;
        let lastX = 0;
        let lastY = 0;

        container.addEventListener('pointerdown', (e: PointerEvent) => {
            if ((e.target as HTMLElement).closest('.map-marker, .map-popup, .map-controls, .map-scope, .map-status')) return;
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            container.classList.add('map-dragging');
            container.setPointerCapture(e.pointerId);
        });
        container.addEventListener('pointermove', (e: PointerEvent) => {
            if (!dragging || !this.mapCenter) return;
            this.mapCenter = panCenter(this.mapCenter, this.mapZoom, e.clientX - lastX, e.clientY - lastY);
            lastX = e.clientX;
            lastY = e.clientY;
            this.drawMapTiles(container);
            this.drawMapMarkers(container, this.mapPlaces());
        });
        const endDrag = (e: PointerEvent): void => {
            if (!dragging) return;
            dragging = false;
            container.classList.remove('map-dragging');
            try { container.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        };
        container.addEventListener('pointerup', endDrag);
        container.addEventListener('pointercancel', endDrag);

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

    cancelGeocoding(): void {
        this.mapGeocodeAbort?.abort();
        this.mapGeocodeAbort = null;
        this.mapGeocoding = null;
        TreeRenderer.render();
    },
});

