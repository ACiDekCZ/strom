/**
 * "Work on the queue…" starting (src/ui/queue-start.ts, waiting buttons 3a, 3b): Now's state from the link to
 * the proof (a session at work), or the question after 30 s; a double start hands nothing over.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    startQueueWork, queueStartOf, queueStarting, noteQueueStartStatus, retryQueueStart, resetQueueStarts, QUEUE_START_MS,
    type QueueStartLaunch,
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
