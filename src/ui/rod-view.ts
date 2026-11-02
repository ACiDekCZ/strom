/**
 * The family line chosen in the tree view (spec 039 §0): one state, set from
 * the toolbar's choice, the person's menu, the pill, the tree overview's
 * "Show in tree" and the person's "Family line" row. The line's members are
 * highlighted with the pill (src/ui/evidence-ui.ts, kind 'rod'), the spouses
 * who married in faintly, the rest dimmed.
 *
 * - Remembered per tree (SettingsManager.rodByTree, a view setting, not the
 *   tree's data) and put back when the tree opens, without moving the focus.
 * - Another highlighted group covers the line; when that group ends the line
 *   comes back. Choosing a line ends any other group.
 * - A line that no longer exists after a change is let go without a word.
 * - Chosen anywhere but from memory: when none of its members is drawn the
 *   focus moves to the nearest one (src/rod-focus.ts), with "↩ Back".
 */

import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { LineageIndex, RodId, buildLineages, rodLabels, realRodMembers, realRodSpouses } from '../lineage.js';
import { rodFocusTarget } from '../rod-focus.js';
import { rodPickerHtml, rodPickerItems, rodPickerSmallItems } from '../rod-picker.js';
import { ensureFamilyPagesAppCss } from '../family-pages-css.js';
import { showFocusToast } from '../focus-toast.js';
import { shownNameFull } from '../person-name.js';
import { isPhoneBar } from '../breakpoints.js';
import { TreeManager } from '../tree-manager.js';
import type { PersonId, TreeId } from '../types.js';
import { wireRodPicker } from './rod-picker-ui.js';
import type { HighlightGroup } from './evidence-ui.js';
import { uiModule } from './module.js';

/** Where a line was chosen: from memory ('restore') the focus stays. */
export type RodOrigin = 'picker' | 'menu' | 'pill' | 'overview' | 'person' | 'restore';

/** What the state needs of the app (the UI; a fake in tests). */
export interface RodViewHost {
    highlightGroup(group: HighlightGroup): void;
    evidenceHighlightKind(): string | null;
    isEvidenceHighlightOn(): boolean;
    endEvidenceHighlight(): void;
    /** After a choice (not from memory): the focus to a member when none is drawn. */
    moveFocusToRod(id: RodId): void;
    /** The toolbar's choice, the fan's legend: the chosen line changed or the data did. */
    rodViewChanged(): void;
}

let host: RodViewHost | null = null;
/** The tree the state belongs to (undefined: not looked at yet). */
let treeKey: string | null | undefined;
/** The data when the tree was last switched: a remembered line is forgotten only from data loaded since. */
let treeKeyData: unknown = null;
let selected: RodId | null = null;
/** A remembered line not found yet (the tree still locked or loading): tried again after each change. */
let pending: RodId | null = null;
/** "Back to overview" of a line shown from the tree overview (this page only, never remembered). */
let back: (() => void) | null = null;
const listeners = new Set<(id: RodId | null) => void>();
/** Bumped by every change of the data: the lines are computed again when next needed. */
let generation = 0;
let cache: { data: unknown; generation: number; index: LineageIndex; labels: Map<RodId, string> } | null = null;

export function setRodViewHost(h: RodViewHost | null): void {
    host = h;
}

/** Tests: a clean state. */
export function resetRodView(): void {
    host = null;
    treeKey = undefined;
    treeKeyData = null;
    selected = null;
    pending = null;
    back = null;
    listeners.clear();
    generation++;
    cache = null;
}

/** The open tree's lines (computed once per change of the data). */
export function rodIndex(): { index: LineageIndex; labels: Map<RodId, string> } {
    const data = DataManager.getData();
    if (!cache || cache.data !== data || cache.generation !== generation) {
        const index = buildLineages(data);
        cache = { data, generation, index, labels: rodLabels(index) };
    }
    return cache;
}

/** Changes with every change of the data or the tree (the toolbar's choice is built again). */
export function rodIndexGeneration(): number {
    return generation;
}

/** The line's name as the tree overview writes it. */
export function rodLabel(id: RodId): string {
    const { index, labels } = rodIndex();
    return labels.get(id) ?? index.rods.get(id)?.surname ?? '';
}

function alive(index: LineageIndex, id: RodId): boolean {
    return index.rods.has(id) && realRodMembers(index, id).length > 0;
}

/** The tree's real data is in (not an empty stand-in of a locked tree). */
function dataIsReal(): boolean {
    return !DataManager.isLocked() && Object.keys(DataManager.getData().persons).length > 0;
}

function notify(): void {
    for (const cb of [...listeners]) cb(selected);
    host?.rodViewChanged();
}

/** Another group (not the line) holds the pill: the line waits under it. */
function covered(): boolean {
    return !!host && host.isEvidenceHighlightOn() && host.evidenceHighlightKind() !== 'rod';
}

