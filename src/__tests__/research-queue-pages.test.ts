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
    QUEUE_PAGE, QUEUE_QUERY_MAX, QUEUE_REFRESH_MS, QUEUE_ROWS_CAP, beginQueueSlots, endQueueSlots, fetchQueuePage, loadMoreQueueList, noteQueueRev,
    moveQueueItemFirst, onQueueListsChange, placeQueueItem, placeQueueItemInLists, queueList, queueListItem, queueQuery, queueRemote, readQueuePage, requestQueueList,
    resetQueueLists, retryQueueList, setQueueRemote,
} from '../research-queue-pages.js';
import { LiveQueueItem, sanitizeLiveStatus, sanitizeQueue, sanitizeQueueCounts } from '../research-link.js';
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

    it('Do next: the task first in every list drawn, with its place 1 and its mark; the places before it one on', async () => {
        queue = bigQueue(8);
        const b = bridge(() => queue, () => rev);
        vi.stubGlobal('fetch', b.fetchFn);
        requestQueueList(BASE, { research: 'G0001' }, 'queue');
        requestQueueList(BASE, { state: 'next' }, 'branch');
        await flush();
        const ids = (f: Parameters<typeof queueList>[1]) => queueList(BASE, f)!.items.map(q => `${q.id}:${q.pos}`);
        expect(ids({ research: 'G0001' })).toEqual(['T00002:2', 'T00003:3', 'T00005:5', 'T00006:6', 'T00008:8']);
        moveQueueItemFirst(BASE, 'T00005');
        expect(ids({ research: 'G0001' })).toEqual(['T00005:1', 'T00002:3', 'T00003:4', 'T00006:6', 'T00008:8']);
        expect(ids({ state: 'next' }).slice(0, 6)).toEqual(['T00005:1', 'T00001:2', 'T00002:3', 'T00003:4', 'T00004:5', 'T00006:6']);
        expect(queueListItem(BASE, 'T00005')?.own).toBe('next');
        // Another research's lists are not touched.
        moveQueueItemFirst('http://127.0.0.1:7777/other', 'T00006');
        expect(ids({ research: 'G0001' })[0]).toBe('T00005:1');
    });

    it('Undo of Do next: the task at the place the bridge answered, tag and sentence as it says; the others\' places back', async () => {
        queue = bigQueue(8);
        const b = bridge(() => queue, () => rev);
        vi.stubGlobal('fetch', b.fetchFn);
        requestQueueList(BASE, { research: 'G0001' }, 'queue');
        requestQueueList(BASE, { state: 'next' }, 'branch');
        await flush();
        const ids = (f: Parameters<typeof queueList>[1]) => queueList(BASE, f)!.items.map(q => `${q.id}:${q.pos}`);
        moveQueueItemFirst(BASE, 'T00005');
        // The bridge's answer to restore: its place 5 again, the direction's sentence, no mark of its own.
        placeQueueItemInLists(BASE, { id: 'T00005', text: 'Matrika 5', state: 'next', research: 'G0001', pos: 5, why: { kind: 'line', research: 'G0001' } });
        expect(ids({ research: 'G0001' })).toEqual(['T00002:2', 'T00003:3', 'T00005:5', 'T00006:6', 'T00008:8']);
        expect(ids({ state: 'next' }).slice(0, 6)).toEqual(['T00001:1', 'T00002:2', 'T00003:3', 'T00004:4', 'T00005:5', 'T00006:6']);
        const back = queueListItem(BASE, 'T00005')!;
        expect(back.own).toBeUndefined();
        expect(back.why).toEqual({ kind: 'line', research: 'G0001' });
    });

    it('placeQueueItem: moved up or down by its answered place; past a cut window it leaves; without a place only its row changes', () => {
        const t = (id: string, pos?: number, extra: Partial<LiveQueueItem> = {}): LiveQueueItem =>
            ({ id, text: id, state: 'next', ...(pos !== undefined ? { pos } : {}), ...extra });
        const list = [t('T1', 1, { own: 'next' }), t('T2', 2), t('T3', 3), t('T4', 4), { id: 'T9', text: 'T9', state: 'parked' as const }];
        const show = (xs: LiveQueueItem[]) => xs.map(x => `${x.id}:${x.pos ?? '-'}`);
        // Down: from 1 to 3.
        expect(show(placeQueueItem(list, t('T1', 3), false).items)).toEqual(['T2:1', 'T3:2', 'T1:3', 'T4:4', 'T9:-']);
        // Up: from 4 to 2.
        expect(show(placeQueueItem(list, t('T4', 2), false).items)).toEqual(['T1:1', 'T4:2', 'T2:3', 'T3:4', 'T9:-']);
        // To the end of a whole list: after the last task up next, before the set-aside ones.
        expect(show(placeQueueItem(list, t('T1', 4), false).items)).toEqual(['T2:1', 'T3:2', 'T4:3', 'T1:4', 'T9:-']);
        // Past a cut window: out of it.
        const out = placeQueueItem(list, t('T1', 20), true);
        expect(out.out).toBe(true);
        expect(show(out.items)).toEqual(['T2:1', 'T3:2', 'T4:3', 'T9:-']);
        // Right after the last one held of a cut window: kept there.
        expect(show(placeQueueItem(list, t('T1', 4), true).items)).toEqual(['T2:1', 'T3:2', 'T4:3', 'T1:4', 'T9:-']);
        // No place in the answer: its row as answered, the order kept.
        const plain = placeQueueItem(list, { id: 'T1', text: 'T1', state: 'next' }, false).items;
        expect(show(plain)).toEqual(['T1:-', 'T2:2', 'T3:3', 'T4:4', 'T9:-']);
        expect(plain[0].own).toBeUndefined();
        // A task not held: nothing changes.
        expect(placeQueueItem(list, t('T7', 2), false).items).toBe(list);
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

    it('keeps a task\'s own place with queue.next, also without branches', () => {
        const status = (features: string[]) => sanitizeLiveStatus({
            tree: { id: '7c1f0e2a-1b2c-4d5e-8f90-a1b2c3d4e5f6', name: 'Fíškovi' }, head: 'h1', features,
            queue: [{ id: 'T0001', text: 'Matriky', state: 'next', own: 'next' }, { id: 'T0002', text: 'Sčítání', state: 'next' }],
        })!;
        expect(status(['queue.next']).queue.map(q => q.own)).toEqual(['next', undefined]);
        expect(status([]).queue.map(q => q.own)).toEqual([undefined, undefined]);
    });

    it('drops a place that is not a whole number from 1', () => {
        const q = sanitizeQueue([
            { id: 'T0001', text: 'a', state: 'next', pos: 0 }, { id: 'T0002', text: 'b', state: 'next', pos: 2.5 },
            { id: 'T0003', text: 'c', state: 'next', pos: '3' }, { id: 'T0004', text: 'd', state: 'next', pos: 4 },
        ]);
        expect(q.map(x => x.pos)).toEqual([undefined, undefined, undefined, 4]);
    });
});

