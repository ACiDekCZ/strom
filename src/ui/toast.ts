/**
 * The app's toasts (UI.showToast, round 6 §43): a message at the bottom, one
 * at a time (src/toast-slot.ts). `showToast` gives back a handle: the toast
 * can be changed in place (`update`) or closed (`close`), also before it got
 * its turn on the screen.
 *
 * The progress toast (waiting buttons §2.1, `showProgressToast`): one steady
 * place for a long action whose element is gone (a closed dialog or menu) or
 * that runs long: the one spinner (`.busy-spin.s16`) or a bar (`.bar`, known
 * share or not), a title, a line with the step, "k of n", a size and the time
 * from 10 s, "Taking longer than usual." from twice the usual time (20 s at
 * least), Cancel / Show where they work. It stays while the action runs; its
 * end is a summary with ✓ (4 s, `role=status`) or an error (`role=alert`,
 * with ✕, no closing by itself). It goes on the screen at once (under a
 * message to be read whose own time runs, until it goes: src/toast-slot.ts)
 * and a message coming meanwhile does not remove it (it shows again when the
 * message goes).
 */

import { strings } from '../strings.js';
import { setResearchOpenLabel, researchBridgeAgentLabel } from './research-open-mark.js';
import { watchToasts, whenFree } from '../toast-slot.js';

/** How a message shows (UI.showToast). */
export interface ToastOptions {
    title?: string;
    spinner?: boolean;
    closable?: boolean;
    kind?: string;
    /**
     * `research`: the action opens the research's terminal (its mark); `ai`: an agent works there too (without
     * `research`: an agent works through the bridge, no terminal — the AI badge alone).
     * `work` (§4, "Undo" and its kin): the toast stays, says the work (the one spinner and `work.label`) and its
     * end (✓ for 4 s, or the error with "Try again" and ✕, not closing by itself); `run` gives that end.
     */
    action?: ToastAction;
    /** A second action beside `action` (e.g. "Export GEDCOM" beside "Try again"); `research`/`ai` as with `action`. */
    more?: { label: string; run: () => void; research?: boolean; ai?: boolean };
    /** A third one after them (an output's "Cancel" beside "Try again" and "Continue without", spec 116 §8). */
    third?: { label: string; run: () => void };
    hold?: boolean;
    /** A notice to be read: it stands 3 s at least before a newer toast takes its place (round 7 §53). */
    notice?: boolean;
    /** Said as an alert (`role="alert"`): something asked for did not happen. */
    alert?: boolean;
    /** A dialog's footer (selector) the toast stands above while it is on the screen: shown over a
     *  dialog, the toast must not cover the dialog's action buttons. */
    clearOf?: string;
}

/** A toast's action (see ToastOptions.action). */
export interface ToastAction {
    label: string;
    /** With `work`: its end (nothing: the toast just goes, the action said its end itself). */
    run: () => unknown;
    research?: boolean;
    ai?: boolean;
    work?: ToastWork;
}

/** A toast's action that works in the toast itself (waiting buttons §4, 4d). */
export interface ToastWork {
    /** The working title ("Undoing…"). */
    label: string;
    /** A quiet line under it: what is worked on. */
    sub?: string;
    /** Its time limit (default 30 s, a write to the research, §10.3; Infinity: local work, none). */
    timeoutMs?: number;
    /** The failure's words from its reason (default "Not undone: {why}"). */
    failed?: (why: string) => string;
}

/**
 * The end of a toast's work: `ok` ✓ and its words (4 s; with an `action`, e.g. "Undo" again, 8 s), or the
 * reason it did not happen (said with ToastWork.failed; `whole`: the text is the whole sentence; `retry: false`:
 * no "Try again").
 */
export type ToastWorkEnd =
    | { ok: true; text: string; action?: ToastAction }
    | { ok: false; text: string; retry?: boolean; whole?: boolean };

