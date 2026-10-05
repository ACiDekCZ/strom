/**
 * Installing Strom Research from the app: one dialog, three steps — what it
 * is, the install line, waiting for the research to come back.
 *
 * Nothing is started, stored or asked of the network until the user goes on
 * to the Install step: only there the tree gets its token (the same kind as a
 * strom-research://new?app= link, valid 24 h) and the record of the
 * installation is kept. The research, installed by the pasted line, sets
 * itself up and opens the app with ?adopt=; the hand-over then finishes in
 * research-adopt-ui.ts (adoptFromResearch), which knows the token.
 *
 * The app never looks for the research: the bridge address carries a secret
 * token and is known only when the research opens the page with it.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeId } from '../types.js';
import { newAdoptToken, researchNewUrl } from '../research-link.js';
import { isPromoAvailable } from '../research-promo.js';
import {
    InstallOs, InstallRecord, INSTALL_OSES, INSTALL_RELEASE_URL,
    detectInstallOs, installLine, npmLines, installAppUrl, installPhase, newInstallRecord, INSTALL_KEY,
    readInstallRecord, writeInstallRecord, clearInstallRecord,
} from '../research-install.js';
import { onComputer } from './research-ui.js';
import { AppBrowser, appBrowserName, currentAppBrowser, needsTransfer, transferFileName, buildTransferJson } from '../research-transfer.js';
import { isIosDevice } from '../file-copy.js';
import { isStandaloneDisplay } from '../pwa.js';
import { SettingsManager } from '../settings.js';
import { STROM_DATA_VERSION, StromData } from '../types.js';
import { TreeRenderer } from '../renderer.js';
import { uiModule } from './module.js';

/** The dialog keeps the info dialog's id: one research dialog at a time, closed by the shared Escape handling. */
export const INSTALL_DIALOG_ID = 'research-info-modal';
/** localStorage: Safari's notice was answered "Continue here" (never shown again in this browser). */
const BROWSER_NOTICE_KEY = 'strom-browser-notice';
/** localStorage: the notice was shown once over a tree (at its first person); not again. */
const BROWSER_NOTICE_TREE_KEY = 'strom-browser-notice-tree';
/** The floating notice over a tree, and the old copy's dialog. */
const BROWSER_NOTICE_FLOAT_ID = 'browser-notice-float';
const OLD_COPY_ID = 'research-old-copy-modal';
/** Where Chrome is downloaded (the notice's link on a Mac or Linux; Windows has Edge). */
const CHROME_DOWNLOAD_URL = 'https://www.google.com/chrome/';
/** The channel the tab the research opens tells the others on. */
const INSTALL_CHANNEL = 'strom-install';

type InstallStep = 'what' | 'install' | 'wait';

/** The step on screen and the Install step's own state while the dialog is open. */
let current: { step: InstallStep; os: InstallOs; copied: boolean; otherOpen: boolean; resumed: boolean } | null = null;
let phaseTimer: ReturnType<typeof setInterval> | null = null;
let channel: BroadcastChannel | null = null;
let storageWatched = false;
/** Trees downloaded for a move in this page: the banner, not the old copy's question, until the next opening. */
const markedNow = new Set<TreeId>();
/** Old copies answered "Keep it for now" in this page (the banner then), and those already reminded at an edit. */
const keptNow = new Set<TreeId>();
const remindedNow = new Set<TreeId>();

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Chromium asks about the local network; the waiting step warns of it there only. */
function isChromium(): boolean {
    const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
    return !!brands?.some(b => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand)) || /Chrome\//.test(navigator.userAgent || '');
}

function detectedOs(): InstallOs {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
    return detectInstallOs(platform, navigator.userAgent || '');
}

const OS_NAMES = (): Record<InstallOs, string> => ({
    mac: strings.install.osMac, win: strings.install.osWin, linux: strings.install.osLinux,
});

/** The line with the token marked, as HTML. */
function lineHtml(line: string, token: string): string {
    const at = line.indexOf(token);
    if (at < 0) return esc(line);
    return `${esc(line.slice(0, at))}<span class="install-token">${esc(token)}</span>${esc(line.slice(at + token.length))}`;
}

/** "Safari can't connect to the research." for this browser. */
function noConnectLead(): string {
    return strings.research.noConnect(appBrowserName(currentAppBrowser()));
}

/** The browser the move is made from: a phone or tablet is "mobile" whatever its browser (the research is on a computer). */
function transferFrom(): AppBrowser {
    return onComputer() ? currentAppBrowser() : 'mobile';
}

/**
 * The app runs as Safari's own web app on a Mac (File → Add to Dock): an app
 * of its own in ~/Applications with storage apart from Safari's, beside which
 * a Strom installed from Chrome looks the same — after a move, the old icon
 * would open the old copy.
 */
function safariDockApp(): boolean {
    if (currentAppBrowser() !== 'safari' || !isStandaloneDisplay()) return false;
    return typeof navigator === 'undefined' || !isIosDevice(navigator.userAgent || '', navigator.platform || '', navigator.maxTouchPoints ?? 0);
}

function hasPeople(): boolean {
    return Object.values(DataManager.getData().persons).some(p => !p.isPlaceholder);
}

function timeOf(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' });
}