describe('the queue searched by its bridge (queue.search)', () => {
    interface Found { id: string; text: string; state: 'next' | 'parked'; person?: string; research?: string; pos?: number }
    const BASE2 = 'http://127.0.0.1:7777/abc123';
    /** 120 tasks up next, every other one about P12, and one set aside about P12. */
    function queue(): Found[] {
        const out: Found[] = [];
        for (let i = 0; i < 120; i++) {
            out.push({ id: `T${String(i + 1).padStart(4, '0')}`, text: `Matrika ${i + 1}`, state: 'next', pos: i + 1,
                ...(i % 2 === 0 ? { person: 'P12' } : {}), research: i % 2 ? 'G0001' : 'G0002' });
        }
        out.push({ id: 'T0900', text: 'Odloženo', state: 'parked', person: 'P12' });
        return out;
    }
    /** The bridge's `GET /queue?q=`: a task's number, a person's number or the text; `q` said back. */
    function searchBridge(opts: { gate?: (q: string) => Promise<void>; echo?: (q: string) => string } = {}) {
        const calls: URL[] = [];
        const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
            const url = new URL(input);
            calls.push(url);
            const p = url.searchParams;
            const q = p.get('q') ?? '';
            await opts.gate?.(q);
            if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
            const from = Number(p.get('from') ?? 0);
            const count = Number(p.get('count') ?? 50);
            const num = /^t?0*(\d+)$/i.exec(q);
            const match: Record<string, string> = {};
            const rows = queue().filter(t => !p.get('research') || t.research === p.get('research')).filter(t => {
                if (!q) return true;
                if (num && Number(t.id.slice(1)) === Number(num[1])) return (match[t.id] = 'id'), true;
                if (/^P\d+$/i.test(q) && t.person?.toUpperCase() === q.toUpperCase()) return (match[t.id] = 'person'), true;
                return t.text.toLowerCase().includes(q.toLowerCase());
            });
            const items = rows.slice(from, from + count);
            const next = from + count < rows.length ? from + count : undefined;
            const elsewhere = q === 'T0999' ? { id: 'T0999', state: 'done' } : undefined;
            return new Response(JSON.stringify({
                items, total: rows.length, from, ...(next !== undefined ? { next } : {}), rev: '3f9c2a71b0d4e8a5', head: 'f'.repeat(40),
                ...(q ? { q: opts.echo ? opts.echo(q) : q, match, ...(elsewhere ? { elsewhere } : {}) } : {}),
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        return { fetchFn, calls };
    }

    beforeEach(() => resetQueueLists());
    afterEach(() => {
        resetQueueLists();
        vi.unstubAllGlobals();
    });

    it('sends the text trimmed and cut, with the chip\'s filter, and reads what matched', async () => {
        const b = searchBridge();
        vi.stubGlobal('fetch', b.fetchFn);
        const r = await fetchQueuePage(BASE2, { research: 'G0002', q: '  P12 ' }, 0, 50);
        expect(b.calls[0].searchParams.get('q')).toBe('P12');
        expect(b.calls[0].searchParams.get('research')).toBe('G0002');
        expect(r.ok && r.items.every(q => q.person === 'P12')).toBe(true);
        expect(r.ok && Object.values(r.match ?? {}).every(m => m === 'person')).toBe(true);
        expect(queueQuery('x'.repeat(300))).toHaveLength(QUEUE_QUERY_MAX);
        // `task` said for a task's number is the same as `id`.
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            items: [{ id: 'T0815', text: 'a', state: 'next', pos: 3 }], total: 1, from: 0, rev: '3f9c2a71b0d4e8a5', head: 'f'.repeat(40),
            q: '815', match: { T0815: 'task', bad: 'id', T0001: 'text' },
        }), { status: 200 })));
        const t = await fetchQueuePage(BASE2, { q: '815' }, 0, 50);
        expect(t.ok && t.match).toEqual({ T0815: 'id' });
    });

    it('a number outside the queue: where it is now (only the known states)', async () => {
        const b = searchBridge();
        vi.stubGlobal('fetch', b.fetchFn);
        const r = await fetchQueuePage(BASE2, { q: 'T0999' }, 0, 50);
        expect(r.ok && [r.total, r.elsewhere]).toEqual([0, { id: 'T0999', state: 'done' }]);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            items: [], total: 0, from: 0, rev: '3f9c2a71b0d4e8a5', head: 'f'.repeat(40), q: 'T1', elsewhere: { id: 'T1', state: 'open' },
        }), { status: 200 })));
        const odd = await fetchQueuePage(BASE2, { q: 'T1' }, 0, 50);
        expect(odd.ok && odd.elsewhere).toBeUndefined();
    });

    it('an answer to another text than the one asked is not taken', async () => {
        vi.stubGlobal('fetch', searchBridge({ echo: () => 'older' }).fetchFn);
        expect(await fetchQueuePage(BASE2, { q: 'Matrika' }, 0, 50)).toEqual({ ok: false, code: 'aborted' });
    });

    it('a newer search replaces the older one: the older answer is never shown', async () => {
        const gates = new Map<string, () => void>();
        const b = searchBridge({ gate: q => new Promise<void>(r => { gates.set(q, r); }) });
        vi.stubGlobal('fetch', b.fetchFn);
        beginQueueSlots();
        requestQueueList(BASE2, { q: 'Matrika 1' }, 'search');
        endQueueSlots();
        beginQueueSlots();
        requestQueueList(BASE2, { q: 'Matrika 2' }, 'search');
        endQueueSlots();
        await flush();
        gates.get('Matrika 2')!();
        await flush();
        gates.get('Matrika 1')?.();
        await flush();
        expect(queueList(BASE2, { q: 'Matrika 1' })).toBeNull();
        expect(queueList(BASE2, { q: 'Matrika 2' })!.items.every(q => q.text.includes('Matrika 2'))).toBe(true);
    });

    it('more than a page found: "Load more" reads the next page with the same text', async () => {
        const b = searchBridge();
        vi.stubGlobal('fetch', b.fetchFn);
        requestQueueList(BASE2, { q: 'P12' }, 'search');
        await flush();
        let l = queueList(BASE2, { q: 'P12' })!;
        expect([l.items.length, l.total, l.next]).toEqual([QUEUE_PAGE, 61, QUEUE_PAGE]);
        loadMoreQueueList(BASE2, { q: 'P12' }, 'search');
        await flush();
        l = queueList(BASE2, { q: 'P12' })!;
        expect(b.calls[1].searchParams.get('q')).toBe('P12');
        expect(b.calls[1].searchParams.get('from')).toBe(String(QUEUE_PAGE));
        expect(l.items).toHaveLength(61);
        expect(l.next).toBeNull();
        // What matched on each page is kept together.
        expect(Object.keys(l.match ?? {})).toHaveLength(61);
    });

    it('the search and the queue are two lists (a text is its own key)', () => {
        expect(queueList(BASE2, { q: 'a' })).toBeNull();
        vi.stubGlobal('fetch', searchBridge().fetchFn);
        const a = requestQueueList(BASE2, { q: 'a' }, 'search');
        const b = requestQueueList(BASE2, { q: 'b' }, 'queue');
        expect(a.key).not.toBe(b.key);
        expect(a.key).not.toBe(requestQueueList(BASE2, {}, 'branch').key);
    });
});

