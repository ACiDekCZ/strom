/**
 * The map's scope (spec 098 §3, §4, §7, §10, §11d): the map's part of the
 * scope's switch "This view / Selection ▾ / Whole tree" (src/ui/scope-seg-ui.ts:
 * the segment, the phone's button with its sheet, the memory per tree, the
 * selection's changes followed), the empty states of a selection, what the
 * map says of people outside the selection (a place's bubble, the toolbar's
 * search) and the selection highlighted with This view or the Whole tree.
 *
 * The people of a scope come from src/view-scope.ts (scopePersonIds); the
 * map draws them in src/ui/map-ui.ts (mapScopePersons).
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import type { Person, PersonId } from '../types.js';
import { MAP_KINDS, mapPointPersonIds, personHasMapPlace } from '../places.js';
import type { ViewScope as MapScope } from '../view-scope.js';
import { encodeSelectionRef, type SelectionRef } from '../view-selection-ref.js';
import { showOnMapForward } from '../windows/window-show-on-map.js';
import { canvasBusy } from './canvas-busy.js';
import { uiModule } from './module.js';
import { realSelectionIds, type ScopeSegHost } from './scope-seg-ui.js';
import { getSelection, selectionIds, selectionText, setSelection, type SelectionChange } from './view-selection-ui.js';

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** What an empty map of the selection says (§4, 4f, 4g). */
export type MapSelEmpty = { kind: 'empty' } | { kind: 'noPlaces'; unplaced: number };

