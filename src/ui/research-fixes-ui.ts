/**
 * "Tree fixes" (symbols of history §7): the research menu's item with the
 * count of fixes waiting, and its dialog — the list the research's bridge
 * gives (`GET /fixes`, research-fixes.ts). Running and undoing a fix happen
 * in the research's terminal (`strom-research://fixes?…`), confirmed there;
 * the changes come back with sync. Only a research tree on a computer whose
 * research announces `fixes.list` and the `fixes` link; else nothing at all.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { parseLiveBridge, type LiveStatus } from '../research-link.js';
import { storedResearchBridge } from '../research-device.js';
import {
    FIXES_LIST_FEATURE, availableFixCount, fetchResearchFixes, fixRows, fixText, fixesEmpty,
    type FixesReply, type FixRow,
} from '../research-fixes.js';
import { formatLiveClock } from '../live-time.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { onComputer } from './research-ui.js';
import { researchOpenLabel } from './research-open-mark.js';
import { normalizeModal } from './modal-skeleton.js';
import { uiModule } from './module.js';

export const FIXES_DIALOG_ID = 'research-fixes-modal';

interface FixesOfResearch {
    reply: FixesReply;
    /** When the list came (the footer's "refreshed at sync …"). */
    at: number;
}

/** Per research (lowercase id): the last list, the head it was read at, the features of its last status. */
const lists = new Map<string, FixesOfResearch>();
const readAtHead = new Map<string, string>();
const lastFeatures = new Map<string, readonly string[]>();
const reading = new Set<string>();
/**
 * Fixes opened from here in this page, per research, with the list's `rev`
 * they were opened at: shown "opened in the research" until the research's
 * list changes (its answer then says what happened).
 */
const opened = new Map<string, { rev: string; ids: Set<string> }>();
let listening = false;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bridgeBase(rid: string): string | null {
    return parseLiveBridge(storedResearchBridge(rid)?.base)?.base ?? null;
}

function shortDate(iso: string | undefined, lang: string): string {
    const ts = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ts) ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'numeric' }).format(new Date(ts)) : '';
}

function openedIds(rid: string): Set<string> {
    return opened.get(rid)?.ids ?? new Set<string>();
}