/** A write's usual limit (BUSY_TIMEOUTS.write). */
export const TOAST_WORK_MS = 30_000;

/** A toast shown (or waiting for its turn): changed in place or closed. */
export interface ToastHandle {
    /** The toast on the screen (null: not yet there, or gone). */
    readonly el: HTMLElement | null;
    /** Its words, time and options anew (the same element; its time starts again). */
    update(message: string, duration?: number, opts?: ToastOptions): void;
    /** It goes (one waiting for its turn never comes). */
    close(): void;
}

/** Fade a toast out and remove it. */
function fadeOut(toast: HTMLElement): void {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
}

/** Fill a toast with its message and options (its old content replaced). */
function fillToast(toast: HTMLElement, message: string, opts: ToastOptions, onAction?: () => void): void {
    toast.replaceChildren();
    const progress = toast.classList.contains('toast--progress');
    toast.className = progress ? 'toast toast--rich toast--progress' : opts.title || opts.spinner ? 'toast toast--rich' : 'toast';
    if (toast.dataset.shown !== undefined) toast.classList.add('show');
    toast.setAttribute('role', opts.alert ? 'alert' : 'status');
    if (opts.kind) toast.dataset.kind = opts.kind;
    else delete toast.dataset.kind;
    if (opts.notice) toast.dataset.notice = '';
    else delete toast.dataset.notice;
    if (opts.spinner) {
        const spin = document.createElement('span');
        spin.className = 'busy-spin';
        spin.setAttribute('aria-hidden', 'true');
        toast.appendChild(spin);
    }
    if (opts.title) {
        const body = document.createElement('span');
        body.className = 'toast-body';
        const title = document.createElement('strong');
        title.className = 'toast-title';
        title.textContent = opts.title;
        body.append(title, document.createTextNode(message));
        toast.appendChild(body);
    } else {
        toast.appendChild(document.createTextNode(message));
    }
    const acts = [opts.action, opts.more, opts.third].filter((a): a is NonNullable<ToastOptions['action']> => !!a);
    if (acts.length) {
        // In the group of actions: an "Undo" or "↩ Back" riding along joins it, the group wraps whole
        const actions = document.createElement('span');
        actions.className = 'toast-actions';
        for (const a of acts) {
            const { label, run, research, ai } = a;
            const act = document.createElement('button');
            act.type = 'button';
            act.className = 'toast-action';
            if (research) setResearchOpenLabel(act, label, { ai });
            // An agent working through the bridge, no terminal: the AI badge alone.
            else if (ai) act.innerHTML = researchBridgeAgentLabel(label);
            else act.textContent = label;
            const work = 'work' in a ? (a as ToastAction).work : undefined;
            act.onclick = work ? () => { void workInToast(toast, a as ToastAction, work, opts); } : () => {
                fadeOut(toast);
                onAction?.();
                run();
            };
            actions.appendChild(act);
        }
        toast.appendChild(actions);
        // Three actions (an output's "Try again · Continue without N photos · Cancel", spec 116 §8) do not fit
        // beside the sentence: the group goes under it, so the sentence keeps the toast's width.
        if (acts.length >= 3) toast.classList.add('toast--actions-below');
    }
    if (opts.closable) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'toast-close';
        close.setAttribute('aria-label', strings.buttons.close);
        close.innerHTML = '&times;';
        close.onclick = () => fadeOut(toast);
        toast.classList.add('toast--closable');
        toast.appendChild(close);
    }
}

// ==================== WORK IN THE TOAST (§4) ====================

/** "Not undone: the research did not answer…": the reason's first word small unless it is a name. */
export function workFailedText(prefix: (why: string) => string, why: string): string {
    const text = why.trim().replace(/[.。]$/, '');
    const first = text.split(/\s/)[0] ?? '';
    const small = first.length > 1 && first.slice(1) === first.slice(1).toLowerCase() && first !== 'Strom'
        ? text.charAt(0).toLowerCase() + text.slice(1) : text;
    return `${prefix(small)}.`;
}

