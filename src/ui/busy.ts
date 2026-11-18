/**
 * One "working" state for the whole app (waiting buttons §1, §10): an element
 * that started something is locked at once (0 ms: `aria-disabled`, a second
 * click or Enter / Space goes nowhere), shows the state after 120 ms (the one
 * spinner `.busy-spin` and the words of what happens, `aria-busy`), keeps it
 * shown for 300 ms at least, and ends with one result: ✓ for 2 s where the
 * result is not seen otherwise, or one sentence (`.busy-msg`, `role=alert`,
 * neutral ones `role=status`) with "Try again" under the element. An element
 * gone meanwhile (a closed menu, dialog or toast) hands its state to its row
 * (`rowOf`) or to a toast, and its end to a toast.
 *
 * Working is not disabled: the element keeps its full colour (no dimming) and
 * the keyboard focus. Its width does not change while the state lasts: the
 * idle, working and done words stand in one grid cell (`.bl`), only one seen.
 */

import { strings } from '../strings.js';
import { showToast, showProgressToast, type LongOpts, type ProgressToastHandle, type ToastHandle } from './toast.js';
import { setResearchOpenLabel } from './research-open-mark.js';

export type { LongOpts } from './toast.js';

export type BusyErrKind = 'error' | 'busy' | 'offline' | 'timeout' | 'notfound' | 'network';

export type BusyEnd =
    /** `done`: the ✓ words (2 s), only where the result is not seen otherwise; `announce`: said to the screen reader. */
    /** `summary`: the progress toast's summary instead of `done` (null: it just goes, another toast tells the result). */
    | { ok: true; done?: string; announce?: string; summary?: string | null }
    /**
     * `neutral`: not an error (a question such as "Did the terminal not open?", `role=status`, no error colour);
     * `hint`: a line under it; `retry` draws "Try again", `alt` one more action.
     */
    /** `title`: a toast's heading over the text (the end in a toast). */
    | { ok: false; kind: BusyErrKind; text: string; retry?: () => void; alt?: BusyAlt; hint?: string; neutral?: boolean; title?: string };

/** One more action of an end; `research`/`ai`: it opens the research (its mark drawn, as in a toast). */
export interface BusyAlt { label: string; run: () => void; research?: boolean; ai?: boolean }

/** What an action waits for, and so how long at most (§10.3). */
export type BusyKind = 'bridge' | 'write' | 'tree' | 'terminal' | 'queueWork' | 'local' | 'satellite' | 'network';

export interface BusyOpts {
    /** The words while working ("Sending…"); without them a button says strings.busy.generic ("Loading…"). */
    label?: string;
    /** The ✓ words of an element prepared without them. */
    done?: string;
    /** The region with `aria-busy` (a list, a row); the element itself by default. */
    area?: Element;
    /** §4: when the element goes (a menu), this row takes its state. */
    rowOf?: Element;
    /** §2: a long action, its progress toast. */
    long?: LongOpts;
    /** §10.3; without it, by `kind`. */
    timeoutMs?: number;
    kind?: BusyKind;
    /** Where the end's sentence goes (default: under the element, see busyMessageHost). */
    msgIn?: Element;
    /** §8: a heavy computation follows: the state is painted first (`'now'`: shown at once, no 120 ms wait). */
    heavy?: boolean | 'now';
    /** Network work that surely takes longer than 120 ms (a tree from the research): the state shown at once. */
    atOnce?: boolean;
    /** The state goes to a toast when the element and its row are gone (default: true for a long action or a terminal). */
    toastWhenGone?: boolean;
    /** A failed end goes to a toast even with the element seen (a toolbar has no room for a sentence, 1e). */
    endToast?: boolean;
    /** The steps only in the progress toast: the element keeps its words (a toolbar button, 2d). */
    stepsInToast?: boolean;
    /**
     * The working words stand in this line (the hint under a segment) instead of in the element, which keeps its
     * own (the spinner alone, drawn with it: `busyButtonHtml(…, '', …, { own: true })`); its words are back after.
     */
    wordsIn?: HTMLElement;
}

export interface BusyCtl {
    /** Cancel / the time limit / leaving. */
    signal: AbortSignal;
    /** §2: a step and "k of n" (a progress toast), else the element's words. */
    step(text: string, k?: number, n?: number, size?: string): void;
    /** The end said outright (else taken from what fn returns or throws). */
    end(e: BusyEnd): void;
}

/** Nothing shows sooner: actions shorter than this do not blink. */
export const BUSY_SHOW_MS = 120;
/** A state once shown stays at least this long. */
export const BUSY_MIN_MS = 300;
/** The ✓ stands this long. */
export const BUSY_DONE_MS = 2000;
/** A long action shows its progress toast after this long even while its element is seen. */
export const BUSY_LONG_TOAST_MS = 3000;

/** The time limit of each kind of action (§10.3; Infinity: none). */
export const BUSY_TIMEOUTS: Readonly<Record<BusyKind, number>> = {
    bridge: 15_000,
    write: 30_000,
    tree: 120_000,
    terminal: 10_000,
    queueWork: 30_000,
    satellite: 10_000,
    network: 10_000,
    local: Infinity,
};

type Phase = 'lock' | 'busy' | 'done';

interface BusyState {
    phase: Phase;
    opts: BusyOpts;
    label: string;
    shownAt: number;
    showTimer: ReturnType<typeof setTimeout> | null;
    watch: ReturnType<typeof setInterval> | null;
    longTimer: ReturnType<typeof setTimeout> | null;
    doneTimer: ReturnType<typeof setTimeout> | null;
    /** Where the state is drawn now: the element, its row, or nothing (a toast). */
    drawnOn: HTMLElement | null;
    toast: ProgressToastHandle | null;
    prevDisabled: string | null;
    prevBusy: string | null;
    guard: (e: Event) => void;
    /** Undo the element's working look (a structure made for this run goes again). */
    undraw: (() => void) | null;
    /** The ✓ look (a structure made for this run gets its ✓ part). */
    drawDone: ((text: string) => void) | null;
    released: boolean;
    /** The last step said (the progress toast starts with it). */
    lastStep: { step: string; k?: number; n?: number; size?: string } | null;
    /** The element that carries the state now (a list drawn anew puts a new one in place of the first). */
    el: HTMLElement;
    /** How the element is found again after a redraw (null: it cannot be). */
    ident: string | null;
    /** The working words in `opts.wordsIn` while they are seen there. */
    wordsLine?: HTMLElement | null;
}

