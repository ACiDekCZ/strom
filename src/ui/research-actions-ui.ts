/**
 * The research's actions from the app — a Strom Research tree, on a
 * computer: the ⋯ "Research" submenu, the person menu's "Research ›", the
 * "Review again" dialog and "Find a source in the research".
 * Every action is a strom-research:// link the research announced (see
 * research-ui.ts, section F); the work itself happens in the research, which
 * asks the user there before it writes or spends anything.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatLiveClock } from '../live-time.js';
import { PersonId, PartnershipId } from '../types.js';
import { yearOf } from '../dates.js';
import { RESEARCH_LINK_ACTIONS, ResearchReviewScope, ResearchStoryDo, researchPersonRef } from '../research-link.js';
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
    /** A quiet second line ("sent 11:20"). */
    sub?: string;
}

/** An intake older than this can no longer be taken back from the app. */
const UNDO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function submenuItemHtml(item: SubmenuItem): string {
    const r = strings.research;
    const aria = [item.label];
    if (item.count) aria.push(r.waitingCountSr(item.count));
    if (item.ai) aria.push(r.aiBadge);
    if (item.sub) aria.push(item.sub);
    if (item.ext) aria.push(r.opensInResearchSr);
    return `<div class="tree-switcher-action" id="${item.id}" role="menuitem" tabindex="0"`
        + ` aria-label="${esc(aria.join(', '))}" onclick="${item.run}">`
        + (item.sub
            ? `<span class="research-item-label research-item-label--two"><span>${esc(item.label)}</span><span class="research-item-sub">${esc(item.sub)}</span></span>`
            : `<span class="research-item-label">${esc(item.label)}</span>`)
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
        let updateBlock = '';
        // A research that tells what it has (1.12+): its state on top, sending straight.
        const syncBlock = this.researchSyncBlockHtml();
        const researchId = this.activeResearchId();
        const capable = !!researchId && this.researchSyncCapable(researchId);
        const bridgeUp = capable && !!researchId && this.researchBridgeFresh(researchId);
        const ctx = this.researchSyncLink();
        // Changes go by themselves: no "Send changes" row (the block's "Send now" and its amber actions stand in).
        const autoSend = capable && this.researchAutoOn(ctx?.link);
        // An archive: nothing that leads to an agent.
        const archive = capable && this.activeResearchArchive();
        const sendRow: SubmenuItem[] = autoSend ? [] : [
            // Straight to a running bridge (no ↗); else the research starts it in the terminal.
            { id: 'research-item-send', label: r.sendChanges, run: call('researchActionSend'), ext: !bridgeUp && this.researchLinkAvailable('send') },
        ];
        if (!this.researchAnyAnnounced()) {
            // No strom-research:// links here (an older research, none announced, or
            // switched off): the way back, and what it is. A research that says what
            // it takes still gets its version loaded and its settings for this tree.
            const look: SubmenuItem[] = bridgeUp
                ? [{ id: 'research-item-version', label: r.loadNewVersion, run: call('researchActionLoadVersion') }] : [];
            const tree: SubmenuItem[] = this.researchTranscriptsCapable(researchId ?? undefined)
                ? [{ id: 'research-item-tree-settings', label: strings.sync.treeSettings, run: call('researchActionTreeSettings') }] : [];
            groups = [look, [
                ...sendRow.map(i => ({ ...i, ext: false })),
                { id: 'research-item-about', label: r.whatIs, run: call('researchActionWhatIs') },
            ], tree];
        } else {
            const look: SubmenuItem[] = [];
            if (this.researchLinkAvailable('app') || bridgeUp) look.push({ id: 'research-item-version', label: r.loadNewVersion, run: call('researchActionLoadVersion') });
            if (waiting > 0) look.push({ id: 'research-item-waiting', label: r.waiting, run: call('researchActionWaiting'), count: waiting });
            // Follow live: the research starts (or reuses) its bridge and opens ?live= here (an archive has no agent to follow).
            if (!archive && this.researchLinkAvailable('live') && !this.isFollowingActiveResearch()) {
                look.push({ id: 'research-item-live', label: r.followLive, run: call('researchActionLive'), ext: true });
            }
            if (this.isFollowingActiveResearch()) look.push({ id: 'research-item-overview', label: strings.live.overviewTitle, run: call('researchActionOverview') });
            const known = this.researchWaiting();
            const work: SubmenuItem[] = [...sendRow];
            const intake = known?.lastIntake;
            const sentAt = intake ? Date.parse(intake.at) : NaN;
            // An archive keeps its history itself: taking a send back happens there.
            if (!archive && intake && this.researchLinkAvailable('sync-undo') && Number.isFinite(sentAt) && Date.now() - sentAt < UNDO_MAX_AGE_MS) {
                work.push({ id: 'research-item-undo', label: r.undoSend, run: call('researchActionUndoSend'), ext: true,
                    sub: r.sentAt(formatLiveClock(sentAt, Date.now(), getCurrentLanguage())) });
            }
            const open: SubmenuItem[] = this.researchLinkAvailable('open')
                ? [{ id: 'research-item-open', label: r.openResearch, run: call('researchActionOpen'), ext: true }] : [];
            // An archive: "Open the research" stands on its own (2b).
            if (!archive) work.push(...open);
            const agent: SubmenuItem[] = archive ? open : [];
            if (!archive && this.researchLinkAvailable('chat')) agent.push({ id: 'research-item-chat', label: r.continueAgent, run: call('researchActionChat'), ext: true, ai: true });
            const setup: SubmenuItem[] = [];
            if (this.researchTranscriptsCapable(researchId ?? undefined)) {
                setup.push({ id: 'research-item-tree-settings', label: strings.sync.treeSettings, run: call('researchActionTreeSettings') });
            }
            if (this.researchLinkAvailable('setup')) {
                setup.push({ id: 'research-item-setup', label: capable ? r.settingsInResearch : r.settings, run: call('researchActionSetup'), ext: true });
            }
            groups = archive ? [[...look, ...work], agent, setup] : [look, work, agent, setup];
            note = true;
            // A newer research: a block above the rows, its "Update" the only item in it.
            if (known?.update) {
                const canUpdate = this.researchLinkAvailable('update');
                updateBlock = `<div class="research-update-block" id="research-update-block">`
                    + `<div class="research-update-title">${esc(r.updateAvailable(known.update.version))}</div>`
                    + (canUpdate
                        ? `<div class="tree-switcher-action research-update-action" id="research-item-update" role="menuitem" tabindex="0"`
                            + ` aria-label="${esc(`${r.updateAvailable(known.update.version)}, ${r.updateResearch.replace(' ↗', '')}, ${r.opensInResearchSr}`)}"`
                            + ` onclick="${call('researchActionUpdate')}">${esc(r.updateResearch)}</div>`
                        : '')
                    + '</div>';
            }
        }
        const html = syncBlock + updateBlock + groups.filter(g => g.length > 0)
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
        // The state shown should be now's, not the last background ask's.
        this.refreshResearchStateSoon();
    },

    closeActionsResearchSubmenu(): void {
        const wrap = document.getElementById('actions-research-wrap');
        if (!wrap) return;
        wrap.classList.remove('submenu-open');
        document.getElementById('actions-research-row')?.setAttribute('aria-expanded', 'false');
    },

    researchActionLoadVersion(): void {
        this.closeActionsMenu();
        const researchId = this.activeResearchId();
        if (researchId && this.researchSyncCapable(researchId)) {
            void this.researchLoadNewer();
            return;
        }
        const url = this.activeResearchLink('app');
        if (url) this.launchResearchLink(url, 'version');
    },

    researchActionWaiting(): void {
        this.closeActionsMenu();
        this.showResearchWaiting();
    },

    researchActionLive(): void {
        this.closeActionsMenu();
        const url = this.activeResearchLink('live');
        if (url) this.launchResearchLink(url);
    },

    researchActionOverview(): void {
        this.closeActionsMenu();
        this.openResearchOverview();
    },

    /** "Send changes": straight to a running research that tells what it has, else the way there. */
    researchActionSend(): void {
        this.treeActionSendToResearch();
    },

    researchActionOpen(): void {
        this.closeActionsMenu();
        const url = this.activeResearchLink('open');
        if (url) this.launchResearchLink(url);
    },

    researchActionUndoSend(): void {
        this.closeActionsMenu();
        const intake = this.researchWaiting()?.lastIntake;
        const url = intake ? this.activeResearchLink('sync-undo', { intake: intake.id }) : null;
        if (url) this.launchResearchLink(url);
    },

    researchActionUpdate(): void {
        this.closeActionsMenu();
        const url = this.activeResearchLink('update');
        if (url) this.launchResearchLink(url);
    },

    researchActionSetup(): void {
        this.closeActionsMenu();
        const url = this.activeResearchLink('setup');
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
     * The research's actions for the person menu's "Research ›" (after "What
     * the research knows"): a person of a research tree, on a computer, with
     * the links announced. Nothing here changes the app, so it is offered on
     * locked people and read-only trees too.
     */
    personResearchActions(personId: PersonId): PersonMenuAction[] {
        // An archive has no agent: only "What the research knows" stays.
        if (!this.personResearchRef(personId) || this.activeResearchArchive()) return [];
        const r = strings.research;
        const items: PersonMenuAction[] = [];
        if (this.researchLinkAvailable('review')) {
            items.push({ action: 'research-review', label: r.reviewAction });
        }
        if (this.researchLinkAvailable('research')) {
            items.push({ action: 'research-ancestors', label: r.findAncestors, external: true,
                ariaLabel: `${r.findAncestors}, ${r.opensInResearchSr}` });
            items.push({ action: 'research-descendants', label: r.findDescendants, external: true,
                ariaLabel: `${r.findDescendants}, ${r.opensInResearchSr}` });
        }
        // A direction the person already has: say so instead of starting another.
        for (let i = 0; i < items.length; i++) {
            const d = this.personDirection(personId, items[i].action);
            if (!d) continue;
            if (d.state === 'active') {
                items[i] = { ...items[i], external: false, state: r.dirRunning, ariaLabel: `${items[i].label}, ${r.dirRunning}` };
            } else if (this.researchLinkAvailable('direction')) {
                const note = r.dirResumeNote(d.state === 'paused' ? r.dirStatePaused : r.dirStateDone);
                items[i] = { ...items[i], external: true, note, ariaLabel: `${items[i].label}, ${note}, ${r.opensInResearchSr}` };
            }
        }
        if (this.researchLinkAvailable('chat')) {
            items.push({ action: 'research-ask', label: r.askAgent, external: true, badge: 'ai',
                ariaLabel: `${r.askAgent}, ${r.aiBadge}, ${r.opensInResearchSr}` });
        }
        return items;
    },

    runPersonResearchAction(personId: PersonId, action: string): void {
        const person = this.personResearchRef(personId);
        if (!person) return;
        const direction = this.personDirection(personId, action);
        if (direction?.state === 'active') {
            this.openResearchDirection(direction.id);
            return;
        }
        if (direction && this.researchLinkAvailable('direction')) {
            this.runDirection(direction.id, 'resume');
            return;
        }
        if (action === 'research-review') {
            this.showResearchReviewDialog(personId);
        } else if (action === 'research-ancestors' || action === 'research-descendants') {
            const direction = action === 'research-ancestors' ? 'ancestors' : 'descendants';
            const url = this.activeResearchLink('research', { person, direction });
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

    // ==================== F1: APPROVE A DRAFT STORY ====================

    /** "Approve in the research ↗" for a person's draft story, or null (not a draft, not offered). */
    storyApproveUrl(personId: PersonId): string | null {
        if (DataManager.getPerson(personId)?.story?.status !== 'draft') return null;
        const person = this.personResearchRef(personId);
        return person ? this.activeResearchLink('story', { person }) : null;
    },

    /**
     * A person's approved story has a new version waiting: "take the new one"
     * (final) or "keep the original" (keep) in the research, or null.
     */
    storyDraftUrl(personId: PersonId, how: ResearchStoryDo): string | null {
        if (!DataManager.getPerson(personId)?.story?.draft) return null;
        const person = this.personResearchRef(personId);
        return person ? this.activeResearchLink('story', { person, storyDo: how }) : null;
    },

    /** The same for a couple's story: the research finds the family by both partners. */
    coupleStoryDraftUrl(partnershipId: PartnershipId, how: ResearchStoryDo): string | null {
        const u = DataManager.getPartnership(partnershipId);
        if (!u?.story?.draft) return null;
        const person = this.personResearchRef(u.person1Id);
        const partner = this.personResearchRef(u.person2Id);
        return person && partner ? this.activeResearchLink('story', { person, partner, storyDo: how }) : null;
    },

    // ==================== PERSON SOURCES: FIND A SOURCE ====================

    /** "Find a source in the research ↗" for a person without sources (null: not offered). */
    personFindSourceUrl(personId: PersonId): string | null {
        if (this.activeResearchArchive()) return null;
        const person = this.personResearchRef(personId);
        return person ? this.activeResearchLink('review', { person, scope: 'person' }) : null;
    },
});