/**
 * Run a toast's working action in the toast (4d): the toast stays and says the work (the spinner, its words, its
 * line; a second click goes nowhere, its time stands), then its end: ✓ and the words for 4 s, or the error with
 * "Try again" (the same work again) and ✕, without closing by itself.
 */
async function workInToast(toast: HTMLElement, action: ToastAction, work: ToastWork, opts: ToastOptions): Promise<void> {
    if (toast.dataset.working !== undefined) return;
    toast.dataset.working = '';
    const hadFocus = toast.contains(document.activeElement);
    const old = hideTimers.get(toast);
    if (old) clearTimeout(old);
    hideTimers.delete(toast);
    delete toast.dataset.timed;
    delete toast.dataset.ended;
    // The working look: the progress toast's (a running one is never replaced by a newer message).
    toast.replaceChildren();
    toast.className = 'toast toast--rich toast--progress toast--work show';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-busy', 'true');
    const lead = document.createElement('span');
    lead.className = 'toast-lead';
    const spin = document.createElement('i');
    spin.className = 'busy-spin s16';
    spin.setAttribute('aria-hidden', 'true');
    lead.appendChild(spin);
    const body = document.createElement('span');
    body.className = 'toast-body';
    const head = document.createElement('strong');
    head.className = 'toast-title';
    head.textContent = work.label;
    body.appendChild(head);
    if (work.sub) {
        const sub = document.createElement('span');
        sub.className = 't-sub';
        sub.textContent = work.sub;
        body.appendChild(sub);
    }
    toast.append(lead, body);
    if (hadFocus) {
        toast.tabIndex = -1;
        toast.focus({ preventScroll: true });
    }
    const limit = work.timeoutMs ?? TOAST_WORK_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Local work (Infinity) has no limit.
    const timedOut = new Promise<'timeout'>(resolve => { if (Number.isFinite(limit)) timer = setTimeout(() => resolve('timeout'), limit); });
    let end: ToastWorkEnd | 'timeout' | void;
    try {
        end = await Promise.race([Promise.resolve().then(() => action.run() as Promise<ToastWorkEnd | void> | ToastWorkEnd | void), timedOut]);
    } catch {
        end = { ok: false, text: strings.busy.failed };
    } finally {
        if (timer) clearTimeout(timer);
    }
    delete toast.dataset.working;
    toast.removeAttribute('aria-busy');
    toast.dataset.ended = '';
    if (!toast.isConnected) return;
    if (!end) { fadeOut(toast); return; }
    const failed = work.failed ?? strings.busy.notUndone;
    if (end === 'timeout') end = { ok: false, text: strings.busy.errTimeout(Math.round(limit / 1000)) };
    toast.classList.remove('toast--progress', 'toast--work');
    if (end.ok) {
        fillToast(toast, end.text, { ...(opts.kind ? { kind: opts.kind } : {}), ...(end.action ? { action: end.action } : {}) });
        markToast(toast, '✓');
        setHide(toast, end.action ? 8000 : SUMMARY_MS, { hold: true });
        return;
    }
    const retry = end.retry !== false ? { label: strings.busy.retry, run: action.run, work } : undefined;
    fillToast(toast, end.whole ? end.text : workFailedText(failed, end.text), { alert: true, closable: true, ...(opts.kind ? { kind: opts.kind } : {}), ...(retry ? { action: retry } : {}) });
    markToast(toast, '!');
    setHide(toast, Infinity, {});
}

/**
 * A write that tells its failure through `said` (a whole sentence; nothing: it did not run) as the end of a
 * toast's Undo working in the toast: ✓ `done` ("Undone."), or that sentence with "Try again" (`final`: a
 * refusal in the research's own words, which another try does not change: none).
 */
