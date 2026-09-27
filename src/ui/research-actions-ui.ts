/**
 * The research's actions from the app — a Strom Research tree, on a
 * computer: the ⋯ "Research" submenu, the person menu's "In the research"
 * section, the "Review again" dialog and "Find a source in the research".
 * Every action is a strom-research:// link the research announced (see
 * research-ui.ts, section F); the work itself happens in the research, which
 * asks the user there before it writes or spends anything.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { PersonId } from '../types.js';
import { yearOf } from '../dates.js';
import { RESEARCH_LINK_ACTIONS, ResearchReviewScope, researchPersonRef } from '../research-link.js';
import { uiModule } from './module.js';
import { onComputer } from './research-ui.js';
import { PersonMenuAction } from './context-menu.js';
import { personSubtitle } from './person-sources-ui.js';
import { normalizeModal } from './modal-skeleton.js';

const REVIEW_ID = 'research-review-modal';
const SCOPE_KEY = 'strom-research-review-scope';
const SCOPES: ResearchReviewScope[] = ['person', 'family', 'line'];

/** HTML-escape a string for innerHTML (text and attribute values). */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function rememberedScope(): ResearchReviewScope {
    try {
        const v = localStorage.getItem(SCOPE_KEY);
        return SCOPES.includes(v as ResearchReviewScope) ? v as ResearchReviewScope : 'person';
    } catch {
        return 'person';
    }
}

function rememberScope(scope: ResearchReviewScope): void {
    try { localStorage.setItem(SCOPE_KEY, scope); } catch { /* not remembered */ }
}

/** The research's own rule: born less than 100 years ago and not known to have died. */
function mayBeLiving(personId: PersonId): boolean {
    const p = DataManager.getPerson(personId);
    if (!p || p.isDeceased === true || p.deathDate) return false;
    if (p.isDeceased === false) return true;
    const born = yearOf(p.birthDate);
    return born !== null && new Date().getFullYear() - born < 100;
}

/** One row of the "Research" submenu. */
interface SubmenuItem {
    id: string;
    label: string;
    run: string;
    /** Continues in the research (↗). */
    ext?: boolean;
    /** Starts an AI agent (costs): the AI label. */
    ai?: boolean;
    /** A count at the end ("Waiting for you  2"). */
    count?: number;
}

function submenuItemHtml(item: SubmenuItem): string {
    const r = strings.research;
    const aria = [item.label];
    if (item.count) aria.push(r.waitingCountSr(item.count));
    if (item.ai) aria.push(r.aiBadge);
    if (item.ext) aria.push(r.opensInResearchSr);
    return `<div class="tree-switcher-action" id="${item.id}" role="menuitem" tabindex="0"`
        + ` aria-label="${esc(aria.join(', '))}" onclick="${item.run}">`
        + `<span class="research-item-label">${esc(item.label)}</span>`
        + (item.count ? `<span class="tree-switcher-badge actions-research-badge" aria-hidden="true">${item.count}</span>` : '')
        + (item.ai ? `<span class="research-ai-badge" title="${esc(r.aiCostHint)}" aria-hidden="true">${esc(r.aiBadge)}</span>` : '')
        + (item.ext ? '<span class="research-item-ext" aria-hidden="true">↗</span>' : '')
        + '</div>';
}

const call = (method: string, arg = ''): string => `window.Strom.UI.${method}(${arg})`;

