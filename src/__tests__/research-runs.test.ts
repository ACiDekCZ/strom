/**
 * The runs of the directions (spec 126 U10): the runs made of the bridge's status (their order in Now,
 * the rows of `working[]` of each, the states), why a direction's run cannot start, the limit with starts
 * on their way, the queue the general run takes, the runs ended a moment ago, the agent kept for a
 * direction, and the writes through the bridge (stop a run, the most at once, the tasks moved into a
 * narrower direction). Invented data only (the research "Kubíčkovi a Malí").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    LiveRun, RUN_ENDED_MS, RUN_LIMIT_DEFAULT, atRunLimit, forgetRunsShown, generalQueueCount, lineRunAgent, lineRunBlock,
    lineRunGroups, lineRunOf, linesWithRun, liveRuns, noteEndedRuns, queueForGeneralRun, queueRunOf, queueTaskTakenByLine,
    rememberLineAgent, rememberedLineAgent, runCount, runLimit, runLimitCap, runLinesOn, runOfWire, runsShown,
    LINE_RUN_AGENT_KEY,
} from '../research-runs.js';
import { LiveDirection, LiveQueueCounts, LiveQueueItem, sanitizeLiveStatus } from '../research-link.js';
import { postRunLimit, postRunStop, runLimitRaise } from '../research-runs-write.js';
import { createDirection, previewDirection, undoGather } from '../research-directions-write.js';
import { setLanguage, strings } from '../strings.js';
import { pausedReasonText } from '../ui/research-ui.js';
import { lineRunWaitLine, runEndedText, runsWaitingText } from '../research-runs-text.js';

const TREE = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const FEATURES = ['run.lines', 'run.agents', 'run.stop', 'run.limit', 'directions.move', 'queue.page', 'offLine.branches'];

const RESEARCHES = [
    { id: 'G0002', name: 'Malí z Horní Vsi', state: 'active', order: 2, tasks: 7 },
    { id: 'G0001', name: 'Kubíčkovi z Dolní Lhoty', state: 'active', order: 1, tasks: 3, run: 'run-1a07', canStart: false, why: 'running' },
    { id: 'G0003', name: 'Šustrovi', state: 'paused', order: 3, tasks: 2 },
];

/** A status as the bridge sends it: a general run, the run of G0001, the run of G0002 waiting for the usage limit. */
function wireStatus(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        tree: { id: TREE, name: 'Kubíčkovi a Malí' }, head: 'abc1234', features: FEATURES,
        researches: RESEARCHES,
        runs: [
            { id: 'run-77d1', research: 'G0002', agent: 'codex', agentName: 'Codex', since: '2026-11-21T11:05:00Z', state: 'paused',
                paused: { until: '2026-11-21T14:00:00Z', reason: 'limit' } },
            { id: 'run-1a07', research: 'G0001', agent: 'claude', agentName: 'Claude', since: '2026-11-21T10:42:00Z', state: 'between',
                session: 'N0142', task: 'T0390', lastStep: 'Hledá oddací záznam v matrice Dolní Lhota' },
            { id: 'run-8f2c', research: null, agent: 'claude', agentName: 'Claude', model: 'opus', since: '2026-11-21T10:02:00Z', state: 'working',
                session: 'N0141', task: 'T0388', lastStep: 'Hledá křest Josefa Kubíčka v matrice Dolní Lhota 1850–1870', sessions: 3 },
        ],
        working: [
            { who: 'claude', since: '2026-11-21T11:30:00Z', task: 'křest Josefa Kubíčka', person: 'P0001', session: 'N0141' },
            { who: 'claude', since: '2026-11-21T11:31:00Z', task: 'oddací záznam', person: 'P0002', research: 'G0001', session: 'N0142', run: 'run-1a07' },
        ],
        limits: { maxRuns: 3, running: 3, cap: 10 },
        runsEnded: [
            { id: 'run-5b20', research: 'G0003', agent: 'codex', since: '2026-11-21T09:10:00Z', ended: '2026-11-21T11:51:30Z', why: 'stopped' },
            { id: 'run-4a11', research: null, agent: 'claude', since: '2026-11-21T08:00:00Z', ended: '2026-11-21T11:40:00Z', why: 'done' },
        ],
        agents: [{ id: 'claude', name: 'Claude', default: true }, { id: 'codex', name: 'Codex' }],
        ...extra,
    };
}