export async function undoInToast(write: (said: (text: string, final?: boolean) => void) => Promise<boolean>, done?: string): Promise<ToastWorkEnd> {
    let text = '';
    let last = false;
    const ok = await write((t, final) => { text = t; last = !!final; });
    if (ok) return { ok: true, text: done ?? strings.busy.undone };
    return text ? { ok: false, text, whole: true, ...(last ? { retry: false } : {}) } : { ok: false, text: strings.busy.failed };
}

/** The end's mark before a toast's words (✓, !). */
function markToast(toast: HTMLElement, mark: string): void {
    const ok = document.createElement('span');
    ok.className = 'ok';
    ok.setAttribute('aria-hidden', 'true');
    ok.textContent = mark;
    // A plain message: the mark and its words one line (one cell of a narrow toast's grid).
    const first = toast.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) {
        const line = document.createElement('span');
        line.className = 'toast-line';
        toast.insertBefore(line, first);
        line.append(ok, first);
    } else {
        toast.prepend(ok);
    }
    toast.classList.add('toast--marked');
}

/** Its auto-hide (Infinity: none); a toast with a button stays while the keyboard (`hold`: the pointer) is on it. */
function scheduleHide(toast: HTMLElement, duration: number, opts: ToastOptions): ReturnType<typeof setTimeout> | null {
    if (!Number.isFinite(duration)) return null;
    const hide = (): void => {
        if (toast.isConnected && toast.contains(document.activeElement)) {
            toast.addEventListener('focusout', () => setTimeout(hide, 0), { once: true });
            return;
        }
        // `hold`: it also stays while the pointer is on it.
        if (opts.hold && toast.isConnected && toast.matches(':hover')) {
            toast.addEventListener('mouseleave', () => setTimeout(hide, 1000), { once: true });
            return;
        }
        fadeOut(toast);
    };
    return setTimeout(hide, duration);
}

/** Toasts with a timer of their own (a new time from `update` stops the old one). */
const hideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function setHide(toast: HTMLElement, duration: number, opts: ToastOptions): void {
    const old = hideTimers.get(toast);
    if (old) clearTimeout(old);
    // A toast with its own time (the slot: a progress toast coming after one to be read waits under it).
    if (Number.isFinite(duration)) toast.dataset.timed = '';
    else delete toast.dataset.timed;
    const t = scheduleHide(toast, duration, opts);
    if (t) hideTimers.set(toast, t);
    else hideTimers.delete(toast);
}

/** Show `toast` (made, filled) on the screen. */
function mount(toast: HTMLElement, opts: ToastOptions): void {
    document.body.appendChild(toast);
    if (opts.clearOf) {
        const foot = document.querySelector<HTMLElement>(opts.clearOf);
        const top = foot?.offsetParent ? foot.getBoundingClientRect().top : 0;
        if (top > 0) toast.style.bottom = `${Math.max(0, window.innerHeight - top) + 8}px`;
    }
    // Trigger animation
    requestAnimationFrame(() => {
        if (!toast.isConnected) return;
        toast.classList.add('show');
        toast.dataset.shown = '';
    });
}

/** Put the message on the screen now (its turn come): it replaces the message before it, never a running progress toast. */
export function putToast(message: string, duration: number, opts: ToastOptions): HTMLElement {
    for (const t of document.querySelectorAll<HTMLElement>('body > .toast')) {
        if (!t.classList.contains('toast--progress') || t.dataset.ended !== undefined) t.remove();
    }
    const toast = document.createElement('div');
    fillToast(toast, message, opts);
    mount(toast, opts);
    setHide(toast, duration, opts);
    return toast;
}

/** A message at the bottom, when it is its turn (see UI.showToast); the handle changes or closes it. */
export function showToast(message: string, duration = 3000, opts: ToastOptions = {}): ToastHandle {
    let el: HTMLElement | null = null;
    let closed = false;
    let args: [string, number, ToastOptions] = [message, duration, opts];
    watchToasts();
    whenFree('message', () => {
        if (closed) return;
        el = putToast(...args);
    });
    return {
        get el() { return el?.isConnected ? el : null; },
        update(m: string, d = args[1], o: ToastOptions = args[2]) {
            args = [m, d, o];
            if (!el || !el.isConnected) return;
            fillToast(el, m, o);
            setHide(el, d, o);
        },
        close() {
            closed = true;
            if (el) fadeOut(el);
        },
    };
}

