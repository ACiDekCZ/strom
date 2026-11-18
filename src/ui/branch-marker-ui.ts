/**
 * Lineage markers in the Settings and the tree legend (spec 112, R1 / §3).
 *
 * Settings > Tree view: a radio row per shape (arc, letter tag, stripe,
 * corner, off), each with a compact card as its preview (on a phone the three
 * lines' signs instead), and the tint switch under it — disabled and shown
 * unchecked while the markers are off, its choice kept for when a shape comes
 * back.
 *
 * The legend: the three lines' signs in the chosen shape (the stylesheet draws
 * `.branch-swatch[data-shape][data-line]`), their names — "first / second
 * parent's line" when the focused person's two parents share a gender (R5,
 * `#tree-canvas.branch-numbered`) — and the "no marker" line.
 */

import { BranchMarker, BRANCH_MARKERS } from '../types.js';
import { strings } from '../strings.js';

export type BranchLine = 'paternal' | 'maternal' | 'descendant';

type LegendKey = 'legendPaternal' | 'legendMaternal' | 'legendDescendant' | 'legendSlot1' | 'legendSlot2';

/** The keys (strings.branchColors) the legend names the three lines with; R5 numbers the parents' lines. */
export function branchLegendLabelKeys(numbered: boolean): Record<BranchLine, LegendKey> {
    return numbered
        ? { paternal: 'legendSlot1', maternal: 'legendSlot2', descendant: 'legendDescendant' }
        : { paternal: 'legendPaternal', maternal: 'legendMaternal', descendant: 'legendDescendant' };
}

/** The tint switch: checked only while it applies, disabled while the markers are off. */
export function branchTintControl(marker: BranchMarker, tintChosen: boolean): { checked: boolean; disabled: boolean } {
    const off = marker === 'off';
    return { checked: tintChosen && !off, disabled: off };
}

/** Put the Settings' lineage marker rows in the state of the settings. */
export function syncBranchMarkerSetting(marker: BranchMarker, tintChosen: boolean, root: ParentNode = document): void {
    for (const input of root.querySelectorAll<HTMLInputElement>('input[name="branch-marker"]')) {
        input.checked = input.value === marker;
    }
    const tint = root.querySelector<HTMLInputElement>('#branch-tint-toggle');
    if (tint) {
        const state = branchTintControl(marker, tintChosen);
        tint.checked = state.checked;
        tint.disabled = state.disabled;
        tint.closest('#branch-tint-row')?.classList.toggle('is-disabled', state.disabled);
    }
}

/**
 * The legend's lineage part: each sign in the chosen shape (numbered letters
 * under R5) and each line's name; returns whether it is drawn at all.
 */
export function syncBranchLegend(group: HTMLElement, marker: BranchMarker, numbered: boolean): boolean {
    if (marker === 'off' || !(BRANCH_MARKERS as readonly string[]).includes(marker)) return false;
    const keys = branchLegendLabelKeys(numbered);
    for (const item of group.querySelectorAll<HTMLElement>('.branch-legend-item')) {
        const swatch = item.querySelector<HTMLElement>('.branch-swatch');
        const line = swatch?.dataset.line as BranchLine | undefined;
        if (!swatch || !line || !(line in keys)) continue;
        if (swatch.dataset.shape !== marker) swatch.dataset.shape = marker;
        swatch.classList.toggle('is-numbered', numbered);
        const label = item.querySelector<HTMLElement>('.branch-legend-label');
        if (!label) continue;
        const key = `branchColors.${keys[line]}`;
        // The key stays on the element, so a change of language names it the same way.
        if (label.dataset.i18n !== key) label.dataset.i18n = key;
        const text = strings.branchColors[keys[line]];
        if (label.textContent !== text) label.textContent = text;
    }
    return true;
}
