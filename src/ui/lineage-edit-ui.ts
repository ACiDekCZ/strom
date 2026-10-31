/**
 * "Edit family line…" (package 1031 §2): one dialog for a lineage's boundary
 * and name forms. The tree overview's lineage detail and the person card call
 * `openLineageEdit`; the dialog itself is not built yet, so the call does
 * nothing for now.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import type { RodId } from '../lineage.js';
import { uiModule } from './module.js';

export const lineageEditUiMethods = uiModule({
    /** Open the edit dialog of a lineage of the open tree (not built yet: does nothing). */
    openLineageEdit(rodId: RodId): void {
        void rodId;
    },
});
