/**
 * "Work on the queue…" once its terminal is asked for (waiting buttons §3.2,
 * 3a, 3b): the overview's Now says "Starting work on the queue…" (the agent
 * starts in the research's terminal) and both "Work on the queue…" buttons
 * (the Queue heading's, Now's) say "Starting…", until the research proves it
 * started — the link's handoff in its status, or a session or a run at work
 * there — and then the session's own row takes the place. Without a proof
 * within 30 s Now asks "Did the queue work not start?" ("The terminal did not
 * respond within 30 s." with Try again and the hint) and the buttons are free
 * again. The terminal took the link but no session came within the 30 s (it
 * asks before it starts): the row goes quietly.
 *
 * Kept here per research and scope, outside the overview's drawing: it
 * outlives every redraw, and the overview's own window gets it with the main
 * window's state. The scope (spec 126 U10): 'queue' for the general run, a
 * direction's id ("G0002") for its own run, so two starts stand side by side,
 * each with its own proof, limit and Try again. With the research's runs
 * (`/status.runs`, `run.lines`) the proof is a run of the scope there.
 */

/** What Now shows of a start: working on it, or the question after the limit. */
export type QueueStartPhase = 'starting' | 'silent';

export interface QueueStartView {
    phase: QueueStartPhase;
    startedAt: number;
}

/** How the link's hand-over ended (research-open-busy's OpenBusyResult). */
export type QueueStartLaunch = 'opened' | 'limit' | 'down' | 'busy';

export interface QueueStartDeps {
    /** Hand the link over and wait for its proof at most `limitMs` (quietly: Now says the state). */
    launch(opts: { limitMs: number; onLateProof: () => void }): Promise<QueueStartLaunch>;
    /** The state changed: Now and the buttons are drawn again. */
    changed(): void;
}

/** The limit of a start (BUSY_TIMEOUTS.queueWork). */
export const QUEUE_START_MS = 30_000;

interface Start {
    phase: QueueStartPhase;
    startedAt: number;
    /** The terminal took the link (its handoff); the session may come later. */
    proven: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    deps: QueueStartDeps;
    /** Try again: the same start once more. */
    again: () => void;
}

const starts = new Map<string, Start>();

/** The general run's scope (a direction's run: its id). */
export const QUEUE_SCOPE = 'queue';

const key = (researchId: string, scope: string = QUEUE_SCOPE): string => `${researchId.toLowerCase()}|${scope}`;

/** The start of the research's work in `scope` as Now draws it (null: none). */
export function queueStartOf(researchId: string | null | undefined, scope: string = QUEUE_SCOPE): QueueStartView | null {
    const s = researchId ? starts.get(key(researchId, scope)) : undefined;
    return s ? { phase: s.phase, startedAt: s.startedAt } : null;
}

/** A start is on its way (the buttons say "Starting…" and do nothing). */
export function queueStarting(researchId: string | null | undefined, scope: string = QUEUE_SCOPE): boolean {
    return queueStartOf(researchId, scope)?.phase === 'starting';
}

/** Every start of the research, the general run's first, then by when each began. */
export function queueStartsOf(researchId: string | null | undefined): Array<{ scope: string; view: QueueStartView }> {
    if (!researchId) return [];
    const prefix = `${researchId.toLowerCase()}|`;
    return [...starts.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, s]) => ({ scope: k.slice(prefix.length), view: { phase: s.phase, startedAt: s.startedAt } }))
        .sort((a, b) => (a.scope === QUEUE_SCOPE ? -1 : 0) - (b.scope === QUEUE_SCOPE ? -1 : 0) || a.view.startedAt - b.view.startedAt);
}

/** What a status says of who works, as a start's proof reads it. */
export interface QueueStartStatus {
    working?: readonly unknown[] | null;
    busy?: { sessions: number; runs: number } | null;
    /** The research's runs (`run.lines`): absent, the older proof (anyone at work). */
    runs?: readonly { research: string | null }[] | null;
}

/**
 * Whether `st` proves the start of `scope`: with the research's runs a run of the scope (the general run:
 * one without a direction); without them (an older research) a session or a run at work there.
 */
export function runStartProven(st: QueueStartStatus, scope: string = QUEUE_SCOPE): boolean {
    if (Array.isArray(st.runs)) return st.runs.some(r => scope === QUEUE_SCOPE ? !r.research : r.research === scope);
    if (scope !== QUEUE_SCOPE) return false;
    return (st.working?.length ?? 0) > 0 || (!!st.busy && (st.busy.sessions > 0 || st.busy.runs > 0));
}

function end(k: string, s: Start): void {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    if (starts.get(k) === s) starts.delete(k);
    s.deps.changed();
}

function silent(k: string, s: Start): void {
    if (starts.get(k) !== s || s.phase !== 'starting') return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    // The terminal took the link: nothing is wrong, the session comes when the terminal is answered.
    if (s.proven) { end(k, s); return; }
    s.phase = 'silent';
    s.deps.changed();
}

/**
 * Start the work of `scope` in `researchId`'s terminal (the link handed over by `deps.launch`). False: one of
 * the same scope is on its way already (a double activation hands nothing over).
 */
export function startQueueWork(researchId: string, deps: QueueStartDeps, now = Date.now(), scope: string = QUEUE_SCOPE): boolean {
    const k = key(researchId, scope);
    const was = starts.get(k);
    if (was?.phase === 'starting') return false;
    if (was?.timer) clearTimeout(was.timer);
    const s: Start = {
        phase: 'starting', startedAt: now, proven: false, timer: null, deps,
        again: () => { startQueueWork(researchId, deps, Date.now(), scope); },
    };
    starts.set(k, s);
    s.timer = setTimeout(() => silent(k, s), QUEUE_START_MS);
    deps.changed();
    void deps.launch({
        limitMs: QUEUE_START_MS,
        // Proven after the limit (the browser's question answered late): the question goes.
        onLateProof: () => { if (starts.get(k) === s && s.phase === 'silent') end(k, s); },
    }).then(r => {
        if (starts.get(k) !== s) return;
        if (r === 'opened') {
            s.proven = true;
            return;
        }
        if (r === 'busy') { end(k, s); return; }
        // Not proven within the limit, or the research known not running: the question now.
        silent(k, s);
    }, () => silent(k, s));
    return true;
}

/** Try again after the question (the same link once more). */
export function retryQueueStart(researchId: string, scope: string = QUEUE_SCOPE): void {
    starts.get(key(researchId, scope))?.again();
}

/**
 * What the research says now: a run of a start's scope (an older research: a session or a run at work)
 * ends that start (its own row takes the place).
 */
export function noteQueueStartStatus(researchId: string, st: QueueStartStatus): void {
    for (const { scope } of queueStartsOf(researchId)) {
        const k = key(researchId, scope);
        const s = starts.get(k);
        if (s && runStartProven(st, scope)) end(k, s);
    }
}

/** The start's state goes (the tree switched, the question closed). */
export function clearQueueStart(researchId: string, scope: string = QUEUE_SCOPE): void {
    const k = key(researchId, scope);
    const s = starts.get(k);
    if (s) end(k, s);
}

/** For the tests: no start. */
export function resetQueueStarts(): void {
    for (const s of starts.values()) if (s.timer) clearTimeout(s.timer);
    starts.clear();
}
