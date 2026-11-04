/**
 * The whole queue read by pages through the bridge (`GET <token>/queue`,
 * `queue.page`, spec 038 K7.5): the request and its answer checked, a list
 * read once per order of the queue, the next page on demand, at most
 * QUEUE_ROWS_CAP tasks, a read aborted when nothing shows its list any more,
 * the lists on screen read again after a change (one read for a burst), the
 * others forgotten; `/status.queueCounts` and each task's `pos`. A simulated
 * bridge with a queue of 5000 tasks. Invented data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    QUEUE_PAGE, QUEUE_REFRESH_MS, QUEUE_ROWS_CAP, beginQueueSlots, endQueueSlots, fetchQueuePage, loadMoreQueueList, noteQueueRev,
    onQueueListsChange, queueList, queueListItem, requestQueueList, resetQueueLists, retryQueueList,
} from '../research-queue-pages.js';
import { sanitizeLiveStatus, sanitizeQueue, sanitizeQueueCounts } from '../research-link.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

/** One calibration round's best time on the reference machine at rest (Apple M-series laptop, vitest). */
const CALIBRATION_REFERENCE_MS = 5.7;
/** All 5000 tasks of a queue, 50 pages, checked (normalized ms): one page stays far below a frame. */
const SANITIZE_BUDGET_MS = 10;

const BASE = 'http://127.0.0.1:7777/abc123';

interface Task { id: string; text: string; state: 'next' | 'parked'; research?: string; branch?: string }

/** A research's queue: 5000 tasks up next (two directions, a branch of 6 at 4201–4206), 3 set aside. */
function bigQueue(n = 5000): Task[] {
    const out: Task[] = [];
    for (let i = 0; i < n; i++) {
        const id = `T${String(i + 1).padStart(5, '0')}`;
        if (i >= 4200 && i < 4206) out.push({ id, text: `Křest ${i + 1}`, state: 'next', branch: 'B-P0004' });
        else out.push({ id, text: `Matrika ${i + 1}`, state: 'next', research: i % 3 === 0 ? 'G0002' : 'G0001' });
    }
    for (let i = 0; i < 3; i++) out.push({ id: `T9${String(i).padStart(4, '0')}`, text: `Odloženo ${i}`, state: 'parked', branch: 'B-P0004' });
    return out;
}

/** The bridge's `GET /queue`, as Strom Research 1.26 answers it. */
function bridge(queue: () => Task[], rev: () => string, opts: { busy?: () => boolean } = {}) {
    const calls: URL[] = [];
    const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        calls.push(url);
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (opts.busy?.()) return new Response(JSON.stringify({ error: 'research.busy' }), { status: 503, headers: { 'Retry-After': '2' } });
        const p = url.searchParams;
        const from = Number(p.get('from') ?? 0);
        const count = Math.min(100, Number(p.get('count') ?? 50));
        let pos = 0;
        const all = queue().map(t => (t.state === 'next' ? { ...t, pos: ++pos } : { ...t }));
        const rows = all
            .filter(t => !p.get('branch') || t.branch === p.get('branch'))
            .filter(t => !p.get('research') || t.research === p.get('research'))
            .filter(t => !p.get('state') || t.state === p.get('state'));
        const items = rows.slice(from, from + count);
        const next = from + count < rows.length ? from + count : undefined;
        return new Response(JSON.stringify({ items, total: rows.length, from, ...(next !== undefined ? { next } : {}), rev: rev(), head: 'f'.repeat(40) }),
            { status: 200, headers: { 'content-type': 'application/json' } });
    });
    return { fetchFn, calls };
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
};

