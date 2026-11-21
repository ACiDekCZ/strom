/**
 * The scope's switch of the Map, the Timeline and the Table (spec 098 §3,
 * §7, §10, §11.0): "This view / Selection ▾ / Whole tree", on a phone one
 * button "Scope: … ▾" with its sheet; the Selection part with the
 * selection's name and count, the choice of a selection as a popover under
 * it; each view's scope remembered for the tree (the main window only) and
 * following the window's selection (a selection cleared or gone takes the
 * scope Selection back to the view's default).
 *
 * A view plugs in with a ScopeSegHost (where its switch stands, what a new
 * scope does to it); the map's host lives in src/ui/map-scope-ui.ts. The
 * people of a scope come from src/view-scope.ts.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { strings, countText } from '../strings.js';
import type { PersonId } from '../types.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import {
    SCOPED_VIEWS, scopeAfterSelection, scopeDefault, scopeHighlightIds, scopeOnOpen,
    type ScopedView, type ViewScope,
} from '../view-scope.js';
import { getWindowRole } from '../windows/window-role.js';
import { decodeSelectionRef } from '../view-selection-ref.js';
import { uiModule } from './module.js';
import { selectionQuickRows } from './selection-picker-ui.js';
import { getSelection, selectionIds, selectionText, setSelection, type SelectionChange } from './view-selection-ui.js';

/** What a view gives the switch. */
export interface ScopeSegHost {
    /** The element that holds the view's switch (the segment and the phone's button). */
    root(): HTMLElement | null;
    /** The positioned element the choice's popover opens in (the view's container). */
    popoverParent(): HTMLElement | null;
    /** A scope chosen (never 'sel' without a selection): the view's people computed anew. */
    apply(scope: ViewScope, opts: { keepView?: boolean }): Promise<void> | void;
    /** Before the choice opens (the map closes its bubble). */
    beforePicker?(): void;
    /** The switch steps aside now (the map's ancestors' path outside the scope Selection). */
    hidden?(): boolean;
    /** The people of "This view" in the phone's sheet (default: the people laid out in the tree view). */
    viewCount?(): number;
    /**
     * The window's selection changed, the view's scope already followed
     * (`before`: the scope before it): the open view draws itself anew.
     */
    selectionChanged?(change: SelectionChange, before: ViewScope): void;
}

/** The UI's field holding each view's scope now. */
const SCOPE_FIELD = { map: 'mapScope', timeline: 'timelineScope', table: 'tableScope' } as const;

/** The tree whose remembered scope is in place, per view (undefined: none read yet). */
const scopeTrees: Partial<Record<ScopedView, string | null>> = {};
/** The views' hosts (the map's comes from map-scope-ui on first use). */
const hosts: Partial<Record<ScopedView, ScopeSegHost>> = {};
/** The open popover of the choice (under a scope's Selection part). */
let picker: { view: ScopedView; host: HTMLElement; abort: AbortController } | null = null;

/** The popover's width (the toolbar's choice of a selection): it stays inside the view. */
const PICK_WIDTH = 396;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A class shared by every view's switch and its view's own ("scope-name map-scope-name"). */
function cls(view: ScopedView, name: string): string {
    return `scope-${name} ${view}-scope-${name}`;
}

/** A view plugs its switch in (the Timeline and the Table; the map's host is built on first use). */
export function registerScopeHost(view: ScopedView, host: ScopeSegHost): void {
    hosts[view] = host;
}

/** The selection's people that are real persons (a placeholder is nobody). */
export function realSelectionIds(): PersonId[] {
    const data = DataManager.getData();
    return [...(selectionIds() ?? [])].filter(id => { const p = data.persons[id]; return !!p && !p.isPlaceholder; });
}

