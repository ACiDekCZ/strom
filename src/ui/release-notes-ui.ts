/**
 * "What's new" after an update — the DOM half: at the first start of a new
 * version, once the app is free, one dialog with the points of this version
 * from the changelog (embedded at build time, see src/release-notes.ts), a
 * link to the whole changelog on GitHub and "Don't show next time".
 *
 * The version last seen lives in this browser only (localStorage, outside
 * tree data and exports); the setting to show the dialog at all lives in the
 * browser settings (Settings → Notifications).
 *
 * Strom Research: when its bridge on this computer says a newer version than
 * the one seen here (one per computer) and that it answers `/whats-new`, its
 * points come as a section of their own under the app's, or in a dialog of
 * their own (src/research-whats-new.ts). The About dialog gets a line with the
 * research's version and its changelog link.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { APP_VERSION } from '../types.js';
import { aboutChangelogLink, changelogIsBeta } from '../about-links.js';
import {
    EmbeddedReleaseNotes,
    NotesBlock,
    ReleaseNotesDecision,
    changelogLanguageOf,
    decideReleaseNotes,
    releaseNotesFor,
} from '../release-notes.js';
import {
    ResearchWhatsNew,
    WHATS_NEW_FEATURE,
    decideResearchWhatsNew,
    researchChangelogUrl,
    researchNotesBlocks,
    sanitizeResearchWhatsNew,
} from '../research-whats-new.js';
import { parseLiveBridge, LiveStatus } from '../research-link.js';
import { storedResearchBridge } from '../research-device.js';
import { onComputer, fetchWithTimeout } from './research-ui.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

declare const __RELEASE_NOTES__: EmbeddedReleaseNotes | undefined;

/** The notes of this build (none in a dev build without the define). */
const EMBEDDED_NOTES: EmbeddedReleaseNotes | null =
    typeof __RELEASE_NOTES__ !== 'undefined' ? __RELEASE_NOTES__ : null;

export const RELEASE_NOTES_DIALOG_ID = 'release-notes-modal';
/** The version whose "What's new" was last seen (or settled silently) in this browser. */
export const RELEASE_NOTES_SEEN_KEY = 'strom-whats-new-seen';
/** The research's version whose "What's new" was last seen (or settled silently) on this computer. */
export const RESEARCH_WHATS_NEW_SEEN_KEY = 'strom-research-whats-new-seen';
/** The research's last known version and its changelog link, when its bridge gave one: `{version, url?}`. */
export const RESEARCH_WHATS_NEW_KEY = 'strom-research-whats-new';
/** After the first render: the one-time 3.0 card and other start-up notices go first. */
const FIRST_CHECK_MS = 1200;
/** While something is in the way, look again this often. */
const RETRY_MS = 1000;
/** How long the bridge has to answer `/whats-new`. */
const RESEARCH_ASK_MS = 3000;
/** How long the app's dialog waits for the research's answer, so one dialog says both. */
const RESEARCH_WAIT_MS = 1500;
const RESEARCH_WAIT_STEP_MS = 100;

/** Trees with persons when the app started (a new user has none); fixed at the first check. */
let hadDataAtStart: boolean | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** When the first look is due (0: not started yet). */
let firstCheckDue = 0;

/** The research's section ready to show (asked and answered, not shown yet). */
interface ResearchSection {
    version: string;
    url: string | null;
    blocks: NotesBlock[];
}
let researchSection: ResearchSection | null = null;
/** The research's `/whats-new` asked right now. */
let researchAsk: Promise<void> | null = null;
/** Versions asked in this page: each at most once. */
const researchAsked = new Set<string>();
/** Since when the app's dialog waits for the research's answer (0: not waiting). */
let researchWaitSince = 0;
/** The app's dialog was shown and closed in this page: the research's section waits for the next start. */
let appDialogClosed = false;
/** What the research's bridge last said in this page. */
let pageResearch: { researchId: string; version: string; feature: boolean } | null = null;
/** Versions whose link the About dialog asked for in this page. */
const aboutAsked = new Set<string>();
let bridgeListening = false;

