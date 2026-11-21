/**
 * The runs of the research (spec 126 U10): the general run (the whole queue, "Work on the queue") and
 * each direction's own run, as the app shows them. The one place that makes them of the bridge's status
 * (`/status.runs`, `runsEnded`, `working[]`, `researches[]`, `queue[]`, `limits`): their order in Now, which run holds
 * a direction, why a direction's run cannot start, which tasks of the queue the general run skips, the
 * runs ended a moment ago, and the agent kept for a direction. No DOM here.
 *
 * Everything needs `run.lines` in the research's `features` (and `/status.runs`): without it the status
 * carries no runs and every list here is empty — the app shows Now, the directions and the queue as before.
 */

import {
    LiveAgent, LiveDirection, LiveQueueCounts, LiveQueueItem, LiveRunEnded, LiveRunLimits, LiveRunWire, LiveWorker, RunEndedWhy,
    DIRECTIONS_MOVE_FEATURE, RUN_AGENTS_FEATURE, RUN_LIMIT_FEATURE, RUN_LINES_FEATURE, RUN_STOP_FEATURE,
    researchAgentRef, researchDirectionRef,
} from './research-link.js';
import { directionUnstarted } from './research-directions.js';

export { DIRECTIONS_MOVE_FEATURE, RUN_AGENTS_FEATURE, RUN_LIMIT_FEATURE, RUN_LINES_FEATURE, RUN_STOP_FEATURE };

/** The general run (the whole queue) or a direction's own run. */
export type RunKind = 'queue' | 'line';
/**
 * A run as the app shows it: `between` (between two sessions) reads as `working`, `paused` as `waiting`;
 * `starting` only for a start the app asked for and the bridge does not name yet (the research never sends it);
 * `ended` from `runsEnded`, or the app's memory of a run gone from `runs` (noteEndedRuns).
 */
export type RunState = 'starting' | 'working' | 'waiting' | 'finishing' | 'ended';
/** What a waiting run waits for (`paused.reason`); `other`: a reason not known here (its text in `reason`). */
export type RunWaitFor = 'limit' | 'browser' | 'download' | 'archive' | 'other';

export interface LiveRun {
    id: string;
    kind: RunKind;
    /** The direction of its own run ("G0001"; only with `kind: 'line'`). */
    research?: string;
    agent: string;
    agentName: string;
    model?: string;
    /** The session working now ("N0141"): "Finish and stop" of an older research goes by it. */
    session?: string;
    /** The task it works on ("T0388") and its last step. */
    task?: string;
    lastStep?: string;
    sessions?: number;
    /** Since when it runs (ISO; '' = not said). */
    since: string;
    state: RunState;
    /** Only with `state: 'waiting'`: what for, until when (ISO, absent: not said) and the research's reason. */
    wait?: { for: RunWaitFor; until?: string; reason?: string };
    /** The rows of `working[]` of this run (as the bridge orders them: the newest step first). */
    workers: LiveWorker[];
    /** When it ended (ms; only with `state: 'ended'`, kept for RUN_ENDED_MS): the research's `ended`, else when the app saw it go. */
    endedAt?: number;
    /** Why it ended (`runsEnded[].why`; absent: not said or a word not known here). */
    endedWhy?: RunEndedWhy;
}

/** The most runs at once when the research does not say (`run.parallel`'s default). */
export const RUN_LIMIT_DEFAULT = 3;
/** The highest value offered when the research does not say its `cap`. */
export const RUN_LIMIT_CAP_DEFAULT = 10;
/** How long a run that ended stays in Now ("ended at 11:52"). */
export const RUN_ENDED_MS = 60_000;

/** What the runs are read from: a followed session or the bridge's last status. */
export interface RunsSource {
    features?: readonly string[] | null;
    working: readonly LiveWorker[];
    runs?: readonly LiveRunWire[];
    runsEnded?: readonly LiveRunEnded[];
    agents?: readonly LiveAgent[];
    researches: readonly LiveDirection[];
}

