/**
 * One toast on the screen at a time (GitHub #4, round 5 §39, round 6 §43).
 *
 * The app's toasts: a message (UI.showToast's `body > .toast`, every
 * variant), the undo pill (`body > .undo-toast`) and the focus confirmation
 * ("◎ Focused on … | ↩ Back", its box in the static `#focus-toast`). At
 * most one of them shows: the newest message stands, a message under it
 * waits hidden (`.toast-held`) while its own time runs and shows again when
 * the newer one goes before that time is over. The focus confirmation shows
 * only while no message stands.
 *
 * The undo pill and the focus confirmation lend their action (a "lender"):
 * while one of them waits under a newer message, its button ("Undo",
 * "↩ Back") rides in the message that shows, for the lender's own time
 * (which stands while a pointer or the keyboard is on that message); when
 * that time is over the button goes with its lender and the message runs its
 * own time to the end. Both lent at once: side by side, "Undo" first, then
 * "↩ Back".
 *
 * The same place: the toast that shows takes the place of the first one of
 * the run (`.at-message-toast`, `.at-undo-toast`, `.at-focus-toast`, where
 * the kinds stand apart: the undo pill low on a phone, the focus
 * confirmation a little higher beside a phone's bars), until the screen is
 * empty again. A toast on its way out (fading) is left as it is.
 */

export type ToastKind = 'message' | 'undo' | 'focus';

/** A toast whose button can ride in a newer message. */
export interface ToastLender {
    kind: 'undo' | 'focus';
    /** The element on the screen when it shows itself (the pill; the focus toast's container). */
    el: HTMLElement;
    /** Where its parts are when it shows itself (the pill; the focus toast's box). */
    home: HTMLElement;
    /** The parts that ride along: a separator and the button. */
    parts: HTMLElement[];
    /** Its time stands (a pointer or the keyboard on the message carrying its parts). */
    pause(): void;
    /** Its time runs again. */
    resume(): void;
    /** It shows itself (true) or waits under a message (false). */
    shown?(on: boolean): void;
}

const MESSAGES = 'body > .toast, body > .undo-toast';
const PLACE_CLASSES = ['at-message-toast', 'at-undo-toast', 'at-focus-toast'];

const lenders: ToastLender[] = [];
/** Messages seen shown: one of them without `.show` again is on its way out. */
const shownOnce = new WeakSet<Element>();
/** The kind whose place the run of toasts keeps (null: the screen is empty). */
let place: ToastKind | null = null;
let top: HTMLElement | null = null;
/** The message carrying lent parts, and how its pointer / keyboard is listened to. */
let carrier: HTMLElement | null = null;
let detachCarrier: (() => void) | null = null;
/** The lenders whose time stands for a pointer or the keyboard on the carrier. */
const paused = new Set<ToastLender>();
let carrierHeld = false;
let watch: MutationObserver | null = null;
const listeners: Array<() => void> = [];

function kindOf(el: HTMLElement): ToastKind {
    if (el.classList.contains('undo-toast')) return 'undo';
    if (el.classList.contains('toast')) return 'message';
    return 'focus';
}

/** Whether the message is still on the screen (one without `.show` again is going). */
function live(t: HTMLElement): boolean {
    if (t.classList.contains('undo-toast')) return lenders.some(l => l.el === t);
    if (t.classList.contains('show')) {
        shownOnce.add(t);
        return true;
    }
    return !shownOnce.has(t);
}

function liveMessages(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(MESSAGES)].filter(live);
}

