/**
 * "Start research with this tree" (G3): an app tree becomes a Strom Research
 * tree without a copy. The app hands the research a one-time token through a
 * strom-research://new link; the research sets itself up in the terminal and
 * comes back with ?adopt=<bridge>, asking for the tree by that token. The user
 * confirms, the app POSTs the tree as GEDCOM and links it to the research
 * tree it gets back — from then on it is a research tree like any other
 * (Research menu, "In the research" …). Nothing changes in the app's data.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { TreeId, TreeMetadata } from '../types.js';
import { SettingsManager } from '../settings.js';
import { countImages, stripMedia } from '../attachments.js';
import { exportToGedcom } from '../ged-exporter.js';
import {
    parseLiveBridge, sanitizeAdoptOffer, sanitizeAdoptReply, newAdoptToken, researchNewUrl, contentFingerprint,
    AdoptOffer,
} from '../research-link.js';
import { uiModule } from './module.js';
import { onComputer, fetchWithTimeout, postSync, postCancel, readTree } from './research-ui.js';
import { normalizeModal } from './modal-skeleton.js';

const ADOPT_ID = 'research-adopt-modal';
/** How long the research has to come back for the tree. */
const TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
/** Strom Research takes photos and attachments over with a tree (not yet: it skips data URLs). */
const RESEARCH_TAKES_IMAGES = false;

