/**
 * Backups UI: a per-tree dialog listing versioned snapshots (time capsules) with
 * restore + download actions, plus a "create backup now" button. The snapshot
 * store lives in src/snapshots.ts; restore goes through DataManager (migrateData
 * + undo path). See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { TreeId } from '../types.js';
import { listSnapshots, totalSnapshotBytes, getSnapshotJson, deleteSnapshotsForTree, SnapshotMeta, SnapshotTrim, MAX_SNAPSHOTS_PER_TREE, snapshotCosts, snapshotBudgetBytes, treeImageIds } from '../snapshots.js';
import { uiModule } from './module.js';
import { safeFileName } from '../filenames.js';
import { formatRelativeDateTime, formatFileSize } from '../format.js';
import { emptyStateHtml } from './empty-state.js';

import { iconSvg } from '../icons.js';
import { SettingsManager } from '../settings.js';
/** Locked encryption vs anything else (quota, corrupt record). */
function snapshotErrorMessage(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return /lock/i.test(msg) ? strings.storageSafety.snapshotLocked : strings.storageSafety.snapshotFailed;
}

/** Trees already told today that their backups were trimmed (treeId → day). */
const trimNoticeShown = new Map<string, string>();

/** "today 14:36" — backups are told apart by when they were taken. */
function snapshotWhen(createdAt: number): string {
    return formatRelativeDateTime(createdAt, getCurrentLanguage());
}

/** '' below 1 MB: a few kilobytes of JSON is not worth the reader's attention. */
function snapshotSize(bytes: number): string {
    return formatFileSize(bytes, getCurrentLanguage());
}