const states = new WeakMap<HTMLElement, BusyState>();
/** The sentence of each element's last end (it goes on the next try). */
const messages = new WeakMap<HTMLElement, HTMLElement>();
/** The toast of each element's last end (it goes on the next try). */
const endToasts = new WeakMap<HTMLElement, ToastHandle>();

function reducedMotion(): boolean {
    try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { return false; }
}

/** Whether the element is working (locked or showing the state): a guard against a second start. */
export function isBusy(el: HTMLElement): boolean {
    const st = states.get(el);
    return !!st && (st.phase === 'lock' || st.phase === 'busy');
}

/**
 * One heavy computation under the working state of `el` (§8): painted before it, and with `atOnce` (a large tree:
 * the computation runs longer than 120 ms and the page cannot paint meanwhile) its words shown at once. Without an
 * element the work runs at once. Resolves with the work's result (undefined when `el` was busy already).
 */
export async function runHeavy<T>(el: HTMLElement | null, work: () => T | Promise<T>,
    opts: { label: string; atOnce: boolean; toastWhenGone?: boolean }): Promise<T | undefined> {
    if (!el) return work();
    return runBusy(el, async () => { await nextPaint(); return work(); }, {
        heavy: opts.atOnce ? 'now' : true, label: opts.label, ...(opts.toastWhenGone ? { toastWhenGone: true } : {}),
    });
}

/** Two frames: the state is painted before a heavy computation (§8). */
export function nextPaint(): Promise<void> {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame !== 'function') { setTimeout(resolve, 0); return; }
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The one spinner (12 / 14 / 16 px). */
export function busySpinHtml(size: 12 | 14 | 16 = 14): string {
    return `<i class="busy-spin${size === 14 ? '' : ` s${size}`}" aria-hidden="true"></i>`;
}

/** The spinner as an element. */
export function spinEl(size: 12 | 14 | 16 = 14): HTMLElement {
    const i = document.createElement('i');
    i.className = size === 14 ? 'busy-spin' : `busy-spin s${size}`;
    i.setAttribute('aria-hidden', 'true');
    return i;
}

/**
 * How a prepared element keeps its words: `own` — the working and ✓ words drawn with it stay whatever words the
 * action brings (a short "Analyzing…" where the action's sentence would widen the button; the sentence still
 * titles its progress toast when the element is gone).
 */
export interface PrepareOpts { own?: boolean }

/**
 * A button's inside for the working state (§1.2), drawn once with the button: the idle words, the working words
 * with the spinner and the ✓ words in one cell (the width of the longest from the start). `label` is HTML.
 */
export function busyButtonHtml(labelHtml: string, busyLabel: string, done?: string, opts: PrepareOpts = {}): string {
    return `<span class="bl"${opts.own ? ' data-words="own"' : ''}><span class="b-idle">${labelHtml}</span>`
        + `<span class="b-busy" aria-hidden="true">${busySpinHtml()}${esc(busyLabel)}</span>`
        + `<span class="b-done" aria-hidden="true"><span class="ok">✓</span>${esc(done ?? '')}</span></span>`;
}

/**
 * §5: the empty place of a link's spinner, drawn with the link (12 px after its text from the start, so the line
 * does not move when the spinner comes).
 */
export function busySlotHtml(): string {
    return '<span class="busy-slot" aria-hidden="true"></span>';
}

/** The same as an element (appended to a link built as DOM). */
export function busySlotEl(): HTMLElement {
    const slot = document.createElement('span');
    slot.className = 'busy-slot';
    slot.setAttribute('aria-hidden', 'true');
    return slot;
}

/**
 * Gives a link in text its 12 px slot (§5) right after its words, before the research's mark (the mark stays
 * last): the spinner then comes in it after the text and nothing moves. Idempotent.
 */
export function reserveBusySlot(link: HTMLElement): HTMLElement {
    const kept = link.querySelector<HTMLElement>(':scope > .busy-slot');
    if (kept) return link;
    const slot = busySlotEl();
    const mark = Array.from(link.children).find(c => c.matches(MARK_SELECTOR));
    if (mark) link.insertBefore(slot, mark); else link.appendChild(slot);
    return link;
}

/** The research's marks in an element: they stay outside `.bl`, last on the screen. */
const MARK_SELECTOR = '.research-ai-badge, .research-open-mark';

/** An element whose text stays and gets the spinner after it (a link in text, a menu item, a toast's action). */
function trailsSpinner(el: HTMLElement): boolean {
    // A link in text drawn with its slot (§5, `busySlotHtml`) trails it too; other link-styled buttons keep their words.
    return el.matches('a, .link, button.link, .btn-link, [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')
        || el.querySelector(':scope > .busy-slot') !== null;
}

/** A button of an icon alone (⋯, ✕, an SVG): the spinner takes the icon's place, no words. */
function iconOnly(el: HTMLElement): boolean {
    const text = (el.textContent ?? '').replace(/\s+/g, '');
    return text.length <= 1 || (text.length <= 2 && !/\p{L}/u.test(text));
}

/**
 * Wrap an existing button's inside into the working structure (§1.2): its content becomes the idle part, the
 * research's marks stay after it. Kept (an element prepared once stays prepared); `busyLabel` and `done` renew it.
 */
export function prepareBusy(el: HTMLElement, busyLabel: string, done?: string, opts: PrepareOpts = {}): void {
    const kept = el.querySelector<HTMLElement>(':scope > .bl');
    const bl = kept ?? (wrap(el, busyLabel, done), el.querySelector<HTMLElement>(':scope > .bl')!);
    if (opts.own) bl.dataset.words = 'own';
    else delete bl.dataset.words;
    if (kept) setBusyWords(bl, busyLabel, done, true);
    if (!kept || !el.dataset.busy) el.dataset.busy = 'idle';
}

