/**
 * A branch's tasks shown under it (spec 038 §9.1a): the first three of its
 * tasks up next in the queue's order, each with its number in the whole
 * queue, its set-aside tasks apart, the count exact for a queue sent whole
 * and the branch's own count for a queue cut short. Invented data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { LiveQueueItem, OffLineBranch } from '../research-link.js';

type View = (queue: readonly LiveQueueItem[], more: number, b: OffLineBranch, shown?: number) => {
    rows: { q: LiveQueueItem; pos: number }[]; parked: LiveQueueItem[]; total: number;
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
});