export const researchActionsMethods = uiModule({
    // ==================== ⋯ → RESEARCH ====================

    /** The "Research" row replaces "AI ancestor research": a research tree, on a computer. */
    researchMenuShown(): boolean {
        return onComputer() && this.activeResearchId() !== null;
    },

    /** The research on this computer announced at least one link (and it is not switched off). */
    researchAnyAnnounced(): boolean {
        return RESEARCH_LINK_ACTIONS.some(a => this.researchLinkAvailable(a));
    },

    /** Tasks waiting for the user, as the menu counts them (0 when the row is hidden). */
    researchWaitingCount(): number {
        if (!this.researchMenuShown() || !this.researchAnyAnnounced()) return 0;
        return this.researchWaiting()?.items.length ?? 0;
    },

    /**
     * Show or hide the "Research" row and (re)build its submenu. Returns the
     * waiting count lit on the row (the ⋯ button's dot follows it).
     */
    refreshResearchMenu(): number {
        const wrap = document.getElementById('actions-research-wrap');
        const shown = this.researchMenuShown();
        document.body.classList.toggle('research-actions', shown);
        if (!wrap) return 0;
        wrap.style.display = shown ? '' : 'none';
        if (!shown) {
            this.closeActionsResearchSubmenu();
            return 0;
        }
        const r = strings.research;
        const waiting = this.researchWaitingCount();
        const badge = document.getElementById('actions-research-badge');
        if (badge) {
            badge.textContent = waiting > 0 ? String(waiting) : '';
            badge.style.display = waiting > 0 ? 'inline-flex' : 'none';
        }
        document.getElementById('actions-research-row')?.setAttribute('aria-label',
            waiting > 0 ? `${r.menuTitle}, ${r.waitingCountSr(waiting)}` : r.menuTitle);

        let groups: SubmenuItem[][];
        let note = false;
        if (!this.researchAnyAnnounced()) {
            // An older research (or the links switched off): the way back, and what it is.
            groups = [[
                { id: 'research-item-send', label: r.sendChanges, run: call('researchActionSend') },
                { id: 'research-item-about', label: r.whatIs, run: call('researchActionWhatIs') },
            ]];
        } else {
            const look: SubmenuItem[] = [];
            if (this.researchLinkAvailable('app')) look.push({ id: 'research-item-version', label: r.loadNewVersion, run: call('researchActionLoadVersion') });
            if (waiting > 0) look.push({ id: 'research-item-waiting', label: r.waiting, run: call('researchActionWaiting'), count: waiting });
            const work: SubmenuItem[] = [
                { id: 'research-item-send', label: r.sendChanges, run: call('researchActionSend'), ext: this.researchLinkAvailable('send') },
            ];
            if (this.researchLinkAvailable('open')) work.push({ id: 'research-item-open', label: r.openResearch, run: call('researchActionOpen'), ext: true });
            const agent: SubmenuItem[] = [];
            if (this.researchLinkAvailable('chat')) agent.push({ id: 'research-item-chat', label: r.continueAgent, run: call('researchActionChat'), ext: true, ai: true });
            groups = [look, work, agent];
            note = true;
        }
        const html = groups.filter(g => g.length > 0)
            .map(g => g.map(submenuItemHtml).join(''))
            .join('<div class="tree-switcher-divider"></div>')
            + (note ? `<div class="tree-switcher-divider"></div><div class="research-submenu-note">${esc(r.submenuNote)}</div>` : '');
        const sub = document.getElementById('actions-research-submenu');
        // Rebuilt only when it changed: a redraw would drop keyboard focus.
        if (sub && sub.dataset.html !== html) {
            sub.innerHTML = html;
            sub.dataset.html = html;
        }
        return waiting;
    },

    toggleActionsResearchSubmenu(): void {
        const wrap = document.getElementById('actions-research-wrap');
        if (!wrap) return;
        if (wrap.classList.contains('submenu-open')) this.closeActionsResearchSubmenu();
        else this.openActionsResearchSubmenu();
    },

    openActionsResearchSubmenu(): void {
        const wrap = document.getElementById('actions-research-wrap');
        if (!wrap) return;
        this.closeActionsTreeSubmenu();
        wrap.classList.add('submenu-open');
        document.getElementById('actions-research-row')?.setAttribute('aria-expanded', 'true');
        this.positionActionsSubmenu('actions-research-submenu');
    },

    closeActionsResearchSubmenu(): void {
        const wrap = document.getElementById('actions-research-wrap');
        if (!wrap) return;
        wrap.classList.remove('submenu-open');
        document.getElementById('actions-research-row')?.setAttribute('aria-expanded', 'false');
    },

    researchActionLoadVersion(): void {
        this.closeActionsMenu();
        const url = this.activeResearchLink('app');
        if (url) this.launchResearchLink(url, 'version');
    },

    researchActionWaiting(): void {
        this.closeActionsMenu();
        this.showResearchWaiting();
    },

    /** "Send changes": one click when the research handles it, else the way there. */
    researchActionSend(): void {
        this.treeActionSendToResearch();
    },

    researchActionOpen(): void {
        this.closeActionsMenu();
        const url = this.activeResearchLink('open');
        if (url) this.launchResearchLink(url);
    },

    researchActionChat(): void {
        this.closeActionsMenu();
        const url = this.activeResearchLink('chat');
        if (url) this.launchResearchLink(url, 'agent');
    },

    researchActionWhatIs(): void {
        this.closeActionsMenu();
        this.showResearchInfoDialog();
    },

    // ==================== PERSON MENU: IN THE RESEARCH ====================

    /** The research's id of a person in the active research tree, when its actions can be offered. */
    personResearchRef(personId: PersonId): string | null {
        if (!onComputer() || this.activeResearchId() === null) return null;
        return researchPersonRef(DataManager.getPerson(personId)?.refn);
    },

    /**
     * "In the research" at the end of the person menu: a person of a research
     * tree, on a computer, with the links announced. Nothing here changes the
     * app, so it is offered on locked people and read-only trees too.
     */
    personResearchActions(personId: PersonId): PersonMenuAction[] {
        if (!this.personResearchRef(personId)) return [];
        const r = strings.research;
        const items: PersonMenuAction[] = [];
        if (this.researchLinkAvailable('review')) {
            items.push({ action: 'research-review', label: r.reviewAction });
        }
        if (this.researchLinkAvailable('research')) {
            items.push({ action: 'research-ancestors', label: r.findAncestors, external: true,
                ariaLabel: `${r.findAncestors}, ${r.opensInResearchSr}` });
        }
        if (this.researchLinkAvailable('chat')) {
            items.push({ action: 'research-ask', label: r.askAgent, external: true, badge: 'ai',
                ariaLabel: `${r.askAgent}, ${r.aiBadge}, ${r.opensInResearchSr}` });
        }
        if (items.length > 0) items[0] = { ...items[0], divider: true, header: r.personSection };
        return items;
    },

    runPersonResearchAction(personId: PersonId, action: string): void {
        const person = this.personResearchRef(personId);
        if (!person) return;
        if (action === 'research-review') {
            this.showResearchReviewDialog(personId);
        } else if (action === 'research-ancestors') {
            const url = this.activeResearchLink('research', { person, direction: 'ancestors' });
            if (url) this.launchResearchLink(url);
        } else if (action === 'research-ask') {
            const url = this.activeResearchLink('chat', { person });
            if (url) this.launchResearchLink(url, 'agent');
        }
    },

    // ==================== "REVIEW AGAIN" ====================

    showResearchReviewDialog(personId: PersonId): void {
        document.getElementById(REVIEW_ID)?.remove();
        if (!this.personResearchRef(personId)) return;
        const r = strings.research;
        const current = rememberedScope();
        const scopes: Array<{ value: ResearchReviewScope; label: string; hint?: string }> = [
            { value: 'person', label: r.scopePerson },
            { value: 'family', label: r.scopeFamily, hint: r.scopeFamilyHint },
            { value: 'line', label: r.scopeLine, hint: r.scopeLineHint },
        ];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = REVIEW_ID;
        overlay.innerHTML = `
            <div class="modal modal--sm research-review-modal" role="dialog" data-dialog-kind="choice" aria-modal="true" aria-labelledby="research-review-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="research-review-title">${esc(r.reviewTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(personSubtitle(personId))}</div>
                    </div>
                    <button type="button" class="close-btn" id="research-review-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <p class="research-review-intro">${esc(r.reviewIntro)}</p>
                <div class="research-review-scopes" role="radiogroup" aria-labelledby="research-review-title">
                    ${scopes.map(sc => `
                        <label class="research-review-scope">
                            <input type="radio" name="research-review-scope" value="${sc.value}"${sc.value === current ? ' checked' : ''}>
                            <span class="research-review-scope-text">
                                <span class="research-review-scope-label">${esc(sc.label)}</span>
                                ${sc.hint ? `<span class="research-review-scope-hint">${esc(sc.hint)}</span>` : ''}
                            </span>
                        </label>`).join('')}
                </div>
                <p class="research-review-where">${esc(r.reviewWhere)}</p>
                ${mayBeLiving(personId) ? `<p class="research-review-living">${esc(r.maybeLiving)}</p>` : ''}
                <div class="buttons">
                    <button type="button" class="secondary" id="research-review-cancel" data-dismiss>${esc(strings.buttons.cancel)}</button>
                    <button type="button" class="primary" id="research-review-submit">${esc(r.reviewSubmit)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.clearDialogStack();
        this.pushDialog(REVIEW_ID);
        const close = (): void => this.closeResearchReviewDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#research-review-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#research-review-cancel') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#research-review-submit') as HTMLButtonElement).onclick = () => {
            const checked = overlay.querySelector<HTMLInputElement>('input[name="research-review-scope"]:checked');
            const scope = SCOPES.includes(checked?.value as ResearchReviewScope) ? checked!.value as ResearchReviewScope : 'person';
            rememberScope(scope);
            const person = this.personResearchRef(personId);
            const url = person ? this.activeResearchLink('review', { person, scope }) : null;
            close();
            if (url) this.launchResearchLink(url);
        };
        // Focus after the skeleton has wrapped the body (moving a node drops focus).
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        overlay.querySelector<HTMLInputElement>('input[name="research-review-scope"]:checked')?.focus();
    },

    closeResearchReviewDialog(): void {
        document.getElementById(REVIEW_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== REVIEW_ID);
    },

    // ==================== PERSON SOURCES: FIND A SOURCE ====================

    /** "Find a source in the research ↗" for a person without sources (null: not offered). */
    personFindSourceUrl(personId: PersonId): string | null {
        const person = this.personResearchRef(personId);
        return person ? this.activeResearchLink('review', { person, scope: 'person' }) : null;
    },
});
