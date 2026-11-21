/**
 * The map's scope (spec 098 §3, §4, §7, §10): "This view / Selection ▾ /
 * Whole tree" over the map, the phone's "Scope: … ▾" button with its sheet,
 * the scope remembered for the tree (the main window only), the selection's
 * changes followed (a selection cleared or gone takes the scope back to This
 * view), the empty states of a selection and what the map says of people
 * outside the selection (a place's bubble, the toolbar's search).
 *
 * The people of a scope come from src/map-scope.ts (mapScopePersonIds); the
 * map draws them in src/ui/map-ui.ts (mapScopePersons). The choice of a
 * selection is the one of src/ui/selection-picker-ui.ts, as a popover here.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { strings } from '../strings.js';
import type { Person, PersonId } from '../types.js';
import { MAP_KINDS, mapPointPersonIds, personHasMapPlace } from '../places.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import { mapScopeAfterSelection, mapScopeOnOpen, type MapScope } from '../map-scope.js';
import { getWindowRole } from '../windows/window-role.js';
import { decodeSelectionRef, encodeSelectionRef, type SelectionRef } from '../view-selection-ref.js';
import { showOnMapForward } from '../windows/window-show-on-map.js';
import { canvasBusy } from './canvas-busy.js';
import { uiModule } from './module.js';
import { selectionQuickRows } from './selection-picker-ui.js';
import { getSelection, selectionIds, selectionText, setSelection, type SelectionChange } from './view-selection-ui.js';

/** The tree whose remembered scope is in place (undefined: none read yet). */
let scopeTree: string | null | undefined;
/** The open popover of the choice (under the scope's Selection part). */
let picker: { host: HTMLElement; abort: AbortController } | null = null;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The selection's people that are real persons (a placeholder is nobody). */
function realSelectionIds(): PersonId[] {
    const data = DataManager.getData();
    return [...(selectionIds() ?? [])].filter(id => { const p = data.persons[id]; return !!p && !p.isPlaceholder; });
}

/** What an empty map of the selection says (§4, 4f, 4g). */
export type MapSelEmpty = { kind: 'empty' } | { kind: 'noPlaces'; unplaced: number };

