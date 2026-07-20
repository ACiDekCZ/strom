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
    /** Change packet awaiting Accept / Review in the preview dialog. */
    pendingChangePacket: null as import('../share-diff.js').ChangePacket | null,
    /** The baseline the pending packet was built against (for the merge path). */
    pendingChangePacketBase: null as StromData | null,

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
        // Reveal "send only changes" only when a baseline exists for this tree.
        void this.refreshShareScopeOption();
        this.onShareScopeChange();

        modal.classList.add('active');
    },

    /** Show the "only changes" scope option when a usable baseline exists. */
    async refreshShareScopeOption(): Promise<void> {
        const opt = document.getElementById('share-scope-changes') as HTMLOptionElement | null;
        if (!opt) return;
        const treeId = TreeManager.getActiveTreeId();
        const meta = treeId ? TreeManager.getTreeMetadata(treeId) : null;
        let show = false;
        if (meta?.receivedExportId) {
            const { hasBaseline } = await import('../share-baselines.js');
            show = await hasBaseline(meta.receivedExportId);
        }
        opt.style.display = show ? '' : 'none';
    },

    /** Change-packets carry no privacy/password — hide those inputs for it. */
    onShareScopeChange(): void {
        const isChanges = (document.getElementById('share-scope') as HTMLSelectElement | null)?.value === 'changes';
        const priv = (document.getElementById('share-privacy-mode') as HTMLElement | null)?.closest('.form-group') as HTMLElement | null;
        const pwd = (document.getElementById('share-password') as HTMLElement | null)?.closest('.form-group') as HTMLElement | null;
        if (priv) priv.style.display = isChanges ? 'none' : '';
        if (pwd) pwd.style.display = isChanges ? 'none' : '';
        // One narration line explaining where the change file should go.
        const hint = document.getElementById('share-changes-hint') as HTMLElement | null;
        if (hint) hint.style.display = isChanges ? '' : 'none';
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

        if (scope === 'changes') {
            await this.exportChangePacket(treeId, senderName, senderMessage);
            return;
        }

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
            // Keep the received data as a baseline so B can later send only changes.
            const { saveBaseline } = await import('../share-baselines.js');
            void saveBaseline(treeId, envelope.exportId, DataManager.getData(), Date.now()).catch(() => {});
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

    /** Export a small change packet (current tree vs the shared baseline). */
    async exportChangePacket(treeId: TreeId, senderName: string, senderMessage?: string): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId);
        const baseId = meta?.receivedExportId;
        if (!baseId) return;
        const { loadBaseline } = await import('../share-baselines.js');
        const base = await loadBaseline(baseId);
        if (!base) { this.showAlert(strings.shareDiff.baselineMissing, 'warning'); return; }

        const { buildChangePacket, isEmptyPacket } = await import('../share-diff.js');
        const treeName = meta?.name;
        const packet = buildChangePacket(base, DataManager.getData(), { baseExportId: baseId, senderName, ...(senderMessage ? { senderMessage } : {}), ...(treeName ? { treeName } : {}) });
        if (isEmptyPacket(packet)) { this.showToast(strings.shareDiff.noChanges); return; }

        const safe = (treeName || 'strom').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${safe || 'strom'}.strom-changes.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.showToast(strings.shareDiff.packetSaved);
    },

    /**
     * Open a change packet: find the tree it was based on, switch to it, and show
     * a dedicated preview of what it changes. From there the user can Accept (a
     * direct, undoable apply) or Review in detail (the full merge engine). The
     * heavy merge wizard is no longer the only door.
     */
    async importChangePacket(packet: import('../share-diff.js').ChangePacket): Promise<void> {
        const { loadBaseline, getBaselineTreeId } = await import('../share-baselines.js');
        // Primary: the tree whose lastExportId is the packet's base. Fallback: the
        // tree recorded on the local baseline (survives a re-export since sharing).
        let tree = TreeManager.findTreeByExportId(packet.baseExportId);
        if (!tree) {
            const treeId = await getBaselineTreeId(packet.baseExportId);
            if (treeId) tree = TreeManager.getTreeMetadata(treeId as TreeId);
        }
        if (!tree) { this.showAlert(strings.shareDiff.treeNotFound, 'warning'); return; }
        const base = await loadBaseline(packet.baseExportId);
        if (!base) { this.showAlert(strings.shareDiff.baselineMissing, 'warning'); return; }

        if (TreeManager.getActiveTreeId() !== tree.id) {
            await DataManager.switchTree(tree.id);
            this.updateTreeSwitcher();
            await TreeRenderer.renderAsync();
        }

        // Summarise against the CURRENT tree — that is what the recipient gains.
        const { summarizeChangePacket } = await import('../share-diff.js');
        const summary = summarizeChangePacket(DataManager.getData(), packet);
        if (!summary.hasEffect) {
            // Idempotent: a packet re-opened after it was already applied.
            await this.showAlert(strings.shareDiff.alreadyApplied, 'info');
            return;
        }

        this.pendingChangePacket = packet;
        this.pendingChangePacketBase = base;
        this.showChangePacketPreview(packet, summary, tree.name);
    },

    /** Populate and show the change-packet preview dialog. */
    showChangePacketPreview(
        packet: import('../share-diff.js').ChangePacket,
        summary: import('../share-diff.js').PacketSummary,
        treeName?: string
    ): void {
        const modal = document.getElementById('share-packet-modal');
        if (!modal) return;
        const sender = packet.senderName || strings.share.unknownSender;

        const title = document.getElementById('share-packet-title');
        if (title) title.textContent = strings.shareDiff.previewTitle(sender);
        const intro = document.getElementById('share-packet-intro');
        if (intro) intro.textContent = strings.shareDiff.previewIntro(treeName || packet.treeName || '');
        const msg = document.getElementById('share-packet-message');
        if (msg) {
            msg.style.display = packet.senderMessage ? '' : 'none';
            // textContent (not innerHTML) — the message comes from the file.
            msg.textContent = packet.senderMessage ?? '';
        }
        const body = document.getElementById('share-packet-body');
        if (body) body.innerHTML = this.renderPacketSummary(summary);

        modal.classList.add('active');
    },

    /** Build the escaped HTML body of the preview (stats chips + named lists). */
    renderPacketSummary(summary: import('../share-diff.js').PacketSummary): string {
        const CAP = 25;
        const chips: string[] = [];
        if (summary.newPersons.length) chips.push(strings.shareDiff.newPeople(summary.newPersons.length));
        if (summary.modifiedPersons.length) chips.push(strings.shareDiff.updatedPeople(summary.modifiedPersons.length));
        if (summary.mediaCount) chips.push(strings.shareDiff.media(summary.mediaCount));
        if (summary.placeCount) chips.push(strings.shareDiff.placesChip(summary.placeCount));
        if (summary.surnameGroupCount) chips.push(strings.shareDiff.surnameGroups(summary.surnameGroupCount));
        if (summary.removedPersonCount) chips.push(strings.shareDiff.removed(summary.removedPersonCount));

        let html = `<div class="share-packet-stats">${chips.map(c => `<span class="share-packet-chip">${esc(c)}</span>`).join('')}</div>`;

        if (summary.newPersons.length) {
            const shown = summary.newPersons.slice(0, CAP).map(p => esc(p.name));
            if (summary.newPersons.length > CAP) shown.push(esc(strings.shareDiff.andMore(summary.newPersons.length - CAP)));
            html += `<div class="share-packet-section"><h3>${esc(strings.shareDiff.sectionNew)}</h3><p>${shown.join(', ')}</p></div>`;
        }

        if (summary.modifiedPersons.length) {
            const labels = strings.labels as unknown as Record<string, string>;
            const rows = summary.modifiedPersons.slice(0, CAP).map(m => {
                const fields = m.changedFieldKeys
                    .map(k => k === 'fieldOther' ? strings.shareDiff.fieldOther : (labels[k] ?? k))
                    .join(', ');
                const tail = fields ? ` — <span class="share-packet-fields">${esc(strings.shareDiff.changedFields(fields))}</span>` : '';
                return `<li>${esc(m.name)}${tail}</li>`;
            });
            if (summary.modifiedPersons.length > CAP) {
                rows.push(`<li>${esc(strings.shareDiff.andMore(summary.modifiedPersons.length - CAP))}</li>`);
            }
            html += `<div class="share-packet-section"><h3>${esc(strings.shareDiff.sectionUpdated)}</h3><ul>${rows.join('')}</ul></div>`;
        }

        return html;
    },

    /** Accept: apply the packet directly onto the current tree, one undo step. */
    async acceptChangePacket(): Promise<void> {
        const packet = this.pendingChangePacket;
        if (!packet) return;
        // Compute the applied counts BEFORE the tree changes (for the toast).
        const { summarizeChangePacket } = await import('../share-diff.js');
        const summary = summarizeChangePacket(DataManager.getData(), packet);
        this.closeChangePacketPreview();

        DataManager.applyChangePacketDirect(packet);
        await TreeRenderer.renderAsync();
        this.showToast(strings.shareDiff.applied(summary.newPersons.length, summary.modifiedPersons.length));
    },

    /** Review in detail: hand the reconstructed incoming tree to the merge engine. */
    async reviewChangePacketInMerge(): Promise<void> {
        const packet = this.pendingChangePacket;
        const base = this.pendingChangePacketBase;
        if (!packet || !base) return;
        this.closeChangePacketPreview();

        const { applyChangePacket } = await import('../share-diff.js');
        const incoming = applyChangePacket(base, packet);
        MergerUI.startMerge(incoming, packet.senderName || strings.share.unknownSender);
    },

    closeChangePacketPreview(): void {
        document.getElementById('share-packet-modal')?.classList.remove('active');
        this.pendingChangePacket = null;
        this.pendingChangePacketBase = null;
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
