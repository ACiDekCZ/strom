/**
 * "Research for this tree": how the research takes the user's transcripts
 * (lead — it checks them by its own reading; evidence — a transcript is the
 * first reading). Saved at once on the tree's research link and sent with the
 * next send (`_STROM_TRANSCRIPTS`). The switch does not reach back: sources
 * already sent keep their weight until the user ticks "Transcription
 * verified" on each, which the dialog says and links to.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { TreeId, ResearchTranscripts, ResearchSendMode, StromData } from '../types.js';
import { researchSchemeUrl } from '../research-link.js';
import { sourceReadingHash, unverifiedOlderSources } from '../research-sync.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { onComputer, readTree } from './research-ui.js';
import { researchDisplayName, researchSendMode } from './research-sync-ui.js';

const SETTINGS_ID = 'research-tree-settings-modal';

/** A phone-sized or touch screen: short card texts, and a note instead of the effect box and the status line. */
function compactScreen(): boolean {
    try { return window.matchMedia?.('(max-width: 499px), (pointer: coarse)').matches ?? false; } catch { return false; }
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
        document.getElementById(SETTINGS_ID)?.remove();
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
        const sendOption = (value: ResearchSendMode, title: string, desc: string, isDefault: boolean): string => `
            <label class="research-transcripts-card">
                <input type="radio" name="research-send-mode" value="${value}"${value === sendMode ? ' checked' : ''}>
                <span class="research-transcripts-text">
                    <span class="research-transcripts-title">${esc(title)}${isDefault ? ` <span class="research-transcripts-default">${esc(t.default)}</span>` : ''}</span>
                    <span class="research-transcripts-desc">${esc(desc)}</span>
                </span>
            </label>`;
        const effect = archive ? t.effectArchive : this.researchReviewOn(link.id) ? t.effectReview : t.effectAgent;
        const sendingHtml = !sendingShown ? '' : `
                <fieldset class="research-transcripts research-send-mode">
                    <legend>${esc(t.sending)}</legend>
                    ${sendOption('auto', t.auto, compact ? t.autoDescShort : t.autoDesc, true)}
                    ${sendOption('manual', t.manual, compact ? t.manualDescShort : t.manualDesc, false)}
                </fieldset>
                ${compact
                    ? `<p class="research-send-device">${esc(t.deviceNote)}</p>`
                    : `<p class="research-not-retroactive research-send-effect"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(effect)}</span></p>
                       <div class="research-send-status" id="research-send-status" hidden></div>`}`;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = SETTINGS_ID;
        overlay.innerHTML = `
            <div class="modal modal--md research-tree-settings" role="dialog" data-dialog-kind="settings" aria-modal="true" aria-labelledby="research-tree-settings-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="research-tree-settings-title">${esc(t.title)}${archive ? ` <span class="research-sync-tag research-sync-tag--inline">${esc(s.archiveTag)}</span>` : ''}</h2>
                        <div class="audit-log-subtitle">${esc(t.subtitle(meta.name, researchDisplayName(link.id), meta.personCount))}</div>
                        ${modeLine ? `<div class="research-mode-line">${esc(modeLine)}</div>` : ''}
                    </div>
                    <button type="button" class="close-btn" id="research-tree-settings-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <fieldset class="research-transcripts">
                    <legend>${esc(t.transcripts)}</legend>
                    ${option('lead', t.guide, t.guideDesc, true)}
                    ${option('evidence', t.evidence, t.evidenceDesc, false)}
                </fieldset>
                ${archive ? `<p class="research-transcripts-archive">${esc(t.transcriptsArchiveNote)}</p>` : ''}
                <p class="research-not-retroactive"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(t.notRetroactive)}</span></p>
                <button type="button" class="link-button research-older-sources" id="research-older-sources" hidden></button>
                ${sendingHtml}
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
                btn.textContent = s.sendAgain;
                btn.onclick = () => {
                    close();
                    void this.researchSendTree(treeId);
                };
                statusEl.append(' ', btn);
            }
        };
        overlay.querySelectorAll<HTMLInputElement>('input[name="research-send-mode"]').forEach(input => {
            input.addEventListener('change', () => {
                if (!input.checked) return;
                this.setResearchSendMode(treeId, input.value === 'manual' ? 'manual' : 'auto');
                renderStatus();
            });
        });
        renderStatus();
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

    closeResearchTreeSettings(): void {
        document.getElementById(SETTINGS_ID)?.remove();
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