/** Now (fixed): 30 s after run-5b20 ended, 12 min after run-4a11. */
const NOW = Date.UTC(2026, 10, 21, 11, 52);
const status = (extra: Record<string, unknown> = {}) => sanitizeLiveStatus(wireStatus(extra))!;
const run = (over: Partial<LiveRun> & { id: string }): LiveRun => ({
    kind: 'line', agent: 'claude', agentName: 'Claude', since: '', state: 'working', workers: [], ...over,
});
const dir = (over: Partial<LiveDirection> & { id: string }): LiveDirection => ({ name: over.id, state: 'active', ...over });
const counts = (research: Record<string, number>, next = 10): LiveQueueCounts => ({ research, branch: {}, next, parked: 0, rev: 'abcdef0123456789' });

describe('runs of the status', () => {
    it('the general run first, then the directions\' runs in the order of the directions', () => {
        const runs = liveRuns(status(), NOW);
        expect(runs.map(r => r.id)).toEqual(['run-8f2c', 'run-1a07', 'run-77d1', 'run-5b20']);
        expect(runs.map(r => r.kind)).toEqual(['queue', 'line', 'line', 'line']);
        expect(runs[1].research).toBe('G0001');
    });

    it('a run of runsEnded stays ended 60 s from its end, with its reason and its agent\'s name', () => {
        const ended = liveRuns(status(), NOW).find(r => r.id === 'run-5b20')!;
        expect(ended).toEqual({ id: 'run-5b20', kind: 'line', research: 'G0003', agent: 'codex', agentName: 'Codex', since: '2026-11-21T09:10:00Z',
            state: 'ended', workers: [], endedAt: Date.UTC(2026, 10, 21, 11, 51, 30), endedWhy: 'stopped' });
        expect(liveRuns(status(), NOW + 30_000).map(r => r.id)).not.toContain('run-5b20');
        // A reason not known here: ended without one. An end ahead of this clock: just ended.
        const odd = liveRuns(status({ runsEnded: [{ id: 'run-5b20', research: 'G0003', agent: 'codex', ended: '2026-11-21T11:53:00Z', why: 'tired' }] }), NOW);
        expect(odd.find(r => r.id === 'run-5b20')).toMatchObject({ state: 'ended', agentName: 'Codex' });
        expect(odd.find(r => r.id === 'run-5b20')!.endedWhy).toBeUndefined();
        // Ended ones do not count, hold no direction, and are not the general run.
        const runs = liveRuns(status(), NOW);
        expect(runCount(runs)).toBe(3);
        expect(lineRunOf(runs, 'G0003')).toBeNull();
        // The general run ended, none running: only the ended one shown.
        expect(liveRuns(status({ runs: [], runsEnded: [{ id: 'run-4a11', research: null, agent: 'claude', ended: '2026-11-21T11:51:50Z', why: 'done' }] }), NOW)
            .map(r => [r.id, r.kind, r.state])).toEqual([['run-4a11', 'queue', 'ended']]);
        // noteEndedRuns keeps the research's end, not its own.
        const before = liveRuns(status({ runsEnded: [] }), NOW - 5000);
        const gone = noteEndedRuns([...before, run({ id: 'run-5b20', research: 'G0003' })], liveRuns(status(), NOW), NOW);
        expect(gone.find(r => r.id === 'run-5b20')!.endedAt).toBe(Date.UTC(2026, 10, 21, 11, 51, 30));
    });

    it('a row of working[] goes to the run it names, else to the run of its session', () => {
        const [general, g1, g2] = liveRuns(status(), NOW);
        expect(general.workers.map(w => w.person)).toEqual(['P0001']);
        expect(g1.workers.map(w => w.person)).toEqual(['P0002']);
        expect(g2.workers).toEqual([]);
    });

    it('states: between reads as working, paused as waiting with what for and until when', () => {
        const [general, g1, g2] = liveRuns(status(), NOW);
        expect(general.state).toBe('working');
        expect(g1.state).toBe('working');
        expect(g2.state).toBe('waiting');
        expect(g2.wait).toEqual({ for: 'limit', until: '2026-11-21T14:00:00Z' });
        const of = (reason: string) => runOfWire({ id: 'r', research: null, agent: 'claude', agentName: 'Claude', since: '', state: 'paused',
            paused: { until: '', reason } }).wait;
        expect(of('browser')).toEqual({ for: 'browser' });
        expect(of('download')).toEqual({ for: 'download' });
        expect(of('archive')).toEqual({ for: 'archive' });
        expect(of('Archiv má odstávku')).toEqual({ for: 'other', reason: 'Archiv má odstávku' });
        expect(runOfWire({ id: 'r', research: null, agent: 'claude', agentName: 'Claude', since: '', state: 'finishing' }).state).toBe('finishing');
    });

    it('without run.lines in the features nothing: no runs, no limits, no agents, the directions without their run', () => {
        const old = sanitizeLiveStatus({ ...wireStatus(), features: ['queue.page'] })!;
        expect(old.runs).toBeUndefined();
        expect(old.limits).toBeUndefined();
        expect(old.agents).toBeUndefined();
        expect(old.researches.find(d => d.id === 'G0001')).toEqual({ id: 'G0001', name: 'Kubíčkovi z Dolní Lhoty', state: 'active', order: 1, tasks: 3 });
        expect(runLinesOn(old.features)).toBe(false);
        expect(liveRuns(old, NOW)).toEqual([]);
        expect(runLimit(old)).toBe(RUN_LIMIT_DEFAULT);
        const none = sanitizeLiveStatus({ ...wireStatus(), features: undefined })!;
        expect(liveRuns(none, NOW)).toEqual([]);
    });

    it('lookups: the run of a direction, the general run, the directions with a run, the count (ended ones not)', () => {
        const runs = [...liveRuns(status(), NOW), run({ id: 'run-old', research: 'G0003', state: 'ended', endedAt: 1 })];
        expect(lineRunOf(runs, 'G0001')?.id).toBe('run-1a07');
        expect(lineRunOf(runs, 'G0003')).toBeNull();
        expect(queueRunOf(runs)?.id).toBe('run-8f2c');
        expect([...linesWithRun(runs)].sort()).toEqual(['G0001', 'G0002']);
        expect(runCount(runs)).toBe(3);
    });

    it('the limit: from the status (3 when not said), its cap (10 when not said), starts on their way counted', () => {
        expect(runLimit(status())).toBe(3);
        expect(runLimitCap(status())).toBe(10);
        expect(runLimit(status({ limits: { maxRuns: 5, running: 1 } }))).toBe(5);
        expect(runLimitCap(status({ limits: { maxRuns: 5, running: 1 } }))).toBe(10);
        expect(runLimitCap({ limits: { maxRuns: 12, running: 0 } })).toBe(12);
        expect(runLimit(undefined)).toBe(3);
        const two = [run({ id: 'a', kind: 'queue' }), run({ id: 'b', research: 'G0001' })];
        expect(atRunLimit(two, 3)).toBe(false);
        expect(atRunLimit(two, 3, 1)).toBe(true);
        expect(atRunLimit([...two, run({ id: 'c', research: 'G0002', state: 'ended', endedAt: 1 })], 3)).toBe(false);
        expect(atRunLimit([...two, run({ id: 'c', research: 'G0002' })], 3)).toBe(true);
    });
});

