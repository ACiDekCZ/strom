/**
 * The one-time notice of a tree the repair of shared research ties took off
 * its research (package 134 point 13, TreeManager.repairSharedResearchTies):
 * at the first opening of that tree, once. It says what happened, how a
 * research of its own is started (the action "Start research" where it is
 * offered) and — when the copy had sent changes there — how the research
 * takes them back (`strom sync undo I…` in its terminal).
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeId } from '../types.js';
import { researchLinkMark } from '../research-link.js';
import { researchActionLabel } from './research-open-mark.js';
import { bindResearchUndoStep, researchUndoStep, researchUndoStepHtml } from './research-undo-step.js';
import { normalizeModal } from './modal-skeleton.js';
import { uiModule } from './module.js';

const DETACHED_ID = 'research-detached-modal';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dayOf(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(getCurrentLanguage());
}

export const researchDetachedMethods = uiModule({
    /** The notice follows the open tree: at start and at every switch. */
    initResearchDetachedNotice(): void {
        this.maybeShowResearchDetached();
        window.addEventListener('strom:tree-switched', () => this.maybeShowResearchDetached());
    },

    /** The open tree was taken off a shared research and has not said so yet: once, now. */
    maybeShowResearchDetached(): void {
        const tree = TreeManager.getActiveTreeMetadata();
        if (!tree?.researchDetached || tree.researchDetached.noticed || DataManager.isViewMode()) return;
        if (DataManager.getCurrentTreeId() !== tree.id) return;
        this.showResearchDetached(tree.id);
    },

    showResearchDetached(treeId: TreeId): void {
        const tree = TreeManager.getTreeMetadata(treeId);
        const mark = tree?.researchDetached;
        if (!tree || !mark || document.getElementById(DETACHED_ID)) return;
        // Shown once: the mark is stored as it opens (closing it any way is the same).
        TreeManager.markResearchDetachedNoticed(treeId);
        const r = strings.research;
        const sent = mark.sentAfterCopy;
        // The research's input of that send, when its status here names it (`/status.sends`).
        const intake = mark.link.sent?.intake;
        const input = sent && intake
            ? this.researchStatusOf(mark.link.id)?.sends?.find(s => s.intake === intake)?.input ?? null : null;
        const step = researchUndoStep(mark.link.id, input, this.researchLinkAvailable('sync-undo'));
        let sentHtml = '';
        if (sent) {
            const day = dayOf(sent.at);
            sentHtml = sent.state === 'pending'
                ? `<p class="research-detached-sent">${esc(r.detachedSent(day))} ${esc(r.detachedPending)}</p>`
                : researchUndoStepHtml(step, { lead: `${r.detachedSent(day)} ${r.detachedUndoStep}`, leadClass: 'research-detached-sent', cmdClass: 'research-detached-cmd' });
        }
        const canStart = this.researchAdoptAvailable(tree);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = DETACHED_ID;
        overlay.innerHTML = `
            <div class="modal modal--sm research-detached-modal" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="research-detached-title">
                <div class="modal-header">
                    <h2 id="research-detached-title">${esc(r.detachedTitle)}</h2>
                    <button type="button" class="close-btn" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="modal-content install-body">
                    <p>${esc(r.detachedText(tree.name, mark.keeper.name))}</p>
                    ${sentHtml}
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>${canStart ? `
                    <button type="button" class="primary" data-act="start">${researchActionLabel(r.adoptTree, researchLinkMark('new'))}</button>` : ''}
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(DETACHED_ID);
        const close = (): void => this.closeResearchDetached();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('.close-btn')?.addEventListener('click', close);
        overlay.querySelector('[data-dismiss]')?.addEventListener('click', close);
        overlay.querySelector('[data-act="start"]')?.addEventListener('click', () => {
            close();
            this.treeActionStartResearch(treeId);
        });
        bindResearchUndoStep(overlay, step, url => void this.launchResearchLink(url), () => this.showToast(strings.install.copyManual, 6000));
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        overlay.querySelector<HTMLElement>('.buttons .primary, [data-dismiss]')?.focus();
    },

    closeResearchDetached(): void {
        document.getElementById(DETACHED_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DETACHED_ID);
    },
});

