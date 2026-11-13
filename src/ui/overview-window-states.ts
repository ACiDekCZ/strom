/**
 * The Research overview's own window, its states (spec 079 §6 states 3–5,
 * §3 for the strip and the state in place of the content):
 *
 * - loading      — before the main window's first state (or while it opens
 *                  the research's overview): the head, a skeleton and
 *                  "Loading the research overview…" after 300 ms;
 * - no research  — the main window switched to a tree without research: the
 *                  head with that tree, "This tree has no research" and
 *                  Close window; a tree with research again draws it again;
 * - off          — the research not running: what the tree holds, Awaiting
 *                  action as said last with its answers greyed
 *                  (`aria-disabled`), "The research is not running · Turn on";
 * - main closed  — the amber strip "as of {time}" with Make this the main
 *                  window and Open Strom, the last state frozen ("as of …"
 *                  at each section) and every action greyed: nothing is
 *                  sent. The main window back (its reload): live again.
 */

import { strings } from '../strings.js';
import type { OverviewResearchState } from '../windows/overview-window.js';
import { LOADING_LABEL_DELAY_MS } from '../windows/sat-states.js';

/** What stands in the window's place of the overview. */
export type OverviewWindowContent = 'loading' | 'no-research' | 'overview' | 'blank';

export interface OverviewWindowScreen {
    content: OverviewWindowContent;
    /** The main window is closed (§3.3): the strip, what is shown frozen, every action greyed. */
    closed: boolean;
    /** When what is shown was last current (the strip and the sections say it). */
    asOf: number;
    /** The research not running: drawn from the tree, the answers of Awaiting action greyed. */
    off: boolean;
}

export interface OverviewWindowScreenInput {
    /** The main window's last state (null: none yet). */
    state: OverviewResearchState | null;
    connection: 'connecting' | 'connected' | 'main-closed';
    /** When the main window was last heard (ms; 0: never). */
    lastHeardAt: number;
}

/** What the overview window shows for its state. */
export function overviewWindowScreen(i: OverviewWindowScreenInput): OverviewWindowScreen {
    const closed = i.connection === 'main-closed';
    const asOf = Math.max(i.state?.at ?? 0, i.lastHeardAt || 0);
    const s = i.state;
    let content: OverviewWindowContent;
    if (!s) content = closed ? 'blank' : 'loading';
    else if (!s.researchId) content = 'no-research';
    // The tree's research, its overview not there yet (the main window opens it): loading, unless nobody sends it now.
    else if (!s.session || !s.source) content = closed ? 'blank' : 'loading';
    else content = 'overview';
    return { content, closed, asOf, off: content === 'overview' && s?.source === 'tree' };
}

// ==================== GREYED ACTIONS ====================

/**
 * A control that only changes what this window shows (a fold, a detail
 * opened, a filter, "⋯ Edit panel") or that is the strip's own (Make this
 * the main window, Open Strom): it stays usable while everything else is
 * greyed.
 */
export const OVERVIEW_LOCAL_CONTROLS = '[aria-expanded]:not([aria-haspopup]), .research-overview__more, [data-filter], .sat-strip-btn';

/** What is greyed: every action (the main window closed), the answers of Awaiting action (the research not running), nothing. */
export type OverviewGrey = 'all' | 'answers' | null;

const CONTROLS = 'button, a[href], input, textarea, select, [role="button"], [role="menuitem"]';

