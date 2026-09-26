/**
 * "Where your data is": keeps the user aware that the trees live only in the
 * browser, and whether the open tree's latest edits are in a file too. Three
 * surfaces, all driven by src/file-copy.ts:
 * - a toolbar indicator while edits are only in a storage the browser may clear;
 * - a notice at the first such edit (once per stretch of unsaved work);
 * - the storage-status dialog: state, last file copy, advice for this device
 *   (install the app, Safari's 7-day rule, iOS home-screen app), Export/Install.
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { TreeId, TreeMetadata } from '../types.js';
import { formatRelativeDateTime } from '../format.js';
import { getPersistenceState, settledPersistenceState, PersistenceState } from '../persistence.js';
import {
    hasUnsavedChanges, shouldNoticeUnsaved, shouldShowUnsavedIndicator, storageAdvice, isIosDevice, StorageAdvice,
} from '../file-copy.js';
import { canPromptInstall, promptInstall, isStandaloneDisplay } from '../pwa.js';
import { uiModule } from './module.js';

/** Last known storage state (refreshed on every check; best-effort until known). */
let knownState: PersistenceState = 'best-effort';

function currentAdvice(): StorageAdvice {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    return storageAdvice({
        ios: nav ? isIosDevice(nav.userAgent ?? '', nav.platform ?? '', nav.maxTouchPoints ?? 0) : false,
        standalone: isStandaloneDisplay(),
        canInstall: canPromptInstall(),
    });
}

function activeTree(): { id: TreeId; meta: TreeMetadata } | null {
    const id = DataManager.getCurrentTreeId();
    const meta = id ? TreeManager.getTreeMetadata(id) : null;
    return id && meta ? { id, meta } : null;
}

function personCount(): number {
    return Object.keys(DataManager.getData().persons).length;
}

export const fileCopyMethods = uiModule({
    /** Show or hide the toolbar indicator for the open tree. */
    async refreshUnsavedIndicator(): Promise<void> {
        knownState = await getPersistenceState();
        this.renderUnsavedIndicator();
    },

    renderUnsavedIndicator(): void {
        const el = document.getElementById('unsaved-copy-indicator');
        if (!el) return;
        const tree = activeTree();
        const show = !!tree && shouldShowUnsavedIndicator({
            state: knownState,
            info: tree.meta,
            personCount: personCount(),
            viewMode: DataManager.isViewMode(),
        });
        el.style.display = show ? 'inline-flex' : 'none';
    },

    /**
     * A tree's file-copy state changed (an edit, an export): refresh the
     * indicator, and for an edit of the open tree maybe raise the notice.
     */
    async handleFileCopyChange(treeId: string): Promise<void> {
        const tree = activeTree();
        if (!tree || tree.id !== treeId) return;
        // An edit's save asks for persistent storage: act on the answer.
        knownState = await settledPersistenceState();
        this.renderUnsavedIndicator();
        const fresh = TreeManager.getTreeMetadata(tree.id);
        if (!fresh || !hasUnsavedChanges(fresh)) {
            document.getElementById('file-copy-notice')?.remove();
            return;
        }
        if (!shouldNoticeUnsaved({
            state: knownState,
            info: fresh,
            personCount: personCount(),
            viewMode: DataManager.isViewMode(),
            enabled: SettingsManager.isFileCopyRemindersEnabled(),
            now: Date.now(),
        })) return;
        TreeManager.noteFileCopyNotice(tree.id);
        this.showFileCopyNotice(fresh.name);
    },

    showFileCopyNotice(treeName: string): void {
        const s = strings.fileCopy;
        const advice = currentAdvice();
        const message = advice === 'install' ? s.noticeInstall(treeName)
            : advice === 'ios-safari' ? s.noticeIosSafari(treeName)
            : s.notice(treeName);
        const close = () => document.getElementById('file-copy-notice')?.remove();
        const actions = [{ label: s.save, run: () => { close(); this.saveTreeCopy(); } }];
        if (advice === 'install') {
            actions.push({ label: s.install, run: () => { close(); void this.installApp(); } });
        } else {
            actions.push({ label: s.details, run: () => { close(); void this.showStorageStatusDialog(); } });
        }
        this.showStorageNotice('file-copy-notice', message, actions);
    },

    /** Export the open tree — or save into its attached working file. */
    saveTreeCopy(): void {
        if (this.activeFileHandleName) void this.saveActiveTreeToFile();
        else this.showExportDialog();
    },

    async installApp(): Promise<void> {
        if (await promptInstall()) this.showToast(strings.fileCopy.installing);
        void this.refreshStorageStatusDialog();
    },

    /** The "Where your data is" dialog (indicator, notice, backups dialog). */
    async showStorageStatusDialog(): Promise<void> {
        const modal = document.getElementById('storage-status-modal');
        if (!modal) return;
        await this.refreshStorageStatusDialog();
        modal.classList.add('active');
    },

    closeStorageStatusDialog(): void {
        document.getElementById('storage-status-modal')?.classList.remove('active');
    },

    async refreshStorageStatusDialog(): Promise<void> {
        const body = document.getElementById('storage-status-body');
        if (!body) return;
        knownState = await getPersistenceState();
        body.replaceChildren(...this.storageStatusParagraphs(true).map(text => {
            const p = document.createElement('p');
            p.textContent = text;
            return p;
        }));
        const advice = currentAdvice();
        const install = document.getElementById('storage-status-install');
        if (install) install.hidden = advice !== 'install';
        const save = document.getElementById('storage-status-save');
        if (save) {
            save.textContent = this.activeFileHandleName ? strings.fileAccess.saveToFile : strings.fileCopy.save;
            save.hidden = !activeTree() || DataManager.isViewMode();
        }
        this.renderUnsavedIndicator();
    },

    /**
     * The status as sentences: storage state, the open tree's last file copy,
     * and (withAdvice) what to do on this device. Uses the last known state.
     */
    storageStatusParagraphs(withAdvice: boolean): string[] {
        const s = strings.fileCopy;
        const out: string[] = [];
        if (withAdvice) out.push(s.intro);
        out.push(knownState === 'persistent' ? s.statePersistent
            : knownState === 'unsupported' ? s.stateUnsupported : s.stateNotPersistent);
        const tree = activeTree();
        if (tree && !DataManager.isViewMode()) {
            const { meta } = tree;
            if (meta.fileCopyAt) {
                const when = formatRelativeDateTime(Date.parse(meta.fileCopyAt), getCurrentLanguage());
                out.push(s.copyAt(meta.name, when) + ' ' + (hasUnsavedChanges(meta) ? s.copyChanged : s.copyUpToDate));
            } else {
                out.push(s.copyNever(meta.name));
            }
        }
        if (withAdvice) {
            if (knownState !== 'persistent') {
                const advice = currentAdvice();
                out.push(advice === 'install' ? s.adviceInstall
                    : advice === 'ios-safari' ? s.adviceIosSafari
                    : advice === 'ios-app' ? s.adviceIosApp : s.adviceFile);
            }
            out.push(s.backupsNote);
        }
        return out;
    },

    toggleFileCopyReminders(enabled: boolean): void {
        SettingsManager.setFileCopyReminders(enabled);
        if (!enabled) document.getElementById('file-copy-notice')?.remove();
    },
});
