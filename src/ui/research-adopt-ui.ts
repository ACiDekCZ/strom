/**
 * "Start research with this tree" (G3): an app tree becomes a Strom Research
 * tree without a copy. The app hands the research a one-time token through a
 * strom-research://new link; the research sets itself up in the terminal and
 * comes back with ?adopt=<bridge>, asking for the tree by that token. The user
 * confirms, the app POSTs the tree as GEDCOM and links it to the research
 * tree it gets back — from then on it is a research tree like any other
 * (Research menu, the person menu's "Research ›" …). Nothing changes in the app's data.
 */

import { researchActionLabel } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { AppBrowser, appBrowserName, bridgeMovesTrees, bridgeTakesEmpty, currentAppBrowser, needsTransfer, readTransferJson } from '../research-transfer.js';
import { restoreViewLinks } from '../view-links.js';
import { validateJsonImport } from '../merge/validation.js';
import { TreeId, TreeMetadata, StromData, ResearchSendMode } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';
import { readInstallRecord, clearInstallRecord, installPhase, INSTALL_TTL_MS } from '../research-install.js';
import { noteResearchBridge, patchResearchAutoState, announcedResearchScheme } from '../research-device.js';
import { ResearchWriteHeld, writeHeldOfCode } from '../research-write-held.js';
import { SettingsManager } from '../settings.js';
import { countImages, stripMedia } from '../attachments.js';
import { countFamilies } from '../ged-exporter.js';
import { NO_CITATION_FEATURES, researchCitationsOut, type ResearchCitationsOut } from '../citation-gates.js';
import {
    parseLiveBridge, sanitizeAdoptOffer, sanitizeAdoptReply, newAdoptToken, researchNewUrl, contentFingerprint, researchSchemeUrl,
    readResearchHeader, applyAdoptIds, withoutResearchNumbers, AdoptOffer, AdoptIds, researchGedcomTitles, researchSendsSourceFields, TitlesInGedcom, sanitizeLiveStatus, statusAgentless, type BrowserInfo,
    researchLinkMark, researchKeepsAppMedia, researchMediaOut, NO_MEDIA_FEATURES, type ResearchMediaOut,
} from '../research-link.js';
import { newTieSendMode } from '../research-sync.js';
import { uiModule } from './module.js';
import { onComputer, fetchWithTimeout, fetchStatus, readResearchTreeFile, postSync, postCancel, readTree, CONNECT_TIMEOUT_MS } from './research-ui.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { normalizeModal } from './modal-skeleton.js';
import { canPromptInstall, promptInstall } from '../pwa.js';
import { whilePicking } from './file-pick.js';
import { setPendingAdopt, clearPendingAdopt } from './pending-adopt.js';
import { researchSendModeCardsHtml, researchSendPrinciplesHtml, researchSendModeChecked, researchTrialTagHtml } from './research-tree-settings-ui.js';
import { researchSendMode, knownResearchTreesRoot } from './research-sync-ui.js';
import { AdoptProgress, type AdoptPhase, type AdoptStep } from './adopt-progress.js';
import { TreeEditLock } from './tree-edit-lock.js';
import { holdLeave } from './busy-leave.js';
import { BUSY_TIMEOUTS, busyToast } from './busy.js';
import { downloadStep, type TreeDownloadWatch } from './tree-load-progress.js';
import { safeFileName } from '../filenames.js';
import { researchShortId } from '../tree-row.js';
import type { ProgressToastHandle } from './toast.js';
import { exportGedcomWithImages, gedcomText } from '../ged-export-images.js';

const ADOPT_ID = 'research-adopt-modal';
/** "Research for a copy of a tree" (spec 139 §11.4). */
const COPY_RESEARCH_ID = 'copy-research-modal';
/** The longest folder name a new research's link carries (researchNewUrl). */
const RESEARCH_NAME_MAX = 120;
const ELSEWHERE_ID = 'research-elsewhere-modal';
/** A transfer file carries the whole tree with its images: time to read a large one from the bridge. */
const TRANSFER_TIMEOUT_MS = 120_000;
const READY_ID = 'research-ready-modal';
/** The app's own (green) icon, as in icon.svg: beside the offer, it tells this app from Safari's muted one. */
const APP_ICON_SVG = '<svg class="install-ready-app-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.3" fill="#3f6b4f"/><g transform="translate(3.6 3.6) scale(0.7)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z"/><path d="M12 19v3"/></g></svg>';
/** How long the research has to come back for the tree. */
const TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
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
 * any research reads right. And whether it reads the sources' place field by
 * field (sources.fields): not reached, not.
 */
async function researchTitlesAt(base: string): Promise<{ titles: TitlesInGedcom; sourceFields: boolean; citations: ResearchCitationsOut; media: ResearchMediaOut }> {
    try {
        const res = await fetchWithTimeout(`${base}/status`, 4000);
        if (!res.ok) return { titles: 'tags', sourceFields: false, citations: NO_CITATION_FEATURES, media: NO_MEDIA_FEATURES };
        const body = await res.json() as { features?: unknown } | null;
        const features = Array.isArray(body?.features) ? body.features.filter((f): f is string => typeof f === 'string') : null;
        // The sources' place field by field only to a research that reads it (sources.fields).
        // The main citations only to a research that keeps them (citations.main).
        return { titles: researchGedcomTitles({ features }), sourceFields: researchSendsSourceFields({ features }), citations: researchCitationsOut({ features }),
            media: researchMediaOut({ features }) };
    } catch {
        return { titles: 'tags', sourceFields: false, citations: NO_CITATION_FEATURES, media: NO_MEDIA_FEATURES };
    }
}

