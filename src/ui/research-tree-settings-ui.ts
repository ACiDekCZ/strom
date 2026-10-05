/**
 * "Research for this tree": how the research takes the user's transcripts
 * (lead — it checks them by its own reading; evidence — a transcript is the
 * first reading). Saved at once on the tree's research link and sent with the
 * next send (`_STROM_TRANSCRIPTS`). The switch does not reach back: sources
 * already sent keep their weight until the user ticks "Transcription
 * verified" on each, which the dialog says and links to. An archive takes
 * transcripts as leads: the setting is not offered there (nor sent), and is
 * kept for a switch to research.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { TreeId, ResearchTranscripts, ResearchSendMode, StromData } from '../types.js';
import { researchSchemeUrl } from '../research-link.js';
import { researchAutoState, patchResearchAutoState, researchSendPreviewSkipped, noteResearchSendPreviewSkipped } from '../research-device.js';
import { sourceReadingHash, unverifiedOlderSources } from '../research-sync.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { onComputer, readTree } from './research-ui.js';
import { researchDisplayName, researchSendMode } from './research-sync-ui.js';
import { SettingsManager } from '../settings.js';
import { formatBytesShort } from './originals-ui.js';

const SETTINGS_ID = 'research-tree-settings-modal';
const ASK_ID = 'research-mode-ask-modal';
const ASK_GROUP = 'research-ask-send-mode';
/** Trees whose one-time question was closed unanswered: asked again the next time the tree is opened. */
const askLater = new Set<TreeId>();

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
 * hand-over and the one-time question. By hand is the recommended one, always;
 * `was` marks how it went so far (the one-time question).
 */
export function researchSendModeCardsHtml(current: ResearchSendMode, compact = compactScreen(), name = 'research-send-mode', was?: ResearchSendMode): string {
    const t = strings.treeSettings;
    const card = (value: ResearchSendMode, title: string, desc: string, recommended: boolean): string => `
            <label class="research-transcripts-card research-send-card">
                <input type="radio" name="${name}" value="${value}"${value === current ? ' checked' : ''}>
                <span class="research-transcripts-text">
                    <span class="research-transcripts-title">${esc(title)}${recommended ? ` <span class="research-send-recommended">${esc(t.recommended)}</span>` : ''}${value === was ? ` <span class="research-send-was">${esc(t.askWas)}</span>` : ''}</span>
                    <span class="research-transcripts-desc">${esc(desc)}</span>
                </span>
            </label>`;
    return card('manual', t.manual, compact ? t.manualDescShort : t.manualDesc, true)
        + card('auto', t.auto, compact ? t.autoDescShort : t.autoDesc, false)
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
export function researchTrialTagHtml(): string {
    return `<button type="button" class="research-trial-tag" aria-expanded="false" aria-haspopup="true"`
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

    /** The dialog for a tree tied to a research that knows how a transcript weighs. */
    async showResearchTreeSettings(treeId: TreeId): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId);
        const link = meta?.research;
        if (!meta || !link) return;
        document.querySelectorAll(`#${SETTINGS_ID}`).forEach(el => el.remove());
        const t = strings.treeSettings;
        const current: ResearchTranscripts = link.transcripts === 'evidence' ? 'evidence' : 'lead';
        const option = (value: ResearchTranscripts, title: string, desc: string, isDefault: boolean): string => `
            <label class="research-transcripts-card">
                <input type="radio" name="research-transcripts" value="${value}"${value === current ? ' checked' : ''}>
                <span class="research-transcripts-text">
                    <span class="research-transcripts-title">${esc(title)}${isDefault ? ` <span class="research-transcripts-default">${esc(t.default)}</span>` : ''}</span>
                    <span class="research-transcripts-desc">${esc(desc)}</span>
                </span>
            </label>`;
        const setup = onComputer() && this.researchLinkAvailable('setup') ? researchSchemeUrl('setup', { tree: link.id }) : null;
        const s = strings.sync;
        const archive = this.researchModeOf(link.id, link) === 'archive';
        const modeLine = this.researchModeSinceLine(treeId);
        // How changes go: a research that tells what it takes (an older one sends the old way only).
        const sendingShown = this.researchSyncCapable(link.id);
        const compact = compactScreen();
        const sendMode = researchSendMode(link);
        const effect = archive ? t.effectArchive : this.researchReviewOn(link.id) ? t.effectReview : t.effectAgent;
        const olderLine = sendingShown ? '' : this.researchOlderLineHtml('settings');
        const sendingHtml = !sendingShown ? (olderLine ? `<p class="research-older-line">${olderLine}</p>` : '') : `
                <fieldset class="research-transcripts research-send-mode">
                    <legend>${esc(t.sending)}</legend>
                    ${researchSendModeCardsHtml(sendMode, compact)}
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
                        <div class="research-title-row"><h2 id="research-tree-settings-title">${esc(t.title)}${archive ? ` <span class="research-sync-tag research-sync-tag--inline">${esc(s.archiveTag)}</span>` : ''}</h2>${researchTrialTagHtml()}</div>
                        <div class="audit-log-subtitle">${esc(t.subtitle(meta.name, researchDisplayName(link.id), meta.personCount))}</div>
                        <div class="research-trial-sentence">${esc(t.trialSentence)}</div>
                        ${modeLine ? `<div class="research-mode-line">${esc(modeLine)}</div>` : ''}
                    </div>
                    <button type="button" class="close-btn" id="research-tree-settings-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                ${archive ? '' : `
                <fieldset class="research-transcripts">
                    <legend>${esc(t.transcripts)}</legend>
                    ${option('lead', t.guide, t.guideDesc, true)}
                    ${option('evidence', t.evidence, t.evidenceDesc, false)}
                </fieldset>
                <p class="research-not-retroactive"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(t.notRetroactive)}</span></p>
                <button type="button" class="link-button research-older-sources" id="research-older-sources" hidden></button>`}
                ${sendingHtml}
                ${originalsHtml}
                <div class="buttons research-tree-settings-buttons">
                    ${setup ? `<button type="button" class="link-button research-settings-in-research" id="research-settings-in-research">${esc(strings.research.settingsInResearch)} ↗</button>` : ''}
                    <button type="button" class="primary" id="research-tree-settings-done" data-dismiss>${esc(t.done)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(SETTINGS_ID);
        const close = (): void => this.closeResearchTreeSettings();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#research-tree-settings-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#research-tree-settings-done') as HTMLButtonElement).onclick = close;
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
        await renderOlder();
        overlay.querySelector<HTMLInputElement>('input[name="research-transcripts"]:checked')?.focus();
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
                        ${researchSendModeCardsHtml(current, compactScreen(), ASK_GROUP, current)}
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
        if (DataManager.getCurrentTreeId() !== treeId) await this.switchToTree(treeId);
        if (DataManager.getCurrentTreeId() !== treeId) return;
        this.closeTreeManagerDialog();
        this.sourcesFilter = 'unverifiedTranscript';
        this.showSourcesDialog();
    },
});