function readSeenVersion(): string | null {
    try {
        return localStorage.getItem(RELEASE_NOTES_SEEN_KEY);
    } catch {
        return null;
    }
}

function writeSeenVersion(): void {
    try {
        localStorage.setItem(RELEASE_NOTES_SEEN_KEY, APP_VERSION);
    } catch { /* private mode: asked again next start */ }
}

function readResearchSeen(): string | null {
    try {
        return localStorage.getItem(RESEARCH_WHATS_NEW_SEEN_KEY);
    } catch {
        return null;
    }
}

function writeResearchSeen(version: string): void {
    try {
        localStorage.setItem(RESEARCH_WHATS_NEW_SEEN_KEY, version);
    } catch { /* private mode: settled again next time */ }
}

/** The research's last known version and its link (only one the bridge gave for that version). */
function readKnownResearch(): { version: string; url: string | null } | null {
    try {
        const raw = localStorage.getItem(RESEARCH_WHATS_NEW_KEY);
        const parsed = raw ? JSON.parse(raw) as { version?: unknown; url?: unknown } : null;
        if (!parsed || typeof parsed.version !== 'string' || !parsed.version) return null;
        return { version: parsed.version, url: researchChangelogUrl(parsed.url) };
    } catch {
        return null;
    }
}

/** Record the research's version; a link is kept only with the version it belongs to. */
function writeKnownResearch(version: string, url?: string | null): void {
    try {
        const known = readKnownResearch();
        const keep = url ?? (known?.version === version ? known.url : null);
        localStorage.setItem(RESEARCH_WHATS_NEW_KEY, JSON.stringify({ version, ...(keep ? { url: keep } : {}) }));
    } catch { /* no storage: the About line goes without it */ }
}