export const scopeSegMethods = uiModule({
    /** The view's host (the map's built here on first use). */
    scopeHostOf(view: ScopedView): ScopeSegHost | null {
        if (!hosts[view] && view === 'map') hosts.map = this.mapScopeHost();
        return hosts[view] ?? null;
    },

    /** A view's scope now. */
    viewScope(view: ScopedView): ViewScope {
        return this[SCOPE_FIELD[view]];
    },

    /**
     * The tree's remembered scope of a view (§7), read once per tree: 'sel'
     * only while the window has a selection (else the view's default, the
     * memory kept).
     */
    syncViewScopeTree(view: ScopedView): void {
        const tree = DataManager.getCurrentTreeId();
        if (view in scopeTrees && tree === scopeTrees[view]) return;
        scopeTrees[view] = tree;
        this[SCOPE_FIELD[view]] = scopeOnOpen(SettingsManager.getScopeForTree(tree, view), !!getSelection().ref, view);
    },

    /** The open tree's scope of a view as it would be taken now (nothing changed here): what a new window takes over (§7). */
    viewScopeNow(view: ScopedView): ViewScope {
        const tree = DataManager.getCurrentTreeId();
        return view in scopeTrees && tree === scopeTrees[view]
            ? this.viewScope(view)
            : scopeOnOpen(SettingsManager.getScopeForTree(tree, view), !!getSelection().ref, view);
    },

    /** A satellite takes the main window's scope over (nothing stored): the tree's memory is not read after it. */
    applyViewScopeFromWindow(view: ScopedView, scope: ViewScope): void {
        scopeTrees[view] = DataManager.getCurrentTreeId();
        this[SCOPE_FIELD[view]] = scopeOnOpen(scope, !!getSelection().ref, view);
    },

    /** A view's scope now, remembered for the tree by the main window (the view's default: nothing stored). */
    rememberViewScope(view: ScopedView, scope: ViewScope): void {
        this[SCOPE_FIELD[view]] = scope;
        const tree = DataManager.getCurrentTreeId();
        scopeTrees[view] = tree;
        if (tree && getWindowRole() !== 'satellite') SettingsManager.setScopeForTree(tree, view, scope);
    },

    /**
     * Choose a view's scope: 'sel' without a selection opens the choice of
     * one instead; the same scope does nothing; else the view applies it.
     */
    setViewScope(view: ScopedView, scope: ViewScope, opts: { keepView?: boolean } = {}): Promise<void> {
        this.syncViewScopeTree(view);
        if (scope === 'sel' && !getSelection().ref) { this.openScopePicker(view); return Promise.resolve(); }
        if (this.viewScope(view) === scope) return Promise.resolve();
        const host = this.scopeHostOf(view);
        if (!host) { this.rememberViewScope(view, scope); return Promise.resolve(); }
        return Promise.resolve(host.apply(scope, opts));
    },

    /**
     * The people a view highlights now (§11.0, 11a·2, 11d·1): the selection's
     * with a scope other than Selection; null: none (the Table never).
     */
    scopeHighlight(view: ScopedView, scope?: ViewScope): ReadonlySet<PersonId> | null {
        return getSelection().ref ? scopeHighlightIds(view, scope ?? this.viewScope(view), () => selectionIds()) : null;
    },

    /**
     * The switch's markup: the segment (ids `<view>-scope-view|sel|tree`,
     * the Selection part filled by renderScopeSeg) and the phone's button.
     */
    scopeSegHtml(view: ScopedView): string {
        const s = strings.scope;
        const part = (scope: ViewScope, text: string): string =>
            `<button type="button" id="${view}-scope-${scope}" class="sel-opt" data-sel-form="seg" data-scope="${scope}"`
            + ` onclick="window.Strom.UI.setViewScope('${view}', '${scope}')">${esc(text)}</button>`;
        return `<div class="scope-seg ${view}-scope sel-seg" role="group" aria-label="${esc(s.sheetSec[view])}">`
            + part('view', s.view)
            + `<button type="button" id="${view}-scope-sel" class="sel-opt scope-sel-part" data-sel-form="seg" data-scope="sel" aria-haspopup="listbox" aria-expanded="false"></button>`
            + part('tree', s.tree)
            + `</div>`
            + `<button type="button" class="${cls(view, 'btn')}" aria-haspopup="dialog" onclick="window.Strom.UI.showScopeSheet('${view}')">`
            + `<span class="${cls(view, 'btn-label')}"></span><span class="${cls(view, 'btn-caret')}" aria-hidden="true">▾</span></button>`;
    },

    /** The switch's texts in the language now (a change of the UI language at run time). */
    retranslateScopeSeg(view: ScopedView): void {
        const root = this.scopeHostOf(view)?.root();
        if (!root) return;
        const s = strings.scope;
        const view_ = root.querySelector(`#${view}-scope-view`);
        if (view_) view_.textContent = s.view;
        const tree = root.querySelector(`#${view}-scope-tree`);
        if (tree) tree.textContent = s.tree;
        root.querySelector(`.${view}-scope.scope-seg`)?.setAttribute('aria-label', s.sheetSec[view]);
        this.renderScopeSeg(view);
    },

    /** The Selection part: a click, and ↓ / Alt+↓ for the choice. */
    bindScopeSeg(view: ScopedView, root: HTMLElement): void {
        const sel = root.querySelector<HTMLButtonElement>(`#${view}-scope-sel`);
        sel?.addEventListener('click', () => this.scopeSelClick(view));
        sel?.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'ArrowDown') return;
            e.preventDefault();
            this.openScopePicker(view);
        });
    },

    /**
     * The switch as it is: the segment's chosen part, the Selection part's
     * name and count (or "Selection ▾"), the phone's button; the switch steps
     * aside when its host says so.
     */
    renderScopeSeg(view: ScopedView): void {
        const host = this.scopeHostOf(view);
        const root = host?.root();
        if (!root) return;
        const s = strings.scope;
        const scope = this.viewScope(view);
        const ref = getSelection().ref;
        root.querySelector(`#${view}-scope-view`)?.classList.toggle('active', scope === 'view');
        root.querySelector(`#${view}-scope-tree`)?.classList.toggle('active', scope === 'tree');
        const sel = root.querySelector<HTMLButtonElement>(`#${view}-scope-sel`);
        const label = ref ? selectionText(ref) : '';
        const n = ref ? realSelectionIds().length : 0;
        if (sel) {
            sel.classList.toggle('active', scope === 'sel');
            sel.innerHTML = ref
                ? `<b class="${cls(view, 'name')}">${esc(label)}</b><span class="${cls(view, 'n')}">· ${n}</span><span class="${cls(view, 'cv')}" aria-hidden="true">▾</span>`
                : `${esc(s.sel)}<span class="${cls(view, 'cv')}" aria-hidden="true">▾</span>`;
            const name = ref ? s.aria(label, n) : s.sel;
            sel.title = name;
            sel.setAttribute('aria-label', name);
            sel.setAttribute('aria-expanded', String(picker?.view === view));
        }
        const btn = root.querySelector<HTMLElement>(`.${view}-scope-btn`);
        if (btn) {
            const what = scope === 'tree' ? s.tree : scope === 'sel' && ref ? label : s.view;
            const text = btn.querySelector(`.${view}-scope-btn-label`);
            if (text) text.innerHTML = `${esc(s.btn('')).trimEnd()} <b>${esc(what)}</b>`;
            btn.title = s.btn(what);
            btn.setAttribute('aria-label', s.btn(what));
        }
        const hidden = host?.hidden?.() ?? false;
        const segment = root.querySelector<HTMLElement>(`.${view}-scope.scope-seg`);
        if (segment) segment.hidden = hidden;
        if (btn) btn.hidden = hidden;
    },

    /**
     * The Selection part (§3): not chosen with a selection → the scope
     * Selection at once; chosen, or no selection → the choice opens.
     */
    scopeSelClick(view: ScopedView): void {
        if (picker?.view === view) { this.closeScopePicker(true); return; }
        if (getSelection().ref && this.viewScope(view) !== 'sel') { void this.setViewScope(view, 'sel'); return; }
        // After this click has gone by: the choice closes on a click outside it.
        setTimeout(() => this.openScopePicker(view), 0);
    },

    /** The choice is open (under a view's Selection part, or any). */
    scopePickerOpen(view?: ScopedView): boolean {
        return !!picker && (!view || picker.view === view);
    },

    /**
     * The choice of the window's selection (§2) under a view's Selection
     * part; a phone (the sheet's "All selections…", or held sideways) gets
     * the sheet. A pick sets the window's selection and the scope Selection.
     */
    openScopePicker(view: ScopedView): void {
        const host = this.scopeHostOf(view);
        const container = host?.popoverParent();
        const anchor = host?.root()?.querySelector<HTMLElement>(`#${view}-scope-sel`);
        const onPicked = (s: string): void => { if (s !== 'none') void this.setViewScope(view, 'sel'); };
        if (!container || !anchor || anchor.getClientRects().length === 0
            || window.matchMedia(`${MQ_MOBILE}, ${MQ_PHONE_LANDSCAPE}`).matches) {
            this.showSelectionSheet(onPicked);
            return;
        }
        this.closeScopePicker(false);
        host?.beforePicker?.();
        const pop = document.createElement('div');
        pop.className = cls(view, 'pick');
        container.appendChild(pop);
        const abort = new AbortController();
        picker = { view, host: pop, abort };
        const box = container.getBoundingClientRect();
        const r = anchor.getBoundingClientRect();
        pop.style.left = `${Math.max(8, Math.min(r.left - box.left, box.width - PICK_WIDTH))}px`;
        pop.style.top = `${r.bottom - box.top}px`;
        pop.style.setProperty('--scope-pick-room', `${Math.max(200, box.bottom - r.bottom - 24)}px`);
        this.mountSelectionPicker(pop, {
            onPicked,
            onClose: () => {
                const at = document.activeElement;
                this.closeScopePicker(!at || at === document.body || pop.contains(at));
            },
            signal: abort.signal,
        });
        anchor.setAttribute('aria-expanded', 'true');
    },

    /** Close the choice; `refocus`: back to the Selection part. */
    closeScopePicker(refocus: boolean): void {
        if (!picker) return;
        const { view, host, abort } = picker;
        picker = null;
        abort.abort();
        host.remove();
        const anchor = this.scopeHostOf(view)?.root()?.querySelector<HTMLElement>(`#${view}-scope-sel`);
        anchor?.setAttribute('aria-expanded', 'false');
        if (refocus) anchor?.focus();
    },

    /**
     * The phone's sheet "Scope" (§10, 10e): the view's three scopes with
     * their people, a few selections to change to and "All selections…".
     */
    showScopeSheet(view: ScopedView): void {
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const s = strings.scope;
        const host = this.scopeHostOf(view);
        const ref = getSelection().ref;
        const data = DataManager.getData();
        const all = Object.values(data.persons).filter(p => p && !p.isPlaceholder).length;
        const scope = this.viewScope(view);
        const row = (attrs: string, ic: string, name: string, count: string, extra = ''): string =>
            `<button type="button" class="${cls(view, 'row')}${extra}" data-sel-form="row" ${attrs}>`
            + `<span class="${cls(view, 'row-ic')}" aria-hidden="true">${ic}</span>`
            + `<span class="${cls(view, 'row-n')}">${name}</span>`
            + `<span class="${cls(view, 'row-c')}">${count}</span></button>`;
        const radio = (value: ViewScope, name: string, hint: string, count: number | null): string => {
            const on = scope === value;
            return row(`role="radio" aria-checked="${on}" data-scope="${value}"`, on ? '●' : '○',
                `${esc(name)}${hint ? `<small>${esc(hint)}</small>` : ''}`, count === null ? '' : countText(count), ' sel-opt');
        };
        const selName = ref ? `${s.sel}: ${selectionText(ref)}` : `${s.sel}…`;
        const quick = selectionQuickRows(5).map(r =>
            row(`data-sel="${esc(r.sel)}"`, r.icon, esc(r.label), countText(r.count), ' sel-opt')).join('');
        const viewCount = host?.viewCount ? host.viewCount() : TreeRenderer.getVisiblePersonIds().size;
        const overlay = document.createElement('div');
        overlay.className = `bottom-sheet-overlay ${cls(view, 'overlay')}`;
        overlay.innerHTML = `<div class="bottom-sheet ${cls(view, 'sheet')}" role="dialog" aria-modal="true" aria-labelledby="${view}-scope-sheet-title">`
            + `<div class="bottom-sheet-handle"></div>`
            + `<div class="rod-pick-sheet-bar"><h2 class="rod-pick-sheet-title" id="${view}-scope-sheet-title">${esc(s.label)}</h2>`
            + `<button type="button" class="rod-pick-sheet-x" aria-label="${esc(strings.buttons.close)}">×</button></div>`
            + `<div class="${cls(view, 'sheet-sec')}" id="${view}-scope-sheet-sec">${esc(s.sheetSec[view])}</div>`
            + `<div role="radiogroup" aria-labelledby="${view}-scope-sheet-sec">`
            + radio('view', s.view, s.viewHint, viewCount)
            + radio('sel', selName, '', ref ? realSelectionIds().length : null)
            + radio('tree', s.tree, '', all)
            + `</div>`
            + `<div class="${cls(view, 'sheet-sec')}" id="${view}-scope-sheet-change">${esc(s.change)}</div>`
            + `<div role="group" aria-labelledby="${view}-scope-sheet-change">${quick}`
            + row('', '', esc(s.all), '', ` ${cls(view, 'all')} sel-opt`) + `</div>`
            + `</div>`;
        const close = (): void => { if (this.bottomSheet === overlay) this.hideBottomSheet(); };
        overlay.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            if (t === overlay || t.closest('.rod-pick-sheet-x')) { close(); return; }
            const hit = t.closest<HTMLElement>('.scope-row');
            if (!hit) return;
            if (hit.classList.contains('scope-all')) {
                close();
                this.openScopePicker(view);
                return;
            }
            const next = hit.dataset.scope;
            if (next === 'view' || next === 'sel' || next === 'tree') {
                close();
                void this.setViewScope(view, next);
                return;
            }
            const sel = hit.dataset.sel ? decodeSelectionRef(hit.dataset.sel) : null;
            if (sel) {
                close();
                setSelection(sel, view === 'map' ? 'map' : 'picker');
                void this.setViewScope(view, 'sel');
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
     * The window's selection changed (§3, §7, §11.0): for every view, another
     * tree reads its memory; a selection put back from memory brings the
     * remembered Selection back; cleared or gone takes the scope Selection to
     * the view's default. Each open view then follows (its host).
     */
    scopeSelectionChanged(change: SelectionChange): void {
        const has = !!getSelection().ref;
        const tree = DataManager.getCurrentTreeId();
        for (const view of SCOPED_VIEWS) {
            if (change.reason === 'tree') delete scopeTrees[view];
            const before = this.viewScope(view);
            this.syncViewScopeTree(view);
            if (change.reason === 'restore' && has && this.viewScope(view) === scopeDefault(view)
                && SettingsManager.getScopeForTree(tree, view) === 'sel') {
                this[SCOPE_FIELD[view]] = 'sel';
            }
            const next = scopeAfterSelection(this.viewScope(view), change.reason, has, view);
            if (next !== this.viewScope(view)) this.rememberViewScope(view, next);
            this.scopeHostOf(view)?.selectionChanged?.(change, before);
        }
    },
});