describe('why a direction\'s run cannot start (lineRunBlock)', () => {
    const none: LiveRun[] = [];
    it('a direction that can start', () => {
        expect(lineRunBlock(dir({ id: 'G0002', tasks: 7 }), none, counts({ G0002: 7 }), 3)).toBeNull();
    });

    it('running: its own run (in runs or the bridge\'s run)', () => {
        expect(lineRunBlock(dir({ id: 'G0001' }), [run({ id: 'r1', research: 'G0001' })], counts({ G0001: 2 }), 3)).toBe('running');
        expect(lineRunBlock(dir({ id: 'G0001', run: 'r1' }), none, counts({ G0001: 2 }), 3)).toBe('running');
        // An ended run does not hold it.
        expect(lineRunBlock(dir({ id: 'G0001', tasks: 2 }), [run({ id: 'r1', research: 'G0001', state: 'ended', endedAt: 1 })], counts({ G0001: 2 }), 3)).toBeNull();
    });

    it('ended, paused, empty (no tasks up next, or not begun), limit', () => {
        expect(lineRunBlock(dir({ id: 'G0001', state: 'done' }), none, undefined, 3)).toBe('ended');
        expect(lineRunBlock(dir({ id: 'G0001', state: 'paused', tasks: 4 }), none, counts({ G0001: 4 }), 3)).toBe('paused');
        expect(lineRunBlock(dir({ id: 'G0001', tasks: 4 }), none, counts({}), 3)).toBe('empty');
        expect(lineRunBlock(dir({ id: 'G0001', tasks: 0 }), none, undefined, 3)).toBe('empty');
        expect(lineRunBlock(dir({ id: 'G0001' }), none, undefined, 3)).toBe('empty');
        const full = [run({ id: 'a', kind: 'queue' }), run({ id: 'b', research: 'G0002' }), run({ id: 'c', research: 'G0003' })];
        expect(lineRunBlock(dir({ id: 'G0001', tasks: 4 }), full, counts({ G0001: 4 }), 3)).toBe('limit');
        expect(lineRunBlock(dir({ id: 'G0001', tasks: 4 }), full.slice(0, 2), counts({ G0001: 4 }), 3, 1)).toBe('limit');
    });

    it('order when more hold: paused > empty > limit', () => {
        const full = [run({ id: 'a', kind: 'queue' }), run({ id: 'b', research: 'G0002' }), run({ id: 'c', research: 'G0003' })];
        expect(lineRunBlock(dir({ id: 'G0001', state: 'paused', tasks: 0 }), full, counts({}), 3)).toBe('paused');
        expect(lineRunBlock(dir({ id: 'G0001', tasks: 0 }), full, counts({}), 3)).toBe('empty');
    });

    it('the bridge\'s canStart / why come first; an unknown word reads as unknown', () => {
        expect(lineRunBlock(dir({ id: 'G0001', canStart: false, why: 'noAgent', tasks: 4 }), none, counts({ G0001: 4 }), 3)).toBe('noAgent');
        expect(lineRunBlock(dir({ id: 'G0001', canStart: false, why: 'oldRun', tasks: 4 }), none, counts({ G0001: 4 }), 3)).toBe('oldRun');
        expect(lineRunBlock(dir({ id: 'G0001', canStart: false, why: 'done' }), none, undefined, 3)).toBe('ended');
        expect(lineRunBlock(dir({ id: 'G0001', canStart: false }), none, undefined, 3)).toBe('unknown');
        // The bridge says it can (a paused-looking count of its own does not matter) — only starts it does not know of yet hold it.
        expect(lineRunBlock(dir({ id: 'G0001', canStart: true, tasks: 0 }), none, counts({}), 3)).toBeNull();
        const two = [run({ id: 'a', kind: 'queue' }), run({ id: 'b', research: 'G0002' })];
        expect(lineRunBlock(dir({ id: 'G0001', canStart: true }), two, undefined, 3, 1)).toBe('limit');
        const s = sanitizeLiveStatus(wireStatus({ researches: [{ id: 'G0004', name: 'Kubíčkovi z Lomu', state: 'active', canStart: false, why: 'later' }] }))!;
        expect(s.researches[0].why).toBe('unknown');
        expect(lineRunBlock(s.researches[0], none, undefined, 3)).toBe('unknown');
    });
});