export const snapshotsUiMethods = uiModule({
    async showSnapshotsDialog(treeId?: string, parentDialogId?: string): Promise<void> {
        this.closeMobileMenu?.();
        this.snapshotsTreeId = (treeId as TreeId) || DataManager.getCurrentTreeId();
        if (!this.snapshotsTreeId) return;
        // Dialog stack: Escape returns to the parent (e.g. the tree manager).
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        } else {
            document.getElementById('tree-manager-modal')?.classList.remove('active');
        }
        this.pushDialog('snapshots-modal');
        document.getElementById('snapshots-modal')?.classList.add('active');
        void this.renderPersistenceNote();
        await this.renderSnapshotsList();
    },

    /** Whether the browser keeps this data for good — said where backups live. */
    async renderPersistenceNote(): Promise<void> {
        const el = document.getElementById('snapshots-persistence');
        if (!el) return;
        await this.refreshUnsavedIndicator();
        const text = document.createElement('span');
        text.textContent = this.storageStatusParagraphs().join(' ') + ' ';
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'link-button';
        more.textContent = strings.fileCopy.details;
        more.addEventListener('click', () => void this.showStorageStatusDialog());
        el.replaceChildren(text, more);
        el.hidden = false;
    },

    /**
     * Backups were removed to save space: a banner with the way to a lasting
     * copy (export). Once per tree and day — trimming repeats with every new
     * backup of a big tree, the message does not need to.
     */
    handleSnapshotsTrimmed(trim: SnapshotTrim): void {
        if (trim.tooBig) {
            this.handleSnapshotsTooBig(trim);
            return;
        }
        const day = new Date().toISOString().slice(0, 10);
        if (trimNoticeShown.get(trim.treeId) === day) return;
        trimNoticeShown.set(trim.treeId, day);
        const name = TreeManager.getTreeMetadata(trim.treeId as TreeId)?.name ?? '';
        const s = strings.snapshots;
        this.showStorageNotice('snapshots-trimmed-notice',
            trim.storageFull ? s.trimmedFull(trim.kept) : s.trimmed(name, trim.kept), {
                label: s.persistenceSave,
                run: () => {
                    document.getElementById('snapshots-trimmed-notice')?.remove();
                    this.showExportDialog();
                },
            });
        if (this.snapshotsTreeId === trim.treeId) void this.renderSnapshotsList();
    },

    /** A backup finished (often an automatic one, in the background): refresh an open list. */
    handleSnapshotCreated(treeId: string): void {
        if (this.snapshotsTreeId !== treeId) return;
        if (document.getElementById('snapshots-modal')?.classList.contains('active')) void this.renderSnapshotsList();
    },

    /**
     * Even one backup of the tree does not fit what this device gives backups
     * (a phone with scans): advise turning them off — once per tree; the
     * button opens the backups dialog, where the switch is.
     */
    handleSnapshotsTooBig(trim: SnapshotTrim): void {
        if (!TreeManager.takeBackupsTooBigNotice(trim.treeId as TreeId)) return;
        const name = TreeManager.getTreeMetadata(trim.treeId as TreeId)?.name ?? '';
        void snapshotBudgetBytes().then(budget => {
            this.showStorageNotice('snapshots-trimmed-notice', strings.snapshots.tooBig(name, snapshotSize(budget)), {
                label: strings.snapshots.tooBigAction,
                run: () => {
                    document.getElementById('snapshots-trimmed-notice')?.remove();
                    void this.showSnapshotsDialog(trim.treeId);
                },
            });
        });
        if (this.snapshotsTreeId === trim.treeId) void this.renderSnapshotsList();
    },

    /**
     * The tree's automatic backups on/off. Turning them off asks whether the
     * existing backups stay or go (that is where the space is).
     */
    async toggleTreeAutoBackups(enabled: boolean): Promise<void> {
        const treeId = this.snapshotsTreeId;
        if (!treeId) return;
        if (enabled) {
            TreeManager.setAutoBackups(treeId, true);
            return;
        }
        const snaps = await listSnapshots(treeId);
        if (snaps.length > 0) {
            const s = strings.snapshots;
            const bytes = snaps.reduce((n, m) => n + (m.sizeBytes || 0), 0);
            const choice = await this.showChoice(s.autoOffMessage(snaps.length, snapshotSize(bytes)), s.autoOffTitle, [
                { id: 'delete', label: s.autoOffDelete, variant: 'danger' },
                { id: 'keep', label: s.autoOffKeep },
            ]);
            if (choice === null) {
                // Cancelled: nothing changes, the switch goes back on.
                const toggle = document.getElementById('snapshots-auto-toggle') as HTMLInputElement | null;
                if (toggle) toggle.checked = true;
                return;
            }
            if (choice === 'delete') await deleteSnapshotsForTree(treeId);
        }
        TreeManager.setAutoBackups(treeId, false);
        await this.renderSnapshotsList();
    },

    closeSnapshotsDialog(): void {
        document.getElementById('snapshots-modal')?.classList.remove('active');
        this.snapshotsTreeId = null;
    },

    async renderSnapshotsList(): Promise<void> {
        const treeId = this.snapshotsTreeId;
        const list = document.getElementById('snapshots-list');
        const totalEl = document.getElementById('snapshots-total');
        if (!treeId || !list) return;
        const autoToggle = document.getElementById('snapshots-auto-toggle') as HTMLInputElement | null;
        if (autoToggle) autoToggle.checked = TreeManager.isAutoBackupEnabled(treeId as TreeId);

        const [snaps, totalBytes, budget, free] = await Promise.all([
            listSnapshots(treeId),
            totalSnapshotBytes(treeId),
            snapshotBudgetBytes(),
            treeImageIds(treeId),
        ]);
        // What each backup adds: images the tree or a newer backup has are
        // counted there.
        const costs = snapshotCosts(snaps, free);

        if (totalEl) {
            totalEl.textContent = snaps.length
                ? strings.snapshots.total(snaps.length, snapshotSize(totalBytes))
                : '';
        }
        // A tree whose backups cannot all fit the space budget keeps fewer:
        // say so where the list is, not only in a banner that went away.
        const budgetEl = document.getElementById('snapshots-budget-note');
        if (budgetEl) {
            // Full set estimate: the newest with its images, the rest text only.
            const newest = snaps.length ? costs.get(snaps[0].id) ?? 0 : 0;
            const text = Math.max(0, ...snaps.map(m => m.sizeBytes || 0));
            const limited = newest + text * (MAX_SNAPSHOTS_PER_TREE - 1) > budget;
            budgetEl.hidden = !limited;
            budgetEl.textContent = limited ? strings.snapshots.budgetNote(snapshotSize(budget)) : '';
        }

        // While the list is empty the empty state carries "Create backup now";
        // the footer copy of it hides so the dialog has one primary action.
        const footer = document.querySelector<HTMLElement>('#snapshots-modal .snapshots-footer');
        if (footer) footer.hidden = snaps.length === 0;

        if (!snaps.length) {
            const e = strings.emptyStates;
            list.innerHTML = emptyStateHtml({
                title: e.backupsTitle,
                text: e.backupsText,
                actionLabel: strings.snapshots.createNow,
                actionId: 'snapshots-empty-create',
                className: 'snapshots-empty',
            });
            document.getElementById('snapshots-empty-create')
                ?.addEventListener('click', () => { void this.createManualSnapshot(); });
            return;
        }

        const del = strings.danger.deleteBackup;
        list.innerHTML = snaps.map((s: SnapshotMeta) => {
            const date = snapshotWhen(s.createdAt);
            const reason = strings.snapshots.reasons[s.reason] || s.reason;
            // The column header is a heading, not a count — reusing it gave "1 people".
            const meta = [reason, strings.snapshots.persons(s.personCount), snapshotSize(costs.get(s.id) ?? s.sizeBytes)]
                .filter(Boolean).join(' · ');
            return `<div class="snapshot-row">
                <div class="snapshot-main">
                    <div class="snapshot-date">${date}</div>
                    <div class="snapshot-meta">${meta}</div>
                </div>
                <div class="snapshot-actions">
                    <button onclick="window.Strom.UI.restoreSnapshotFromUI('${s.id}')">${strings.snapshots.restore}</button>
                    <button onclick="window.Strom.UI.downloadSnapshot('${s.id}')">${strings.snapshots.download}</button>
                    <button class="snapshot-delete" onclick="window.Strom.UI.deleteSnapshotFromUI('${s.id}')"
                            title="${del}" aria-label="${del}">${iconSvg('trash')}</button>
                </div>
            </div>`;
        }).join('');
    },

    /**
     * Delete one backup. Only the backup goes — saying so on the confirm matters,
     * because "delete" in a list of your family's history reads alarming.
     */
    async deleteSnapshotFromUI(snapshotId: string): Promise<void> {
        // Which backup: they are told apart by when they were taken.
        const snaps = await listSnapshots(this.snapshotsTreeId!);
        const snap = snaps.find(s => s.id === snapshotId);
        if (!snap) return;
        const d = strings.danger;
        if (!await this.showConfirm(d.deleteBackupMessage(snap.personCount), d.deleteBackupTitle(snapshotWhen(snap.createdAt)),
            { confirmLabel: d.deleteBackup, variant: 'danger' })) return;
        try {
            const { deleteSnapshot } = await import('../snapshots.js');
            await deleteSnapshot(snapshotId);
            this.showToast(strings.snapshots.deleted);
            await this.renderSnapshotsList();
        } catch (err) {
            console.error('Deleting backup failed', err);
            this.showToast(snapshotErrorMessage(err), 5000);
        }
    },

    async createManualSnapshot(): Promise<void> {
        const treeId = this.snapshotsTreeId;
        if (!treeId) return;
        try {
            if (treeId !== DataManager.getCurrentTreeId()) {
                await DataManager.switchTree(treeId);
            }
            await DataManager.snapshotNow('manual');
            this.showToast(strings.snapshots.created);
            await this.renderSnapshotsList();
        } catch (err) {
            console.error('Creating backup failed', err);
            this.showToast(snapshotErrorMessage(err), 5000);
        }
    },

    async restoreSnapshotFromUI(snapshotId: string): Promise<void> {
        const treeId = this.snapshotsTreeId;
        if (!treeId) return;
        // Restoring overwrites the whole tree — say WHICH backup, the same way
        // deleting does: they are told apart by when they were taken.
        const snaps = await listSnapshots(treeId);
        const snap = snaps.find(s => s.id === snapshotId);
        const what = snap ? strings.snapshots.persons(snap.personCount) : '';
        const confirmed = await this.showConfirm(strings.snapshots.restoreConfirm(what),
            snap ? strings.danger.restoreBackupTitle(snapshotWhen(snap.createdAt)) : strings.snapshots.restore,
            { confirmLabel: strings.danger.restoreBackup });
        if (!confirmed) return;
        try {
            if (treeId !== DataManager.getCurrentTreeId()) {
                await DataManager.switchTree(treeId);
            }
            const restored = await DataManager.restoreSnapshot(snapshotId);
            if (restored) {
                this.closeSnapshotsDialog();
                TreeRenderer.render();
                this.showToast(restored.missingImages
                    ? strings.snapshots.restoredMissingImages(restored.missingImages)
                    : strings.snapshots.restored, restored.missingImages ? 8000 : undefined);
            } else {
                this.showToast(strings.storageSafety.snapshotFailed, 5000);
            }
        } catch (err) {
            console.error('Restoring backup failed', err);
            this.showToast(snapshotErrorMessage(err), 5000);
        }
    },

    async downloadSnapshot(snapshotId: string): Promise<void> {
        let json: string | null;
        try {
            json = await getSnapshotJson(snapshotId);
        } catch (err) {
            console.error('Reading backup failed', err);
            this.showToast(snapshotErrorMessage(err), 5000);
            return;
        }
        if (!json) return;
        // Name it after the tree whose backups the dialog shows, not the
        // active tree (the dialog can be opened for any tree).
        const treeId = this.snapshotsTreeId ?? DataManager.getCurrentTreeId();
        const treeMeta = treeId ? TreeManager.getTreeMetadata(treeId) : TreeManager.getActiveTreeMetadata();
        const treeName = safeFileName(treeMeta?.name, 'strom');
        const stamp = new Date().toISOString().slice(0, 10);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${treeName}-backup-${stamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },
});