/** The words of a prepared `.bl` anew; its own words (`PrepareOpts.own`) stay unless `renew`. */
function setBusyWords(bl: HTMLElement, busyLabel: string, done?: string, renew = false): void {
    if (bl.dataset.words === 'own' && !renew) return;
    const busy = bl.querySelector<HTMLElement>(':scope > .b-busy');
    if (busy) {
        const spin = busy.querySelector('.busy-spin') ?? spinEl();
        busy.replaceChildren(spin, document.createTextNode(busyLabel));
    }
    const ok = bl.querySelector<HTMLElement>(':scope > .b-done');
    if (ok && done !== undefined) {
        const mark = document.createElement('span');
        mark.className = 'ok';
        mark.textContent = '✓';
        ok.replaceChildren(mark, document.createTextNode(done));
    }
}

/** Make the structure; the returned function puts the element's inside back as it was. */
function wrap(el: HTMLElement, busyLabel: string, done?: string): () => void {
    const marks = [...el.querySelectorAll<HTMLElement>(MARK_SELECTOR)].map(m => ({ m, parent: m.parentNode, next: m.nextSibling }));
    for (const { m } of marks) m.remove();
    const original = [...el.childNodes];
    const icon = iconOnly(el);
    const bl = document.createElement('span');
    bl.className = 'bl';
    const idle = document.createElement('span');
    idle.className = 'b-idle';
    idle.append(...original);
    const busy = document.createElement('span');
    busy.className = 'b-busy';
    busy.setAttribute('aria-hidden', 'true');
    busy.appendChild(spinEl());
    if (!icon) busy.appendChild(document.createTextNode(busyLabel));
    const ok = document.createElement('span');
    ok.className = 'b-done';
    ok.setAttribute('aria-hidden', 'true');
    const mark = document.createElement('span');
    mark.className = 'ok';
    mark.textContent = '✓';
    ok.appendChild(mark);
    if (!icon && done) ok.appendChild(document.createTextNode(done));
    bl.append(idle, busy, ok);
    el.replaceChildren(bl, ...marks.map(x => x.m));
    return () => {
        for (const { m, parent, next } of marks) {
            if (parent) parent.insertBefore(m, next && next.parentNode === parent ? next : null);
        }
        el.replaceChildren(...original);
    };
}

/** A menu dialog's row (`.menu-option` with its title and description): its text part. */
function optionText(el: HTMLElement): HTMLElement | null {
    return el.matches('.menu-option') ? el.querySelector<HTMLElement>(':scope > .option-text') : null;
}

/** Where the working words of `el` stand now (its `.bl` part or its row's line), for a step or new words. */
function workingWords(el: HTMLElement): HTMLElement | null {
    const cell = el.querySelector<HTMLElement>(':scope > .bl > .b-busy');
    if (cell) return cell.parentElement?.dataset.words === 'own' ? null : cell;
    return el.querySelector<HTMLElement>(':scope > .option-text > .option-busy');
}

/** Draw the working look on `el`; gives back how to undo it and how to show ✓. */
function draw(el: HTMLElement, label: string, done: string | undefined): { undraw: () => void; drawDone: (text: string) => void } {
    const own = el.querySelector<HTMLElement>(':scope > .bl');
    if (own) {
        setBusyWords(own, label, done);
        return {
            undraw: () => { el.dataset.busy = 'idle'; },
            drawDone: (text) => { setBusyWords(own, label, text); el.dataset.busy = 'done'; },
        };
    }
    if (trailsSpinner(el)) {
        // §5: a link drawn with its slot (12 px kept from the start, the line does not move) fills it.
        const kept = el.querySelector<HTMLElement>(':scope > .busy-slot');
        const slot = kept ?? document.createElement('span');
        slot.className = 'busy-slot';
        slot.setAttribute('aria-hidden', 'true');
        slot.replaceChildren(spinEl(12));
        if (!kept) el.appendChild(slot);
        return {
            undraw: () => { if (kept) kept.replaceChildren(); else slot.remove(); delete el.dataset.busy; },
            drawDone: () => {
                const ok = document.createElement('span');
                ok.className = 'ok';
                ok.textContent = '✓';
                slot.replaceChildren(ok);
                el.dataset.busy = 'done';
            },
        };
    }
    const option = optionText(el);
    if (option) {
        // A row of a menu dialog (its title and description are the button): the words go on a line of their own
        // under them (2g, 9a), the row's text stays.
        const line = document.createElement('span');
        line.className = 'option-busy';
        line.append(spinEl(12), document.createTextNode(label));
        option.appendChild(line);
        return {
            undraw: () => { line.remove(); delete el.dataset.busy; },
            drawDone: (text) => {
                const ok = document.createElement('span');
                ok.className = 'ok';
                ok.textContent = '✓';
                line.replaceChildren(ok, document.createTextNode(text));
                el.dataset.busy = 'done';
            },
        };
    }
    const unwrap = wrap(el, label, done);
    return {
        undraw: () => { unwrap(); delete el.dataset.busy; },
        drawDone: (text) => {
            const bl = el.querySelector<HTMLElement>(':scope > .bl');
            if (bl) setBusyWords(bl, label, text);
            el.dataset.busy = 'done';
        },
    };
}

/** A row taking the state of an element gone (§4): the spinner at its end. */
function drawOnRow(row: HTMLElement): { undraw: () => void; drawDone: (text: string) => void } {
    const slot = document.createElement('span');
    slot.className = 'busy-slot busy-row-end';
    slot.setAttribute('aria-hidden', 'true');
    slot.appendChild(spinEl(12));
    row.appendChild(slot);
    const prev = row.getAttribute('aria-busy');
    row.setAttribute('aria-busy', 'true');
    row.dataset.busy = 'busy';
    const undo = (): void => {
        slot.remove();
        if (prev === null) row.removeAttribute('aria-busy');
        else row.setAttribute('aria-busy', prev);
        delete row.dataset.busy;
    };
    return {
        undraw: undo,
        drawDone: () => {
            const ok = document.createElement('span');
            ok.className = 'ok';
            ok.textContent = '✓';
            slot.replaceChildren(ok);
            row.dataset.busy = 'done';
        },
    };
}

/** On the screen: in the page and drawn (a menu hidden by its class, `display: none`, is gone too). */
function seen(el: Element | null | undefined): el is HTMLElement {
    if (!el || !el.isConnected) return false;
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
}

// ==================== THE ELEMENT OF THE CLICK ====================

