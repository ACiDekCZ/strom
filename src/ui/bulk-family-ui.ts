/**
 * Children and siblings at once (src/bulk-family.ts): the run of a step
 * from the person menu (a) or the focus bar's switch (b), the bubble
 * that asks first when the step adds more than BULK_CONFIRM_ABOVE people
 * ("{n} people will be added", about k screen widths, "Expand +n", "Only 2
 * ancestor generations +m", Cancel; Esc and a click beside it cancel), and
 * the switch itself (button.bulk-family after the depth steppers of the
 * desktop focus bar and of the tablet toolbar; none on a phone).
 */

import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import type { PersonId } from '../types.js';
import { BULK_CONFIRM_ABOVE, BULK_TWO_GENERATIONS } from '../bulk-family.js';

/** Where the bubble stands: beside a menu row (left of the menu, else right), under a switch, or at the bottom of the window (touch). */
export type BulkBubblePlacement = 'beside' | 'below' | 'bottom';

const BUBBLE_WIDTH = 288;
const MARGIN = 8;

let open: { el: HTMLElement; close: (pick: 'all' | 'two' | null) => void } | null = null;

/** Whether the bubble is open (the person menu keeps itself open under it). */
export function isBulkBubbleOpen(): boolean {
    return open !== null;
}

/** Close the bubble as Cancel would. */
export function closeBulkBubble(): void {
    open?.close(null);
}

function esc(t: string): string {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Ask before a big step: resolves with 'all' (Expand +n), 'two' (only the
 * siblings up to 2 ancestor generations, +m) or null (Cancel, Esc, a click
 * beside it). `m` equal to `n` or 0: no second button.
 */
export function confirmBulkFamily(opts: { n: number; m: number; k: number; anchor: HTMLElement | null; placement: BulkBubblePlacement }):
    Promise<'all' | 'two' | null> {
    closeBulkBubble();
    const { n, m, k, anchor } = opts;
    const placement: BulkBubblePlacement = anchor && anchor.isConnected ? opts.placement : 'bottom';
    const el = document.createElement('div');
    el.className = 'bulk-bubble';
    el.dataset.placement = placement;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'bulk-bubble-title');
    el.setAttribute('aria-describedby', 'bulk-bubble-body');
    const two = m > 0 && m !== n;
    el.innerHTML = `<p class="bulk-bubble-title" id="bulk-bubble-title">${esc(strings.bulk.bigTitle(n))}</p>`
        + `<p class="bulk-bubble-body" id="bulk-bubble-body">${esc(strings.bulk.bigBody(k))}</p>`
        + '<div class="bulk-bubble-actions">'
        + `<button type="button" class="bulk-bubble-btn primary" data-pick="all">${esc(strings.bulk.go(n))}</button>`
        + (two ? `<button type="button" class="bulk-bubble-btn secondary" data-pick="two">${esc(strings.bulk.two(m))}</button>` : '')
        + `<button type="button" class="bulk-bubble-btn quiet" data-pick="cancel">${esc(strings.buttons.cancel)}</button>`
        + '</div>';
    document.body.appendChild(el);
    place(el, anchor, placement);

    return new Promise(resolve => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            finish(null);
        };
        // A press beside the bubble cancels it (the press goes on to what it hit)
        const onDown = (e: PointerEvent) => {
            if (!el.contains(e.target as Node)) finish(null);
        };
        const finish = (pick: 'all' | 'two' | null) => {
            if (open?.el !== el) return;
            open = null;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('resize', onResize);
            el.remove();
            if (!pick && anchor?.isConnected) anchor.focus({ preventScroll: true });
            resolve(pick);
        };
        const onResize = () => finish(null);
        open = { el, close: finish };
        el.addEventListener('click', e => {
            const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
            if (!b) return;
            e.stopPropagation();
            const pick = b.dataset.pick;
            finish(pick === 'all' ? 'all' : pick === 'two' ? 'two' : null);
        });
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onDown, true);
        window.addEventListener('resize', onResize);
        el.querySelector<HTMLElement>('[data-pick="all"]')?.focus({ preventScroll: true });
    });
}

/** Put the bubble beside the anchor's menu, under the anchor, or at the window's bottom, inside the window. */
function place(el: HTMLElement, anchor: HTMLElement | null, placement: BulkBubblePlacement): void {
    if (placement === 'bottom' || !anchor) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(BUBBLE_WIDTH, vw - 2 * MARGIN);
    const h = el.offsetHeight;
    const row = anchor.getBoundingClientRect();
    let left: number, top: number;
    if (placement === 'beside') {
        const box = (anchor.closest('.context-menu') ?? anchor).getBoundingClientRect();
        left = box.left - w - MARGIN >= MARGIN ? box.left - w - MARGIN : box.right + MARGIN;
        top = row.top - 14;
    } else {
        left = row.left;
        top = row.bottom + 6;
    }
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}

