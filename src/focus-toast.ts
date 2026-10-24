/**
 * The confirmation after a focus set from a card's tab (§2 of the siblings
 * round): "◎ Focused on {name} | ↩ Back" at the bottom of the tree. It stays
 * 5 s (the time stands while a pointer or the keyboard focus is on it) and
 * goes at the next action in the tree: a click, a pan of more than 8 px or
 * another focus. "↩ Back" returns to the previous view, as ↩ in the corner.
 *
 * One toast at a time (round 5 §39): while a message (UI.showToast's
 * `.toast`, the `.undo-toast` pill) is on the screen together with it, the
 * confirmation's box steps aside and its "↩ Back" goes into the message,
 * which takes the confirmation's place (`.at-focus-toast`; not while two
 * messages stand stacked). "↩ Back" keeps the confirmation's own time: when
 * that runs out it leaves the message, which runs its own time to the end;
 * a message gone sooner gives the box back for the time left. The time of
 * "↩ Back" is the focus step's (it stands while a pointer or the keyboard
 * is on the message carrying it), the message's is the message's.
 *
 * The container `#focus-toast` is static in index.html (a polite live
 * region, so a screen reader hears the message); the box is put in and
 * taken out.
 */

import { strings } from './strings.js';

export const FOCUS_TOAST_MS = 5000;
const PAN_SLOP = 8;

/** The messages that take the confirmation's place. */
const MESSAGE_SELECTOR = 'body > .toast, body > .undo-toast';

let box: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let left = FOCUS_TOAST_MS;
let startedAt = 0;
let detach: (() => void) | null = null;

/** The message carrying "↩ Back" now (null: the box shows it). */
let host: HTMLElement | null = null;
let detachHost: (() => void) | null = null;
/** "↩ Back" and its separator, moved between the box and a message. */
let backParts: HTMLElement[] = [];
/** Watches the messages coming and going while the confirmation stands. */
let watch: MutationObserver | null = null;
/** Messages seen shown: one of them without `.show` again is on its way out. */
const shownOnce = new WeakSet<Element>();

function container(): HTMLElement | null {
    return document.getElementById('focus-toast');
}

function stopTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
}

function runTimer(): void {
    stopTimer();
    startedAt = Date.now();
    timer = setTimeout(hideFocusToast, left);
}

function pauseTimer(): void {
    if (!timer) return;
    left = Math.max(0, left - (Date.now() - startedAt));
    stopTimer();
}

/** The messages on the screen, the newest last (one on its way out does not count). */
function liveMessages(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)].filter(t => {
        if (t.classList.contains('show')) {
            shownOnce.add(t);
            return true;
        }
        return !shownOnce.has(t);
    });
}

