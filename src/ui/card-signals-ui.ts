/**
 * The card's at-a-glance signals outside the card: the badge opens what it
 * signals (desktop), the person menu leads with it (and, on phones and
 * tablets, with the person's status line), and Settings → "Show on card"
 * chooses which signals cards show, with a live preview card.
 */

import { TreeRenderer } from '../renderer.js';
import { SettingsManager, CardSignals, CARD_SIGNAL_KEYS } from '../settings.js';
import { getCurrentLanguage, strings } from '../strings.js';
import { PersonId } from '../types.js';
import { ActionSignal, CardSignalInfo, ACTION_GLYPH, storyFoldHtml, storySignalInLine, storySignalText } from '../card-signals.js';
import { cardStatusWords, statusMarkHtml } from './fact-status.js';
import { groupCrossTreeMatches } from '../cross-tree.js';
import { HELP_TOPICS } from '../help/topics.js';
import { openHelp } from './help-ui.js';
import { TreeManager } from '../tree-manager.js';
import { announcedResearchLinks } from '../research-device.js';
import { researchConflictRef } from '../research-link.js';
import { uiModule } from './module.js';
import { DataManager } from '../data.js';
import { storyWaitingTarget, storyWithDraft } from './story-compare-ui.js';

const STATE_KEYS: (keyof CardSignals)[] = ['status', 'story'];
const ACTION_KEYS: (keyof CardSignals)[] = ['waiting', 'conflict', 'question', 'agent'];
const LINK_KEYS: (keyof CardSignals)[] = ['crossTree'];

function signalLabel(key: keyof CardSignals): string {
    const d = strings.cardDensity;
    return {
        status: d.cardStatus, story: d.cardStory, waiting: d.cardWaiting,
        conflict: d.cardConflict, question: d.cardQuestion, agent: d.cardAgent, crossTree: strings.crossTree.settingLabel,
    }[key];
}

/** The line under a switch that needs one ('' for none). */
function signalSub(key: keyof CardSignals): string {
    const d = strings.cardDensity;
    return key === 'status' ? d.cardStatusSub : key === 'crossTree' ? d.cardCrossTreeSub : '';
}

