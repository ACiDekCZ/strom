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
import { LineageIndex, RodId, realRodMembers, rods } from '../lineage.js';
import { selectionFocusTarget } from '../rod-focus.js';
import { RodPickerItem, rodPickerHtml, rodPickerItems, rodPickerSmallItems } from '../rod-picker.js';
import { ensureFamilyPagesAppCss } from '../family-pages-css.js';
import { showFocusToast } from '../focus-toast.js';
import { shownNameFull } from '../person-name.js';
import { isPhoneBar } from '../breakpoints.js';
import { TreeManager } from '../tree-manager.js';
import type { PersonId, TreeId } from '../types.js';
import { encodeSelectionRef, selectionPersonIds, type SelectionRef } from '../view-selection.js';
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
        // The scopes of the Map, the Timeline and the Table follow the selection (spec 098 §3, §7, §11.0).
        onSelectionChange((_sel, change) => this.scopeSelectionChanged(change));
        getSelectedRod();
        this.syncSelectionPickerHost();
    },

    /**
     * The window's selection is in sight (spec 098 §7): its highlight in
     * Family, Descendants or the fan (another group covering it hides it),
     * or the map (its scope Selection, or the selection highlighted, §11d).
     */
    selectionShown(): boolean {
        const view = TreeRenderer.getViewMode();
        if (view === 'map') return true;
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
        // "Hide others" (§8): the layout and the pill's switch follow
        this.syncPersonFilter();
        if (this.evidenceHighlightKind() === 'selection') this.renderEvidencePill();
        const sel = getSelectedRod();
        if (sel !== legendRod) {
            legendRod = sel;
            TreeRenderer.getFanView()?.refreshLegend();
        }
    },

    /**
     * After a choice (spec 039 §4.4, spec 098 §9): none of the selection's
     * people drawn — the focus to the nearest one (in Descendants to the
     * family line's founder, the person whose ancestors or descendants they
     * are, else the one born first), a step of the history, "↩ Back".
     */
    moveFocusToSelection(ref: SelectionRef): void {
        const view = TreeRenderer.getViewMode();
        if (view === 'timeline' || view === 'map' || view === 'table') return;
        const { index } = rodIndex();
        const data = DataManager.getData();
        let members: PersonId[];
        let root: PersonId | null = null;
        if (ref.kind === 'rod') {
            const rod = index.rods.get(ref.rodId);
            if (!rod) return;
            members = realRodMembers(index, ref.rodId);
            root = data.persons[rod.founderId] ? rod.founderId : null;
        } else {
            members = [...(selectionPersonIds(data, index, ref) ?? [])];
            if (ref.kind === 'ancestors' || ref.kind === 'descendants') root = ref.personId;
        }
        const drawn: ReadonlySet<PersonId> = view === 'fan'
            ? new Set([...document.querySelectorAll<HTMLElement>('[data-fan-person]')].map(el => (el.dataset.fanPerson ?? '') as PersonId))
            : TreeRenderer.getVisiblePersonIds({ includeView: true });
        const target = selectionFocusTarget(data, members, root, TreeRenderer.getFocusPersonId(), drawn, view);
        if (!target) return;
        const person = DataManager.getPerson(target);
        if (!person) return;
        const label = selectionText(ref);
        void TreeRenderer.setFocus(target).then(() => {
            if (TreeRenderer.getFocusPersonId() !== target || !TreeRenderer.canGoBack()) return;
            showFocusToast(shownNameFull(person, '?'), () => { void TreeRenderer.goBack(); }, (n) => strings.selection.moved(n, label));
        });
    },

    /** A family line chosen (§4.4): moveFocusToSelection of it. */
    moveFocusToRod(id: RodId): void {
        this.moveFocusToSelection({ kind: 'rod', rodId: id });
    },
});