let activated: HTMLElement | null = null;
let activatedClear: ReturnType<typeof setTimeout> | null = null;
let tracking = false;
const ACTIVATABLE = 'button, a, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], [role="tab"]';

/**
 * Remember the element a click or Enter / Space started (for code that hands no element to `runBusy`, e.g. the
 * links into the research): valid in that task only (and its microtasks), cleared right after.
 */
export function trackActivations(): void {
    if (tracking || typeof document === 'undefined') return;
    tracking = true;
    const note = (e: Event): void => {
        // The app's own clicks (a hidden link handed to the system) are not a person's.
        if (!e.isTrusted) return;
        if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
        const t = e.target instanceof Element ? e.target.closest<HTMLElement>(ACTIVATABLE) : null;
        activated = t;
        if (activatedClear) clearTimeout(activatedClear);
        activatedClear = setTimeout(() => { activated = null; activatedClear = null; }, 0);
    };
    document.addEventListener('click', note, true);
    document.addEventListener('keydown', note, true);
    watchPointer();
}

/** The element the current click or key started (null: none, or another task). */
export function activatedElement(): HTMLElement | null {
    return activated;
}

// ==================== THE SCREEN READER ====================

/** Say `text` politely (one live region for the working states). */
export function announceBusy(text: string): void {
    if (!text || typeof document === 'undefined') return;
    let region = document.getElementById('busy-announce');
    if (!region) {
        region = document.createElement('div');
        region.id = 'busy-announce';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
    }
    region.textContent = '';
    const r = region;
    setTimeout(() => { r.textContent = text; }, 30);
}

// ==================== THE END'S SENTENCE ====================

/** Where the end's sentence of `el` goes: `msgIn`, the nearest `.busy-host`, else after the element's group. */
function placeMessage(el: HTMLElement, msg: HTMLElement, opts: BusyOpts): void {
    if (opts.msgIn) { opts.msgIn.appendChild(msg); return; }
    const host = el.closest('.busy-host');
    if (host) { host.appendChild(msg); return; }
    // A menu dialog's row: right under it (the row is a button, the sentence and its action cannot be in it).
    if (el.matches('.menu-option')) { el.after(msg); return; }
    const parent = el.parentElement;
    // A dialog's footer: the sentence above it (the footer stays the dialog's last line, §10.1 a).
    if (parent?.matches('.modal .buttons, .modal-footer, .mdlg-foot, .book-dlg-foot, .fp-foot')) {
        // Its sides in line with the footer's own (each dialog and width has its own padding).
        const cs = getComputedStyle(parent);
        msg.classList.add('busy-msg--foot');
        msg.style.setProperty('--foot-pad-l', cs.paddingLeft);
        msg.style.setProperty('--foot-pad-r', cs.paddingRight);
        parent.before(msg);
        return;
    }
    // A group of actions or a line of text: the sentence under the whole group; a big container: right after the element.
    const big = !parent || parent === document.body || parent.matches('form, section, dialog, .modal, .modal-body, .modal-content')
        || parent.childElementCount > 8;
    if (!big && parent?.parentElement) parent.after(msg);
    else el.after(msg);
}

/**
 * The element's identity over a redraw (a list drawn anew puts a new button in its place): its id, or its
 * `data-action` within the nearest row that has a `data-id` or an id (under the nearest container with an id).
 * Null: the element cannot be told again after a redraw.
 */
function identOf(el: HTMLElement): string | null {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const act = el.dataset.action;
    if (!act) return null;
    const row = el.parentElement?.closest<HTMLElement>('[data-id], [id]');
    if (!row) return null;
    if (row.id) return `#${CSS.escape(row.id)} [data-action="${CSS.escape(act)}"]`;
    const top = row.parentElement?.closest<HTMLElement>('[id]');
    return `${top ? `#${CSS.escape(top.id)} ` : ''}[data-id="${CSS.escape(row.dataset.id ?? '')}"] [data-action="${CSS.escape(act)}"]`;
}

/** Sentences whose element may be drawn anew: the sentence follows to the new element (§10.1 a, 3c). */
const following = new Map<HTMLElement, { msg: HTMLElement; ident: string; opts: BusyOpts }>();
let followTimer: ReturnType<typeof setInterval> | null = null;
let followObserver: MutationObserver | null = null;

/**
 * The states whose element may be drawn anew (locked or working, with an identity): when the page changes, the
 * state moves to the new element at once, before the page is painted or takes a click (§1.2: no moment at rest
 * between two redraws, no second start in it). The 400 ms watch of each state stays besides.
 */
const moving = new Set<BusyState>();

function followStates(): void {
    for (const st of moving) {
        if (st.phase !== 'lock' && st.phase !== 'busy' || st.released) { moving.delete(st); continue; }
        // Drawn on its row or in a toast: the watch decides (the element is not what shows it).
        if (st.phase === 'busy' && st.drawnOn !== st.el && st.drawnOn !== null) continue;
        // Still in the page (a redraw takes it out): nothing to do, and no layout read on every change.
        if (st.el.isConnected) continue;
        moveToRedrawn(st);
    }
}

function onPageChange(): void {
    followStates();
    followMessages();
}

/** The one observer of the page while a state or a sentence may follow its element. */
function observePage(): void {
    if (followObserver || typeof MutationObserver !== 'function' || !document.body) return;
    followObserver = new MutationObserver(onPageChange);
    followObserver.observe(document.body, { childList: true, subtree: true });
}

function stopObservingIfIdle(): void {
    if (following.size || moving.size) return;
    followObserver?.disconnect();
    followObserver = null;
}

function followMessages(): void {
    for (const [el, f] of following) {
        if (f.msg.dataset.closed || !messages.has(el) || messages.get(el) !== f.msg) { following.delete(el); continue; }
        if (f.msg.isConnected) continue;
        // Taken away on purpose while its element stays: it goes.
        if (el.isConnected) { following.delete(el); continue; }
        const next = Array.from(document.querySelectorAll<HTMLElement>(f.ident)).find(seen);
        // The element gone for good (a dialog closed): the sentence goes with it.
        if (!next) { following.delete(el); continue; }
        placeMessage(next, f.msg, f.opts);
    }
    if (!following.size) {
        if (followTimer) { clearInterval(followTimer); followTimer = null; }
        stopObservingIfIdle();
    }
}