describe('the queue of the general run', () => {
    const lines = new Set(['G0001']);
    const q = (over: Partial<LiveQueueItem> & { id: string }): LiveQueueItem => ({ text: over.id, state: 'next', ...over });

    it('a task of a direction with its own run, one helping it, one off the directions, history', () => {
        expect(queueTaskTakenByLine(q({ id: 'T1', research: 'G0001' }), lines)).toBe('G0001');
        expect(queueTaskTakenByLine(q({ id: 'T2', research: 'G0002' }), lines)).toBeNull();
        expect(queueTaskTakenByLine(q({ id: 'T3', helps: 'question', research: 'G0001' }), lines)).toBe('G0001');
        expect(queueTaskTakenByLine(q({ id: 'T4', why: { kind: 'helps', research: 'G0001', by: 'partner' } }), lines)).toBe('G0001');
        expect(queueTaskTakenByLine(q({ id: 'T5', offLine: 'last' }), lines)).toBeNull();
        expect(queueTaskTakenByLine(q({ id: 'T6', kind: 'history', research: 'G0001' }), lines)).toBeNull();
        expect(queueTaskTakenByLine(q({ id: 'T7', why: { kind: 'off', mode: 'occasional', branch: 'B-P0031' } }), lines)).toBeNull();
        expect(queueTaskTakenByLine(q({ id: 'T1', research: 'G0001' }), new Set())).toBeNull();
    });

    it('the bridge\'s queue[].run comes first', () => {
        const runs = [run({ id: 'run-8f2c', kind: 'queue' }), run({ id: 'run-1a07', research: 'G0001' })];
        // A task of a direction without a run that the run of G0001 takes (a common ancestor).
        expect(queueTaskTakenByLine(q({ id: 'T1', research: 'G0002', run: 'run-1a07' }), lines, runs)).toBe('G0001');
        // A task of G0001 the general run takes after all.
        expect(queueTaskTakenByLine(q({ id: 'T2', research: 'G0001', run: 'run-8f2c' }), lines, runs)).toBeNull();
        // A run not known (any more): as if not said.
        expect(queueTaskTakenByLine(q({ id: 'T3', research: 'G0001', run: 'run-gone' }), lines, runs)).toBe('G0001');
    });

    it('the general run\'s queue keeps its order; the directions\' groups with their counts', () => {
        const queue = [q({ id: 'T1', research: 'G0001' }), q({ id: 'T2', research: 'G0002' }), q({ id: 'T3' }),
            q({ id: 'T4', research: 'G0001' }), q({ id: 'T5', research: 'G0001', state: 'parked' })];
        const runs = [run({ id: 'a', kind: 'queue' }), run({ id: 'b', research: 'G0001', agentName: 'Codex' })];
        expect(queueForGeneralRun(queue, linesWithRun(runs), runs).map(x => x.id)).toEqual(['T2', 'T3']);
        const groups = lineRunGroups(queue, counts({ G0001: 12, G0002: 1 }, 20), runs, [dir({ id: 'G0001', name: 'Kubíčkovi z Dolní Lhoty' })]);
        expect(groups).toHaveLength(1);
        expect(groups[0].research).toBe('G0001');
        expect(groups[0].direction?.name).toBe('Kubíčkovi z Dolní Lhoty');
        expect(groups[0].items.map(x => x.id)).toEqual(['T1', 'T4']);
        expect(groups[0].tasks).toBe(12);
        expect(lineRunGroups(queue, undefined, runs)[0].tasks).toBe(2);
        expect(generalQueueCount(queue, { ...counts({ G0001: 12 }, 20), general: 6 }, runs)).toBe(6);
        expect(generalQueueCount(queue, counts({ G0001: 12 }, 20), runs)).toBe(8);
        expect(generalQueueCount(queue, undefined, runs)).toBe(2);
    });
});