export const cardSignalsUiMethods = uiModule({
    /** A click on a card's badge (desktop): open what it signals. */
    openCardSignal(personId: PersonId, signal: string): void {
        this.hideContextMenu();
        if (signal === 'waiting' && this.openWaitingStoryCompare(personId)) return;
        if (signal === 'waiting') this.showResearchWaiting();
        else if (signal === 'conflict') {
            // At the first open conflict's card.
            const first = researchConflictRef(this.personOpenConflicts(personId)[0]?.id);
            this.showPersonResearchDialog(personId, first ? { conflict: first } : {});
        }
        else if (signal === 'agent') this.showLiveResearchNow();
        else {
            // The question: the person menu, which leads with it.
            const card = document.querySelector<HTMLElement>(`.person-card[data-id="${CSS.escape(personId)}"]`);
            card?.click();
        }
    },

    /**
     * The badge of a story's new version (kind "story" in Waiting for you):
     * the comparison of that story — the person's, or their couple's. False
     * when there is none to open (then the badge opens Waiting for you).
     */
    openWaitingStoryCompare(personId: PersonId): boolean {
        if (!TreeRenderer.cardSignalsFor(personId)?.waitingStory) return false;
        const refn = DataManager.getPerson(personId)?.refn;
        const item = this.researchWaiting()?.items.find(w => w.kind === 'story' && (w.person === refn || w.partner === refn));
        const target = item ? storyWaitingTarget(item) : null;
        if (!target || !storyWithDraft(target)) return false;
        this.showStoryCompare(target);
        return true;
    },

    /**
     * The person menu's first block (HTML, spec 066 P4 §5): the card's marks
     * explained with the bubble's rows in the card map's order (the mark in
     * words, the story, what waits with where it leads, the other trees with
     * "Go to the tree"), then "What the marks mean" (the help). A block with
     * only what waits stays as before. Empty when there is nothing to say.
     */
    personSignalsMenuHtml(personId: PersonId, touch: boolean, itemClass: 'context-menu-item' | 'bottom-sheet-item'): string {
        const s = TreeRenderer.cardSignalsFor(personId);
        if (!s) return '';
        const c = strings.card;
        const esc = (t: string): string => this.escapeHtml(t);
        // A link of the block: a menu item of its own (keyboard and the menu's dispatch reach it).
        const link = (action: string, text: string): string => itemClass === 'bottom-sheet-item'
            ? `<button type="button" class="${itemClass} mps-link" role="menuitem" data-action="${action}">${esc(text)}</button>`
            : `<div class="${itemClass} mps-link" role="menuitem" tabindex="-1" data-action="${action}">${esc(text)}</div>`;
        const row = (cls: string, mark: string, text: string, sub = '', after = ''): string =>
            `<div class="mps-row ${cls}"><span class="mps-mark">${mark}</span><span class="mps-text"><span>${esc(text)}</span>`
            + `${sub ? `<span class="mps-sub">${esc(sub)}</span>` : ''}</span>${after}</div>`;
        const rows: string[] = [];
        // As the bubble: the mark and the story in words also when the card does not show them.
        if (s.status) {
            const w = cardStatusWords(s.status, TreeRenderer.treeKnowsOriginNow());
            rows.push(row('mps-status', statusMarkHtml(s.status, { className: 'card-status-mark--inline' }), w.main, w.sub));
        }
        if (s.story) {
            rows.push(row('mps-story', storyFoldHtml(s.story, true),
                storySignalInLine(storySignalText(s.story, c.story), getCurrentLanguage())));
        }
        const action = s.action ? this.personSignalBlockHtml(s, s.action, touch, itemClass)
            : s.showAgent ? this.personSignalBlockHtml(s, 'agent', touch, itemClass) : '';
        const trees = groupCrossTreeMatches(TreeRenderer.crossTreeMatchesFor(personId));
        const cross = trees.length === 0 ? ''
            : row('mps-cross', '<span class="mps-glyph" aria-hidden="true">⇄</span>',
                trees.length === 1 ? c.ttCross(trees[0].treeName) : c.ttCrossN(trees.length), '', link('cross-tree', c.crossTreeGo));
        // Only what waits: the block as before (no marks to explain).
        if (rows.length === 0 && !cross) return action;
        const help = rows.length > 0 ? link('marks-help', strings.reliability.help) : '';
        return `<div class="menu-person-state" role="group" aria-label="${esc(c.legend.marksTitle)}">${rows.join('')}${action}${cross}${help}</div>`;
    },

    /**
     * The person menu's ⇄ link: one tree with one match switches to it, more
     * open the chooser of every person (at the card's ⇄ pill, or the card).
     */
    openCrossTreeOf(personId: PersonId): void {
        const matches = TreeRenderer.crossTreeMatchesFor(personId);
        if (matches.length === 0) return;
        if (matches.length === 1) { void this.switchToTreeAndFocus(matches[0].treeId, matches[0].personId); return; }
        const card = document.querySelector<HTMLElement>(`.person-card[data-id="${CSS.escape(personId)}"]`);
        const anchor = card?.querySelector<HTMLElement>('.cross-tree-badge') ?? card;
        if (anchor) this.showCrossTreeChooser(matches, anchor);
    },

    /** The action block of the person menu: what waits, and where it leads. */
    personSignalBlockHtml(s: CardSignalInfo, action: ActionSignal | 'agent', touch: boolean, itemClass: string): string {
        const c = strings.card;
        const r = strings.research;
        // The agent's mark is its arc, still (it turns on the card only).
        const glyph = action === 'agent'
            ? '<span class="agent-mark" aria-hidden="true"></span>'
            : `<span class="menu-signal-glyph signal-${action}" aria-hidden="true">${ACTION_GLYPH[action]}</span>`;
        let text = '';
        let go = '';
        if (action === 'waiting') {
            text = c.ttWaiting(s.waiting ?? '');
            // A story's new version is compared here, on touch too.
            if (s.waitingStory) go = strings.story.compare;
            else if (!touch) go = r.answer;
        } else if (action === 'conflict') {
            text = [c.ttConflicts(s.conflicts), s.hypotheses > 0 ? c.ttHypotheses(s.hypotheses) : ''].filter(Boolean).join(' · ');
            go = `${r.knows} ›`;
        } else if (action === 'question') {
            text = c.ttQuestion(s.question ?? '');
        } else {
            text = c.ttAgent(s.agent ?? '');
        }
        // Two lines at most (CSS); the whole text in the tooltip and behind the link.
        const body = `${glyph}<span class="menu-signal-text" title="${this.escapeHtml(text)}">${this.escapeHtml(text)}</span>${go ? `<span class="menu-signal-go">${this.escapeHtml(go)}</span>` : ''}`;
        // Only a block that leads somewhere is a menu item (keyboard reaches it);
        // it runs through the menu's own action dispatch ("signal-…").
        if (!go && action !== 'agent') return `<div class="menu-signal menu-signal-${action}" role="note">${body}</div>`;
        const cls = `${itemClass} menu-signal menu-signal-${action}`;
        return itemClass === 'bottom-sheet-item'
            ? `<button type="button" class="${cls}" role="menuitem" data-action="signal-${action}">${body}</button>`
            : `<div class="${cls}" role="menuitem" tabindex="-1" data-action="signal-${action}">${body}</div>`;
    },

    /**
     * Settings → "Show on card" (spec 066 P4 §3): three groups of switches
     * (person status, awaiting a decision, links), what is always shown, a
     * link to the branch colours in the Tree group, the help on the marks;
     * the preview card is above (see card-fields-ui).
     */
    renderCardSignalSettings(): void {
        const host = document.getElementById('card-signals-settings');
        if (!host) return;
        const d = strings.cardDensity;
        const on = SettingsManager.getCardSignals();
        // Waiting only means something with a research tree; the agent only
        // with the research connected on this computer (it is followed live).
        const research = TreeManager.getTrees().some(t => !!t.research?.id);
        // (An archive has no agent: no badge for its work there.)
        const connected = research && announcedResearchLinks().length > 0 && !this.activeResearchAgentless();
        const box = (key: keyof CardSignals): string => {
            const sub = signalSub(key);
            return `
            <label class="settings-checkbox card-signal-option">
                <input type="checkbox" data-signal="${key}"${on[key] ? ' checked' : ''}>
                <span class="settings-text">
                    <span class="settings-name">${this.escapeHtml(signalLabel(key))}</span>
                    ${sub ? `<span class="settings-desc">${this.escapeHtml(sub)}</span>` : ''}
                </span>
            </label>`;
        };
        const group = (cls: string, title: string, keys: (keyof CardSignals)[]): string => `
                <div class="card-signals-group card-signals-group--${cls}" role="group" aria-label="${this.escapeHtml(title)}">
                    <div class="card-signals-group-title">${this.escapeHtml(title)}</div>
                    ${keys.map(box).join('')}
                </div>`;
        const actionKeys = ACTION_KEYS.filter(k => (k !== 'waiting' || research) && (k !== 'agent' || connected));
        host.innerHTML = `
            <div class="card-signals-options">
                <div class="settings-name">${this.escapeHtml(d.cardShow)}</div>
                ${group('state', d.cardGroupState, STATE_KEYS)}
                ${group('action', d.cardGroupAction, actionKeys)}
                ${group('links', d.cardGroupLinks, LINK_KEYS)}
                <div class="card-signals-foot">
                    <div class="card-signals-always">${this.escapeHtml(d.cardAlways)}</div>
                    <div class="card-signals-links">
                        <button type="button" class="link-button card-signals-branch-link">${this.escapeHtml(d.cardBranchLink)}</button>
                        <button type="button" class="link-button card-signals-help-link">${this.escapeHtml(strings.reliability.help)}</button>
                    </div>
                    <div class="settings-desc card-signals-hint">${this.escapeHtml(`${d.cardShowHint} ${d.sameEverywhere}`)}</div>
                </div>
            </div>`;
        // The row of card types, one preview for the type and the signals
        // under it, the custom type's details below it.
        this.renderCardTypeSettings();
        this.renderCardPreview();
        this.renderCardFieldsSettings();
        host.querySelectorAll<HTMLInputElement>('input[data-signal]').forEach(input => {
            input.onchange = () => {
                const key = input.dataset.signal as keyof CardSignals;
                if (!CARD_SIGNAL_KEYS.includes(key)) return;
                SettingsManager.setCardSignal(key, input.checked);
                this.renderCardPreview();
                TreeRenderer.render();
            };
        });
        const branch = host.querySelector<HTMLButtonElement>('.card-signals-branch-link');
        if (branch) branch.onclick = () => this.showBranchColorsSetting();
        const help = host.querySelector<HTMLButtonElement>('.card-signals-help-link');
        if (help) help.onclick = () => { void openHelp(HELP_TOPICS.reliability, help); };
    },

    /** "Branch colours: Tree settings ›": the Settings scroll to the branch colours' switch, which takes the focus. */
    showBranchColorsSetting(): void {
        const toggle = document.getElementById('branch-colors-toggle') as HTMLInputElement | null;
        const row = toggle?.closest<HTMLElement>('.settings-row');
        if (!toggle || !row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        toggle.focus({ preventScroll: true });
    },
});
