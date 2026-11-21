/**
 * The family line of the window's selection (spec 039 §0, spec 098 §0.2): a
 * thin layer over src/ui/view-selection-ui.ts for the callers of the family
 * line (the toolbar's choice of lines, the person's menu, the tree overview's
 * "Show in tree", the person's "Family line" row, the fan's legend, spec 114).
 * The state, its memory per tree, covering by another group and the end of
 * a gone selection live there.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { LineageIndex, RodId, rods } from '../lineage.js';
import { rodFocusTarget } from '../rod-focus.js';
import { RodPickerItem, rodPickerHtml, rodPickerItems, rodPickerSmallItems } from '../rod-picker.js';
import { ensureFamilyPagesAppCss } from '../family-pages-css.js';
import { showFocusToast } from '../focus-toast.js';
import { shownNameFull } from '../person-name.js';
import { isPhoneBar } from '../breakpoints.js';
import { TreeManager } from '../tree-manager.js';
import type { PersonId, TreeId } from '../types.js';
import { encodeSelectionRef, type SelectionRef } from '../view-selection.js';
import { wireRodPicker } from './rod-picker-ui.js';
import type { HighlightGroup } from './evidence-ui.js';
import { uiModule } from './module.js';
import {
    SelectionOrigin, clearSelection, getSelection, onSelectionChange, selectionBack, selectionGroup, selectionIndex,
    selectionIndexGeneration, selectionText, setSelection, setSelectionHost,
} from './view-selection-ui.js';

/** Where a line was chosen: from memory ('restore') the focus stays. */
export type RodOrigin = SelectionOrigin;

/** The open tree's lines (computed once per change of the data). */
export function rodIndex(): { index: LineageIndex; labels: Map<RodId, string> } {
    return selectionIndex();
}

/** Changes with every change of the data or the tree (the toolbar's choice is built again). */
export function rodIndexGeneration(): number {
    return selectionIndexGeneration();
}

/** The line's name as the tree overview writes it. */
export function rodLabel(id: RodId): string {
    const { index, labels } = rodIndex();
    return labels.get(id) ?? index.rods.get(id)?.surname ?? '';
}

/** The chosen line of the open tree (null: no selection, or a selection that is not a line). */
export function getSelectedRod(): RodId | null {
    const ref = getSelection().ref;
    return ref?.kind === 'rod' ? ref.rodId : null;
}

/** "Back to overview" of the chosen line (only right after "Show in tree" in the tree overview). */
export function rodBack(): (() => void) | null {
    return getSelectedRod() ? selectionBack() : null;
}

/** Choose a line (null: no selection); a line not in the tree clears the choice. */
export function setRodSelection(id: RodId | string | null, origin: RodOrigin, opts: { back?: () => void } = {}): void {
    if (!id) { clearSelection(); return; }
    setSelection({ kind: 'rod', rodId: id as RodId }, origin, opts);
}

/** No selection: cleared and forgotten, the highlight ended. */
export function clearRodSelection(): void {
    clearSelection();
}

/** Called with the chosen line (or null) after every change of the selection. */
export function onRodSelectionChange(cb: (id: RodId | null) => void): () => void {
    return onSelectionChange((sel, change) => {
        if (change.reason === 'hideOthers') return;
        cb(sel.ref?.kind === 'rod' ? sel.ref.rodId : null);
    });
}

/** The highlight of a line: members framed, spouses faint, recounted from the shared index. */
export function rodGroup(id: RodId, returnTo?: () => void): HighlightGroup | null {
    return selectionGroup({ kind: 'rod', rodId: id }, returnTo);
}

// ---------------------------------------------------------------------------
// The app's side: the toolbar's choice, the focus move, the pill's label.

/** The phone's list (a bottom sheet, spec 039 §5.2); without one the tree overview's lines. */
let sheetOpener: (() => void) | null = null;

/** The phone (≤ 640, sideways): what the pill's label opens instead of the toolbar's popover. */
export function setRodPickerSheetOpener(open: (() => void) | null): void {
    sheetOpener = open;
}

let hostAbort: AbortController | null = null;
/** The line the fan's legend last marked. */
let legendRod: RodId | null = null;
let hostKey = '';
let hostGeneration = -1;
let hostTimer: ReturnType<typeof setTimeout> | null = null;
const HOST_DELAY_MS = 150;
/** The axis of the lines' bars (the tree pages' introduction). */
const AXIS_LO = 1650;
const AXIS_HI = 2030;

/** The tree has a line worth choosing (not only small families): the choice is offered (§1.5, §5.1). */
export function rodPickerOffered(): boolean {
    return rods(rodIndex().index).some(r => !r.small);
}

