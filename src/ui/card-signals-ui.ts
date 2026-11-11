/**
 * The card's at-a-glance signals outside the card: the badge opens what it
 * signals (desktop), the person menu leads with what there is to do, and
 * Settings → "Show on card" chooses which signals cards show, with a live preview card.
 */

import { TreeRenderer } from '../renderer.js';
import { SettingsManager, CardSignals, CARD_SIGNAL_KEYS } from '../settings.js';
import { strings } from '../strings.js';
import { PersonId } from '../types.js';
import { ActionSignal, ACTION_GLYPH, storyFoldHtml, stackChoices } from '../card-signals.js';
import { placeStackMenu, stackMenuItemsHtml } from '../card-signal-marks.js';
import { cardYears } from '../card-fields.js';
import { nameHtml, shownName } from '../person-name.js';
import { ZoomPan } from '../zoom.js';
import { groupCrossTreeMatches } from '../cross-tree.js';
import { HELP_TOPICS } from '../help/topics.js';
import { openHelp } from './help-ui.js';
import { TreeManager } from '../tree-manager.js';
import { announcedResearchLinks } from '../research-device.js';
import { researchConflictRef } from '../research-link.js';
import { uiModule } from './module.js';
import { researchBridgeActionLabel } from './research-open-mark.js';
import { closeStatusTip, openMarkTip } from './status-tip.js';
import { DataManager } from '../data.js';
import { LiveWaiting } from '../research-link.js';
import { personWaiting } from '../research-waiting.js';
import { storyWaitingTarget, storyWithDraft } from './story-compare-ui.js';

/** A swipe down this far closes the stack's bottom sheet (as the person sheet). */
const STACK_SHEET_SWIPE_PX = 80;

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


/** The open menu of a card's stack of marks (one at a time), and how it closes. */
let stackMenu: { el: HTMLElement; stack: HTMLElement; close: (returnFocus: boolean) => void } | null = null;
/** A press outside the open menu closed it: the click it makes goes nowhere (until this time). */
let swallowArmed = false;
let swallowUntil = 0;
let stackMenuListening = false;

