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
    /** The state goes to a toast when the element and its row are gone (default: true for a long action or a terminal). */
    toastWhenGone?: boolean;
    /** A failed end goes to a toast even with the element seen (a toolbar has no room for a sentence, 1e). */
    endToast?: boolean;
    /** The steps only in the progress toast: the element keeps its words (a toolbar button, 2d). */
    stepsInToast?: boolean;
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

function spinEl(size: 12 | 14 | 16 = 14): HTMLElement {
    const i = document.createElement('i');
    i.className = size === 14 ? 'busy-spin' : `busy-spin s${size}`;
    i.setAttribute('aria-hidden', 'true');
    return i;
}

/**
 * A button's inside for the working state (§1.2), drawn once with the button: the idle words, the working words
 * with the spinner and the ✓ words in one cell (the width of the longest from the start). `label` is HTML.
 */
export function busyButtonHtml(labelHtml: string, busyLabel: string, done?: string): string {
    return `<span class="bl"><span class="b-idle">${labelHtml}</span>`
        + `<span class="b-busy" aria-hidden="true">${busySpinHtml()}${esc(busyLabel)}</span>`
        + `<span class="b-done" aria-hidden="true"><span class="ok">✓</span>${esc(done ?? '')}</span></span>`;
}

/** The research's marks in an element: they stay outside `.bl`, last on the screen. */
const MARK_SELECTOR = '.research-ai-badge, .research-open-mark';

/** An element whose text stays and gets the spinner after it (a link in text, a menu item, a toast's action). */
function trailsSpinner(el: HTMLElement): boolean {
    return el.matches('a, .link, button.link, .btn-link, [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]');
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
export function prepareBusy(el: HTMLElement, busyLabel: string, done?: string): void {
    const bl = el.querySelector<HTMLElement>(':scope > .bl');
    if (bl) {
        setBusyWords(bl, busyLabel, done);
        if (!el.dataset.busy) el.dataset.busy = 'idle';
        return;
    }
    wrap(el, busyLabel, done);
    el.dataset.busy = 'idle';
}

function setBusyWords(bl: HTMLElement, busyLabel: string, done?: string): void {
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
        const slot = document.createElement('span');
        slot.className = 'busy-slot';
        slot.setAttribute('aria-hidden', 'true');
        slot.appendChild(spinEl(12));
        el.appendChild(slot);
        return {
            undraw: () => { slot.remove(); delete el.dataset.busy; },
            drawDone: () => {
                const ok = document.createElement('span');
                ok.className = 'ok';
                ok.textContent = '✓';
                slot.replaceChildren(ok);
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
    const parent = el.parentElement;
    // A group of actions or a line of text: the sentence under the whole group; a big container: right after the element.
    const big = !parent || parent === document.body || parent.matches('form, section, dialog, .modal, .modal-body, .modal-content')
        || parent.childElementCount > 8;
    if (!big && parent?.parentElement) parent.after(msg);
    else el.after(msg);
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
        b.addEventListener('click', () => { msg.remove(); run(); });
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
    return msg;
}

/** The sentence (or toast) of `el`'s last end goes (another try, the data changed). */
export function clearBusyMessage(el: HTMLElement): void {
    messages.get(el)?.remove();
    messages.delete(el);
    endToasts.get(el)?.close();
    endToasts.delete(el);
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
    };
    const prev = states.get(el);
    if (prev?.doneTimer) { clearTimeout(prev.doneTimer); prev.undraw?.(); }
    states.set(el, st);
    el.setAttribute('aria-disabled', 'true');
    el.dataset.busy = 'lock';
    el.addEventListener('click', guard, true);
    el.addEventListener('keydown', guard, true);
    if (opts.heavy === 'now') show(el, st);
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

/** After 120 ms: the working look, on the element, its row or a toast. */
function show(el: HTMLElement, st: BusyState): void {
    st.showTimer = null;
    if (st.phase !== 'lock') return;
    st.phase = 'busy';
    st.shownAt = Date.now();
    const row = st.opts.rowOf instanceof HTMLElement ? st.opts.rowOf : null;
    if (seen(el)) {
        const d = draw(el, st.label, st.opts.done);
        st.drawnOn = el;
        st.undraw = d.undraw;
        st.drawDone = d.drawDone;
        el.dataset.busy = 'busy';
        el.setAttribute('aria-busy', 'true');
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
        if (st.drawnOn === el && seen(row)) {
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

/** The element's look back to rest, its lock off. */
function release(el: HTMLElement, st: BusyState): void {
    if (st.released) return;
    st.released = true;
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
async function finish(el: HTMLElement, st: BusyState, end: BusyEnd): Promise<void> {
    if (st.showTimer) { clearTimeout(st.showTimer); st.showTimer = null; }
    if (st.phase === 'busy') {
        const wait = st.shownAt + BUSY_MIN_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
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
    if (anchor) showBusyMessage(seen(el) ? el : anchor, end, st.opts);
    else endToast(el, end);
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
            else if (st.drawnOn === el && !opts.stepsInToast) {
                const busy = el.querySelector<HTMLElement>(':scope > .bl > .b-busy');
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
    const busy = el.querySelector<HTMLElement>(':scope > .bl > .b-busy');
    if (busy && st.drawnOn === el) busy.replaceChildren(busy.querySelector('.busy-spin') ?? spinEl(), document.createTextNode(label));
    st.toast?.update({ title: label });
}

/** Whether a reduced-motion screen shows the three dots (the stylesheet draws them; for the tests). */
export function busyReducedMotion(): boolean {
    return reducedMotion();
}
