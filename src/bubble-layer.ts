/**
 * The layer a card tab's bubble opens in (GitHub #4, round 3 §23, §25).
 *
 * A bubble lived inside its card on the tree's canvas: it grew and shrank
 * with the zoom and the card's hover growth, and it could not rise over the
 * zoom buttons without the whole tree rising with it (the cards then lay over
 * the buttons). Open, it now stands in the browser's top layer (a manual
 * popover): over everything on the page, outside the canvas's transform, at
 * scale 1, placed in screen pixels (TreeRenderer.placeBubble). It stays where
 * it is in the DOM, so the card's styles, the keyboard order of its rows and
 * the hover of its tab hold. One bubble at a time; a move of the tree (a pan,
 * a zoom), a new drawing or a press outside it closes it.
 *
 * Without the top layer (an old browser) the bubble stays on the canvas as
 * before, above or below its tab.
 *
 * A toast stands over a bubble (round 4 §29: the tree < the zoom buttons <
 * a bubble < a toast): while a bubble is open the toasts on the screen are
 * lifted into the top layer after it (so above it) and put back when it
 * closes (a toast stays under dialogs everywhere else). Where the toast at
 * its own place would cover the bubble, it stands above it (round 6 §44):
 * its bottom edge 8 px over the bubble's top edge, the bubble open, gliding
 * there, and back to its place when the bubble closes. A toast that comes
 * (or comes back) while a bubble is open and finds no room above it (under
 * the bars over the tree, 8 px) closes the bubble and stands at its place.
 *
 * The newer one wins (round 7 §52): a bubble opened over a toast standing
 * where the bubble opens (the toast at its place would cover it) hides the
 * toast while the bubble is open. Its time runs on meanwhile: when the
 * bubble closes the toast comes back for what is left of it, or, its time
 * over, it has gone. A toast standing elsewhere stays, over the bubble.
 */

import { ZoomPan } from './zoom.js';
import { onToastChange, shownToast } from './toast-slot.js';

/** Whether this browser has popovers (the top layer for a bubble). */
export function bubbleLayerSupported(): boolean {
    return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
}

interface OpenBubble {
    bubble: HTMLElement;
    /** The tab the bubble belongs to: a press on it is not "outside". */
    owner: HTMLElement;
    close: () => void;
}

let open: OpenBubble | null = null;
let installed = false;

/** The app's toasts: a message, the undo pill, the focus confirmation (its container, while it holds one). */
const TOAST_SELECTOR = 'body > .toast, body > .undo-toast, #focus-toast';

/** The toasts on the screen now (one waiting under another too: it may come back). */
function toastsShown(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(TOAST_SELECTOR)].filter(t => t.id !== 'focus-toast' || t.childElementCount > 0);
}

/** A toast hidden under a bubble opened over it (round 7 §52). */
const HIDDEN = 'toast-under-bubble';
let hidden: HTMLElement[] = [];

/** The toasts lifted over the open bubble. */
let lifted: HTMLElement[] = [];

/** Lift the toasts on the screen into the top layer, over the bubble just shown there. */
function liftToasts(): void {
    if (!bubbleLayerSupported()) return;
    for (const t of toastsShown()) {
        if (lifted.includes(t) && t.matches(':popover-open')) continue;
        if (!t.hasAttribute('popover')) t.setAttribute('popover', 'manual');
        if (t.matches(':popover-open')) t.hidePopover();
        t.showPopover();
        if (!lifted.includes(t)) lifted.push(t);
    }
}

/** Put the lifted toasts back in the page (under dialogs again). */
function lowerToasts(): void {
    for (const t of lifted) {
        if (t.matches(':popover-open')) t.hidePopover();
        t.removeAttribute('popover');
    }
    lifted = [];
}

/** The gap between a toast and the bubble under it, and under the bars over the tree. */
const TOAST_GAP = 8;

/** The toasts raised over the open bubble (an inline `bottom`). */
const raised = new Set<HTMLElement>();

function unraise(t: HTMLElement): void {
    if (!raised.delete(t)) return;
    t.style.bottom = '';
}

function unraiseAll(): void {
    for (const t of [...raised]) unraise(t);
}

/**
 * The toast's box at its own place: without its raise or its glide there or
 * back (cut short), its coming and going (a transform) left out.
 */
function ownBox(t: HTMLElement): { left: number; right: number; top: number; bottom: number; height: number } {
    const gliding = t.style.bottom !== ''
        || (t.getAnimations?.() ?? []).some(a => (a as CSSTransition).transitionProperty === 'bottom');
    let top: number, height: number;
    if (gliding) {
        const was = t.style.bottom;
        t.style.transitionProperty = 'opacity, transform';
        t.style.bottom = '';
        top = t.offsetTop;
        height = t.offsetHeight;
        t.style.bottom = was;
        void t.offsetTop;
        t.style.transitionProperty = '';
    } else {
        top = t.offsetTop;
        height = t.offsetHeight;
    }
    const r = t.getBoundingClientRect();
    return { left: r.left, right: r.right, top, bottom: top + height, height };
}