describe('the whole queue by pages', () => {
    let queue: Task[];
    let rev: string;
    let changes: number;

    beforeEach(() => {
        queue = bigQueue();
        rev = '3f9c2a71b0d4e8a5';
        changes = 0;
        resetQueueLists();
        onQueueListsChange(() => { changes++; });
    });
    afterEach(() => {
        onQueueListsChange(null);
        resetQueueLists();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('asks one page with the filter and reads each task with its place in the whole queue', async () => {
        const b = bridge(() => queue, () => rev);
        vi.stubGlobal('fetch', b.fetchFn);
        const r = await fetchQueuePage(BASE, { branch: 'B-P0004' }, 0, 2);
        expect(b.calls[0].pathname).toBe('/abc123/queue');
        expect(b.calls[0].searchParams.get('branch')).toBe('B-P0004');
        expect(b.calls[0].searchParams.get('count')).toBe('2');
        expect(b.calls[0].searchParams.has('from')).toBe(false);
        expect(r.ok && r.items.map(q => [q.id, q.pos])).toEqual([['T04201', 4201], ['T04202', 4202]]);
        expect(r.ok && [r.total, r.next, r.rev]).toEqual([9, 2, rev]);
        // A page asked past the bridge's limit is asked at its limit.
        await fetchQueuePage(BASE, {}, 100, 500);
        expect(b.calls[1].searchParams.get('count')).toBe('100');
        expect(b.calls[1].searchParams.get('from')).toBe('100');
    });

    it('says busy for 503 and failed for a bad answer, never throws', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
        expect(await fetchQueuePage(BASE, {}, 0, 50)).toEqual({ ok: false, code: 'busy' });
        vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
        expect(await fetchQueuePage(BASE, {}, 0, 50)).toEqual({ ok: false, code: 'failed' });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
        expect(await fetchQueuePage(BASE, {}, 0, 50)).toEqual({ ok: false, code: 'failed' });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
        expect(await fetchQueuePage(BASE, {}, 0, 50)).toEqual({ ok: false, code: 'failed' });
    });

    it('reads a branch past the window once: the same branch again asks nothing while the order stays', async () => {
        const b = bridge(() => queue, () => rev);
        vi.stubGlobal('fetch', b.fetchFn);
        noteQueueRev(BASE, rev);
        const first = requestQueueList(BASE, { branch: 'B-P0004' }, 'branch');
        expect(first.loading).toBe(true);
        await flush();
        const l = queueList(BASE, { branch: 'B-P0004' })!;
        expect(l.items.filter(q => q.state === 'next').map(q => q.pos)).toEqual([4201, 4202, 4203, 4204, 4205, 4206]);
        expect(l.items.filter(q => q.state === 'parked')).toHaveLength(3);
        expect(l.total).toBe(9);
        expect(changes).toBe(1);
        // Unfolded again, and the queue narrowed to it: the same list, nothing asked.
        requestQueueList(BASE, { branch: 'B-P0004' }, 'branch');
        requestQueueList(BASE, { branch: 'B-P0004' }, 'queue');
        expect(b.fetchFn).toHaveBeenCalledTimes(1);
        // A task past the window is found for its ⋯ menu.
        expect(queueListItem(BASE, 'T04203')?.pos).toBe(4203);
        expect(queueListItem('http://127.0.0.1:1/other', 'T04203')).toBeNull();
    });

    it('reads the next page on demand, a page at a time, never past the cap', async () => {
        const b = bridge(() => queue, () => rev);
        vi.stubGlobal('fetch', b.fetchFn);
        const seed = queue.slice(0, 14).map((t, i) => ({ ...t, pos: i + 1 }));
        // The whole queue: the status's window first, nothing read until "Load more".
        loadMoreQueueList(BASE, { state: 'next' }, 'queue', { items: seed, total: 5000 });
        await flush();
        let l = queueList(BASE, { state: 'next' })!;
        expect(b.calls[0].searchParams.get('from')).toBe('14');
        expect(b.calls[0].searchParams.get('count')).toBe(String(QUEUE_PAGE));
        expect(l.items.map(q => q.pos)).toEqual(Array.from({ length: 14 + QUEUE_PAGE }, (_, i) => i + 1));
        for (let i = 0; i < 20; i++) {
            loadMoreQueueList(BASE, { state: 'next' }, 'queue');
            await flush();
        }
        l = queueList(BASE, { state: 'next' })!;
        expect(l.items).toHaveLength(QUEUE_ROWS_CAP);
        expect(l.next).toBeNull();
        expect(l.total).toBe(5000);
        // Each read one page; none after the cap.
        expect(b.fetchFn.mock.calls.length).toBeLessThanOrEqual(Math.ceil((QUEUE_ROWS_CAP - 14) / QUEUE_PAGE));
        expect(new Set(l.items.map(q => q.id)).size).toBe(QUEUE_ROWS_CAP);
    });

    it('aborts the read of a filter replaced by another one', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>(r => { release = r; });
        const b = bridge(() => queue, () => rev);
        vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
            await gate;
            return b.fetchFn(input, init);
        }));
        const first = requestQueueList(BASE, { research: 'G0001' }, 'queue');
        expect(first.loading).toBe(true);
        requestQueueList(BASE, { research: 'G0002' }, 'queue');
        release();
        await flush();
        // The first was aborted and forgotten (nothing was read); the second came.
        expect(queueList(BASE, { research: 'G0001' })).toBeNull();
        expect(queueList(BASE, { research: 'G0002' })!.total).toBe(Math.ceil(5000 / 3) - 2);
    });

    it('a drawing that no longer shows a list lets it go', async () => {
        const b = bridge(() => queue, () => rev);
        vi.stubGlobal('fetch', b.fetchFn);
        noteQueueRev(BASE, rev);
        beginQueueSlots();
        requestQueueList(BASE, { branch: 'B-P0004' }, 'branch');
        endQueueSlots();
        await flush();
        beginQueueSlots();
        endQueueSlots();
        // Not shown at a new order: forgotten, not read again.
        noteQueueRev(BASE, 'aaaaaaaaaaaaaaaa');
        expect(queueList(BASE, { branch: 'B-P0004' })).toBeNull();
    });

    it('after a change reads the lists on screen again once, after a pause, as far as they were read', async () => {
        vi.useFakeTimers();
        const b = bridge(() => queue, () => rev);
        vi.stubGlobal('fetch', b.fetchFn);
        noteQueueRev(BASE, rev);
        requestQueueList(BASE, { branch: 'B-P0004' }, 'branch');
        requestQueueList(BASE, { research: 'G0002' }, 'queue');
        await vi.runAllTimersAsync();
        loadMoreQueueList(BASE, { research: 'G0002' }, 'queue');
        await vi.runAllTimersAsync();
        expect(queueList(BASE, { research: 'G0002' })!.items).toHaveLength(2 * QUEUE_PAGE);
        // A list not on screen any more.
        requestQueueList(BASE, { research: 'G0001' }, 'helps');
        await vi.runAllTimersAsync();
        endQueueSlots();
        beginQueueSlots();
        requestQueueList(BASE, { branch: 'B-P0004' }, 'branch');
        requestQueueList(BASE, { research: 'G0002' }, 'queue');
        endQueueSlots();
        const before = b.fetchFn.mock.calls.length;
        // The research moves the branch to the front: three statuses in a burst, one read.
        queue = [...queue.filter(t => t.branch === 'B-P0004'), ...queue.filter(t => t.branch !== 'B-P0004')];
        noteQueueRev(BASE, '1111111111111111');
        noteQueueRev(BASE, '2222222222222222');
        rev = '3333333333333333';
        noteQueueRev(BASE, rev);
        expect(queueList(BASE, { research: 'G0001' })).toBeNull();
        await vi.advanceTimersByTimeAsync(QUEUE_REFRESH_MS - 50);
        expect(b.fetchFn.mock.calls.length).toBe(before);
        await vi.runAllTimersAsync();
        const asked = b.calls.slice(before).map(u => `${u.searchParams.get('branch') ?? u.searchParams.get('research')}:${u.searchParams.get('from') ?? 0}:${u.searchParams.get('count')}`);
        expect(asked).toEqual(['B-P0004:0:50', 'G0002:0:100']);
        expect(queueList(BASE, { branch: 'B-P0004' })!.items[0].pos).toBe(1);
        expect(queueList(BASE, { branch: 'B-P0004' })!.rev).toBe(rev);
        expect(queueList(BASE, { research: 'G0002' })!.items).toHaveLength(2 * QUEUE_PAGE);
        // The same order again: nothing read.
        noteQueueRev(BASE, rev);
        await vi.runAllTimersAsync();
        expect(b.calls.length).toBe(before + 2);
    });

    it('a busy research says so and is tried again on demand', async () => {
        let busy = true;
        const b = bridge(() => queue, () => rev, { busy: () => busy });
        vi.stubGlobal('fetch', b.fetchFn);
        requestQueueList(BASE, { branch: 'B-P0004' }, 'branch');
        await flush();
        expect(queueList(BASE, { branch: 'B-P0004' })!.error).toBe('busy');
        // Drawn again: not asked again by itself.
        requestQueueList(BASE, { branch: 'B-P0004' }, 'branch');
        expect(b.fetchFn).toHaveBeenCalledTimes(1);
        busy = false;
        retryQueueList(BASE, { branch: 'B-P0004' }, 'branch');
        await flush();
        expect(queueList(BASE, { branch: 'B-P0004' })!.total).toBe(9);
    });

    it('stays quick with a queue of 5000: every page of it read and checked well within a frame each', () => {
        const items = bigQueue().map((t, i) => ({ ...t, pos: i + 1 }));
        const pages = (): number => {
            let n = 0;
            for (let i = 0; i < 50; i++) n += sanitizeQueue(items.slice(i * 100, i * 100 + 100), true, true, 100).length;
            return n;
        };
        expect(pages()).toBe(5000);
        // All 50 pages (5000 tasks) against the budget, calibrated for a busy machine.
        const m = measureAgainstBudget(pages, {
            budgetMs: SANITIZE_BUDGET_MS, calibrationRounds: 1, referenceMs: CALIBRATION_REFERENCE_MS, maxWallMs: 2_000,
        });
        console.log(budgetReport('sanitize 5000 queued tasks', m, SANITIZE_BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(SANITIZE_BUDGET_MS);
    });
});