// ==================== THE PROGRESS TOAST (§2.1) ====================

/** A long action (§2): its progress toast, or its dialog. */
export interface LongOpts {
    /** "Handing the tree to the research…" */
    title: string;
    /** Its usual time: "Taking longer than usual." from max(2 × usualMs, 20 s). */
    usualMs?: number;
    /** Only where cancelling really works (§2.4). */
    cancel?: () => void;
    /** "Show": back to the dialog or window the action came from. */
    show?: () => void;
    /** §2.6: the words of the lock on edits. */
    lockEdits?: string;
    /** When the action started (its time counts from then; default: the toast's start). */
    startedAt?: number;
    /** Cancel's own words ("Stop waiting", §2.4). */
    cancelLabel?: string;
    /** One more action beside Cancel / Show (e.g. "Not installed? Install…"). */
    more?: { label: string; run: () => void };
}

/** A step of a long action: its words, "k of n", a size; `percent` draws a known bar (null: a bar of unknown share). */
export interface ProgressStep {
    step?: string;
    k?: number;
    n?: number;
    size?: string;
    /** 0–100: a bar with that share; null: a bar of unknown share; absent: the spinner. */
    percent?: number | null;
    /** false: Cancel goes (it works only in a part of the action, e.g. while a file downloads). */
    cancel?: boolean;
}

export interface ProgressToastHandle {
    readonly el: HTMLElement;
    /** A new step (and title). */
    update(step: ProgressStep & { title?: string }): void;
    /** Done: a summary with ✓ for 4 s (`role=status`); without a summary it just goes. */
    done(summary?: string): void;
    /**
     * It failed: the words as an alert (a title over them), ✕ and the actions; it does not go by itself.
     * `third`: a third action (its own "Cancel"), and no ✕ then (spec 116 §8).
     */
    fail(text: string, action?: { label: string; run: () => void }, extra?: {
        title?: string; more?: { label: string; run: () => void }; third?: { label: string; run: () => void }; neutral?: boolean;
    }): void;
    /** It goes now. */
    close(): void;
}

/** "· 12 s" shows from this long. */
export const ELAPSED_FROM_MS = 10_000;
/** "Taking longer than usual." never sooner than this. */
export const TAKING_LONG_MIN_MS = 20_000;
/** A summary stands this long. */
export const SUMMARY_MS = 4000;

/** The sub line of a progress toast: step · k of n · size · time. */
export function progressSubLine(st: ProgressStep, elapsedMs: number): string {
    const parts: string[] = [];
    if (st.step) parts.push(st.step);
    if (st.k !== undefined && st.n !== undefined) parts.push(strings.busy.kOfN(st.k, st.n));
    if (st.size) parts.push(st.size);
    const line = parts.join(' · ');
    if (elapsedMs < ELAPSED_FROM_MS) return line;
    const time = strings.busy.elapsed(Math.floor(elapsedMs / 1000));
    return line ? `${line} ${time}` : time.replace(/^·\s*/, '');
}