describe('runs ended a moment ago', () => {
    const t0 = Date.UTC(2026, 10, 21, 10, 52);
    const general = run({ id: 'run-8f2c', kind: 'queue' });
    const g1 = run({ id: 'run-1a07', research: 'G0001', wait: { for: 'limit' } });
    const g2 = run({ id: 'run-77d1', research: 'G0002' });

    it('a run gone from the status stays ended 60 s where it stood, then goes', () => {
        const after = noteEndedRuns([general, g1, g2], [general, g2], t0);
        expect(after.map(r => r.id)).toEqual(['run-8f2c', 'run-1a07', 'run-77d1']);
        expect(after[1]).toMatchObject({ state: 'ended', endedAt: t0, workers: [] });
        expect(after[1].wait).toBeUndefined();
        const still = noteEndedRuns(after, [general, g2], t0 + RUN_ENDED_MS - 1);
        expect(still.map(r => r.id)).toEqual(['run-8f2c', 'run-1a07', 'run-77d1']);
        expect(still[1].endedAt).toBe(t0);
        expect(noteEndedRuns(still, [general, g2], t0 + RUN_ENDED_MS).map(r => r.id)).toEqual(['run-8f2c', 'run-77d1']);
    });

    it('a run back with the same id is not ended; a direction\'s run ended first stays after the general one', () => {
        const after = noteEndedRuns([general, g1], [general], t0);
        const back = noteEndedRuns(after, [general, g1], t0 + 1000);
        expect(back.map(r => [r.id, r.state])).toEqual([['run-8f2c', 'working'], ['run-1a07', 'working']]);
        const alone = noteEndedRuns([g1], [general], t0);
        expect(alone.map(r => r.id)).toEqual(['run-8f2c', 'run-1a07']);
    });

    it('kept over redraws by research', () => {
        forgetRunsShown();
        runsShown('a', [general, g1], t0);
        expect(runsShown('a', [general], t0 + 10).map(r => r.state)).toEqual(['working', 'ended']);
        expect(runsShown('b', [general], t0 + 10).map(r => r.state)).toEqual(['working']);
        forgetRunsShown('a');
        expect(runsShown('a', [general], t0 + 20).map(r => r.state)).toEqual(['working']);
    });
});