/** The choice's markup (the toolbar's and the phone's sheet): the tree view's list, small lines unfolding. */
function viewPickerHtml(items: RodPickerItem[], current: RodId | null): string {
    const { index, labels } = rodIndex();
    const treeId = DataManager.getCurrentTreeId();
    const treeTitle = treeId ? TreeManager.getTreeMetadata(treeId as TreeId)?.name ?? '' : '';
    return rodPickerHtml({
        items, small: rodPickerSmallItems(index, getCurrentLanguage(), labels), otherMode: 'expand',
        current, treeTitle, lo: AXIS_LO, hi: AXIS_HI, texts: pickerTexts(),
        link: (_item, inner, cls) => `<button type="button" class="${cls}">${inner}</button>`,
    });
}

/**
 * The choice's last row (spec 084 §6, 6d): "Save the X family line as a
 * list…" for the line chosen, behind a line of its own; only in a tree
 * whose lists can change. The saved family pages share the list's markup
 * and never get this row.
 */
function appendSaveListRow(pick: HTMLDetailsElement, current: RodId | null, onSave: (rod: RodId) => void): void {
    if (!current || DataManager.listsReadOnly()) return;
    const list = pick.querySelector('.sp-rodpick-list');
    if (!list) return;
    const li = document.createElement('li');
    li.className = 'sp-rodpick-save';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sp-rodpick-savebtn';
    btn.textContent = strings.selection.saveList;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSave(current);
    });
    li.appendChild(btn);
    list.appendChild(li);
}

/** What a pick does: the whole tree, or the line chosen. */
function pickRod(rod: string): void {
    if (rod === 'tree') clearRodSelection();
    else if (rod && rod !== 'other') setRodSelection(rod, 'picker');
}

/** The selection as a key of the built choice (built again when it changes). */
function selectionKey(): string {
    const ref = getSelection().ref;
    return ref ? encodeSelectionRef(ref) : '';
}

/** Swipe down from the sheet's head closes it (the list itself scrolls). */
const SHEET_SWIPE_CLOSE_PX = 80;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pickerTexts() {
    const F = strings.familyPages;
    return {
        prefix: F.rodPickPrefix, all: strings.selection.button, wholeTree: F.wholeTree, other: F.otherFams, placeholder: F.rodPickPh,
        none: F.rodPickNone, label: strings.selection.pickLabel, members: F.nPersons,
    };
}

