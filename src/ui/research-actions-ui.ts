/**
 * The research's actions from the app — a Strom Research tree, on a
 * computer: the toolbar's Research menu (and its group in the More sheet), the
 * "Export all" reminder in Actions / More, the person menu's "Research ›", the
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
import { researchSendMode } from './research-sync-ui.js';
import { researchTrialTagHtml } from './research-tree-settings-ui.js';
import { researchSendPreviewSkipped, exportReminderDue, lastExportAll, noteExportReminderShown } from '../research-device.js';
import { exportDate } from './snapshots-ui.js';

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

/** One item of the research menu. */
interface SubmenuItem {
    id: string;
    label: string;
    /** The UI method it runs, with its string arguments. */
    method: string;
    args?: string[];
    /** Continues in the research (↗). */
    ext?: boolean;
    /** Starts an AI agent (costs): the AI label. */
    ai?: boolean;
    /** A count at the end ("Awaiting action  2"). */
    count?: number;
    /** A quiet second line ("sent 11:20"). */
    sub?: string;
}

/** A group of the research menu; the occasional ones are drawn quieter. */
interface MenuGroup { items: SubmenuItem[]; quiet?: boolean }

/** The research menu's content: the toolbar dropdown and the More sheet's page draw it alike. */
interface ResearchMenuModel {
    /** The tree is tied to a research: the title with "trial" (and "archive"). */
    heading: boolean;
    archive: boolean;
    syncBlock: string;
    /** Following live: one line in place of the state block (the tree is locked meanwhile). */
    following: boolean;
    updateBlock: string;
    groups: MenuGroup[];
    note: string;
    waiting: number;
}

/** A row of the More sheet's research group. */
export interface ResearchSheetRow {
    label: string;
    run: () => void;
    count?: number;
    ai?: boolean;
    ext?: boolean;
    ariaLabel: string;
}

/** The More sheet's research group (a narrow window with a mouse): the state in one line and the frequent actions. */
export interface ResearchSheetGroup {
    /** The state, when its block offers something: its title and first action. */
    state?: { tone: string; title: string; action: { label: string; asLink: boolean; run: () => void } };
    rows: ResearchSheetRow[];
}

/** The signal on the Research button: a waiting count, a dot for attention, a dot for changes not sent. */
export type ResearchMenuSignal = '' | 'count' | 'attention' | 'unsent';

/** An intake older than this can no longer be taken back from the app. */
const UNDO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Actions of the state block that stand for "Send changes" (the row then goes). */
const BLOCK_SENDS = ['send', 'startAndSend', 'showChangesFirst'];

const call = (method: string, arg = ''): string => `window.Strom.UI.${method}(${arg})`;

function itemCall(item: SubmenuItem): string {
    return call(item.method, (item.args ?? []).map(a => `'${a}'`).join(', '));
}

/** An item's accessible name: label (with its count: "Awaiting action: 2"), AI, second line, ↗. */
function itemAria(item: SubmenuItem): string {
    const r = strings.research;
    const aria = [item.count ? r.waitingCountSr(item.count) : item.label];
    if (item.ai) aria.push(r.aiBadge);
    if (item.sub) aria.push(item.sub);
    if (item.ext) aria.push(r.opensInResearchSr);
    return aria.join(', ');
}

function submenuItemHtml(item: SubmenuItem): string {
    const r = strings.research;
    return `<div class="tree-switcher-action" id="${item.id}" role="menuitem" tabindex="0"`
        + ` aria-label="${esc(itemAria(item))}" onclick="${itemCall(item)}">`
        + (item.sub
            ? `<span class="research-item-label research-item-label--two"><span>${esc(item.label)}</span><span class="research-item-sub">${esc(item.sub)}</span></span>`
            : `<span class="research-item-label">${esc(item.label)}</span>`)
        + (item.count ? `<span class="tree-switcher-badge research-count-badge" aria-hidden="true">${item.count}</span>` : '')
        + (item.ai ? `<span class="research-ai-badge" title="${esc(r.aiCostHint)}" aria-hidden="true">${esc(r.aiBadge)}</span>` : '')
        + (item.ext ? '<span class="research-item-ext" aria-hidden="true">↗</span>' : '')
        + '</div>';
}

const SEPARATOR = '<div class="tree-switcher-divider" role="separator"></div>';

const CHEVRON = '<svg class="research-menu-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

/**
 * The export reminder counted as shown in this opening of a menu (Actions,
 * More): it stays until that menu closes, though a refresh redraws it.
 */
