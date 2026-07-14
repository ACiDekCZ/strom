/**
 * File System Access UI: attach a tree to a JSON file on disk and save into it
 * directly (Ctrl/Cmd+S), like a desktop app. Only shown where the browser
 * supports the API (Chromium, secure context); everywhere else these controls
 * stay hidden and the download/upload flow is unchanged.
 *
 * The heavy lifting (pickers, handle persistence, permissions) lives in
 * src/file-access.ts; this module wires it to the dialogs, the indicator and
 * the keyboard shortcut. See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { TreeId } from '../types.js';
import {
    isFileAccessSupported, pickSaveFile, pickOpenFile, saveToHandle,
    ensurePermission, storeHandle, loadHandle, dropHandle, FileSystemFileHandleLike,
} from '../file-access.js';
import { uiModule } from './module.js';

export const fileAccessMethods = uiModule({
    /** Reveal FSA controls only when supported; refresh the indicator. */
    initFileAccess(): void {
        if (isFileAccessSupported()) {
            document.body.classList.add('fsa-supported');
        }
        void this.updateFileIndicator();
    },

    /** Build the working-file JSON, refusing when encryption is locked. */
    async buildFileJsonOrWarn(treeId: TreeId): Promise<string | null> {
        try {
            return await DataManager.buildAttachedFileJson(treeId);
        } catch (err) {
            if (err instanceof Error && err.message === 'locked') {
                this.showToast(strings.fileAccess.lockedRefuse);
            } else {
                this.showToast(strings.fileAccess.saveFailed);
            }
            return null;
        }
    },

    /** Export dialog → "Save to file…": pick a location, write, attach the handle. */
    async attachSaveToFile(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;
        this.closeExportDialog?.();

        const meta = TreeManager.getActiveTreeMetadata();
        const handle = await pickSaveFile(meta?.name || 'family-tree');
        if (!handle) return;

        const json = await this.buildFileJsonOrWarn(treeId);
        if (json === null) return;
        await saveToHandle(handle, json);
        await storeHandle(treeId, handle);
        await this.updateFileIndicator();
        this.showToast(strings.fileAccess.saved(handle.name));
    },

    /** Import menu → "Open from file…": read a file, import it, attach the handle. */
    async openFromFile(): Promise<void> {
        if (DataManager.isViewMode()) return;
        const picked = await pickOpenFile();
        if (!picked) return;
        // Remembered until the import finishes (confirmImportTree attaches it).
        this.pendingOpenFileHandle = picked.handle;
        await this.importJsonString(picked.text);
    },

    /** Attach the pending open-file handle to the freshly imported tree. */
    async attachPendingFileHandle(treeId: TreeId): Promise<void> {
        const handle = this.pendingOpenFileHandle;
        this.pendingOpenFileHandle = null;
        if (!handle) return;
        await storeHandle(treeId, handle);
        await this.updateFileIndicator();
        this.showToast(strings.fileAccess.linked(handle.name));
    },

    /** Save the active tree into its attached file (Ctrl/Cmd+S, menu "Save"). */
    async saveActiveTreeToFile(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;
        const handle = await loadHandle(treeId);
        if (!handle) return;

        if (!(await ensurePermission(handle))) {
            await dropHandle(treeId);
            await this.updateFileIndicator();
            this.showToast(strings.fileAccess.permissionDenied);
            return;
        }
        const json = await this.buildFileJsonOrWarn(treeId);
        if (json === null) return;
        try {
            await saveToHandle(handle, json);
            this.showToast(strings.fileAccess.saved(handle.name));
        } catch {
            this.showToast(strings.fileAccess.saveFailed);
        }
    },

    /** Detach the active tree's file (menu action). */
    async unlinkActiveTreeFile(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        await dropHandle(treeId);
        await this.updateFileIndicator();
    },

    /**
     * Refresh the toolbar file indicator and cache the linked file name (so the
     * Ctrl+S handler can decide synchronously whether to intercept the key).
     */
    async updateFileIndicator(): Promise<void> {
        const indicator = document.getElementById('file-link-indicator');
        const treeId = DataManager.getCurrentTreeId();
        const handle: FileSystemFileHandleLike | null =
            (treeId && !DataManager.isViewMode()) ? await loadHandle(treeId) : null;
        this.activeFileHandleName = handle?.name ?? null;
        if (!indicator) return;
        if (handle) {
            indicator.style.display = 'inline-flex';
            indicator.title = strings.fileAccess.linkedTo(handle.name);
        } else {
            indicator.style.display = 'none';
        }
    },
});