/**
 * Run children and siblings at once for `personId`: a standing step with
 * nothing more to add is taken back; otherwise the step, over
 * BULK_CONFIRM_ABOVE new people after the bubble (at `anchor`, the menu row
 * or the switch; none: the window's bottom). `beforeStep`: called once the
 * step is decided, before it runs (the person menu closes then). The zoom
 * never changes. False when nothing was done (Cancel, nothing to add).
 */
export async function runBulkFamily(personId: PersonId, source: 'a' | 'b', anchor: HTMLElement | null = null,
    placement: BulkBubblePlacement = 'beside', beforeStep?: () => void): Promise<boolean> {
    const st = TreeRenderer.bulkFamilyState(personId);
    if (st.state === 'on') {
        beforeStep?.();
        await TreeRenderer.undoBulkFamily(personId);
        return true;
    }
    if (st.state !== 'offer') return false;
    let maxGeneration = Infinity;
    if (st.n > BULK_CONFIRM_ABOVE) {
        const m = TreeRenderer.bulkFamilyCount(personId, BULK_TWO_GENERATIONS);
        const k = TreeRenderer.bulkFamilyScreens(personId);
        const pick = await confirmBulkFamily({ n: st.n, m, k, anchor, placement });
        if (!pick) return false;
        if (pick === 'two') maxGeneration = BULK_TWO_GENERATIONS;
    }
    beforeStep?.();
    await TreeRenderer.showBulkFamily(personId, source, maxGeneration);
    return true;
}

/** The switch's state for the focus as last drawn (updateBulkFamilySwitches). */
export type BulkSwitchState = 'offer' | 'on' | 'none';

let switchInstalled = false;
let switchBusy = false;

/**
 * Draw the focus bar's switch "Children & siblings" for the focus after a
 * render: "+n" while the step adds n people (offer); ✓ while the focus's
 * step stands with nothing more to add (on, aria-pressed, a click takes the
 * step back); muted with nothing to add and no step (none, aria-disabled).
 * Hidden outside the family view and without a focus. A phone has no switch
 * (CSS): the person sheet's row does the same.
 */
export function updateBulkFamilySwitches(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('button.bulk-family');
    if (buttons.length === 0) return;
    installBulkFamilySwitch();
    const focus = TreeRenderer.getFocusPersonId();
    const family = TreeRenderer.getViewMode() === 'family';
    const st = focus && family ? TreeRenderer.bulkFamilyState(focus) : null;
    for (const btn of buttons) {
        btn.hidden = !st;
        if (!st) continue;
        btn.dataset.state = st.state;
        btn.setAttribute('aria-pressed', String(st.state === 'on'));
        if (st.state === 'none') btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
        const count = btn.querySelector('.bulk-family-count');
        if (count) count.textContent = st.state === 'offer' ? `+${st.n}` : '';
        const label = btn.querySelector('.bulk-family-label');
        if (label) label.textContent = strings.bulk.tree;
        btn.title = st.state === 'on' ? strings.bulk.menuOff : st.state === 'none' ? strings.bulk.treeNone : strings.bulk.treeTip;
        btn.setAttribute('aria-label', st.state === 'offer' ? strings.bulk.treeAria(st.n) : strings.bulk.tree);
    }
}

/** One document-level click listener serves every switch; idempotent. */
function installBulkFamilySwitch(): void {
    if (switchInstalled || typeof document === 'undefined') return;
    switchInstalled = true;
    // A press on the switch while its bubble asks closes the bubble (a press
    // beside it); the click that follows must not open it again. Registered
    // before any bubble's own listener, so it sees the bubble still open.
    let pressClosed = false;
    document.addEventListener('pointerdown', e => {
        pressClosed = isBulkBubbleOpen() && !!(e.target as Element | null)?.closest?.('button.bulk-family');
    }, true);
    document.addEventListener('click', e => {
        const btn = (e.target as Element | null)?.closest?.('button.bulk-family') as HTMLButtonElement | null;
        if (!btn) return;
        const closed = pressClosed;
        pressClosed = false;
        // A click while the bubble asks (the press closed it, or a key): as Cancel
        if (closed) return;
        if (isBulkBubbleOpen()) { closeBulkBubble(); return; }
        if (btn.dataset.state === 'none' || switchBusy) return;
        const focus = TreeRenderer.getFocusPersonId();
        if (!focus) return;
        switchBusy = true;
        void runBulkFamily(focus, 'b', btn, 'below').finally(() => {
            switchBusy = false;
            updateBulkFamilySwitches();
        });
    });
}