let reminderThisOpening = false;

/** Where focus goes back when the research menu closes by Escape: the toolbar pill that opened it, else the button. */
let menuOpener: HTMLElement | null = null;

/** The More sheet's research page is showing (the menu is drawn there, not in the dropdown). */
function sheetResearchBody(): HTMLElement | null {
    const body = document.getElementById('research-sheet-menu');
    return body && !body.closest('[hidden]') ? body : null;
}

/** The first or last item of a research menu, the title's own controls left out of "first". */
function menuItems(menu: HTMLElement): HTMLElement[] {
    return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .filter(el => el.getClientRects().length > 0 && !(el as HTMLButtonElement).disabled);
}

export const researchActionsMethods = uiModule({
    // ==================== THE RESEARCH MENU ====================

    /** The Research button and menu: a research tree on a computer, its data not locked. */
    researchMenuShown(): boolean {
        return onComputer() && !DataManager.isLocked() && this.activeResearchId() !== null;
    },

    /** The research on this computer announced at least one link (and it is not switched off). */
    researchAnyAnnounced(): boolean {
        return RESEARCH_LINK_ACTIONS.some(a => this.researchLinkAvailable(a));
    },

    /** Tasks waiting for the user, as the menu counts them (0 when the menu is not shown). */
    researchWaitingCount(): number {
        if (!this.researchMenuShown() || !this.researchAnyAnnounced()) return 0;
        // Its bridge not known here: what it once said is waiting is not shown as now.
        if (!this.activeResearchModeKnown()) return 0;
        return this.researchWaiting()?.items.length ?? 0;
    },

    /** What the research menu holds now (the conditions of every item). */
    researchMenuModel(): ResearchMenuModel {
        const r = strings.research;
        const waiting = this.researchWaitingCount();
        const block = this.researchSyncBlockData();
        // A research that tells what it has (1.12+): its state on top, sending straight.
        const syncBlock = block ? this.researchSyncBlockHtml(block) : '';
        // The block itself offers "Load new version" then: not again as a row under it.
        const blockLoads = block?.kind === 'newer';
        // The block offers the send ("Send", "Start and send", "What will be sent"): no "Send changes" row beside it.
        const blockSends = !!block && block.actions.some(a => BLOCK_SENDS.includes(a.action));
        const researchId = this.activeResearchId();
        const capable = !!researchId && this.researchSyncCapable(researchId);
        const bridgeUp = capable && !!researchId && this.researchBridgeFresh(researchId);
        const ctx = this.researchSyncLink();
        // Changes go by themselves: no "Send changes" row (the block's "Send now" and its amber actions stand in).
        const autoSend = capable && this.researchAutoOn(ctx?.link);
        // An archive: nothing that leads to an agent.
        const archive = capable && this.activeResearchArchive();
        // Nothing that leads to an agent in an archive, nor while the research's mode is not known here.
        const noAgent = archive || !this.activeResearchModeKnown();
        // Only loading from the research: nothing to send, no row for it.
        const sendOff = capable && !!ctx && researchSendMode(ctx.link) === 'off';
        // "Send changes…" opens "What will be sent" first; without the preview it sends at once (no dots).
        const previewFirst = capable && !!ctx && (!!ctx.link.previewDue || !researchSendPreviewSkipped(ctx.treeId));
        const sendRow: SubmenuItem[] = autoSend || sendOff || blockSends ? [] : [
            // Straight to a running bridge (no ↗); else the research starts it in the terminal.
            { id: 'research-item-send', label: previewFirst ? `${r.sendChanges}…` : r.sendChanges, method: 'researchActionSend', ext: !bridgeUp && this.researchLinkAvailable('send') },
        ];
        const treeSettings: SubmenuItem[] = this.researchTranscriptsCapable(researchId ?? undefined)
            ? [{ id: 'research-item-tree-settings', label: strings.sync.treeSettings, method: 'researchActionTreeSettings' }] : [];
        const batch: SubmenuItem[] = this.batchAvailable() ? [{ id: 'research-item-batch', label: strings.batch.menu, method: 'showBatchDialog' }] : [];
        let groups: MenuGroup[];
        let note = '';
        let updateBlock = '';
        if (!this.researchAnyAnnounced()) {
            // No strom-research:// links here (an older research, none announced, or
            // switched off): the way back, and what it is. A research that says what
            // it takes still gets its version loaded and its settings for this tree.
            groups = [
                { items: [...sendRow.map(i => ({ ...i, ext: false })), ...batch] },
                { items: [...treeSettings, { id: 'research-item-about', label: r.whatIs, method: 'researchActionWhatIs' }], quiet: true },
            ];
        } else {
            // Frequent: what waits, the agent, the research itself, the send.
            const frequent: SubmenuItem[] = [];
            if (waiting > 0) frequent.push({ id: 'research-item-waiting', label: r.waiting, method: 'researchActionWaiting', count: waiting });
            if (!noAgent && this.researchLinkAvailable('chat')) frequent.push({ id: 'research-item-chat', label: r.continueAgent, method: 'researchActionChat', ext: true, ai: true });
            if (this.researchLinkAvailable('open')) frequent.push({ id: 'research-item-open', label: r.openResearch, method: 'researchActionOpen', ext: true });
            frequent.push(...sendRow);
            // Now and then: a version to load, following live, materials.
            const middle: SubmenuItem[] = [];
            // The bridge answering: the block above offers a newer version when there is one (never beside "in step").
            if (this.researchLinkAvailable('app') && !bridgeUp && !blockLoads) middle.push({ id: 'research-item-version', label: r.loadNewVersion, method: 'researchActionLoadVersion' });
            // Follow live: the research starts (or reuses) its bridge and opens ?live= here (an archive has no agent to follow).
            if (!noAgent && this.researchLinkAvailable('live') && !this.isFollowingActiveResearch()) {
                middle.push({ id: 'research-item-live', label: r.followLive, method: 'researchActionLive', ext: true });
            }
            if (this.isFollowingActiveResearch()) middle.push({ id: 'research-item-overview', label: strings.live.overviewTitle, method: 'researchActionOverview' });
            middle.push(...batch);
            // Occasional: the ways back, the settings.
            const occasional: SubmenuItem[] = [];
            // "Restore the state before loading" until the next edit (or 7 days); its first hour is the block above.
            const loadBackup = ctx ? this.researchLoadBackup(ctx.treeId) : null;
            if (loadBackup && this.currentResearchSyncState().kind !== 'loaded') {
                occasional.push({ id: 'research-item-restore', label: strings.sync.restoreBeforeLoad, method: 'researchSyncAction', args: ['restoreBeforeLoad'],
                    sub: strings.sync.loadedAt(formatLiveClock(Date.parse(loadBackup.at), Date.now(), getCurrentLanguage())) });
            }
            const known = this.researchWaiting();
            const intake = known?.lastIntake;
            const sentAt = intake ? Date.parse(intake.at) : NaN;
            // Taking the last send back is the user's (an archive too); not while the research's mode is not known here.
            if ((archive || !noAgent) && intake && this.researchLinkAvailable('sync-undo') && Number.isFinite(sentAt) && Date.now() - sentAt < UNDO_MAX_AGE_MS) {
                occasional.push({ id: 'research-item-undo', label: r.undoSend, method: 'researchActionUndoSend', ext: true,
                    sub: r.sentAt(formatLiveClock(sentAt, Date.now(), getCurrentLanguage())) });
            }
            occasional.push(...treeSettings);
            if (this.researchLinkAvailable('setup')) {
                occasional.push({ id: 'research-item-setup', label: capable ? r.settingsInResearch : r.settings, method: 'researchActionSetup', ext: true });
            }
            groups = [{ items: frequent }, { items: middle }, { items: occasional, quiet: true }];
            note = archive ? r.submenuNoteArchive : r.submenuNote;
            // A newer research: one framed line under the state, "Update ↗" the item in it.
            if (known?.update) {
                const canUpdate = this.researchLinkAvailable('update');
                updateBlock = `<div class="research-update-block" id="research-update-block">`
                    + `<span class="research-update-title">${esc(r.updateAvailable(known.update.version))}</span>`
                    + (canUpdate
                        ? `<button type="button" class="research-update-action" id="research-item-update" role="menuitem"`
                            + ` aria-label="${esc(`${r.updateAvailable(known.update.version)}, ${r.updateResearch.replace(' ↗', '')}, ${r.opensInResearchSr}`)}"`
                            + ` onclick="${call('researchActionUpdate')}">${esc(r.updateResearch)}</button>`
                        : '')
                    + '</div>';
            }
        }
        // An older research (it never said what it takes): a quiet line, "How to update…", in the same place.
        const olderLine = updateBlock ? '' : this.researchOlderLineHtml('menu');
        if (olderLine) updateBlock = `<div class="research-update-block research-older-block" id="research-older-block">${olderLine}</div>`;
        return {
            heading: !!ctx, archive, syncBlock, updateBlock, groups, note, waiting,
            following: !syncBlock && DataManager.isLiveFollowing(),
        };
    },

    /** The research menu's HTML; on the More sheet's page its title carries "‹" back. */
    researchMenuHtml(model: ResearchMenuModel, opts: { back?: boolean } = {}): string {
        const r = strings.research;
        const heading = model.heading || opts.back
            ? '<div class="research-menu-heading">'
                + (opts.back ? `<button type="button" class="research-menu-back" role="menuitem" aria-label="${esc(strings.contextMenu.back)}"><span aria-hidden="true">‹</span></button>` : '')
                + `<span class="research-menu-title" id="research-menu-title">${esc(r.menuTitle)}</span>`
                + (model.heading ? researchTrialTagHtml(true) : '')
                + (model.archive ? `<span class="research-sync-tag" id="research-menu-archive">${esc(strings.sync.archiveTag)}</span>` : '')
                + '</div>'
            : '';
        const following = model.following
            ? `<div class="research-menu-following" id="research-menu-following"><span class="research-menu-live-dot" aria-hidden="true"></span><span>${esc(r.followingLocked)}</span></div>`
            : '';
        const groups = model.groups.filter(g => g.items.length > 0)
            .map(g => `<div class="research-menu-group${g.quiet ? ' is-quiet' : ''}" role="group">${g.items.map(submenuItemHtml).join('')}</div>`)
            .join(SEPARATOR);
        const note = model.note ? `${SEPARATOR}<div class="research-submenu-note">${esc(model.note)}</div>` : '';
        return heading + model.syncBlock + following + model.updateBlock + groups + note;
    },

    /**
     * Show or hide the Research button, paint its signal and (re)build the
     * menu — in the toolbar dropdown, or on the More sheet's page while that
     * shows (one place only: the items carry ids). Returns the button's signal.
     */
    refreshResearchMenu(): ResearchMenuSignal {
        const shown = this.researchMenuShown();
        // The "AI ancestor research" entry gives way to the Research button.
        document.body.classList.toggle('research-actions', shown);
        this.ensureResearchMenuButton(shown);
        if (!shown) return '';
        const model = this.researchMenuModel();
        const signal = this.paintResearchMenuButton(model.waiting);
        const sheet = sheetResearchBody();
        const dropdown = document.getElementById('research-menu');
        const target = sheet ?? dropdown;
        const other = sheet ? dropdown : document.getElementById('research-sheet-menu');
        if (other?.dataset.html) {
            other.innerHTML = '';
            other.dataset.html = '';
        }
        const html = this.researchMenuHtml(model, { back: !!sheet });
        // Rebuilt only when it changed: a redraw would drop keyboard focus.
        if (target && target.dataset.html !== html) {
            target.innerHTML = html;
            target.dataset.html = html;
            if (target === dropdown && this.isResearchMenuOpen()) this.positionResearchMenu();
        }
        return signal;
    },

    /** The Research button left of Actions: built while a research tree is open, gone otherwise. */
    ensureResearchMenuButton(shown: boolean): void {
        let wrap = document.getElementById('research-menu-wrap');
        if (!shown) {
            if (wrap) {
                this.closeResearchMenu();
                wrap.remove();
            }
            return;
        }
        if (wrap) return;
        const actions = document.querySelector('.toolbar .actions-menu');
        if (!actions?.parentElement) return;
        wrap = document.createElement('div');
        wrap.id = 'research-menu-wrap';
        wrap.className = 'research-menu-wrap desktop-only';
        wrap.innerHTML = '<button type="button" class="secondary research-menu-btn" id="research-menu-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="research-menu">'
            + '<span class="research-menu-live" aria-hidden="true"></span>'
            + `<span class="research-menu-label">${esc(strings.research.menuTitle)}</span>`
            + '<span class="research-menu-signal" id="research-menu-signal" aria-hidden="true" hidden></span>'
            + CHEVRON + '</button>'
            + '<div id="research-menu" class="tree-switcher-dropdown research-menu-dropdown research-menu-body" role="menu" aria-labelledby="research-menu-title"></div>';
        actions.parentElement.insertBefore(wrap, actions);
        const btn = wrap.querySelector<HTMLButtonElement>('#research-menu-btn')!;
        const menu = wrap.querySelector<HTMLElement>('#research-menu')!;
        btn.addEventListener('click', () => this.toggleResearchMenu());
        // Enter / Space / ↓ open it with focus on the first item (↑: the last).
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            if (!this.isResearchMenuOpen()) this.openResearchMenu();
            this.focusResearchMenuItem(e.key === 'ArrowUp' ? 'last' : 'first');
        });
        // (Space would click again on its release.)
        btn.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });
        // An item done closes the menu (its own action may have opened a dialog already).
        menu.addEventListener('click', (e) => {
            const item = (e.target as Element | null)?.closest('[role="menuitem"]');
            if (!item || item.matches('.research-trial-tag, [data-action="cancelLoad"], [data-action="conflicts"]')) return;
            if (this.isResearchMenuOpen()) this.closeResearchMenu();
        });
        // Tab out of it: the menu closes, focus goes on in the toolbar.
        wrap.addEventListener('focusout', (e) => {
            const next = e.relatedTarget as Node | null;
            if (!next || wrap!.contains(next) || document.getElementById('research-trial-note')?.contains(next)) return;
            if (this.isResearchMenuOpen()) this.closeResearchMenu();
        });
    },

    /** The button's name and signal: a count, else one dot (attention before changes not sent); a green dot while following live. */
    paintResearchMenuButton(waiting: number): ResearchMenuSignal {
        const r = strings.research;
        const unsent = this.researchSyncUnsentNow();
        const signal: ResearchMenuSignal = waiting > 0 ? 'count' : this.researchSyncAttention() ? 'attention' : unsent.dot ? 'unsent' : '';
        const btn = document.getElementById('research-menu-btn');
        if (!btn) return signal;
        const sig = document.getElementById('research-menu-signal');
        if (sig) {
            sig.hidden = signal === '';
            sig.dataset.signal = signal;
            sig.textContent = signal === 'count' ? String(waiting) : '';
        }
        const label = btn.querySelector('.research-menu-label');
        if (label) label.textContent = r.menuTitle;
        btn.classList.toggle('is-live', DataManager.isLiveFollowing());
        btn.setAttribute('aria-label', waiting > 0 ? r.menuButtonAriaWaiting(waiting) : unsent.label ? r.menuButtonAriaUnsent : r.menuTitle);
        return signal;
    },

    isResearchMenuOpen(): boolean {
        return !!document.getElementById('research-menu')?.classList.contains('active');
    },

    toggleResearchMenu(): void {
        if (this.isResearchMenuOpen()) this.closeResearchMenu();
        else this.openResearchMenu();
    },

    /**
     * Open the research menu under its button. Where the button has no room
     * (≤ 1024 px), the More sheet opens on its research page instead.
     * `opener`: where focus goes back on Escape (the toolbar pill).
     */
    openResearchMenu(opts: { opener?: HTMLElement | null; focus?: 'first' | 'last' } = {}): void {
        if (!this.researchMenuShown()) return;
        const btn = document.getElementById('research-menu-btn');
        const menu = document.getElementById('research-menu');
        if (!btn || !menu || btn.getClientRects().length === 0) {
            this.showMoreMenuSheet({ research: true });
            return;
        }
        this.closeAllMenusExcept('research');
        this.hideWhatsNewCard();
        menuOpener = opts.opener ?? null;
        menu.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('is-open');
        this.refreshResearchMenu();
        this.positionResearchMenu();
        // The state shown should be now's, not the last background ask's.
        this.refreshResearchStateSoon();
        if (opts.focus) this.focusResearchMenuItem(opts.focus);
    },

    /** Close the research menu (and the More sheet on its research page); `restoreFocus`: back to what opened it. */
    closeResearchMenu(restoreFocus = false): void {
        const menu = document.getElementById('research-menu');
        const btn = document.getElementById('research-menu-btn');
        const wasOpen = !!menu?.classList.contains('active');
        if (wasOpen) {
            menu!.classList.remove('active');
            btn?.setAttribute('aria-expanded', 'false');
            btn?.classList.remove('is-open');
            this.closeResearchTrialNote();
        }
        // An action on the More sheet's research page closes the sheet too.
        if (sheetResearchBody()) this.hideBottomSheet();
        const opener = menuOpener;
        menuOpener = null;
        if (restoreFocus && wasOpen) {
            const to = opener?.isConnected && opener.getClientRects().length > 0 ? opener : btn;
            to?.focus();
        }
    },

    /** Focus the first item (the state block's button, else the first row) or the last one. */
    focusResearchMenuItem(which: 'first' | 'last'): void {
        const menu = sheetResearchBody() ?? document.getElementById('research-menu');
        if (!menu) return;
        const items = menuItems(menu);
        const body = items.filter(el => !el.closest('.research-menu-heading'));
        const to = which === 'first' ? body[0] ?? items[0] : items[items.length - 1];
        to?.focus();
    },

    /** Under its button, right edges level; moved into the window when it would leave it; scrolls when too tall. */
    positionResearchMenu(): void {
        const menu = document.getElementById('research-menu');
        if (!menu?.classList.contains('active')) return;
        menu.style.right = '0px';
        menu.style.maxHeight = '';
        const viewportW = document.documentElement.clientWidth || window.innerWidth;
        const top = menu.getBoundingClientRect().top;
        menu.style.maxHeight = `${Math.max(160, window.innerHeight - top - 8)}px`;
        const rect = menu.getBoundingClientRect();
        if (rect.left < 8) menu.style.right = `${rect.left - 8}px`;
        else if (rect.right > viewportW - 8) menu.style.right = `${rect.right - (viewportW - 8)}px`;
    },

    /** The More sheet's research group, or null (not a research tree on a computer). */
    researchSheetGroup(): ResearchSheetGroup | null {
        if (!this.researchMenuShown()) return null;
        const model = this.researchMenuModel();
        const frequent = new Set(['research-item-waiting', 'research-item-chat', 'research-item-open']);
        const ui = this as unknown as Record<string, (...args: string[]) => void>;
        const rows: ResearchSheetRow[] = model.groups.flatMap(g => g.items).filter(i => frequent.has(i.id)).map(i => ({
            label: i.label, count: i.count, ai: i.ai, ext: i.ext, ariaLabel: itemAria(i),
            run: () => ui[i.method](...(i.args ?? [])),
        }));
        const block = this.researchSyncBlockData();
        const first = block?.actions[0];
        return {
            rows,
            state: block && first ? { tone: block.tone, title: block.title,
                action: { label: first.label, asLink: !!first.asLink, run: () => this.researchSyncAction(first.action) } } : undefined,
        };
    },

    // ==================== "EXPORT ALL" REMINDER (Actions, More) ====================

    /** The last export of all trees for the reminder (null: never), or undefined when it is not shown now. */
    exportReminderLast(): string | null | undefined {
        if (!this.researchSyncLink() || DataManager.isReadOnly()) return undefined;
        return exportReminderDue() || reminderThisOpening ? lastExportAll() : undefined;
    },

    /** Its quiet line: when all trees were last exported, or that they never were. */
    exportReminderText(last: string | null): string {
        return last ? strings.snapshots.exportLast(exportDate(last)) : strings.snapshots.exportNever;
    },

    /** A menu opened with the reminder in it: shown for today (once per opening). */
    exportReminderOpened(): void {
        if (reminderThisOpening) return;
        reminderThisOpening = true;
        noteExportReminderShown();
    },

    exportReminderClosed(): void {
        reminderThisOpening = false;
    },

    /** Actions → under Export…: the reminder line with its "Export all" link. Returns whether it shows. */
    renderActionsExportReminder(): boolean {
        const el = document.getElementById('actions-export-reminder');
        if (!el) return false;
        const last = this.exportReminderLast();
        el.hidden = last === undefined;
        if (last === undefined) {
            el.replaceChildren();
            el.dataset.html = '';
            return false;
        }
        const html = `<span class="export-reminder-text">${esc(this.exportReminderText(last))}</span>`
            + `<button type="button" class="link-button export-reminder-link" id="actions-export-all" role="menuitem" onclick="${call('researchActionExportAll')}">${esc(strings.snapshots.exportAll)}</button>`;
        if (el.dataset.html !== html) {
            el.innerHTML = html;
            el.dataset.html = html;
        }
        return true;
    },

    /** "Export all" (the reminder): it rests three weeks, the Export all dialog opens. */
    researchActionExportAll(): void {
        noteExportReminderShown(true);
        this.closeActionsMenu();
        this.hideBottomSheet();
        this.showExportAllDialog();
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
        if (!this.personResearchRef(personId) || this.activeResearchNoAgent()) return [];
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
        if (this.activeResearchNoAgent()) return null;
        const person = this.personResearchRef(personId);
        return person ? this.activeResearchLink('review', { person, scope: 'person' }) : null;
    },
});
