/**
 * Lineage markers in the Settings and the tree legend (spec 112, R1 / §3).
 *
 * Settings > Tree view: a radio row per shape (arc, letter tag, stripe,
 * corner, no shape), each with a compact card as its preview (on a phone the
 * three lines' signs instead), and the tint switch under it — always enabled,
 * with any shape or alone (Milan 19 Nov 2026: "no shape" + tint = tinted cards
 * only, "no shape" without it = no marking).
 *
 * The legend: the three lines' signs in the chosen shape (the stylesheet draws
 * `.branch-swatch[data-shape][data-line]`), their names — "first / second
 * parent's line" when the focused person's two parents share a gender (R5,
 * `#tree-canvas.branch-numbered`) — and the "no marker" line. With no shape
 * and the tint the signs are the tint's 16px squares (data-shape="none").
 */

import { BranchMarker } from '../types.js';
import { BRANCH_MARKERS } from '../model-values.js';
import { strings } from '../strings.js';

export type BranchLine = 'paternal' | 'maternal' | 'descendant';

type LegendKey = 'legendPaternal' | 'legendMaternal' | 'legendDescendant' | 'legendSlot1' | 'legendSlot2';

/** The keys (strings.branchColors) the legend names the three lines with; R5 numbers the parents' lines. */
export function branchLegendLabelKeys(numbered: boolean): Record<BranchLine, LegendKey> {
    return numbered
        ? { paternal: 'legendSlot1', maternal: 'legendSlot2', descendant: 'legendDescendant' }
        : { paternal: 'legendPaternal', maternal: 'legendMaternal', descendant: 'legendDescendant' };
}

/** Put the Settings' lineage marker rows in the state of the settings (the tint is never disabled). */
export function syncBranchMarkerSetting(marker: BranchMarker, tint: boolean, root: ParentNode = document): void {
    for (const input of root.querySelectorAll<HTMLInputElement>('input[name="branch-marker"]')) {
        input.checked = input.value === marker;
    }
    const box = root.querySelector<HTMLInputElement>('#branch-tint-toggle');
    if (box) box.checked = tint;
}

/**
 * The legend's lineage part: each sign in the chosen shape (numbered letters
 * under R5; the tint's square with no shape) and each line's name; returns
 * whether it is drawn at all (a shape or the tint).
 */
export function syncBranchLegend(group: HTMLElement, marker: BranchMarker, numbered: boolean, tint = false): boolean {
    if (!(BRANCH_MARKERS as readonly string[]).includes(marker) || (marker === 'none' && !tint)) return false;
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
