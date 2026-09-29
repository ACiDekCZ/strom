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
import { uiModule } from './module.js';

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
        if (signal === 'waiting') this.showResearchWaiting();
        else if (signal === 'conflict') this.showPersonResearchDialog(personId);
        else if (signal === 'agent') this.showLiveResearchNow();
        else {
            // The question: the person menu, which leads with it.
            const card = document.querySelector<HTMLElement>(`.person-card[data-id="${CSS.escape(personId)}"]`);
            card?.click();
        }
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
        return html;
    },

    /** The action block of the person menu: what waits, and where it leads. */
    personSignalBlockHtml(s: CardSignalInfo, action: ActionSignal, touch: boolean, itemClass: string): string {
        const c = strings.card;
        const r = strings.research;
        const glyph = `<span class="menu-signal-glyph signal-${action}" aria-hidden="true">${ACTION_GLYPH[action]}</span>`;
        let text = '';
        let go = '';
        if (action === 'waiting') {
            text = c.ttWaiting(s.waiting ?? '');
            if (!touch) go = r.answer;
        } else if (action === 'conflict') {
            text = [c.ttConflicts(s.conflicts), s.hypotheses > 0 ? c.ttHypotheses(s.hypotheses) : ''].filter(Boolean).join(' · ');
            go = `${r.knows} ›`;
        } else if (action === 'question') {
            text = c.ttQuestion(s.question ?? '');
        } else {
            text = c.ttAgent(s.agent ?? '');
        }
        const body = `${glyph}<span class="menu-signal-text">${this.escapeHtml(text)}</span>${go ? `<span class="menu-signal-go">${this.escapeHtml(go)}</span>` : ''}`;
        // Only a block that leads somewhere is a menu item (keyboard reaches it);
        // it runs through the menu's own action dispatch ("signal-…").
        if (!go && action !== 'agent') return `<div class="menu-signal menu-signal-${action}" role="note">${body}</div>`;
        const cls = `${itemClass} menu-signal menu-signal-${action}`;
        return itemClass === 'bottom-sheet-item'
            ? `<button type="button" class="${cls}" role="menuitem" data-action="signal-${action}">${body}</button>`
            : `<div class="${cls}" role="menuitem" tabindex="-1" data-action="signal-${action}">${body}</div>`;
    },

    /** Settings → "Show on card": two groups of checkboxes and a preview card. */
    renderCardSignalSettings(): void {
        const host = document.getElementById('card-signals-settings');
        if (!host) return;
        const d = strings.cardDensity;
        const on = SettingsManager.getCardSignals();
        // Waiting only means something with a research tree; the agent only
        // with the research connected on this computer (it is followed live).
        const research = TreeManager.getTrees().some(t => !!t.research?.id);
        const connected = research && announcedResearchLinks().length > 0;
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
                <div class="settings-desc">${this.escapeHtml(d.cardShowHint)}</div>
            </div>
            <div class="card-signals-preview-wrap">
                <div class="card-signals-preview-title">${this.escapeHtml(d.cardPreview)}</div>
                <div class="card-signals-preview" aria-hidden="true">${this.cardSignalsPreviewHtml(on)}</div>
            </div>`;
        host.querySelectorAll<HTMLInputElement>('input[data-signal]').forEach(input => {
            input.onchange = () => {
                const key = input.dataset.signal as keyof CardSignals;
                if (!CARD_SIGNAL_KEYS.includes(key)) return;
                SettingsManager.setCardSignal(key, input.checked);
                const preview = host.querySelector('.card-signals-preview');
                if (preview) preview.innerHTML = this.cardSignalsPreviewHtml(SettingsManager.getCardSignals());
                TreeRenderer.render();
            };
        });
    },

    /** A made-up card in the current density with the chosen signals. */
    cardSignalsPreviewHtml(on: CardSignals): string {
        const density = SettingsManager.getCardDensity();
        const stripes = stateStripesHtml(on.evidence ? 'partial' : null, on.story ? 'draft' : null);
        const action: ActionSignal | null = on.waiting ? 'waiting' : on.conflict ? 'conflict' : on.question ? 'question' : null;
        const badge = action ? `<span class="card-signal signal-${action}">${ACTION_GLYPH[action]}</span>` : '';
        const dot = action ? `<span class="card-signal-dot signal-${action}"></span>` : '';
        const compact = density === 'compact';
        return `
            <div class="person-card male preview-card${action ? ' has-signal' : ''}" data-density="${density}">
                ${compact ? '' : `<div class="card-avatar-wrap"><div class="card-avatar"><span class="avatar-initials">MV</span></div>${badge}</div>`}
                <div class="card-body">
                    <div class="name"><span class="name-text">Milan Víšek</span></div>
                    ${compact ? '' : '<div class="birth-date"><span class="meta-text">1842 – ?</span></div>'}
                </div>
                ${stripes}
                ${dot}
            </div>`;
    },
});
