/**
 * A branch's tasks shown under it (spec 038 §9.1a): the first three of its
 * tasks up next in the queue's order, each with its number in the whole
 * queue, its set-aside tasks apart, the count exact for a queue sent whole
 * and the branch's own count for a queue cut short. Invented data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { LiveQueueItem, OffLineBranch } from '../research-link.js';
import type { QueueList } from '../research-queue-pages.js';

type View = (queue: readonly LiveQueueItem[], more: number, b: OffLineBranch, shown?: number,
    paged?: { list: QueueList | null; count: number | null }) => {
    rows: { q: LiveQueueItem; pos: number }[]; parked: LiveQueueItem[]; total: number;
    loading?: boolean; failed?: string; beyond?: boolean;
};

describe('a branch\'s tasks under it', () => {
    let branchQueueView: View;

    beforeAll(async () => {
        const m = await import('../ui/research-offline-ui.js') as unknown as { branchQueueView: View };
        branchQueueView = m.branchQueueView;
    }, 60000);

    const task = (id: string, branch?: string, state: 'next' | 'parked' = 'next'): LiveQueueItem =>
        ({ id, text: `Úkol ${id}`, state, ...(branch ? { branch } : {}) }) as LiveQueueItem;
    const branch = (tasks: number): OffLineBranch =>
        ({ id: 'B-P0031', person: 'P0031', tasks, persons: 6, samples: [], mode: 'occasional', own: false });
    const queue = [
        task('T1'), task('T2', 'B-P0031'), task('T3', 'B-P0040'), task('T4', 'B-P0031'), task('T5', 'B-P0031', 'parked'),
        task('T6', 'B-P0031'), task('T7'), task('T8', 'B-P0031'),
    ];

    it('takes the first three of its tasks up next, numbered by their place in the whole queue (set-aside ones not counted)', () => {
        const v = branchQueueView(queue, 0, branch(9));
        expect(v.rows.map(r => [r.q.id, r.pos])).toEqual([['T2', 2], ['T4', 4], ['T6', 5]]);
        expect(v.parked.map(q => q.id)).toEqual(['T5']);
        // The queue came whole: the count is what is in it, not the branch's own number.
        expect(v.total).toBe(4);
    });

    it('trusts the branch\'s own count when the queue was cut short', () => {
        expect(branchQueueView(queue, 12, branch(14)).total).toBe(13);
        // Never fewer than what is seen.
        expect(branchQueueView(queue, 12, branch(2)).total).toBe(4);
    });

    it('has nothing up next for a branch whose tasks are all set aside or done', () => {
        const v = branchQueueView([task('T1'), task('T5', 'B-P0031', 'parked')], 0, branch(1));
        expect(v.rows).toEqual([]);
        expect(v.parked.map(q => q.id)).toEqual(['T5']);
        expect(v.total).toBe(0);
        expect(branchQueueView([task('T1')], 0, branch(0))).toEqual({ rows: [], parked: [], total: 0 });
    });

    // A queue of 236 tasks: the status's window holds the first 14, the branch's 6 tasks stand at 201–206.
    const big = Array.from({ length: 236 }, (_, i) => ({
        id: `T${String(i + 1).padStart(4, '0')}`, text: `Úkol ${i + 1}`, state: 'next' as const, pos: i + 1,
        ...(i >= 200 && i < 206 ? { branch: 'B-P0031' } : { research: 'G0001' }),
    })) as LiveQueueItem[];
    const window14 = big.slice(0, 14);

    it('an older bridge: a branch past the window says its tasks stand further on, never "first 0 of N"', () => {
        const v = branchQueueView(window14, 222, branch(6));
        expect(v.rows).toEqual([]);
        expect(v.total).toBe(6);
        expect(v.beyond).toBe(true);
        // One of its tasks in the window: shown with its place, nothing "beyond".
        expect(branchQueueView([...window14.slice(0, 13), big[200]], 222, branch(6)).beyond).toBeUndefined();
    });

    it('through the bridge: the branch\'s tasks from the whole queue with their own places and the queue\'s count', () => {
        const items = big.filter(q => q.branch === 'B-P0031');
        const list: QueueList = { key: 'branch=B-P0031', filter: { branch: 'B-P0031' }, items, total: 6, next: null, rev: 'a1', loading: false, error: null };
        const v = branchQueueView(window14, 222, branch(6), 3, { list, count: 6 });
        expect(v.rows.map(r => [r.q.id, r.pos])).toEqual([['T0201', 201], ['T0202', 202], ['T0203', 203]]);
        expect(v.total).toBe(6);
        expect(v.beyond).toBeUndefined();
        // All six when asked for more rows.
        expect(branchQueueView(window14, 222, branch(6), 10, { list, count: 6 }).rows.map(r => r.pos)).toEqual([201, 202, 203, 204, 205, 206]);
    });

    it('through the bridge: loading, then a failure, each without a count of zero shown as tasks', () => {
        const loading = branchQueueView(window14, 222, branch(6), 3, { list: null, count: 6 });
        expect(loading).toMatchObject({ rows: [], total: 6, loading: true });
        const failed: QueueList = { key: 'branch=B-P0031', filter: { branch: 'B-P0031' }, items: [], total: null, next: 0, rev: '', loading: false, error: 'busy' };
        expect(branchQueueView(window14, 222, branch(6), 3, { list: failed, count: 6 })).toMatchObject({ rows: [], failed: 'busy' });
    });
});