function follow(el: HTMLElement, msg: HTMLElement, opts: BusyOpts): void {
    if (opts.msgIn) return;
    const ident = identOf(el);
    if (!ident) return;
    following.set(el, { msg, ident, opts });
    // At once when the page changes (a redraw), and a slow check besides (an observer may be missing).
    observePage();
    followTimer ??= setInterval(followMessages, 400);
}

/** The end of `el` as a sentence under it (`role=alert`, neutral ones `role=status`) with "Try again". */
export function showBusyMessage(el: HTMLElement, end: Extract<BusyEnd, { ok: false }>, opts: BusyOpts = {}): HTMLElement {
    clearBusyMessage(el);
    const msg = document.createElement('div');
    msg.className = end.neutral ? 'busy-msg' : 'busy-msg is-err';
    msg.setAttribute('role', end.neutral ? 'status' : 'alert');
    const text = document.createElement('span');
    text.className = 'busy-msg__text';
    text.textContent = end.text;
    msg.appendChild(text);
    const act = (label: string, run: () => void, cls: string, mark?: { research?: boolean; ai?: boolean }): void => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `link ${cls}`;
        if (mark?.research) setResearchOpenLabel(b, label, { ai: !!mark.ai });
        else b.textContent = label;
        b.addEventListener('click', () => { msg.dataset.closed = '1'; msg.remove(); run(); });
        msg.appendChild(b);
    };
    if (end.retry) act(strings.busy.retry, end.retry, 'busy-msg__retry');
    if (end.alt) act(end.alt.label, end.alt.run, 'busy-msg__alt', end.alt);
    if (end.hint) {
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = end.hint;
        msg.appendChild(hint);
    }
    placeMessage(el, msg, opts);
    messages.set(el, msg);
    follow(el, msg, opts);
    return msg;
}

/** The sentence (or toast) of `el`'s last end goes (another try, the data changed). */
export function clearBusyMessage(el: HTMLElement): void {
    const msg = messages.get(el);
    if (msg) msg.dataset.closed = '1';
    msg?.remove();
    following.delete(el);
    messages.delete(el);
    endToasts.get(el)?.close();
    endToasts.delete(el);
}

/**
 * A wait whose element is gone already (its dialog closed on the choice, §1): a progress toast with `label` once it
 * lasts past 120 ms, gone at the end (the result says its own toast). Errors go through.
 */
export async function busyToast<T>(label: string, work: () => Promise<T>): Promise<T> {
    let toast: ProgressToastHandle | null = null;
    const shown = setTimeout(() => { toast = showProgressToast({ title: label }); }, BUSY_SHOW_MS);
    try {
        return await work();
    } finally {
        clearTimeout(shown);
        (toast as ProgressToastHandle | null)?.close();
    }
}

/**
 * A short wait of the app itself (IDB, a file made, §1) as `el`'s working state when `el` is on the screen; a
 * failure is `failed(err)`'s sentence at it. Should `el` go meanwhile (its dialog closed), the state goes on as a
 * progress toast. Without `el` the work runs plainly and the failure is a toast.
 */
export async function busyLocal<T>(el: HTMLElement | null, label: string, work: () => Promise<T>,
    failed: (err: unknown) => Extract<BusyEnd, { ok: false }>, opts: BusyOpts = {}): Promise<T | undefined> {
    if (!seen(el)) {
        try {
            return await work();
        } catch (err) {
            console.error(err);
            const end = failed(err);
            showToast(end.text, 6000, { closable: true, ...(end.retry ? { action: { label: strings.busy.retry, run: end.retry } } : {}) });
            return undefined;
        }
    }
    return runBusy(el, async ctl => {
        try {
            return await work();
        } catch (err) {
            console.error(err);
            ctl.end(failed(err));
            return undefined;
        }
    }, { kind: 'local', toastWhenGone: true, ...opts, label });
}

/**
 * §2.3, 9a–9c: the step of a working element as a quiet line where its end's sentence will stand (under its row,
 * above a dialog's footer), seen after 120 ms like the state (a quick action does not blink). `role=status`.
 * The element's next end (its sentence) takes its place; `clear` takes it away.
 */
export function busyStep(el: HTMLElement, text: string, opts: BusyOpts = {}): { set(text: string): void; clear(): void } {
    let words = text;
    let msg: HTMLElement | null = null;
    let gone = false;
    const timer = setTimeout(() => {
        if (gone) return;
        msg = showBusyMessage(el, { ok: false, kind: 'error', neutral: true, text: words }, opts);
        msg.classList.add('busy-step');
    }, BUSY_SHOW_MS);
    return {
        set(next) {
            words = next;
            const span = msg?.querySelector('.busy-msg__text');
            if (span) span.textContent = next;
        },
        clear() {
            gone = true;
            clearTimeout(timer);
            if (msg && messages.get(el) === msg) clearBusyMessage(el);
            else msg?.remove();
        },
    };
}

/** The end of an element gone as a toast: an error with ✕ and its action, never closing by itself (§10.1 b). */
function endToast(el: HTMLElement, end: Extract<BusyEnd, { ok: false }>): void {
    const action = end.retry ? { label: strings.busy.retry, run: end.retry } : end.alt;
    const more = end.retry ? end.alt : undefined;
    const text = end.hint ? `${end.text} ${end.hint}` : end.text;
    const t = showToast(text, Infinity, { alert: !end.neutral, closable: true, kind: 'busy-end', ...(action ? { action } : {}),
        ...(more ? { more } : {}), ...(end.title ? { title: end.title } : {}) });
    endToasts.set(el, t);
}

// ==================== ERRORS (§10.2) ====================

/** What an error means (§10.2): `bridge` false for a service that is not the research's bridge (a map, a register). */
/** An outside service (the map's geocoder) without an answer (§10.3): the network, no answer in time, its request limit. */
export function serviceFailText(kind: 'network' | 'timeout' | 'limit', timeoutMs: number = BUSY_TIMEOUTS.network): string {
    const b = strings.busy;
    return kind === 'timeout' ? b.serviceTimeout(Math.round(timeoutMs / 1000)) : kind === 'limit' ? b.serviceLimit : b.errNetwork;
}

