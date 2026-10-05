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
import { newAdoptToken, researchNewUrl, isSafariBrowser } from '../research-link.js';
import { isPromoAvailable } from '../research-promo.js';
import {
    InstallOs, InstallRecord, INSTALL_OSES, INSTALL_RELEASE_URL,
    detectInstallOs, installLine, npmLines, installAppUrl, installPhase, newInstallRecord, INSTALL_KEY,
    readInstallRecord, writeInstallRecord, clearInstallRecord,
} from '../research-install.js';
import { onComputer } from './research-ui.js';
import { uiModule } from './module.js';

/** The dialog keeps the info dialog's id: one research dialog at a time, closed by the shared Escape handling. */
export const INSTALL_DIALOG_ID = 'research-info-modal';
/** The channel the tab the research opens tells the others on. */
const INSTALL_CHANNEL = 'strom-install';

type InstallStep = 'what' | 'install' | 'wait';

/** The step on screen and the Install step's own state while the dialog is open. */
let current: { step: InstallStep; os: InstallOs; copied: boolean; otherOpen: boolean; resumed: boolean } | null = null;
let phaseTimer: ReturnType<typeof setInterval> | null = null;
let channel: BroadcastChannel | null = null;
let storageWatched = false;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isSafari(): boolean {
    return typeof navigator !== 'undefined' && isSafariBrowser(navigator.userAgent || '');
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
            step: first, os: record?.os ?? detectedOs(), copied: false, otherOpen: false, resumed,
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
        this.syncResearchInstallTimer();
    },

    /** 2a: what it is — the archive and the agent side by side (nothing is chosen here). */
    researchInstallWhatHtml(): string {
        const s = strings.install;
        const tree = TreeManager.getActiveTreeMetadata();
        const people = Object.values(DataManager.getData().persons).some(p => !p.isPlaceholder);
        const intro = tree && people ? s.intro(tree.name) : s.introEmpty;
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
        const line = installLine(os, record.token, appUrl, treeName);
        const [npm1, npm2] = npmLines(os, record.token, appUrl, treeName);
        return `
            <div class="modal-content install-body">
                <div class="install-os-row">
                    <div class="install-os" role="radiogroup" aria-label="${esc(s.detected(names[os]))}">
                        ${INSTALL_OSES.map(o => `<button type="button" role="radio" aria-checked="${o === os}" class="install-os-btn${o === os ? ' active' : ''}" data-os="${o}">${esc(names[o])}</button>`).join('')}
                    </div>
                    <span class="install-detected">${esc(s.detected(names[detectedOs()]))}</span>
                </div>
                ${isSafari() ? `<p class="install-warn">${esc(s.safari)}</p>` : ''}
                <div class="install-what"><strong>${esc(s.whatTitle)}</strong> ${esc(what)}</div>
                ${os === 'mac' ? `<p class="install-warn install-apple">${esc(s.appleNote)}</p>` : ''}
                <ol class="install-howto">${steps.map((t, i) => `<li><span class="install-num" aria-hidden="true">${i + 1}</span><span>${esc(t)}</span></li>`).join('')}</ol>
                <div class="install-line-row">
                    <code class="install-line" tabindex="0" data-line="${esc(line)}">${lineHtml(line, record.token)}</code>
                    <button type="button" class="install-copy${st.copied ? ' copied' : ''}" data-act="copy">${esc(st.copied ? s.copied : s.copy)}</button>
                </div>
                <p class="install-after">${esc(st.copied ? s.afterCopied : s.after)}</p>
                <details class="install-other"${st.otherOpen ? ' open' : ''}>
                    <summary>${esc(s.other)}</summary>
                    <p>${esc(s.npmIntro)}</p>
                    <div class="install-line-row">
                        <code class="install-line install-npm" tabindex="0" data-line="${esc(`${npm1}\n${npm2}`)}">${esc(npm1)}<br>${lineHtml(npm2, record.token)}</code>
                        <button type="button" class="install-copy" data-act="copy-npm">${esc(s.copy)}</button>
                    </div>
                    <a class="install-release" href="${esc(INSTALL_RELEASE_URL)}" target="_blank" rel="noopener">${esc(INSTALL_RELEASE_URL.replace(/^https:\/\//, ''))} ↗</a>
                </details>
            </div>
            <div class="buttons">
                <button type="button" class="link-button" data-act="have">${esc(s.haveIt)}</button>
                <button type="button" class="link-button" data-act="back">${esc(s.back)}</button>
                <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
                <button type="button" class="primary" data-act="pasted">${esc(s.pasted)}</button>
            </div>`;
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
                    <p class="install-wait-links"><button type="button" class="link-button" data-act="have">${esc(s.haveIt)}</button></p>
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
                <p>${esc(long ? s.waitLongText : s.waitText)}</p>
                ${isChromium() ? `<p class="install-note">${esc(s.waitLna)}</p>` : ''}
                <p class="install-wait-links">
                    <button type="button" class="link-button" data-act="again">${esc(s.showAgain)}</button>
                    <button type="button" class="link-button" data-act="have">${esc(s.haveIt)}</button>
                </p>
            </div>
            <div class="buttons">
                <span class="install-foot-note">${esc(long && record ? s.startedAt(timeOf(record.createdAt)) : s.waitClose)}</span>
                <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
            </div>`;
    },

    /** 2b: on a phone or tablet — what it is, briefly, and a link to send to a computer. Nothing is stored. */
    researchInstallMobileHtml(): string {
        const s = strings.install;
        const tree = TreeManager.getActiveTreeMetadata();
        const people = Object.values(DataManager.getData().persons).some(p => !p.isPlaceholder);
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
                <div class="install-mobile-box">
                    <p>${esc(s.mobileOnly)}</p>
                    <button type="button" class="secondary install-send-link" data-act="send-link">${esc(s.sendLink)}</button>
                </div>
            </div>
            <div class="buttons">
                <button type="button" class="link-button install-web" data-act="web">${esc(s.web)}</button>
                <button type="button" class="secondary" data-dismiss>${esc(strings.buttons.close)}</button>
            </div>`;
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
            else if (act === 'have') this.researchInstallHaveIt();
            else if (act === 'copy' || act === 'copy-npm') {
                const code = el.parentElement?.querySelector<HTMLElement>('.install-line');
                void this.copyResearchInstallLine(code, act === 'copy');
            } else if (act === 'send-link') void this.sendResearchInstallLink();
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

    /** "I already have it, start": the research takes the tree over by the same token (strom-research://new). */
    researchInstallHaveIt(): void {
        const record = this.ensureInstallRecord();
        const url = researchNewUrl(record.token);
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