describe('the queue\'s counts and places in the status', () => {
    it('reads queueCounts only from a research with queue.page', () => {
        const counts = { research: { G0001: 197, g2: 30, bad: 3 }, branch: { 'B-P0004': 6, 'B-P0009': 0 }, next: 233, parked: 3, rev: '3f9c2a71b0d4e8a5' };
        expect(sanitizeQueueCounts(counts)).toEqual({ research: { G0001: 197 }, branch: { 'B-P0004': 6 }, next: 233, parked: 3, rev: '3f9c2a71b0d4e8a5' });
        expect(sanitizeQueueCounts({ ...counts, rev: 'nope' })).toBeNull();
        expect(sanitizeQueueCounts({ ...counts, next: -1 })).toBeNull();
        const status = (features: string[]) => sanitizeLiveStatus({
            tree: { id: '7c1f0e2a-1b2c-4d5e-8f90-a1b2c3d4e5f6', name: 'Fíškovi' }, head: 'h1', features, queueCounts: counts,
            queue: [{ id: 'T0001', text: 'Matriky', state: 'next', pos: 1 }, { id: 'T0002', text: 'Odloženo', state: 'parked', pos: 7 }],
        })!;
        expect(status(['queue.page']).queueCounts?.next).toBe(233);
        expect(status([]).queueCounts).toBeUndefined();
        // A task up next keeps its place; one set aside has none.
        expect(status(['queue.page']).queue.map(q => q.pos)).toEqual([1, undefined]);
    });

    it('drops a place that is not a whole number from 1', () => {
        const q = sanitizeQueue([
            { id: 'T0001', text: 'a', state: 'next', pos: 0 }, { id: 'T0002', text: 'b', state: 'next', pos: 2.5 },
            { id: 'T0003', text: 'c', state: 'next', pos: '3' }, { id: 'T0004', text: 'd', state: 'next', pos: 4 },
        ]);
        expect(q.map(x => x.pos)).toEqual([undefined, undefined, undefined, 4]);
    });
});
