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
import { SettingsManager } from '../settings.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { TreeId, type StromData } from '../types.js';
import {
    isFileAccessSupported, pickSaveFile, pickOpenFile, saveToHandle,
    ensurePermission, storeHandle, loadHandle, dropHandle, FileSystemFileHandleLike,
} from '../file-access.js';
import { uiModule } from './module.js';
import { activatedElement, runBusy } from './busy.js';
import { imagesToAwait } from '../image-loads.js';
import { imagesBeforeOutput } from './output-images.js';
import { confirmMemoryForOutput } from './memory-limit-ui.js';
import { holdLeave } from './busy-leave.js';
import { whilePicking } from './file-pick.js';
import { inDeviceMode } from './device-mode-ui.js';

export const fileAccessMethods = uiModule({
    /** Reveal FSA controls only when supported; refresh the indicator. */
    initFileAccess(): void {
        if (isFileAccessSupported()) {
            document.body.classList.add('fsa-supported');
        }
        void this.updateFileIndicator();
    },

    /** Build the working-file JSON, refusing when encryption is locked. */
    async buildFileJsonOrWarn(treeId: TreeId): Promise<{ body: string | Blob; data: StromData } | null> {
        try {
            return await DataManager.buildAttachedFile(treeId);
        } catch (err) {
            if (err instanceof Error && err.message === 'locked') {
                this.showToast(strings.fileAccess.lockedRefuse);
            } else {
                this.showToast(strings.fileAccess.saveFailed);
            }
            return null;
        }
    },

    /**
     * Export dialog → "Save to file…": pick a location, write, attach the
     * handle. The system's "Save as" first with nothing shown (the dialog
     * stays), the writing after it as the row's working state (9b); the
     * dialog goes once the file is written, a failure stays at the row.
     */
    async attachSaveToFile(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;
        const origin = activatedElement();

        const meta = TreeManager.getActiveTreeMetadata();
        const picked = await whilePicking(origin, () => pickSaveFile(meta?.name || 'family-tree'));
        if (!picked) return;
        const handle = picked;

        const write = async (): Promise<boolean> => {
            const release = holdLeave('export');
            try {
                const file = await this.buildFileJsonOrWarn(treeId);
                if (file === null) return false;
                await saveToHandle(handle, file.body);
                TreeManager.noteFileCopy([treeId], { [treeId]: file.data });
                await storeHandle(treeId, handle);
                return true;
            } finally {
                release();
            }
        };
        const written = async (): Promise<void> => {
            this.closeExportDialog?.();
            await this.updateFileIndicator();
            this.showToast(strings.fileAccess.saved(handle.name));
        };
        if (!origin || !origin.isConnected) {
            try {
                if (await write()) await written();
            } catch {
                this.showToast(strings.fileAccess.saveFailed);
            }
            return;
        }
        await runBusy(origin, async ctl => {
            try {
                if (await write()) await written();
            } catch (err) {
                const full = err instanceof DOMException && err.name === 'QuotaExceededError';
                ctl.end({ ok: false, kind: 'error', text: full ? strings.busy.noSpace : strings.busy.fileSaveFailed,
                    retry: () => { void this.attachSaveToFile(); } });
            }
        }, { label: strings.busy.saving, kind: 'local' });
    },

    /**
     * Import menu → "Open from file…": read a file, import it, attach the
     * handle. The system's dialog with nothing shown, then the reading as the
     * row's working state (9a); a file that is not JSON is said at the row.
     */
    async openFromFile(): Promise<void> {
        if (DataManager.isViewMode()) return;
        const origin = activatedElement();
        const picked = await whilePicking(origin, () => pickOpenFile());
        if (!picked) return;
        const handle = picked.handle;
        await this.readJsonImportText(handle.name, async () => picked.text, picked.text.length, origin,
            () => { void this.openFromFile(); }, () => {
                // Remembered until the import finishes (confirmImportTree attaches it).
                this.pendingOpenFileHandle = handle;
            });
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

    /**
     * Save the active tree into its attached file (Ctrl/Cmd+S, menu "Save").
     * The browser's permission question first with nothing shown, then the
     * writing as the element's working state when it came from one (the
     * shortcut has none: its toast says the end).
     */
    async saveActiveTreeToFile(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;
        const origin = activatedElement();
        const handle = await loadHandle(treeId);
        if (!handle) return;

        const allowed = await whilePicking(origin, () => ensurePermission(handle));
        // Asked already (a second press while the browser asks): nothing more.
        if (allowed === undefined) return;
        if (!allowed) {
            await dropHandle(treeId);
            await this.updateFileIndicator();
            this.showToast(strings.fileAccess.permissionDenied);
            return;
        }
        // The tree's photos still on their way: the file waits for them (spec 116 §8).
        const waits = imagesToAwait(treeId);
        if (await imagesBeforeOutput(strings.photos.out.backup, { el: origin, treeId }) === 'cancelled') return;
        if (waits) await TreeManager.flush(treeId);
        // The file with its images may need more memory than the page has (spec 135): asked first.
        // Under encryption the file is sealed whole (its images whole in memory).
        if (await confirmMemoryForOutput({ treeId, whole: SettingsManager.isEncryptionEnabled() }) === 'cancel') return;
        const save = async (): Promise<void> => {
            const release = holdLeave('export');
            try {
                const file = await this.buildFileJsonOrWarn(treeId);
                if (file === null) return;
                try {
                    await saveToHandle(handle, file.body);
                    TreeManager.noteFileCopy([treeId], { [treeId]: file.data });
                    // From the "Where the data is" dialog: it goes once the file is written.
                    if (origin?.closest('#storage-status-modal')) this.closeStorageStatusDialog();
                    this.showToast(strings.fileAccess.saved(handle.name));
                } catch {
                    this.showToast(strings.fileAccess.saveFailed);
                }
            } finally {
                release();
            }
        };
        if (origin && origin.isConnected) await runBusy(origin, save, { label: strings.busy.saving, kind: 'local' });
        else await save();
    },

    /** Detach the active tree's file (export dialog action). */
    async unlinkActiveTreeFile(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        await dropHandle(treeId);
        await this.updateFileIndicator();
        this.showToast(strings.fileAccess.unlinked);
    },

    /**
     * Refresh the toolbar file indicator and cache the linked file name (so the
     * Ctrl+S handler can decide synchronously whether to intercept the key).
     */
    async updateFileIndicator(): Promise<void> {
        const indicator = document.getElementById('file-link-indicator');
        const treeId = DataManager.getCurrentTreeId();
        const handle: FileSystemFileHandleLike | null =
            // A device of the home network links no file: the tree is the computer's research's (spec 094 §3).
            (treeId && !DataManager.isViewMode() && !inDeviceMode()) ? await loadHandle(treeId) : null;
        this.activeFileHandleName = handle?.name ?? null;
        // Gates the "Detach file" option in the export dialog.
        document.body.classList.toggle('file-linked', !!handle);
        if (!indicator) return;
        if (handle) {
            indicator.style.display = 'inline-flex';
            indicator.title = strings.fileAccess.linkedTo(handle.name);
            indicator.setAttribute('aria-label', indicator.title);
        } else {
            indicator.style.display = 'none';
        }
    },
});
