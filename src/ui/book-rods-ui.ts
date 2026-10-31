/**
 * "Family line book…" (package 1031 §1.3, §4): the book of chosen lineages.
 * The tree overview's lineage detail calls `openBookForRods`: the family book
 * dialog opens with those lineages chosen (§4.8).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import type { RodId } from '../lineage.js';
import { uiModule } from './module.js';

export const bookRodsUiMethods = uiModule({
    /** Open the family book dialog for these lineages of the open tree. */
    openBookForRods(rodIds: readonly RodId[]): void {
        this.openBookDialog({ kind: 'rods', rods: rodIds });
    },
});