export const rodViewMethods = uiModule({
    /** At start: the state follows the data and the tree; the highlight recounts through it. */
    initRodView(): void {
        setSelectionHost({
            highlightGroup: (g) => this.highlightGroup(g),
            evidenceHighlightKind: () => this.evidenceHighlightKind(),
            isEvidenceHighlightOn: () => this.isEvidenceHighlightOn(),
            endEvidenceHighlight: () => this.endEvidenceHighlight(),
            moveFocusToSelection: (ref) => this.moveFocusToSelection(ref),
            selectionChanged: () => this.rodViewChanged(),
            selectionShown: () => this.selectionShown(),
            showToast: (text) => this.showToast(text, 5000),
        });
        this.listenForEvidenceChanges();
        setRodPickerSheetOpener(() => this.showRodPickerSheet());
        getSelectedRod();
        this.syncRodPickerHost();
    },

    /**
     * The window's selection is in sight (spec 098 §7): its highlight in
     * Family, Descendants or the fan (another group covering it hides it),
     * or the map showing the selection's scope.
     */
    selectionShown(): boolean {
        const view = TreeRenderer.getViewMode();
        // The map's scope 'sel' comes with spec 098 §3.
        if (view === 'map') return String(this.mapScope) === 'sel';
        return (view === 'family' || view === 'descendants' || view === 'fan') && this.evidenceHighlightKind() === 'selection';
    },

    /** The chosen line (the fan's legend marks its row). */
    selectedRod(): RodId | null {
        return getSelectedRod();
    },

    /** A row of the fan's legend or a sector's menu (spec 114 §5): the tree's chosen line, null: the whole tree. */
    selectRodFromFan(id: string | null): void {
        if (id) setRodSelection(id, 'legend');
        else clearRodSelection();
    },

    /** The choice or the data changed: the toolbar's choice and the fan's legend follow. */
    rodViewChanged(): void {
        this.syncRodPickerHost();
        const sel = getSelectedRod();
        if (sel !== legendRod) {
            legendRod = sel;
            TreeRenderer.getFanView()?.refreshLegend();
        }
    },

    /** After a choice: the focus to one of the selection's people when none is drawn (a family line, spec 039 §4.4). */
    moveFocusToSelection(ref: SelectionRef): void {
        if (ref.kind === 'rod') this.moveFocusToRod(ref.rodId);
    },

    /**
     * §4.4: none of the line's members drawn — the focus to the nearest one
     * (the founder in Descendants), a step of the history, "↩ Back".
     */
    moveFocusToRod(id: RodId): void {
        const view = TreeRenderer.getViewMode();
        if (view === 'timeline' || view === 'map' || view === 'table') return;
        const drawn: ReadonlySet<PersonId> = view === 'fan'
            ? new Set([...document.querySelectorAll<HTMLElement>('[data-fan-person]')].map(el => (el.dataset.fanPerson ?? '') as PersonId))
            : TreeRenderer.getVisiblePersonIds({ includeView: true });
        const target = rodFocusTarget(rodIndex().index, id, TreeRenderer.getFocusPersonId(), drawn, view);
        if (!target) return;
        const person = DataManager.getPerson(target);
        if (!person) return;
        const label = selectionText({ kind: 'rod', rodId: id });
        void TreeRenderer.setFocus(target).then(() => {
            if (TreeRenderer.getFocusPersonId() !== target || !TreeRenderer.canGoBack()) return;
            showFocusToast(shownNameFull(person, '?'), () => { void TreeRenderer.goBack(); }, (n) => strings.selection.moved(n, label));
        });
    },

    /**
     * The toolbar's choice (§1): hidden on the timeline and the map, in a
     * tree without a line, on the phone; built again (a moment after a
     * change) when the lines or the choice changed. Not while it is open.
     */
    syncRodPickerHost(): void {
        const el = document.getElementById('view-rod-picker');
        if (!el) return;
        const view = TreeRenderer.getViewMode();
        const off = view === 'timeline' || view === 'map' || view === 'table';
        if (off) { el.hidden = true; return; }
        const key = `${DataManager.getCurrentTreeId() ?? ''}|${selectionKey()}|${getCurrentLanguage()}`;
        const built = !!el.querySelector('details.sp-rodpick');
        // The same tree and choice after a change of the data: the list is built again when it
        // opens (§1.5), not after every edit; a chosen line's name may have changed, so it is now.
        if (key === hostKey && (rodIndexGeneration() === hostGeneration || (built && !getSelection().ref))) {
            el.hidden = !built;
            return;
        }
        if (el.querySelector('details[open]')) return;
        if (hostTimer) return;
        hostTimer = setTimeout(() => {
            hostTimer = null;
            this.renderRodPickerHost();
        }, el.querySelector('details.sp-rodpick') ? HOST_DELAY_MS : 0);
    },

    /** Build the toolbar's choice now (`reopen`: built again as it opens, the data having changed). */
    renderRodPickerHost(reopen = false): void {
        const el = document.getElementById('view-rod-picker');
        if (!el) return;
        if (!reopen && el.querySelector('details[open]')) return;
        const current = getSelectedRod();
        hostKey = `${DataManager.getCurrentTreeId() ?? ''}|${selectionKey()}|${getCurrentLanguage()}`;
        hostGeneration = rodIndexGeneration();
        hostAbort?.abort();
        hostAbort = null;
        const items = rodPickerItems(rodIndex().index, undefined, undefined, getCurrentLanguage());
        if (!items.some(i => i.id !== 'tree' && i.id !== 'other')) {
            el.innerHTML = '';
            el.hidden = true;
            return;
        }
        ensureFamilyPagesAppCss();
        el.innerHTML = viewPickerHtml(items, current);
        const pick = el.querySelector<HTMLDetailsElement>('details.sp-rodpick');
        if (!pick) return;
        const summary = pick.querySelector<HTMLElement>('summary');
        if (summary) {
            summary.title = current ? rodLabel(current) : strings.selection.pickLabel;
            summary.setAttribute('aria-expanded', 'false');
            summary.setAttribute('aria-haspopup', 'listbox');
        }
        pick.addEventListener('toggle', () => {
            summary?.setAttribute('aria-expanded', String(pick.open));
            const chev = pick.querySelector('.sp-rodpick-chev');
            if (chev) chev.textContent = pick.open ? '▴' : '▾';
            if (pick.open && hostGeneration !== rodIndexGeneration() && pick.isConnected) {
                // The data changed since it was built: the list again, open.
                this.renderRodPickerHost(true);
                return;
            }
            // Built again once closed when something changed while it was open.
            if (!pick.open) this.syncRodPickerHost();
        });
        appendSaveListRow(pick, current, (rod) => {
            pick.open = false;
            this.showNewPersonList({ source: 'rod', rule: { kind: 'rods', rodIds: [rod] } });
        });
        hostAbort = new AbortController();
        wireRodPicker(el, pickRod, { pick, signal: hostAbort.signal, outside: document, markFirst: true });
        el.hidden = false;
        if (reopen) pick.open = true;
    },

    /**
     * The pill's label (§3.1): the toolbar's choice opened (desktop, tablet);
     * on the phone the list as a sheet (part of §5), else the tree overview's
     * lines.
     */
    openRodPicker(): void {
        if (!isPhoneBar()) {
            const pick = document.querySelector<HTMLDetailsElement>('#view-rod-picker details.sp-rodpick');
            if (pick && !pick.closest<HTMLElement>('[hidden]')) {
                // After this click is over (a click outside closes the choice).
                setTimeout(() => {
                    pick.open = true;
                    pick.querySelector<HTMLInputElement>('.sp-rodpick-q')?.focus({ preventScroll: true });
                }, 0);
                return;
            }
        }
        if (sheetOpener) { sheetOpener(); return; }
        const treeId = DataManager.getCurrentTreeId();
        if (treeId) void this.showTreeOverview(treeId, { section: 'rods', scroll: true });
    },
    /**
     * The phone's list (§5.2, §5.3): a bottom sheet of the window's height
     * less 40px (beside the side bar when the phone is held sideways) with
     * the title, ×, the search field (focused only when tapped: no keyboard
     * over the list) and the tree view's list, small lines unfolding.
     * Opened from More → Family line and from the pill's label.
     */
    showRodPickerSheet(): void {
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const items = rodPickerItems(rodIndex().index, undefined, undefined, getCurrentLanguage());
        if (!items.some(i => i.id !== 'tree' && i.id !== 'other')) return;
        ensureFamilyPagesAppCss();
        const title = strings.selection.pickLabel;
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay rod-pick-overlay';
        overlay.innerHTML = `<div class="bottom-sheet rod-pick-sheet" role="dialog" aria-modal="true" aria-labelledby="rod-pick-sheet-title">`
            + `<div class="rod-pick-sheet-head"><div class="bottom-sheet-handle"></div>`
            + `<div class="rod-pick-sheet-bar"><h2 class="rod-pick-sheet-title" id="rod-pick-sheet-title">${esc(title)}</h2>`
            + `<button type="button" class="rod-pick-sheet-x" aria-label="${esc(strings.buttons.close)}">×</button></div></div>`
            + viewPickerHtml(items, getSelectedRod())
            + '</div>';
        const sheet = overlay.querySelector<HTMLElement>('.rod-pick-sheet')!;
        const pick = sheet.querySelector<HTMLDetailsElement>('details.sp-rodpick')!;
        const close = (): void => { if (this.bottomSheet === overlay) this.hideBottomSheet(); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        sheet.querySelector('.rod-pick-sheet-x')?.addEventListener('click', close);
        // The list stays open in the sheet: a pick, Escape (its own) and nothing else closes it — and the sheet with it.
        wireRodPicker(sheet, (rod) => { close(); pickRod(rod); }, { pick, outside: new EventTarget(), markFirst: true });
        appendSaveListRow(pick, getSelectedRod(), (rod) => {
            close();
            this.showNewPersonList({ source: 'rod', rule: { kind: 'rods', rodIds: [rod] } });
        });
        pick.addEventListener('toggle', () => { if (!pick.open) close(); });
        pick.querySelector('summary')?.addEventListener('click', (e) => e.preventDefault());
        // Swipe down from the head closes (as the other sheets; the list scrolls on its own).
        const head = sheet.querySelector<HTMLElement>('.rod-pick-sheet-head')!;
        let startY = 0;
        head.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; sheet.style.transition = 'none'; }, { passive: true });
        head.addEventListener('touchmove', (e) => {
            const dy = e.touches[0].clientY - startY;
            if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        head.addEventListener('touchend', (e) => {
            sheet.style.transition = '';
            if (e.changedTouches[0].clientY - startY > SHEET_SWIPE_CLOSE_PX) close();
            else sheet.style.transform = '';
        });
        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        pick.open = true;
        // The chosen line in view (a long list scrolls to it).
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            sheet.querySelector<HTMLElement>('.sp-rodpick-list li[aria-current]')?.scrollIntoView({ block: 'nearest' });
            if (document.activeElement === document.body || !sheet.contains(document.activeElement)) {
                sheet.querySelector<HTMLElement>('.rod-pick-sheet-x')?.focus({ preventScroll: true });
            }
        });
    },
});

