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
    decideReleaseNotes,
    releaseNotesFor,
} from '../release-notes.js';
import { uiModule } from './module.js';

declare const __RELEASE_NOTES__: EmbeddedReleaseNotes | undefined;

/** The notes of this build (none in a dev build without the define). */
const EMBEDDED_NOTES: EmbeddedReleaseNotes | null =
    typeof __RELEASE_NOTES__ !== 'undefined' ? __RELEASE_NOTES__ : null;

export const RELEASE_NOTES_DIALOG_ID = 'release-notes-modal';
/** The version whose "What's new" was last seen (or settled silently) in this browser. */
export const RELEASE_NOTES_SEEN_KEY = 'strom-whats-new-seen';
/** After the first render: the one-time 3.0 card and other start-up notices go first. */
const FIRST_CHECK_MS = 1200;
/** While something is in the way, look again this often. */
const RETRY_MS = 1000;

/** Trees with persons when the app started (a new user has none); fixed at the first check. */
let hadDataAtStart: boolean | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Inline runs as DOM nodes: text only, never parsed as HTML. */
function appendInline(parent: HTMLElement, block: NotesBlock): void {
    for (const run of block.inline) {
        if (run.bold) parent.appendChild(el('strong', undefined, run.text));
        else if (run.italic) parent.appendChild(el('em', undefined, run.text));
        else parent.appendChild(document.createTextNode(run.text));
    }
}

export const releaseNotesMethods = uiModule({
    /**
     * Right after the stored trees are read, before editing may begin: did
     * this browser hold any persons? (A new user has one empty tree; a person
     * added during the start must not make them an existing user.)
     */
    captureReleaseNotesStart(): void {
        try {
            if (hadDataAtStart === null) hadDataAtStart = TreeManager.getTrees().some(t => (t.personCount ?? 0) > 0);
        } catch {
            hadDataAtStart = false;
        }
    },

    /** After the first render: settle a new user at once, otherwise look once the start has calmed down. */
    initReleaseNotes(): void {
        try {
            this.captureReleaseNotesStart();
            const decision = this.releaseNotesDecision();
            if (decision === 'mark-seen') { writeSeenVersion(); return; }
            if (decision === 'skip') return;
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

    /** Show the dialog when the decision says so; while the app is busy, look again later. */
    maybeShowReleaseNotes(): void {
        try {
            if (document.getElementById(RELEASE_NOTES_DIALOG_ID)) return;
            const decision = this.releaseNotesDecision();
            if (decision === 'mark-seen') writeSeenVersion();
            else if (decision === 'wait') this.scheduleReleaseNotes(RETRY_MS);
            else if (decision === 'show') this.showReleaseNotesDialog();
        } catch (err) {
            console.warn('What\'s new unavailable', err);
        }
    },

    /** Build and open the dialog with the notes of this version in the UI language. */
    showReleaseNotesDialog(): void {
        const blocks = releaseNotesFor(EMBEDDED_NOTES, getCurrentLanguage());
        if (!blocks) return;
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
        titleWrap.append(title, el('span', 'release-notes-version', s.version(APP_VERSION)));
        const closeX = el('button', 'close-btn');
        closeX.type = 'button';
        closeX.setAttribute('aria-label', strings.buttons.close);
        closeX.textContent = '×';
        header.append(titleWrap, closeX);

        const content = el('div', 'modal-content release-notes-content');
        let list: HTMLUListElement | null = null;
        for (const block of blocks) {
            if (block.kind === 'item') {
                if (!list) { list = el('ul', 'release-notes-list'); content.appendChild(list); }
                const li = el('li');
                appendInline(li, block);
                list.appendChild(li);
            } else {
                list = null;
                const p = el('p', 'release-notes-para');
                appendInline(p, block);
                content.appendChild(p);
            }
        }
        const link = aboutChangelogLink(getCurrentLanguage(), APP_VERSION, changelogIsBeta(location.hostname, APP_VERSION));
        const full = el('a', 'release-notes-full', s.fullChangelog);
        full.href = link.href;
        full.target = link.target;
        full.rel = link.rel;
        const fullRow = el('p', 'release-notes-full-row');
        fullRow.appendChild(full);
        content.appendChild(fullRow);

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

    /** Closing in any way records this version as seen; the checked box turns the dialog off for later updates. */
    closeReleaseNotesDialog(): void {
        const overlay = document.getElementById(RELEASE_NOTES_DIALOG_ID);
        const box = overlay?.querySelector<HTMLInputElement>('#release-notes-dont-show');
        if (box?.checked) SettingsManager.setWhatsNewAfterUpdate(false);
        writeSeenVersion();
        overlay?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== RELEASE_NOTES_DIALOG_ID);
    },

    /** Settings → Notifications: "What's new after an update". */
    toggleWhatsNewAfterUpdate(enabled: boolean): void {
        SettingsManager.setWhatsNewAfterUpdate(enabled);
    },
});
