/**
 * Collaboration ("send to a relative"): the share dialog, the recipient's
 * welcome screen, the collaboration bar with the reply export, and the
 * reply-detection merge offer. Flow design: docs/PLAN_KOLABORACE.md.
 * Pure classification lives in src/share.ts. All envelope-borne content
 * (message, names) is escaped before display — it comes from a file.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { AppExporter } from '../export.js';
import { MergerUI } from '../merge/index.js';
import { classifyShareFile } from '../share.js';
import { strings } from '../strings.js';
import { PrivacyMode } from '../privacy.js';
import { EmbeddedDataEnvelope, StromData, TreeId } from '../types.js';
import { uiModule } from './module.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const COLLAB_HIDE_KEY = (treeId: string) => `strom-collab-hide-${treeId}`;

export const shareUiMethods = uiModule({
    /** Pending reply lineage when sharing back from the collaboration bar. */
    shareReplyToExportId: null as string | null,
    /** Reply envelope captured from an in-app HTML import (web-app sender path). */
    pendingReplyEnvelope: null as EmbeddedDataEnvelope | null,

    // ==================== SHARE DIALOG ====================

    showShareDialog(replyToExportId?: string): void {
        const modal = document.getElementById('share-modal');
        if (!modal) return;
        this.shareReplyToExportId = replyToExportId ?? null;

        const nameInput = document.getElementById('share-sender-name') as HTMLInputElement | null;
        if (nameInput) nameInput.value = SettingsManager.getSenderName();
        const msgInput = document.getElementById('share-message') as HTMLTextAreaElement | null;
        if (msgInput) msgInput.value = '';
        const pwdInput = document.getElementById('share-password') as HTMLInputElement | null;
        if (pwdInput) pwdInput.value = '';
        const privacy = document.getElementById('share-privacy-mode') as HTMLSelectElement | null;
        if (privacy) privacy.value = 'initials';
        const scope = document.getElementById('share-scope') as HTMLSelectElement | null;
        if (scope) scope.value = 'whole';

        modal.classList.add('active');
    },

    closeShareDialog(): void {
        document.getElementById('share-modal')?.classList.remove('active');
        this.shareReplyToExportId = null;
    },

    async submitShareDialog(): Promise<void> {
        const treeId = TreeManager.getActiveTreeId();
        if (!treeId) return;

        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
        const senderName = val('share-sender-name').trim() || strings.share.unknownSender;
        SettingsManager.setSenderName(senderName);
        const senderMessage = val('share-message').trim().slice(0, 500) || undefined;
        const password = val('share-password') || null;
        const privacyMode = ((document.getElementById('share-privacy-mode') as HTMLSelectElement | null)?.value || 'initials') as PrivacyMode;
        const scope = (document.getElementById('share-scope') as HTMLSelectElement | null)?.value || 'whole';

        const share = {
            senderName,
            ...(senderMessage ? { senderMessage } : {}),
            ...(this.shareReplyToExportId ? { replyToExportId: this.shareReplyToExportId } : {}),
        };

        this.closeShareDialog();

        if (scope === 'branch') {
            const focusedData = TreeRenderer.getFocusedData();
            const treeName = TreeManager.getActiveTreeMetadata()?.name || 'Family Tree';
            if (!focusedData) return;
            const safe = treeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            await AppExporter.exportFocusAsApp(focusedData, `${safe || 'strom'}-share.html`, password, privacyMode, false,
                { ...share, treeName, trackTreeId: treeId });
        } else {
            await AppExporter.exportApp(treeId, password, privacyMode, false, share);
        }
    },

    // ==================== RECIPIENT: WELCOME + COLLABORATION BAR ====================

    /**
     * Entry point from initViewMode: classify the opened embedded file and show
     * the right surface (reply merge offer > welcome screen > nothing).
     * Returns true when a share surface was shown (the caller skips extras).
     */
    maybeShowShareSurface(): boolean {
        const envelope = DataManager.getEmbeddedEnvelope();
        const kind = classifyShareFile(envelope, (id) => TreeManager.findTreeByExportId(id));
        if (kind.kind === 'reply') {
            this.showShareReplyDialog(kind.tree.id);
            return true;
        }
        if (kind.kind === 'welcome') {
            this.showShareWelcome();
            return true;
        }
        return false;
    },

    showShareWelcome(): void {
        const envelope = DataManager.getEmbeddedEnvelope();
        const modal = document.getElementById('share-welcome-modal');
        if (!envelope || !modal) return;
        const sender = envelope.senderName || strings.share.unknownSender;
        const persons = Object.values(DataManager.getData().persons).filter(p => !p.isPlaceholder).length;

        const title = document.getElementById('share-welcome-title');
        if (title) title.textContent = strings.share.welcomeTitle(sender);
        const counts = document.getElementById('share-welcome-counts');
        if (counts) counts.textContent = strings.share.welcomeCounts(envelope.treeName, persons);
        const msg = document.getElementById('share-welcome-message');
        if (msg) {
            msg.style.display = envelope.senderMessage ? '' : 'none';
            // textContent (not innerHTML) — the message comes from the file.
            msg.textContent = envelope.senderMessage ?? '';
        }
        modal.classList.add('active');
    },

    closeShareWelcome(): void {
        document.getElementById('share-welcome-modal')?.classList.remove('active');
    },

    /** Welcome → "Add what I know": save an editable copy + remember lineage. */
    async shareWelcomeEdit(): Promise<void> {
        const envelope = DataManager.getEmbeddedEnvelope();
        this.closeShareWelcome();
        await this.importAsNew();
        const treeId = DataManager.getCurrentTreeId();
        if (envelope && treeId) {
            TreeManager.setReceivedInfo(treeId, envelope.exportId,
                envelope.senderName || strings.share.unknownSender);
            try { localStorage.removeItem(COLLAB_HIDE_KEY(treeId)); } catch { /* ignore */ }
        }
        this.updateCollabBar();
    },

    /** Show/hide the collaboration bar + badge for the current tree. */
    updateCollabBar(): void {
        const bar = document.getElementById('collab-bar');
        const badge = document.getElementById('collab-badge');
        const treeId = DataManager.getCurrentTreeId();
        const meta = treeId ? TreeManager.getTreeMetadata(treeId) : null;
        const active = !!(meta?.receivedExportId) && !DataManager.isViewMode();
        let hidden = false;
        try { hidden = !!(treeId && localStorage.getItem(COLLAB_HIDE_KEY(treeId)) === '1'); } catch { /* ignore */ }

        if (bar) {
            bar.style.display = active && !hidden ? '' : 'none';
            if (active && !hidden) {
                const text = document.getElementById('collab-bar-text');
                if (text) text.textContent = strings.share.collabBar(meta!.receivedFrom || strings.share.unknownSender);
            }
        }
        if (badge) {
            badge.style.display = active && hidden ? '' : 'none';
            badge.title = strings.share.collabBadgeTitle;
        }
    },

    hideCollabBar(): void {
        const treeId = DataManager.getCurrentTreeId();
        if (treeId) { try { localStorage.setItem(COLLAB_HIDE_KEY(treeId), '1'); } catch { /* ignore */ } }
        this.updateCollabBar();
    },

    showCollabBarFromBadge(): void {
        const treeId = DataManager.getCurrentTreeId();
        if (treeId) { try { localStorage.removeItem(COLLAB_HIDE_KEY(treeId)); } catch { /* ignore */ } }
        this.updateCollabBar();
    },

    /** Collaboration bar → reply export with the remembered lineage. */
    shareBack(): void {
        const treeId = DataManager.getCurrentTreeId();
        const meta = treeId ? TreeManager.getTreeMetadata(treeId) : null;
        this.showShareDialog(meta?.receivedExportId);
    },

    // ==================== SENDER: REPLY DETECTION ====================

    /**
     * In-app HTML import path (the web-app sender opens the returned file via
     * Import): when the file replies to one of my trees, offer the merge here.
     * Returns true when handled (the caller skips the regular import flow).
     */
    handleImportedShareEnvelope(envelope: EmbeddedDataEnvelope): boolean {
        const kind = classifyShareFile(envelope, (id) => TreeManager.findTreeByExportId(id));
        if (kind.kind !== 'reply') return false;
        if (envelope.data && typeof envelope.data === 'object' && 'encrypted' in envelope.data) {
            return false; // encrypted import path handles its own messaging
        }
        this.pendingReplyEnvelope = envelope;
        this.showShareReplyDialog(kind.tree.id, envelope);
        return true;
    },

    showShareReplyDialog(targetTreeId: TreeId, importedEnvelope?: EmbeddedDataEnvelope): void {
        const envelope = importedEnvelope ?? DataManager.getEmbeddedEnvelope();
        const modal = document.getElementById('share-reply-modal');
        if (!envelope || !modal) return;
        const sender = envelope.senderName || strings.share.unknownSender;
        const target = TreeManager.getTreeMetadata(targetTreeId);

        const title = document.getElementById('share-reply-title');
        if (title) title.textContent = strings.share.replyTitle(sender);
        const intro = document.getElementById('share-reply-intro');
        if (intro) intro.textContent = strings.share.replyIntro(target?.name || envelope.treeName);
        const msg = document.getElementById('share-reply-message');
        if (msg) {
            msg.style.display = envelope.senderMessage ? '' : 'none';
            msg.textContent = envelope.senderMessage ?? '';
        }
        modal.dataset.targetTreeId = targetTreeId;
        modal.classList.add('active');
    },

    closeShareReplyDialog(): void {
        document.getElementById('share-reply-modal')?.classList.remove('active');
    },

    /** Reply → merge: open my tree and start the merge wizard with the file's data. */
    async shareReplyMerge(): Promise<void> {
        const modal = document.getElementById('share-reply-modal');
        const targetTreeId = modal?.dataset.targetTreeId as TreeId | undefined;
        const imported = this.pendingReplyEnvelope;
        const envelope = imported ?? DataManager.getEmbeddedEnvelope();
        if (!targetTreeId || !envelope) return;
        const sender = envelope.senderName || strings.share.unknownSender;

        // Incoming data: from the imported file's envelope (in-app import path)
        // or from the currently viewed embedded data (file:// view-mode path) —
        // captured BEFORE leaving view mode (switchTree replaces it).
        const incoming: StromData = imported
            ? structuredClone(imported.data as StromData)
            : structuredClone(DataManager.getData());

        this.closeShareReplyDialog();
        this.pendingReplyEnvelope = null;
        if (imported) {
            if (DataManager.getCurrentTreeId() !== targetTreeId) {
                await DataManager.switchTree(targetTreeId);
            }
        } else {
            await DataManager.leaveViewModeToTree(targetTreeId);
            this.hideViewModeBanner();
        }
        this.updateTreeSwitcher();
        await TreeRenderer.renderAsync();
        MergerUI.startMerge(incoming, sender);
    },

    /** Reply → import as a completely new tree (fallback). */
    async shareReplyImport(): Promise<void> {
        const imported = this.pendingReplyEnvelope;
        this.closeShareReplyDialog();
        this.pendingReplyEnvelope = null;
        if (imported) {
            await DataManager.importAsNewTree(structuredClone(imported.data as StromData), imported.treeName);
            this.updateTreeSwitcher();
            await TreeRenderer.renderAsync();
            return;
        }
        await this.importAsNew();
    },
});