/** The progress toast of a long action (§2.1): on the screen at once, until it is done, failed or closed. */
export function showProgressToast(opts: LongOpts, first: ProgressStep = {}): ProgressToastHandle {
    watchToasts();
    const started = opts.startedAt ?? Date.now();
    let step: ProgressStep = { ...first };
    let title = opts.title;
    let ended = false;
    const toast = document.createElement('div');
    toast.className = 'toast toast--rich toast--progress';
    toast.dataset.kind = 'progress';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-busy', 'true');

    const lead = document.createElement('span');
    lead.className = 'toast-lead';
    const body = document.createElement('span');
    body.className = 'toast-body';
    const head = document.createElement('strong');
    head.className = 'toast-title';
    const sub = document.createElement('span');
    sub.className = 't-sub';
    const long = document.createElement('span');
    long.className = 't-long';
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.appendChild(document.createElement('i'));
    body.append(head, sub, bar, long);
    const actions = document.createElement('span');
    actions.className = 'toast-actions';
    toast.append(lead, body, actions);

    const button = (label: string, run: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'toast-action';
        b.textContent = label;
        b.onclick = run;
        return b;
    };
    const cancelBtn = opts.cancel ? button(opts.cancelLabel ?? strings.buttons.cancel, () => opts.cancel?.()) : null;
    if (cancelBtn) {
        cancelBtn.dataset.act = 'cancel';
        actions.appendChild(cancelBtn);
    }
    if (opts.show) actions.appendChild(button(strings.busy.show, () => opts.show?.()));
    if (opts.more) actions.appendChild(button(opts.more.label, () => opts.more?.run()));

    const draw = (): void => {
        if (ended) return;
        head.textContent = title;
        const elapsed = Date.now() - started;
        const line = progressSubLine(step, elapsed);
        // §2.6: the lock on edits said with the step ("1.4 MB of 3.2 MB · edits wait for the load").
        sub.textContent = opts.lockEdits ? [line, opts.lockEdits].filter(Boolean).join(' · ') : line;
        sub.hidden = sub.textContent === '';
        const longAfter = Math.max(2 * (opts.usualMs ?? 0), TAKING_LONG_MIN_MS);
        long.textContent = elapsed >= longAfter ? strings.busy.takingLong : '';
        long.hidden = long.textContent === '';
        const hasBar = step.percent !== undefined;
        bar.hidden = !hasBar;
        bar.classList.toggle('ind', step.percent === null);
        (bar.firstElementChild as HTMLElement).style.width = typeof step.percent === 'number'
            ? `${Math.max(0, Math.min(100, step.percent))}%` : '';
        if (hasBar) lead.replaceChildren();
        else if (!lead.querySelector('.busy-spin')) {
            const spin = document.createElement('i');
            spin.className = 'busy-spin s16';
            spin.setAttribute('aria-hidden', 'true');
            lead.replaceChildren(spin);
        }
        if (cancelBtn) cancelBtn.hidden = step.cancel === false;
        actions.hidden = ![...actions.children].some(c => !(c as HTMLElement).hidden);
    };
    draw();
    const ticker = setInterval(draw, 1000);
    mount(toast, {});

    const finish = (): void => {
        ended = true;
        clearInterval(ticker);
        toast.dataset.ended = '';
        toast.removeAttribute('aria-busy');
    };
    return {
        el: toast,
        update(st) {
            if (st.title) title = st.title;
            const { title: _t, ...rest } = st;
            step = { ...step, ...rest };
            draw();
        },
        done(summary) {
            if (ended) return;
            finish();
            if (!summary) { fadeOut(toast); return; }
            toast.replaceChildren();
            const ok = document.createElement('span');
            ok.className = 'ok';
            ok.setAttribute('aria-hidden', 'true');
            ok.textContent = '✓';
            toast.append(ok, document.createTextNode(summary));
            toast.setAttribute('role', 'status');
            setHide(toast, SUMMARY_MS, {});
        },
        fail(text, action, extra) {
            if (ended && !toast.isConnected) return;
            finish();
            // A neutral end (a question, not an error) is said politely, without the error's alert.
            fillToast(toast, text, { alert: !extra?.neutral, closable: !extra?.third, kind: 'progress', ...(action ? { action } : {}),
                ...(extra?.title ? { title: extra.title } : {}), ...(extra?.more ? { more: extra.more } : {}),
                ...(extra?.third ? { third: extra.third } : {}) });
        },
        close() {
            finish();
            fadeOut(toast);
        },
    };
}
