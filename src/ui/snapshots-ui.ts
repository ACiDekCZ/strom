/**
 * Backups UI: a per-tree dialog listing versioned snapshots (time capsules) with
 * restore + download actions, plus a "create backup now" button. The snapshot
 * store lives in src/snapshots.ts; restore goes through DataManager (migrateData
 * + undo path). See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { TreeId } from '../types.js';
import { listSnapshots, totalSnapshotBytes, getSnapshotJson, SnapshotMeta } from '../snapshots.js';
import { uiModule } from './module.js';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const snapshotsUiMethods = uiModule({
    async showSnapshotsDialog(treeId?: string): Promise<void> {
        this.closeMobileMenu?.();
        this.snapshotsTreeId = (treeId as TreeId) || DataManager.getCurrentTreeId();
        if (!this.snapshotsTreeId) return;
        document.getElementById('tree-manager-modal')?.classList.remove('active');
        document.getElementById('snapshots-modal')?.classList.add('active');
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

        const [snaps, totalBytes] = await Promise.all([
            listSnapshots(treeId),
            totalSnapshotBytes(treeId),
        ]);

        if (totalEl) {
            totalEl.textContent = snaps.length
                ? strings.snapshots.total(snaps.length, formatBytes(totalBytes))
                : '';
        }

        if (!snaps.length) {
            list.innerHTML = `<div class="snapshots-empty">${strings.snapshots.empty}</div>`;
            return;
        }

        list.innerHTML = snaps.map((s: SnapshotMeta) => {
            const date = new Date(s.createdAt).toLocaleString();
            const reason = strings.snapshots.reasons[s.reason] || s.reason;
            const meta = `${reason} · ${s.personCount} ${strings.snapshots.colPersons.toLowerCase()} · ${formatBytes(s.sizeBytes)}`;
            return `<div class="snapshot-row">
                <div class="snapshot-main">
                    <div class="snapshot-date">${date}</div>
                    <div class="snapshot-meta">${meta}</div>
                </div>
                <div class="snapshot-actions">
                    <button onclick="window.Strom.UI.restoreSnapshotFromUI('${s.id}')">${strings.snapshots.restore}</button>
                    <button onclick="window.Strom.UI.downloadSnapshot('${s.id}')">${strings.snapshots.download}</button>
                </div>
            </div>`;
        }).join('');
    },

    async createManualSnapshot(): Promise<void> {
        const treeId = this.snapshotsTreeId;
        if (!treeId) return;
        if (treeId !== DataManager.getCurrentTreeId()) {
            await DataManager.switchTree(treeId);
        }
        await DataManager.snapshotNow('manual');
        this.showToast(strings.snapshots.created);
        await this.renderSnapshotsList();
    },

    async restoreSnapshotFromUI(snapshotId: string): Promise<void> {
        const treeId = this.snapshotsTreeId;
        if (!treeId) return;
        const confirmed = await this.showConfirm(strings.snapshots.restoreConfirm, strings.snapshots.restore);
        if (!confirmed) return;
        if (treeId !== DataManager.getCurrentTreeId()) {
            await DataManager.switchTree(treeId);
        }
        const ok = await DataManager.restoreSnapshot(snapshotId);
        if (ok) {
            this.closeSnapshotsDialog();
            TreeRenderer.render();
            this.showToast(strings.snapshots.restored);
        }
    },

    async downloadSnapshot(snapshotId: string): Promise<void> {
        const json = await getSnapshotJson(snapshotId);
        if (!json) return;
        const treeName = TreeManager.getActiveTreeMetadata()?.name || 'strom';
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
