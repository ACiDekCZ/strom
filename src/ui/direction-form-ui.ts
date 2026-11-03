/**
 * The dialog that creates or edits a research direction through the
 * research's bridge (spec 038 §2, §3.1). Opened from the Directions panel
 * ("+ New direction", ⋯ Edit) and from a person's research items.
 */

import type { LiveDirection, LiveDirectionKind } from '../research-link.js';
import { uiModule } from './module.js';

/** What the dialog opens on. */
export interface DirectionFormOptions {
    mode: 'new' | 'edit';
    /** `edit`: the direction edited. */
    direction?: LiveDirection;
    /** `new`: the person chosen beforehand (the research's REFN, "P0012"). */
    person?: string;
    /** `new`: the kind chosen beforehand. */
    kind?: Exclude<LiveDirectionKind, 'person'>;
    /** `new`: a branch outside the directions the direction grows from ("B-P0031"). */
    branch?: string;
    /** The control focused back when the dialog closes. */
    returnFocus?: HTMLElement | null;
}

export const directionFormMethods = uiModule({
    /** Open the direction dialog (not built yet: nothing happens). */
    openDirectionForm(_opts: DirectionFormOptions): void {
        // The dialog itself comes with spec 038 §2.
    },
});