// ==================== FEATURES ====================

const has = (features: readonly string[] | null | undefined, f: string): boolean => !!features?.includes(f);
/** The research starts a run for one direction (`run.lines`): anything new of this module is offered only then. */
export const runLinesOn = (features: readonly string[] | null | undefined): boolean => has(features, RUN_LINES_FEATURE);
/** It names its agents and takes `agent=` (`run.agents`). */
export const runAgentsOn = (features: readonly string[] | null | undefined): boolean => has(features, RUN_AGENTS_FEATURE);
/** It stops one run through the bridge (`run.stop`). */
export const runStopOn = (features: readonly string[] | null | undefined): boolean => has(features, RUN_STOP_FEATURE);
/** It takes the most runs at once from the app (`run.limit`). */
export const runLimitOn = (features: readonly string[] | null | undefined): boolean => has(features, RUN_LIMIT_FEATURE);
/** It previews and moves tasks into a narrower direction (`directions.move`). */
export const directionsMoveOn = (features: readonly string[] | null | undefined): boolean => has(features, DIRECTIONS_MOVE_FEATURE);

// ==================== RUNS ====================

const WAIT_FOR: readonly string[] = ['limit', 'browser', 'download', 'archive'];

/** A run of the bridge as the app shows it (its rows of `working[]` given). */
export function runOfWire(w: LiveRunWire, workers: LiveWorker[] = []): LiveRun {
    const state: RunState = w.state === 'between' ? 'working' : w.state === 'paused' ? 'waiting' : w.state;
    const reason = w.paused?.reason ?? '';
    const wait = state === 'waiting' ? {
        for: (WAIT_FOR.includes(reason) ? reason : 'other') as RunWaitFor,
        ...(w.paused?.until ? { until: w.paused.until } : {}),
        ...(reason && !WAIT_FOR.includes(reason) ? { reason } : {}),
    } : null;
    return {
        id: w.id, kind: w.research ? 'line' : 'queue', ...(w.research ? { research: w.research } : {}),
        agent: w.agent, agentName: w.agentName, ...(w.model ? { model: w.model } : {}),
        ...(w.session ? { session: w.session } : {}), ...(w.task ? { task: w.task } : {}), ...(w.lastStep ? { lastStep: w.lastStep } : {}),
        ...(w.sessions !== undefined ? { sessions: w.sessions } : {}),
        since: w.since, state, ...(wait ? { wait } : {}), workers,
    };
}

/** A direction's place in the order of work (`order`, else as sent); unknown: after all. */
function directionRank(researches: readonly LiveDirection[]): (id: string | undefined) => number {
    const ranked = researches.map((d, i) => ({ d, i }))
        .sort((a, b) => (a.d.order ?? Infinity) - (b.d.order ?? Infinity) || a.i - b.i)
        .map(x => x.d.id);
    return id => {
        const at = id ? ranked.indexOf(id) : -1;
        return at < 0 ? ranked.length : at;
    };
}

/** Runs in Now's order: the general run first, then the directions' runs in the order of the directions (Milan's question 3). */
export function orderRuns<T extends Pick<LiveRun, 'kind' | 'research'>>(runs: readonly T[], researches: readonly LiveDirection[]): T[] {
    const rank = directionRank(researches);
    return runs.map((r, i) => ({ r, i }))
        .sort((a, b) => (a.r.kind === 'queue' ? -1 : rank(a.r.research)) - (b.r.kind === 'queue' ? -1 : rank(b.r.research)) || a.i - b.i)
        .map(x => x.r);
}

/** A run of `runsEnded` as the app shows it (its agent's name from `agents`, else its id). */
export function runOfEnded(e: LiveRunEnded, agents: readonly LiveAgent[] = []): LiveRun {
    return {
        id: e.id, kind: e.research ? 'line' : 'queue', ...(e.research ? { research: e.research } : {}),
        agent: e.agent, agentName: agents.find(a => a.id === e.agent)?.name ?? e.agent,
        since: e.since, state: 'ended', workers: [], endedAt: Date.parse(e.ended), ...(e.why ? { endedWhy: e.why } : {}),
    };
}

