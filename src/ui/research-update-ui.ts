/**
 * An older Strom Research (1.11 and before: its bridge says nothing of what it
 * takes; or 1.12, which knows no titles, for a tree that has some): a quiet line "The research has an older version… How to update…"
 * in ⋯ → Research, Research for this tree and by the Attachments heading, and
 * the dialog with the one command for every install (`strom update`), the npm
 * one, and the install line as the way when that fails. "Check again" asks
 * the bridge; updated, the tree goes on by itself and the line goes.
 */

import { strings } from '../strings.js';
import { storedResearchBridge } from '../research-device.js';
import { TITLES_FEATURE, hasTitles } from '../research-link.js';
import { DataManager } from '../data.js';
import { onComputer } from './research-ui.js';
import { installChannel, npmUpdateCommand } from '../research-install.js';
import { isBetaBuildHere } from '../pwa.js';
import { uiModule } from './module.js';

const DIALOG_ID = 'research-update-modal';
const UPDATE_COMMAND = 'strom update';
/** How long "Check again" waits for the bridge. */
const CHECK_TIMEOUT_MS = 4000;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const researchUpdateMethods = uiModule({
    /**
     * The open tree's research is an older version: its bridge is known on
     * this computer and it never said what it takes. Its version when it
     * answered in this page ('' = not known). Null: not older (or not known).
     */
    researchOlderVersion(): { version: string; titles?: true } | null {
        const ctx = this.researchSyncLink();
        if (!ctx || !onComputer()) return null;
        const id = ctx.link.id;
        if (!storedResearchBridge(id)?.base) return null;
        if (!this.researchSyncCapable(id)) return { version: this.researchBridgeVersion(id) };
        // One that sends, but knows no titles (1.12) while this tree has some: they stay here only (B-1).
        if (this.researchLacksTitles(id) && hasTitles(DataManager.getData())) return { version: this.researchBridgeVersion(id), titles: true };
        return null;
    },

    /** The research answered in this page without `person.titles` (1.12 and before). Not asked yet: not known, false. */
    researchLacksTitles(researchId: string): boolean {
        const status = this.researchStatusOf(researchId);
        return !!status && !status.features?.includes(TITLES_FEATURE);
    },

    /** The quiet line with its "How to update…" link (HTML; '' when the research is not older). */
    researchOlderLineHtml(where: 'menu' | 'settings' | 'attachments'): string {
        const older = this.researchOlderVersion();
        // The titles are no matter of the attachments.
        if (!older || (older.titles && where === 'attachments')) return '';
        const u = strings.researchOlder;
        const text = where === 'attachments' ? strings.media.olderResearch : older.titles ? u.titlesLine(older.version) : u.line(older.version);
        return `<span class="research-older-text">${esc(text)}</span> `
            + `<button type="button" class="link-button research-older-how"${where === 'menu' ? ' role="menuitem"' : ''} data-research-update="${where}" onclick="window.Strom.UI.showResearchUpdateHelp()">${esc(u.how)}</button>`;
    },

    showResearchUpdateHelp(): void {
        this.closeActionsMenu();
        document.getElementById(DIALOG_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.id = DIALOG_ID;
        overlay.className = 'modal-overlay active';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeResearchUpdateHelp(); });
        this.renderResearchUpdateHelp('');
        this.pushDialog(DIALOG_ID);
    },

    renderResearchUpdateHelp(note: string): void {
        const overlay = document.getElementById(DIALOG_ID);
        if (!overlay) return;
        const u = strings.researchOlder;
        const older = this.researchOlderVersion();
        const version = older?.version ?? '';
        const row = (cmd: string): string => `
            <div class="install-line-row">
                <code class="install-line" tabindex="0" data-line="${esc(cmd)}">${esc(cmd)}</code>
                <button type="button" class="install-copy" data-act="copy">${esc(strings.install.copy)}</button>
            </div>`;
        overlay.innerHTML = `
            <div class="modal modal--md research-update-dialog" role="dialog" aria-modal="true" aria-labelledby="research-update-title">
                <div class="modal-header">
                    <h2 id="research-update-title">${esc(u.title)}</h2>
                    <button type="button" class="close-btn" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="modal-content">
                    <p class="research-update-intro">${esc(older?.titles ? u.titlesIntro(version) : u.intro(version))}</p>
                    <p class="research-update-label">${esc(u.runInTerminal)}</p>
                    ${row(UPDATE_COMMAND)}
                    <p class="research-update-label">${esc(u.npm)}</p>
                    ${row(npmUpdateCommand(installChannel(isBetaBuildHere())))}
                    <p class="research-update-hint">${esc(u.restart)}</p>
                    <p class="research-update-hint">${esc(u.fallback)} <button type="button" class="link-button" data-act="install">${esc(u.showInstall)}</button></p>
                    ${note ? `<p class="research-update-note" role="status">${esc(note)}</p>` : ''}
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" data-act="close">${esc(strings.buttons.close)}</button>
                    <button type="button" class="primary" data-act="check">${esc(u.check)}</button>
                </div>
            </div>`;
        overlay.querySelector('.close-btn')?.addEventListener('click', () => this.closeResearchUpdateHelp());
        overlay.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(btn => btn.addEventListener('click', () => {
            const act = btn.dataset.act;
            if (act === 'close') this.closeResearchUpdateHelp();
            else if (act === 'check') void this.checkResearchUpdated();
            else if (act === 'install') {
                this.closeResearchUpdateHelp();
                this.showResearchInstall('install');
            } else if (act === 'copy') {
                void this.copyResearchInstallLine(btn.parentElement?.querySelector<HTMLElement>('.install-line'), false);
            }
        }));
    },

    /** "Check again": ask the bridge; updated, the tree goes on by itself and the dialog closes. */
    async checkResearchUpdated(): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx) { this.closeResearchUpdateHelp(); return; }
        const u = strings.researchOlder;
        const btn = document.querySelector<HTMLButtonElement>(`#${DIALOG_ID} [data-act="check"]`);
        if (btn) { btn.disabled = true; btn.textContent = u.checking; }
        const status = await this.askResearchBridge(ctx.link.id, CHECK_TIMEOUT_MS);
        if (status && this.researchSyncCapable(ctx.link.id) && !this.researchOlderVersion()?.titles) {
            this.closeResearchUpdateHelp();
            this.showToast(u.updated(status.version), 5000);
            this.researchAutoArm();
            this.refreshResearchSyncUi();
            this.renderAttachmentsList();
            void this.researchOriginalsKick();
            return;
        }
        this.renderResearchUpdateHelp(status ? u.stillOlder(status.version) : u.notAnswering);
    },

    closeResearchUpdateHelp(): void {
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
    },
});
