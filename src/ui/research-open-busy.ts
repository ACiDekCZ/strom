/**
 * A link handed to the research (waiting buttons §3.1): the element that started it says "Opening the research…"
 * ("Opening the agent…" for an agent's work in the terminal, "Loading…" for a link without a terminal) until the
 * research proves it took the link, at most 10 s (the queue's work 30 s). The proof: the link carries
 * `&handoff=<uuid>` and the research's bridge says it in `/status.handoffs` (feature `handoffs`); an older research
 * shows a new session instead, or nothing (the limit). After the limit the element is at rest again and a neutral
 * sentence under it asks "Did the terminal not open?" with Try again; a proof coming within a minute after (the
 * browser's "Open Strom Research?" answered late) takes the sentence away. An older research (no `handoffs`: it
 * opens its menu without a session, so the terminal cannot be told) ends quietly at its limit, the element at rest
 * and no sentence. A bridge known down (its last ask failed less than 30 s ago) says the sentence at once.
 *
 * The page cannot see the terminal: the hand-over, the asks and the bridge's state come from the caller (deps).
 */

import { strings } from '../strings.js';
import { researchUrlMark, HANDOFFS_FEATURE, type LiveStatus } from '../research-link.js';
import { runBusy, isBusy, clearBusyMessage, activatedElement, trackActivations, BUSY_TIMEOUTS } from './busy.js';

export interface OpenBusyDeps {
    /** Give the link to the system (the research's scheme); `handoff` goes into it as `&handoff=`. */
    handOver(url: string, handoff: string | null): void;
    /** Ask the research's bridge now (null: no answer). */
    ask(researchId: string): Promise<LiveStatus | null>;
    /** The research's status as last known in this page (null: none). */
    statusNow(researchId: string): LiveStatus | null;
    /** The research's bridge did not answer an ask made less than 30 s ago. */
    bridgeDown(researchId: string): boolean;
    /** A new handoff id (default: crypto.randomUUID()). */
    newId?(): string;
}

export interface OpenBusyOpts {
    /** The agent starts working in the terminal ("Opening the agent…"), whatever the link's mark says. */
    agent?: boolean;
    /** The limit (default 10 s; the queue's work 30 s). */
    timeoutMs?: number;
    /** The row that takes the state when the element goes (a closed menu). */
    rowOf?: Element;
    /** Another proof than the link's handoff or a new session. */
    proof?: (st: LiveStatus) => boolean;
    /**
     * The link goes to another window that hands it over and waits for its proof (the overview's own window
     * asks its main window): the element shows the state a moment, the main window says the rest.
     */
    relayed?: boolean;
    /**
     * A link the research cannot prove (`new?app=`: no research yet): its limit ends quietly, the caller says what
     * follows (waiting for the research to come back for the tree, with its own limit and sentence).
     */
    quietLimit?: boolean;
    /** The wait ends quietly now (the research came back meanwhile). */
    signal?: AbortSignal;
    /**
     * The caller shows the state itself (the queue's start in the overview's Now): no toast when the element
     * goes, no sentence at the limit or for a research known down; the result says how it ended.
     */
    quiet?: boolean;
    /** A proof after the limit (the late watch): told to a quiet caller. */
    onLateProof?: () => void;
}

/** How long a relayed link's element shows its state. */
export const OPEN_RELAYED_MS = 1500;

export type OpenBusyResult = 'opened' | 'limit' | 'down' | 'busy';

/** How often the bridge is asked while waiting, and for how long after the limit (a late proof). */
export const OPEN_ASK_MS = 1000;
export const OPEN_LATE_ASK_MS = 2000;
export const OPEN_LATE_WATCH_MS = 60_000;

/**
 * The links waiting for their proof (by the link without its handoff): a second start within this time does nothing
 * (a double activation: a double click, the list drawn again under the pointer between its two clicks); later it is
 * a new start the person meant (another dialog's button, the card's ! once more), unless the element that shows the
 * state is still busy. Within a double click's time, never longer: two steps of a person take more.
 */
export const OPEN_REPEAT_MS = 400;
const inFlight = new Map<string, { at: number }>();
/** The late watch of each link after its limit (a new try ends it). */
const lateWatches = new Map<string, () => void>();