export const researchInstallMethods = uiModule({
    /** An installation is under way (its token still holds): the menu item says "Finish installing…". */
    researchInstallPending(): boolean {
        const record = readInstallRecord();
        // Its tree went to a research some other way (a research already installed, opened from it):
        // the installation is over — never "Finish installing" over a tree that has its research.
        if (record?.treeId && TreeManager.getTreeMetadata(record.treeId)?.research) {
            clearInstallRecord();
            return false;
        }
        // Its tree is gone (removed, "Remove this copy" after a move): nothing to finish.
        if (record?.treeId && !TreeManager.getTreeMetadata(record.treeId)) {
            clearInstallRecord();
            return false;
        }
        // Only for the tree it was started for (an installation without a tree: for an empty one).
        const active = DataManager.getCurrentTreeId() ?? TreeManager.getActiveTreeId();
        if (record && (record.treeId ? record.treeId !== active : hasPeople())) return false;
        const phase = installPhase(record);
        return phase === 'waiting' || phase === 'long';
    },

    /**
     * Open the dialog. Without a step: the waiting step while an
     * installation is under way, else "What it is". On a phone or tablet the
     * short variant (it installs on a computer).
     */
    showResearchInstall(step?: InstallStep): void {
        this.closeActionsMenu();
        this.hideBottomSheet();
        this.hideWhatsNewCard();
        this.dismissResearchNew();
        document.getElementById(INSTALL_DIALOG_ID)?.remove();
        // Focus goes back to the visible menu trigger when the dialog closes
        // (dialog-focus.ts remembers what had focus when it opened).
        const trigger = [document.querySelector('.actions-menu-btn'), document.getElementById('bb-view-more')]
            .find((n): n is HTMLElement => n instanceof HTMLElement && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden');
        if (trigger && document.activeElement?.closest('#actions-menu-dropdown, .bottom-sheet-menu')) {
            trigger.focus({ preventScroll: true });
        }
        const record = readInstallRecord();
        const phase = installPhase(record);
        const resumed = !step && (phase === 'waiting' || phase === 'long' || phase === 'expired');
        const first: InstallStep = step ?? (resumed ? 'wait' : 'what');
        current = {
            step: first, os: record?.os ?? (onComputer() || detectedOs() !== 'linux' ? detectedOs() : 'win'), copied: false, otherOpen: false, resumed,
        };
        // The Install step makes the token; opened straight on it, that happens now.
        if (first === 'install') this.ensureInstallRecord();
        this.renderResearchInstall();
        this.pushDialog(INSTALL_DIALOG_ID);
        this.listenResearchInstallDone();
    },

    /** The token and the install record, made on the Install step (the same token while it holds). */
    ensureInstallRecord(): InstallRecord {
        const os = current?.os ?? detectedOs();
        const held = readInstallRecord();
        const treeId: TreeId | null = DataManager.getCurrentTreeId() ?? TreeManager.getActiveTreeId();
        if (held && installPhase(held) !== 'expired' && held.treeId === treeId) {
            if (held.os !== os) writeInstallRecord({ ...held, os });
            return { ...held, os };
        }
        const record = newInstallRecord(newAdoptToken(), treeId, os);
        writeInstallRecord(record);
        // The tree waits to be taken over by this token (adoptFromResearch finds it by it).
        if (treeId && TreeManager.getTreeMetadata(treeId)) {
            TreeManager.setResearchAdoptToken(treeId, { token: record.token, at: record.createdAt });
        }
        return record;
    },

    goResearchInstallStep(step: InstallStep): void {
        if (!current) return;
        if (step === 'install') this.ensureInstallRecord();
        current.step = step;
        current.otherOpen = false;
        this.renderResearchInstall();
    },

    /** Draw the dialog for the step on screen (built anew each time). */
    renderResearchInstall(): void {
        if (!current) return;
        const s = strings.install;
        let overlay = document.getElementById(INSTALL_DIALOG_ID);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = INSTALL_DIALOG_ID;
            overlay.className = 'modal-overlay active';
            overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeResearchInstall(); });
            document.body.appendChild(overlay);
        }
        const touch = !onComputer();
        const step = current.step;
        const pills = touch ? '' : `
            <ol class="install-steps" aria-label="${esc(s.title)}">
                ${(['what', 'install', 'wait'] as InstallStep[]).map((k, i, all) => {
                    const done = all.indexOf(step) > i;
                    const label = k === 'what' ? s.stepWhat : k === 'install' ? s.stepInstall : s.stepWait;
                    return `<li class="install-step${k === step ? ' active' : ''}${done ? ' done' : ''}"${k === step ? ' aria-current="step"' : ''}>${done ? '✓ ' : ''}${esc(label)}</li>`;
                }).join('')}
            </ol>`;
        const body = touch ? this.researchInstallMobileHtml()
            : step === 'what' ? this.researchInstallWhatHtml()
            : step === 'install' ? this.researchInstallLineHtml()
            : this.researchInstallWaitHtml();
        overlay.innerHTML = `
            <div class="modal research-install-dialog${touch ? ' research-install-touch' : ''}" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="research-install-title" data-step="${touch ? 'touch' : step}">
                <div class="modal-header">
                    <h2 id="research-install-title">${esc(step === 'install' && !touch ? s.installTitle : s.title)}</h2>
                    <button type="button" class="close-btn" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                ${pills}
                ${body}
            </div>`;
        this.bindResearchInstall(overlay);
        this.bindBrowserNotice(overlay);
        this.syncResearchInstallTimer();
    },

    /** 2a: what it is — the archive and the agent side by side (nothing is chosen here). */
    researchInstallWhatHtml(): string {
        const s = strings.install;
        const tree = TreeManager.getActiveTreeMetadata();
        const people = Object.values(DataManager.getData().persons).some(p => !p.isPlaceholder);
        // A browser that cannot reach the research moves the tree (never "it stays here").
        const moving = needsTransfer(currentAppBrowser()) || !onComputer();
        const mobile = !onComputer();
        const intro = tree && people ? (moving ? s.introMove(tree.name, mobile) : s.intro(tree.name)) : moving ? s.introMoveEmpty(mobile) : s.introEmpty;
        return `
            <div class="modal-content install-body">
                <p class="install-intro">${esc(intro)}</p>
                <div class="install-cards">
                    <div class="install-card install-card-agent">
                        <div class="install-card-head"><h3>${esc(s.agent)}</h3><span class="install-tag install-tag-agent">${esc(s.agentTag)}</span></div>
                        <p>${esc(s.agentText)}</p>
                        <div class="install-card-foot">${esc(s.agentFoot)}</div>
                    </div>
                    <div class="install-card install-card-archive">
                        <div class="install-card-head"><h3>${esc(s.archive)}</h3><span class="install-tag install-tag-free">${esc(s.archiveTag)}</span></div>
                        <p>${esc(s.archiveText)}</p>
                        <div class="install-card-foot">${esc(s.archiveFoot)}</div>
                    </div>
                </div>
                <p class="install-later">${esc(s.choiceLater)}</p>
                ${this.browserNoticeApplies() ? this.browserNoticeHtml({ stay: false, install: false }) : ''}
            </div>
            <div class="buttons">
                <button type="button" class="link-button install-web" data-act="web">${esc(s.web)}</button>
                <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
                <button type="button" class="primary" data-act="install">${esc(s.cta)}</button>
            </div>`;
    },

    /** 3a–3d: the line for this computer's system, its three steps, Copy; npm folded away. */
    researchInstallLineHtml(): string {
        const s = strings.install;
        const st = current!;
        const record = this.ensureInstallRecord();
        const os = st.os;
        const names = OS_NAMES();
        const steps = os === 'mac' ? s.stepsMac : os === 'win' ? s.stepsWin : s.stepsLinux;
        const what = os === 'mac' ? s.whatMac : os === 'win' ? s.whatWin : s.whatLinux;
        // Another copy than the public app (the beta): the research must open this one.
        const appUrl = installAppUrl(window.location.href);
        // The tree's name: the research suggests it as its own (an empty tree from the welcome screen: none).
        const treeName = record.treeId ? TreeManager.getTreeMetadata(record.treeId)?.name ?? '' : '';
        // The browser it came from: the research opens that one again. Safari cannot reach the
        // research: the tree moves by a file, and the line shows once it is downloaded.
        const browser = currentAppBrowser();
        const transfer = needsTransfer(browser);
        const extra = { browser, ...(record.file ? { file: record.file } : {}) };
        const line = installLine(os, record.token, appUrl, treeName, extra);
        const [npm1, npm2] = npmLines(os, record.token, appUrl, treeName, extra);
        const lineShown = !transfer || !!record.file;
        return `
            <div class="modal-content install-body">
                <div class="install-os-row">
                    <div class="install-os" role="radiogroup" aria-label="${esc(s.detected(names[os]))}">
                        ${INSTALL_OSES.map(o => `<button type="button" role="radio" aria-checked="${o === os}" class="install-os-btn${o === os ? ' active' : ''}" data-os="${o}">${esc(names[o])}</button>`).join('')}
                    </div>
                    <span class="install-detected">${esc(s.detected(names[detectedOs()]))}</span>
                </div>
                ${transfer ? this.researchInstallTransferHtml(record.file ?? null, treeName) : ''}
                <div class="install-what"><strong>${esc(s.whatTitle)}</strong> ${esc(what)}</div>
                ${os === 'mac' ? `<p class="install-warn install-apple">${esc(s.appleNote)}</p>` : ''}
                <ol class="install-howto">${steps.map((t, i) => `<li><span class="install-num" aria-hidden="true">${i + 1}</span><span>${esc(t)}</span></li>`).join('')}</ol>
                ${lineShown ? `<div class="install-line-row">
                    <code class="install-line" tabindex="0" data-line="${esc(line)}">${lineHtml(line, record.token)}</code>
                    <button type="button" class="install-copy${st.copied ? ' copied' : ''}" data-act="copy">${esc(st.copied ? s.copied : s.copy)}</button>
                </div>
                <p class="install-after">${esc(transfer ? (st.copied ? s.afterCopiedTransfer : s.afterTransfer) : st.copied ? s.afterCopied : s.after)}</p>` : `<div class="install-line-row"><p class="install-line-later">${esc(s.transferLineAfter)}</p></div>`}
                ${lineShown ? `<details class="install-other"${st.otherOpen ? ' open' : ''}>
                    <summary>${esc(s.other)}</summary>
                    <p>${esc(s.npmIntro)}</p>
                    <div class="install-line-row">
                        <code class="install-line install-npm" tabindex="0" data-line="${esc(`${npm1}\n${npm2}`)}">${esc(npm1)}<br>${lineHtml(npm2, record.token)}</code>
                        <button type="button" class="install-copy" data-act="copy-npm">${esc(s.copy)}</button>
                    </div>
                    <a class="install-release" href="${esc(INSTALL_RELEASE_URL)}" target="_blank" rel="noopener">${esc(INSTALL_RELEASE_URL.replace(/^https:\/\//, ''))} ↗</a>
                </details>` : ''}
            </div>
            <div class="buttons">
                <button type="button" class="link-button" data-act="have">${esc(this.researchHaveItLabel())}</button>
                <button type="button" class="link-button" data-act="back">${esc(s.back)}</button>
                <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
                <button type="button" class="primary" data-act="pasted"${lineShown ? '' : ' disabled'}>${esc(s.pasted)}</button>
            </div>`;
    },

    /** Safari: the tree moves to another browser — said first, then downloaded for the research to find. */
    researchInstallTransferHtml(file: string | null, treeName: string): string {
        const s = strings.install;
        const lead = noConnectLead();
        const people = !!treeName && hasPeople();
        const from = appBrowserName(currentAppBrowser()) || s.thisBrowser;
        return `
            <div class="install-what install-transfer${file ? ' install-transfer-downloaded' : ''}">
                <div class="install-transfer-head">
                    <strong>${esc(s.transferTitle)}</strong>
                    <span class="install-transfer-route">${esc(people ? s.transferRoute(from) : s.transferRouteEmpty(from))}</span>
                </div>
                <p class="install-transfer-text">${esc(people ? s.transferText(treeName, lead) : s.transferTextEmpty(lead))}</p>
                <div class="install-transfer-row">
                    ${file
                        ? `<span class="install-transfer-done">${esc(s.transferDownloaded)}</span>
                           <code class="install-transfer-file">${esc(file)}</code>
                           <button type="button" class="link-button" data-act="transfer-download">${esc(s.transferAgain)}</button>`
                        : `<button type="button" class="secondary" data-act="transfer-download">${esc(s.transferDownload)}</button>`}
                </div>
                <p class="install-transfer-note">${esc(s.transferFileNote)}</p>
                ${SettingsManager.isEncryptionEnabled() ? `<p class="install-warn">${esc(s.transferEncrypted)}</p>` : ''}
            </div>`;
    },

    /**
     * Download the tree for the move: the whole tree (images too) as JSON with
     * the transfer mark first; the line then names the file. The tree is
     * marked as moving (its banner) — the research takes it over elsewhere.
     */
    async downloadResearchTransfer(): Promise<void> {
        const record = this.ensureInstallRecord();
        const treeId = record.treeId;
        let data: StromData | null;
        if (!treeId) data = { version: STROM_DATA_VERSION, persons: {}, partnerships: {} };
        else data = DataManager.getCurrentTreeId() === treeId ? DataManager.getData() : await TreeManager.getTreeData(treeId);
        if (!data) {
            await this.showAlert(strings.storageSafety.treeLocked, 'warning');
            return;
        }
        const tree = treeId ? TreeManager.getTreeMetadata(treeId) : null;
        const file = transferFileName(record.token);
        const from = transferFrom();
        const appCopy = installAppUrl(window.location.href);
        const text = buildTransferJson({
            v: 1, token: record.token, from,
            tree: tree?.name ?? '',
            persons: Object.values(data.persons).filter(p => p && !p.isPlaceholder).length,
            at: new Date().toISOString(),
            ...(appCopy ? { app: appCopy } : {}),
        }, { ...data, version: STROM_DATA_VERSION });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = file;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
        writeInstallRecord({ ...record, file });
        if (treeId && tree && Object.values(data.persons).some(p => p && !p.isPlaceholder)) {
            markedNow.add(treeId);
            TreeManager.setResearchTransfer(treeId, { at: new Date().toISOString(), ...(from === 'mobile' ? { mobile: true as const } : {}) });
            this.renderResearchTransferBanner();
        }
        if (current) current.copied = false;
        this.renderResearchInstall();
    },

    /**
     * A tree downloaded to move to another browser (or from a phone to a
     * computer): work goes on there, an older copy stays here. In the page
     * that downloaded it a banner says so; at every later opening the old
     * copy asks first — remove it, the move did not happen, or keep it for
     * now (the banner then, and one reminder at the first edit). Nothing is
     * removed by itself; a tree that got its research here shows neither.
     */
    renderResearchTransferBanner(): void {
        const tree = TreeManager.getActiveTreeMetadata();
        const mark = tree?.researchTransfer;
        let banner = document.getElementById('research-transfer-banner');
        if (!tree || !mark || tree.research) {
            banner?.remove();
            return;
        }
        if (!markedNow.has(tree.id) && !keptNow.has(tree.id)) {
            banner?.remove();
            this.showResearchOldCopy(tree.id);
            return;
        }
        const r = strings.research;
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'research-transfer-banner';
            banner.className = 'embedded-mode-banner research-transfer-banner visible';
            banner.setAttribute('role', 'status');
            document.body.appendChild(banner);
        }
        banner.innerHTML = `
            <span class="embedded-mode-icon"><svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="4" width="13" height="10" rx="2"/><rect x="9" y="10" width="13" height="10" rx="2"/></svg></span>
            <span class="embedded-mode-text"><span class="embedded-mode-detail">${esc(mark.mobile ? r.transferBannerMobile(tree.name) : r.transferBanner(tree.name))}</span></span>
            <button type="button" class="embedded-mode-link research-transfer-undo">${esc(r.transferNotDone)}</button>`;
        const treeId = tree.id;
        banner.querySelector('.research-transfer-undo')?.addEventListener('click', () => {
            TreeManager.setResearchTransfer(treeId, null);
            this.renderResearchTransferBanner();
        });
    },

    /** "This tree is now in another browser": the old copy's question at its opening. */
    showResearchOldCopy(treeId: TreeId): void {
        const tree = TreeManager.getTreeMetadata(treeId);
        const mark = tree?.researchTransfer;
        if (!tree || !mark || document.getElementById(OLD_COPY_ID)) return;
        const r = strings.research;
        const at = new Date(mark.at);
        const date = Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString(getCurrentLanguage());
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = OLD_COPY_ID;
        overlay.innerHTML = `
            <div class="modal modal--sm research-old-copy" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="research-old-copy-title">
                <div class="modal-header">
                    <h2 id="research-old-copy-title">${esc(mark.mobile ? r.oldCopyTitleMobile : r.oldCopyTitle)}</h2>
                </div>
                <div class="modal-content">
                    <p>${esc(mark.mobile ? r.oldCopyTextMobile(tree.name, date) : r.oldCopyText(tree.name, date))}</p>
                    ${safariDockApp() ? `<p class="research-old-copy-app">${esc(r.oldCopyDockShort)}</p>` : ''}
                </div>
                <div class="buttons">
                    <button type="button" class="link-button research-old-copy-remove" data-act="remove">${esc(r.oldCopyRemove)}</button>
                    <button type="button" class="secondary" data-act="not-done">${esc(r.transferNotDone)}</button>
                    <button type="button" class="primary" data-act="keep" data-dismiss>${esc(r.oldCopyKeep)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(OLD_COPY_ID);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.keepResearchOldCopy(); });
        overlay.querySelectorAll<HTMLElement>('[data-act]').forEach(el => el.addEventListener('click', () => {
            const act = el.dataset.act;
            if (act === 'keep') this.keepResearchOldCopy();
            else if (act === 'not-done') {
                this.closeResearchOldCopy();
                TreeManager.setResearchTransfer(treeId, null);
                this.renderResearchTransferBanner();
            } else if (act === 'remove') void this.removeResearchOldCopy(treeId);
        }));
        overlay.querySelector<HTMLElement>('.primary')?.focus();
    },

    closeResearchOldCopy(): void {
        document.getElementById(OLD_COPY_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== OLD_COPY_ID);
    },

    /** "Keep it for now" (and Escape, by [data-dismiss]): the banner for this opening; asked again at the next. */
    keepResearchOldCopy(): void {
        const id = TreeManager.getActiveTreeId();
        this.closeResearchOldCopy();
        if (id) keptNow.add(id);
        this.renderResearchTransferBanner();
    },

    /** "Remove this copy", confirmed: the tree goes here only (the other browser and the research keep it). */
    async removeResearchOldCopy(treeId: TreeId): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree) return;
        const r = strings.research;
        this.closeResearchOldCopy();
        const ok = await this.showConfirm(tree.researchTransfer?.mobile ? r.oldCopyConfirmMobile : r.oldCopyConfirm, r.oldCopyConfirmTitle,
            { confirmLabel: r.oldCopyRemove, variant: 'danger' });
        if (!ok) {
            // Not removed: the question again (nothing was decided).
            this.showResearchOldCopy(treeId);
            return;
        }
        const name = tree.name;
        const wasActive = TreeManager.getActiveTreeId() === treeId;
        await TreeManager.deleteTree(treeId);
        if (!TreeManager.hasTrees()) {
            // The only tree: the welcome screen, with the notice.
            DataManager.createNewTree(strings.treeManager.defaultTreeName);
        } else if (wasActive) {
            await DataManager.switchTree(TreeManager.getActiveTreeId()!);
        }
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        TreeRenderer.render();
        this.renderResearchTransferBanner();
        this.placeBrowserNotices();
        this.showToast(r.oldCopyRemoved(name), 6000);
        // Safari's own app (Add to Dock) keeps its icon and its storage: how it goes too.
        if (safariDockApp()) void this.showAlert(r.oldCopyDockApp, 'info');
    },

    /** The first edit in a tree that moved away: once, that changes here do not reach the research. */
    remindResearchOldCopy(treeId: TreeId): void {
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree?.researchTransfer || tree.research || remindedNow.has(treeId)) return;
        remindedNow.add(treeId);
        this.showToast(strings.research.oldCopyReminder(tree.name), 8000);
    },

    /** The transfer banner follows the open tree (at start and at every switch); Safari's notice where a tree begins. */
    initResearchTransferBanner(): void {
        this.renderResearchTransferBanner();
        window.addEventListener('strom:tree-switched', () => this.renderResearchTransferBanner());
        window.addEventListener('strom:user-change', (e) => {
            const treeId = (e as CustomEvent<{ treeId?: TreeId }>).detail?.treeId;
            if (!treeId) return;
            this.remindResearchOldCopy(treeId);
            this.maybeShowBrowserNoticeInTree(treeId);
        });
        this.placeBrowserNotices();
    },

    /**
     * A browser that cannot reach the research on a computer (Safari and
     * other WebKit browsers, one unknown): said where a tree begins (the welcome
     * screen, "Data elsewhere", once over a tree at its first person) so a
     * family is entered in Chrome or Edge from the start, or the research is
     * installed first. Not on an iPad or a phone (no research there), not
     * once "Continue here" was chosen. The move by a file stays the rescue.
     */
    browserNoticeApplies(): boolean {
        if (!needsTransfer(currentAppBrowser()) || !onComputer()) return false;
        // An iPad asks for the desktop site as a Mac: its touch points give it away.
        if (typeof navigator !== 'undefined' && isIosDevice(navigator.userAgent || '', navigator.platform || '', navigator.maxTouchPoints ?? 0)) return false;
        return isPromoAvailable(this.researchPromoContext());
    },

    browserNoticeDismissed(): boolean {
        try { return localStorage.getItem(BROWSER_NOTICE_KEY) === 'here'; } catch { return false; }
    },

    /**
     * The notice's markup. `install` adds "Install the research" (not inside
     * the install dialog itself), `stay` adds "Continue here" (not there
     * either); "Download Chrome" only where Chrome may well be missing (a
     * Mac, Linux — Windows has Edge).
     */
    browserNoticeHtml(opts: { stay: boolean; install: boolean }): string {
        const r = strings.research;
        const chrome = detectedOs() !== 'win';
        return `
            <div class="browser-notice" role="note">
                <p>${esc(r.browserNotice(noConnectLead()))}</p>
                <div class="browser-notice-actions">
                    ${opts.install ? `<button type="button" class="link-button" data-browser-notice="install">${esc(r.browserNoticeInstall)}</button>` : ''}
                    <button type="button" class="link-button" data-browser-notice="copy">${esc(r.browserNoticeCopy)}</button>
                    ${chrome ? `<button type="button" class="link-button" data-browser-notice="chrome">${esc(r.browserNoticeChrome)} <span aria-hidden="true">↗</span></button>` : ''}
                    ${opts.stay ? `<button type="button" class="link-button browser-notice-stay" data-browser-notice="stay">${esc(r.browserNoticeStay)}</button>` : ''}
                </div>
            </div>`;
    },

    /** Its two actions, wherever it stands. */
    bindBrowserNotice(root: ParentNode): void {
        root.querySelectorAll<HTMLButtonElement>('[data-browser-notice]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = btn.dataset.browserNotice;
            if (act === 'stay') {
                try { localStorage.setItem(BROWSER_NOTICE_KEY, 'here'); } catch { /* shown again next time */ }
                this.placeBrowserNotices();
                this.closeBrowserNoticeFloat();
                return;
            }
            if (act === 'install') {
                this.closeBrowserNoticeFloat();
                if (document.getElementById('import-file-modal')?.classList.contains('active')) this.closeImportFileDialog();
                this.showResearchInstall();
                return;
            }
            if (act === 'chrome') {
                window.open(CHROME_DOWNLOAD_URL, '_blank', 'noopener');
                return;
            }
            // A page in Safari cannot open Chrome: the address goes on the clipboard.
            const url = new URL(window.location.href);
            url.search = '';
            url.hash = '';
            void navigator.clipboard.writeText(url.toString()).then(
                () => this.showToast(strings.connect.linkCopied, 5000),
                () => this.showToast(url.toString(), 10000));
        }));
    },

    /** Put the notice on the welcome screen and in "Data elsewhere" (or take it away). */
    placeBrowserNotices(): void {
        const show = this.browserNoticeApplies() && !this.browserNoticeDismissed();
        const spots: [Element | null, 'prepend' | 'afterHeader'][] = [
            [document.querySelector('#empty-state > .empty-state-text:not(.empty-state-locked)'), 'prepend'],
            [document.querySelector('#import-file-modal .modal'), 'afterHeader'],
        ];
        for (const [spot, where] of spots) {
            if (!spot) continue;
            spot.querySelector(':scope > .browser-notice')?.remove();
            if (!show) continue;
            const holder = document.createElement('div');
            holder.innerHTML = this.browserNoticeHtml({ stay: true, install: true }).trim();
            const notice = holder.firstElementChild as HTMLElement;
            if (where === 'prepend') spot.prepend(notice);
            else spot.querySelector(':scope > .modal-header')?.after(notice);
            this.bindBrowserNotice(notice);
        }
    },

    /**
     * The first person of a tree in such a browser: the notice once more,
     * over the tree — whoever skipped the welcome screen (a new tree, a GEDCOM
     * import) sees it too. Once per browser, never after "Continue here".
     */
    maybeShowBrowserNoticeInTree(treeId: TreeId): void {
        if (DataManager.getCurrentTreeId() !== treeId || !this.browserNoticeApplies() || this.browserNoticeDismissed()) return;
        try { if (localStorage.getItem(BROWSER_NOTICE_TREE_KEY)) return; } catch { return; }
        const people = Object.values(DataManager.getData().persons).filter(p => !p.isPlaceholder).length;
        if (people !== 1 || document.getElementById(BROWSER_NOTICE_FLOAT_ID)) return;
        try { localStorage.setItem(BROWSER_NOTICE_TREE_KEY, '1'); } catch { /* shown once anyway in this page */ }
        const holder = document.createElement('div');
        holder.innerHTML = this.browserNoticeHtml({ stay: true, install: true }).trim();
        const notice = holder.firstElementChild as HTMLElement;
        notice.id = BROWSER_NOTICE_FLOAT_ID;
        notice.classList.add('browser-notice-float');
        notice.setAttribute('role', 'dialog');
        notice.setAttribute('aria-label', strings.install.title);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'close-btn browser-notice-close';
        close.setAttribute('aria-label', strings.buttons.close);
        close.innerHTML = '&times;';
        close.addEventListener('click', () => this.closeBrowserNoticeFloat());
        notice.prepend(close);
        document.body.appendChild(notice);
        this.bindBrowserNotice(notice);
    },

    closeBrowserNoticeFloat(): void {
        document.getElementById(BROWSER_NOTICE_FLOAT_ID)?.remove();
    },

    /** 4a–4c: waiting (no time limit here), waiting long, the command expired. */
    researchInstallWaitHtml(): string {
        const s = strings.install;
        const record = readInstallRecord();
        let phase = installPhase(record);
        if (phase === 'none') phase = 'expired';
        // Opened again later (the menu's "Finish installing…"): the longer text right away.
        if (phase === 'waiting' && current?.resumed) phase = 'long';
        if (phase === 'expired') {
            return `
                <div class="modal-content install-body install-wait" data-phase="expired">
                    <h3 class="install-wait-title">${esc(s.expiredTitle)}</h3>
                    <p>${esc(s.expiredText)}</p>
                    <p class="install-wait-links"><button type="button" class="link-button" data-act="have">${esc(this.researchHaveItLabel())}</button></p>
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
                    <button type="button" class="primary" data-act="new">${esc(s.newCommand)}</button>
                </div>`;
        }
        const long = phase === 'long';
        return `
            <div class="modal-content install-body install-wait" data-phase="${phase}">
                <div class="install-dots" aria-hidden="true"><span></span><span></span><span></span></div>
                <h3 class="install-wait-title" role="status">${esc(long ? s.waitLongTitle : s.waitTitle)}</h3>
                <p>${esc(long ? s.waitLongText : needsTransfer(currentAppBrowser()) ? s.waitTextTransfer : s.waitText)}</p>
                ${isChromium() ? `<p class="install-note">${esc(s.waitLna)}</p>` : ''}
                <p class="install-wait-links">
                    <button type="button" class="link-button" data-act="again">${esc(s.showAgain)}</button>
                    <button type="button" class="link-button" data-act="have">${esc(this.researchHaveItLabel())}</button>
                </p>
            </div>
            <div class="buttons">
                <span class="install-foot-note">${esc(long && record ? s.startedAt(timeOf(record.createdAt)) : s.waitClose)}</span>
                <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
            </div>`;
    },

    /**
     * 2b: on a phone or tablet — what it is, briefly. The research is
     * installed on a computer: a tree with people goes there as a file (the
     * same file a move from Safari makes, its line naming it); an empty one
     * only needs the link sent to the computer (nothing is stored).
     */
    researchInstallMobileHtml(): string {
        const s = strings.install;
        const tree = TreeManager.getActiveTreeMetadata();
        const people = hasPeople();
        return `
            <div class="modal-content install-body">
                <p class="install-intro">${esc(tree && people ? s.intro(tree.name) : s.introEmpty)}</p>
                <div class="install-cards">
                    <div class="install-card install-card-agent">
                        <div class="install-card-head"><h3>${esc(s.agent)}</h3><span class="install-tag install-tag-agent">${esc(s.agentTag)}</span></div>
                        <p>${esc(s.agentShort)}</p>
                    </div>
                    <div class="install-card install-card-archive">
                        <div class="install-card-head"><h3>${esc(s.archive)}</h3><span class="install-tag install-tag-free">${esc(s.archiveTag)}</span></div>
                        <p>${esc(s.archiveShort)}</p>
                    </div>
                </div>
                ${tree && people ? this.researchInstallMobileTransferHtml(tree.name) : `<div class="install-mobile-box">
                    <p>${esc(s.mobileOnly)}</p>
                    <button type="button" class="secondary install-send-link" data-act="send-link">${esc(s.sendLink)}</button>
                </div>`}
            </div>
            <div class="buttons">
                <button type="button" class="link-button install-web" data-act="web">${esc(s.web)}</button>
                <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
            </div>`;
    },

    /** The phone's move: download the tree, then the line for the computer's terminal (its system picked here). */
    researchInstallMobileTransferHtml(treeName: string): string {
        const s = strings.install;
        const st = current!;
        const held = readInstallRecord();
        const treeId = DataManager.getCurrentTreeId() ?? TreeManager.getActiveTreeId();
        // Downloaded already (this tree, its token still holding): the line right away.
        const record = held && installPhase(held) !== 'expired' && held.treeId === treeId && held.file ? this.ensureInstallRecord() : null;
        const file = record?.file ?? null;
        const names = OS_NAMES();
        const canShare = typeof (navigator as Navigator & { share?: unknown }).share === 'function';
        let lineBlock = '';
        if (record && file) {
            const line = installLine(st.os, record.token, installAppUrl(window.location.href), treeName, { browser: 'mobile', file });
            lineBlock = `
                <p class="install-mobile-line-label">${esc(s.mobileLine)}</p>
                <div class="install-os" role="radiogroup" aria-label="${esc(s.mobileLine)}">
                    ${INSTALL_OSES.map(o => `<button type="button" role="radio" aria-checked="${o === st.os}" class="install-os-btn${o === st.os ? ' active' : ''}" data-os="${o}">${esc(names[o])}</button>`).join('')}
                </div>
                <div class="install-line-row">
                    <code class="install-line" tabindex="0" data-line="${esc(line)}">${lineHtml(line, record.token)}</code>
                    <button type="button" class="install-copy${st.copied ? ' copied' : ''}" data-act="copy">${esc(st.copied ? s.copied : s.copy)}</button>
                </div>
                ${canShare ? `<button type="button" class="primary install-send-line" data-act="send-line">${esc(s.sendLine)}</button>` : ''}
                <p class="install-note">${esc(s.mobileFileNote)}</p>`;
        }
        return `
            <div class="install-mobile-box install-transfer">
                <p>${esc(s.mobileTransfer(treeName))}</p>
                <div class="install-transfer-row">
                    ${file
                        ? `<span class="install-transfer-done">${esc(s.transferDownloaded)}</span>
                           <button type="button" class="link-button" data-act="transfer-download">${esc(s.transferAgain)}</button>`
                        : `<button type="button" class="primary" data-act="transfer-download">${esc(s.transferDownload)}</button>`}
                </div>
                ${lineBlock}
                ${SettingsManager.isEncryptionEnabled() ? `<p class="install-warn">${esc(s.transferEncrypted)}</p>` : ''}
            </div>`;
    },

    /** Phone: the line to the computer by the system's share sheet (AirDrop, a message); else copied. */
    async sendResearchInstallLine(): Promise<void> {
        const code = document.querySelector<HTMLElement>(`#${INSTALL_DIALOG_ID} .install-line`);
        const text = code?.dataset.line ?? '';
        if (!text) return;
        const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
        if (typeof nav.share === 'function') {
            try { await nav.share({ text }); return; } catch (err) {
                if ((err as { name?: string })?.name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(text);
            this.showToast(strings.install.lineCopiedMobile, 5000);
        } catch {
            void this.copyResearchInstallLine(code, true);
        }
    },

    bindResearchInstall(overlay: HTMLElement): void {
        overlay.querySelector('.close-btn')?.addEventListener('click', () => this.closeResearchInstall());
        overlay.querySelector('[data-dismiss]')?.addEventListener('click', () => this.closeResearchInstall());
        overlay.querySelectorAll<HTMLButtonElement>('.install-os-btn').forEach(btn => btn.addEventListener('click', () => {
            if (!current) return;
            current.os = btn.dataset.os as InstallOs;
            // "Copied" holds until the system changes: it was another line.
            current.copied = false;
            this.ensureInstallRecord();
            this.renderResearchInstall();
            overlay.querySelector<HTMLButtonElement>(`.install-os-btn[data-os="${current.os}"]`)?.focus();
        }));
        overlay.querySelector('details.install-other')?.addEventListener('toggle', (e) => {
            if (current) current.otherOpen = (e.target as HTMLDetailsElement).open;
        });
        // A click selects the whole line (to copy by hand).
        overlay.querySelectorAll<HTMLElement>('.install-line').forEach(code => code.addEventListener('click', () => {
            const range = document.createRange();
            range.selectNodeContents(code);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        }));
        overlay.querySelectorAll<HTMLElement>('[data-act]').forEach(el => el.addEventListener('click', () => {
            const act = el.dataset.act;
            if (act === 'install') this.goResearchInstallStep('install');
            else if (act === 'back') this.goResearchInstallStep('what');
            else if (act === 'pasted' || act === 'wait') this.goResearchInstallStep('wait');
            else if (act === 'again') this.goResearchInstallStep('install');
            else if (act === 'new') {
                clearInstallRecord();
                if (current) current.copied = false;
                this.goResearchInstallStep('install');
            } else if (act === 'web') this.openResearchSite();
            else if (act === 'have') void this.researchInstallHaveIt();
            else if (act === 'copy' || act === 'copy-npm') {
                const code = el.parentElement?.querySelector<HTMLElement>('.install-line');
                void this.copyResearchInstallLine(code, act === 'copy');
            } else if (act === 'send-link') void this.sendResearchInstallLink();
            else if (act === 'send-line') void this.sendResearchInstallLine();
            else if (act === 'transfer-download') void this.downloadResearchTransfer();
        }));
    },

    /** Copy a line; "Copied" stays until the system changes. Failing, the line is selected and the toast says so. */
    async copyResearchInstallLine(code: HTMLElement | null | undefined, main: boolean): Promise<void> {
        if (!code) return;
        const text = code.dataset.line ?? code.textContent ?? '';
        let ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch { /* no clipboard: select it for the user */ }
        if (!ok) {
            const range = document.createRange();
            range.selectNodeContents(code);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            this.showToast(strings.install.copyManual, 6000);
            return;
        }
        if (main && current) {
            current.copied = true;
            this.renderResearchInstall();
        } else {
            const btn = code.parentElement?.querySelector<HTMLButtonElement>('.install-copy');
            if (btn) { btn.textContent = strings.install.copied; btn.classList.add('copied'); }
        }
    },

    /**
     * "I already have it, start": the research takes the tree over by the
     * same token (strom-research://new). From a browser that cannot reach it,
     * the tree goes as a file first — an installed research takes it as well.
     */
    /** "I already have it, start ↗", or — the tree downloaded for a move — that it is, and the start. */
    researchHaveItLabel(): string {
        const s = strings.install;
        if (!needsTransfer(currentAppBrowser())) return s.haveIt;
        const record = readInstallRecord();
        const active = DataManager.getCurrentTreeId() ?? TreeManager.getActiveTreeId();
        return record?.file && record.treeId === active && installPhase(record) !== 'expired' ? s.haveItDownloaded : s.haveIt;
    },

    async researchInstallHaveIt(): Promise<void> {
        // This tree's record (never another tree's file). From a browser that moves the tree: the download
        // first, on its own — WebKit drops a download the page leaves at once for strom-research:// — then
        // the button says it is downloaded and a second click opens the research.
        if (needsTransfer(currentAppBrowser()) && !this.ensureInstallRecord().file) {
            await this.downloadResearchTransfer();
            this.renderResearchInstall();
            return;
        }
        const record = this.ensureInstallRecord();
        const url = researchNewUrl(record.token, currentAppBrowser(), record.file);
        if (url) this.handOverResearchLink(url);
        this.goResearchInstallStep('wait');
    },

    /** Phone / tablet: share the app's address with ?research=install, else copy it. */
    async sendResearchInstallLink(): Promise<void> {
        const url = new URL(window.location.href);
        url.search = '';
        url.hash = '';
        url.searchParams.set('research', 'install');
        const href = url.toString();
        const nav = navigator as Navigator & { share?: (d: { url: string; title?: string }) => Promise<void> };
        if (typeof nav.share === 'function') {
            try { await nav.share({ url: href, title: strings.install.title }); return; } catch (err) {
                if ((err as { name?: string })?.name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(href);
            this.showToast(strings.install.linkCopied, 5000);
        } catch {
            this.showToast(href, 10000);
        }
    },

    /** Re-draw the waiting step when it crosses 15 minutes or the token expires (only while it is open). */
    syncResearchInstallTimer(): void {
        const waiting = current?.step === 'wait' && !!document.getElementById(INSTALL_DIALOG_ID);
        if (!waiting) {
            if (phaseTimer) clearInterval(phaseTimer);
            phaseTimer = null;
            return;
        }
        if (phaseTimer) return;
        let last = installPhase(readInstallRecord());
        phaseTimer = setInterval(() => {
            const now = installPhase(readInstallRecord());
            if (now !== last && current?.step === 'wait') {
                last = now;
                this.renderResearchInstall();
                if (now === 'expired') this.refreshResearchPromo();
            }
        }, 30_000);
    },

    closeResearchInstall(): void {
        current = null;
        if (phaseTimer) clearInterval(phaseTimer);
        phaseTimer = null;
        document.getElementById(INSTALL_DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== INSTALL_DIALOG_ID);
        // The menu item follows the installation ("Finish installing…" while its token holds).
        this.refreshResearchPromo();
    },

    /** Is the install dialog on screen? */
    researchInstallOpen(): boolean {
        return current !== null && !!document.getElementById(INSTALL_DIALOG_ID);
    },

    /** Another tab finished the installation (the research opened it): this one's dialog closes, with a word. */
    listenResearchInstallDone(): void {
        if (!storageWatched && typeof window !== 'undefined') {
            storageWatched = true;
            // A second way to hear it: the record removed by the tab that finished.
            window.addEventListener('storage', (e) => {
                if (e.key !== INSTALL_KEY || e.newValue !== null) return;
                if (this.researchInstallOpen() && current?.step === 'wait') {
                    this.closeResearchInstall();
                    this.showToast(strings.install.otherTab, 6000);
                } else {
                    this.refreshResearchPromo();
                }
            });
        }
        if (channel || typeof BroadcastChannel !== 'function') return;
        try {
            channel = new BroadcastChannel(INSTALL_CHANNEL);
            channel.onmessage = (e: MessageEvent) => {
                const done = (e.data as { done?: unknown } | null)?.done;
                if (typeof done !== 'string') return;
                if (this.researchInstallOpen()) {
                    this.closeResearchInstall();
                    this.showToast(strings.install.otherTab, 6000);
                } else {
                    this.refreshResearchPromo();
                }
            };
        } catch { /* no channel: the other tab's dialog just stays */ }
    },

    /** The installation is over (the tree went to the research): forget it here and tell the other tabs. */
    finishResearchInstall(token: string): void {
        clearInstallRecord();
        if (typeof BroadcastChannel === 'function') {
            try {
                const ch = new BroadcastChannel(INSTALL_CHANNEL);
                ch.postMessage({ done: token });
                ch.close();
            } catch { /* nothing to tell */ }
        }
        if (this.researchInstallOpen()) this.closeResearchInstall();
    },

    /** ?research=install (the link sent from a phone): on a computer, straight to the Install step. */
    openResearchInstallFromLink(): void {
        if (!isPromoAvailable(this.researchPromoContext())) return;
        this.showResearchInstall(onComputer() ? 'install' : undefined);
    },
});
