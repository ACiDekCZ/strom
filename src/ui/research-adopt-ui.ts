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
import { strings, getCurrentLanguage } from '../strings.js';
import { AppBrowser, appBrowserName, bridgeMovesTrees, bridgeTakesEmpty, currentAppBrowser, needsTransfer, readTransferJson } from '../research-transfer.js';
import { validateJsonImport } from '../merge/validation.js';
import { TreeId, TreeMetadata, StromData, STROM_DATA_VERSION, ResearchSendMode } from '../types.js';
import { readInstallRecord, clearInstallRecord, installPhase, INSTALL_TTL_MS } from '../research-install.js';
import { noteResearchBridge, patchResearchAutoState, announcedResearchScheme } from '../research-device.js';
import { SettingsManager } from '../settings.js';
import { countImages, stripMedia } from '../attachments.js';
import { exportToGedcom, countFamilies } from '../ged-exporter.js';
import {
    parseLiveBridge, sanitizeAdoptOffer, sanitizeAdoptReply, newAdoptToken, researchNewUrl, contentFingerprint, researchSchemeUrl,
    readResearchHeader, applyAdoptIds, AdoptOffer, AdoptIds, researchGedcomTitles, TitlesInGedcom,
} from '../research-link.js';
import { uiModule } from './module.js';
import { onComputer, fetchWithTimeout, fetchStatus, fetchGedcomText, postSync, postCancel, readTree, CONNECT_TIMEOUT_MS } from './research-ui.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { normalizeModal } from './modal-skeleton.js';
import { canPromptInstall, promptInstall } from '../pwa.js';
import { setPendingAdopt, clearPendingAdopt } from './pending-adopt.js';
import { researchSendModeCardsHtml, researchSendPrinciplesHtml, researchSendModeChecked, researchTrialTagHtml } from './research-tree-settings-ui.js';
import { researchSendMode } from './research-sync-ui.js';

const ADOPT_ID = 'research-adopt-modal';
const ELSEWHERE_ID = 'research-elsewhere-modal';
/** A transfer file carries the whole tree with its images: time to read a large one from the bridge. */
const TRANSFER_TIMEOUT_MS = 120_000;
const READY_ID = 'research-ready-modal';
/** The app's own (green) icon, as in icon.svg: beside the offer, it tells this app from Safari's muted one. */
const APP_ICON_SVG = '<svg class="install-ready-app-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.3" fill="#3f6b4f"/><g transform="translate(3.6 3.6) scale(0.7)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z"/><path d="M12 19v3"/></g></svg>';
/** How long the research has to come back for the tree. */
const TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
/** Strom Research takes photos and attachments over with a tree (not yet: it skips data URLs). */
const RESEARCH_TAKES_IMAGES = false;
/** Tries at the research's version right after a hand-over (ms to wait before each): it may write it a moment later. */
const ADOPT_LOAD_WAITS = [0, 1000, 3000];

/** HTML-escape a string for innerHTML (text and attribute values). */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Whether the research behind this bridge moves a tree from another browser
 * (its /status, read without noting anything: the research waits with an
 * empty tree this browser does not know). Not reached: taken as able.
 */
async function researchMovesTrees(base: string): Promise<boolean> {
    try {
        const res = await fetchWithTimeout(`${base}/status`, 4000);
        return !res.ok || bridgeMovesTrees(await res.json());
    } catch {
        return true;
    }
}

/**
 * How the titles of the names go to the research behind this bridge (its
 * /status, researchGedcomTitles): not reached, in NPFX / NSFX only, which
 * any research reads right.
 */
async function researchTitlesAt(base: string): Promise<TitlesInGedcom> {
    try {
        const res = await fetchWithTimeout(`${base}/status`, 4000);
        if (!res.ok) return 'tags';
        const body = await res.json() as { features?: unknown } | null;
        const features = Array.isArray(body?.features) ? body.features.filter((f): f is string => typeof f === 'string') : null;
        return researchGedcomTitles({ features });
    } catch {
        return 'tags';
    }
}