/** The page's listeners of the stack's menu, installed once: a press outside closes it and its click is swallowed; a zoom or pan, a resize close it. */
function listenForStackMenu(): void {
    if (stackMenuListening || typeof document === 'undefined') return;
    stackMenuListening = true;
    document.addEventListener('pointerdown', (e) => {
        swallowArmed = false;
        if (!stackMenu || stackMenu.el.contains(e.target as Node)) return;
        stackMenu.close(false);
        swallowArmed = true;
        swallowUntil = Number.POSITIVE_INFINITY;
    }, true);
    document.addEventListener('pointerup', () => { if (swallowArmed) swallowUntil = performance.now() + 400; }, true);
    window.addEventListener('click', (e) => {
        if (!swallowArmed) return;
        swallowArmed = false;
        if (performance.now() > swallowUntil) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
    document.addEventListener('wheel', (e) => {
        if (stackMenu && !stackMenu.el.contains(e.target as Node)) stackMenu.close(false);
    }, { capture: true, passive: true });
    window.addEventListener('resize', () => stackMenu?.close(false));
    ZoomPan.onChange(() => stackMenu?.close(false));
}

/** Close the open menu of a stack of marks (`returnFocus`: back to the stack). */
export function closeCardSignalsMenu(returnFocus = false): void {
    stackMenu?.close(returnFocus);
}

/** Whether a stack's menu is open (for tests and callers). */
export function cardSignalsMenuOpen(): boolean {
    return !!stackMenu;
}

/** The stack of marks shows its menu open (aria-expanded, above the card's bubble) or closed. */
function markStackOpen(stack: HTMLElement, open: boolean): void {
    stack.setAttribute('aria-expanded', String(open));
    stack.classList.toggle('is-open', open);
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

    /**
     * The choices of a card's stack of marks (two or three signals): the
     * person menu's first items for the signals, the line of what waits
     * under "Answer", no fact check and no other tree. Empty without signals.
     */
    personSignalsStackHtml(personId: PersonId, touch: boolean, itemClass: 'context-menu-item' | 'bottom-sheet-item'): string {
        const s = TreeRenderer.cardSignalsFor(personId);
        if (!s) return '';
        return stackMenuItemsHtml(s, { touch, waitingCount: s.waiting ? this.waitingCountOf(personId) : 1, itemClass });
    },

    /**
     * A click or tap on a card's stack of marks: a small menu of what to open
     * — at the stack (mouse, a tablet's finger with 44 px rows), or a bottom
     * sheet on a phone (≤ 640 px). With one choice only (conflicts and a
     * question) straight to what the research knows, no menu. `viaKeyboard`:
     * the focus goes to the first choice. A press outside, Esc, a choice, a
     * pan or zoom of the tree, a resize or a new drawing of the tree close it.
     */
    openCardSignalsMenu(personId: PersonId, stack: HTMLElement, viaKeyboard: boolean): void {
        const s = TreeRenderer.cardSignalsFor(personId);
        if (!s) return;
        if (stackChoices(s).length < 2) {
            this.openPersonResearchKnows(personId);
            return;
        }
        const wasOpen = stackMenu?.stack === stack;
        closeCardSignalsMenu();
        if (wasOpen) return;
        this.hideContextMenu();
        closeStatusTip();
        const person = DataManager.getPerson(personId);
        const name = person ? shownName(person) : '';
        const years = person ? cardYears(person) : '';
        const label = strings.card.stackMenuLabel(name);
        const nameMarkup = person ? nameHtml(person, { former: true }) : this.escapeHtml(name);
        const yearsMarkup = years ? `<span class="csm-years">${this.escapeHtml(years)}</span>` : '';
        const run = (action: string | undefined): void => {
            if (action) this.runPersonMenuAction(personId, action);
        };

        // A phone: the person sheet's frame with the signals' choices alone, 48 px rows.
        if (typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches) {
            this.noteBottomSheetTrigger();
            this.hideBottomSheet();
            const overlay = document.createElement('div');
            overlay.className = 'bottom-sheet-overlay';
            overlay.innerHTML = `
            <div class="bottom-sheet bottom-sheet-person card-signals-sheet" role="menu" aria-label="${this.escapeHtml(label)}">
                <div class="bottom-sheet-handle"></div>
                <div class="bs-person-head csm-head"><div class="bottom-sheet-menu-title">${nameMarkup}</div>${yearsMarkup}</div>
                <div class="bottom-sheet-items">${this.personSignalsStackHtml(personId, true, 'bottom-sheet-item')}</div>
            </div>`;
            const sheet = overlay.querySelector<HTMLElement>('.bottom-sheet')!;
            // A tap on the darkened tree closes the sheet (the overlay takes the tap).
            overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hideBottomSheet(); });
            sheet.addEventListener('click', (e) => {
                const item = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
                if (!item) return;
                this.hideBottomSheet();
                run(item.dataset.action);
            });
            // A swipe down closes it.
            let startY = 0;
            let dragging = false;
            sheet.addEventListener('touchstart', (e) => {
                startY = e.touches[0].clientY;
                dragging = true;
                sheet.style.transition = 'none';
            }, { passive: true });
            sheet.addEventListener('touchmove', (e) => {
                if (!dragging) return;
                const dy = e.touches[0].clientY - startY;
                if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
            }, { passive: true });
            sheet.addEventListener('touchend', (e) => {
                dragging = false;
                sheet.style.transition = '';
                if (e.changedTouches[0].clientY - startY > STACK_SHEET_SWIPE_PX) this.hideBottomSheet();
                else sheet.style.transform = '';
            });
            document.body.appendChild(overlay);
            this.bottomSheet = overlay;
            markStackOpen(stack, true);
            this.bottomSheetOnClose = () => markStackOpen(stack, false);
            requestAnimationFrame(() => overlay.classList.add('active'));
            if (viaKeyboard) sheet.querySelector<HTMLElement>('.bottom-sheet-item')?.focus({ preventScroll: true });
            return;
        }

        listenForStackMenu();
        const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
        const el = document.createElement('div');
        el.className = `context-menu card-signals-menu${touch ? ' is-touch' : ''}`;
        el.setAttribute('role', 'menu');
        el.setAttribute('aria-label', label);
        el.innerHTML = `<div class="context-menu-header csm-head" role="presentation"><span class="cmh-name">${nameMarkup}</span>${yearsMarkup}</div>`
            + this.personSignalsStackHtml(personId, touch, 'context-menu-item');
        const items = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('.context-menu-item[data-action]'));

        // A new drawing of the tree takes the stack away: the menu goes with it.
        const canvas = document.getElementById('tree-canvas');
        const observer = canvas && typeof MutationObserver === 'function'
            ? new MutationObserver(() => { if (!stack.isConnected) close(false); }) : null;
        const onKey = (e: KeyboardEvent): void => {
            const active = document.activeElement as HTMLElement | null;
            const inside = !!active && el.contains(active);
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(true);
                return;
            }
            const list = items();
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
                if (!inside && active !== stack && active !== document.body && active) return;
                e.preventDefault();
                e.stopPropagation();
                const at = inside ? list.indexOf(active!) : -1;
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1
                    : at === -1 ? (e.key === 'ArrowUp' ? list.length - 1 : 0)
                        : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
                list[next]?.focus();
                return;
            }
            if (!inside) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                const action = active!.dataset.action;
                close(false);
                run(action);
                return;
            }
            if (e.key === 'Tab') {
                // Tab: on from the stack (the browser moves past it); Shift+Tab: back to the stack.
                if (e.shiftKey) e.preventDefault();
                close(false);
                stack.focus({ preventScroll: true });
            }
        };
        const close = (returnFocus: boolean): void => {
            if (stackMenu?.el !== el) return;
            stackMenu = null;
            observer?.disconnect();
            document.removeEventListener('keydown', onKey, true);
            el.remove();
            markStackOpen(stack, false);
            if (returnFocus && stack.isConnected) stack.focus({ preventScroll: true });
        };
        el.addEventListener('click', (e) => {
            const item = (e.target as HTMLElement).closest<HTMLElement>('.context-menu-item[data-action]');
            if (!item) return;
            close(false);
            run(item.dataset.action);
        });

        document.body.appendChild(el);
        stackMenu = { el, stack, close };
        markStackOpen(stack, true);
        // Layout size, not getBoundingClientRect(): the open animation scales the menu.
        const place = placeStackMenu(stack.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight });
        if (place.maxHeight !== null) el.style.maxHeight = `${place.maxHeight}px`;
        el.style.left = `${place.left}px`;
        el.style.top = `${place.top}px`;
        if (canvas) observer?.observe(canvas, { childList: true, subtree: true });
        document.addEventListener('keydown', onKey, true);
        if (viaKeyboard) items()[0]?.focus();
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