/** HTML-escape a string for innerHTML (text and attribute values). */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const researchAdoptMethods = uiModule({
    /**
     * "Start research with this tree" can be offered for `tree`: on a
     * computer whose research announced `new`, a tree with people that is not
     * a research tree yet.
     */
    researchAdoptAvailable(tree: TreeMetadata | null | undefined): boolean {
        return !!tree && !tree.research && tree.personCount > 0 && !DataManager.isViewMode()
            && onComputer() && this.researchLinkAvailable('new');
    },

    /** The active tree can be handed over (the explanation dialog's variant). */
    researchAdoptActiveAvailable(): boolean {
        return this.researchAdoptAvailable(TreeManager.getActiveTreeMetadata());
    },

    /** Hand `treeId` a token and open the research's set-up in the terminal. */
    startResearchAdopt(treeId: TreeId): void {
        const token = newAdoptToken();
        const url = researchNewUrl(token);
        if (!url || !TreeManager.getTreeMetadata(treeId)) return;
        TreeManager.setResearchAdoptToken(treeId, { token, at: new Date().toISOString() });
        this.handOverResearchLink(url);
        // No time limit: setting up takes as long as it takes. Closing the
        // toast keeps the token — the research can still come back.
        this.showToast(strings.research.awaitingAdopt, Infinity, { spinner: true, closable: true, kind: 'adopt' });
    },

    /** Tree manager row menu: start research with that tree. */
    treeActionStartResearch(treeId: TreeId): void {
        document.querySelectorAll('.tree-row-menu.open').forEach(m => m.classList.remove('open'));
        this.startResearchAdopt(treeId);
    },

    /**
     * ?adopt=<bridge>: the research came back for the tree. It names the tree
     * by its token; the user decides whether it goes over.
     */
    async adoptFromResearch(raw: string): Promise<void> {
        const r = strings.research;
        const bridge = parseLiveBridge(raw);
        if (!bridge) {
            this.showToast(r.notLocal, 6000);
            return;
        }
        const cancelUrl = `${bridge.base}/cancel`;
        document.querySelector('.toast')?.remove();
        let offer: AdoptOffer | null = null;
        try {
            const res = await fetchWithTimeout(`${bridge.base}/adopt`, 10000);
            if (res.ok) offer = sanitizeAdoptOffer(await res.json());
        } catch (err) {
            console.warn('The research bridge did not answer', err);
        }
        const tree = offer ? TreeManager.findTreeByAdoptToken(offer.token, TOKEN_MAX_AGE_MS) : null;
        if (!offer || !tree) {
            postCancel(cancelUrl, 'no-tree');
            this.showToast(r.adoptUnknown, 6000);
            return;
        }
        if (DataManager.isViewMode() || !await this.ensureLocalUnlocked()) {
            postCancel(cancelUrl, 'cancelled');
            return;
        }
        const data = TreeManager.isTreeUnreadable(tree.id) ? null : await readTree(tree.id);
        if (!data) {
            postCancel(cancelUrl, 'cancelled');
            await this.showAlert(strings.storageSafety.treeLocked, 'warning');
            return;
        }
        // The tree going over is the one on screen behind the dialog.
        if (DataManager.getCurrentTreeId() !== tree.id) await this.switchToTree(tree.id);
        const choice = await this.askResearchAdopt(tree, offer, data);
        if (choice === null) {
            postCancel(cancelUrl, 'cancelled');
            return;
        }
        // The research does not take photos over yet: they stay here only.
        const gedcom = exportToGedcom(choice.images ? data : stripMedia(data), tree.name).content;
        let reply: { tree: string; head: string | null } | null = null;
        try {
            const res = await postSync(`${bridge.base}/adopt`, gedcom, 120000);
            if (res.ok) reply = sanitizeAdoptReply(await res.json());
        } catch (err) {
            console.warn('Handing the tree to the research failed', err);
        }
        if (!reply) {
            await this.showAlert(r.adoptFailed, 'error');
            return;
        }
        TreeManager.setResearchLink(tree.id, {
            id: reply.tree,
            fingerprint: contentFingerprint(data),
            syncedAt: new Date().toISOString(),
            ...(reply.head ? { head: reply.head } : {}),
        });
        TreeManager.setResearchAdoptToken(tree.id, null);
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        this.refreshActionMenuBadges();
        TreeRenderer.render();
        this.showToast(r.adopted(tree.name), 6000);
    },

    /**
     * "Hand the tree to the research?" — what goes over (people, families,
     * sources; photos and attachments by choice). Resolves null for "Don't
     * hand over". A decision: no ×, Escape = don't.
     */
    askResearchAdopt(tree: TreeMetadata, offer: AdoptOffer, data: ReturnType<typeof DataManager.getData>): Promise<{ images: boolean } | null> {
        document.getElementById(ADOPT_ID)?.remove();
        const r = strings.research;
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const families = Object.keys(data.partnerships).length;
        const sources = Object.keys(data.sources ?? {}).length;
        const images = countImages(data);
        // "Include photos and attachments" waits until the research takes them over.
        const files = RESEARCH_TAKES_IMAGES ? images.photos + images.attachments + images.excerpts : 0;
        const summary = [strings.about.stats.persons(persons), strings.about.stats.families(families),
            strings.personSources.countSub(sources)].join(' · ');
        const researchName = offer.name || r.defaultName;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = ADOPT_ID;
        overlay.innerHTML = `
            <div class="modal modal--sm research-adopt-modal" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="research-adopt-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="research-adopt-title">${esc(r.adoptTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(`${tree.name} → ${r.adoptTarget(researchName)}`)}</div>
                    </div>
                </div>
                <p class="research-adopt-summary">${esc(summary)}</p>
                ${files > 0 ? `
                <label class="research-adopt-images">
                    <input type="checkbox" id="research-adopt-images"${SettingsManager.isImportImages() ? ' checked' : ''}>
                    <span>${esc(r.adoptImages)} <span class="research-adopt-size">${esc(r.adoptImagesSize(files, (images.bytes / (1024 * 1024)).toFixed(1)))}</span></span>
                </label>` : ''}
                <p class="research-adopt-after">${esc(r.adoptAfter)}</p>
                <div class="buttons">
                    <button type="button" class="secondary" id="research-adopt-cancel" data-dismiss>${esc(r.adoptCancel)}</button>
                    <button type="button" class="primary" id="research-adopt-confirm">${esc(r.adoptConfirm)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.clearDialogStack();
        this.pushDialog(ADOPT_ID);
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        return new Promise((resolve) => {
            const finish = (value: { images: boolean } | null): void => {
                this.closeResearchAdoptDialog();
                resolve(value);
            };
            this.researchAdoptResolve = () => finish(null);
            (overlay.querySelector('#research-adopt-cancel') as HTMLButtonElement).onclick = () => finish(null);
            (overlay.querySelector('#research-adopt-confirm') as HTMLButtonElement).onclick = () => {
                const box = overlay.querySelector<HTMLInputElement>('#research-adopt-images');
                finish({ images: box ? box.checked : false });
            };
            (overlay.querySelector('#research-adopt-confirm') as HTMLButtonElement).focus();
        });
    },

    /** Escape on the adopt dialog = "Don't hand over". */
    cancelResearchAdoptDialog(): void {
        const resolve = this.researchAdoptResolve;
        if (resolve) resolve();
        else this.closeResearchAdoptDialog();
    },

    closeResearchAdoptDialog(): void {
        this.researchAdoptResolve = null;
        document.getElementById(ADOPT_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== ADOPT_ID);
    },
});
