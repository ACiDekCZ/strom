/**
 * The confirmation after a focus set from a card's tab (§2 of the siblings
 * round): "◎ Focused on {name} | ↩ Back" at the bottom of the tree. It stays
 * 5 s (the time stands while a pointer or the keyboard focus is on it) and
 * goes at the next action in the tree: a click, a pan of more than 8 px or
 * another focus. "↩ Back" returns to the previous view, as ↩ in the corner.
 *
 * One toast at a time (round 5 §39, round 6 §43, src/toast-slot.ts): while
 * a message (UI.showToast's `.toast`, the `.undo-toast` pill) is on the
 * screen together with it, the confirmation's box steps aside and its
 * "↩ Back" rides in the message that shows, which takes the place of the
 * first toast of the run. "↩ Back" keeps the confirmation's own time (it
 * stands while a pointer or the keyboard is on the message carrying it):
 * when that runs out it leaves the message, which runs its own time to the
 * end; a message gone sooner gives the box back for the time left.
 *
 * The container `#focus-toast` is static in index.html (a polite live
 * region, so a screen reader hears the message); the box is put in and
 * taken out.
 */

import { strings } from './strings.js';
import { addLender, removeLender } from './toast-slot.js';

export const FOCUS_TOAST_MS = 5000;
const PAN_SLOP = 8;

let box: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let left = FOCUS_TOAST_MS;
let startedAt = 0;
let detach: (() => void) | null = null;

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

/** The time runs again (a message carrying "↩ Back" let go), unless a pointer or the keyboard is on the box. */
function resumeTimer(): void {
    if (box && !timer && !box.matches(':hover') && !box.contains(document.activeElement)) runTimer();
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

/** Take the confirmation away (at once); a message carrying "↩ Back" stays without it, at its place. */
export function hideFocusToast(): void {
    stopTimer();
    detach?.();
    detach = null;
    const was = box;
    box = null;
    if (was) removeLender('focus');
    was?.remove();
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
    const parts = [...el.querySelectorAll<HTMLElement>('.focus-toast-sep, .focus-toast-back')];
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
    // canvas's own listeners (a pan stops a click's propagation). A message
    // (the one carrying "↩ Back") is not outside.
    let down: { x: number; y: number } | null = null;
    const outside = (e: Event) => {
        const target = e.target as Element | null;
        return !el.contains(target) && !target?.closest?.('body > .toast, body > .undo-toast');
    };
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

    // One toast at a time: a message on the screen now or coming shows, carrying "↩ Back"
    addLender({
        kind: 'focus', el: container_, home: el, parts,
        pause: pauseTimer, resume: resumeTimer,
        shown: (on) => { el.hidden = !on; },
    });
}