trackActivations();

/** The research id a link names (`tree=`); null: none (`new?app=`, a link to the research's own list). */
export function researchIdOfLink(url: string): string | null {
    const m = /^strom-research(?:-[a-z0-9-]{1,32})?:\/\/([a-z-]+)(?:\?(.*))?$/.exec(url.trim());
    if (!m) return null;
    return new URLSearchParams(m[2] ?? '').get('tree') || null;
}

/** The research reports the link it took only when it names a research (a new one from the app's tree has no bridge yet). */
function provable(url: string): boolean {
    const m = /^strom-research(?:-[a-z0-9-]{1,32})?:\/\/([a-z-]+)/.exec(url.trim());
    return !!m && m[1] !== 'new' && !!researchIdOfLink(url);
}

/** The link with its handoff id. */
export function withHandoff(url: string, handoff: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}handoff=${encodeURIComponent(handoff)}`;
}

function newHandoff(deps: OpenBusyDeps): string {
    if (deps.newId) return deps.newId().toLowerCase();
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID().toLowerCase();
    // A browser without randomUUID (an old one): an id of the same shape.
    const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

/**
 * How far a worker's `since` may move between two answers and still be the same session: a bridge (a demo's, a
 * stand-in's) that says it relative to now moves it a little with every answer; a new session starts later.
 */
const SAME_SESSION_MS = 60_000;

/** Whether `w` is a session `before` did not have (another agent, another session id, or one started later). */
function newWorker(w: { who: string; since: string; session?: string }, before: Array<{ who: string; since: string; session?: string }>): boolean {
    const at = Date.parse(w.since);
    return !before.some(b => b.who === w.who && (b.session ?? '') === (w.session ?? '')
        && (b.since === w.since || Number.isFinite(at) && Math.abs(at - Date.parse(b.since)) <= SAME_SESSION_MS));
}

/** Whether `st` proves the link with `handoff` was taken (against `base`, the status before the hand-over). */
export function handoffProven(st: LiveStatus, handoff: string | null, base: LiveStatus | null): boolean {
    if (st.features?.includes(HANDOFFS_FEATURE)) return !!handoff && !!st.handoffs?.includes(handoff);
    // An older research: a new session, or more of them.
    if (!base) return false;
    if ((st.busy?.sessions ?? 0) > (base.busy?.sessions ?? 0)) return true;
    const before = base.working ?? [];
    return (st.working ?? []).some(w => newWorker(w, before));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) { resolve(); return; }
        const t = setTimeout(done, ms);
        function done(): void { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
        signal.addEventListener('abort', done);
    });
}

/** One signal for either (the limit's, the caller's). */
function eitherSignal(a: AbortSignal, b?: AbortSignal): AbortSignal {
    if (!b) return a;
    const ac = new AbortController();
    const stop = (): void => ac.abort();
    if (a.aborted || b.aborted) stop();
    a.addEventListener('abort', stop);
    b.addEventListener('abort', stop);
    return ac.signal;
}

/** Without an element (an automatic action, the element gone before): a stand-in, its state in a toast. */
function standIn(): HTMLElement {
    return document.createElement('span');
}

/**
 * Hand `link` to the research, the element's state until the proof or the limit (see the file's comment).
 * `el` null: the element of the click that led here, else a toast carries the state.
 */
export async function openResearchBusy(el: HTMLElement | null, link: string, opts: OpenBusyOpts, deps: OpenBusyDeps): Promise<OpenBusyResult> {
    const key = link.trim();
    const target = el ?? activatedElement() ?? standIn();
    const running = inFlight.get(key);
    if (isBusy(target) || running && Date.now() - running.at < OPEN_REPEAT_MS) return 'busy';
    lateWatches.get(key)?.();
    lateWatches.delete(key);

    const urlMark = researchUrlMark(link);
    const terminal = opts.agent || urlMark !== 'none';
    const label = opts.agent || urlMark === 'agent' ? strings.busy.openingAgent
        : terminal ? strings.busy.openingResearch : strings.busy.generic;
    const researchId = researchIdOfLink(link);
    const canProve = provable(link) && !!researchId;
    const handoff = canProve && !opts.relayed ? newHandoff(deps) : null;
    const limit = opts.timeoutMs ?? BUSY_TIMEOUTS.terminal;
    let base = researchId ? deps.statusNow(researchId) : null;
    /** The research's last status seen while waiting (its features say whether it can prove the link). */
    let lastSeen: LiveStatus | null = base;
    const proven = (st: LiveStatus | null): boolean => {
        if (!st) return false;
        lastSeen = st;
        if (opts.proof?.(st)) return true;
        const ok = handoffProven(st, handoff, base);
        if (!base) base = st;
        return ok;
    };
    const retry = (): void => { void openResearchBusy(target.isConnected ? target : null, link, opts, deps); };
    const sentence = terminal
        ? { text: strings.busy.notOpened, hint: strings.busy.notOpenedHint }
        : { text: strings.research.openingQuietHint, hint: undefined };
    const down = !opts.relayed && !!researchId && deps.bridgeDown(researchId);

    const mine = { at: Date.now() };
    inFlight.set(key, mine);
    let result = 'limit' as OpenBusyResult;
    /**
     * An older research (its bridge answers without the `handoffs` feature) says no session for its menu opened in
     * the terminal: whether the terminal came up cannot be told, so its limit ends quietly (the element at rest, no
     * sentence). The queue's work keeps its own proof and its sentence.
     */
    const unprovable = (): boolean => !opts.proof && !!lastSeen && !lastSeen.features?.includes(HANDOFFS_FEATURE);
    let quietEnd = false;
    try {
        await runBusy(target, async (ctl) => {
            deps.handOver(link, handoff);
            if (opts.relayed) {
                result = 'opened';
                await sleep(OPEN_RELAYED_MS, ctl.signal);
                return;
            }
            if (down) {
                result = 'down';
                if (opts.quiet) return;
                ctl.end({ ok: false, kind: 'offline', neutral: true, text: sentence.text, hint: sentence.hint, retry });
                return;
            }
            const until = Date.now() + limit;
            const signal = eitherSignal(ctl.signal, opts.signal);
            while (canProve && Date.now() < until && !signal.aborted) {
                await sleep(Math.min(OPEN_ASK_MS, Math.max(0, until - Date.now())), signal);
                if (Date.now() >= until || signal.aborted) break;
                if (proven(await deps.ask(researchId!))) { result = 'opened'; return; }
            }
            if (!canProve) await sleep(Math.max(0, until - Date.now()), signal);
            // Stopped by the caller, or a quiet limit: no sentence (the caller says what follows).
            if (opts.signal?.aborted || opts.quietLimit && !canProve || opts.quiet) return;
            if (canProve && unprovable()) { quietEnd = true; return; }
            ctl.end({ ok: false, kind: 'timeout', neutral: true, text: sentence.text, hint: sentence.hint, retry });
        }, { label, kind: 'terminal', timeoutMs: limit + 5000, rowOf: opts.rowOf, toastWhenGone: !opts.quiet });
    } finally {
        if (inFlight.get(key) === mine) inFlight.delete(key);
    }
    // No sentence to take away (an older research's quiet limit): no late watch either.
    if (result === 'opened' || !canProve || quietEnd || !handoff && !opts.proof) return result;

    // A late proof (the browser's question answered late, a bridge starting): the sentence goes by itself.
    const ac = new AbortController();
    const cancel = (): void => ac.abort();
    lateWatches.set(key, cancel);
    const stop = Date.now() + OPEN_LATE_WATCH_MS;
    void (async () => {
        while (Date.now() < stop && !ac.signal.aborted) {
            await sleep(OPEN_LATE_ASK_MS, ac.signal);
            if (ac.signal.aborted) break;
            if (proven(await deps.ask(researchId!))) {
                if (ac.signal.aborted) break;
                clearBusyMessage(target);
                opts.onLateProof?.();
                break;
            }
        }
        if (lateWatches.get(key) === cancel) lateWatches.delete(key);
    })();
    return result;
}

/** For the tests: forget the links waiting and stop their late watches. */
export function resetOpenResearchBusy(): void {
    inFlight.clear();
    for (const stop of lateWatches.values()) stop();
    lateWatches.clear();
}
