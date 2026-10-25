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
 *
 * A toast to be read is not replaced too soon (round 7 §53): a message with
 * its own action or a notice (`data-notice`, e.g. the older-copy reminder),
 * the undo pill ("Vrátit") and the focus confirmation ("↩ Back") stand at
 * least 3 s from when they first showed. A message or an undo pill coming
 * sooner waits (`whenFree`) and shows the moment those 3 s are over (or the
 * toast went sooner), with its own full time; of several waiting, the newest
 * of each kind. A message carrying a lent button is not held for it (the
 * button rides on in the newer message), and other messages are replaced at
 * once, as before.
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

/** How long a toast to be read stands before a newer one may take its place (round 7 §53). */
export const TOAST_MIN_MS = 3000;

const lenders: ToastLender[] = [];
/** When a toast first showed (a message, the pill; the focus confirmation's box). */
const shownAt = new WeakMap<HTMLElement, number>();
/** A message and an undo pill waiting for the toast on the screen to have stood its 3 s, in the order they came. */
const waiting = new Map<'message' | 'undo', () => void>();
let waitTimer: ReturnType<typeof setTimeout> | null = null;
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
            if (!paused.has(l) && carrier && l.el !== carrier && carrier.contains(l.parts[0] ?? null)) {
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

/**
 * Where the buttons stand in the toast `host`: in a message its group of
 * actions (round 7 §55: one piece that wraps whole to the next line, its
 * separators only between two actions), made before its × where it has
 * none yet; the undo pill itself.
 */
function actionsOf(host: HTMLElement): HTMLElement {
    if (!host.classList.contains('toast')) return host;
    const own = host.querySelector<HTMLElement>(':scope > .toast-actions');
    if (own) return own;
    const group = document.createElement('span');
    group.className = 'toast-actions';
    host.insertBefore(group, host.querySelector(':scope > .toast-close'));
    return group;
}

/**
 * The room the floating controls take at the bottom of the window (round 7
 * §55): `--toast-clear-l` up to the right edge of ↩ / ↪ where they show,
 * `--toast-clear-r` from the left edge of the zoom stack (⛶), each with 8 px
 * more; 0 where none shows. The stylesheet keeps a toast in their row
 * between them (where they float: a phone, a tablet, a phone held sideways).
 */
function measureClearance(): void {
    const root = document.documentElement;
    const vw = window.innerWidth;
    let left = 0, right = 0;
    for (const id of ['focus-back-btn', 'focus-forward-btn']) {
        const r = document.getElementById(id)?.getBoundingClientRect();
        if (r && r.width > 0) left = Math.max(left, Math.ceil(r.right + 8));
    }
    for (const b of document.querySelectorAll<HTMLElement>('.zoom-controls > button')) {
        const r = b.getBoundingClientRect();
        if (r.width > 0) right = Math.max(right, Math.ceil(vw - r.left + 8));
    }
    const l = `${left}px`, r = `${right}px`;
    if (root.style.getPropertyValue('--toast-clear-l') !== l) root.style.setProperty('--toast-clear-l', l);
    if (root.style.getPropertyValue('--toast-clear-r') !== r) root.style.setProperty('--toast-clear-r', r);
}

/**
 * The undo pill's sentence is never cut (prod 3.16 finding 1). Where its
 * place is narrower than the whole sentence (on a phone its own place
 * between ↩ / ↪ and ⛶, round 7 §55, or the focus confirmation's place) it
 * turns roomy (`.undo-toast-roomy`): on a phone its own place moves above
 * those controls at the phone's width, and a sentence longer than the room
 * there wraps. Where the sentence fits it stays in its place. A pill once
 * roomy stays so (its sentence does not change); the move is not animated.
 */
function fitPill(t: HTMLElement | null): void {
    if (!t?.classList.contains('undo-toast') || t.classList.contains('undo-toast-roomy')) return;
    const msg = t.querySelector<HTMLElement>(':scope > .undo-toast-msg');
    if (!msg || msg.scrollWidth <= msg.clientWidth + 1) return;
    t.style.transition = 'none';
    t.classList.add('undo-toast-roomy');
    void t.offsetWidth;
    t.style.transition = '';
}

function install(): void {
    if (watch || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    // A message coming or going (one put away, or its `.show` taken: on its way out)
    watch = new MutationObserver(() => reconcile());
    watch.observe(document.body, { childList: true });
    // ↩ / ↪ showing or going, the window turned or resized: the floating controls' room again
    const controls = new MutationObserver(() => { if (top) { measureClearance(); fitPill(top); } });
    for (const id of ['focus-back-btn', 'focus-forward-btn']) {
        const el = document.getElementById(id);
        if (el) controls.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    controls.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => { if (top) { measureClearance(); fitPill(top); } });
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
    if (host) putParts(actionsOf(host), lent, null);
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
    if (next && next !== top) measureClearance();
    fitPill(next);
    const key = next ? keyOf(next) : null;
    if (key && !shownAt.has(key)) shownAt.set(key, Date.now());
    const changed = next !== top;
    top = next;
    if (changed) for (const fn of listeners) fn();
    if (changed && waiting.size > 0) flushWaiting();
}

/** What a toast's first showing is kept by: the focus confirmation's box (its container stays), else the toast. */
function keyOf(t: HTMLElement): HTMLElement {
    const focus = lenders.find(l => l.kind === 'focus');
    return focus && t === focus.el ? focus.home : t;
}

/** A toast to be read (round 7 §53): the undo pill, the focus confirmation, a message with its own action or a notice. */
function toBeRead(t: HTMLElement): boolean {
    if (t.classList.contains('undo-toast')) return true;
    if (!t.classList.contains('toast')) return lenders.some(l => l.kind === 'focus' && l.el === t);
    return t.dataset.notice !== undefined || t.querySelector(':scope > .toast-actions > .toast-action') !== null;
}

/** How long a newer toast waits before it may take the place of the toast on the screen (0: at once). */
export function waitBeforeReplace(): number {
    // A toast put on the screen just now (the slot hears of it a moment later)
    reconcile();
    const t = shownToast();
    if (!t || !toBeRead(t)) return 0;
    const since = shownAt.get(keyOf(t));
    return since === undefined ? 0 : Math.max(0, since + TOAST_MIN_MS - Date.now());
}

/**
 * Show a message or the undo pill (`show`) now, or, while the toast on the
 * screen has not stood its 3 s yet (round 7 §53), as soon as it has; a newer
 * one of the same kind waiting takes the older one's turn.
 */
export function whenFree(kind: 'message' | 'undo', show: () => void): void {
    waiting.delete(kind);
    if (waiting.size === 0 && waitBeforeReplace() === 0) {
        show();
        return;
    }
    waiting.set(kind, show);
    flushWaiting();
}

/** A waiting message or pill (of `kind`) no longer comes (the pill dismissed, Escape). */
export function cancelWaiting(kind: 'message' | 'undo'): void {
    if (!waiting.delete(kind) || waiting.size > 0) return;
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = null;
}

/** Whether a message or pill of `kind` waits for its turn. */
export function isWaiting(kind: 'message' | 'undo'): boolean {
    return waiting.has(kind);
}

/** The waiting ones show once the toast on the screen has stood its 3 s (the newest last, so on top). */
function flushWaiting(): void {
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = null;
    const wait = waitBeforeReplace();
    if (wait > 0) {
        waitTimer = setTimeout(flushWaiting, wait);
        return;
    }
    const due = [...waiting.values()];
    waiting.clear();
    for (const show of due) show();
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