function toggle(el: HTMLElement, cls: string, on: boolean): void {
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** The lenders lent to the carrier: their time stands while it is held, runs again when it is let go. */
function hold(on: boolean): void {
    carrierHeld = on;
    if (on) {
        for (const l of lenders) {
            if (!paused.has(l) && carrier && l.el !== carrier && l.parts[0]?.parentElement === carrier) {
                paused.add(l);
                l.pause();
            }
        }
    } else {
        for (const l of paused) if (lenders.includes(l)) l.resume();
        paused.clear();
    }
}

/** A pointer or the keyboard on the carrier `t`. */
function listenTo(t: HTMLElement): () => void {
    const enter = () => hold(true);
    const leave = () => { if (!t.contains(document.activeElement)) hold(false); };
    const focusOut = (e: FocusEvent) => {
        if (!t.contains(e.relatedTarget as Node | null) && !t.matches(':hover')) hold(false);
    };
    t.addEventListener('pointerenter', enter);
    t.addEventListener('pointerleave', leave);
    t.addEventListener('focusin', enter);
    t.addEventListener('focusout', focusOut);
    return () => {
        t.removeEventListener('pointerenter', enter);
        t.removeEventListener('pointerleave', leave);
        t.removeEventListener('focusin', enter);
        t.removeEventListener('focusout', focusOut);
    };
}

/**
 * Put `parts` in `target` before `before` (at its end: null), in this
 * order; nothing moves where they stand so already (a moved button would
 * lose the keyboard focus).
 */
function putParts(target: HTMLElement, parts: HTMLElement[], before: Element | null): void {
    if (parts.length === 0) return;
    const kids = [...target.children];
    const end = before ? kids.indexOf(before) : kids.length;
    const run = kids.slice(Math.max(0, end - parts.length), end);
    if (run.length === parts.length && parts.every((p, i) => run[i] === p)) return;
    for (const p of parts) target.insertBefore(p, before);
}

function install(): void {
    if (watch || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    // A message coming or going (one put away, or its `.show` taken: on its way out)
    watch = new MutationObserver(() => reconcile());
    watch.observe(document.body, { childList: true });
}

/** Lay the toasts out again: the newest one shows, at the run's place, carrying the lenders' buttons. */
export function reconcile(): void {
    if (typeof document === 'undefined') return;
    const messages = liveMessages();
    for (const t of messages) watch?.observe(t, { attributes: true, attributeFilter: ['class'] });
    // The newest message (the undo pill not while a dialog hides it); else the focus confirmation
    const dialog = document.querySelector('.modal-overlay.active') !== null;
    const candidates = dialog ? messages.filter(t => !t.classList.contains('undo-toast')) : messages;
    const focus = lenders.find(l => l.kind === 'focus') ?? null;
    const next = candidates[candidates.length - 1] ?? messages[messages.length - 1] ?? focus?.el ?? null;

    for (const t of messages) toggle(t, 'toast-held', t !== next);
    for (const l of lenders) l.shown?.(l.el === next);

    // The buttons: all in the message that shows ("Undo" first, the undo pill's own among them when it
    // shows); at home in the focus confirmation's box when it shows itself
    const host = next && next !== focus?.el ? next : null;
    const lent: HTMLElement[] = [];
    for (const kind of ['undo', 'focus'] as const) {
        const l = lenders.find(x => x.kind === kind);
        if (!l) continue;
        if (host) lent.push(...l.parts);
        else putParts(l.home, l.parts, null);
    }
    if (host) putParts(host, lent, host.querySelector(':scope > .toast-close'));
    const carrying = host && lenders.some(l => l.el !== host) ? host : null;
    if (carrying !== carrier) {
        detachCarrier?.();
        detachCarrier = null;
        hold(false);
        carrier = carrying;
        if (carrier) detachCarrier = listenTo(carrier);
    }
    // Under the pointer or the keyboard already (or a lender lent to it meanwhile): its time stands
    if (carrier && (carrierHeld || carrier.matches(':hover') || carrier.contains(document.activeElement))) hold(true);

    // The place: the first toast's of the run, until the screen is empty
    if (!next) place = null;
    else {
        if (!place) place = kindOf(next);
        const own = kindOf(next);
        for (const cls of PLACE_CLASSES) toggle(next, cls, cls === `at-${place}-toast` && place !== own);
    }
    const changed = next !== top;
    top = next;
    if (changed) for (const fn of listeners) fn();
}

/** The toast on the screen now (a message, the undo pill, the focus toast's container), or null. */
export function shownToast(): HTMLElement | null {
    return top && top.isConnected ? top : null;
}

/** Called when another toast shows (one came, went or came back). */
export function onToastChange(fn: () => void): void {
    listeners.push(fn);
}

/** A message (`.toast`) is about to be put on the screen: the slot listens. */
export function watchToasts(): void {
    install();
}

/** The undo pill or the focus confirmation is on the screen now. */
export function addLender(l: ToastLender): void {
    install();
    removeLender(l.kind, false);
    lenders.push(l);
    reconcile();
}

/** It goes: its parts back home (they go with it), the rest laid out again. */
export function removeLender(kind: 'undo' | 'focus', relayout = true): void {
    const i = lenders.findIndex(l => l.kind === kind);
    if (i < 0) return;
    const [l] = lenders.splice(i, 1);
    paused.delete(l);
    putParts(l.home, l.parts, null);
    l.shown?.(false);
    if (relayout) reconcile();
}