function endRodHighlight(): void {
    if (host?.evidenceHighlightKind() === 'rod') host.endEvidenceHighlight();
}

/** The highlight of a line: members framed, spouses faint, recounted from the shared index. */
export function rodGroup(id: RodId, returnTo?: () => void): HighlightGroup | null {
    const { index } = rodIndex();
    if (!alive(index, id)) return null;
    return {
        kind: 'rod', cite: false,
        personIds: realRodMembers(index, id),
        title: (n) => strings.treeOverview.rods.highlight(rodLabel(id), n),
        recount: () => realRodMembers(rodIndex().index, id),
        faint: () => realRodSpouses(rodIndex().index, id),
        ...(returnTo ? { returnTo } : {}),
    };
}

function show(id: RodId): void {
    const group = rodGroup(id, back ?? undefined);
    if (group) host?.highlightGroup(group);
}

/** A remembered line of the open tree, shown (unless another group covers it). */
function resolvePending(): boolean {
    if (!pending) return false;
    const { index } = rodIndex();
    if (!alive(index, pending)) {
        // Gone from a tree that is really there: forgotten. A locked or loading tree keeps it.
        // (The data seen at the switch may still be the previous tree's.)
        if (dataIsReal() && DataManager.getData() !== treeKeyData) {
            if (treeKey) SettingsManager.setRodForTree(treeKey, null);
            pending = null;
        }
        return false;
    }
    selected = pending;
    pending = null;
    if (!covered()) show(selected);
    return true;
}

/** Follow the open tree: another tree brings its own remembered line (shown, no focus move). */
function syncTree(): boolean {
    const key = DataManager.getCurrentTreeId();
    if (key === treeKey) return false;
    const had = selected;
    treeKey = key;
    treeKeyData = DataManager.getData();
    selected = null;
    back = null;
    pending = key ? (SettingsManager.getRodForTree(key) as RodId | null) : null;
    if (had) endRodHighlight();
    resolvePending();
    if (had !== selected) notify();
    return true;
}

/** The chosen line of the open tree (null: the whole tree). */
export function getSelectedRod(): RodId | null {
    syncTree();
    // A remembered line waiting for the tree's data (the first render after loading).
    if (pending && resolvePending()) notify();
    return selected;
}

/** "Back to overview" of the chosen line (only right after "Show in tree" in the tree overview). */
export function rodBack(): (() => void) | null {
    return selected ? back : null;
}

/**
 * Choose a line (null: the whole tree). A line not in the tree clears the
 * choice. Ends any other highlighted group; moves the focus to a member when
 * none is drawn (not from memory).
 */
export function setRodSelection(id: RodId | string | null, origin: RodOrigin, opts: { back?: () => void } = {}): void {
    syncTree();
    if (!id) { clearRodSelection(); return; }
    const rodId = id as RodId;
    const { index } = rodIndex();
    if (!alive(index, rodId)) { clearRodSelection(); return; }
    selected = rodId;
    pending = null;
    back = origin === 'overview' ? opts.back ?? null : null;
    if (treeKey) SettingsManager.setRodForTree(treeKey, rodId);
    if (origin !== 'restore' || !covered()) show(rodId);
    notify();
    if (origin !== 'restore') host?.moveFocusToRod(rodId);
}

/** The whole tree: the choice cleared and forgotten, the line's highlight ended. */
export function clearRodSelection(): void {
    syncTree();
    const had = selected !== null || pending !== null;
    selected = null;
    pending = null;
    back = null;
    if (treeKey) SettingsManager.setRodForTree(treeKey, null);
    endRodHighlight();
    if (had) notify();
}

