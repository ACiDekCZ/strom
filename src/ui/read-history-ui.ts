/**
 * "Read documents" (spec 013, P2): the research's readings (`GET reads`),
 * listed from the dialog "Research for this tree…". A row opens the reading
 * in the "Read a document" dialog (its result, its progress, or what became
 * of it). Nothing of the list is kept in the tree.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { TreeId } from '../types.js';
import { shownName } from '../person-name.js';
import { READ_FEATURE, ReadHistoryItem, fetchReads, readRunning } from '../research-read.js';
import { normalizeModal } from './modal-skeleton.js';
import { uiModule } from './module.js';

const HISTORY_ID = 'read-history-modal';

function esc(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** When it was asked for, as the app's language writes a date and time ('' = not said). */
function whenText(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    try {
        return new Date(t).toLocaleString(getCurrentLanguage(), { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    }
}

function stateTone(item: ReadHistoryItem): string {
    if (item.state === 'done') return 'is-ok';
    if (item.state === 'unreadable' || item.state === 'failed') return 'is-warn';
    return 'is-muted';
}

export const readHistoryMethods = uiModule({
    /**
     * The row "Read documents (N)" of "Research for this tree…": shown for the
     * open tree when its research reads and lists readings, and has some. A
     * research without the list (older: 404) or an archive leaves it hidden.
     */
    async fillReadHistoryRow(btn: HTMLButtonElement, treeId: TreeId): Promise<void> {
        const link = this.researchOriginalsLink();
        if (!link || link.treeId !== treeId) return;
        const status = this.researchStatusOf(link.researchId);
        if (!status?.features?.includes(READ_FEATURE) && !status?.accepts?.read) return;
        const base = this.readBridgeBase(link.researchId);
        if (!base) return;
        const reply = await fetchReads(base);
        if (!reply.ok || reply.value.length === 0 || !btn.isConnected) return;
        const items = reply.value;
        btn.textContent = strings.read.historyRow(items.length);
        btn.hidden = false;
        btn.onclick = () => {
            this.closeResearchTreeSettings();
            this.showReadHistoryDialog(items);
        };
    },

    /** The list of readings, newest first; a row opens its reading over the list. */
    showReadHistoryDialog(items: ReadHistoryItem[]): void {
        this.closeReadHistoryDialog();
        const t = strings.read;
        const link = this.researchOriginalsLink();
        const tree = link ? TreeManager.getTreeMetadata(link.treeId)?.name ?? '' : '';
        const data = DataManager.getData();
        const byRefn = new Map<string, string>();
        for (const p of Object.values(data.persons)) if (p.refn && !byRefn.has(p.refn)) byRefn.set(p.refn, shownName(p));
        const rows = items.map(item => {
            const name = item.name || t.historyUnnamed;
            const person = item.person ? byRefn.get(item.person) ?? '' : '';
            const meta = [
                whenText(item.at),
                person,
                item.entries > 0 || item.state === 'done' ? t.historyEntries(item.entries) : '',
            ].filter(Boolean);
            const tags = [
                `<span class="read-pill ${stateTone(item)}" data-tag="state">${esc(t.historyState[item.state] ?? item.state)}</span>`,
                item.inSource ? `<span class="read-pill is-muted" data-tag="in-source">${esc(t.historyInTree)}</span>` : '',
                item.from === 'research' ? `<span class="read-pill is-muted" data-tag="from-research">${esc(t.historyFromResearch)}</span>` : '',
            ].join('');
            return `
                <li><button type="button" class="read-history-row${readRunning(item.state) ? ' is-running' : ''}" data-read="${esc(item.id)}">
                    <span class="read-history-main">
                        <span class="read-history-name" title="${esc(name)}">${esc(name)}</span>
                        <span class="read-history-meta">${meta.map(m => `<span>${esc(m)}</span>`).join('<span aria-hidden="true"> · </span>')}</span>
                    </span>
                    <span class="read-history-tags">${tags}</span>
                    <span class="read-history-chev" aria-hidden="true">›</span>
                </button></li>`;
        }).join('');
        const overlay = document.createElement('div');
        overlay.id = HISTORY_ID;
        overlay.className = 'modal-overlay active';
        overlay.innerHTML = `
            <div class="modal modal--md read-history" role="dialog" aria-modal="true" aria-labelledby="read-history-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="read-history-title">${esc(t.historyTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(t.historySub(tree))}</div>
                    </div>
                    <button type="button" class="close-btn" data-history-close aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="modal-content read-history-content">
                    ${rows ? `<ul class="read-history-list">${rows}</ul>` : `<p class="read-history-empty">${esc(t.historyEmpty)}</p>`}
                </div>
                <div class="buttons">
                    <button type="button" class="primary" data-history-close>${esc(t.close)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(HISTORY_ID);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { this.closeReadHistoryDialog(); return; }
            const el = e.target as Element | null;
            if (el?.closest('[data-history-close]')) { this.closeReadHistoryDialog(); return; }
            const row = el?.closest<HTMLElement>('.read-history-row');
            const item = row ? items.find(i => i.id === row.dataset.read) : undefined;
            if (item) this.showReadDocumentDialog({ readId: item.id, read: item });
        });
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        overlay.querySelector<HTMLElement>('.read-history-row, .buttons .primary')?.focus();
    },

    closeReadHistoryDialog(): void {
        document.querySelectorAll(`#${HISTORY_ID}`).forEach(el => el.remove());
        this.dialogStack = this.dialogStack.filter(d => d !== HISTORY_ID);
    },
});