/** The research's changelog link in a new tab. */
function researchLink(className: string, label: string, href: string): HTMLAnchorElement {
    const a = el('a', className, label);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Bullet points and paragraphs as DOM. */
function appendBlocks(parent: HTMLElement, blocks: NotesBlock[]): void {
    let list: HTMLUListElement | null = null;
    for (const block of blocks) {
        if (block.kind === 'item') {
            if (!list) { list = el('ul', 'release-notes-list'); parent.appendChild(list); }
            const li = el('li');
            appendInline(li, block);
            list.appendChild(li);
        } else {
            list = null;
            const p = el('p', 'release-notes-para');
            appendInline(p, block);
            parent.appendChild(p);
        }
    }
}

/** The research's section: its heading, its points and the link to all its changes. */
function researchSectionNode(section: ResearchSection): HTMLElement {
    const s = strings.releaseNotes;
    const node = el('section', 'release-notes-research');
    node.appendChild(el('h3', 'release-notes-research-title', s.researchVersion(section.version)));
    appendBlocks(node, section.blocks);
    if (section.url) {
        const row = el('p', 'release-notes-full-row');
        row.appendChild(researchLink('release-notes-full release-notes-research-full', s.researchFullChangelog, section.url));
        node.appendChild(row);
    }
    return node;
}

/** Inline runs as DOM nodes: text only, never parsed as HTML. */
function appendInline(parent: HTMLElement, block: NotesBlock): void {
    for (const run of block.inline) {
        if (run.bold) parent.appendChild(el('strong', undefined, run.text));
        else if (run.italic) parent.appendChild(el('em', undefined, run.text));
        else if (run.code) parent.appendChild(el('code', undefined, run.text));
        else parent.appendChild(document.createTextNode(run.text));
    }
}

export const releaseNotesMethods = uiModule({
    /**
     * Right after the stored trees are read, before editing may begin: did
     * this browser hold any persons? (A new user has one empty tree; a person
     * added during the start must not make them an existing user.) From now
     * on every status of a research's bridge is looked at for its version.
     */
    captureReleaseNotesStart(): void {
        try {
            if (hadDataAtStart === null) hadDataAtStart = TreeManager.getTrees().some(t => (t.personCount ?? 0) > 0);
        } catch {
            hadDataAtStart = false;
        }
        if (!bridgeListening) {
            bridgeListening = true;
            onBridgeStatus((researchId, status) => this.noteResearchWhatsNewStatus(researchId, status));
        }
    },

    /** After the first render: settle a new user at once, otherwise look once the start has calmed down. */
    initReleaseNotes(): void {
        try {
            this.captureReleaseNotesStart();
            firstCheckDue = Date.now() + FIRST_CHECK_MS;
            const decision = this.releaseNotesDecision();
            if (decision === 'mark-seen') writeSeenVersion();
            // The research may still bring a section of its own: it looks then (offerResearchWhatsNew).
            if ((decision === 'mark-seen' || decision === 'skip') && !researchSection) return;
            this.scheduleReleaseNotes(FIRST_CHECK_MS);
        } catch (err) {
            console.warn('What\'s new unavailable', err);
        }
    },

    releaseNotesDecision(): ReleaseNotesDecision {
        const embeddedData = !!(window as Window & { STROM_EMBEDDED_DATA?: unknown }).STROM_EMBEDDED_DATA;
        return decideReleaseNotes({
            seenVersion: readSeenVersion(),
            currentVersion: APP_VERSION,
            hasData: hadDataAtStart === true,
            enabled: SettingsManager.isWhatsNewAfterUpdateEnabled(),
            busy: this.isReleaseNotesBlocked(),
            embedded: embeddedData || DataManager.isViewMode(),
            hasNotes: releaseNotesFor(EMBEDDED_NOTES, getCurrentLanguage()) !== null,
        });
    },

    /**
     * Something is in the way of the dialog: another dialog, sheet or menu,
     * the tour or its offer, the one-time 3.0 card, the "new version
     * available" toast, a locked start, or an open from Strom Research.
     */
    isReleaseNotesBlocked(): boolean {
        return this.isWhatsNewBlocked()
            || this.isWhatsNewCardOpen()
            || this.tourActive
            || !!document.querySelector('.pwa-update, #tour-overlay.active, .bottom-sheet-overlay.active, .actions-menu-dropdown.active')
            || document.body.classList.contains('data-locked')
            || DataManager.isLocked()
            || this.researchPromoContext().cliOpen;
    },

    scheduleReleaseNotes(delay: number): void {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            retryTimer = null;
            this.maybeShowReleaseNotes();
        }, delay);
    },

    /**
     * Show the dialog when the app's decision says so or the research brought
     * a section; while the app is busy, look again later. While the research
     * is still being asked, the app's dialog waits for it a little.
     */
    maybeShowReleaseNotes(): void {
        try {
            if (document.getElementById(RELEASE_NOTES_DIALOG_ID)) return;
            const decision = this.releaseNotesDecision();
            if (decision === 'mark-seen') writeSeenVersion();
            const app = decision === 'show' || decision === 'wait';
            if (researchSection && !SettingsManager.isWhatsNewAfterUpdateEnabled()) {
                writeResearchSeen(researchSection.version);
                researchSection = null;
            }
            if (!app && !researchSection) return;
            if (decision === 'wait' || this.isReleaseNotesBlocked()) {
                this.scheduleReleaseNotes(RETRY_MS);
                return;
            }
            if (app && !researchSection && researchAsk) {
                if (!researchWaitSince) researchWaitSince = Date.now();
                if (Date.now() - researchWaitSince < RESEARCH_WAIT_MS) {
                    this.scheduleReleaseNotes(RESEARCH_WAIT_STEP_MS);
                    return;
                }
            }
            this.showReleaseNotesDialog(app);
        } catch (err) {
            console.warn('What\'s new unavailable', err);
        }
    },

    /**
     * Build and open the dialog: the notes of this version in the UI language
     * (`withApp`), then the research's section when it brought one; only the
     * research's when the app has nothing new.
     */
    showReleaseNotesDialog(withApp = true): void {
        const blocks = withApp ? releaseNotesFor(EMBEDDED_NOTES, getCurrentLanguage()) : null;
        const research = researchSection;
        if (!blocks && !research) return;
        document.getElementById(RELEASE_NOTES_DIALOG_ID)?.remove();
        const s = strings.releaseNotes;

        const overlay = el('div', 'modal-overlay release-notes-overlay');
        overlay.id = RELEASE_NOTES_DIALOG_ID;
        const modal = el('div', 'modal modal--md release-notes-dialog');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'release-notes-title');
        modal.dataset.dialogKind = 'info';

        const header = el('div', 'modal-header');
        const titleWrap = el('div', 'release-notes-heading');
        const title = el('h2', undefined, s.title);
        title.id = 'release-notes-title';
        titleWrap.appendChild(title);
        if (blocks) titleWrap.appendChild(el('span', 'release-notes-version', s.version(APP_VERSION)));
        const closeX = el('button', 'close-btn');
        closeX.type = 'button';
        closeX.setAttribute('aria-label', strings.buttons.close);
        closeX.textContent = '×';
        header.append(titleWrap, closeX);

        const content = el('div', 'modal-content release-notes-content');
        if (blocks) {
            overlay.dataset.app = '1';
            appendBlocks(content, blocks);
            const link = aboutChangelogLink(getCurrentLanguage(), APP_VERSION, changelogIsBeta(location.hostname, APP_VERSION));
            const full = el('a', 'release-notes-full', s.fullChangelog);
            full.href = link.href;
            full.target = link.target;
            full.rel = link.rel;
            const fullRow = el('p', 'release-notes-full-row');
            fullRow.appendChild(full);
            content.appendChild(fullRow);
        }
        if (research) {
            overlay.dataset.researchVersion = research.version;
            content.appendChild(researchSectionNode(research));
            researchSection = null;
        }

        const buttons = el('div', 'buttons release-notes-buttons');
        const check = el('label', 'release-notes-dont-show');
        const box = el('input');
        box.type = 'checkbox';
        box.id = 'release-notes-dont-show';
        check.append(box, el('span', undefined, s.dontShowAgain));
        const closeBtn = el('button', 'primary release-notes-close', strings.buttons.close);
        closeBtn.type = 'button';
        // Phones stack the footer: the button goes under the checkbox.
        closeBtn.dataset.dismiss = '';
        buttons.append(check, closeBtn);

        modal.append(header, content, buttons);
        overlay.appendChild(modal);

        const close = (): void => this.closeReleaseNotesDialog();
        closeX.addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        document.body.appendChild(overlay);
        overlay.classList.add('active');
        // The close button takes focus (not the checkbox, which dialog-focus.ts would pick as the first field).
        closeBtn.focus({ preventScroll: true });
        // Escape through the shared dialog stack (see misc.ts keyboard handler).
        this.pushDialog(RELEASE_NOTES_DIALOG_ID);
    },

    /**
     * Closing in any way records as seen what the dialog showed (the app's
     * version, the research's); the checked box turns the dialog off for
     * later updates of both.
     */
    closeReleaseNotesDialog(): void {
        const overlay = document.getElementById(RELEASE_NOTES_DIALOG_ID);
        const box = overlay?.querySelector<HTMLInputElement>('#release-notes-dont-show');
        if (box?.checked) SettingsManager.setWhatsNewAfterUpdate(false);
        if (!overlay || overlay.dataset.app === '1') {
            writeSeenVersion();
            if (overlay) appDialogClosed = true;
        }
        const research = overlay?.dataset.researchVersion;
        if (research) writeResearchSeen(research);
        overlay?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== RELEASE_NOTES_DIALOG_ID);
    },

    /** Settings → Notifications: "What's new after an update". */
    toggleWhatsNewAfterUpdate(enabled: boolean): void {
        SettingsManager.setWhatsNewAfterUpdate(enabled);
    },

    // ==================== STROM RESEARCH ====================

    /**
     * A research's bridge said its status: keep its version, and when it is
     * newer than the one seen on this computer (and the bridge answers
     * `/whats-new`), ask for its points — once per version and page. The
     * first link here, an older bridge and the setting off only record the
     * version. Nothing on a phone or tablet.
     */
    noteResearchWhatsNewStatus(researchId: string, status: LiveStatus): void {
        if (!onComputer() || !status.version) return;
        const feature = !!status.features?.includes(WHATS_NEW_FEATURE);
        pageResearch = { researchId, version: status.version, feature };
        if (readKnownResearch()?.version !== status.version) writeKnownResearch(status.version);
        const decision = decideResearchWhatsNew({
            seenVersion: readResearchSeen(),
            bridgeVersion: status.version,
            hasFeature: feature,
            enabled: SettingsManager.isWhatsNewAfterUpdateEnabled(),
        });
        if (decision === 'remember') { writeResearchSeen(status.version); return; }
        if (decision !== 'ask' || researchAsk || researchAsked.has(status.version)) return;
        researchAsked.add(status.version);
        researchAsk = (async () => {
            const answer = await this.askResearchWhatsNew(researchId);
            // No answer, an error, nonsense: as if the research said nothing (asked again next time).
            if (!answer) return;
            if (answer.points.length === 0) { writeResearchSeen(answer.version); return; }
            researchSection = { version: answer.version, url: answer.url, blocks: researchNotesBlocks(answer.points) };
        })().catch(() => undefined).finally(() => {
            researchAsk = null;
            this.offerResearchWhatsNew();
        });
    },

    /** `GET <bridge>/whats-new?lang=…` (short timeout); its link is kept for the About dialog. Null: no usable answer. */
    async askResearchWhatsNew(researchId: string): Promise<ResearchWhatsNew | null> {
        const bridge = parseLiveBridge(storedResearchBridge(researchId)?.base);
        if (!bridge) return null;
        try {
            const lang = changelogLanguageOf(getCurrentLanguage());
            const res = await fetchWithTimeout(`${bridge.base}/whats-new?lang=${lang}`, RESEARCH_ASK_MS);
            if (!res.ok) return null;
            const answer = sanitizeResearchWhatsNew(await res.json());
            if (answer?.url) writeKnownResearch(answer.version, answer.url);
            return answer;
        } catch {
            return null;
        }
    },

    /**
     * The research's section is ready: into the app's dialog while it is
     * open; after the app's dialog was closed in this page, next time; else
     * a dialog of its own, by the same rules (once the app is free).
     */
    offerResearchWhatsNew(): void {
        if (!researchSection) return;
        const overlay = document.getElementById(RELEASE_NOTES_DIALOG_ID);
        if (overlay) {
            if (overlay.dataset.researchVersion) return;
            overlay.dataset.researchVersion = researchSection.version;
            overlay.querySelector('.release-notes-content')?.appendChild(researchSectionNode(researchSection));
            researchSection = null;
            return;
        }
        if (appDialogClosed) { researchSection = null; return; }
        // A look is due anyway: it takes the section along.
        if (retryTimer) return;
        this.scheduleReleaseNotes(firstCheckDue ? Math.max(0, firstCheckDue - Date.now()) : FIRST_CHECK_MS);
    },

    /**
     * About: "Research X.Y.Z • What's new ↗" on a computer that knows a
     * research — its version from its bridge in this page, else the last one
     * known. The link is the one its bridge gave for that version; without
     * it, a bridge that answers `/whats-new` in this page is asked.
     */
    fillAboutResearchRow(meta: Element): void {
        meta.querySelector('.about-research')?.remove();
        if (!onComputer()) return;
        const known = readKnownResearch();
        const version = pageResearch?.version || known?.version || '';
        if (!version) return;
        const row = el('div', 'about-meta-row about-research');
        row.appendChild(el('span', 'about-research-version', strings.releaseNotes.researchVersion(version)));
        const addLink = (href: string): void => {
            if (row.querySelector('a')) return;
            const sep = el('span', undefined, '•');
            sep.setAttribute('aria-hidden', 'true');
            row.append(sep, researchLink('about-research-changelog', strings.about.whatsNew, href));
        };
        const url = known?.version === version ? known.url : null;
        if (url) addLink(url);
        meta.appendChild(row);
        const asked = pageResearch;
        if (url || !asked?.feature || asked.version !== version || aboutAsked.has(version)) return;
        aboutAsked.add(version);
        void this.askResearchWhatsNew(asked.researchId).then((answer) => {
            if (answer?.url && answer.version === version && row.isConnected) addLink(answer.url);
        });
    },
});
