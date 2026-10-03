/**
 * "Start research with this tree" (G3): an app tree becomes a Strom Research
 * tree without a copy. The app hands the research a one-time token through a
 * strom-research://new link; the research sets itself up in the terminal and
 * comes back with ?adopt=<bridge>, asking for the tree by that token. The user
 * confirms, the app POSTs the tree as GEDCOM and links it to the research
 * tree it gets back — from then on it is a research tree like any other
 * (Research menu, the person menu's "Research ›" …). Nothing changes in the app's data.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { TreeId, TreeMetadata, StromData, STROM_DATA_VERSION } from '../types.js';
import { readInstallRecord, installPhase, INSTALL_TTL_MS } from '../research-install.js';
import { noteResearchBridge } from '../research-device.js';
import { SettingsManager } from '../settings.js';
import { countImages, stripMedia } from '../attachments.js';
import { exportToGedcom } from '../ged-exporter.js';
import {
    parseLiveBridge, sanitizeAdoptOffer, sanitizeAdoptReply, newAdoptToken, researchNewUrl, contentFingerprint, researchSchemeUrl,
    AdoptOffer,
} from '../research-link.js';
import { uiModule } from './module.js';
import { onComputer, fetchWithTimeout, fetchStatus, postSync, postCancel, readTree, CONNECT_TIMEOUT_MS } from './research-ui.js';
import { normalizeModal } from './modal-skeleton.js';

const ADOPT_ID = 'research-adopt-modal';
const READY_ID = 'research-ready-modal';
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
        if (!tree || tree.research || DataManager.isViewMode() || !onComputer() || !this.researchLinkAvailable('new')) return false;
        // The open tree counts from its data: the metadata catch up only when it is saved.
        const people = DataManager.getCurrentTreeId() === tree.id
            ? Object.values(DataManager.getData().persons).some(p => !p.isPlaceholder)
            : tree.personCount > 0;
        return people;
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
            const res = await this.connectResearchBridge(() => fetchWithTimeout(`${bridge.base}/adopt`, CONNECT_TIMEOUT_MS));
            if (res.ok) offer = sanitizeAdoptOffer(await res.json());
        } catch (err) {
            console.warn('The research bridge did not answer', err);
            // Not reached at all (the local network blocked, or the research gone): say so.
            if (await this.showResearchConnectFailed(err, { param: 'adopt', value: raw })) void this.adoptFromResearch(raw);
            return;
        }
        // Installed from the app: its token holds 24 h, and from the welcome
        // screen (no tree yet) the research gets a new empty tree.
        const install = readInstallRecord();
        const fromInstall = !!offer && install?.token === offer.token && installPhase(install) !== 'expired';
        let tree = offer ? TreeManager.findTreeByAdoptToken(offer.token, fromInstall ? INSTALL_TTL_MS : TOKEN_MAX_AGE_MS) : null;
        let fresh: StromData | null = null;
        if (!tree && fromInstall && offer && install) {
            const id = TreeManager.createTree(offer.name || strings.install.newTreeName);
            TreeManager.setResearchAdoptToken(id, { token: offer.token, at: install.createdAt });
            tree = TreeManager.getTreeMetadata(id);
            fresh = { version: STROM_DATA_VERSION, persons: {}, partnerships: {} };
            this.updateTreeSwitcher();
        }
        if (!offer || !tree) {
            postCancel(cancelUrl, 'no-tree');
            this.showToast(r.adoptUnknown, 6000);
            return;
        }
        if (DataManager.isViewMode() || !await this.ensureLocalUnlocked()) {
            postCancel(cancelUrl, 'cancelled');
            return;
        }
        const data = fresh ?? (TreeManager.isTreeUnreadable(tree.id) ? null : await readTree(tree.id));
        if (!data) {
            postCancel(cancelUrl, 'cancelled');
            await this.showAlert(strings.storageSafety.treeLocked, 'warning');
            return;
        }
        // The tree going over is the one on screen behind the dialog.
        if (DataManager.getCurrentTreeId() !== tree.id) await this.switchToTree(tree.id);
        const choice = await this.askResearchAdopt(tree, offer, data, { install: fromInstall });
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
        // The bridge that took the tree is the research's own: the tree is
        // connected now (sending by itself, the state in the bar), not only
        // after the research opens the app again.
        let status: Awaited<ReturnType<typeof fetchStatus>> = null;
        try { status = await fetchStatus(`${bridge.base}/status`, 4000); } catch { /* connected at the next open */ }
        if (status?.treeId !== reply.tree) noteResearchBridge(reply.tree, bridge.base);
        this.refreshResearchSyncUi();
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        this.refreshActionMenuBadges();
        TreeRenderer.render();
        if (fromInstall) {
            this.finishResearchInstall(offer.token);
            const hasPeople = Object.values(data.persons).some(p => !p.isPlaceholder);
            void this.showResearchReady(bridge.base, reply.tree, offer.name || r.defaultName, hasPeople);
            return;
        }
        this.showToast(r.adopted(tree.name), 6000);
    },

    /**
     * After an installation from the app, once: what the research now does
     * for the tree (where it is, the agent, the originals) — or, for an empty
     * tree, how to start it. Later only the bar shows the state.
     */
    async showResearchReady(base: string, researchId: string, researchName: string, hasPeople: boolean): Promise<void> {
        const s = strings.install;
        let where = '';
        let agent = '';
        try {
            const res = await fetchWithTimeout(`${base}/status`, 3000);
            if (res.ok) {
                const st = await res.json() as { path?: unknown; agent?: unknown };
                if (typeof st.path === 'string') where = st.path.slice(0, 300);
                // `agent: { id, name, where? }` (an archive has none); a bare name from an older shape too.
                const named = st.agent && typeof st.agent === 'object' ? (st.agent as { name?: unknown }).name : st.agent;
                if (typeof named === 'string') agent = named.slice(0, 60);
            }
        } catch { /* the rows the status gives are left out */ }
        document.getElementById(READY_ID)?.remove();
        const open = this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: researchId }) : null;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = READY_ID;
        const rows = hasPeople ? `
                <dl class="install-ready-rows">
                    ${where ? `<dt>${esc(s.where)}</dt><dd class="install-ready-path">${esc(where)}</dd>` : ''}
                    <dt>${esc(s.agentRowLabel)}</dt><dd>${esc(agent ? s.agentRowOn(agent) : s.agentRow)}</dd>
                    <dt>${esc(s.originalsLabel)}</dt><dd>${esc(s.originalsRow)}</dd>
                </dl>` : '';
        overlay.innerHTML = `
            <div class="modal modal--sm research-ready-modal" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="research-ready-title">
                <div class="modal-header">
                    <h2 id="research-ready-title"><span class="install-ready-check" aria-hidden="true">✓</span> ${esc(hasPeople ? s.readyTitle : s.liveTitle(researchName))}</h2>
                </div>
                <div class="modal-content">
                    <p>${esc(hasPeople ? s.readyText : s.liveText)}</p>
                    ${rows}
                </div>
                <div class="buttons">
                    ${hasPeople
                        ? `${open ? `<button type="button" class="link-button" data-act="open">${esc(s.openResearch)}</button>` : ''}
                           <button type="button" class="primary" data-act="done" data-dismiss>${esc(s.done)}</button>`
                        : `<button type="button" class="secondary" data-act="gedcom">${esc(s.openGedcom)}</button>
                           <button type="button" class="primary" data-act="first" data-dismiss>${esc(s.addFirst)}</button>`}
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(READY_ID);
        const close = (): void => this.closeResearchReady();
        overlay.querySelectorAll<HTMLElement>('[data-act]').forEach(el => el.addEventListener('click', () => {
            const act = el.dataset.act;
            close();
            if (act === 'open' && open) this.handOverResearchLink(open);
            else if (act === 'gedcom') this.startGedcomImportPlain();
            else if (act === 'first') this.showAddPersonModal();
        }));
        overlay.querySelector<HTMLElement>('.primary')?.focus();
    },

    closeResearchReady(): void {
        document.getElementById(READY_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== READY_ID);
    },

    /**
     * "Hand the tree to the research?" — what goes over (people, families,
     * sources; photos and attachments by choice). Resolves null for "Don't
     * hand over". A decision: no ×, Escape = don't.
     */
    askResearchAdopt(tree: TreeMetadata, offer: AdoptOffer, data: ReturnType<typeof DataManager.getData>, opts: { install?: boolean } = {}): Promise<{ images: boolean } | null> {
        document.getElementById(ADOPT_ID)?.remove();
        const r = strings.research;
        // Everyone goes over, the unnamed too (the research counts them).
        const persons = Object.keys(data.persons).length;
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
                        <h2 id="research-adopt-title">${esc(opts.install ? strings.install.adoptTitle : r.adoptTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(opts.install ? strings.install.adoptSub(tree.name, persons, researchName) : `${tree.name} → ${r.adoptTarget(researchName)}`)}</div>
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