/** The top of the room a toast may rise into: under the app's bars over the tree. */
function roomTop(): number {
    let top = document.getElementById('tree-container')?.getBoundingClientRect().top ?? 0;
    const bar = document.querySelector<HTMLElement>('.toolbar');
    if (bar && bar.getClientRects().length > 0) top = Math.max(top, bar.getBoundingClientRect().bottom);
    return Math.max(0, top);
}

/**
 * The toast on the screen above the open bubble where at its own place it
 * would cover it (round 6 §44). No room above: a toast `coming` closes the
 * bubble; else (the same bubble shown again) it stays at its place, over the
 * bubble. A toast hidden under the bubble (round 7 §52) waits for it to close.
 */
function placeToasts(coming: boolean): void {
    const at = open;
    const t = at ? shownToast() : null;
    for (const r of [...raised]) if (r !== t) unraise(r);
    // A toast hidden under the bubble waits for it to close
    if (!at || !t || t.classList.contains(HIDDEN)) return;
    const b = at.bubble.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    if (apartFrom(ownBox(t), b)) {
        unraise(t);
        return;
    }
    const own = ownBox(t);
    const edge = b.top - TOAST_GAP;
    if (edge - own.height >= roomTop() + TOAST_GAP) {
        t.style.bottom = `${Math.round(window.innerHeight - edge)}px`;
        raised.add(t);
        return;
    }
    unraise(t);
    if (coming) closeOpenBubble();
}

/** Whether the toast at its own place leaves the bubble (8 px around it) free. */
function apartFrom(own: { left: number; right: number; top: number; bottom: number }, b: DOMRect): boolean {
    return own.right <= b.left || own.left >= b.right
        || own.bottom <= b.top - TOAST_GAP || own.top >= b.bottom + TOAST_GAP;
}

/** The bubble just opened: the toasts standing where it opens hide while it is open (round 7 §52). */
function hideCovering(bubble: HTMLElement): void {
    const b = bubble.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    for (const t of toastsShown()) {
        if (t.classList.contains(HIDDEN) || apartFrom(ownBox(t), b)) continue;
        unraise(t);
        t.classList.add(HIDDEN);
        hidden.push(t);
    }
}

/** The bubble closed: the toasts hidden under it come back (a toast whose time ran out has gone). */
function showHidden(): void {
    for (const t of hidden) t.classList.remove(HIDDEN);
    hidden = [];
}

/** Another toast shows (one came, went or came back): over an open bubble, above it where it would cover it. */
function toastChanged(): void {
    if (!open) {
        unraiseAll();
        return;
    }
    liftToasts();
    placeToasts(true);
}

function install(): void {
    if (installed) return;
    installed = true;
    onToastChange(toastChanged);
    // The tree moves under a bubble that stands still on the screen: it closes.
    ZoomPan.onChange(() => closeOpenBubble());
    document.addEventListener('pointerdown', (e) => {
        const at = open;
        const target = e.target as Node | null;
        if (!at || (target && (at.bubble.contains(target) || at.owner.contains(target)))) return;
        // A press on a toast over the bubble (its button) leaves the bubble open: else the toast would glide away under it
        if ((target as Element | null)?.closest?.(TOAST_SELECTOR)) return;
        at.close();
    }, true);
}

/** Make the bubble one the top layer can show (once). */
export function prepareBubble(bubble: HTMLElement): boolean {
    if (!bubbleLayerSupported()) return false;
    if (!bubble.hasAttribute('popover')) bubble.setAttribute('popover', 'manual');
    return true;
}

/**
 * Show the bubble in the top layer (the one open before it closes); `close`
 * is how the bubble's owner closes it (its glow, its timers with it).
 */
export function showBubble(bubble: HTMLElement, owner: HTMLElement, close: () => void): void {
    install();
    const fresh = open?.bubble !== bubble;
    if (open && open.bubble !== bubble) open.close();
    open = { bubble, owner, close };
    if (prepareBubble(bubble) && !bubble.matches(':popover-open') && bubble.isConnected) {
        bubble.showPopover();
        liftToasts();
    }
    // Once its owner has placed the bubble (right after this call): a toast standing where it opens hides
    queueMicrotask(() => {
        if (open?.bubble !== bubble) return;
        if (fresh) hideCovering(bubble);
        placeToasts(false);
    });
}

/** Take the bubble out of the top layer. */
export function hideBubble(bubble: HTMLElement): void {
    if (open?.bubble === bubble) open = null;
    if (bubble.hasAttribute('popover') && bubble.matches(':popover-open')) bubble.hidePopover();
    if (!open) {
        lowerToasts();
        unraiseAll();
        showHidden();
    }
}

/** Close the bubble that is open (a new drawing, the tree moved). */
export function closeOpenBubble(): void {
    const at = open;
    open = null;
    at?.close();
}

/** The bubble open now (null: none). */
export function openBubble(): HTMLElement | null {
    return open?.bubble ?? null;
}
