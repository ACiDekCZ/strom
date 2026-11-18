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
 * Kept here per research, outside the overview's drawing: it outlives every
 * redraw, and the overview's own window gets it with the main window's state.
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

const key = (researchId: string): string => researchId.toLowerCase();

/** The start of the research's queue work as Now draws it (null: none). */
export function queueStartOf(researchId: string | null | undefined): QueueStartView | null {
    const s = researchId ? starts.get(key(researchId)) : undefined;
    return s ? { phase: s.phase, startedAt: s.startedAt } : null;
}

/** A start is on its way (the buttons say "Starting…" and do nothing). */
export function queueStarting(researchId: string | null | undefined): boolean {
    return queueStartOf(researchId)?.phase === 'starting';
}

function end(researchId: string, s: Start): void {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    if (starts.get(key(researchId)) === s) starts.delete(key(researchId));
    s.deps.changed();
}

function silent(researchId: string, s: Start): void {
    if (starts.get(key(researchId)) !== s || s.phase !== 'starting') return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    // The terminal took the link: nothing is wrong, the session comes when the terminal is answered.
    if (s.proven) { end(researchId, s); return; }
    s.phase = 'silent';
    s.deps.changed();
}

/**
 * Start the queue's work in `researchId`'s terminal (the link handed over by `deps.launch`). False: one is on
 * its way already (a double activation hands nothing over).
 */
export function startQueueWork(researchId: string, deps: QueueStartDeps, now = Date.now()): boolean {
    const k = key(researchId);
    const was = starts.get(k);
    if (was?.phase === 'starting') return false;
    if (was?.timer) clearTimeout(was.timer);
    const s: Start = {
        phase: 'starting', startedAt: now, proven: false, timer: null, deps,
        again: () => { startQueueWork(researchId, deps); },
    };
    starts.set(k, s);
    s.timer = setTimeout(() => silent(researchId, s), QUEUE_START_MS);
    deps.changed();
    void deps.launch({
        limitMs: QUEUE_START_MS,
        // Proven after the limit (the browser's question answered late): the question goes.
        onLateProof: () => { if (starts.get(k) === s && s.phase === 'silent') end(researchId, s); },
    }).then(r => {
        if (starts.get(k) !== s) return;
        if (r === 'opened') {
            s.proven = true;
            return;
        }
        if (r === 'busy') { end(researchId, s); return; }
        // Not proven within the limit, or the research known not running: the question now.
        silent(researchId, s);
    }, () => silent(researchId, s));
    return true;
}

/** Try again after the question (the same link once more). */
export function retryQueueStart(researchId: string): void {
    starts.get(key(researchId))?.again();
}

/**
 * What the research says now: a session or a run at work there ends the start (its own row takes the place).
 * `working`: rows of who works; `busy`: sessions and runs.
 */
export function noteQueueStartStatus(researchId: string, st: { working?: readonly unknown[] | null; busy?: { sessions: number; runs: number } | null }): void {
    const s = starts.get(key(researchId));
    if (!s) return;
    const atWork = (st.working?.length ?? 0) > 0 || (!!st.busy && (st.busy.sessions > 0 || st.busy.runs > 0));
    if (atWork) end(researchId, s);
}

/** The start's state goes (the tree switched, the question closed). */
export function clearQueueStart(researchId: string): void {
    const s = starts.get(key(researchId));
    if (s) end(researchId, s);
}

/** For the tests: no start. */
export function resetQueueStarts(): void {
    for (const s of starts.values()) if (s.timer) clearTimeout(s.timer);
    starts.clear();
}