/** Whether the research behind this bridge takes a tree with nobody in it yet (its /status). Not said: not. */
async function researchTakesEmpty(base: string): Promise<boolean> {
    try {
        const res = await fetchWithTimeout(`${base}/status`, 4000);
        return res.ok && bridgeTakesEmpty(await res.json());
    } catch {
        return false;
    }
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

    /**
     * Hand `treeId` a token and open the research's set-up in the terminal.
     * From a browser that cannot reach the research the tree goes by a file:
     * the install dialog's Install step (its "I already have it" takes an
     * installed research too).
     */
    startResearchAdopt(treeId: TreeId): void {
        if (needsTransfer(currentAppBrowser())) {
            void (async () => {
                if (DataManager.getCurrentTreeId() !== treeId) await this.switchToTree(treeId);
                this.showResearchInstall('install');
            })();
            return;
        }
        const token = newAdoptToken();
        const url = researchNewUrl(token, currentAppBrowser(), undefined, announcedResearchScheme());
        if (!url || !TreeManager.getTreeMetadata(treeId)) return;
        TreeManager.setResearchAdoptToken(treeId, { token, at: new Date().toISOString() });
        this.handOverResearchLink(url);
        // No time limit: setting up takes as long as it takes. Closing the
        // toast keeps the token — the research can still come back.
        // The link may have opened nothing (the research was uninstalled, or never was here): the install line.
        this.showToast(strings.research.awaitingAdopt, Infinity, { spinner: true, closable: true, kind: 'adopt',
            action: { label: strings.research.awaitingNotInstalled, run: () => this.showResearchInstall('install') } });
    },

    /** Tree manager row menu: start research with that tree. */
    treeActionStartResearch(treeId: TreeId): void {
        document.querySelectorAll('.tree-row-menu.open').forEach(m => m.classList.remove('open'));
        this.startResearchAdopt(treeId);
    },

    /**
     * The research at this bridge waits for a tree of this browser to be handed
     * over (its `GET /adopt` names a token a tree here holds, or the
     * installation's): a ?live= of it is the hand-over, never a second tree.
     */
    async researchAwaitsHandOver(base: string): Promise<boolean> {
        try {
            const res = await fetchWithTimeout(`${base}/adopt`, CONNECT_TIMEOUT_MS);
            if (!res.ok) return false;
            const offer = sanitizeAdoptOffer(await res.json());
            if (!offer) return false;
            const install = readInstallRecord();
            const fromInstall = install?.token === offer.token && installPhase(install) !== 'expired';
            return fromInstall || !!TreeManager.findTreeByAdoptToken(offer.token, TOKEN_MAX_AGE_MS, Date.now(), INSTALL_TTL_MS);
        } catch {
            return false;
        }
    },

    /**
     * ?adopt=<bridge>: the research came back for the tree. It names the tree
     * by its token; the user decides whether it goes over.
     */
    async adoptFromResearch(raw: string): Promise<void> {
        // Kept in this tab until the hand-over ends: a reload meanwhile (the browser's own advice after
        // allowing local network access) asks again instead of losing ?adopt= (m4 of the Windows round).
        setPendingAdopt(raw);
        try {
            await this.adoptFromResearchNow(raw);
        } finally {
            clearPendingAdopt(raw);
        }
    },

    async adoptFromResearchNow(raw: string): Promise<void> {
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
            if (await this.showResearchConnectFailed(err, { param: 'adopt', value: raw })) await this.adoptFromResearchNow(raw);
            return;
        }
        // Installed from the app: its token holds 24 h, and from the welcome
        // screen (no tree yet) the research gets a new empty tree.
        const install = readInstallRecord();
        const fromInstall = !!offer && install?.token === offer.token && installPhase(install) !== 'expired';
        let tree = offer ? TreeManager.findTreeByAdoptToken(offer.token, fromInstall ? INSTALL_TTL_MS : TOKEN_MAX_AGE_MS, Date.now(), INSTALL_TTL_MS) : null;
        // An installation started for this tree whose record another tree's installation took meanwhile
        // ("I already have it" there): still this tree's installation, its hand-over and "ready" as such.
        const ownInstall = fromInstall || tree?.researchAdoptToken?.install === true;
        let fresh: StromData | null = null;
        if (!tree && fromInstall && offer && install) {
            const id = TreeManager.createTree(offer.name || strings.install.newTreeName);
            TreeManager.setResearchAdoptToken(id, { token: offer.token, at: install.createdAt });
            tree = TreeManager.getTreeMetadata(id);
            fresh = { version: STROM_DATA_VERSION, persons: {}, partnerships: {} };
            this.updateTreeSwitcher();
        }
        // The tree comes from another browser (Safari): the research holds its file — imported here first.
        let moved: { tree: TreeMetadata; from: AppBrowser } | null = null;
        if (!tree && offer?.transfer) {
            const got = await this.receiveResearchTransfer(bridge.base, offer);
            if (got === 'failed') {
                postCancel(cancelUrl, 'cancelled');
                void this.showAlert(r.transferUnreadable, 'error');
                return;
            }
            if (got) {
                moved = got;
                tree = got.tree;
            }
        }
        if (!offer || !tree) {
            // An older research (1.12.0) takes no tree from Safari or a phone, where such a tree usually is:
            // told it is not handed over (it stops waiting at once instead of asking for another copy for
            // half an hour), and said here with the way to update it. A later line takes its empty research.
            const oldResearch = !!offer && !offer.transfer && !await researchMovesTrees(bridge.base);
            postCancel(cancelUrl, oldResearch ? 'cancelled' : 'no-tree');
            // Another browser or profile has it: the address to open there (the research keeps waiting).
            if (offer) this.showResearchElsewhere(raw, offer.until, oldResearch);
            else this.showToast(r.adoptUnknown, 6000);
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
        // Nobody in it yet (installed from the welcome screen, a tree from Safari's): an older research
        // refuses it (400 tree.empty) — not offered, the research told, and said how it starts (C1).
        if (!Object.values(data.persons).some(p => !p.isPlaceholder) && !await researchTakesEmpty(bridge.base)) {
            postCancel(cancelUrl, 'cancelled');
            await this.endEmptyHandOver(tree.id, fromInstall ? offer.token : null);
            return;
        }
        const choice = await this.askResearchAdopt(tree, offer, data, { install: ownInstall || !!moved, ...(moved ? { movedFrom: moved.from } : {}) });
        if (choice === null) {
            postCancel(cancelUrl, 'cancelled');
            // The installation's hand-over declined: nothing waits to be finished any more.
            if (fromInstall) clearInstallRecord();
            // Not handed over: nothing of the move is left half-done here.
            if (moved) await this.dropResearchTransfer(moved.tree.id, moved.from);
            return;
        }
        // A backup before the tree first goes to the research (whatever the backup setting).
        if (DataManager.getCurrentTreeId() === tree.id && await DataManager.snapshotNow('pre-first-send')) {
            patchResearchAutoState(tree.id, { firstSendBackup: true });
        }
        // The research does not take photos over yet: they stay here only.
        // A research that knows no titles gets the names without them (B-1): they stay here.
        const titles = await researchTitlesAt(bridge.base);
        const exported = exportToGedcom(choice.images ? data : stripMedia(data), tree.name, { titles });
        let reply: { tree: string; head: string | null; ids: AdoptIds | null } | null = null;
        let refusedEmpty = false;
        try {
            const res = await postSync(`${bridge.base}/adopt`, exported.content, 120000);
            if (res.ok) reply = sanitizeAdoptReply(await res.json());
            else if (res.status === 400) refusedEmpty = await res.json().then((b: { code?: unknown }) => b?.code === 'tree.empty', () => false);
        } catch (err) {
            console.warn('Handing the tree to the research failed', err);
            // Not reached (B1 of the Windows round: Edge asks about "Apps on device" only now, at the
            // hand-over itself, and it was blocked): said as at the start, naming the setting. Once allowed
            // the hand-over is offered again (B2); the tab keeps ?adopt= meanwhile, a reload asks again.
            if (await this.showResearchConnectFailed(err, { param: 'adopt', value: raw })) await this.adoptFromResearchNow(raw);
            return;
        }
        if (refusedEmpty) {
            await this.endEmptyHandOver(tree.id, fromInstall ? offer.token : null);
            return;
        }
        if (!reply) {
            await this.showAlert(r.adoptFailed, 'error');
            return;
        }
        // The research's numbers for what went over (its `ids`, by this file's xrefs): every later
        // send names its people, even when its version below does not come.
        let taken = data;
        let numbered = false;
        if (reply.ids && DataManager.getCurrentTreeId() === tree.id) {
            const withIds = applyAdoptIds(data, exported.xrefs, reply.ids);
            if (withIds.persons + withIds.sources > 0) {
                DataManager.replaceWithSourceData(withIds.data);
                taken = DataManager.getData();
                numbered = withIds.persons > 0;
            }
        }
        // Without them nothing goes to the research until its version comes (loading it clears
        // this): a copy that does not name its people would read there as a second family tree.
        const hasPeople = Object.values(taken.persons).some(p => !p.isPlaceholder);
        TreeManager.setResearchLink(tree.id, {
            id: reply.tree,
            fingerprint: contentFingerprint(taken),
            syncedAt: new Date().toISOString(),
            ...(reply.head ? { head: reply.head } : {}),
            ...(!numbered && hasPeople ? { awaitingIds: true as const } : {}),
            // As the user chose in the hand-over (asked there: no question later).
            sendMode: choice.sendMode,
            // The titles went in the NAME line with NPFX / NSFX to a research that keeps them (B18-1).
            ...(titles === 'line' ? { titlesIn: 'adopt' } : {}),
        });
        patchResearchAutoState(tree.id, { modeAsked: true });
        // What the research took is its version now: changes per person count from here.
        this.researchKeepCopy(tree.id, taken);
        TreeManager.setResearchAdoptToken(tree.id, null);
        // The bridge that took the tree is the research's own: the tree is
        // connected now (sending by itself, the state in the bar), not only
        // after the research opens the app again.
        let status: Awaited<ReturnType<typeof fetchStatus>> = null;
        try { status = await fetchStatus(`${bridge.base}/status`, 4000); } catch { /* connected at the next open */ }
        if (status?.treeId !== reply.tree) noteResearchBridge(reply.tree, bridge.base);
        const loaded = await this.loadResearchAfterAdopt(tree.id, bridge.ged, reply.tree, reply.head);
        if (!loaded && !numbered && hasPeople) console.warn('The research numbers did not come with the hand-over: sending waits for its version', reply.tree);
        this.refreshResearchSyncUi();
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        this.refreshActionMenuBadges();
        TreeRenderer.render();
        if (ownInstall || moved) {
            if (fromInstall) this.finishResearchInstall(offer.token);
            void this.showResearchReady(bridge.base, reply.tree, offer.name || r.defaultName, hasPeople, moved?.from);
            return;
        }
        this.showToast(r.adopted(tree.name), 6000);
    },

    /**
     * The research's own version of what it just took (its numbers, its
     * families) becomes the tree: the next send is compared to that there and
     * here, even when the research opens no ?import-url=. Tried a few times
     * (it may write it a moment after answering); every miss says why in the
     * console. True when it loaded.
     */
    async loadResearchAfterAdopt(treeId: TreeId, gedUrl: string, researchId: string, head: string | null): Promise<boolean> {
        for (const wait of ADOPT_LOAD_WAITS) {
            if (wait) await new Promise(resolve => setTimeout(resolve, wait));
            let text: string;
            try {
                text = await fetchGedcomText(gedUrl);
            } catch (err) {
                console.warn('Loading the research version after the hand-over failed', err);
                continue;
            }
            const header = readResearchHeader(text);
            if (!header.isStromResearch || header.treeId !== researchId) {
                console.warn('The research version after the hand-over is not that tree (yet)',
                    { stromResearch: header.isStromResearch, tree: header.treeId, expected: researchId });
                continue;
            }
            try {
                const done = await this.applyResearch(convertToStrom(parseGedcom(text)).data, header, { quiet: true, ...(head ? { head } : {}) });
                if (done !== treeId) console.warn('The research version after the hand-over was not loaded into the tree', { done, treeId });
                return done === treeId;
            } catch (err) {
                console.warn('Loading the research version after the hand-over failed', err);
                return false;
            }
        }
        return false;
    },

    /**
     * After an installation from the app, once: what the research now does
     * for the tree (where it is, the agent, the originals) — or, for an empty
     * tree, how to start it. Later only the bar shows the state.
     */
    async showResearchReady(base: string, researchId: string, researchName: string, hasPeople: boolean, movedFrom?: AppBrowser): Promise<void> {
        const s = strings.install;
        let where = '';
        let agent = '';
        let archive = false;
        try {
            const res = await fetchWithTimeout(`${base}/status`, 3000);
            if (res.ok) {
                const st = await res.json() as { path?: unknown; agent?: unknown; accepts?: { mode?: unknown } };
                if (typeof st.path === 'string') where = st.path.slice(0, 300);
                archive = st.accepts?.mode === 'archive';
                // `agent: { id, name, where? }` (an archive has none); a bare name from an older shape too.
                const named = st.agent && typeof st.agent === 'object' ? (st.agent as { name?: unknown }).name : st.agent;
                if (typeof named === 'string') agent = named.slice(0, 60);
            }
        } catch { /* the rows the status gives are left out */ }
        document.getElementById(READY_ID)?.remove();
        const open = this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: researchId }, announcedResearchScheme()) : null;
        // Moved here from another browser: Strom installed as this browser's app (Chromium offers it only while it
        // is not), so its icon opens these trees — not the old app of the browser it came from (a Safari Dock app).
        const offerApp = !!movedFrom && hasPeople && canPromptInstall();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = READY_ID;
        const rows = hasPeople ? `
                <dl class="install-ready-rows">
                    ${where ? `<dt>${esc(s.where)}</dt><dd class="install-ready-path">${esc(where)}</dd>` : ''}
                    ${archive ? '' : `<dt>${esc(s.agentRowLabel)}</dt><dd>${esc(agent ? s.agentRowOn(agent) : s.agentRow)}</dd>`}
                    <dt>${esc(s.originalsLabel)}</dt><dd>${esc(s.originalsRow)}</dd>
                </dl>` : '';
        overlay.innerHTML = `
            <div class="modal modal--sm research-ready-modal" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="research-ready-title">
                <div class="modal-header">
                    <h2 id="research-ready-title"><span class="install-ready-check" aria-hidden="true">✓</span> ${esc(hasPeople ? s.readyTitle : s.liveTitle(researchName))}</h2>
                </div>
                <div class="modal-content">
                    <p>${esc(hasPeople ? s.readyText(researchSendMode(TreeManager.getTreeMetadata(DataManager.getCurrentTreeId() ?? ('' as TreeId))?.research)) : s.liveText)}</p>
                    ${rows}
                    ${movedFrom && hasPeople ? `<p class="install-ready-moved">${esc(movedFrom === 'mobile' ? strings.research.transferCopyLeftMobile : strings.research.transferCopyLeft(appBrowserName(movedFrom)))}</p>` : ''}
                    ${offerApp ? `<div class="install-ready-app">${APP_ICON_SVG}<div class="install-ready-app-text"><span class="install-ready-app-line">${esc(strings.research.transferAppNote)}</span><button type="button" class="link-button" data-act="install-app">${esc(strings.research.transferInstallApp)}</button></div></div>` : ''}
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
            if (act === 'install-app') {
                // The dialog stays; accepted → the row goes with a toast, dismissed → it stays until the dialog closes
                // (a browser offers once: a click with no offer left takes the row away).
                const row = el.closest('.install-ready-app');
                if (!canPromptInstall()) { row?.remove(); return; }
                void promptInstall().then(ok => {
                    if (!ok) return;
                    row?.remove();
                    this.showToast(strings.research.transferInstalling, 6000);
                });
                return;
            }
            close();
            if (act === 'open' && open) this.handOverResearchLink(open);
            else if (act === 'gedcom') this.startGedcomImportPlain();
            else if (act === 'first') this.showAddPersonModal();
        }));
        overlay.querySelector<HTMLElement>('.primary')?.focus();
    },

    /**
     * A tree with nobody in it the research did not take (C1): its hand-over
     * ends here (an installation too: the research is installed), the tree
     * stays as it is, and the way to start once it has its first person.
     */
    async endEmptyHandOver(treeId: TreeId, installToken: string | null): Promise<void> {
        TreeManager.setResearchAdoptToken(treeId, null);
        if (installToken) this.finishResearchInstall(installToken);
        await this.showAlert(strings.research.adoptEmpty, 'info');
    },

    closeResearchElsewhere(): void {
        document.getElementById(ELSEWHERE_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== ELSEWHERE_ID);
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
    /**
     * The tree from another browser: its transfer file from the research's
     * bridge, checked (the token, the usual JSON import checks) and imported
     * as a new tree waiting for this hand-over. Null: the research has none;
     * 'failed': it had one that could not be read (nothing changed).
     */
    async receiveResearchTransfer(base: string, offer: AdoptOffer): Promise<{ tree: TreeMetadata; from: AppBrowser } | null | 'failed'> {
        let text: string;
        try {
            const res = await fetchWithTimeout(`${base}/transfer`, TRANSFER_TIMEOUT_MS);
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            text = await res.text();
        } catch (err) {
            console.warn('The tree from the other browser did not come', err);
            return 'failed';
        }
        const moved = readTransferJson(text, offer.token);
        const result = moved ? validateJsonImport(moved.json) : null;
        if (!moved || !result?.valid || !result.data) return 'failed';
        const name = moved.mark.tree || offer.name || strings.install.newTreeName;
        const id = await DataManager.importAsNewTree(result.data, name);
        TreeManager.setResearchAdoptToken(id, { token: offer.token, at: new Date().toISOString() });
        this.updateTreeSwitcher();
        TreeRenderer.render();
        const tree = TreeManager.getTreeMetadata(id);
        return tree ? { tree, from: moved.mark.from } : 'failed';
    },

    /** The move declined at the hand-over: the tree imported for it goes again; the other browser keeps it as it was. */
    async dropResearchTransfer(treeId: TreeId, from: AppBrowser): Promise<void> {
        const wasActive = TreeManager.getActiveTreeId() === treeId;
        await TreeManager.deleteTree(treeId);
        if (!TreeManager.hasTrees()) {
            DataManager.createNewTree(strings.treeManager.defaultTreeName);
        } else if (wasActive) {
            await DataManager.switchTree(TreeManager.getActiveTreeId()!);
        }
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        TreeRenderer.render();
        this.showToast(from === 'mobile' ? strings.research.transferCancelledMobile : strings.research.transferCancelled(appBrowserName(from)), 8000);
    },

    /**
     * The research asks for a tree this browser does not have (another
     * browser, another profile): the address to open where the tree is.
     */
    showResearchElsewhere(rawBridge: string, until: string | null, oldResearch = false): void {
        const r = strings.research;
        document.getElementById(ELSEWHERE_ID)?.remove();
        const url = new URL(window.location.href);
        url.search = '';
        url.hash = '';
        url.searchParams.set('adopt', rawBridge);
        const address = url.toString();
        const at = until ? new Date(until) : null;
        const time = at && !Number.isNaN(at.getTime())
            ? at.toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' }) : '';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = ELSEWHERE_ID;
        overlay.innerHTML = `
            <div class="modal modal--sm research-elsewhere-modal" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="research-elsewhere-title">
                <div class="modal-header">
                    <h2 id="research-elsewhere-title">${esc(r.elsewhereTitle)}</h2>
                    <button type="button" class="close-btn" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="modal-content install-body">${oldResearch ? `
                    <p>${esc(r.elsewhereOldText)}</p>
                    <p class="research-elsewhere-old">${esc(r.elsewhereOldResearch)}</p>` : `
                    <p>${esc(r.elsewhereText)}${time ? ` ${esc(r.elsewhereUntil(time))}` : ''}</p>
                    <div class="install-line-row">
                        <code class="install-line research-elsewhere-address" tabindex="0">${esc(address)}</code>
                    </div>`}
                </div>
                <div class="buttons">${oldResearch ? `
                    <button type="button" class="primary" data-dismiss>${esc(strings.buttons.close)}</button>` : `
                    <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
                    <button type="button" class="primary" data-act="copy">${esc(r.elsewhereCopy)}</button>`}
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(ELSEWHERE_ID);
        const close = (): void => this.closeResearchElsewhere();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('.close-btn')?.addEventListener('click', close);
        overlay.querySelector('[data-dismiss]')?.addEventListener('click', close);
        const code = overlay.querySelector<HTMLElement>('.research-elsewhere-address');
        const select = (): void => {
            if (!code) return;
            const range = document.createRange();
            range.selectNodeContents(code);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        };
        code?.addEventListener('click', select);
        const copy = overlay.querySelector<HTMLButtonElement>('[data-act="copy"]');
        copy?.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(address);
                copy.textContent = strings.install.copied;
                copy.classList.add('copied');
            } catch {
                select();
                this.showToast(strings.install.copyManual, 6000);
            }
        });
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        (copy ?? overlay.querySelector<HTMLElement>('.buttons .primary'))?.focus();
    },

    askResearchAdopt(tree: TreeMetadata, offer: AdoptOffer, data: ReturnType<typeof DataManager.getData>, opts: { install?: boolean; movedFrom?: AppBrowser } = {}): Promise<{ images: boolean; sendMode: ResearchSendMode } | null> {
        document.getElementById(ADOPT_ID)?.remove();
        const r = strings.research;
        // As the research counts them: people with a name (an unnamed "?" stays out of its count).
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const families = countFamilies(data);
        const sources = Object.keys(data.sources ?? {}).length;
        const images = countImages(data);
        // "Include photos and attachments" waits until the research takes them over.
        const files = RESEARCH_TAKES_IMAGES ? images.photos + images.attachments + images.excerpts : 0;
        const researchName = offer.name || r.defaultName;
        const t = strings.treeSettings;
        const tile = (n: number, noun: string): string => `<span class="research-adopt-tile"><b>${n}</b><span>${esc(noun)}</span></span>`;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = ADOPT_ID;
        overlay.innerHTML = `
            <div class="modal modal--md research-adopt-modal research-send-dialog" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="research-adopt-title">
                ${opts.movedFrom ? `<p class="research-adopt-moved"><span class="research-adopt-moved-tag">${esc(r.transferTag)}</span> ${esc(opts.movedFrom === 'mobile' ? r.transferCameMobile : r.transferCame(appBrowserName(opts.movedFrom)))}</p>` : ''}
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <div class="research-title-row"><h2 id="research-adopt-title">${esc(opts.install ? strings.install.adoptTitle : r.adoptTitle)}</h2>${researchTrialTagHtml()}</div>
                        <div class="audit-log-subtitle">${esc(opts.install ? strings.install.adoptSub(tree.name, persons, researchName) : `${tree.name} → ${r.adoptTarget(researchName)}`)}</div>
                        <div class="research-adopt-counts-line">${esc(t.handoffCounts(persons, families, sources))}</div>
                    </div>
                </div>
                <div class="research-send-dialog-body">
                    <div class="research-adopt-what">
                        <span class="research-adopt-eyebrow">${esc(t.handoffWhatGoes)}</span>
                        <div class="research-adopt-tiles">${tile(persons, t.handoffPersons(persons))}${tile(families, t.handoffFamilies(families))}${tile(sources, t.handoffSources(sources))}</div>
                    </div>
                    ${files > 0 ? `
                    <label class="research-adopt-images">
                        <input type="checkbox" id="research-adopt-images"${SettingsManager.isImportImages() ? ' checked' : ''}>
                        <span>${esc(r.adoptImages)} <span class="research-adopt-size">${esc(r.adoptImagesSize(files, (images.bytes / (1024 * 1024)).toFixed(1)))}</span></span>
                    </label>` : ''}
                    <div class="research-adopt-rule" aria-hidden="true"></div>
                    <fieldset class="research-transcripts research-send-mode research-adopt-send">
                        <legend>${esc(t.askTitle)}</legend>
                        ${researchSendModeCardsHtml('manual', undefined, 'research-adopt-send-mode')}
                    </fieldset>
                    ${researchSendPrinciplesHtml(true)}
                    <p class="research-adopt-backup-narrow">${esc(t.handoffBackupNote)}</p>
                </div>
                <div class="buttons research-send-dialog-foot">
                    <span class="research-send-dialog-note">${esc(t.handoffBackupNote)}</span>
                    <button type="button" class="secondary" id="research-adopt-cancel" data-dismiss>${esc(r.adoptCancel)}</button>
                    <button type="button" class="primary" id="research-adopt-confirm">${esc(r.adoptConfirm)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.clearDialogStack();
        this.pushDialog(ADOPT_ID);
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        return new Promise((resolve) => {
            const finish = (value: { images: boolean; sendMode: ResearchSendMode } | null): void => {
                this.closeResearchAdoptDialog();
                resolve(value);
            };
            this.researchAdoptResolve = () => finish(null);
            (overlay.querySelector('#research-adopt-cancel') as HTMLButtonElement).onclick = () => finish(null);
            (overlay.querySelector('#research-adopt-confirm') as HTMLButtonElement).onclick = () => {
                const box = overlay.querySelector<HTMLInputElement>('#research-adopt-images');
                finish({ images: box ? box.checked : false, sendMode: researchSendModeChecked(overlay, 'research-adopt-send-mode') ?? 'manual' });
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
