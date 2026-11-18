/**
 * "Research for this tree": how the research takes the user's transcripts
 * (lead — it checks them by its own reading; evidence — a transcript is the
 * first reading). Saved at once on the tree's research link and sent with the
 * next send (`_STROM_TRANSCRIPTS`). The switch does not reach back: sources
 * already sent keep their weight until the user ticks "Transcription
 * verified" on each, which the dialog says and links to. An archive takes
 * transcripts as leads: the setting is not offered there (nor sent), and is
 * kept for a switch to research. A research waiting for its agent has nobody
 * to weigh them: the setting is not offered there either.
 */

import { researchActionLabel, type ResearchNoteLink } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { TreeId, ResearchTranscripts, ResearchSendMode, StromData } from '../types.js';
import {
    researchSchemeUrl, TERMINAL_CHOICE_FEATURE, STORIES_HISTORY_FEATURE, HYPOTHESES_DECIDE_FEATURE, researchLinkMark, researchUrlMark,
    booksOn, BOOKS_MIN_TASKS_DEFAULT, BOOKS_SAME_BOOK_DEFAULT, type ResearchHypothesesDecide, type LiveBooksSettings,
} from '../research-link.js';
import { postBridgeStories, postBridgeHypotheses, postBridgeReadTask, postBridgeBooks, type BooksSettingBody } from '../history-bridge.js';
import { booksSettingHtml, booksMinTasksInput, type BooksSettingNote } from './books-setting-view.js';
import { READ_SOURCE_TASK_FEATURE, type ReadTaskSetting } from '../research-read-task.js';
import { readTaskSettingHtml, type ReadTaskSettingNote } from './read-task-setting-view.js';
import { startPend, endPend, dropPend, pendAttrs, pendStatusHtml } from './switch-pend.js';
import { researchAutoState, patchResearchAutoState, researchSendPreviewSkipped, noteResearchSendPreviewSkipped, announcedResearchScheme } from '../research-device.js';
import { sourceReadingHash, unverifiedOlderSources, newTieSendMode } from '../research-sync.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { onComputer, readTree } from './research-ui.js';
import { researchDisplayName, researchSendMode, onBridgeStatus, lastBridgeStatus } from './research-sync-ui.js';
import { SettingsManager } from '../settings.js';
import { formatBytesShort } from './originals-ui.js';
import { isBetaBuildHere } from '../pwa.js';

const SETTINGS_ID = 'research-tree-settings-modal';
const ASK_ID = 'research-mode-ask-modal';
const ASK_GROUP = 'research-ask-send-mode';
/** Trees whose one-time question was closed unanswered: asked again the next time the tree is opened. */
const askLater = new Set<TreeId>();

/**
 * "History in stories" (spec 1028 §7): the research's answer under the row
 * (`link`: its way on), the value asked until the research's status says it
 * (`want`), a write on its way (`busy`). Per research; forgotten with the dialog.
 */
const stories: { rid: string; note?: { text: string; link?: ResearchNoteLink }; want?: boolean; busy?: boolean; sending?: boolean } = { rid: '' };
let storiesListening = false;

/**
 * "Who decides hypotheses" (spec 060): the same parts as `stories` — the
 * research's answer under the row (`link`: its terminal confirms the agent),
 * the value asked until the status says it (`want`), a write on its way (`busy`).
 */
const hypos: {
    rid: string; note?: { text: string; link?: ResearchNoteLink; retry?: () => void; said?: boolean }; want?: ResearchHypothesesDecide; busy?: boolean;
    /** The choice on its way (6.1: shown at once, dashed). */
    sending?: ResearchHypothesesDecide;
} = { rid: '' };

/**
 * "Task from a new reading" (spec 059 §4): the same parts as `hypos` — the note under the choices (the write on
 * its way, the research's confirmation, a refusal), the value asked until the status says it (`want`), the group open.
 */
const readTask: { rid: string; note?: ReadTaskSettingNote; want?: ReadTaskSetting; busy?: boolean; open?: boolean; retry?: ReadTaskSetting; said?: boolean } = { rid: '' };
/** The write states of the two choices (6.1, switch-pend). */
const HYPOS_PEND = 'tree:hypos';
const READ_TASK_PEND = 'tree:readtask';
const STORIES_PEND = 'tree:stories';
/** How long the group stays highlighted when a link opens the dialog at it. */
const READ_TASK_FLASH_MS = 1500;

/**
 * "Books" (spec 105 §4): the same parts as `readTask` — the settings the research confirmed until its status says
 * them (`want`), the last write (`last`, for Try again), the number typed when it is not one (`invalid`), the group
 * gone after the research said the tree is an archive (`gone`), a redraw held while the number field has the focus
 * (`stale`) and the control a write came from (`focusId`).
 */
const books: {
    rid: string; note?: BooksSettingNote; want?: LiveBooksSettings; last?: BooksSettingBody; busy?: boolean; open?: boolean;
    invalid?: string; gone?: boolean; stale?: boolean; focusId?: string;
} = { rid: '' };
const BOOKS_FOCUSABLE = ['research-books-min', 'research-books-same', 'research-books-min-reset', 'research-books-same-reset', 'research-books-retry'];

/** The same four values (what the research keeps; its defaults aside). */
function sameBooksSettings(a: LiveBooksSettings, b: LiveBooksSettings): boolean {
    return a.minTasks === b.minTasks && a.minTasksOwn === b.minTasksOwn && a.sameBook === b.sameBook && a.sameBookOwn === b.sameBookOwn;
}

/** The settings as a write asks them (shown while it is on its way). */
function booksSettingsAsked(s: LiveBooksSettings, body: BooksSettingBody): LiveBooksSettings {
    if ('minTasks' in body) {
        return body.minTasks === 'default'
            ? { ...s, minTasks: s.minTasksDefault ?? BOOKS_MIN_TASKS_DEFAULT, minTasksOwn: false }
            : { ...s, minTasks: body.minTasks, minTasksOwn: true };
    }
    return body.sameBook === 'default'
        ? { ...s, sameBook: s.sameBookDefault ?? BOOKS_SAME_BOOK_DEFAULT, sameBookOwn: false }
        : { ...s, sameBook: body.sameBook, sameBookOwn: true };
}

