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
            this.bindMapClicks(container);
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
                        style="left:${Math.round(at.x)}px; top:${Math.round(at.y)}px;">
                    <span class="map-marker-dot">${p.usage.personIds.length}</span>
                    <span class="map-marker-label">${this.escapeHtml(p.usage.display)}</span>
                </button>`;
        }).join('');
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

    /** Drag to pan, wheel to zoom — what everyone expects from a map. */
    bindMapGestures(container: HTMLElement): void {
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        // Redraws rebuild the tile/marker HTML wholesale, so during a drag they
        // are coalesced to one per frame instead of one per pointer event.
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

        container.addEventListener('pointerdown', (e: PointerEvent) => {
            if ((e.target as HTMLElement).closest('.map-marker, .map-popup, .map-controls, .map-scope, .map-status, .map-tiles-notice')) return;
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
            queueRedraw();
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
                <div class="modal-buttons">
                    <button type="button" class="secondary" id="places-close">${strings.buttons.close}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = (): void => this.closePlacesManager();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#places-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#places-close-x') as HTMLButtonElement).onclick = close;
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