describe('the agent of a direction\'s run', () => {
    let store: Map<string, string>;
    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
        });
    });
    afterEach(() => { vi.unstubAllGlobals(); });
    const agents = [{ id: 'claude', name: 'Claude', default: true as const }, { id: 'codex', name: 'Codex' }];

    it('kept by research and direction; the research\'s own choice first, then the kept one, then the default', () => {
        expect(lineRunAgent({ id: 'G0002' }, agents, TREE)).toBe('claude');
        rememberLineAgent(TREE, 'G0002', 'codex');
        expect(rememberedLineAgent(TREE, 'G0002')).toBe('codex');
        expect(rememberedLineAgent(TREE, 'G0001')).toBeNull();
        expect(JSON.parse(store.get(LINE_RUN_AGENT_KEY)!)).toEqual({ [TREE]: { G0002: 'codex' } });
        expect(lineRunAgent({ id: 'G0002' }, agents, TREE)).toBe('codex');
        expect(lineRunAgent({ id: 'G0002', agent: 'claude' }, agents, TREE)).toBe('claude');
        // An agent no longer there is not chosen.
        expect(lineRunAgent({ id: 'G0002', agent: 'gemini' }, [agents[0]], TREE)).toBe('claude');
        expect(lineRunAgent({ id: 'G0002' }, [], TREE)).toBeNull();
        // Nothing kept that is not an agent's id or a direction.
        rememberLineAgent(TREE, 'G0003', 'Codex CLI');
        rememberLineAgent(TREE, 'X1', 'codex');
        expect(Object.keys(JSON.parse(store.get(LINE_RUN_AGENT_KEY)!)[TREE])).toEqual(['G0002']);
    });

    it('storage that throws or holds rubbish: nothing kept, nothing thrown', () => {
        store.set(LINE_RUN_AGENT_KEY, '{oops');
        expect(rememberedLineAgent(TREE, 'G0002')).toBeNull();
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
        expect(() => rememberLineAgent(TREE, 'G0002', 'codex')).not.toThrow();
        expect(rememberedLineAgent(TREE, 'G0002')).toBeNull();
    });
});