export function busyErrFromBridge(err: unknown, opts: { timeoutMs?: number; bridge?: boolean } = {}): Extract<BusyEnd, { ok: false }> {
    const b = strings.busy;
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
        const s = Math.round((opts.timeoutMs ?? BUSY_TIMEOUTS.bridge) / 1000);
        return { ok: false, kind: 'timeout', text: b.errTimeout(s) };
    }
    if (err instanceof TypeError) {
        return opts.bridge === false ? { ok: false, kind: 'network', text: b.errNetwork } : { ok: false, kind: 'offline', text: b.errOffline };
    }
    const status = (err as { status?: unknown } | null)?.status;
    const code = (err as { code?: unknown } | null)?.code;
    if (status === 409 || status === 423 || status === 503 || code === 'busy') return { ok: false, kind: 'busy', text: b.errBusy };
    const why = (err as { reason?: unknown; why?: unknown } | null);
    const reason = typeof why?.reason === 'string' ? why.reason : typeof why?.why === 'string' ? why.why : '';
    if (typeof status === 'number' && status >= 400 && status < 500 && reason) return { ok: false, kind: 'error', text: b.errRefused(reason) };
    return { ok: false, kind: 'error', text: reason ? b.errRefused(reason) : b.failed };
}

// ==================== THE STATE ====================

/** Lock `el` now (0 ms): `aria-disabled`, and a second click or Enter / Space goes nowhere. */
function lock(el: HTMLElement, opts: BusyOpts): BusyState {
    clearBusyMessage(el);
    const guard = (e: Event): void => {
        if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
        e.stopImmediatePropagation();
        e.preventDefault();
    };
    const st: BusyState = {
        phase: 'lock', opts, label: opts.label ?? strings.busy.generic, shownAt: 0,
        showTimer: null, watch: null, longTimer: null, doneTimer: null,
        drawnOn: null, toast: null,
        prevDisabled: el.getAttribute('aria-disabled'), prevBusy: el.getAttribute('aria-busy'),
        guard, undraw: null, drawDone: null, released: false, lastStep: null,
        el, ident: opts.msgIn ? null : identOf(el),
    };
    const prev = states.get(el);
    if (prev?.doneTimer) { clearTimeout(prev.doneTimer); prev.undraw?.(); }
    states.set(el, st);
    el.setAttribute('aria-disabled', 'true');
    el.dataset.busy = 'lock';
    el.addEventListener('click', guard, true);
    el.addEventListener('keydown', guard, true);
    if (st.ident) {
        moving.add(st);
        observePage();
    }
    if (opts.heavy === 'now' || opts.atOnce) show(el, st);
    else st.showTimer = setTimeout(() => show(el, st), BUSY_SHOW_MS);
    if (opts.long) st.longTimer = setTimeout(() => toToast(el, st), BUSY_LONG_TOAST_MS);
    return st;
}

function goneToToast(st: BusyState): boolean {
    return st.opts.toastWhenGone ?? (!!st.opts.long || st.opts.kind === 'terminal' || st.opts.kind === 'queueWork');
}

/** The state into its progress toast (the element gone, or a long action past 3 s). */
function toToast(el: HTMLElement, st: BusyState): void {
    if (st.toast || st.phase !== 'busy' && st.phase !== 'lock') return;
    const long = st.opts.long ?? { title: st.label };
    st.toast = showProgressToast(long, st.lastStep ?? undefined);
    void el;
}

/**
 * The element drawn anew (a list redrawn while the state lasts): the state moves to the new element (locked,
 * drawn there), so the look and the end stay where the person looks (§10.1 a). False: there is none.
 */
function moveToRedrawn(st: BusyState): boolean {
    if (!st.ident || st.toast) return false;
    const next = Array.from(document.querySelectorAll<HTMLElement>(st.ident)).find(e => e !== st.el && seen(e));
    if (!next || states.has(next) && isBusy(next)) return false;
    const old = st.el;
    old.removeEventListener('click', st.guard, true);
    old.removeEventListener('keydown', st.guard, true);
    st.prevDisabled = next.getAttribute('aria-disabled');
    st.prevBusy = next.getAttribute('aria-busy');
    st.el = next;
    states.set(next, st);
    next.setAttribute('aria-disabled', 'true');
    next.addEventListener('click', st.guard, true);
    next.addEventListener('keydown', st.guard, true);
    if (st.phase === 'busy') {
        const d = draw(next, st.label, st.opts.done);
        st.drawnOn = next;
        st.undraw = d.undraw;
        st.drawDone = d.drawDone;
        next.dataset.busy = 'busy';
        next.setAttribute('aria-busy', 'true');
        keepName(st, next);
    } else next.dataset.busy = 'lock';
    return true;
}

/** After 120 ms: the working look, on the element, its row or a toast. */
function show(first: HTMLElement, st: BusyState): void {
    if (!seen(st.el)) moveToRedrawn(st);
    const el = seen(st.el) ? st.el : first;
    st.showTimer = null;
    if (st.phase !== 'lock') return;
    st.phase = 'busy';
    st.shownAt = Date.now();
    const row = st.opts.rowOf instanceof HTMLElement ? st.opts.rowOf : null;
    if (seen(el)) {
        // A menu dialog's row shows the last step said before it was drawn (its line is the step's place).
        const d = draw(el, optionText(el) && st.lastStep && !st.opts.stepsInToast ? st.lastStep.step : st.label, st.opts.done);
        st.drawnOn = el;
        st.undraw = d.undraw;
        st.drawDone = d.drawDone;
        el.dataset.busy = 'busy';
        el.setAttribute('aria-busy', 'true');
        keepName(st, el);
        drawWordsIn(st);
    } else if (seen(row)) {
        const d = drawOnRow(row);
        st.drawnOn = row;
        st.undraw = d.undraw;
        st.drawDone = d.drawDone;
    } else if (goneToToast(st)) toToast(el, st);
    if (st.opts.area instanceof HTMLElement && st.opts.area !== el) st.opts.area.setAttribute('aria-busy', 'true');
    // The element may go while the state lasts (a list drawn again): the state goes on in a toast.
    st.watch = setInterval(() => {
        if (st.phase !== 'busy') return;
        if (seen(st.drawnOn)) return;
        if ((st.drawnOn === st.el || !st.drawnOn) && moveToRedrawn(st)) return;
        if (st.drawnOn === st.el && seen(row)) {
            const d = drawOnRow(row);
            st.drawnOn = row;
            st.undraw = d.undraw;
            st.drawDone = d.drawDone;
            return;
        }
        st.drawnOn = null;
        if (!st.toast && goneToToast(st)) toToast(el, st);
    }, 400);
}

