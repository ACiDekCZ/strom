/**
 * The card's at-a-glance signals outside the card: the badge opens what it
 * signals (desktop), the person menu leads with it (and, on phones and
 * tablets, with the person's status line), and Settings → "Show on card"
 * chooses which signals cards show, with a live preview card.
 */

import { TreeRenderer } from '../renderer.js';
import { SettingsManager, CardSignals, CARD_SIGNAL_KEYS } from '../settings.js';
import { strings } from '../strings.js';
import { PersonId } from '../types.js';
import { ActionSignal, CardSignalInfo, ACTION_GLYPH, stateStripesHtml } from '../card-signals.js';
import { TreeManager } from '../tree-manager.js';
import { announcedResearchLinks } from '../research-device.js';
import { researchConflictRef } from '../research-link.js';
import { uiModule } from './module.js';
import { DataManager } from '../data.js';
import { storyWaitingTarget, storyWithDraft } from './story-compare-ui.js';

const STATE_KEYS: (keyof CardSignals)[] = ['evidence', 'story'];
const ACTION_KEYS: (keyof CardSignals)[] = ['waiting', 'conflict', 'question', 'agent'];

function signalLabel(key: keyof CardSignals): string {
    const d = strings.cardDensity;
    return {
        evidence: d.cardEvidence, story: d.cardStory, waiting: d.cardWaiting,
        conflict: d.cardConflict, question: d.cardQuestion, agent: d.cardAgent,
    }[key];
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
     * The person menu's first block (HTML): on touch the status line
     * ("partly documented · story (draft)"), then the badge's signal with
     * what it leads to. Empty when there is nothing to say.
     */
    personSignalsMenuHtml(personId: PersonId, touch: boolean, itemClass: 'context-menu-item' | 'bottom-sheet-item'): string {
        const s = TreeRenderer.cardSignalsFor(personId);
        if (!s) return '';
        const c = strings.card;
        let html = '';
        if (touch && (s.showEvidence || s.showStory)) {
            const bits: string[] = [];
            if (s.showEvidence && s.evidence) bits.push(c.ariaEv[s.evidence.level]);
            if (s.showStory) bits.push(s.story === 'draft' ? c.ttStoryDraft.toLowerCase() : c.ttStory.toLowerCase());
            const stripes = stateStripesHtml(s.showEvidence && s.evidence ? s.evidence.level : null, s.showStory ? s.story : null, true);
            html += `<div class="menu-person-state">${stripes}${this.escapeHtml(bits.join(' · '))}</div>`;
        }
        if (s.action) html += this.personSignalBlockHtml(s, s.action, touch, itemClass);
        else if (s.showAgent) html += this.personSignalBlockHtml(s, 'agent', touch, itemClass);
        return html;
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

    /** Settings → "Show on card": two groups of checkboxes (the preview card is above, see card-fields-ui). */
    renderCardSignalSettings(): void {
        const host = document.getElementById('card-signals-settings');
        if (!host) return;
        const d = strings.cardDensity;
        const on = SettingsManager.getCardSignals();
        // Waiting only means something with a research tree; the agent only
        // with the research connected on this computer (it is followed live).
        const research = TreeManager.getTrees().some(t => !!t.research?.id);
        // (An archive has no agent: no badge for its work there.)
        const connected = research && announcedResearchLinks().length > 0 && !this.activeResearchArchive();
        const box = (key: keyof CardSignals): string => `
            <label class="settings-checkbox card-signal-option">
                <input type="checkbox" data-signal="${key}"${on[key] ? ' checked' : ''}>
                <span>${this.escapeHtml(signalLabel(key))}</span>
            </label>`;
        const actionKeys = ACTION_KEYS.filter(k => (k !== 'waiting' || research) && (k !== 'agent' || connected));
        host.innerHTML = `
            <div class="card-signals-options">
                <div class="settings-name">${this.escapeHtml(d.cardShow)}</div>
                <div class="card-signals-group" role="group" aria-label="${this.escapeHtml(d.cardGroupState)}">
                    <div class="card-signals-group-title">${this.escapeHtml(d.cardGroupState)}</div>
                    ${STATE_KEYS.map(box).join('')}
                </div>
                <div class="card-signals-group" role="group" aria-label="${this.escapeHtml(d.cardGroupAction)}">
                    <div class="card-signals-group-title">${this.escapeHtml(d.cardGroupAction)}</div>
                    ${actionKeys.map(box).join('')}
                </div>
                <div class="settings-desc">${this.escapeHtml(`${d.cardShowHint} ${d.sameEverywhere}`)}</div>
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
    },
});
