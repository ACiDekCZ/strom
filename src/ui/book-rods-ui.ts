/**
 * "Family line book…" (package 1031 §1.3, §4): the book of chosen lineages.
 * The tree overview's lineage detail calls `openBookForRods`; for now it opens
 * the family book dialog as it is (the choice of lineages comes with the new
 * dialog).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import type { RodId } from '../lineage.js';
import { uiModule } from './module.js';

export const bookRodsUiMethods = uiModule({
    /** Open the family book dialog for these lineages of the open tree. */
    openBookForRods(rodIds: readonly RodId[]): void {
        void rodIds;
        this.showBookDialog();
    },
});