/** The time stands while a pointer or the keyboard focus is on `el`. */
function pauseOn(el: HTMLElement): () => void {
    const enter = () => pauseTimer();
    const leave = () => { if (box && !el.contains(document.activeElement)) runTimer(); };
    const focusOut = (e: FocusEvent) => {
        if (box && !el.contains(e.relatedTarget as Node | null) && !el.matches(':hover')) runTimer();
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', enter);
    el.addEventListener('focusout', focusOut);
    return () => {
        el.removeEventListener('pointerenter', enter);
        el.removeEventListener('pointerleave', leave);
        el.removeEventListener('focusin', enter);
        el.removeEventListener('focusout', focusOut);
    };
}

/** "↩ Back" into the message `t` (before its × when it has one). */
function attach(t: HTMLElement): void {
    host = t;
    const close = t.querySelector(':scope > .toast-close');
    for (const part of backParts) t.insertBefore(part, close);
    detachHost = pauseOn(t);
    if (box) box.hidden = true;
}

/**
 * "↩ Back" out of the message carrying it: back into the box (`toBox`), or
 * gone with the confirmation. The message keeps its place
 * (`.at-focus-toast`) while it stays, unless it goes on carrying nothing.
 */
function release(toBox: boolean): void {
    if (!host) return;
    detachHost?.();
    detachHost = null;
    if (toBox) host.classList.remove('at-focus-toast');
    host = null;
    if (toBox && box) {
        for (const part of backParts) box.appendChild(part);
        box.hidden = false;
        // A pointer that stood on the message paused the time: it runs again
        if (!timer && !box.matches(':hover') && !box.contains(document.activeElement)) runTimer();
    } else {
        for (const part of backParts) part.remove();
    }
}

/**
 * A message left at the confirmation's place without "↩ Back" runs its time
 * there (it does not jump); another message coming meanwhile stacks with it,
 * so it goes back to its own place then.
 */
function keepPlace(t: HTMLElement): void {
    if (typeof MutationObserver === 'undefined' || !t.classList.contains('at-focus-toast')) return;
    const stay = new MutationObserver(() => {
        if (t.isConnected && liveMessages().every(m => m === t)) return;
        t.classList.remove('at-focus-toast');
        stay.disconnect();
    });
    stay.observe(document.body, { childList: true });
}

/** One toast on the screen: the newest message carries "↩ Back", else the box. */
function reconcile(): void {
    if (!box) return;
    const messages = liveMessages();
    for (const t of messages) watch?.observe(t, { attributes: true, attributeFilter: ['class'] });
    const next = messages[messages.length - 1] ?? null;
    if (next !== host) {
        release(true);
        if (next) attach(next);
    }
    // At the confirmation's place, unless it stands stacked with another message
    if (host) host.classList.toggle('at-focus-toast', messages.length === 1);
}

/** Take the confirmation away (at once); a message carrying "↩ Back" stays without it. */
export function hideFocusToast(): void {
    stopTimer();
    detach?.();
    detach = null;
    watch?.disconnect();
    watch = null;
    const carrying = host;
    release(false);
    if (carrying) keepPlace(carrying);
    backParts = [];
    box?.remove();
    box = null;
}

/** Whether the confirmation is on screen (in its box or as "↩ Back" in a message). */
export function isFocusToastShown(): boolean {
    return box !== null;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Show "◎ Focused on {name} | ↩ Back"; `back` runs on "↩ Back" (the previous
 * view), after the confirmation has gone.
 */
export function showFocusToast(name: string, back: () => void): void {
    hideFocusToast();
    const container_ = container();
    if (!container_) return;
    const el = document.createElement('div');
    el.className = 'focus-toast-box';
    // The name in its own element (weight 600); the message is built around it.
    const marker = '\u0000';
    const [before, after = ''] = strings.focus.focusToast(marker).split(marker);
    el.innerHTML = `<span class="focus-toast-glyph" aria-hidden="true">◎</span>`
        + `<span class="focus-toast-msg">${escapeHtml(before)}<strong class="focus-toast-name">${escapeHtml(name)}</strong>${escapeHtml(after)}</span>`
        + `<span class="focus-toast-sep" aria-hidden="true"></span>`
        + `<button type="button" class="focus-toast-back" aria-label="${escapeHtml(strings.focus.focusToastAria)}">${escapeHtml(strings.focus.focusToastBack)}</button>`;
    el.querySelector('.focus-toast-back')?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideFocusToast();
        back();
    });
    backParts = [...el.querySelectorAll<HTMLElement>('.focus-toast-sep, .focus-toast-back')];
    // The time stands while a pointer or the keyboard focus is on it
    const detachBox = pauseOn(el);
    container_.appendChild(el);
    box = el;
    requestAnimationFrame(() => { if (box === el) el.classList.add('show'); });
    left = FOCUS_TOAST_MS;
    runTimer();

    // The next action in the tree takes it away: a click, a pan of more
    // than 8 px. It is shown after the focus has been set (the click that
    // set it is over), so it listens at once; on the window, ahead of the
    // canvas's own listeners (a pan stops a click's propagation). The
    // message carrying "↩ Back" is not outside.
    let down: { x: number; y: number } | null = null;
    const outside = (e: Event) => !el.contains(e.target as Node) && !(host?.contains(e.target as Node));
    const onDown = (e: PointerEvent) => { down = outside(e) ? { x: e.clientX, y: e.clientY } : null; };
    const onMove = (e: PointerEvent) => {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > PAN_SLOP) hideFocusToast();
    };
    const onClick = (e: MouseEvent) => { if (outside(e)) hideFocusToast(); };
    const onWheel = (e: WheelEvent) => { if (outside(e)) hideFocusToast(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    detach = () => {
        detachBox();
        window.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('wheel', onWheel, true);
    };

    // One toast at a time: a message on the screen now or coming takes its place
    if (typeof MutationObserver !== 'undefined') {
        watch = new MutationObserver(reconcile);
        watch.observe(document.body, { childList: true });
    }
    reconcile();
}