/**
 * §1.2: the element's name stays its idle words while it works. Hidden (`visibility`), they would leave the
 * accessibility tree with the working words `aria-hidden`: a button without a name. Held as `aria-label` until rest.
 */
function keepName(st: BusyState, el: HTMLElement): void {
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return;
    if (!el.querySelector(':scope > .bl > .b-idle')) return;
    // The name at rest: the idle words and what stands beside the cell (a research mark's hidden words), without
    // the working and done words and what is hidden from it anyway.
    const words = (n: Node): string => {
        if (!(n instanceof HTMLElement)) return n.nodeType === 8 ? '' : n.textContent ?? '';
        if (n.classList.contains('b-busy') || n.classList.contains('b-done') || n.getAttribute('aria-hidden') === 'true') return '';
        return Array.from(n.childNodes, words).join('');
    };
    const name = words(el).replace(/\s+/g, ' ').trim();
    if (!name) return;
    el.setAttribute('aria-label', name);
    const undraw = st.undraw;
    st.undraw = () => {
        undraw?.();
        if (el.getAttribute('aria-label') === name) el.removeAttribute('aria-label');
    };
}

/** `opts.wordsIn`: the working words there (the 12 px spinner and the words), its own words back at rest. */
function drawWordsIn(st: BusyState): void {
    const host = st.opts.wordsIn;
    if (!(host instanceof HTMLElement) || !seen(host)) return;
    const kept = [...host.childNodes];
    // The line keeps its height (a hint of two lines does not let what is under it jump up).
    const minHeight = host.style.minHeight;
    if (typeof host.getBoundingClientRect === 'function') host.style.minHeight = `${host.getBoundingClientRect().height}px`;
    const line = busyStatusEl(st.lastStep && !st.opts.stepsInToast ? st.lastStep.step : st.label);
    host.replaceChildren(line);
    st.wordsLine = line;
    const undraw = st.undraw;
    st.undraw = () => {
        undraw?.();
        if (line.parentNode === host) {
            host.replaceChildren(...kept);
            host.style.minHeight = minHeight;
        }
        st.wordsLine = null;
    };
}

/** The element's look back to rest, its lock off. */
function release(el: HTMLElement, st: BusyState): void {
    if (st.released) return;
    st.released = true;
    if (moving.delete(st)) stopObservingIfIdle();
    if (st.showTimer) clearTimeout(st.showTimer);
    if (st.watch) clearInterval(st.watch);
    if (st.longTimer) clearTimeout(st.longTimer);
    st.showTimer = st.watch = st.longTimer = null;
    el.removeEventListener('click', st.guard, true);
    el.removeEventListener('keydown', st.guard, true);
    if (st.prevDisabled === null) el.removeAttribute('aria-disabled');
    else el.setAttribute('aria-disabled', st.prevDisabled);
    if (st.prevBusy === null) el.removeAttribute('aria-busy');
    else el.setAttribute('aria-busy', st.prevBusy);
    if (st.opts.area instanceof HTMLElement && st.opts.area !== el) st.opts.area.removeAttribute('aria-busy');
}

function toRest(el: HTMLElement, st: BusyState): void {
    st.phase = 'done';
    if (st.undraw) st.undraw();
    else if (el.dataset.busy === 'lock') {
        if (el.querySelector(':scope > .bl')) el.dataset.busy = 'idle';
        else delete el.dataset.busy;
    }
    st.undraw = null;
    if (states.get(el) === st) states.delete(el);
}

