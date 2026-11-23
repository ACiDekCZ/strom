/**
 * The tree's merges after the write (spec 134 §10): undoing a merge.
 * See src/ui/module.ts for the composition pattern.
 */

import type { TreeId } from '../types.js';
import { uiModule } from './module.js';

export const mergeHistoryMethods = uiModule({
    /**
     * Undo merge `recordId` of tree `treeId` (K8.1–K8.4), over the dialog
     * `parentDialogId` when given (the guide's last step). Until the undo
     * dialog is here: the tree's backups, where "Before merge" waits.
     */
    showUndoMerge(treeId: TreeId, recordId: string, parentDialogId?: string): void {
        void recordId;
        void this.showSnapshotsDialog(treeId, parentDialogId);
    },
});
