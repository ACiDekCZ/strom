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

/** The line the fan's legend last marked. */
let legendRod: RodId | null = null;

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
        getSelectedRod();
        this.syncSelectionPickerHost();
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
        this.syncSelectionPickerHost();
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
});