export const mapScopeMethods = uiModule({
    /**
     * The tree's remembered scope (§7), read once per tree: 'sel' only while
     * the window has a selection (else This view, the memory kept).
     */
    syncMapScopeTree(): void {
        const tree = DataManager.getCurrentTreeId();
        if (tree === scopeTree) return;
        scopeTree = tree;
        this.mapScope = mapScopeOnOpen(SettingsManager.getMapScopeForTree(tree), !!getSelection().ref);
    },

    /** A satellite takes the main window's scope over (nothing stored): the tree's memory is not read after it. */
    applyMapScopeFromWindow(scope: MapScope): void {
        scopeTree = DataManager.getCurrentTreeId();
        this.mapScope = mapScopeOnOpen(scope, !!getSelection().ref);
    },

    /** The scope now, remembered for the tree by the main window ('view' is the default: nothing stored). */
    rememberMapScope(scope: MapScope): void {
        this.mapScope = scope;
        const tree = DataManager.getCurrentTreeId();
        scopeTree = tree;
        if (tree && getWindowRole() !== 'satellite') SettingsManager.setMapScopeForTree(tree, scope === 'view' ? null : scope);
    },

    /**
     * Choose the map's scope: the places computed anew under the canvas
     * overlay, the map framed anew (`keepView`: where it stands). 'sel'
     * without a selection opens the choice of one instead.
     */
    setMapScope(scope: MapScope, opts: { keepView?: boolean } = {}): Promise<void> {
        this.syncMapScopeTree();
        if (scope === 'sel' && !getSelection().ref) { this.openMapScopePicker(); return Promise.resolve(); }
        if (this.mapScope === scope) return Promise.resolve();
        this.rememberMapScope(scope);
        this.closeMapPopup();
        this.closeMapScopePicker(false);
        if (!opts.keepView) this.mapCenter = null;  // reframe for the new set of places
        // B166, §8: the choice at once, the places computed anew under the canvas overlay ("Calculating the map…").
        this.renderMapScope();
        return canvasBusy(() => TreeRenderer.renderAsync(), { label: strings.busy.mapCalc }).then(() => undefined);
    },

    /**
     * The scope's controls as they are: the segment's chosen part, the
     * Selection part's name and count (or "Selection ▾"), the phone's button;
     * the segment steps aside for the ancestors' path except with the scope
     * Selection (the path then keeps to it).
     */
    renderMapScope(): void {
        const root = document.querySelector('#map-container .map-topleft');
        if (!root) return;
        const m = strings.map;
        const scope = this.mapScope;
        const ref = getSelection().ref;
        root.querySelector('#map-scope-view')?.classList.toggle('active', scope === 'view');
        root.querySelector('#map-scope-tree')?.classList.toggle('active', scope === 'tree');
        const sel = root.querySelector<HTMLButtonElement>('#map-scope-sel');
        const label = ref ? selectionText(ref) : '';
        const n = ref ? realSelectionIds().length : 0;
        if (sel) {
            sel.classList.toggle('active', scope === 'sel');
            sel.innerHTML = ref
                ? `<b class="map-scope-name">${esc(label)}</b><span class="map-scope-n">· ${n}</span><span class="map-scope-cv" aria-hidden="true">▾</span>`
                : `${esc(m.scopeSel)}<span class="map-scope-cv" aria-hidden="true">▾</span>`;
            const name = ref ? m.scopeAria(label, n) : m.scopeSel;
            sel.title = name;
            sel.setAttribute('aria-label', name);
            sel.setAttribute('aria-expanded', String(!!picker));
        }
        const btn = root.querySelector<HTMLElement>('.map-scope-btn');
        if (btn) {
            const what = scope === 'tree' ? m.scopeTree : scope === 'sel' && ref ? label : m.scopeView;
            const text = btn.querySelector('.map-scope-btn-label');
            if (text) text.innerHTML = `${esc(m.scopeBtn('')).trimEnd()} <b>${esc(what)}</b>`;
            btn.title = m.scopeBtn(what);
            btn.setAttribute('aria-label', m.scopeBtn(what));
        }
        const path = this.mapPathOn();
        const segment = root.querySelector<HTMLElement>('.map-scope');
        if (segment) segment.hidden = path && scope !== 'sel';
        if (btn) btn.hidden = path && scope !== 'sel';
    },

    /**
     * The map's scope in the Places dialog opened from the map: the same
     * parts as over the map, the one it lists chosen (aria-pressed); the
     * Selection part only while the window has a selection (the dialog has
     * no choice of one). A part sets the map's scope and lists its places.
     */
    placesScopeHtml(): string {
        const m = strings.map;
        const scope = this.placesManagerScope;
        const ref = getSelection().ref;
        const part = (s: MapScope, inner: string, label?: string): string =>
            `<button type="button" class="sel-opt${scope === s ? ' active' : ''}" data-sel-form="seg" data-places-scope="${s}" aria-pressed="${scope === s}"`
            + `${label ? ` aria-label="${esc(label)}" title="${esc(label)}"` : ''}>${inner}</button>`;
        let sel = '';
        if (ref) {
            const label = selectionText(ref);
            const n = realSelectionIds().length;
            sel = part('sel', `<b class="map-scope-name">${esc(label)}</b><span class="map-scope-n">· ${n}</span>`, m.scopeAria(label, n));
        }
        return `<div class="places-scope sel-seg" role="group" aria-label="${esc(m.scopeGroup)}">`
            + part('view', esc(m.scopeView)) + sel + part('tree', esc(m.scopeTree)) + '</div>';
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

    /** The Selection part: a click, and ↓ / Alt+↓ for the choice. */
    bindMapScope(container: HTMLElement): void {
        const sel = container.querySelector<HTMLButtonElement>('#map-scope-sel');
        sel?.addEventListener('click', () => this.mapScopeSelClick());
        sel?.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'ArrowDown') return;
            e.preventDefault();
            this.openMapScopePicker();
        });
    },

    /**
     * The Selection part (§3): not chosen with a selection → the scope
     * Selection at once; chosen, or no selection → the choice opens.
     */
    mapScopeSelClick(): void {
        if (picker) { this.closeMapScopePicker(true); return; }
        if (getSelection().ref && this.mapScope !== 'sel') { void this.setMapScope('sel'); return; }
        // After this click has gone by: the choice closes on a click outside it.
        setTimeout(() => this.openMapScopePicker(), 0);
    },

    mapScopePickerOpen(): boolean {
        return !!picker;
    },

    /**
     * The choice of the window's selection (§2) under the Selection part; a
     * phone (the sheet's "All selections…", or held sideways) gets the sheet.
     * A pick sets the window's selection and the scope Selection.
     */
    openMapScopePicker(): void {
        const container = document.getElementById('map-container');
        const anchor = container?.querySelector<HTMLElement>('#map-scope-sel');
        const onPicked = (s: string): void => { if (s !== 'none') void this.setMapScope('sel'); };
        if (!container || !anchor || anchor.getClientRects().length === 0
            || window.matchMedia(`${MQ_MOBILE}, ${MQ_PHONE_LANDSCAPE}`).matches) {
            this.showSelectionSheet(onPicked);
            return;
        }
        this.closeMapScopePicker(false);
        this.closeMapPopup();
        const host = document.createElement('div');
        host.className = 'map-scope-pick';
        container.appendChild(host);
        const abort = new AbortController();
        picker = { host, abort };
        const box = container.getBoundingClientRect();
        const r = anchor.getBoundingClientRect();
        host.style.left = `${Math.max(8, Math.min(r.left - box.left, box.width - 396))}px`;
        host.style.top = `${r.bottom - box.top}px`;
        host.style.setProperty('--map-scope-pick-room', `${Math.max(200, box.bottom - r.bottom - 24)}px`);
        this.mountSelectionPicker(host, {
            onPicked,
            onClose: () => {
                const at = document.activeElement;
                this.closeMapScopePicker(!at || at === document.body || host.contains(at));
            },
            signal: abort.signal,
        });
        anchor.setAttribute('aria-expanded', 'true');
    },

    /** Close the choice; `refocus`: back to the Selection part. */
    closeMapScopePicker(refocus: boolean): void {
        if (!picker) return;
        const { host, abort } = picker;
        picker = null;
        abort.abort();
        host.remove();
        const anchor = document.querySelector<HTMLElement>('#map-container #map-scope-sel');
        anchor?.setAttribute('aria-expanded', 'false');
        if (refocus) anchor?.focus();
    },

    /**
     * The phone's sheet "Scope" (§10, 10e): the three scopes with their
     * people, a few selections to change to and "All selections…".
     */
    showMapScopeSheet(): void {
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const m = strings.map;
        const ref = getSelection().ref;
        const data = DataManager.getData();
        const all = Object.values(data.persons).filter(p => p && !p.isPlaceholder).length;
        const scope = this.mapScope;
        const radio = (value: MapScope, name: string, hint: string, count: number | null): string => {
            const on = scope === value;
            return `<button type="button" class="map-scope-row sel-opt" data-sel-form="row" role="radio" aria-checked="${on}" data-scope="${value}">`
                + `<span class="map-scope-row-ic" aria-hidden="true">${on ? '●' : '○'}</span>`
                + `<span class="map-scope-row-n">${esc(name)}${hint ? `<small>${esc(hint)}</small>` : ''}</span>`
                + `<span class="map-scope-row-c">${count === null ? '' : count}</span></button>`;
        };
        const selName = ref ? `${m.scopeSel}: ${selectionText(ref)}` : `${m.scopeSel}…`;
        const quick = selectionQuickRows(5).map(r =>
            `<button type="button" class="map-scope-row sel-opt" data-sel-form="row" data-sel="${esc(r.sel)}">`
            + `<span class="map-scope-row-ic" aria-hidden="true">${r.icon}</span><span class="map-scope-row-n">${esc(r.label)}</span>`
            + `<span class="map-scope-row-c">${r.count}</span></button>`).join('');
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay map-scope-overlay';
        overlay.innerHTML = `<div class="bottom-sheet map-scope-sheet" role="dialog" aria-modal="true" aria-labelledby="map-scope-sheet-title">`
            + `<div class="bottom-sheet-handle"></div>`
            + `<div class="rod-pick-sheet-bar"><h2 class="rod-pick-sheet-title" id="map-scope-sheet-title">${esc(m.scopeSheet)}</h2>`
            + `<button type="button" class="rod-pick-sheet-x" aria-label="${esc(strings.buttons.close)}">×</button></div>`
            + `<div class="map-scope-sheet-sec" id="map-scope-sheet-sec">${esc(m.scopeSheetSec)}</div>`
            + `<div role="radiogroup" aria-labelledby="map-scope-sheet-sec">`
            + radio('view', m.scopeView, m.scopeViewHint, TreeRenderer.getVisiblePersonIds().size)
            + radio('sel', selName, '', ref ? realSelectionIds().length : null)
            + radio('tree', m.scopeTree, '', all)
            + `</div>`
            + `<div class="map-scope-sheet-sec" id="map-scope-sheet-change">${esc(m.scopeChange)}</div>`
            + `<div role="group" aria-labelledby="map-scope-sheet-change">${quick}`
            + `<button type="button" class="map-scope-row map-scope-all sel-opt" data-sel-form="row"><span class="map-scope-row-ic" aria-hidden="true"></span>`
            + `<span class="map-scope-row-n">${esc(m.scopeAll)}</span><span class="map-scope-row-c"></span></button></div>`
            + `</div>`;
        const close = (): void => { if (this.bottomSheet === overlay) this.hideBottomSheet(); };
        overlay.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            if (t === overlay || t.closest('.rod-pick-sheet-x')) { close(); return; }
            const row = t.closest<HTMLElement>('.map-scope-row');
            if (!row) return;
            if (row.classList.contains('map-scope-all')) {
                close();
                this.openMapScopePicker();
                return;
            }
            const s = row.dataset.scope as MapScope | undefined;
            if (s) {
                close();
                if (s === 'sel' && !ref) { this.openMapScopePicker(); return; }
                void this.setMapScope(s);
                return;
            }
            const next = row.dataset.sel ? decodeSelectionRef(row.dataset.sel) : null;
            if (next) {
                close();
                setSelection(next, 'map');
                void this.setMapScope('sel');
            }
        });
        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            overlay.querySelector<HTMLElement>('.rod-pick-sheet-x')?.focus({ preventScroll: true });
        });
    },

    /**
     * The window's selection changed (§3, §7): cleared or gone takes the
     * scope Selection back to This view; another tree reads its memory; a
     * selection put back from memory brings the remembered Selection back.
     * The open map follows (framed anew when its people changed).
     */
    mapSelectionChanged(change: SelectionChange): void {
        if (change.reason === 'tree') scopeTree = undefined;
        const before = this.mapScope;
        this.syncMapScopeTree();
        const has = !!getSelection().ref;
        if (change.reason === 'restore' && this.mapScope === 'view' && has
            && SettingsManager.getMapScopeForTree(DataManager.getCurrentTreeId()) === 'sel') {
            this.mapScope = 'sel';
        }
        const next = mapScopeAfterSelection(this.mapScope, change.reason, has);
        if (next !== this.mapScope) this.rememberMapScope(next);
        if (TreeRenderer.getViewMode() !== 'map' || !document.querySelector('#map-container .map-canvas')) return;
        if (change.reason === 'hideOthers') { this.renderMapScope(); return; }
        if (this.mapScope !== before || this.mapScope === 'sel') {
            this.closeMapPopup();
            this.mapCenter = null;
            void TreeRenderer.renderAsync();
            return;
        }
        this.renderMapScope();
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
        this.closeMapScopePicker(false);
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