export const mapScopeMethods = uiModule({
    /** The map's part of the scope's switch (src/ui/scope-seg-ui.ts). */
    mapScopeHost(): ScopeSegHost {
        return {
            root: () => document.querySelector<HTMLElement>('#map-container .map-topleft'),
            popoverParent: () => document.getElementById('map-container'),
            apply: (scope, opts) => this.applyMapScope(scope, opts),
            beforePicker: () => this.closeMapPopup(),
            // The switch steps aside for the ancestors' path except with the scope Selection (the path then keeps to it).
            hidden: () => this.mapPathOn() && this.mapScope !== 'sel',
            selectionChanged: (change, before) => this.mapSelectionChanged(change, before),
        };
    },

    /** The tree's remembered map scope (§7), read once per tree. */
    syncMapScopeTree(): void {
        this.syncViewScopeTree('map');
    },

    /** The open tree's scope as the map would take it now (nothing changed here): what a new window takes over (§7). */
    mapScopeNow(): MapScope {
        return this.viewScopeNow('map');
    },

    /** A satellite takes the main window's scope over (nothing stored): the tree's memory is not read after it. */
    applyMapScopeFromWindow(scope: MapScope): void {
        this.applyViewScopeFromWindow('map', scope);
    },

    /** The scope now, remembered for the tree by the main window ('view' is the default: nothing stored). */
    rememberMapScope(scope: MapScope): void {
        this.rememberViewScope('map', scope);
    },

    /**
     * Choose the map's scope: the places computed anew under the canvas
     * overlay, the map framed anew (`keepView`: where it stands). 'sel'
     * without a selection opens the choice of one instead.
     */
    setMapScope(scope: MapScope, opts: { keepView?: boolean } = {}): Promise<void> {
        return this.setViewScope('map', scope, opts);
    },

    /** A scope chosen for the map (setViewScope): remembered, the places computed anew. */
    applyMapScope(scope: MapScope, opts: { keepView?: boolean }): Promise<void> {
        this.rememberMapScope(scope);
        this.closeMapPopup();
        this.closeScopePicker(false);
        if (!opts.keepView) this.mapCenter = null;  // reframe for the new set of places
        // B166, §8: the choice at once, the places computed anew under the canvas overlay ("Calculating the map…").
        this.renderMapScope();
        return canvasBusy(() => TreeRenderer.renderAsync(), { label: strings.busy.mapCalc }).then(() => undefined);
    },

    /** The map's switch as it is (renderScopeSeg). */
    renderMapScope(): void {
        this.renderScopeSeg('map');
    },

    /**
     * The people the map highlights (§11d): the window's selection while the
     * map shows This view or the Whole tree (also under the ancestors' path);
     * null with the scope Selection or no selection.
     */
    mapHighlightIds(): ReadonlySet<PersonId> | null {
        return this.scopeHighlight('map', this.mapEffectiveScope());
    },

    /**
     * The map's scope in the Places dialog opened from the map: the same
     * parts as over the map, the one it lists chosen (aria-pressed); the
     * Selection part only while the window has a selection (the dialog has
     * no choice of one). A part sets the map's scope and lists its places.
     */
    placesScopeHtml(): string {
        const s = strings.scope;
        const scope = this.placesManagerScope;
        const ref = getSelection().ref;
        const part = (s: MapScope, inner: string, label?: string): string =>
            `<button type="button" class="sel-opt${scope === s ? ' active' : ''}" data-sel-form="seg" data-places-scope="${s}" aria-pressed="${scope === s}"`
            + `${label ? ` aria-label="${esc(label)}" title="${esc(label)}"` : ''}>${inner}</button>`;
        let sel = '';
        if (ref) {
            const label = selectionText(ref);
            const n = realSelectionIds().length;
            sel = part('sel', `<b class="scope-name map-scope-name">${esc(label)}</b><span class="scope-n map-scope-n">· ${n}</span>`, s.aria(label, n));
        }
        return `<div class="places-scope sel-seg" role="group" aria-label="${esc(s.sheetSec.map)}">`
            + part('view', esc(s.view)) + sel + part('tree', esc(s.tree)) + '</div>';
    },

    /** The Places dialog's scope parts (placesScopeHtml). */
    bindPlacesScope(root: HTMLElement): void {
        root.querySelector('.places-scope')?.addEventListener('click', (e) => {
            const part = (e.target as HTMLElement).closest<HTMLElement>('[data-places-scope]');
            const scope = part?.dataset.placesScope;
            if (scope === 'view' || scope === 'sel' || scope === 'tree') void this.setPlacesScope(scope);
        });
    },

    /**
     * A scope chosen in the Places dialog: the map's scope (the map behind it
     * drawn anew where it stands) and the dialog's list (its search and chip
     * kept). A scope without a place keeps both as they are, with a toast.
     */
    async setPlacesScope(scope: MapScope): Promise<void> {
        if (scope === this.placesManagerScope) return;
        if (scope === 'sel' && !getSelection().ref) return;
        if (this.placesForManager(scope).length === 0) { this.showToast(strings.map.noPlacesAtAll); return; }
        await this.setMapScope(scope, { keepView: true });
        this.showPlacesManager(undefined, this.placesManagerParent ?? undefined, scope, { keepFilter: true });
        document.querySelector<HTMLElement>(`#places-modal [data-places-scope="${scope}"]`)?.focus();
    },

    /** The map's Selection part: a click, and ↓ for the choice. */
    bindMapScope(container: HTMLElement): void {
        const root = container.querySelector<HTMLElement>('.map-topleft');
        if (root) this.bindScopeSeg('map', root);
    },

    mapScopePickerOpen(): boolean {
        return this.scopePickerOpen('map');
    },

    /** The choice of the window's selection under the map's Selection part (a phone: the sheet). */
    openMapScopePicker(): void {
        this.openScopePicker('map');
    },

    /** Close the choice; `refocus`: back to the Selection part. */
    closeMapScopePicker(refocus: boolean): void {
        this.closeScopePicker(refocus);
    },

    /** The phone's sheet "Scope" of the map (§10, 10e). */
    showMapScopeSheet(): void {
        this.showScopeSheet('map');
    },

    /**
     * The window's selection changed and the map's scope followed it
     * (scopeSelectionChanged; `before`: the scope before). The open map
     * follows: framed anew when its people changed; with This view or the
     * Whole tree the highlight of the selection drawn anew where it stands (§11d).
     */
    mapSelectionChanged(change: SelectionChange, before: MapScope): void {
        if (TreeRenderer.getViewMode() !== 'map' || !document.querySelector('#map-container .map-canvas')) return;
        if (change.reason === 'hideOthers') { this.renderMapScope(); return; }
        this.closeMapPopup();
        if (this.mapScope !== before || this.mapScope === 'sel') this.mapCenter = null;
        void TreeRenderer.renderAsync();
    },

    /** The selection's people (the path's choice with the scope Selection). */
    mapScopeSelectionPersons(): Person[] {
        const data = DataManager.getData();
        return realSelectionIds().map(id => data.persons[id]).filter((p): p is Person => !!p);
    },

    // ------------------------------------------------------------ outside the selection, empty

    /** People at a map point outside the selection (the whole tree's point, the kinds on). */
    mapPointOutsideCount(key: string): number {
        const ids = selectionIds();
        if (!ids) return 0;
        const point = this.mapPoints(this.mapPlacesFor(undefined)).find(p => p.key === key);
        if (!point) return 0;
        let n = 0;
        for (const id of mapPointPersonIds(point)) if (!ids.has(id)) n++;
        return n;
    },

    /** The toolbar search's row on the map with the scope Selection: a person outside it, with the way to the whole tree. */
    mapSearchNote(id: PersonId): { tag: string; action: { label: string; run: (id: PersonId) => void } } | null {
        if (TreeRenderer.getViewMode() !== 'map' || this.mapEffectiveScope() !== 'sel') return null;
        if (selectionIds()?.has(id)) return null;
        return {
            tag: strings.map.outside,
            action: {
                label: strings.map.showInTree,
                run: (pid) => { void this.setMapScope('tree', { keepView: true }).then(() => this.revealMapPerson(pid)); },
            },
        };
    },

    /** The selection's people without any place (every kind of the map, spec 098 §5; the Table's "No place" chip agrees). */
    mapSelUnplacedIds(): PersonId[] {
        const data = DataManager.getData();
        return realSelectionIds().filter(id => !personHasMapPlace(data.persons[id], data));
    },

    /**
     * The map of the selection with nothing to show (§4): nobody in the
     * selection, or nobody of it with a place (all kinds on, nothing to look
     * up either). Null otherwise.
     */
    mapSelEmptyState(placesShown: number): MapSelEmpty | null {
        if (this.mapEffectiveScope() !== 'sel') return null;
        if (realSelectionIds().length === 0) return { kind: 'empty' };
        if (placesShown > 0 || this.mapKinds().size < MAP_KINDS.length) return null;
        if (this.mapMissingPlaces().length > 0) return null;
        return { kind: 'noPlaces', unplaced: this.mapSelUnplacedIds().length };
    },

    /** The quiet sentence in the middle of the map (no frame), or none. */
    renderMapEmpty(state: MapSelEmpty | null): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        container.querySelector('.map-empty')?.remove();
        if (!state) return;
        const m = strings.map;
        const el = document.createElement('div');
        el.className = 'map-empty';
        el.setAttribute('role', 'status');
        el.innerHTML = state.kind === 'empty'
            ? `<span class="map-empty-t">${esc(m.selEmpty)}</span>`
            : `<span class="map-empty-t">${esc(m.selNoPlaces)}</span>`
                + (state.unplaced > 0
                    ? ` <button type="button" class="map-link map-empty-link" onclick="window.Strom.UI.openMapSelUnplaced()">${esc(m.selUnplacedLink(state.unplaced))}</button>` : '');
        container.appendChild(el);
    },

    /**
     * The selection's people without a place (§5, 4g's link and the status
     * bar's line): the Table in the selection's scope with "No place".
     */
    openMapSelUnplaced(): void {
        this.openTableForSelection({ filter: 'noPlace' });
    },

    /**
     * "On the map" (§6: a list in the Lists of people, the Table's list or
     * selection scope): the window's selection, the Map in the scope
     * Selection, framed anew. A satellite hands it to the main window.
     */
    showSelectionOnMap(ref: SelectionRef): void {
        const forward = showOnMapForward();
        if (forward) {
            if (forward.mainOpen()) forward.send(encodeSelectionRef(ref));
            return;
        }
        setSelection(ref, 'list');
        if (!getSelection().ref) return;
        this.syncMapScopeTree();
        if (this.mapScope !== 'sel') this.rememberMapScope('sel');
        this.closeMapPopup();
        this.closeScopePicker(false);
        this.mapCenter = null;  // framed anew for the selection's places
        if (TreeRenderer.getViewMode() !== 'map') { this.setDisplayViewMode('map'); return; }
        this.renderMapScope();
        void canvasBusy(() => TreeRenderer.renderAsync(), { label: strings.busy.mapCalc });
    },

    /** Whether "On the map" works now: a satellite needs its main window (`why`: the tooltip). */
    showOnMapState(): { disabled: boolean; why?: string } {
        const forward = showOnMapForward();
        if (forward && !forward.mainOpen()) return { disabled: true, why: strings.table.onMapNoMain };
        return { disabled: false };
    },
});