/**
 * What the research behind this bridge says of itself for a hand-over (its /status; not said: not):
 * it works without an agent (an archive, or one waiting for its agent), and it keeps the tree's
 * photos and attachments (`media.app`, spec 108) — a hand-over with them only adds them there.
 */
async function researchAdoptStatusAt(base: string): Promise<{ agentless: boolean; takesImages: boolean }> {
    try {
        const res = await fetchWithTimeout(`${base}/status`, 4000);
        if (!res.ok) return { agentless: false, takesImages: false };
        const status = sanitizeLiveStatus(await res.json());
        return { agentless: !!status && statusAgentless(status), takesImages: researchKeepsAppMedia(status) };
    } catch {
        return { agentless: false, takesImages: false };
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

/** How long the research has to take the tree (§10.3, a whole tree: 120 s). */
const ADOPT_POST_MS = BUSY_TIMEOUTS.tree;

/** What a hand-over goes on with once the person said yes. */
interface AdoptRunCtx {
    raw: string;
    base: string;
    ged: string;
    tree: TreeMetadata;
    data: StromData;
    choice: { images: boolean; sendMode: ResearchSendMode };
    offer: AdoptOffer;
    fromInstall: boolean;
    ownInstall: boolean;
    moved: { tree: TreeMetadata; from: AppBrowser } | null;
}

/** Kept across a retry: the backup is made once, the GEDCOM is what "Export GEDCOM" saves. */
interface AdoptRunState {
    backupDone: boolean;
    backupSaved: boolean;
    content: string | null;
}

type AdoptOutcome =
    | { kind: 'linked'; researchId: string; hasPeople: boolean }
    | { kind: 'empty' }
    | { kind: 'held'; held: ResearchWriteHeld }
    | { kind: 'unreached'; err: unknown }
    | { kind: 'timeout' }
    | { kind: 'refused' };

/** Waiting for the research to come back for a tree: 30 s from the click (§10.3). */
const ADOPT_WAIT_MS = 30_000;

interface AdoptWait {
    treeId: TreeId;
    stop: AbortController;
    toast: ProgressToastHandle | null;
    /** Its limit passed (or it ended otherwise): a new start opens again. */
    ended: boolean;
}

let adoptWait: AdoptWait | null = null;

/** The research came back for a tree (here, or in another tab), or the wait was stopped: it ends quietly. */
export function endResearchAdoptWait(): void {
    const wait = adoptWait;
    adoptWait = null;
    if (!wait) return;
    wait.ended = true;
    wait.stop.abort();
    wait.toast?.close();
}

/** The hand-over running now (one at a time): its dialog back. */
let adoptRunning: { show: () => void } | null = null;

/** The GEDCOM that was to go to the research, saved as a file (the safe way when the hand-over failed). */
function downloadAdoptGedcom(content: string, tree: TreeMetadata): void {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(tree.name, 'family-tree')}.ged`;
    a.click();
    URL.revokeObjectURL(url);
    TreeManager.noteFileCopy([tree.id]);
}

/**
 * The adopt dialog in its running mode (2a, 2b): the heading, one lead line, the list of steps and a
 * sentence under it; the footer by state (running: the edits note + "Continue in the background";
 * linked: Close · Open the research; failed: Close · Export GEDCOM).
 */
function adoptRunView(overlay: HTMLElement, treeName: string): {
    host: HTMLElement; foot: HTMLElement;
    running(): void; linked(openLabel: string | null): void;
    failed(text: string, retry: () => void, close: () => void, exportGedcom: () => void): void;
} {
    const b = strings.busy;
    const modal = overlay.querySelector<HTMLElement>('.modal')!;
    modal.classList.add('research-adopt-running');
    // No longer a decision (its Escape would look for "Don't hand over"): Escape folds it away, or closes it at the end.
    modal.removeAttribute('data-dialog-kind');
    overlay.querySelector('.research-adopt-moved')?.remove();
    const h2 = modal.querySelector<HTMLElement>('#research-adopt-title');
    if (h2) h2.textContent = b.adoptHeading;
    modal.querySelector('.audit-log-subtitle')?.remove();
    modal.querySelector('.research-adopt-counts-line')?.remove();
    const body = modal.querySelector<HTMLElement>('.research-send-dialog-body')!;
    body.innerHTML = '';
    body.classList.add('research-adopt-progress');
    const lead = document.createElement('p');
    lead.className = 'research-adopt-lead';
    lead.textContent = b.adoptLead(treeName);
    body.appendChild(lead);
    const host = document.createElement('div');
    host.className = 'research-adopt-steps';
    body.appendChild(host);
    const foot = modal.querySelector<HTMLElement>('.buttons')!;
    const button = (id: string, label: string, cls: string): HTMLButtonElement => {
        const el = document.createElement('button');
        el.type = 'button';
        el.id = id;
        el.className = cls;
        el.innerHTML = label;
        foot.appendChild(el);
        return el;
    };
    const clearMsg = (): void => { host.querySelectorAll('.research-adopt-end').forEach(m => m.remove()); };
    const message = (text: string, err: boolean): HTMLElement => {
        clearMsg();
        const msg = document.createElement('div');
        msg.className = `busy-msg research-adopt-end${err ? ' is-err' : ''}`;
        msg.setAttribute('role', err ? 'alert' : 'status');
        const span = document.createElement('span');
        span.className = 'busy-msg__text';
        span.textContent = text;
        msg.appendChild(span);
        host.appendChild(msg);
        return msg;
    };
    return {
        host, foot,
        running(): void {
            clearMsg();
            foot.innerHTML = '';
            const note = document.createElement('span');
            note.className = 'grow research-adopt-wait-note';
            note.textContent = b.editsWaitAdoptNote;
            foot.appendChild(note);
            button('research-adopt-background', esc(b.adoptBackground), 'secondary').focus();
        },
        linked(openLabel: string | null): void {
            message(b.adoptLinked, false);
            foot.innerHTML = '';
            const close = button('research-adopt-close', esc(strings.buttons.close), openLabel ? 'secondary' : 'primary');
            const open = openLabel ? button('research-adopt-open', openLabel, 'primary') : null;
            (open ?? close).focus();
        },
        failed(text: string, retry: () => void, close: () => void, exportGedcom: () => void): void {
            const msg = message(text, true);
            const again = document.createElement('button');
            again.type = 'button';
            again.className = 'link busy-msg__retry';
            again.textContent = b.retry;
            again.addEventListener('click', retry);
            msg.appendChild(again);
            foot.innerHTML = '';
            button('research-adopt-close', esc(strings.buttons.close), 'secondary').addEventListener('click', close);
            button('research-adopt-export', esc(strings.research.sendExportGedcom), 'secondary').addEventListener('click', exportGedcom);
            again.focus();
        },
    };
}

export const researchAdoptMethods = uiModule({
    /**
     * "Start research with this tree" can be offered for `tree`: on a
     * computer whose research announced `new`, a tree that is not a research
     * tree yet. An empty one too: the research announced here hides every
     * other way in, and the hand-over itself settles a tree with nobody in it
     * (a research that takes it is ready empty, an older one is told and the
     * app says how it starts — C1). Never the sample tree.
     */
    researchAdoptAvailable(tree: TreeMetadata | null | undefined): boolean {
        return !!tree && !tree.research && !tree.demo && !DataManager.isViewMode() && onComputer() && this.researchLinkAvailable('new');
    },

    /**
     * A copy's switch "Research on" (off) in Manage trees (spec 139 §11.2):
     * where "Start research with this tree" could be offered — the research
     * runs on this computer and announced `new` — never the sample tree.
     */
    copyResearchAvailable(tree: TreeMetadata | null | undefined): boolean {
        return !!tree && !tree.demo && !DataManager.isViewMode() && onComputer() && this.researchLinkAvailable('new');
    },

    /**
     * The dialog "Research for a copy of a tree" (spec 139 §11.4, K5.4): the
     * copy gets a new research of its own (the research's set-up in its
     * terminal, as "Start research with this tree", the folder named after
     * the copy), never quietly the original's. Taking over the original's
     * research is the exception: a link on the left, behind a warning (K5.5).
     */
    showCopyResearchDialog(treeId: TreeId): void {
        const copy = TreeManager.getTreeMetadata(treeId);
        if (!copy) return;
        this.closeCopyResearchDialog();
        const st = strings.structure;
        const esc = (text: string): string => this.escapeHtml(text);
        const original = TreeManager.researchOriginalOf(treeId);
        const originalName = original?.name ?? TreeManager.researchCopyOrigin(treeId)?.name ?? copy.copyOf?.name ?? '';
        const rid = original?.research ? researchShortId(original.research.id) : '';
        // The folder researches are made in here, when a bridge said it (§11.4): a prefix, the name stays the only field.
        const root = knownResearchTreesRoot(original?.research?.id);
        const sep = root && root.includes('\\') && !root.includes('/') ? '\\' : '/';
        const rootHtml = root
            ? `<span class="copy-research-root" id="copy-research-root" title="${esc(root + sep)}"><bdi dir="ltr">${esc(root + sep)}</bdi></span>` : '';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = COPY_RESEARCH_ID;
        overlay.innerHTML = `
            <div class="modal modal--md copy-research-modal" role="dialog" data-dialog-kind="form" aria-modal="true" aria-labelledby="copy-research-title">
                <div class="modal-header">
                    <h2 id="copy-research-title">${esc(st.copyResearchTitle)}</h2>
                    <button type="button" class="close-btn" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="modal-content">
                    <p class="copy-research-text">${esc(st.copyResearchText(copy.name, originalName))}</p>
                    <div class="form-group">
                        <label for="copy-research-folder">${esc(st.copyResearchFolder)}</label>
                        <div class="copy-research-path${root ? ' has-root' : ''}">${rootHtml}<input type="text" id="copy-research-folder" maxlength="${RESEARCH_NAME_MAX}" value="${esc(copy.name)}" autocomplete="off" spellcheck="false"${root ? ' aria-describedby="copy-research-root"' : ''}></div>
                    </div>
                    ${original && rid ? `<p class="copy-research-stays">${esc(st.copyResearchStays(rid, original.name))}</p>` : ''}
                </div>
                <div class="buttons">${original ? `
                    <button type="button" class="link-button copy-research-takeover" data-act="takeover">${esc(st.takeOver(original.name))}</button>` : ''}
                    <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.cancel)}</button>
                    <button type="button" class="primary" data-act="create">${researchActionLabel(st.createResearch, researchLinkMark('new'))}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(COPY_RESEARCH_ID);
        const close = (): void => this.closeCopyResearchDialog();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('.close-btn')?.addEventListener('click', close);
        overlay.querySelector('[data-dismiss]')?.addEventListener('click', close);
        // The folder's prefix is part of the field: a click on it edits the name.
        overlay.querySelector('.copy-research-root')?.addEventListener('click', () => overlay.querySelector<HTMLInputElement>('#copy-research-folder')?.focus());
        overlay.querySelector('[data-act="create"]')?.addEventListener('click', () => {
            const name = overlay.querySelector<HTMLInputElement>('#copy-research-folder')?.value.trim() || copy.name;
            close();
            document.querySelectorAll('.tree-row-menu.open').forEach(m => m.classList.remove('open'));
            this.startResearchAdopt(treeId, null, { name });
        });
        overlay.querySelector('[data-act="takeover"]')?.addEventListener('click', () => {
            close();
            if (original) void this.confirmTakeOverResearch(original.id, treeId);
        });
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        overlay.querySelector<HTMLElement>('.buttons .primary')?.focus();
    },

    closeCopyResearchDialog(): void {
        document.getElementById(COPY_RESEARCH_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== COPY_RESEARCH_ID);
    },

    /**
     * "Take over the research of …" (spec 139 K5.5): after the warning, the
     * copy owns the research and the original is a tree without research. It
     * happens in the app alone (the research knows the app's trees only by
     * what each send names), nothing is sent.
     */
    async confirmTakeOverResearch(originalId: TreeId, copyId: TreeId): Promise<boolean> {
        const st = strings.structure;
        const original = TreeManager.getTreeMetadata(originalId);
        if (!original?.research || !TreeManager.canSendToResearch(originalId)) return false;
        const ok = await this.showConfirm(st.takeOverText(original.name, researchShortId(original.research.id)), st.takeOverTitle(original.name), {
            confirmLabel: st.takeOverBtn, variant: 'danger', note: { text: st.takeOverNote },
        });
        if (!ok || !TreeManager.transferResearch(originalId, copyId)) return false;
        this.updateTreeSwitcher();
        this.refreshResearchSyncUi();
        if (document.getElementById('tree-manager-modal')?.classList.contains('active')) await this.updateTreeManagerList();
        return true;
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
    startResearchAdopt(treeId: TreeId, el?: HTMLElement | null, opts: { name?: string } = {}): void {
        if (needsTransfer(currentAppBrowser())) {
            void (async () => {
                if (DataManager.getCurrentTreeId() !== treeId) await this.switchToTree(treeId, { follow: false });
                // The copy's chosen name goes with the link the install dialog opens (§11.4).
                this.showResearchInstall('install', opts.name ? { name: opts.name } : {});
            })();
            return;
        }
        // Started for this tree already and still opening or waiting (a second click, Enter): nothing again.
        if (adoptWait?.treeId === treeId && !adoptWait.ended) return;
        const token = newAdoptToken();
        // A copy's own research (§11.4): its folder's name, as the research's set-up may take it.
        const url = researchNewUrl(token, currentAppBrowser(), undefined, announcedResearchScheme(), opts.name);
        if (!url || !TreeManager.getTreeMetadata(treeId)) return;
        TreeManager.setResearchAdoptToken(treeId, { token, at: new Date().toISOString() });
        void this.awaitResearchAdopt(treeId, url, el ?? null);
    },

    /**
     * The research's set-up opened by `url` (A173, A94): "Opening the research…" while the link goes
     * (10 s: the research proves nothing for `new`), then waiting for it to come back for the tree, at
     * most 30 s from the click (§10.3) with "Stop waiting" and the install line (the link may have
     * opened nothing: the research uninstalled, or never here). Then a neutral end with Try again;
     * the token stays — the research can still come back.
     */
    async awaitResearchAdopt(treeId: TreeId, url: string, el: HTMLElement | null): Promise<void> {
        endResearchAdoptWait();
        const b = strings.busy;
        const r = strings.research;
        const stop = new AbortController();
        const wait: AdoptWait = { treeId, stop, toast: null, ended: false };
        adoptWait = wait;
        const startedAt = Date.now();
        const install = { label: r.awaitingNotInstalled, run: () => { endResearchAdoptWait(); this.showResearchInstall('install'); } };
        const result = await this.launchResearchLink(url, 'terminal', el, { quietLimit: true, signal: stop.signal });
        if (adoptWait !== wait || stop.signal.aborted) return;
        if (result !== 'limit') {
            wait.ended = true;
            return;
        }
        const toast = this.showProgressToast({ title: b.adoptWaiting, startedAt, cancel: () => endResearchAdoptWait(), cancelLabel: b.stopWaiting, more: install },
            { step: b.adoptWaitingSub });
        toast.el.classList.add('toast--adopt-wait');
        wait.toast = toast;
        await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, Math.max(0, startedAt + ADOPT_WAIT_MS - Date.now()));
            stop.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); });
        });
        if (adoptWait !== wait || stop.signal.aborted) return;
        wait.ended = true;
        toast.fail(b.adoptWaitEnd, { label: b.retry, run: () => { void this.awaitResearchAdopt(treeId, url, null); } },
            { title: b.notOpened, more: install, neutral: true });
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
        // A hand-over runs already (the research's ?adopt= again meanwhile): its dialog, never a second one.
        if (adoptRunning) {
            adoptRunning.show();
            return;
        }
        const r = strings.research;
        const bridge = parseLiveBridge(raw);
        if (!bridge) {
            this.showToast(r.notLocal, 6000);
            return;
        }
        const cancelUrl = `${bridge.base}/cancel`;
        endResearchAdoptWait();
        document.querySelector('.toast:not(.toast--progress)')?.remove();
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
            const oldResearch = !!offer && !offer.transfer && !await busyToast(strings.busy.connectingResearch, () => researchMovesTrees(bridge.base));
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
        if (DataManager.getCurrentTreeId() !== tree.id) await this.switchToTree(tree.id, { follow: false });
        // The research's status asked before the dialog (each ask up to 4 s): a progress toast says it (§2.1).
        const empty = !Object.values(data.persons).some(p => !p.isPlaceholder);
        const status = await busyToast(strings.busy.connectingResearch, async () =>
            empty && !await researchTakesEmpty(bridge.base) ? null : await researchAdoptStatusAt(bridge.base));
        // Nobody in it yet (installed from the welcome screen, a tree from Safari's): an older research
        // refuses it (400 tree.empty) — not offered, the research told, and said how it starts (C1).
        if (!status) {
            postCancel(cancelUrl, 'cancelled');
            await this.endEmptyHandOver(tree.id, fromInstall ? offer.token : null);
            return;
        }
        const { agentless, takesImages } = status;
        const choice = await this.askResearchAdopt(tree, offer, data, { install: ownInstall || !!moved, ...(moved ? { movedFrom: moved.from } : {}), agentless, takesImages });
        if (choice === null) {
            postCancel(cancelUrl, 'cancelled');
            // The installation's hand-over declined: nothing waits to be finished any more.
            if (fromInstall) clearInstallRecord();
            // Not handed over: nothing of the move is left half-done here.
            if (moved) await this.dropResearchTransfer(moved.tree.id, moved.from);
            return;
        }
        await this.runResearchAdopt({ raw, base: bridge.base, ged: bridge.ged, tree, data, choice, offer, fromInstall, ownInstall, moved });
    },

    /**
     * The hand-over itself, watched in its dialog (A175, screens 2a–2c): the dialog stays open and shows
     * its steps; "Continue in the background" (or Esc) folds it into a progress toast with "Show". Edits
     * to the tree and leaving the page wait meanwhile. It ends in the dialog (linked: Close · Open the
     * research; failed: the sentence with Try again, Close · Export GEDCOM) or, folded away, in the toast.
     */
    async runResearchAdopt(ctx: AdoptRunCtx): Promise<void> {
        const overlay = document.getElementById(ADOPT_ID);
        if (!overlay || adoptRunning) return;
        const b = strings.busy;
        const r = strings.research;
        const state: AdoptRunState = { backupDone: false, backupSaved: false, content: null };
        let inDialog = true;
        const view = adoptRunView(overlay, ctx.tree.name);
        let progress: AdoptProgress | null = null;
        const show = (): void => {
            if (inDialog) return;
            inDialog = true;
            document.body.appendChild(overlay);
            this.pushDialog(ADOPT_ID);
            progress?.attach(view.host);
            (overlay.querySelector<HTMLElement>('.buttons button') ?? null)?.focus();
        };
        const fold = (): void => {
            if (!inDialog) return;
            inDialog = false;
            overlay.remove();
            this.dialogStack = this.dialogStack.filter(d => d !== ADOPT_ID);
            progress?.background();
        };
        const close = (): void => {
            inDialog = false;
            progress?.closeToast();
            this.closeResearchAdoptDialog();
        };
        const exportGedcom = (): void => {
            if (state.content) downloadAdoptGedcom(state.content, ctx.tree);
        };
        const attempt = async (): Promise<void> => {
            const run = new AdoptProgress({ onShow: show });
            progress = run;
            adoptRunning = { show };
            view.running();
            run.attach(view.host);
            this.researchAdoptResolve = fold;
            view.foot.querySelector('#research-adopt-background')?.addEventListener('click', fold);
            const release = [TreeEditLock.hold('adopt', b.editsWaitAdopt), holdLeave('adopt', ctx.tree.id)];
            let outcome: AdoptOutcome;
            try {
                outcome = await this.handResearchAdopt(ctx, state, (p) => run.phase(p), (step, meta) => run.meta(step, meta));
            } catch (err) {
                console.warn('Handing the tree to the research failed', err);
                outcome = { kind: 'refused' };
            } finally {
                release.forEach(f => f());
                adoptRunning = null;
            }
            if (outcome.kind === 'linked') {
                run.finish();
                if (ctx.ownInstall || ctx.moved) {
                    close();
                    if (ctx.fromInstall) this.finishResearchInstall(ctx.offer.token);
                    void this.showResearchReady(ctx.base, outcome.researchId, ctx.offer.name || r.defaultName, outcome.hasPeople, ctx.moved?.from);
                    return;
                }
                if (!inDialog) {
                    run.toastHandle?.done(r.adopted(ctx.tree.name));
                    this.closeResearchAdoptDialog();
                    return;
                }
                const url = this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: outcome.researchId }, announcedResearchScheme()) : null;
                view.linked(url ? researchActionLabel(r.openResearch, researchLinkMark('open')) : null);
                this.researchAdoptResolve = close;
                view.foot.querySelector('#research-adopt-close')?.addEventListener('click', close);
                const open = view.foot.querySelector<HTMLButtonElement>('#research-adopt-open');
                if (open && url) {
                    open.addEventListener('click', () => {
                        void this.launchResearchLink(url, 'terminal', open).then(res => { if (res === 'opened') close(); });
                    });
                }
                return;
            }
            // Settled elsewhere: its own dialog, the hand-over's here goes.
            if (outcome.kind === 'empty' || outcome.kind === 'held' || outcome.kind === 'unreached') {
                close();
                if (outcome.kind === 'empty') await this.endEmptyHandOver(ctx.tree.id, ctx.fromInstall ? ctx.offer.token : null);
                else if (outcome.kind === 'held') await this.showResearchWriteHeld(outcome.held);
                // Not reached (B1 of the Windows round: Edge asks about "Apps on device" only now, at the
                // hand-over itself, and it was blocked): said as at the start, naming the setting. Once allowed
                // the hand-over is offered again (B2); the tab keeps ?adopt= meanwhile, a reload asks again.
                else if (await this.showResearchConnectFailed(outcome.err, { param: 'adopt', value: ctx.raw })) await this.adoptFromResearchNow(ctx.raw);
                return;
            }
            run.fail();
            const unchanged = state.backupSaved ? b.adoptUnchanged : b.adoptUnchangedPlain;
            const text = outcome.kind === 'timeout' ? `${b.errTimeout(ADOPT_POST_MS / 1000)} ${unchanged}` : `${b.adoptNotTaken} ${unchanged}`;
            const retry = (): void => { void attempt(); };
            // Folded away: the toast says it (it stays), its Try again brings the dialog back with the steps.
            if (!inDialog) {
                run.toastHandle?.fail(text, { label: b.retry, run: () => { show(); retry(); } },
                    { title: b.adoptFailedTitle, more: { label: r.sendExportGedcom, run: exportGedcom } });
            }
            this.researchAdoptResolve = close;
            view.failed(text, retry, close, exportGedcom);
        };
        await attempt();
    },

    /**
     * The steps of a hand-over (a backup, the GEDCOM, the research taking it, its version loaded), each
     * reported to `phase`; what it ended in. The backup is made once, a retry goes on from the GEDCOM.
     */
    async handResearchAdopt(ctx: AdoptRunCtx, state: AdoptRunState, phase: (p: AdoptPhase) => void, meta: (step: AdoptStep, text: string) => void): Promise<AdoptOutcome> {
        const { tree, data, choice } = ctx;
        phase({ step: 'backup' });
        // A backup before the tree first goes to the research (whatever the backup setting).
        if (!state.backupDone) {
            state.backupDone = true;
            if (DataManager.getCurrentTreeId() === tree.id && await DataManager.snapshotNow('pre-first-send')) {
                state.backupSaved = true;
                patchResearchAutoState(tree.id, { firstSendBackup: true });
            }
        }
        // Photos and attachments go only to a research that keeps them (`media.app`), when asked: else they stay here only.
        // A research that knows no titles gets the names without them (B-1): they stay here.
        const { titles, sourceFields, citations, media } = await researchTitlesAt(ctx.base);
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        phase({ step: 'gedcom', meta: strings.busy.adoptPeople(persons, persons.toLocaleString(getCurrentLanguage())) });
        // The step is on screen before the export holds the page a moment.
        await new Promise(resolve => setTimeout(resolve, 0));
        // (A tree the research has not had yet: its citations in the order of K1.1, never the list's own.)
        // The images read as the text is written (ged-export-images.ts): the tree is never expanded whole.
        // Never another research's numbers (a copy of a research tree): each goes as the file's own and gets this one's (K5.4).
        const exported = await exportGedcomWithImages(withoutResearchNumbers(choice.images ? data : stripMedia(data)), tree.name, { titles, sourceFields, citationMain: citations.citationMain, ...media });
        state.content = gedcomText(exported);
        phase({ step: 'taking' });
        let reply: { tree: string; head: string | null; ids: AdoptIds | null } | null = null;
        try {
            const res = await postSync(`${ctx.base}/adopt`, state.content, ADOPT_POST_MS);
            if (res.ok) reply = sanitizeAdoptReply(await res.json());
            // Held until something is settled in the research (sealed elsewhere, files not downloaded, its disk full).
            else if (res.status === 409 || res.status === 507) {
                const held = await res.json().then((b: { code?: unknown; error?: unknown; params?: unknown }) => writeHeldOfCode(b?.code, b?.error, b?.params), () => null);
                if (held) return { kind: 'held', held };
            } else if (res.status === 400 && await res.json().then((b: { code?: unknown }) => b?.code === 'tree.empty', () => false)) {
                return { kind: 'empty' };
            }
        } catch (err) {
            console.warn('Handing the tree to the research failed', err);
            if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) return { kind: 'timeout' };
            return { kind: 'unreached', err };
        }
        if (!reply) return { kind: 'refused' };
        // The research's numbers for what went over (its `ids`, by this file's xrefs): every later
        // send names its people, even when its version below does not come.
        let taken = data;
        let numbered = false;
        if (reply.ids && DataManager.getCurrentTreeId() === tree.id) {
            const withIds = applyAdoptIds(data, exported.xrefs, reply.ids);
            if (withIds.persons + withIds.sources > 0) {
                DataManager.replaceWithSourceData(tree.id, withIds.data);
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
        try { status = await fetchStatus(`${ctx.base}/status`, 4000); } catch { /* connected at the next open */ }
        if (status?.treeId !== reply.tree) noteResearchBridge(reply.tree, ctx.base);
        phase({ step: 'loading' });
        const loaded = await this.loadResearchAfterAdopt(tree.id, ctx.ged, reply.tree, reply.head,
            { progress: (got, total) => { const d = downloadStep(got, total); if (d.size) meta('loading', d.size); } });
        if (!loaded && !numbered && hasPeople) console.warn('The research numbers did not come with the hand-over: sending waits for its version', reply.tree);
        this.refreshResearchSyncUi();
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        this.refreshActionMenuBadges();
        TreeRenderer.render();
        // Linked with the research: its places not on the map, offered once (spec 034 U5 point 7).
        this.armPlacesOffer(tree.id);
        return { kind: 'linked', researchId: reply.tree, hasPeople };
    },

    /**
     * The research's own version of what it just took (its numbers, its
     * families) becomes the tree: the next send is compared to that there and
     * here, even when the research opens no ?import-url=. Tried a few times
     * (it may write it a moment after answering); every miss says why in the
     * console. True when it loaded.
     */
    async loadResearchAfterAdopt(treeId: TreeId, gedUrl: string, researchId: string, head: string | null, watch?: TreeDownloadWatch): Promise<boolean> {
        for (const wait of ADOPT_LOAD_WAITS) {
            if (wait) await new Promise(resolve => setTimeout(resolve, wait));
            let text: string;
            let images: ReadonlyMap<string, string> | undefined;
            let media: true | undefined;
            try {
                ({ text, images, media } = await readResearchTreeFile(gedUrl, this.researchStatusOf(researchId)?.features, watch));
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
                const done = await this.applyResearch(convertToStrom(parseGedcom(text), { images }).data, { ...header, ...(media ? { appMedia: true as const } : {}) },
                    { quiet: true, ...(head ? { head } : {}) });
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
        // A research whose agent is not on this computer (`accepts.agentHere: false`): it waits for one.
        let agentAway = false;
        let browser: BrowserInfo | null = null;
        try {
            const res = await fetchWithTimeout(`${base}/status`, 3000);
            if (res.ok) {
                const st = await res.json() as { path?: unknown; agent?: unknown; accepts?: { mode?: unknown; agentHere?: unknown } };
                if (typeof st.path === 'string') where = st.path.slice(0, 300);
                archive = st.accepts?.mode === 'archive';
                agentAway = !archive && st.accepts?.agentHere === false;
                // `tree.state` when the bridge says it: an archive, or a research waiting for its agent.
                const live = sanitizeLiveStatus(st);
                const state = live?.treeState;
                if (state) { archive = state === 'archive'; agentAway = state === 'waiting'; }
                // The agent's browser (spec 048 §11): only from a bridge that says it.
                browser = live?.browser ?? null;
                // `agent: { id, name, where? }` (an archive has none); a bare name from an older shape too.
                const named = st.agent && typeof st.agent === 'object' ? (st.agent as { name?: unknown }).name : st.agent;
                if (typeof named === 'string') agent = named.trim().slice(0, 120);
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
        // An archive says so (the tag of the Research menu), and nothing of an agent; an empty tree too.
        const kindRow = archive ? `<dt>${esc(s.kindLabel)}</dt><dd><span class="research-sync-tag research-sync-tag--inline" id="research-ready-archive">${esc(strings.sync.archiveTag)}</span></dd>` : '';
        // The agent's row; the Browser row goes right after it (filled below, kept up with each status).
        const agentRow = archive ? '' : `<dt>${esc(s.agentRowLabel)}</dt><dd class="install-ready-agent" data-row="agent"></dd>`;
        const rows = hasPeople ? `
                <dl class="install-ready-rows"${archive ? '' : ` data-browser-research="${esc(researchId)}"`}>
                    ${where ? `<dt>${esc(s.where)}</dt><dd class="install-ready-path">${esc(where)}</dd>` : ''}
                    ${kindRow}
                    ${agentRow}
                    <dt>${esc(s.originalsLabel)}</dt><dd>${esc(s.originalsRow)}</dd>
                </dl>
                ${archive ? '' : '<p class="browser-live" role="status" aria-live="polite"></p>'}` : kindRow ? `<dl class="install-ready-rows">${kindRow}</dl>` : '';
        const sendMode = researchSendMode(TreeManager.getTreeMetadata(DataManager.getCurrentTreeId() ?? ('' as TreeId))?.research);
        overlay.innerHTML = `
            <div class="modal modal--sm research-ready-modal" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="research-ready-title">
                <div class="modal-header">
                    <h2 id="research-ready-title"><span class="install-ready-check" aria-hidden="true">✓</span> ${esc(hasPeople ? s.readyTitle : s.liveTitle(researchName))}</h2>
                </div>
                <div class="modal-content">
                    <p>${esc(hasPeople ? s.readyText(sendMode) : s.liveText(sendMode))}</p>
                    ${rows}
                    ${movedFrom && hasPeople ? `<p class="install-ready-moved">${esc(movedFrom === 'mobile' ? strings.research.transferCopyLeftMobile : strings.research.transferCopyLeft(appBrowserName(movedFrom)))}</p>` : ''}
                    ${offerApp ? `<div class="install-ready-app">${APP_ICON_SVG}<div class="install-ready-app-text"><span class="install-ready-app-line">${esc(strings.research.transferAppNote)}</span><button type="button" class="link-button" data-act="install-app">${esc(strings.research.transferInstallApp)}</button></div></div>` : ''}
                </div>
                <div class="buttons">
                    ${hasPeople
                        ? `${open ? `<button type="button" class="link-button" data-act="open">${researchActionLabel(s.openResearch, researchLinkMark('open'))}</button>` : ''}
                           <button type="button" class="primary" data-act="done" data-dismiss>${esc(s.done)}</button>`
                        : `<button type="button" class="secondary" data-act="gedcom">${esc(s.openGedcom)}</button>
                           <button type="button" class="primary" data-act="first" data-dismiss>${esc(s.addFirst)}</button>`}
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(READY_ID);
        const agentDl = overlay.querySelector<HTMLElement>('dl[data-browser-research]');
        if (agentDl) {
            this.renderBrowserRows(agentDl, { name: agent, away: agentAway }, browser);
            this.watchBrowserRows();
        }
        const close = (): void => this.closeResearchReady();
        overlay.querySelectorAll<HTMLElement>('[data-act]').forEach(el => el.addEventListener('click', () => {
            const act = el.dataset.act;
            if (act === 'install-app') {
                // The dialog stays; accepted → the row goes with a toast, dismissed → it stays until the dialog closes
                // (a browser offers once: a click with no offer left takes the row away).
                const row = el.closest('.install-ready-app');
                if (!canPromptInstall()) { row?.remove(); return; }
                // The system's install question is its own state (A177): nothing shown, only no second question.
                void whilePicking(el, () => promptInstall()).then(ok => {
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
        // What the tree showed linked in the view only moves with it (a device setting of the tree).
        if (moved.viewLinks) restoreViewLinks(id, moved.viewLinks);
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

    askResearchAdopt(tree: TreeMetadata, offer: AdoptOffer, data: ReturnType<typeof DataManager.getData>, opts: { install?: boolean; movedFrom?: AppBrowser; agentless?: boolean; takesImages?: boolean } = {}): Promise<{ images: boolean; sendMode: ResearchSendMode } | null> {
        document.getElementById(ADOPT_ID)?.remove();
        const r = strings.research;
        // As the research counts them: people with a name (an unnamed "?" stays out of its count).
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const families = countFamilies(data);
        const sources = Object.keys(data.sources ?? {}).length;
        const images = countImages(data);
        // "Include photos and attachments" only for a research that keeps them (`media.app`, spec 108).
        const files = opts.takesImages ? images.photos + images.attachments + images.excerpts : 0;
        const researchName = offer.name || r.defaultName;
        const t = strings.treeSettings;
        // Into an archive (or a research waiting for its agent) by itself, with an agent by hand (audit 017 a-D5).
        const sendModeFirst = newTieSendMode(!!opts.agentless);
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
                        ${researchSendModeCardsHtml(sendModeFirst, undefined, 'research-adopt-send-mode', undefined, sendModeFirst)}
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
            const confirm = overlay.querySelector('#research-adopt-confirm') as HTMLButtonElement;
            const finish = (value: { images: boolean; sendMode: ResearchSendMode } | null): void => {
                // Handed over: the dialog stays and shows its steps (A175); a second click goes nowhere.
                confirm.onclick = null;
                this.researchAdoptResolve = null;
                if (value === null) this.closeResearchAdoptDialog();
                resolve(value);
            };
            this.researchAdoptResolve = () => finish(null);
            (overlay.querySelector('#research-adopt-cancel') as HTMLButtonElement).onclick = () => finish(null);
            confirm.onclick = () => {
                const box = overlay.querySelector<HTMLInputElement>('#research-adopt-images');
                finish({ images: box ? box.checked : false, sendMode: researchSendModeChecked(overlay, 'research-adopt-send-mode') ?? sendModeFirst });
            };
            confirm.focus();
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
