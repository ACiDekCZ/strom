/**
 * The header's "‹ Change structure" (spec 139 §5.2): the way back to
 * Change structure… from a dialog it opened (Split into families, Separate
 * unconnected parts) and from its own steps. Shown only when the dialog's
 * parent is Change structure….
 */

import { strings } from '../strings.js';

/** The dialog of Change structure…. */
export const STRUCTURE_MODAL_ID = 'structure-modal';

/** The chevron of the way back (18 px). */
export const MODAL_BACK_CHEVRON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The button before the dialog's h2, or '' when the dialog was not opened from Change structure…. */
export function modalBackHtml(parentDialogId: string | null | undefined): string {
    if (parentDialogId !== STRUCTURE_MODAL_ID) return '';
    const label = strings.treeActions.structure;
    return `<button type="button" class="modal-back" data-modal-back aria-label="${esc(`${strings.structure.back}: ${label}`)}">`
        + `${MODAL_BACK_CHEVRON}<span>${esc(label)}</span></button>`;
}

/** Wire the button of `modalBackHtml` in `root` to `back` (the dialog's close, which returns to its parent). */
export function wireModalBack(root: ParentNode, back: () => void): void {
    root.querySelector<HTMLButtonElement>('[data-modal-back]')?.addEventListener('click', back);
}