/** A click on a greyed control does nothing (a link does not open, a handler is not reached). */
function blockGreyed(e: Event): void {
    const t = e.target as Element | null;
    if (!t?.closest?.('[data-greyed]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
}

/**
 * Grey the overview's actions after it is drawn: `all` disables every
 * control but those of this window's view; `answers` marks the controls of
 * Awaiting action `aria-disabled` (they stay readable and focusable). A
 * greyed control's click is stopped on the root, before its own handler.
 */
export function greyOverviewActions(root: HTMLElement, grey: OverviewGrey): void {
    if (!root.dataset.greyGuard) {
        root.dataset.greyGuard = '1';
        root.addEventListener('click', blockGreyed, true);
    }
    root.classList.toggle('research-overview--frozen', grey === 'all');
    if (!grey) return;
    const scope = grey === 'all' ? root : root.querySelector<HTMLElement>('#ov-sec-waiting');
    if (!scope) return;
    for (const c of scope.querySelectorAll<HTMLElement>(CONTROLS)) {
        if (c.matches(OVERVIEW_LOCAL_CONTROLS)) continue;
        c.dataset.greyed = grey;
        c.setAttribute('aria-disabled', 'true');
        if (grey === 'all' && 'disabled' in c) (c as HTMLButtonElement).disabled = true;
    }
}

// ==================== THE STRIP AND THE STATES ====================

export interface OverviewWindowStateActions {
    /** "Make this the main window" (§3.3). */
    makeMain(): void;
    /** "Open Strom" (§3.3): a new main window. */
    openStrom(): void;
    /** "Close window" (no research). */
    closeWindow(): void;
    /** A time as the strip says it ("14:32"). */
    formatTime(ts: number): string;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
}

function stripButton(className: string, text: string, run: () => void): HTMLButtonElement {
    const b = node('button', className, text);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
}

/** The amber strip of a closed main window (§3.3, 3c), under the window's head. */
export function overviewClosedStrip(asOf: number, act: OverviewWindowStateActions): HTMLElement {
    const w = strings.win;
    const strip = node('div', 'sat-strip sat-strip--amber research-overview__strip');
    strip.setAttribute('role', 'status');
    const dot = node('span', 'sat-strip-dot');
    dot.setAttribute('aria-hidden', 'true');
    const actions = node('div', 'sat-strip-actions');
    actions.append(
        stripButton('sat-strip-btn sat-strip-make-main', w.makeMain, () => act.makeMain()),
        stripButton('sat-strip-btn sat-strip-btn--primary sat-strip-open', w.openStrom, () => act.openStrom()),
    );
    strip.append(dot, node('span', 'sat-strip-text', w.mainClosed(act.formatTime(asOf))), actions);
    return strip;
}

/** Widths of the skeleton's rows (% of the area), as the satellites' (3a). */
const SKELETON_ROWS = [92, 74, 86, 64, 90, 58, 80, 70, 88, 62, 84, 72];

/** The id of what stands in the overview's place (the renderer's own root is `research-overview`). */
export const OVERVIEW_WINDOW_STATE_ID = 'overview-window-state';

/**
 * Draw what stands in the overview's place (loading, no research, nothing
 * while the main window is closed): the window's head with its tree, the
 * strip when the main window is closed, then the state. `content` 'overview'
 * removes it. Returns the element (null: removed).
 */
export function renderOverviewWindowState(screen: OverviewWindowScreen, treeName: string, act: OverviewWindowStateActions): HTMLElement | null {
    let root = document.getElementById(OVERVIEW_WINDOW_STATE_ID);
    if (screen.content === 'overview') {
        root?.remove();
        return null;
    }
    const kind = `${screen.content}:${screen.closed}`;
    if (!root) {
        root = node('div', 'research-overview research-overview--window research-overview--state');
        root.id = OVERVIEW_WINDOW_STATE_ID;
        root.setAttribute('role', 'main');
        document.body.appendChild(root);
    }
    root.setAttribute('aria-label', strings.live.overviewTitle);
    // The skeleton's label waits 300 ms from when loading began (a redraw meanwhile does not start it again).
    const wasLoading = root.dataset.kind?.startsWith('loading:') === true;
    root.dataset.kind = kind;
    root.replaceChildren();

    const head = node('div', 'research-overview__head research-overview__head--window');
    head.appendChild(node('span', 'live-dot live-dot--still live-dot--off'));
    const titles = node('div', 'research-overview__titles');
    titles.appendChild(node('h1', 'research-overview__title', strings.win.overviewHead(treeName, strings.live.overviewTitle)));
    head.appendChild(titles);
    root.appendChild(head);
    if (screen.closed) root.appendChild(overviewClosedStrip(screen.asOf, act));

    if (screen.content === 'no-research') {
        const w = strings.win;
        const empty = node('div', 'sat-empty');
        const box = node('div', 'sat-empty-box');
        const btn = stripButton('sat-empty-btn sat-empty-btn--primary', w.closeWindow, () => act.closeWindow());
        box.append(node('h2', 'sat-empty-title', w.noResearch), node('p', 'sat-empty-note', w.noResearchNote(treeName)), btn);
        empty.appendChild(box);
        root.appendChild(empty);
    } else if (screen.content === 'loading') {
        const skeleton = node('div', 'sat-skeleton');
        skeleton.setAttribute('aria-busy', 'true');
        for (const width of SKELETON_ROWS) {
            const bar = node('div', 'sat-skeleton-row');
            bar.style.width = `${width}%`;
            skeleton.appendChild(bar);
        }
        const label = node('div', 'sat-loading-label', strings.win.overviewLoading);
        label.setAttribute('role', 'status');
        skeleton.appendChild(label);
        root.appendChild(skeleton);
        if (wasLoading && root.dataset.labelShown === '1') label.classList.add('is-shown');
        else {
            root.dataset.labelShown = '0';
            const at = root;
            setTimeout(() => {
                if (at.isConnected && at.dataset.kind?.startsWith('loading:')) {
                    at.dataset.labelShown = '1';
                    at.querySelector('.sat-loading-label')?.classList.add('is-shown');
                }
            }, LOADING_LABEL_DELAY_MS);
        }
    }
    return root;
}