describe('the overview\'s own window: pages asked of the main window (queue-list, spec 052 §1 there)', () => {
    type Page = Parameters<typeof readQueuePage>[0];
    let asked: { filter: Record<string, unknown>; from: number; count: number; answer: (v: Page) => void }[];
    let up: boolean;

    beforeEach(() => {
        asked = [];
        up = true;
        setQueueRemote({
            page: (filter, from, count) => new Promise(resolve => {
                asked.push({ filter: { ...filter }, from, count, answer: (v) => resolve(readQueuePage(v)) });
            }),
            up: () => up,
        });
        vi.stubGlobal('fetch', vi.fn(() => { throw new Error('the window asks no bridge'); }));
    });
    afterEach(() => {
        setQueueRemote(null);
        onQueueListsChange(null);
        vi.unstubAllGlobals();
    });

    const page = (ids: string[], o: Record<string, unknown> = {}) => ({
        ok: true, items: ids.map((id, i) => ({ id, text: `Matrika ${id}`, state: 'next', pos: i + 1 })), total: ids.length, from: 0,
        next: null, rev: '3f9c2a71b0d4e8a5', head: 'h', ...o,
    });

    it('a search\'s pages come from the main window with what matched; Load more asks the next one; nothing is fetched here', async () => {
        expect(queueRemote()?.up()).toBe(true);
        requestQueueList('', { q: 'P12' }, 'search');
        expect(asked.map(a => [a.filter, a.from, a.count])).toEqual([[{ q: 'P12' }, 0, QUEUE_PAGE]]);
        asked[0].answer(page(['T0001', 'T0003'], { total: 3, next: 2, match: { T0001: 'person', T0003: 'person', bogus: 'id' } }));
        await flush();
        let l = queueList('', { q: 'P12' })!;
        expect(l.items.map(q => q.id)).toEqual(['T0001', 'T0003']);
        expect([l.total, l.next, l.loading, l.error]).toEqual([3, 2, false, null]);
        expect(l.match).toEqual({ T0001: 'person', T0003: 'person' });
        loadMoreQueueList('', { q: 'P12' }, 'search');
        expect(asked.map(a => a.from)).toEqual([0, 2]);
        asked[1].answer(page(['T0005'], { total: 3, from: 2, match: { T0005: 'person' } }));
        await flush();
        l = queueList('', { q: 'P12' })!;
        expect(l.items.map(q => q.id)).toEqual(['T0001', 'T0003', 'T0005']);
        expect(Object.keys(l.match ?? {})).toEqual(['T0001', 'T0003', 'T0005']);
        expect(l.next).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('an older search\'s answer that comes after a newer one is dropped', async () => {
        beginQueueSlots();
        requestQueueList('', { q: 'Fiš' }, 'search');
        endQueueSlots();
        beginQueueSlots();
        requestQueueList('', { q: 'Fíška' }, 'search');
        endQueueSlots();
        expect(asked.map(a => a.filter.q)).toEqual(['Fiš', 'Fíška']);
        asked[1].answer(page(['T0010']));
        asked[0].answer(page(['T0020', 'T0030']));
        await flush();
        expect(queueList('', { q: 'Fíška' })!.items.map(q => q.id)).toEqual(['T0010']);
        // The older one was let go when the newer took its place: nothing of it is kept.
        expect(queueList('', { q: 'Fiš' })).toBeNull();
    });

    it('a number outside the queue, nothing found, a busy or failed main window (no answer) and Try again', async () => {
        requestQueueList('', { q: 'T0999' }, 'search');
        asked[0].answer({ ok: true, items: [], total: 0, from: 0, rev: '', head: '', elsewhere: { id: 'T0999', state: 'done' } });
        await flush();
        expect(queueList('', { q: 'T0999' })!.elsewhere).toEqual({ id: 'T0999', state: 'done' });
        requestQueueList('', { q: 'zzz' }, 'search');
        asked[1].answer({ ok: false, code: 'busy' });
        await flush();
        expect(queueList('', { q: 'zzz' })!.error).toBe('busy');
        retryQueueList('', { q: 'zzz' }, 'search');
        // No answer (the main window gone, or something it cannot be): failed.
        asked[2].answer(null as unknown as Page);
        await flush();
        expect(queueList('', { q: 'zzz' })!.error).toBe('failed');
        retryQueueList('', { q: 'zzz' }, 'search');
        asked[3].answer(page([]));
        await flush();
        expect([queueList('', { q: 'zzz' })!.total, queueList('', { q: 'zzz' })!.error]).toEqual([0, null]);
    });

    it('the queue\'s new print reads the lists shown again through the main window', async () => {
        vi.useFakeTimers();
        try {
            beginQueueSlots();
            requestQueueList('', { q: 'Matrika' }, 'search');
            endQueueSlots();
            asked[0].answer(page(['T0001']));
            await vi.advanceTimersByTimeAsync(0);
            noteQueueRev('', '3f9c2a71b0d4e8a5');
            noteQueueRev('', 'aaaabbbbccccdddd');
            await vi.advanceTimersByTimeAsync(QUEUE_REFRESH_MS);
            expect(asked.map(a => [a.filter.q, a.from])).toEqual([['Matrika', 0], ['Matrika', 0]]);
            asked[1].answer(page(['T0002', 'T0001'], { rev: 'aaaabbbbccccdddd' }));
            await vi.advanceTimersByTimeAsync(0);
            expect(queueList('', { q: 'Matrika' })!.items.map(q => q.id)).toEqual(['T0002', 'T0001']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('Do next from the window: the task first in its own lists meanwhile', async () => {
        requestQueueList('', { q: 'Matrika' }, 'search');
        asked[0].answer(page(['T0001', 'T0002', 'T0003']));
        await flush();
        moveQueueItemFirst('', 'T0003');
        expect(queueList('', { q: 'Matrika' })!.items.map(q => [q.id, q.pos])).toEqual([['T0003', 1], ['T0001', 2], ['T0002', 3]]);
    });

    it('a page as the main window answered it is checked', () => {
        expect(readQueuePage(undefined)).toEqual({ ok: false, code: 'failed' });
        expect(readQueuePage({ ok: false, code: 'nonsense' })).toEqual({ ok: false, code: 'failed' });
        expect(readQueuePage({ ok: true, items: [], from: 0 })).toEqual({ ok: false, code: 'failed' });
        const r = readQueuePage({ ok: true, items: [{ id: 'T0001', text: 'x', state: 'next', pos: 1 }, { nonsense: true }], total: 1, from: 0, next: 0, rev: 'zz', head: 7,
            elsewhere: { id: 'T0002', state: 'lost' } });
        expect(r).toEqual({ ok: true, items: [expect.objectContaining({ id: 'T0001', pos: 1 })], total: 1, from: 0, next: null, rev: '', head: '' });
    });
});