/** A phone-sized or touch screen: short card texts, and a note instead of the effect box and the status line. */
function compactScreen(): boolean {
    try { return window.matchMedia?.('(max-width: 640px), (pointer: coarse)').matches ?? false; } catch { return false; }
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The three ways changes go to the research, as cards (one checked), and the
 * three sentences under them: the same in "Research for this tree", the
 * hand-over and the one-time question. `recommended`: by hand with an agent,
 * by itself in an archive (newTieSendMode); `was` marks how it went so far
 * (the one-time question).
 */
export function researchSendModeCardsHtml(current: ResearchSendMode, compact = compactScreen(), name = 'research-send-mode', was?: ResearchSendMode,
    recommended: ResearchSendMode = 'manual'): string {
    const t = strings.treeSettings;
    const card = (value: ResearchSendMode, title: string, desc: string, recommended: boolean): string => `
            <label class="research-transcripts-card research-send-card sel-opt" data-sel-form="tile">
                <input type="radio" name="${name}" value="${value}"${value === current ? ' checked' : ''}>
                <span class="research-transcripts-text">
                    <span class="research-transcripts-title">${esc(title)}${recommended ? ` <span class="research-send-recommended">${esc(t.recommended)}</span>` : ''}${value === was ? ` <span class="research-send-was">${esc(t.askWas)}</span>` : ''}</span>
                    <span class="research-transcripts-desc">${esc(desc)}</span>
                </span>
            </label>`;
    return card('manual', t.manual, compact ? t.manualDescShort : t.manualDesc, recommended === 'manual')
        + card('auto', t.auto, compact ? t.autoDescShort : t.autoDesc, recommended === 'auto')
        + card('off', t.off, compact ? t.offDescShort : t.offDesc, false);
}

/**
 * The three sentences under the choice, each on its own line: on a quiet
 * box in the hand-over and the question (with where to change it later),
 * plain in "Research for this tree".
 */
export function researchSendPrinciplesHtml(inDialog = false): string {
    const t = strings.treeSettings;
    return `<div class="research-send-principles${inDialog ? ' is-boxed' : ''}">${t.principles.map(p => `<span>${esc(p)}</span>`).join('')}</div>`
        + (inDialog ? `<p class="research-send-later">${esc(t.changeLater)}</p>` : '');
}

/** "trial" beside a title: a button that opens a short note (the research is in trial operation). */
export function researchTrialTagHtml(menuItem = false): string {
    return `<button type="button" class="research-trial-tag"${menuItem ? ' role="menuitem"' : ''} aria-expanded="false" aria-haspopup="true"`
        + ` onclick="event.stopPropagation(); window.Strom.UI.toggleResearchTrialNote(this)">${esc(strings.treeSettings.trialTag)}</button>`;
}

const TRIAL_NOTE_ID = 'research-trial-note';

function trialNoteOutside(e: Event): void {
    const note = document.getElementById(TRIAL_NOTE_ID);
    const target = e.target as Element | null;
    if (!note || (target && (note.contains(target) || target.closest?.('.research-trial-tag')))) return;
    closeTrialNote();
}

function trialNoteEsc(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !document.getElementById(TRIAL_NOTE_ID)) return;
    // Only the note closes, not the dialog or menu under it.
    e.stopPropagation();
    e.preventDefault();
    closeTrialNote(true);
}

function closeTrialNote(refocus = false): void {
    const note = document.getElementById(TRIAL_NOTE_ID);
    if (!note) return;
    const owner = document.querySelector<HTMLButtonElement>('.research-trial-tag[aria-expanded="true"]');
    note.remove();
    document.querySelectorAll('.research-trial-tag').forEach(b => b.setAttribute('aria-expanded', 'false'));
    document.removeEventListener('pointerdown', trialNoteOutside, true);
    document.removeEventListener('keydown', trialNoteEsc, true);
    window.removeEventListener('resize', closeTrialNoteQuiet);
    if (refocus) owner?.focus();
}

function closeTrialNoteQuiet(): void { closeTrialNote(); }

/** The choice the cards hold now (each dialog has its own group: two open at once never share one). */
export function researchSendModeChecked(root: ParentNode, name: string): ResearchSendMode | null {
    const v = root.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
    return v === 'manual' || v === 'auto' || v === 'off' ? v : null;
}

/** Sources the research has when the tree switches to evidence: sent from here, or numbered by it. */
function sourcesAtSwitch(data: StromData, sent: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, src] of Object.entries(data.sources ?? {})) {
        if (!src?.transcript?.trim()) continue;
        if (sent?.[id] || src.refn) out[id] = sourceReadingHash(src);
    }
    return out;
}