describe('writes of the runs through the bridge', () => {
    const BASE = 'http://127.0.0.1:5996/tok';
    let calls: { url: string; init: RequestInit }[] = [];
    const reply = (status: number, body: unknown) => {
        globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} });
            return new Response(JSON.stringify(body), { status });
        }) as typeof fetch;
    };
    const realFetch = globalThis.fetch;
    const sent = (i = 0) => JSON.parse(String(calls[i].init.body));
    beforeEach(() => { calls = []; });
    afterEach(() => { globalThis.fetch = realFetch; });

    it('stop a run: POST runs/stop {run}; the run finishing comes back; 404 runs.unknown; a bad id not sent', async () => {
        reply(200, { ok: true, run: { id: 'run-1a07', research: 'G0001', agent: 'claude', agentName: 'Claude', state: 'finishing' } });
        const r = await postRunStop(BASE, 'run-1a07');
        expect(calls[0].url).toContain('/tok/runs/stop');
        expect(calls[0].init.method).toBe('POST');
        expect(sent()).toEqual({ run: 'run-1a07' });
        expect(r.ok && r.run?.state).toBe('finishing');
        reply(404, { error: 'runs.unknown' });
        const gone = await postRunStop(BASE, 'run-1a07');
        expect(!gone.ok && gone.code).toBe('none');
        calls = [];
        expect((await postRunStop(BASE, 'run 1a07')).ok).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('the most runs at once: POST settings/runs {max}; the new limits; out of range not sent', async () => {
        reply(200, { ok: true, limits: { maxRuns: 2, running: 3, cap: 10 } });
        const r = await postRunLimit(BASE, 2);
        expect(calls[0].url).toContain('/tok/settings/runs');
        expect(sent()).toEqual({ max: 2 });
        expect(r.ok && r.limits).toEqual({ maxRuns: 2, running: 3, cap: 10 });
        expect(runLimitRaise(r)).toBeNull();
        // Raising it is the person's in the terminal: 403 runs.raise with the command.
        reply(403, { error: 'runs.raise', command: 'strom config set run.parallel 4' });
        const up = await postRunLimit(BASE, 4);
        expect(!up.ok && up.code).toBe('app-only');
        expect(runLimitRaise(up)).toEqual({ command: 'strom config set run.parallel 4' });
        reply(403, { error: 'runs.raise', command: 'rm -rf ~; strom' });
        expect(runLimitRaise(await postRunLimit(BASE, 5))).toEqual({ command: null });
        reply(403, { error: 'bridge.app' });
        expect(runLimitRaise(await postRunLimit(BASE, 6))).toBeNull();
        reply(400, { error: 'runs.max' });
        const out = await postRunLimit(BASE, 11);
        expect(!out.ok && [out.code, out.errorCode]).toEqual(['bad-body', 'runs.max']);
        calls = [];
        for (const bad of [0, 100, 2.5, Number.NaN]) expect((await postRunLimit(BASE, bad)).ok).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('preview of a narrower direction: the body of the new one, {inside, move}', async () => {
        reply(200, { inside: ['G0001', 'G0001', 'X1', 'G0002'], move: 7 });
        const r = await previewDirection(BASE, { person: 'P0004', direction: 'ancestors', name: 'Šustrovi' });
        expect(calls[0].url).toContain('/tok/directions/preview');
        expect(sent()).toEqual({ person: 'P0004', direction: 'ancestors', name: 'Šustrovi' });
        expect(r.ok && { inside: r.inside, move: r.move }).toEqual({ inside: ['G0001', 'G0002'], move: 7 });
        reply(200, { move: 3 });
        const outside = await previewDirection(BASE, { person: 'P0004', direction: 'ancestors' });
        expect(outside.ok && { inside: outside.inside, move: outside.move }).toEqual({ inside: [], move: 0 });
        reply(200, { inside: [], move: 0 });
        const none = await previewDirection(BASE, { person: 'P0004', direction: 'ancestors' });
        expect(none.ok && none.inside).toEqual([]);
    });

    it('take back the tasks moved: POST directions/<G>/gather/undo, {back}; 409 gather.none', async () => {
        reply(200, { ok: true, back: 7 });
        const r = await undoGather(BASE, 'G0004');
        expect(calls[0].url).toContain('/tok/directions/G0004/gather/undo');
        expect(calls[0].init.method).toBe('POST');
        expect(r.ok && r.back).toBe(7);
        reply(409, { error: 'gather.none' });
        const none = await undoGather(BASE, 'G0004');
        expect(!none.ok && [none.code, none.errorCode]).toEqual(['conflict', 'gather.none']);
        calls = [];
        expect((await undoGather(BASE, 'G0004/../x')).ok).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('create with moveTasks sends it and reads moved; without it the body as before', async () => {
        reply(200, { direction: { id: 'G0004', name: 'Šustrovi', state: 'active' }, moved: 7 });
        const r = await createDirection(BASE, { person: 'P0004', direction: 'ancestors', name: 'Šustrovi', moveTasks: true });
        expect(sent()).toEqual({ person: 'P0004', direction: 'ancestors', name: 'Šustrovi', moveTasks: true });
        expect(r.ok && r.moved).toBe(7);
        await createDirection(BASE, { person: 'P0004', direction: 'ancestors', name: 'Šustrovi', moveTasks: false });
        expect(sent(1)).toEqual({ person: 'P0004', direction: 'ancestors', name: 'Šustrovi', moveTasks: false });
        reply(200, { direction: { id: 'G0004', name: 'Šustrovi', state: 'active' } });
        const old = await createDirection(BASE, { person: 'P0004', direction: 'ancestors', name: 'Šustrovi' });
        expect(sent(2)).toEqual({ person: 'P0004', direction: 'ancestors', name: 'Šustrovi' });
        expect(old.ok && 'moved' in old).toBe(false);
    });
});

describe('the texts of the runs in Now (§3, §4)', () => {
    afterEach(() => setLanguage('en'));

    it('counts the agents in the heading and the state tile in each language (1, 2, 5)', () => {
        setLanguage('cs');
        expect([1, 2, 5].map(n => strings.live.nowAgents(n))).toEqual(['Teď · 1 agent', 'Teď · 2 agenti', 'Teď · 5 agentů']);
        expect([1, 2, 5].map(n => strings.live.stateAgents(n))).toEqual(['Pracuje 1 agent', 'Pracují 2 agenti', 'Pracuje 5 agentů']);
        expect([1, 2, 5].map(k => strings.live.stateAgentsWaiting(k, '14:00')))
            .toEqual(['1 čeká na limit do 14:00', '2 čekají na limit do 14:00', '5 čeká na limit do 14:00']);
        setLanguage('de');
        expect([1, 2, 5].map(n => strings.live.nowAgents(n))).toEqual(['Jetzt · 1 Agent', 'Jetzt · 2 Agenten', 'Jetzt · 5 Agenten']);
        expect([1, 2, 5].map(n => strings.live.stateAgents(n))).toEqual(['1 Agent arbeitet', '2 Agenten arbeiten', '5 Agenten arbeiten']);
        expect(strings.live.stateAgentsWaiting(2, '14:00')).toBe('2 warten auf das Limit bis 14:00');
        setLanguage('pl');
        expect([1, 2, 5].map(n => strings.live.nowAgents(n))).toEqual(['Teraz · 1 agent', 'Teraz · 2 agenci', 'Teraz · 5 agentów']);
        expect([1, 2, 5].map(n => strings.live.stateAgents(n))).toEqual(['Pracuje 1 agent', 'Pracują 2 agenci', 'Pracuje 5 agentów']);
        expect([12, 22].map(n => strings.live.nowAgents(n))).toEqual(['Teraz · 12 agentów', 'Teraz · 22 agenci']);
        expect([12, 22].map(n => strings.live.stateAgents(n))).toEqual(['Pracuje 12 agentów', 'Pracują 22 agenci']);
        expect([1, 2, 5].map(k => strings.live.stateAgentsWaiting(k, '14:00')))
            .toEqual(['1 czeka na limit do 14:00', '2 czekają na limit do 14:00', '5 czeka na limit do 14:00']);
        setLanguage('en');
        expect([1, 3].map(n => strings.live.nowAgents(n))).toEqual(['Now · 1 agent', 'Now · 3 agents']);
        expect([1, 3].map(n => strings.live.stateAgents(n))).toEqual(['1 agent working', '3 agents working']);
    });

    it('says under the state tile how many runs wait, an archive\'s wait too (runsWaitingText)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 23, 11, 0));
        try {
            const working = { state: 'working' as const };
            const limit = (h: number) => ({ state: 'waiting' as const, wait: { for: 'limit' as const, until: new Date(2026, 10, 23, h, 0).toISOString() } });
            const archive = { state: 'waiting' as const, wait: { for: 'archive' as const, until: new Date(2026, 10, 23, 12, 15).toISOString() } };
            expect(runsWaitingText([working, working])).toBeNull();
            // Before: a run waiting for the archive left "2 agents working" with nothing under it.
            expect(runsWaitingText([working, archive])).toBe('1 waiting');
            expect(runsWaitingText([working, archive, limit(14)])).toBe('2 waiting');
            expect(runsWaitingText([working, limit(15), limit(14)])).toMatch(/^2 waiting for the limit until 0?2:00\sPM$/);
            expect(runsWaitingText([working, { state: 'waiting', wait: { for: 'limit' } }])).toBe('1 waiting for the limit');
            setLanguage('cs');
            expect([1, 2, 5].map(k => strings.live.stateAgentsWaitingAny(k))).toEqual(['1 čeká', '2 čekají', '5 čeká']);
            setLanguage('de');
            expect([1, 2].map(k => strings.live.stateAgentsWaitingAny(k))).toEqual(['1 wartet', '2 warten']);
            setLanguage('pl');
            expect([1, 2, 5].map(k => strings.live.stateAgentsWaitingAny(k))).toEqual(['1 czeka', '2 czekają', '5 czeka']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('says why a run ended only for the limit and an error (runEndedText)', () => {
        const all = ['done', 'stopped', 'limit', 'gate', 'time', 'archive', 'error', undefined] as const;
        expect(all.map(w => runEndedText(w))).toEqual([
            '', '', 'The subscription limit ran out.', '', '', '', 'The agent stopped with an error; the details are in the research terminal.', '',
        ]);
        setLanguage('cs');
        expect(runEndedText('limit')).toBe('Došel limit předplatného.');
        expect(runEndedText('error')).toBe('Agent skončil chybou; podrobnosti jsou v terminálu výzkumu.');
        expect(runEndedText('stopped')).toBe('');
        setLanguage('de');
        expect(runEndedText('limit')).toBe('Das Abo-Limit ist aufgebraucht.');
        setLanguage('pl');
        expect(runEndedText('error')).toBe('Agent zakończył się błędem; szczegóły są w terminalu badania.');
    });

    it('says the codes of a paused run in the app\'s words and a reason of the research as it is', () => {
        setLanguage('cs');
        expect(pausedReasonText('limit')).toBe('čeká na limit předplatného');
        expect(pausedReasonText('archive')).toBe('čeká na archiv');
        expect(pausedReasonText('Archiv má dnes údržbu')).toBe('Archiv má dnes údržbu');
        setLanguage('en');
        expect(pausedReasonText('limit')).toBe('waiting for the subscription limit');
    });
});

describe('a direction\'s own run in its row and detail', () => {
    it('a run waiting for an archive says so, as Now does; a working one says nothing here (the row says "Agent at work")', () => {
        setLanguage('cs');
        // Before the fix the closed row said "Agent pracuje: Claude" whatever the run's state.
        expect(lineRunWaitLine({ state: 'waiting', wait: { for: 'archive' } }, 'Claude')).toBe('Claude · čeká na archiv');
        expect(lineRunWaitLine({ state: 'waiting', wait: { for: 'limit' } }, '')).toBe('čeká na limit předplatného');
        expect(lineRunWaitLine({ state: 'working', wait: null } as never, 'Claude')).toBeNull();
        expect(lineRunWaitLine(null, 'Claude')).toBeNull();
        setLanguage('en');
        expect(lineRunWaitLine({ state: 'waiting', wait: { for: 'archive' } }, 'Claude')).toBe('Claude · waiting for the archive');
    });
});