/**
 * The runs working now and those ended less than RUN_ENDED_MS before `now` (`runsEnded`), in Now's order,
 * each working one with its rows of `working[]`: a row naming its run (`working[].run`) goes to it, a row
 * without one to the run of the same session. Empty without `/status.runs` (an older research: Now as before).
 */
export function liveRuns(s: RunsSource, now: number = Date.now()): LiveRun[] {
    if (!s.runs) return [];
    const ids = new Set(s.runs.map(r => r.id));
    const runs = s.runs.map(w => runOfWire(w, s.working.filter(row =>
        row.run && ids.has(row.run) ? row.run === w.id : !!row.session && row.session === w.session)));
    // A run ended a moment ago, until RUN_ENDED_MS (an end time ahead of this clock counts as now).
    for (const e of s.runsEnded ?? []) {
        if (ids.has(e.id) || now - Date.parse(e.ended) >= RUN_ENDED_MS) continue;
        ids.add(e.id);
        runs.push(runOfEnded(e, s.agents));
    }
    return orderRuns(runs, s.researches);
}

const live = (r: LiveRun): boolean => r.state !== 'ended';

/** The direction's own run (not one ended), or null. */
export function lineRunOf(runs: readonly LiveRun[], researchId: string): LiveRun | null {
    return runs.find(r => live(r) && r.kind === 'line' && r.research === researchId) ?? null;
}

/** The general run (not one ended), or null. */
export function queueRunOf(runs: readonly LiveRun[]): LiveRun | null {
    return runs.find(r => live(r) && r.kind === 'queue') ?? null;
}

/** The directions with their own run (G…; ended runs not). */
export function linesWithRun(runs: readonly LiveRun[]): Set<string> {
    return new Set(runs.filter(r => live(r) && r.kind === 'line' && r.research).map(r => r.research!));
}

/** The runs that count toward the most at once: all but those ended (the general run counts; a conversation is no run). */
export function runCount(runs: readonly LiveRun[]): number {
    return runs.filter(live).length;
}

/** The most runs at once (`limits.maxRuns`; 3 when not said). */
export function runLimit(status: { limits?: LiveRunLimits } | null | undefined): number {
    return status?.limits?.maxRuns ?? RUN_LIMIT_DEFAULT;
}

/** The highest "most runs at once" offered (`limits.cap`; 10 when not said; never below the limit set). */
export function runLimitCap(status: { limits?: LiveRunLimits } | null | undefined): number {
    return Math.max(status?.limits?.cap ?? RUN_LIMIT_CAP_DEFAULT, runLimit(status));
}

/** No further run may start: the runs working and the starts on their way (`starting`) reach the most at once. */
export function atRunLimit(runs: readonly LiveRun[], max: number, starting = 0): boolean {
    return runCount(runs) + Math.max(0, starting) >= max;
}

/**
 * Why a direction's run cannot start, or null when it can:
 * - `ended`: an ended direction (the action is not drawn);
 * - `running`: it has its own run (the bridge's `run`, or one of `runs`);
 * - with the bridge's `canStart: false` its `why` (`done` reads as `ended`; `unknown` when it said none);
 * - else the app's own, first that holds: `paused` > `empty` (nothing up next in its queue, or not begun and
 *   nothing found) > `limit` (the most runs at once reached, starts on their way counted).
 * The bridge's `canStart: true` leaves only the limit of starts the research does not know of yet.
 */
export type LineRunBlock = 'running' | 'paused' | 'ended' | 'empty' | 'limit'
    | 'noAgent' | 'archive' | 'waitingAgent' | 'oldRun' | 'unknown';

