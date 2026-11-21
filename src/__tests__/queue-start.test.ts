/**
 * "Work on the queue…" starting (src/ui/queue-start.ts, waiting buttons 3a, 3b): Now's state from the link to
 * the proof (a session at work), or the question after 30 s; a double start hands nothing over.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    startQueueWork, queueStartOf, queueStarting, queueStartsOf, noteQueueStartStatus, retryQueueStart, resetQueueStarts, runStartProven,
    QUEUE_START_MS, type QueueStartLaunch,
} from '../ui/queue-start.js';

const RID = 'R-QUEUE';

function deps(result: () => Promise<QueueStartLaunch>) {
    const late: Array<() => void> = [];
    const d = {
        launch: vi.fn((o: { limitMs: number; onLateProof: () => void }) => { late.push(o.onLateProof); return result(); }),
        changed: vi.fn(),
    };
    return { d, late };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
});

afterEach(() => {
    resetQueueStarts();
    vi.useRealTimers();
});

describe('starting the queue work', () => {
    it('says it starts until a session works there; a second start meanwhile hands nothing over', async () => {
        const { d } = deps(() => new Promise(() => undefined));
        expect(startQueueWork(RID, d)).toBe(true);
        expect(queueStartOf(RID)?.phase).toBe('starting');
        expect(queueStarting(RID.toLowerCase())).toBe(true);
        expect(d.launch).toHaveBeenCalledWith(expect.objectContaining({ limitMs: QUEUE_START_MS }));
        expect(startQueueWork(RID, d)).toBe(false);
        expect(d.launch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5000);
        noteQueueStartStatus(RID, { working: [], busy: { sessions: 0, runs: 0 } });
        expect(queueStartOf(RID)?.phase).toBe('starting');
        noteQueueStartStatus(RID, { working: [{ who: 'agent' }], busy: { sessions: 1, runs: 0 } });
        expect(queueStartOf(RID)).toBeNull();
        expect(d.changed).toHaveBeenCalled();
    });

    it('no proof within 30 s: the question, the buttons free; Try again starts once more', async () => {
        const { d } = deps(() => new Promise(r => setTimeout(() => r('limit'), QUEUE_START_MS)));
        startQueueWork(RID, d);
        await vi.advanceTimersByTimeAsync(QUEUE_START_MS - 1000);
        expect(queueStartOf(RID)?.phase).toBe('starting');
        await vi.advanceTimersByTimeAsync(1500);
        expect(queueStartOf(RID)?.phase).toBe('silent');
        expect(queueStarting(RID)).toBe(false);
        retryQueueStart(RID);
        expect(queueStartOf(RID)?.phase).toBe('starting');
        expect(d.launch).toHaveBeenCalledTimes(2);
    });

    it('a research known not running: the question at once', async () => {
        const { d } = deps(async () => 'down');
        startQueueWork(RID, d);
        await vi.advanceTimersByTimeAsync(0);
        expect(queueStartOf(RID)?.phase).toBe('silent');
    });

    it('the terminal took the link but no session came within 30 s: the row goes quietly', async () => {
        const { d } = deps(async () => 'opened');
        startQueueWork(RID, d);
        await vi.advanceTimersByTimeAsync(2000);
        expect(queueStartOf(RID)?.phase).toBe('starting');
        await vi.advanceTimersByTimeAsync(QUEUE_START_MS);
        expect(queueStartOf(RID)).toBeNull();
    });

    it('a proof after the limit takes the question away', async () => {
        const { d, late } = deps(async () => 'limit');
        startQueueWork(RID, d);
        await vi.advanceTimersByTimeAsync(0);
        expect(queueStartOf(RID)?.phase).toBe('silent');
        late[0]();
        expect(queueStartOf(RID)).toBeNull();
    });
});

describe('starts side by side (spec 126 U10: the general run and a direction\'s run)', () => {
    const run = (id: string, research: string | null) => ({ id, research });

    it('two starts of one research stand side by side, each ended by its own run only', async () => {
        const g = deps(() => new Promise(() => undefined));
        const l = deps(() => new Promise(() => undefined));
        expect(startQueueWork(RID, g.d)).toBe(true);
        expect(startQueueWork(RID, l.d, Date.now(), 'G0002')).toBe(true);
        // A second start of the same direction hands nothing over; another scope is its own.
        expect(startQueueWork(RID, l.d, Date.now(), 'G0002')).toBe(false);
        expect(queueStartsOf(RID).map(x => x.scope)).toEqual(['queue', 'G0002']);
        expect(queueStarting(RID, 'G0002')).toBe(true);
        // A run of another direction proves neither.
        noteQueueStartStatus(RID, { working: [{}], busy: { sessions: 1, runs: 1 }, runs: [run('run-1a07', 'G0001')] });
        expect(queueStartsOf(RID)).toHaveLength(2);
        // The direction's run ends its start only; the general one waits for a run without a direction.
        noteQueueStartStatus(RID, { runs: [run('run-1a07', 'G0001'), run('run-2b11', 'G0002')] });
        expect(queueStartOf(RID, 'G0002')).toBeNull();
        expect(queueStartOf(RID)?.phase).toBe('starting');
        noteQueueStartStatus(RID, { runs: [run('run-8f2c', null), run('run-2b11', 'G0002')] });
        expect(queueStartOf(RID)).toBeNull();
    });

    it('each start has its own 30 s and its own Try again', async () => {
        const g = deps(() => new Promise(r => setTimeout(() => r('limit'), QUEUE_START_MS)));
        const l = deps(() => new Promise(r => setTimeout(() => r('limit'), QUEUE_START_MS)));
        startQueueWork(RID, g.d);
        await vi.advanceTimersByTimeAsync(10_000);
        startQueueWork(RID, l.d, Date.now(), 'G0002');
        await vi.advanceTimersByTimeAsync(QUEUE_START_MS - 10_000 + 500);
        expect(queueStartOf(RID)?.phase).toBe('silent');
        expect(queueStartOf(RID, 'G0002')?.phase).toBe('starting');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(queueStartOf(RID, 'G0002')?.phase).toBe('silent');
        retryQueueStart(RID, 'G0002');
        expect(queueStartOf(RID, 'G0002')?.phase).toBe('starting');
        expect(queueStartOf(RID)?.phase).toBe('silent');
        expect(l.d.launch).toHaveBeenCalledTimes(2);
        expect(g.d.launch).toHaveBeenCalledTimes(1);
    });

    it('the proof: a run of the scope with the runs; an older research (no runs) any session or run for the queue only', () => {
        expect(runStartProven({ runs: [run('a', 'G0002')] }, 'G0002')).toBe(true);
        expect(runStartProven({ runs: [run('a', 'G0002')] })).toBe(false);
        expect(runStartProven({ runs: [run('a', null)] })).toBe(true);
        expect(runStartProven({ runs: [] }, 'G0002')).toBe(false);
        expect(runStartProven({ working: [{}] })).toBe(true);
        expect(runStartProven({ busy: { sessions: 0, runs: 1 } })).toBe(true);
        expect(runStartProven({ working: [{}] }, 'G0002')).toBe(false);
    });
});
