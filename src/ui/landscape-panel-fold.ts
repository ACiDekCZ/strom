/**
 * A phone held sideways (spec 116, Milan 20 Nov 2026): the unfolded panel of
 * a followed research stands over most of the low screen, over the photos'
 * indicator ("Photos k / n", its detail) and over the messages at the
 * bottom. When one of them comes, the panel folds to its strip, as on a
 * phone held upright; it does not unfold by itself when they go — a tap on
 * its head does. Elsewhere (a computer, a tablet, a phone upright, where the
 * panel is a strip anyway) nothing changes.
 */

import { MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import { onToastChange, shownToast } from '../toast-slot.js';

/** The photos' indicator came on the screen (src/ui/image-load-chip.ts). */
export const IMAGE_CHIP_SHOWN_EVENT = 'strom:image-chip-shown';

export type FoldCause = 'images' | 'toast';

/** Does the panel fold for what came? Only sideways, only an unfolded panel, only for the indicator or a message. */
export function landscapePanelFolds(o: { landscape: boolean; panelOpen: boolean; cause: FoldCause; toastKind?: 'message' | 'other' }): boolean {
    if (!o.landscape || !o.panelOpen) return false;
    return o.cause === 'images' || o.toastKind === 'message';
}

/**
 * Fold the panel when the indicator or a message comes. `panelOpen`: the
 * followed research's panel shows unfolded; `fold`: folds it (not remembered
 * as the computer's choice).
 */
export function watchLandscapePanelFold(panelOpen: () => boolean, fold: () => void): void {
    if (typeof window === 'undefined') return;
    const landscape = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(MQ_PHONE_LANDSCAPE).matches;
    const check = (cause: FoldCause, toastKind?: 'message' | 'other'): void => {
        if (landscapePanelFolds({ landscape: landscape(), panelOpen: panelOpen(), cause, toastKind })) fold();
    };
    window.addEventListener(IMAGE_CHIP_SHOWN_EVENT, () => check('images'));
    // A message (`body > .toast`) newly on the screen; the undo pill and the focus confirmation are small and low.
    let last: HTMLElement | null = null;
    onToastChange(() => {
        const t = shownToast();
        if (t && t !== last && t.classList.contains('toast')) check('toast', 'message');
        last = t;
    });
}