export function lineRunBlock(d: LiveDirection, runs: readonly LiveRun[], counts: LiveQueueCounts | undefined,
    max: number, starting = 0): LineRunBlock | null {
    if (d.state === 'done') return 'ended';
    if (d.run || lineRunOf(runs, d.id)) return 'running';
    if (d.canStart === false) return d.why === 'done' ? 'ended' : d.why ?? 'unknown';
    if (d.canStart === true) return starting > 0 && atRunLimit(runs, max, starting) ? 'limit' : null;
    if (d.state === 'paused') return 'paused';
    const upNext = counts ? counts.research[d.id] ?? 0 : d.tasks;
    if (upNext === 0 || (directionUnstarted(d) && !d.found)) return 'empty';
    if (atRunLimit(runs, max, starting)) return 'limit';
    return null;
}

// ==================== THE QUEUE ====================

/**
 * The direction whose own run takes the task (one of `lines`), or null (the general run takes it):
 * - the bridge's `queue[].run` first: a direction's run (its direction), the general run (null);
 * - else the task's direction (`research`, also a task helping it from outside its people) or the
 *   direction `why` says it helps or belongs to, when that one has its own run;
 * - history and work outside the directions stay the general run's.
 */
export function queueTaskTakenByLine(q: LiveQueueItem, lines: ReadonlySet<string>, runs: readonly LiveRun[] = []): string | null {
    if (q.run) {
        const run = runs.find(r => live(r) && r.id === q.run);
        if (run) return run.kind === 'line' && run.research ? run.research : null;
    }
    if (lines.size === 0 || q.kind === 'history') return null;
    if (q.research && lines.has(q.research)) return q.research;
    const why = q.why;
    if (why && (why.kind === 'helps' || why.kind === 'line') && lines.has(why.research)) return why.research;
    return null;
}

/** The queue the general run takes, in its order: without the tasks of directions with their own run. */
export function queueForGeneralRun(queue: readonly LiveQueueItem[], lines: ReadonlySet<string>, runs: readonly LiveRun[] = []): LiveQueueItem[] {
    return queue.filter(q => !queueTaskTakenByLine(q, lines, runs));
}

/** A direction with its own run in the queue: its run, its tasks of the status (up next) and how many it has up next. */
export interface LineRunGroup {
    research: string;
    direction?: LiveDirection;
    run: LiveRun;
    items: LiveQueueItem[];
    /** Tasks up next of the direction: the whole queue's count (`queueCounts.research`), at least those of the status. */
    tasks: number;
}

/** The queue's rows set apart for the directions with their own run, in Now's order of the runs. */
export function lineRunGroups(queue: readonly LiveQueueItem[], counts: LiveQueueCounts | undefined, runs: readonly LiveRun[],
    researches: readonly LiveDirection[] = []): LineRunGroup[] {
    const lines = linesWithRun(runs);
    const out: LineRunGroup[] = [];
    for (const run of runs) {
        if (!live(run) || run.kind !== 'line' || !run.research || out.some(g => g.research === run.research)) continue;
        const items = queue.filter(q => q.state === 'next' && queueTaskTakenByLine(q, lines, runs) === run.research);
        const direction = researches.find(d => d.id === run.research);
        out.push({
            research: run.research, ...(direction ? { direction } : {}), run, items,
            tasks: Math.max(counts?.research[run.research] ?? 0, items.length),
        });
    }
    return out;
}

/**
 * Tasks up next the general run takes: the bridge's `queueCounts.general`, else the whole queue's count
 * without the directions' own runs (`next` − their `research` counts), else those of the status.
 */
export function generalQueueCount(queue: readonly LiveQueueItem[], counts: LiveQueueCounts | undefined, runs: readonly LiveRun[]): number {
    if (counts?.general !== undefined) return counts.general;
    const lines = linesWithRun(runs);
    if (counts) return Math.max(0, counts.next - [...lines].reduce((n, g) => n + (counts.research[g] ?? 0), 0));
    return queueForGeneralRun(queue, lines, runs).filter(q => q.state === 'next').length;
}

// ==================== ENDED RUNS ====================