export const researchFixesMethods = uiModule({
    /** At startup: read the list whenever a research that gives it says its state. */
    initResearchFixes(): void {
        if (listening) return;
        listening = true;
        onBridgeStatus((researchId, status) => this.noteFixesStatus(researchId, status));
        window.addEventListener('strom:tree-switched', () => {
            const rid = this.fixesResearchId();
            if (rid && this.researchBridgeUp(rid)) {
                const status = this.researchStatusOf(rid);
                if (status) this.noteFixesStatus(rid, status);
            }
        });
    },

    /** The open research tree's research id (lowercase), or null. */
    fixesResearchId(): string | null {
        return this.activeResearchId()?.toLowerCase() ?? null;
    },

    /** A status of a research: read its list when it gives one and the research changed since (its head). */
    noteFixesStatus(researchId: string, status: LiveStatus): void {
        const rid = researchId.toLowerCase();
        const features = status.features ?? [];
        lastFeatures.set(rid, features);
        if (!features.includes(FIXES_LIST_FEATURE)) {
            // An older research (or one that stopped giving it): no list, no item.
            if (lists.delete(rid)) this.fixesChanged();
            return;
        }
        const head = status.head ?? '';
        if (lists.has(rid) && readAtHead.get(rid) === head) return;
        void this.readResearchFixes(rid, head);
    },

    /** `GET /fixes` of a research; the list replaces the last one (and what was opened, once the research's list moved). */
    async readResearchFixes(rid: string, head = readAtHead.get(rid) ?? ''): Promise<void> {
        if (reading.has(rid)) return;
        const base = bridgeBase(rid);
        if (!base) return;
        reading.add(rid);
        try {
            const res = await fetchResearchFixes(base);
            if (res.ok) {
                const was = opened.get(rid);
                if (was && was.rev !== res.reply.rev) opened.delete(rid);
                lists.set(rid, { reply: res.reply, at: Date.now() });
                readAtHead.set(rid, head);
            } else if (res.code === 'missing') {
                lists.delete(rid);
            }
            // An error keeps the last list: the research is busy or away for a moment.
        } finally {
            reading.delete(rid);
        }
        this.fixesChanged();
    },

    /** The list or what was opened changed: the menu's count and the open dialog follow. */
    fixesChanged(): void {
        if (document.getElementById('research-menu') || document.getElementById('research-sheet-menu')) this.refreshResearchMenu();
        if (document.getElementById(FIXES_DIALOG_ID)) this.renderResearchFixesList();
    },

    /** The open tree's list, when the item and the dialog are offered (else null). */
    researchFixesNow(): FixesOfResearch | null {
        const rid = this.fixesResearchId();
        if (!rid || !onComputer()) return null;
        if (!(lastFeatures.get(rid) ?? []).includes(FIXES_LIST_FEATURE)) return null;
        if (!this.researchLinkAvailable('fixes')) return null;
        return lists.get(rid) ?? null;
    },

    /** The research menu's item ("Tree fixes" with the count of fixes waiting), or null. */
    researchFixesMenuEntry(): { label: string; count?: number; countSr?: string } | null {
        const now = this.researchFixesNow();
        if (!now) return null;
        const f = strings.research.fixes;
        const rid = this.fixesResearchId()!;
        const ids = openedIds(rid);
        const count = now.reply.fixes.filter(x => x.state === 'pending' && !ids.has(x.id)).length;
        return count > 0 ? { label: f.menu, count, countSr: f.menuCountSr(count) } : { label: f.menu };
    },

    // ==================== THE DIALOG ====================

    /** The menu's item: the menu closes, the dialog opens. */
    researchActionFixes(): void {
        this.closeActionsMenu();
        this.showResearchFixesDialog();
    },

    showResearchFixesDialog(): void {
        document.getElementById(FIXES_DIALOG_ID)?.remove();
        const now = this.researchFixesNow();
        if (!now) return;
        const f = strings.research.fixes;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = FIXES_DIALOG_ID;
        overlay.innerHTML = `
            <div class="modal modal--sm research-fixes-modal" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="research-fixes-title">
                <div class="modal-header">
                    <h2 id="research-fixes-title">${esc(f.title)}</h2>
                    <button type="button" class="close-btn" id="research-fixes-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <p class="research-fixes-intro">${esc(f.intro)}</p>
                <div class="research-fixes-body" id="research-fixes-body"></div>
                <div class="buttons research-fixes-foot">
                    <span class="research-fixes-refreshed" id="research-fixes-refreshed"></span>
                    <button type="button" class="secondary" id="research-fixes-close" data-dismiss>${esc(strings.buttons.close)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.clearDialogStack();
        this.pushDialog(FIXES_DIALOG_ID);
        const close = (): void => this.closeResearchFixesDialog();
        overlay.onclick = (e) => {
            if (e.target === overlay) { close(); return; }
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fix-act]');
            if (btn?.dataset.fix) this.runResearchFix(btn.dataset.fix, btn.dataset.fixAct === 'undo' ? 'undo' : 'open');
        };
        (overlay.querySelector('#research-fixes-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#research-fixes-close') as HTMLButtonElement).onclick = close;
        this.renderResearchFixesList();
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        overlay.querySelector<HTMLElement>('[data-fix-act]')?.focus();
        if (!overlay.querySelector('[data-fix-act]')) overlay.querySelector<HTMLElement>('#research-fixes-close')?.focus();
        // Opening asks the research again (it may have changed since its last state).
        const rid = this.fixesResearchId();
        if (rid) void this.readResearchFixes(rid);
    },

    /** The list in the open dialog, from the last list and what was opened from here. */
    renderResearchFixesList(): void {
        const body = document.getElementById('research-fixes-body');
        if (!body) return;
        const now = this.researchFixesNow();
        const rid = this.fixesResearchId();
        if (!now || !rid) {
            this.closeResearchFixesDialog();
            return;
        }
        const f = strings.research.fixes;
        const lang = getCurrentLanguage();
        const rows = fixRows(now.reply, openedIds(rid));
        const hadFocus = (document.activeElement as HTMLElement | null)?.closest('[data-fix]')?.getAttribute('data-fix') ?? null;
        const empty = fixesEmpty(now.reply) ? `<p class="research-fixes-empty">${esc(f.empty)}</p>` : '';
        body.innerHTML = empty + (rows.length
            ? `<ul class="research-fixes-list">${rows.map(row => this.researchFixRowHtml(row, lang)).join('')}</ul>` : '');
        const refreshed = document.getElementById('research-fixes-refreshed');
        if (refreshed) refreshed.textContent = f.refreshed(formatLiveClock(now.at, Date.now(), lang));
        // The row that had focus keeps it (its button may be gone: then the row's own text).
        if (hadFocus) {
            const row = body.querySelector<HTMLElement>(`[data-fix="${CSS.escape(hadFocus)}"]`);
            (row?.querySelector<HTMLElement>('[data-fix-act]') ?? document.getElementById('research-fixes-close'))?.focus();
        }
    },

    researchFixRowHtml(row: FixRow, lang: string): string {
        const f = strings.research.fixes;
        const { fix, view, action } = row;
        const title = fixText(fix.title, lang);
        const summary = fixText(fix.summary, lang);
        const count = fix.count > 0 ? f.count(fix.unit, fix.count) : '';
        const date = shortDate(fix.at, lang);
        const state = view === 'available' ? f.stateAvailable
            : view === 'opened' ? f.statePending
            : view === 'applied' ? f.stateApplied(date)
            : view === 'undone' ? f.stateUndone(date)
            : f.stateDeclined(date);
        const label = action === 'undo' ? f.undo : f.open;
        // A fix that reads images again with the agent costs: the AI label before the mark (not for an undo).
        const ai = fix.paid && action === 'open';
        const button = action
            ? `<button type="button" class="secondary research-fix-action" data-fix="${esc(fix.id)}" data-fix-act="${action}">${researchOpenLabel(label, { ai })}</button>`
            : '';
        return `<li class="research-fix" data-fix="${esc(fix.id)}" data-view="${view}">`
            + '<div class="research-fix-main">'
            + `<div class="research-fix-head"><span class="research-fix-title">${esc(title)}</span>`
            + (count ? `<span class="research-fix-count">${esc(count)}</span>` : '') + '</div>'
            + (summary ? `<p class="research-fix-summary">${esc(summary)}</p>` : '')
            + `<div class="research-fix-state is-${view}">${esc(state)}</div>`
            + '</div>' + button + '</li>';
    },

    /** "Open in the research" / "Undo in the research": the research's terminal at that fix; the row waits for its answer. */
    runResearchFix(id: string, what: 'open' | 'undo'): void {
        const rid = this.fixesResearchId();
        const now = this.researchFixesNow();
        if (!rid || !now) return;
        const url = this.activeResearchLink('fixes', what === 'undo' ? { fix: id, fixDo: 'undo' } : { fix: id });
        if (!url) return;
        const mine = opened.get(rid) ?? { rev: now.reply.rev, ids: new Set<string>() };
        mine.ids.add(id);
        opened.set(rid, mine);
        this.launchResearchLink(url);
        this.fixesChanged();
    },

    closeResearchFixesDialog(): void {
        document.getElementById(FIXES_DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== FIXES_DIALOG_ID);
    },
});