/** Called with the chosen line (or null) after every change of the choice. */
export function onRodSelectionChange(cb: (id: RodId | null) => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

/**
 * After a change of the data or a switch of the tree (before the highlight
 * recounts): the lines computed again, the tree's remembered line put back,
 * a line that no longer exists let go without a word.
 */
export function rodViewDataChanged(): void {
    generation++;
    if (syncTree()) { host?.rodViewChanged(); return; }
    const was = selected;
    if (pending) {
        if (resolvePending()) notify();
    } else if (selected && !alive(rodIndex().index, selected)) {
        if (dataIsReal()) {
            if (treeKey) SettingsManager.setRodForTree(treeKey, null);
        } else {
            pending = selected;
        }
        selected = null;
        back = null;
        endRodHighlight();
    }
    if (was !== selected) notify();
    else host?.rodViewChanged();
}

/**
 * Another group ended (its ×, Escape, nobody left): the chosen line comes
 * back from under it, without moving the focus.
 */
export function rodViewUncovered(): void {
    if (!selected || covered() || host?.evidenceHighlightKind() === 'rod') return;
    show(selected);
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

function pickerTexts() {
    const F = strings.familyPages;
    return {
        prefix: F.rodPickPrefix, all: F.rodPickAll, wholeTree: F.wholeTree, other: F.otherFams, placeholder: F.rodPickPh,
        none: F.rodPickNone, label: F.rodPickLabel, members: F.nPersons,
    };
}

export const rodViewMethods = uiModule({
    /** At start: the state follows the data and the tree; the highlight recounts through it. */
    initRodView(): void {
        setRodViewHost({
            highlightGroup: (g) => this.highlightGroup(g),
            evidenceHighlightKind: () => this.evidenceHighlightKind(),
            isEvidenceHighlightOn: () => this.isEvidenceHighlightOn(),
            endEvidenceHighlight: () => this.endEvidenceHighlight(),
            moveFocusToRod: (id) => this.moveFocusToRod(id),
            rodViewChanged: () => this.rodViewChanged(),
        });
        this.listenForEvidenceChanges();
        getSelectedRod();
        this.syncRodPickerHost();
    },

    /** The chosen line (the fan's legend marks its row). */
    selectedRod(): RodId | null {
        return getSelectedRod();
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

    /**
     * §4.4: none of the line's members drawn — the focus to the nearest one
     * (the founder in Descendants), a step of the history, "↩ Back".
     */
    moveFocusToRod(id: RodId): void {
        const view = TreeRenderer.getViewMode();
        if (view === 'timeline' || view === 'map') return;
        const drawn: ReadonlySet<PersonId> = view === 'fan'
            ? new Set([...document.querySelectorAll<HTMLElement>('[data-fan-person]')].map(el => (el.dataset.fanPerson ?? '') as PersonId))
            : TreeRenderer.getVisiblePersonIds({ includeView: true });
        const target = rodFocusTarget(rodIndex().index, id, TreeRenderer.getFocusPersonId(), drawn, view);
        if (!target) return;
        const person = DataManager.getPerson(target);
        if (!person) return;
        const label = rodLabel(id);
        void TreeRenderer.setFocus(target).then(() => {
            if (TreeRenderer.getFocusPersonId() !== target || !TreeRenderer.canGoBack()) return;
            showFocusToast(shownNameFull(person, '?'), () => { void TreeRenderer.goBack(); }, (n) => strings.rodView.moved(n, label));
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
        const off = view === 'timeline' || view === 'map';
        if (off) { el.hidden = true; return; }
        const key = `${DataManager.getCurrentTreeId() ?? ''}|${getSelectedRod() ?? ''}|${getCurrentLanguage()}`;
        const built = !!el.querySelector('details.sp-rodpick');
        // The same tree and choice after a change of the data: the list is built again when it
        // opens (§1.5), not after every edit; a chosen line's name may have changed, so it is now.
        if (key === hostKey && (generation === hostGeneration || (built && !getSelectedRod()))) {
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
        hostKey = `${DataManager.getCurrentTreeId() ?? ''}|${current ?? ''}|${getCurrentLanguage()}`;
        hostGeneration = generation;
        hostAbort?.abort();
        hostAbort = null;
        const { index, labels } = rodIndex();
        const items = rodPickerItems(index);
        if (!items.some(i => i.id !== 'tree' && i.id !== 'other')) {
            el.innerHTML = '';
            el.hidden = true;
            return;
        }
        ensureFamilyPagesAppCss();
        const treeId = DataManager.getCurrentTreeId();
        const treeTitle = treeId ? TreeManager.getTreeMetadata(treeId as TreeId)?.name ?? '' : '';
        el.innerHTML = rodPickerHtml({
            items, small: rodPickerSmallItems(index, getCurrentLanguage(), labels), otherMode: 'expand',
            current, treeTitle, lo: AXIS_LO, hi: AXIS_HI, texts: pickerTexts(),
            link: (_item, inner, cls) => `<button type="button" class="${cls}">${inner}</button>`,
        });
        const pick = el.querySelector<HTMLDetailsElement>('details.sp-rodpick');
        if (!pick) return;
        const summary = pick.querySelector<HTMLElement>('summary');
        if (summary) {
            summary.title = current ? rodLabel(current) : strings.familyPages.rodPickLabel;
            summary.setAttribute('aria-expanded', 'false');
            summary.setAttribute('aria-haspopup', 'listbox');
        }
        pick.addEventListener('toggle', () => {
            summary?.setAttribute('aria-expanded', String(pick.open));
            const chev = pick.querySelector('.sp-rodpick-chev');
            if (chev) chev.textContent = pick.open ? '▴' : '▾';
            if (pick.open && hostGeneration !== generation && pick.isConnected) {
                // The data changed since it was built: the list again, open.
                this.renderRodPickerHost(true);
                return;
            }
            // Built again once closed when something changed while it was open.
            if (!pick.open) this.syncRodPickerHost();
        });
        hostAbort = new AbortController();
        wireRodPicker(el, (rod) => {
            if (rod === 'tree') clearRodSelection();
            else if (rod && rod !== 'other') setRodSelection(rod, 'picker');
        }, { pick, signal: hostAbort.signal, outside: document, markFirst: true });
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
});

