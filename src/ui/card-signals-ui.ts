/**
 * The card's at-a-glance signals outside the card: the badge opens what it
 * signals (desktop), the person menu leads with what there is to do, and
 * Settings → "Show on card" chooses which signals cards show, with a live preview card.
 */

import { TreeRenderer } from '../renderer.js';
import { SettingsManager, CardSignals, CARD_SIGNAL_KEYS } from '../settings.js';
import { strings } from '../strings.js';
import { PersonId } from '../types.js';
import { ActionSignal, ACTION_GLYPH, storyFoldHtml } from '../card-signals.js';
import { groupCrossTreeMatches } from '../cross-tree.js';
import { HELP_TOPICS } from '../help/topics.js';
import { openHelp } from './help-ui.js';
import { TreeManager } from '../tree-manager.js';
import { announcedResearchLinks } from '../research-device.js';
import { researchConflictRef } from '../research-link.js';
import { uiModule } from './module.js';
import { researchBridgeActionLabel } from './research-open-mark.js';
import { openMarkTip } from './status-tip.js';
import { DataManager } from '../data.js';
import { LiveWaiting } from '../research-link.js';
import { personWaiting } from '../research-waiting.js';
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
        if (signal === 'waiting') this.answerPersonWaiting(personId);
        else if (signal === 'conflict') {
            // At the first open conflict's card.
            const first = researchConflictRef(this.personOpenConflicts(personId)[0]?.id);
            this.showPersonResearchDialog(personId, first ? { conflict: first } : {});
        }
        else if (signal === 'agent') this.showLiveResearchNow();
        // The question: what the research knows, at the question.
        else this.showPersonResearchDialog(personId, { questions: true });
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

    /** What waits on the person in Waiting for you, in order (the items their card's ! counts). */
    personWaitingItems(personId: PersonId): LiveWaiting[] {
        return personWaiting(this.researchWaiting()?.items ?? [], DataManager.getPerson(personId)?.refn);
    },

    /** How many items of Waiting for you wait on the person (at least 1 while the card says one waits). */
    waitingCountOf(personId: PersonId): number {
        return Math.max(1, this.personWaitingItems(personId).length);
    },

    /**
     * The card's ! and the menu's "Answer · N waiting" do what they say: a
     * story's new version opens its comparison; one item opens its answer as
     * its row's button does; more items (or one nothing answers here) open the
     * panel at the person's items, lit — then with the line why not. Never
     * nothing: with no item known the panel says how things are.
     */
    answerPersonWaiting(personId: PersonId): void {
        this.hideContextMenu();
        if (this.openWaitingStoryCompare(personId)) return;
        const items = this.personWaitingItems(personId);
        const runs = items.map(w => this.waitingAnswerAction(w));
        if (items.length === 1 && runs[0]) {
            runs[0]();
            return;
        }
        this.showPersonWaiting(items, items.length > 0 && runs.every(r => !r));
    },

    /**
     * The person menu's first items (HTML, spec 066 P4 §5 round 2): only what
     * there is to do, right under the header, each an ordinary menu item with
     * its glyph — answer (desktop) or Waiting for you (touch), compare the
     * story's new version, what the research knows (conflicts, hypotheses, the
     * question), follow the research, go to the other tree. The marks
     * themselves are explained by their own bubbles. Empty when there is nothing.
     */
    personSignalsMenuHtml(personId: PersonId, touch: boolean, itemClass: 'context-menu-item' | 'bottom-sheet-item'): string {
        const s = TreeRenderer.cardSignalsFor(personId);
        if (!s) return '';
        const c = strings.card;
        const esc = (t: string): string => this.escapeHtml(t);
        const item = (action: string, kind: string, glyph: string, text: string, textHtml?: string): string => {
            const cls = `${itemClass} menu-act menu-signal-${kind}`;
            const body = `${glyph}<span class="menu-act-text">${textHtml ?? esc(text)}</span>`;
            return itemClass === 'bottom-sheet-item'
                ? `<button type="button" class="${cls}" role="menuitem" data-action="${action}">${body}</button>`
                : `<div class="${cls}" role="menuitem" tabindex="-1" data-action="${action}">${body}</div>`;
        };
        const glyph = (a: ActionSignal): string => `<span class="menu-signal-glyph signal-${a}" aria-hidden="true">${ACTION_GLYPH[a]}</span>`;
        const items: string[] = [];
        if (s.waiting) {
            const n = this.waitingCountOf(personId);
            items.push(touch ? item('signal-waiting-list', 'waiting', glyph('waiting'), c.menuWaiting(n))
                : item('signal-waiting', 'waiting', glyph('waiting'), c.menuAnswer(n)));
        }
        if (s.waitingStory) items.push(item('signal-story-compare', 'story', storyFoldHtml(s.story, true) || glyph('waiting'), strings.story.compare));
        if (s.conflicts > 0 || s.question) {
            const parts = [
                s.conflicts > 0 ? c.ttConflicts(s.conflicts) : '',
                s.hypotheses > 0 ? c.ttHypotheses(s.hypotheses) : '',
                s.question ? c.menuQuestions(1) : '',
            ].filter(Boolean);
            const kind: ActionSignal = s.conflicts > 0 ? 'conflict' : 'question';
            items.push(item('signal-knows', kind, glyph(kind), c.menuKnows(parts.join(', '))));
        }
        // Verifying the person's facts (spec 065 §10i): through the bridge, the AI badge alone;
        // facts already waiting lead to "What the research knows", no mark.
        const verify = this.personVerifyMenu(personId);
        if (verify) {
            const verifyGlyph = '<span class="menu-act-glyph menu-verify-glyph" aria-hidden="true">✓</span>';
            items.push(verify.kind === 'verify'
                ? item('signal-verify', 'verify', verifyGlyph, '', researchBridgeActionLabel(strings.verify.menu(verify.n), 'verify'))
                : item('signal-verify-pending', 'verify-pending', verifyGlyph, strings.verify.menuPending(verify.n)));
            if (verify.prioritize) {
                items.push(item('signal-verify-first', 'verify-first', verifyGlyph, '', researchBridgeActionLabel(strings.verify.prioritize, 'verify')));
            }
        }
        if (s.showAgent) items.push(item('signal-agent', 'agent', '<span class="agent-mark" aria-hidden="true"></span>', c.menuAgent));
        const trees = groupCrossTreeMatches(TreeRenderer.crossTreeMatchesFor(personId));
        if (trees.length > 0) {
            items.push(item('cross-tree', 'cross', '<span class="menu-act-glyph" aria-hidden="true">⇄</span>',
                trees.length === 1 ? `${c.crossTreeGo} ${trees[0].treeName}` : c.menuCrossN(trees.length)));
        }
        return items.join('');
    },

    /** The person's story (the card's corner, a status tip's story row). */
    openPersonStory(personId: PersonId): void {
        this.hideContextMenu();
        this.clearDialogStack();
        this.pushDialog('person-story-modal');
        this.showPersonStoryDialog(personId);
    },

    /**
     * A tap on a card's mark (touch, spec 066 P4 §9 round 2): its bubble,
     * pinned, with the mark's action as a 44 px button — what waits, what
     * the research knows, follow the research, the story, the other tree;
     * the lock and the sibling order only say what they mean.
     */
    openCardMarkTip(personId: PersonId, mark: HTMLElement): void {
        this.hideContextMenu();
        const kind = mark.dataset.mark ?? '';
        const c = strings.card;
        const bubble = kind === 'cross' ? mark.querySelector<HTMLElement>('.cross-tree-tooltip')
            : kind === 'order' ? mark.querySelector<HTMLElement>('.so-tip')
            : mark.parentElement?.querySelector<HTMLElement>(`:scope > .mark-tip.mt-${CSS.escape(kind)}`) ?? null;
        if (!bubble) return;
        const words = bubble.cloneNode(true) as HTMLElement;
        const headEl = words.querySelector('.badge-tooltip-header, .cross-tree-tooltip-header');
        const head = headEl?.textContent?.trim() ?? '';
        headEl?.remove();
        // "Click: …" is the button here.
        words.querySelectorAll('.badge-tooltip-action').forEach(n => n.remove());
        const s = TreeRenderer.cardSignalsFor(personId);
        let button: { label: string; run: () => void } | undefined;
        if (kind === 'badge') {
            const signal = mark.dataset.signal ?? '';
            button = signal === 'waiting'
                ? { label: `${strings.cardDensity.cardWaiting} ›`, run: () => this.openCardSignal(personId, 'waiting') }
                : { label: `${strings.research.knows} ›`, run: () => this.openPersonResearchKnows(personId) };
        } else if (kind === 'agent') {
            button = { label: c.menuAgent, run: () => this.showLiveResearchNow() };
        } else if (kind === 'story') {
            button = { label: c.tipStoryRow(s?.story?.title ?? ''), run: () => this.openPersonStory(personId) };
        } else if (kind === 'cross') {
            const trees = groupCrossTreeMatches(TreeRenderer.crossTreeMatchesFor(personId));
            if (trees.length > 0) {
                button = {
                    label: trees.length === 1 ? `${c.crossTreeGo} ${trees[0].treeName}` : c.menuCrossN(trees.length),
                    run: () => this.openCrossTreeOf(personId),
                };
            }
        }
        openMarkTip(mark, { head, bodyHtml: words.innerHTML, button });
    },

    /** "What the research knows" of the person: at the first open conflict, else at the question. */
    openPersonResearchKnows(personId: PersonId): void {
        this.hideContextMenu();
        const first = researchConflictRef(this.personOpenConflicts(personId)[0]?.id);
        this.showPersonResearchDialog(personId, first ? { conflict: first } : { questions: true });
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