export const researchTreeSettingsMethods = uiModule({
    /** The "trial" tag: its note opens under it (click or Enter), Esc and a click outside close it. */
    toggleResearchTrialNote(tag: HTMLElement): void {
        const open = tag.getAttribute('aria-expanded') === 'true';
        closeTrialNote();
        if (open) return;
        const note = document.createElement('div');
        note.id = TRIAL_NOTE_ID;
        note.className = 'research-trial-note';
        note.setAttribute('role', 'note');
        note.textContent = strings.treeSettings.trialSentence;
        // A click in it is not a click outside the menu or dialog it belongs to.
        note.addEventListener('click', e => e.stopPropagation());
        document.body.appendChild(note);
        const r = tag.getBoundingClientRect();
        const width = note.offsetWidth;
        note.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
        note.style.top = `${r.bottom + 6}px`;
        tag.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', trialNoteOutside, true);
        document.addEventListener('keydown', trialNoteEsc, true);
        window.addEventListener('resize', closeTrialNoteQuiet);
    },

    closeResearchTrialNote(): void {
        closeTrialNote();
    },

    /** ⋯ → Research → "Research for this tree…": the active tree. */
    researchActionTreeSettings(): void {
        this.closeActionsMenu();
        const id = TreeManager.getActiveTreeId();
        if (id) void this.showResearchTreeSettings(id);
    },

    /**
     * Research for this tree has its group "Work outside the directions":
     * a tree tied to a research that is not an archive and does not wait for
     * its agent. The overview offers its link to that group only then.
     */
    offLineSettingsOffered(treeId: string | null): boolean {
        const link = treeId ? TreeManager.getTreeMetadata(treeId as TreeId)?.research : undefined;
        if (!link) return false;
        return this.researchModeOf(link.id, link) !== 'archive' && !this.researchAgentAway(link.id, link);
    },

    /**
     * The dialog for a tree tied to a research that knows how a transcript weighs.
     * `group: 'books'` opens it at "Books", open and highlighted for a moment (Faster by downloading › Settings…).
     */
    async showResearchTreeSettings(treeId: TreeId, opts: { group?: 'books' } = {}): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId);
        const link = meta?.research;
        if (!meta || !link) return;
        document.querySelectorAll(`#${SETTINGS_ID}`).forEach(el => el.remove());
        const t = strings.treeSettings;
        const current: ResearchTranscripts = link.transcripts === 'evidence' ? 'evidence' : 'lead';
        const option = (value: ResearchTranscripts, title: string, desc: string, isDefault: boolean): string => `
            <label class="research-transcripts-card sel-opt" data-sel-form="tile">
                <input type="radio" name="research-transcripts" value="${value}"${value === current ? ' checked' : ''}>
                <span class="research-transcripts-text">
                    <span class="research-transcripts-title">${esc(title)}${isDefault ? ` <span class="research-transcripts-default">${esc(t.default)}</span>` : ''}</span>
                    <span class="research-transcripts-desc">${esc(desc)}</span>
                </span>
            </label>`;
        const setup = onComputer() && this.researchLinkAvailable('setup') ? researchSchemeUrl('setup', { tree: link.id }, announcedResearchScheme()) : null;
        const s = strings.sync;
        const archive = this.researchModeOf(link.id, link) === 'archive';
        const modeLine = this.researchModeSinceLine(treeId);
        // The research runs in its beta channel (its status said so in this page; production says nothing).
        // Said in the beta app only: the public app ignores the field.
        const betaChannel = isBetaBuildHere() && this.researchStatusOf(link.id)?.channel === 'beta';
        // How changes go: a research that tells what it takes (an older one sends the old way only).
        const sendingShown = this.researchSyncCapable(link.id);
        const compact = compactScreen();
        const sendMode = researchSendMode(link);
        // A research waiting for its agent writes as an archive does.
        const agentAway = !archive && this.researchAgentAway(link.id, link);
        const effect = archive || agentAway ? t.effectArchive : this.researchReviewOn(link.id) ? t.effectReview : t.effectAgent;
        // Where the mode is switched, both ways (in the research, in a terminal): one sentence, the research a click away.
        const modeWhere = sendingShown && onComputer() ? (archive ? t.modeWhereArchive : agentAway ? t.modeWhereWaiting : t.modeWhereResearch) : '';
        const openUrl = modeWhere && this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: link.id }, announcedResearchScheme()) : null;
        const modeWhereHtml = modeWhere ? `
                <p class="research-mode-where" id="research-mode-where"><span>${esc(modeWhere)}</span>${openUrl
                    ? ` <button type="button" class="link-button" id="research-mode-where-open">${researchActionLabel(s.openResearch, researchLinkMark('open'))}</button>` : ''}</p>` : '';
        // The terminal the research opens in is the research's own setting: one sentence, its settings a click away
        // (a research that chooses it); otherwise the settings stay a button beside Done.
        const terminalWhere = !!setup && !!this.researchStatusOf(link.id)?.features?.includes(TERMINAL_CHOICE_FEATURE);
        const terminalWhereHtml = terminalWhere ? `
                <p class="research-mode-where research-terminal-where" id="research-terminal-where"><span>${esc(t.terminalWhere)}</span> <button type="button" class="link-button research-settings-in-research" id="research-settings-in-research">${researchActionLabel(strings.research.settingsInResearch, researchLinkMark('setup'))}</button></p>` : '';
        const olderLine = sendingShown ? '' : this.researchOlderLineHtml('settings');
        const sendingHtml = !sendingShown ? (olderLine ? `<p class="research-older-line">${olderLine}</p>` : '') : `
                <fieldset class="research-transcripts research-send-mode">
                    <legend>${esc(t.sending)}</legend>
                    ${researchSendModeCardsHtml(sendMode, compact, undefined, undefined, newTieSendMode(archive || agentAway))}
                </fieldset>
                ${compact ? '' : `<p class="research-send-piled" id="research-send-piled" hidden></p>`}
                ${researchSendPrinciplesHtml()}
                ${compact
                    ? `<p class="research-send-device">${esc(t.deviceNote)}</p>`
                    : `<p class="research-not-retroactive research-send-effect" id="research-send-effect"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(effect)}</span></p>
                       <div class="research-send-status" id="research-send-status" hidden></div>`}
                <p class="research-send-preview-off" id="research-send-preview-off" hidden>${esc(t.previewOff)} · <button type="button" class="link-button" id="research-send-preview-on">${esc(t.previewOn)}</button></p>`;
        // Originals: on a computer (not on a compact screen), for a research that tells what it takes.
        const mediaOn = link.sendMedia !== false;
        const takesMedia = !!this.researchMediaAccepts(link.id);
        const queue = this.originalsQueueLine();
        const mediaLine = SettingsManager.isEncryptionEnabled() ? strings.treeSettings.originalsEncrypted
            : !takesMedia ? strings.media.olderResearch : '';
        const originalsHtml = compact || !sendingShown ? '' : `
                <label class="settings-checkbox research-originals-toggle">
                    <input type="checkbox" id="research-originals-toggle"${mediaOn && takesMedia ? ' checked' : ''}${takesMedia ? '' : ' disabled'}>
                    <span class="settings-text">
                        <span class="settings-name">${esc(strings.treeSettings.originals)}</span>
                        <span class="settings-desc">${esc(strings.treeSettings.originalsDesc)}</span>
                        ${mediaLine ? `<span class="settings-desc">${esc(mediaLine)}</span>` : ''}
                        ${queue ? `<span class="settings-desc research-originals-queue">${esc(strings.mediaQueue.summary(queue.n, formatBytesShort(queue.bytes)))} <button type="button" class="link-button" id="research-originals-show">${esc(strings.mediaQueue.show)}</button></span>` : ''}
                    </span>
                </label>`;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = SETTINGS_ID;
        overlay.innerHTML = `
            <div class="modal modal--md research-tree-settings" role="dialog" data-dialog-kind="settings" aria-modal="true" aria-labelledby="research-tree-settings-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <div class="research-title-row"><h2 id="research-tree-settings-title">${esc(t.title)}${archive || agentAway ? ` <span class="research-sync-tag research-sync-tag--inline">${esc(s.archiveTag)}</span>` : ''}</h2>${researchTrialTagHtml()}</div>
                        <div class="audit-log-subtitle">${esc(t.subtitle(meta.name, researchDisplayName(link.id), meta.personCount))}</div>
                        <div class="research-trial-sentence">${esc(t.trialSentence)}</div>
                        ${modeLine ? `<div class="research-mode-line">${esc(modeLine)}</div>` : ''}
                        ${betaChannel ? `<div class="research-mode-line research-channel-line">${esc(t.channelBeta)}</div>` : ''}
                    </div>
                    <button type="button" class="close-btn" id="research-tree-settings-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                ${archive ? '' : `
                <dl class="research-tree-agent" data-browser-research="${esc(link.id)}">
                    <dt>${esc(strings.install.agentRowLabel)}</dt><dd class="install-ready-agent" data-row="agent"></dd>
                </dl>
                <p class="browser-live" role="status" aria-live="polite"></p>`}
                ${archive || agentAway ? '' : `
                <fieldset class="research-transcripts">
                    <legend>${esc(t.transcripts)}</legend>
                    ${option('lead', t.guide, t.guideDesc, true)}
                    ${option('evidence', t.evidence, t.evidenceDesc, false)}
                </fieldset>
                <p class="research-not-retroactive"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(t.notRetroactive)}</span></p>
                <button type="button" class="link-button research-older-sources" id="research-older-sources" hidden></button>`}
                ${sendingHtml}
                ${originalsHtml}
                <div class="research-images-host" id="research-images-host"></div>
                <div class="research-stories-host" id="research-stories-host"></div>
                ${archive || agentAway ? '' : `<div class="research-hypos-host" id="research-hypos-host"></div>`}
                ${archive || agentAway ? '' : `<div class="research-readtask-host" id="research-readtask-host"></div>`}
                ${archive || agentAway ? '' : `<div class="research-books-host" id="research-books-host"></div>`}
                ${this.offLineSettingsOffered(treeId) ? `<div class="research-offline-host" id="research-offline-host" data-research="${esc(link.id)}"></div>` : ''}
                <button type="button" class="link-button research-read-history" id="research-read-history" hidden></button>
                ${modeWhereHtml}
                ${terminalWhereHtml}
                <div class="buttons research-tree-settings-buttons">
                    ${setup && !terminalWhere ? `<button type="button" class="link-button research-settings-in-research" id="research-settings-in-research">${researchActionLabel(strings.research.settingsInResearch, researchLinkMark('setup'))}</button>` : ''}
                    <button type="button" class="primary" id="research-tree-settings-done" data-dismiss>${esc(t.done)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(SETTINGS_ID);
        // The agent and its browser (spec 048 §11), kept up with each status of the research.
        const agentDl = overlay.querySelector<HTMLElement>('dl.research-tree-agent');
        if (agentDl) {
            const st = this.researchStatusOf(link.id);
            this.renderBrowserRows(agentDl, { name: st?.agentName ?? '', away: agentAway }, st?.browser);
            this.watchBrowserRows();
        }
        // Source images the research left out of its file (filled once the tree's stored images are read).
        const imagesHost = overlay.querySelector<HTMLElement>('#research-images-host');
        if (imagesHost) void this.renderResearchImagesSettings(treeId, imagesHost);
        const close = (): void => this.closeResearchTreeSettings();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#research-tree-settings-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#research-tree-settings-done') as HTMLButtonElement).onclick = close;
        overlay.querySelector<HTMLButtonElement>('#research-mode-where-open')?.addEventListener('click', () => {
            close();
            if (openUrl) this.launchResearchLink(openUrl);
        });
        overlay.querySelector<HTMLButtonElement>('#research-settings-in-research')?.addEventListener('click', () => {
            close();
            if (setup) this.launchResearchLink(setup);
        });
        const olderBtn = overlay.querySelector<HTMLButtonElement>('#research-older-sources');
        const renderOlder = async (): Promise<void> => {
            if (!olderBtn) return;
            const fresh = TreeManager.getTreeMetadata(treeId)?.research;
            const data = DataManager.getCurrentTreeId() === treeId ? DataManager.getData() : await readTree(treeId);
            const n = data ? unverifiedOlderSources(data, fresh).length : 0;
            olderBtn.hidden = fresh?.transcripts !== 'evidence' || n === 0;
            olderBtn.textContent = t.olderSources(n);
        };
        olderBtn?.addEventListener('click', () => {
            close();
            void this.showUnverifiedSources(treeId);
        });
        overlay.querySelectorAll<HTMLInputElement>('input[name="research-transcripts"]').forEach(input => {
            input.addEventListener('change', () => {
                if (!input.checked) return;
                void this.setResearchTranscripts(treeId, input.value === 'evidence' ? 'evidence' : 'lead').then(renderOlder);
            });
        });
        const statusEl = overlay.querySelector<HTMLElement>('#research-send-status');
        const renderStatus = (): void => {
            if (!statusEl) return;
            const line = this.researchTreeStatusLine(treeId);
            statusEl.hidden = !line;
            statusEl.classList.toggle('is-warn', !!line?.warn);
            statusEl.textContent = line?.text ?? '';
            if (line?.action) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'link-button research-send-status-action';
                const load = line.action === 'loadVersion';
                btn.textContent = load ? strings.sync.loadVersion : s.sendAgain;
                btn.onclick = () => {
                    close();
                    void (load ? this.researchLoadIds(treeId) : this.researchSendTree(treeId));
                };
                statusEl.append(' ', btn);
            }
        };
        // What goes with the way chosen: the effect box and the status line not for "only load"; out of
        // "only load", what piled up meanwhile (nothing goes before it is seen); by hand without preview, the way back.
        const piledEl = overlay.querySelector<HTMLElement>('#research-send-piled');
        const renderMode = (): void => {
            const fresh = TreeManager.getTreeMetadata(treeId)?.research;
            const mode = researchSendMode(fresh);
            const off = mode === 'off';
            const effectEl = overlay.querySelector<HTMLElement>('#research-send-effect');
            if (effectEl) effectEl.hidden = off;
            // Nothing is sent: no originals either.
            const originals = overlay.querySelector<HTMLElement>('.research-originals-toggle');
            if (originals) originals.hidden = off;
            if (off && statusEl) statusEl.hidden = true;
            else renderStatus();
            const previewOff = overlay.querySelector<HTMLElement>('#research-send-preview-off');
            if (previewOff) previewOff.hidden = mode !== 'manual' || !researchSendPreviewSkipped(treeId);
            if (piledEl) void renderPiled(!off && !!fresh?.previewDue && DataManager.getCurrentTreeId() === treeId);
        };
        const renderPiled = async (due: boolean): Promise<void> => {
            if (!piledEl) return;
            const n = due ? (await this.researchChangesReady())?.length ?? 0 : 0;
            piledEl.hidden = n === 0;
            piledEl.textContent = n ? `${t.piled(n)} ` : '';
            if (!n) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'link-button';
            btn.textContent = t.whatWillBeSent;
            btn.onclick = () => {
                close();
                this.showResearchChanges('send', { confirm: true });
            };
            piledEl.append(btn);
        };
        overlay.querySelector<HTMLButtonElement>('#research-send-preview-on')?.addEventListener('click', () => {
            noteResearchSendPreviewSkipped(treeId, false);
            renderMode();
        });
        overlay.querySelectorAll<HTMLInputElement>('input[name="research-send-mode"]').forEach(input => {
            input.addEventListener('change', () => {
                if (!input.checked) return;
                this.setResearchSendMode(treeId, input.value === 'manual' || input.value === 'off' ? input.value : 'auto', { told: !!piledEl });
                renderMode();
            });
        });
        renderMode();
        overlay.querySelector<HTMLInputElement>('#research-originals-toggle')?.addEventListener('change', (e) => {
            const on = (e.target as HTMLInputElement).checked;
            TreeManager.patchResearchLink(treeId, { sendMedia: on ? undefined : false });
            this.renderAttachmentsList();
        });
        overlay.querySelector<HTMLButtonElement>('#research-originals-show')?.addEventListener('click', () => {
            close();
            this.showOriginalsQueue();
        });
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        stories.rid = link.id;
        delete stories.note; delete stories.want; delete stories.busy;
        this.renderResearchStoriesRow();
        hypos.rid = link.id;
        delete hypos.note; delete hypos.want; delete hypos.busy;
        this.renderResearchHypothesesRow();
        readTask.rid = link.id;
        delete readTask.note; delete readTask.want; delete readTask.busy; delete readTask.open;
        this.renderResearchReadTaskRow();
        books.rid = link.id;
        delete books.note; delete books.want; delete books.last; delete books.busy; delete books.open;
        delete books.invalid; delete books.gone; delete books.stale; delete books.focusId;
        this.renderResearchBooksRow();
        // Work outside the directions (§9.5): the same condition as the transcripts, with the research's branches.
        this.startOffLineSettings(link.id);
        if (!storiesListening) {
            storiesListening = true;
            onBridgeStatus((rid) => {
                if (rid !== stories.rid) return;
                this.renderResearchStoriesRow();
                this.renderResearchHypothesesRow();
                this.renderResearchReadTaskRow();
                this.renderResearchBooksRow();
                this.renderOffLineSettings();
            });
        }
        const historyBtn = overlay.querySelector<HTMLButtonElement>('#research-read-history');
        if (historyBtn) void this.fillReadHistoryRow(historyBtn, treeId);
        await renderOlder();
        overlay.querySelector<HTMLInputElement>('input[name="research-transcripts"]:checked')?.focus();
        if (opts.group === 'books') {
            this.flashResearchSettingsGroup('research-books-group', '#research-books-min', () => { books.open = true; });
        }
    },

    /**
     * §7: the Stories section's last row "History in stories" — only with
     * `stories.history`; the switch follows `/status.stories.history`; without
     * the bridge inactive with its sentence.
     */
    renderResearchStoriesRow(): void {
        const host = document.querySelector<HTMLElement>(`#${SETTINGS_ID} #research-stories-host`);
        if (!host) return;
        const rid = stories.rid;
        // The research's features as last known (the bridge may be down now: the row stays, at rest).
        const ctx = this.historyManageContext();
        const last = ctx?.researchId === rid ? ctx.lastStatus : this.researchStatusOf(rid);
        const features = ctx?.researchId === rid ? ctx.features : last?.features ?? [];
        if (!features.includes(STORIES_HISTORY_FEATURE)) {
            host.innerHTML = '';
            return;
        }
        const h = strings.history;
        const up = this.researchBridgeUp(rid);
        const said = last?.storiesHistory === true;
        if (stories.want !== undefined && last?.storiesHistory === stories.want) delete stories.want;
        const on = stories.sending ?? stories.want ?? said;
        const note = !up ? { text: h.storiesBridgeDown } : stories.note;
        const focused = document.activeElement?.id === 'research-stories-history';
        // On its way (6.1): the new state at once, dashed and locked (keeping its focus), its words after 120 ms.
        const pend = !!stories.busy;
        host.innerHTML = `
            <fieldset class="research-transcripts research-stories">
                <legend>${esc(h.storiesSection)}</legend>
                <label class="settings-checkbox research-stories-row"${pend ? pendAttrs(STORIES_PEND).replace(' aria-disabled="true"', '') : ''}>
                    <input type="checkbox" id="research-stories-history"${on ? ' checked' : ''}${!up ? ' disabled' : pend ? ' aria-disabled="true"' : ''}>
                    <span class="settings-text">
                        <span class="settings-name">${esc(h.storiesTitle)}</span>
                        <span class="settings-desc">${esc(h.storiesDesc)}</span>${pend ? pendStatusHtml(STORIES_PEND) : ''}
                    </span>
                </label>
                ${note ? `<p class="research-stories-note" id="research-stories-note"><span>${esc(note.text)}</span>${'link' in note && note.link
                    ? ` <button type="button" class="link-button" id="research-stories-note-link">${researchActionLabel(note.link.label, note.link.mark ?? 'none', { size: 12 })}</button>` : ''}</p>` : ''}
            </fieldset>`;
        const input = host.querySelector<HTMLInputElement>('#research-stories-history');
        // Locked while on its way: a click changes nothing (the row drawn again as it stands).
        input?.addEventListener('change', () => {
            if (stories.busy) { this.renderResearchStoriesRow(); return; }
            void this.setResearchStoriesHistory(input.checked);
        });
        host.querySelector<HTMLButtonElement>('#research-stories-note-link')?.addEventListener('click', () => stories.note?.link?.run());
        if (focused) input?.focus({ preventScroll: true });
    },

    /** §7: `POST /stories {history}` at once; a refusal says why (with the way on), the switch stays as the research says. */
    async setResearchStoriesHistory(on: boolean): Promise<void> {
        const rid = stories.rid;
        const ctx = this.historyManageContext();
        const base = ctx?.researchId === rid ? ctx.base : null;
        if (!base || stories.busy) { this.renderResearchStoriesRow(); return; }
        const h = strings.history;
        stories.busy = true;
        stories.sending = on;
        delete stories.note;
        startPend(STORIES_PEND, { redraw: () => this.renderResearchStoriesRow() });
        this.renderResearchStoriesRow();
        const scheme = announcedResearchScheme();
        const r = await postBridgeStories(base, on, ctx!.features, { tree: rid, ...(scheme ? { scheme } : {}) });
        if (stories.rid !== rid) { dropPend(STORIES_PEND); return; }
        await endPend(STORIES_PEND);
        delete stories.busy;
        delete stories.sending;
        if (r.ok) {
            stories.want = on;
        } else if (r.link && (r.code === 'link' || r.code === 'off')) {
            // The research asks in its terminal: the switch follows its status later.
            this.launchResearchLink(r.link, 'terminal');
            stories.note = { text: strings.research.opening };
        } else if (r.code === 'off') {
            // The research not looking for history: the sentence with the way to switch it on.
            stories.note = { text: h.manageOff, ...(ctx?.canLinkOn ? { link: { label: h.enableSearch, run: () => this.historyEnableSearch(), mark: researchLinkMark('experiment', { experimentDo: 'on' }) } } : {}) };
        } else if (r.code === 'busy') {
            stories.note = { text: h.errBusy };
        } else {
            stories.note = { text: r.reason || (r.held ? this.researchWriteHeldText(r.held, false).toast : strings.live.waitingWrite.writeFailed) };
        }
        this.renderResearchStoriesRow();
    },

    /**
     * Spec 060: "Who decides hypotheses" — only with `hypotheses.decide` and a
     * value in `/status` (not in an archive nor a research waiting for its
     * agent: no host there); the choice follows the research's status; without
     * the bridge at rest with its sentence.
     */
    renderResearchHypothesesRow(): void {
        const host = document.querySelector<HTMLElement>(`#${SETTINGS_ID} #research-hypos-host`);
        if (!host) return;
        const rid = hypos.rid;
        const ctx = this.historyManageContext();
        const last = ctx?.researchId === rid ? ctx.lastStatus : this.researchStatusOf(rid);
        const features = ctx?.researchId === rid ? ctx.features : last?.features ?? [];
        const up = this.researchBridgeUp(rid);
        const said = up && last ? last.hypothesesDecide : last?.hypothesesDecide ?? lastBridgeStatus(rid)?.hypothesesDecide;
        if (!features.includes(HYPOTHESES_DECIDE_FEATURE) || !said) {
            host.innerHTML = '';
            return;
        }
        const r = strings.research;
        if (hypos.want !== undefined && said === hypos.want) delete hypos.want;
        const value = hypos.sending ?? hypos.want ?? said;
        const note = !up ? { text: strings.history.storiesBridgeDown } : hypos.note;
        // A refusal is said as an alert once (a redraw does not say it again).
        const alert = !!note && note === hypos.note && !!hypos.note.retry && !hypos.note.said;
        if (alert) hypos.note!.said = true;
        const focused = (document.activeElement as HTMLInputElement | null)?.name === 'research-hypos-decide'
            ? (document.activeElement as HTMLInputElement).value : '';
        // On its way (6.1): the chosen one dashed with its words after 120 ms, the others locked keeping their focus.
        const off = !up ? ' disabled' : hypos.busy ? ' aria-disabled="true"' : '';
        const option = (v: ResearchHypothesesDecide, label: string, ai: boolean): string => {
            const pend = hypos.busy && v === value;
            return `
                <label class="settings-checkbox research-hypos-row"${pend ? pendAttrs(HYPOS_PEND).replace(' aria-disabled="true"', '') : ''}>
                    <input type="radio" name="research-hypos-decide" value="${v}"${v === value ? ' checked' : ''}${off}>
                    <span class="settings-text"><span class="settings-name">${esc(label)}${ai
                        ? ` <span class="research-ai-badge" title="${esc(r.aiCostHint)}" aria-hidden="true">${esc(r.aiBadge)}</span>` : ''}</span>${pend ? pendStatusHtml(HYPOS_PEND) : ''}</span>
                </label>`;
        };
        host.innerHTML = `
            <fieldset class="research-transcripts research-hypos" id="research-hypos">
                <legend>${esc(r.hypoDecideTitle)}</legend>
                ${option('person', r.hypoDecidePerson, false)}
                ${option('agent', r.hypoDecideAgent, true)}
                <p class="research-hypos-desc">${esc(r.hypoDecideDesc)}</p>
                <p class="research-not-retroactive"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(r.hypoDecideNotRetro)}</span></p>
                ${note ? `<p class="research-stories-note research-hypos-note${'retry' in note && note.retry ? ' is-err' : ''}" id="research-hypos-note"${alert ? ' role="alert"' : ''}><span>${esc(note.text)}</span>${'retry' in note && note.retry
                    ? ` <button type="button" class="link-button research-hypos-retry" id="research-hypos-retry">${esc(strings.busy.retry)}</button>` : ''}${'link' in note && note.link
                    ? ` <button type="button" class="link-button" id="research-hypos-note-link">${researchActionLabel(note.link.label, note.link.mark ?? 'none', { size: 12 })}</button>` : ''}</p>` : ''}
            </fieldset>`;
        host.querySelectorAll<HTMLInputElement>('input[name="research-hypos-decide"]').forEach(input => {
            input.addEventListener('change', () => { if (input.checked) void this.setResearchHypothesesDecide(input.value as ResearchHypothesesDecide); });
            // The choice as it stands taken again (no change): the answer to another choice under the row goes.
            input.addEventListener('click', () => {
                if (input.value !== value || !hypos.note || hypos.busy) return;
                delete hypos.note;
                this.renderResearchHypothesesRow();
            });
            if (focused && input.value === focused) input.focus({ preventScroll: true });
        });
        host.querySelector<HTMLButtonElement>('#research-hypos-note-link')?.addEventListener('click', () => hypos.note?.link?.run());
        host.querySelector<HTMLButtonElement>('#research-hypos-retry')?.addEventListener('click', () => hypos.note?.retry?.());
    },

    /**
     * Spec 060: `POST /hypotheses {decide}` — the person at once; the agent the research confirms in its
     * terminal (the sentence and its link under the row); the choice stays as the research says.
     */
    async setResearchHypothesesDecide(decide: ResearchHypothesesDecide): Promise<void> {
        const rid = hypos.rid;
        const ctx = this.historyManageContext();
        const base = ctx?.researchId === rid ? ctx.base : null;
        if (!base || hypos.busy) { this.renderResearchHypothesesRow(); return; }
        const r = strings.research;
        hypos.busy = true;
        hypos.sending = decide;
        delete hypos.note;
        startPend(HYPOS_PEND, { redraw: () => this.renderResearchHypothesesRow() });
        this.renderResearchHypothesesRow();
        const scheme = announcedResearchScheme();
        const res = await postBridgeHypotheses(base, decide, ctx!.features, { tree: rid, ...(scheme ? { scheme } : {}) });
        if (hypos.rid !== rid) { dropPend(HYPOS_PEND); return; }
        await endPend(HYPOS_PEND);
        delete hypos.busy;
        delete hypos.sending;
        const retry = (): void => void this.setResearchHypothesesDecide(decide);
        if (res.ok) {
            hypos.want = res.decide ?? decide;
        } else if (res.code === 'link') {
            const url = res.link;
            hypos.note = {
                text: r.hypoDecideConfirm,
                ...(url ? { link: { label: r.hypoDecideConfirmLink, run: () => this.launchResearchLink(url, 'terminal'), mark: researchUrlMark(url) ?? 'terminal' } } : {}),
            };
        } else if (res.code === 'busy') {
            hypos.note = { text: strings.history.errBusy, retry };
        } else {
            hypos.note = { text: res.reason || (res.held ? this.researchWriteHeldText(res.held, false).toast : strings.live.waitingWrite.writeFailed), retry };
        }
        this.renderResearchHypothesesRow();
    },

    /**
     * Spec 059 §4: "Reading documents" — only with `read.sourceTask` (not in an archive nor a research waiting for
     * its agent: no host there); the choice follows the research's status (no value said: `ask`); without the
     * bridge the choices rest, dimmed, with its sentence.
     */
    renderResearchReadTaskRow(): void {
        const host = document.querySelector<HTMLElement>(`#${SETTINGS_ID} #research-readtask-host`);
        if (!host) return;
        const rid = readTask.rid;
        const ctx = this.historyManageContext();
        const last = (ctx?.researchId === rid ? ctx.lastStatus : this.researchStatusOf(rid)) ?? lastBridgeStatus(rid);
        const features = ctx?.researchId === rid ? ctx.features : last?.features ?? [];
        if (!features.includes(READ_SOURCE_TASK_FEATURE)) {
            host.innerHTML = '';
            return;
        }
        const was = host.querySelector<HTMLDetailsElement>('#research-readtask-group');
        if (was) readTask.open = was.open;
        const up = this.researchBridgeUp(rid);
        const said: ReadTaskSetting = last?.accepts?.read?.sourceTask ?? 'ask';
        if (readTask.want !== undefined && said === readTask.want) delete readTask.want;
        const value = readTask.want ?? said;
        let note: ReadTaskSettingNote | undefined = readTask.busy ? { kind: 'busy', words: pendStatusHtml(READ_TASK_PEND) }
            : !up ? { kind: 'text', text: strings.history.storiesBridgeDown } : readTask.note;
        // A refusal is said as an alert once (a redraw does not say it again).
        if (note && note === readTask.note && note.kind === 'text' && note.retry && !readTask.said) {
            readTask.said = true;
            note = { ...note, alert: true };
        }
        const focused = (document.activeElement as HTMLInputElement | null)?.name === 'research-read-task'
            ? (document.activeElement as HTMLInputElement).value : '';
        host.innerHTML = readTaskSettingHtml({ value, open: !!readTask.open, up, note });
        host.querySelector<HTMLDetailsElement>('#research-readtask-group')?.addEventListener('toggle', (e) => {
            readTask.open = (e.currentTarget as HTMLDetailsElement).open;
        });
        host.querySelectorAll<HTMLInputElement>('input[name="research-read-task"]').forEach(input => {
            input.addEventListener('change', () => { if (input.checked) void this.setResearchReadTask(input.value as ReadTaskSetting); });
            if (focused && input.value === focused) input.focus({ preventScroll: true });
        });
        host.querySelector<HTMLButtonElement>('#research-readtask-retry')?.addEventListener('click', () => {
            if (readTask.retry) void this.setResearchReadTask(readTask.retry);
        });
    },

    /** Spec 059 §4: `POST /sourceTask {sourceTask}` — written at once; the choice stays as the research says. */
    async setResearchReadTask(value: ReadTaskSetting): Promise<void> {
        const rid = readTask.rid;
        const ctx = this.historyManageContext();
        const base = ctx?.researchId === rid ? ctx.base : null;
        if (!base || readTask.busy) { this.renderResearchReadTaskRow(); return; }
        readTask.busy = true;
        readTask.want = value;
        delete readTask.note;
        delete readTask.retry;
        startPend(READ_TASK_PEND, { redraw: () => this.renderResearchReadTaskRow() });
        this.renderResearchReadTaskRow();
        const res = await postBridgeReadTask(base, value, ctx!.features, { tree: rid });
        if (readTask.rid !== rid) { dropPend(READ_TASK_PEND); return; }
        await endPend(READ_TASK_PEND);
        delete readTask.busy;
        if (res.ok) {
            readTask.want = res.value ?? value;
            readTask.note = { kind: 'ok' };
        } else {
            delete readTask.want;
            readTask.retry = value;
            readTask.said = false;
            readTask.note = {
                kind: 'text',
                text: res.code === 'busy' ? strings.history.errBusy
                    : res.reason || (res.held ? this.researchWriteHeldText(res.held, false).toast : strings.live.waitingWrite.writeFailed),
                retry: true,
            };
        }
        this.renderResearchReadTaskRow();
    },

    /**
     * "Change in the research settings ›" (the reading's footer, spec 059 §1 C/D): the dialog opens with
     * "Reading documents" open, scrolled into view in the dialog (its own scroll, not the page's) and
     * highlighted for a moment.
     */
    openReadTaskSettings(): void {
        this.closeActionsMenu();
        const id = TreeManager.getActiveTreeId();
        if (!id) return;
        void this.showResearchTreeSettings(id).then(() => {
            this.flashResearchSettingsGroup('research-readtask-group', 'input[name="research-read-task"]:checked', () => { readTask.open = true; });
        });
    },

    /** A group of the dialog opened, scrolled into view in the dialog (its own scroll, not the page's), highlighted for a moment and focused. */
    flashResearchSettingsGroup(groupId: string, focusSelector: string, opened: () => void): void {
        const group = document.querySelector<HTMLDetailsElement>(`#${SETTINGS_ID} #${groupId}`);
        if (!group) return;
        group.open = true;
        opened();
        let box: HTMLElement | null = group.parentElement;
        while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement;
        if (box) box.scrollTop += group.getBoundingClientRect().top - box.getBoundingClientRect().top - 12;
        group.classList.add('is-flash');
        window.setTimeout(() => group.classList.remove('is-flash'), READ_TASK_FLASH_MS);
        group.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
    },

    /**
     * Spec 105 §4: "Books" — only with `books` and its part said (not in an archive nor a research waiting for its
     * agent: no host there); the values follow the research's status, also when they change in its terminal, but
     * never under a number being typed (`force`: a redraw of this group's own write). Without the bridge the controls
     * rest, dimmed, with its sentence.
     */
    renderResearchBooksRow(force = false): void {
        const host = document.querySelector<HTMLElement>(`#${SETTINGS_ID} #research-books-host`);
        if (!host) return;
        const rid = books.rid;
        const ctx = this.historyManageContext();
        const last = (ctx?.researchId === rid ? ctx.lastStatus : this.researchStatusOf(rid)) ?? lastBridgeStatus(rid);
        const features = ctx?.researchId === rid ? ctx.features : last?.features ?? [];
        if (books.gone || !booksOn({ features, books: last?.books })) {
            host.innerHTML = '';
            return;
        }
        const active = document.activeElement as HTMLElement | null;
        if (!force && active?.id === 'research-books-min' && host.contains(active)) {
            books.stale = true;
            return;
        }
        delete books.stale;
        const was = host.querySelector<HTMLDetailsElement>('#research-books-group');
        if (was) books.open = was.open;
        const up = this.researchBridgeUp(rid);
        const said = last!.books!.settings;
        if (books.want && sameBooksSettings(said, books.want)) delete books.want;
        const settings = books.want ?? said;
        const note: BooksSettingNote | undefined = books.busy ? { kind: 'busy' }
            : !up ? { kind: 'text', text: strings.history.storiesBridgeDown } : books.note;
        const focusId = books.focusId ?? (active && host.contains(active) && BOOKS_FOCUSABLE.includes(active.id) ? active.id : '');
        host.innerHTML = booksSettingHtml({ settings, open: !!books.open, up, note, invalid: books.invalid ?? null });
        host.querySelector<HTMLDetailsElement>('#research-books-group')?.addEventListener('toggle', (e) => {
            books.open = (e.currentTarget as HTMLDetailsElement).open;
        });
        const min = host.querySelector<HTMLInputElement>('#research-books-min');
        if (min) {
            const take = (): void => {
                const text = min.value.trim();
                if (!text && !min.validity.badInput) {
                    // An empty field takes the research's value back.
                    delete books.invalid;
                    this.renderResearchBooksRow(true);
                    return;
                }
                const n = booksMinTasksInput(text);
                if (n === null) {
                    books.invalid = text;
                    books.focusId = 'research-books-min';
                    this.renderResearchBooksRow(true);
                    delete books.focusId;
                    return;
                }
                delete books.invalid;
                if (n === settings.minTasks) { this.renderResearchBooksRow(true); return; }
                void this.setResearchBooks({ minTasks: n }, 'research-books-min');
            };
            min.addEventListener('change', take);
            min.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); take(); } });
            // A redraw held while typing comes when the field is left.
            min.addEventListener('blur', () => {
                window.setTimeout(() => { if (books.stale && document.activeElement?.id !== 'research-books-min') this.renderResearchBooksRow(); }, 0);
            });
        }
        const same = host.querySelector<HTMLInputElement>('#research-books-same');
        same?.addEventListener('change', () => { void this.setResearchBooks({ sameBook: same.checked ? 'yes' : 'no' }, 'research-books-same'); });
        host.querySelector<HTMLButtonElement>('#research-books-min-reset')?.addEventListener('click', () => {
            delete books.invalid;
            void this.setResearchBooks({ minTasks: 'default' }, 'research-books-min');
        });
        host.querySelector<HTMLButtonElement>('#research-books-same-reset')?.addEventListener('click', () => {
            void this.setResearchBooks({ sameBook: 'default' }, 'research-books-same');
        });
        host.querySelector<HTMLButtonElement>('#research-books-retry')?.addEventListener('click', () => {
            if (books.last) void this.setResearchBooks(books.last, books.focusId ?? 'research-books-min');
        });
        if (focusId) {
            const el = host.querySelector<HTMLElement>(`#${focusId}`) ?? (focusId.endsWith('-reset') ? host.querySelector<HTMLElement>(`#${focusId.replace('-reset', '')}`) : null);
            if (el && !(el as HTMLInputElement).disabled) el.focus({ preventScroll: true });
        }
    },

    /** Spec 105 §4: `POST /books` — written at once; the values stay as the research says. */
    async setResearchBooks(body: BooksSettingBody, from: string): Promise<void> {
        const rid = books.rid;
        const ctx = this.historyManageContext();
        const base = ctx?.researchId === rid ? ctx.base : null;
        if (!base || books.busy) { this.renderResearchBooksRow(true); return; }
        const status = ctx!.lastStatus?.books?.settings;
        books.busy = true;
        books.last = body;
        if (status) books.want = booksSettingsAsked(books.want ?? status, body);
        delete books.note;
        this.renderResearchBooksRow(true);
        const res = await postBridgeBooks(base, body, ctx!.features);
        if (books.rid !== rid) return;
        delete books.busy;
        if (res.ok) {
            if (res.settings) books.want = res.settings;
            books.note = { kind: 'ok' };
        } else {
            delete books.want;
            const W = strings.live.waitingWrite;
            switch (res.code) {
                case 'archive': books.gone = true; break;
                case 'busy': books.note = { kind: 'text', text: strings.treeSettings.booksBusyErr, retry: true }; break;
                case 'invalid': books.note = { kind: 'text', text: strings.treeSettings.minTasksInvalid }; break;
                case 'locked': books.note = { kind: 'text', text: W.locked }; break;
                case 'held': books.note = { kind: 'text', text: res.reason || this.researchWriteHeldText(res.held!, false).toast }; break;
                case 'full': books.note = { kind: 'text', text: res.reason || W.fileFull }; break;
                default: books.note = { kind: 'text', text: res.reason || W.writeFailed };
            }
        }
        books.focusId = from;
        this.renderResearchBooksRow(true);
        delete books.focusId;
    },

    /** Save the choice at once (it goes with the next send). */
    async setResearchTranscripts(treeId: TreeId, value: ResearchTranscripts): Promise<void> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || (link.transcripts ?? 'lead') === value) return;
        if (value === 'lead') {
            TreeManager.patchResearchLink(treeId, { transcripts: undefined, transcriptsAt: undefined, olderSources: undefined });
        } else {
            const data = DataManager.getCurrentTreeId() === treeId ? DataManager.getData() : await readTree(treeId);
            TreeManager.patchResearchLink(treeId, {
                transcripts: 'evidence',
                transcriptsAt: new Date().toISOString(),
                olderSources: data ? sourcesAtSwitch(data, link.sentSources) : {},
            });
        }
        this.refreshResearchSyncUi();
    },

    /**
     * Once per tree tied to a research (one from before 3.9, or opened from
     * the research rather than handed over): how should changes go? Asked when
     * the tree is open, its research running and nothing else on screen; the
     * way it goes now is checked and marked "(so far)" — nothing changes
     * unless the user says so. × / Esc leave it unanswered: asked again when
     * the tree is next opened (sending goes on as it went).
     */
    maybeAskResearchSendMode(treeId: TreeId): void {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || link.copy || !onComputer() || DataManager.getCurrentTreeId() !== treeId || DataManager.isReadOnly()) return;
        if (researchAutoState(treeId).modeAsked || askLater.has(treeId) || document.getElementById(ASK_ID)) return;
        if (document.querySelector('.modal-overlay.active, #research-changes-panel, .actions-menu-dropdown.active, #actions-menu-dropdown.active')
            || this.isFollowingActiveResearch()) return;
        const t = strings.treeSettings;
        const current = researchSendMode(link);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = ASK_ID;
        overlay.innerHTML = `
            <div class="modal modal--md research-mode-ask research-send-dialog" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="research-mode-ask-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="research-mode-ask-title">${esc(t.askTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(t.askSub(TreeManager.getTreeMetadata(treeId)?.name ?? ''))}</div>
                    </div>
                    <button type="button" class="close-btn" id="research-mode-ask-x" data-dismiss aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="research-send-dialog-body">
                    <fieldset class="research-transcripts research-send-mode research-mode-ask-cards" aria-labelledby="research-mode-ask-title">
                        ${researchSendModeCardsHtml(current, compactScreen(), ASK_GROUP, current, newTieSendMode(this.researchAgentlessFor(link.id, link)))}
                    </fieldset>
                    ${researchSendPrinciplesHtml(true)}
                </div>
                <div class="buttons research-send-dialog-foot">
                    <span class="research-send-dialog-note">${esc(t.askNote)}</span>
                    <button type="button" class="primary research-mode-ask-answer" id="research-mode-ask-save">${esc(t.askKeep)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(ASK_ID);
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        const answer = overlay.querySelector('#research-mode-ask-save') as HTMLButtonElement;
        // Keep while the choice is how it goes now, else Save.
        overlay.querySelectorAll<HTMLInputElement>(`input[name="${ASK_GROUP}"]`).forEach(input => input.addEventListener('change', () => {
            answer.textContent = researchSendModeChecked(overlay, ASK_GROUP) === current ? t.askKeep : t.askSave;
        }));
        (overlay.querySelector('#research-mode-ask-x') as HTMLButtonElement).onclick = () => this.dismissResearchModeAsk(treeId);
        answer.onclick = () => this.closeResearchModeAsk(treeId, researchSendModeChecked(overlay, ASK_GROUP));
        answer.focus();
    },

    /** The tree was opened again: its one-time question, closed unanswered, is asked again. */
    forgetResearchModeAskLater(treeId: TreeId): void {
        askLater.delete(treeId);
    },

    /** × / Esc on the one-time question: no answer, asked again when the tree is next opened. */
    dismissResearchModeAsk(treeId?: TreeId): void {
        const id = treeId ?? TreeManager.getActiveTreeId();
        if (id) askLater.add(id);
        document.querySelectorAll(`#${ASK_ID}`).forEach(el => el.remove());
        this.dialogStack = this.dialogStack.filter(d => d !== ASK_ID);
    },

    /** The one-time question answered: the choice (null: keep how it goes) stored explicitly, never asked again. */
    closeResearchModeAsk(treeId: TreeId, choice: ResearchSendMode | null): void {
        document.querySelectorAll(`#${ASK_ID}`).forEach(el => el.remove());
        this.dialogStack = this.dialogStack.filter(d => d !== ASK_ID);
        patchResearchAutoState(treeId, { modeAsked: true });
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link) return;
        const mode = choice ?? researchSendMode(link);
        if (mode !== researchSendMode(link)) this.setResearchSendMode(treeId, mode);
        else if (link.sendMode !== mode) TreeManager.patchResearchLink(treeId, { sendMode: mode });
        this.refreshResearchSyncUi();
    },

    closeResearchTreeSettings(): void {
        // Every copy of it (opened twice, the button of the upper one closed only the lower).
        document.querySelectorAll(`#${SETTINGS_ID}`).forEach(el => el.remove());
        this.dialogStack = this.dialogStack.filter(d => d !== SETTINGS_ID);
    },

    /** "Older sources with a transcription": the catalog filtered to the unverified ones. */
    async showUnverifiedSources(treeId: TreeId): Promise<void> {
        if (DataManager.getCurrentTreeId() !== treeId) await this.switchToTree(treeId, { follow: false });
        if (DataManager.getCurrentTreeId() !== treeId) return;
        this.closeTreeManagerDialog();
        this.sourcesFilter = 'unverifiedTranscript';
        this.showSourcesDialog();
    },
});
