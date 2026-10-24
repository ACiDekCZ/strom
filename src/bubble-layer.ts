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
 * a bubble < a toast; the focus toast carries "↩ Back"). A toast that comes
 * while a bubble is open closes the bubble. One already on the screen when
 * a bubble opens is lifted into the top layer after it (so above it) while
 * the bubble stays open, and put back when it closes: a toast stays under
 * dialogs everywhere else.
 */

import { ZoomPan } from './zoom.js';

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

/** The toasts on the screen now. */
function toastsShown(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(TOAST_SELECTOR)].filter(t => t.id !== 'focus-toast' || t.childElementCount > 0);
}

/** The toasts lifted over the open bubble. */
let lifted: HTMLElement[] = [];

/** Lift the toasts on the screen into the top layer, over the bubble just shown there. */
function liftToasts(): void {
    for (const t of toastsShown()) {
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

/** Watches for a toast coming while a bubble is open: it closes the bubble. */
let toastWatch: MutationObserver | null = null;

function watchToasts(): void {
    if (toastWatch || typeof MutationObserver === 'undefined') return;
    toastWatch = new MutationObserver(records => {
        const came = records.some(r => [...r.addedNodes].some(n => n instanceof HTMLElement
            && ((r.target as Element).id === 'focus-toast' || n.matches('.toast, .undo-toast'))));
        if (came) closeOpenBubble();
    });
    toastWatch.observe(document.body, { childList: true });
    const focusToast = document.getElementById('focus-toast');
    if (focusToast) toastWatch.observe(focusToast, { childList: true });
}

function unwatchToasts(): void {
    toastWatch?.disconnect();
    toastWatch = null;
}

function install(): void {
    if (installed) return;
    installed = true;
    // The tree moves under a bubble that stands still on the screen: it closes.
    ZoomPan.onChange(() => closeOpenBubble());
    document.addEventListener('pointerdown', (e) => {
        const at = open;
        const target = e.target as Node | null;
        if (!at || (target && (at.bubble.contains(target) || at.owner.contains(target)))) return;
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
    if (open && open.bubble !== bubble) open.close();
    open = { bubble, owner, close };
    if (prepareBubble(bubble) && !bubble.matches(':popover-open') && bubble.isConnected) {
        bubble.showPopover();
        liftToasts();
        watchToasts();
    }
}

/** Take the bubble out of the top layer. */
export function hideBubble(bubble: HTMLElement): void {
    if (open?.bubble === bubble) open = null;
    if (bubble.hasAttribute('popover') && bubble.matches(':popover-open')) bubble.hidePopover();
    if (!open) {
        unwatchToasts();
        lowerToasts();
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