/**
 * The runs to show after a new status: `next`, and each run of `prev` gone from it as `ended` (from `now`,
 * placed where it stood) until RUN_ENDED_MS have passed. A run back with the same id is the bridge's again;
 * one the research names in `runsEnded` comes in `next` already (liveRuns) with its own end and reason —
 * this keeps the ones it does not name (an older bridge, a status between).
 */
export function noteEndedRuns(prev: readonly LiveRun[], next: readonly LiveRun[], now: number): LiveRun[] {
    const ids = new Set(next.map(r => r.id));
    const out: LiveRun[] = [...next];
    prev.forEach((r, i) => {
        if (ids.has(r.id)) return;
        const endedAt = r.state === 'ended' ? r.endedAt ?? now : now;
        if (now - endedAt >= RUN_ENDED_MS) return;
        const { wait: _w, ...rest } = r;
        const ended: LiveRun = { ...rest, state: 'ended', endedAt, workers: [] };
        // After the nearest run before it that is still shown; else first (a direction's run: after the general one).
        let at = -1;
        for (let j = i - 1; j >= 0 && at < 0; j--) at = out.findIndex(x => x.id === prev[j].id);
        if (at < 0 && ended.kind === 'line') at = out.findIndex(x => x.kind === 'queue');
        out.splice(at + 1, 0, ended);
    });
    return out;
}

/** The runs last shown by research (its bridge's base): the memory noteEndedRuns needs over the redraws. */
const shown = new Map<string, LiveRun[]>();

/** The runs to show for a research now (its runs ended a moment ago kept), remembered for the next status. */
export function runsShown(key: string, next: readonly LiveRun[], now: number): LiveRun[] {
    const out = noteEndedRuns(shown.get(key) ?? [], next, now);
    shown.set(key, out);
    return out;
}

/** Forget the runs shown (one research's, or all). */
export function forgetRunsShown(key?: string): void {
    if (key === undefined) shown.clear();
    else shown.delete(key);
}

// ==================== THE AGENT OF A DIRECTION ====================

/** Where the app keeps the agent chosen for a direction's run: `{ [researchId]: { [G…]: agentId } }`. */
export const LINE_RUN_AGENT_KEY = 'strom-line-run-agent';

function readLineAgents(): Record<string, Record<string, string>> {
    try {
        const raw = JSON.parse(localStorage.getItem(LINE_RUN_AGENT_KEY) ?? '{}') as unknown;
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, Record<string, string>> : {};
    } catch {
        return {};
    }
}

/** The agent last chosen here for the direction's run (null: none, or not readable). */
export function rememberedLineAgent(researchId: string, line: string): string | null {
    const kept = readLineAgents()[researchId];
    return kept && typeof kept === 'object' ? researchAgentRef(kept[line]) : null;
}

/** Keep the agent chosen for the direction's run (after "Start"; nothing when storage is not there). */
export function rememberLineAgent(researchId: string, line: string, agent: string): void {
    const id = researchAgentRef(agent);
    const g = researchDirectionRef(line);
    if (!id || !g || g !== line || !researchId) return;
    try {
        const all = readLineAgents();
        const kept = all[researchId] && typeof all[researchId] === 'object' ? all[researchId] : {};
        all[researchId] = { ...kept, [g]: id };
        localStorage.setItem(LINE_RUN_AGENT_KEY, JSON.stringify(all));
    } catch { /* not kept: the default next time */ }
}

/**
 * The agent chosen first for a direction's run: the one the research keeps for it (`researches[].agent`),
 * else the one chosen here last time, else the research's default, else the first — each only when it is
 * among `agents`. Null: no agents said.
 */
export function lineRunAgent(d: Pick<LiveDirection, 'id' | 'agent'>, agents: readonly LiveAgent[] | undefined, researchId: string): string | null {
    if (!agents || agents.length === 0) return null;
    const known = (id: string | null | undefined): string | null => id && agents.some(a => a.id === id) ? id : null;
    return known(d.agent) ?? known(rememberedLineAgent(researchId, d.id)) ?? agents.find(a => a.default)?.id ?? agents[0].id;
}