/** End the state of `el` with `end` (after the 300 ms minimum of a state shown). */
async function finish(first: HTMLElement, st: BusyState, end: BusyEnd): Promise<void> {
    if (st.showTimer) { clearTimeout(st.showTimer); st.showTimer = null; }
    if (st.phase === 'busy') {
        const wait = st.shownAt + BUSY_MIN_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    // Drawn anew meanwhile: the end goes on the element in its place.
    if (!seen(st.el)) moveToRedrawn(st);
    const el = st.el;
    if (el !== first && states.get(first) === st) states.delete(first);
    release(el, st);
    const where = seen(st.drawnOn) ? st.drawnOn : null;
    if (end.ok) {
        const said = end.announce ?? end.done;
        if (st.toast) {
            st.toast.done(end.summary !== undefined ? end.summary ?? undefined : end.done ?? end.announce);
            st.toast = null;
            toRest(el, st);
        } else if (end.done && where && st.drawDone) {
            st.drawDone(end.done);
            st.phase = 'done';
            st.doneTimer = setTimeout(() => { st.doneTimer = null; toRest(el, st); }, BUSY_DONE_MS);
        } else toRest(el, st);
        if (said) announceBusy(said);
        return;
    }
    toRest(el, st);
    // A neutral end (a question, not an error) leaves its progress toast for a toast of its own (role=status).
    if (st.toast && end.neutral) {
        st.toast.close();
        st.toast = null;
    }
    if (st.toast) {
        const action = end.retry ? { label: strings.busy.retry, run: end.retry } : end.alt;
        const more = end.retry ? end.alt : undefined;
        st.toast.fail(end.hint ? `${end.text} ${end.hint}` : end.text, action, { ...(end.title ? { title: end.title } : {}), ...(more ? { more } : {}) });
        st.toast = null;
        return;
    }
    const anchor = st.opts.endToast ? null : seen(el) ? el : st.opts.rowOf instanceof HTMLElement && seen(st.opts.rowOf) ? st.opts.rowOf : null;
    if (anchor) {
        const msg = showBusyMessage(seen(el) ? el : anchor, end, st.opts);
        // The caller knows the first element: clearing its sentence clears this one.
        if (el !== first) messages.set(first, msg);
    } else endToast(el, end);
}

/**
 * Lock `el` at once, show the state after 120 ms, run `fn`, show its end. Gives what `fn` gave (undefined: it
 * was working already, it failed or its time ran out). Every place guards against a second start this way.
 */
export async function runBusy<T>(el: HTMLElement, fn: (ctl: BusyCtl) => Promise<T>, opts: BusyOpts = {}): Promise<T | undefined> {
    if (isBusy(el)) return undefined;
    const st = lock(el, opts);
    const ac = new AbortController();
    let said: BusyEnd | null = null;
    const ctl: BusyCtl = {
        signal: ac.signal,
        step(text, k, n, size) {
            st.lastStep = { step: text, ...(k !== undefined ? { k } : {}), ...(n !== undefined ? { n } : {}), ...(size !== undefined ? { size } : {}) };
            if (st.toast) st.toast.update({ step: text, k, n, size });
            else if (st.wordsLine && !opts.stepsInToast) st.wordsLine.replaceChildren(spinEl(12), document.createTextNode(text));
            else if (st.drawnOn === st.el && !opts.stepsInToast) {
                const busy = workingWords(st.el);
                if (busy) busy.replaceChildren(busy.querySelector('.busy-spin') ?? spinEl(), document.createTextNode(text));
            }
        },
        end(e) { said = e; },
    };
    const limit = opts.timeoutMs ?? BUSY_TIMEOUTS[opts.kind ?? 'local'];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<'timeout'>(resolve => {
        if (Number.isFinite(limit)) timer = setTimeout(() => resolve('timeout'), limit);
    });
    if (opts.heavy) await nextPaint();
    let result: T | undefined;
    let end: BusyEnd;
    try {
        const run = fn(ctl).then(v => ({ v }));
        const first = await Promise.race([run, timedOut]);
        if (first === 'timeout') {
            ac.abort(new DOMException('The time limit ran out', 'TimeoutError'));
            run.catch(() => { /* what comes after the limit is not shown */ });
            end = said ?? { ok: false, kind: 'timeout', text: strings.busy.errTimeout(Math.round(limit / 1000)) };
        } else {
            result = first.v;
            end = said ?? { ok: true };
        }
    } catch (err) {
        end = said ?? busyErrFromBridge(err, { timeoutMs: limit });
    } finally {
        if (timer) clearTimeout(timer);
    }
    await finish(el, st, end);
    return end.ok ? result : undefined;
}

/**
 * The state without one async function (§1.1, low level): on locks at once and shows it after 120 ms; off ends it
 * (after the 300 ms minimum of a state shown), with `end` when given (default: a plain end).
 */
export function setBusy(el: HTMLElement, on: boolean, opts: BusyOpts = {}, end: BusyEnd = { ok: true }): void {
    if (on) {
        if (!isBusy(el)) lock(el, opts);
        return;
    }
    const st = states.get(el);
    if (st && (st.phase === 'lock' || st.phase === 'busy')) void finish(el, st, end);
}

/** The words of a working element anew (its progress toast's title too). */
export function setBusyLabel(el: HTMLElement, label: string): void {
    const st = states.get(el);
    if (!st) return;
    st.label = label;
    const busy = workingWords(el);
    if (busy && st.drawnOn === el) busy.replaceChildren(busy.querySelector('.busy-spin') ?? spinEl(), document.createTextNode(label));
    st.wordsLine?.replaceChildren(spinEl(12), document.createTextNode(label));
    st.toast?.update({ title: label });
}

/** Whether a reduced-motion screen shows the three dots (the stylesheet draws them; for the tests). */
export function busyReducedMotion(): boolean {
    return reducedMotion();
}

// ==================== A ROW'S OWN STATE (§7) ====================

/**
 * The quiet state at a row's end while an optimistic write is confirmed (§7, 6.1): the 12 px spinner and the
 * words ("saving"). Not a live region: a row drawn anew draws it again, so it is said once by `announceBusy`.
 */
export function busyStatusEl(text: string): HTMLElement {
    const st = document.createElement('span');
    st.className = 'busy-st';
    st.append(spinEl(12), document.createTextNode(text));
    return st;
}

// ==================== A LAYOUT THAT MOVED UNDER THE POINTER ====================

/** How long the actions of a list whose rows just moved take no activation (a click meant for the row before). */
export const SHIFT_HOLD_MS = 400;
const shiftHolds = new Map<string, number>();

/** A clock that only goes forward (a page's fixed date, a changed system clock do not stop or turn it). */
export function monoNow(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Where the pointer was when a list last moved, and whether it moved on since (aimed anew). */
let shiftPointer: { x: number; y: number; moved: boolean } | null = null;
let lastPointer: { x: number; y: number } | null = null;
let pointerWatch = false;

function watchPointer(): void {
    if (pointerWatch || typeof document === 'undefined') return;
    pointerWatch = true;
    document.addEventListener('pointermove', (e) => {
        lastPointer = { x: e.clientX, y: e.clientY };
        // Where it was is not known (no pointer seen before): any move aims anew.
        if (shiftPointer && !shiftPointer.moved && !(Math.hypot(e.clientX - shiftPointer.x, e.clientY - shiftPointer.y) <= 6)) shiftPointer.moved = true;
    }, { capture: true, passive: true });
    document.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });
}

/**
 * The rows of `scope` moved (a row went or changed its place): their actions take no click for a moment, so a
 * second click meant for the row before does not land on the one that took its place. A pointer aimed anew
 * (moved since) and a key (the focus does not move with the rows) are not held.
 */
export function holdAfterShift(scope: string, ms = SHIFT_HOLD_MS): void {
    watchPointer();
    shiftHolds.set(scope, Math.max(shiftHolds.get(scope) ?? 0, monoNow() + ms));
    shiftPointer = { x: lastPointer?.x ?? NaN, y: lastPointer?.y ?? NaN, moved: false };
}

/** Whether this activation (`e`) of an action of `scope` is held after a shift of its rows. */
export function shiftHeld(scope: string, e?: Event): boolean {
    const until = shiftHolds.get(scope);
    if (until === undefined) return false;
    if (monoNow() >= until) {
        shiftHolds.delete(scope);
        return false;
    }
    // A key's activation (a trusted click with no pointer press): the focus stayed where it was put.
    if (e?.type === 'click' && e.isTrusted && (e as MouseEvent).detail === 0) return false;
    if (shiftPointer?.moved) return false;
    return true;
}
