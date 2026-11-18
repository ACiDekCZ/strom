/**
 * Waiting buttons part 2: the lock on edits while the tree is replaced (§2.6), the note a write leaves when
 * the page is left (§2.7), and the progress of a tree's download (§2.3: megabytes, the share, the people).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const toastCalls: string[] = [];
vi.mock('../ui/toast.js', () => ({
    showToast: (message: string) => {
        toastCalls.push(message);
        return { el: null, update: () => undefined, close: () => undefined };
    },
    showProgressToast: () => ({ el: { dataset: {} }, update: () => undefined, done: () => undefined, fail: () => undefined, close: () => undefined }),
}));

const { TreeEditLock } = await import('../ui/tree-edit-lock.js');
const { holdLeave, leaveHeld, takeLeftPending, parseBusyPending, resetBusyLeave, BUSY_PENDING_KEY } = await import('../ui/busy-leave.js');
const { formatMb, downloadStep, countGedcomPersons, readBodyWithProgress } = await import('../ui/tree-load-progress.js');
const { strings, setLanguage } = await import('../strings.js');

class MemoryStorage {
    private m = new Map<string, string>();
    getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string): void { this.m.set(k, String(v)); }
    removeItem(k: string): void { this.m.delete(k); }
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:15:00Z'));
    toastCalls.length = 0;
    TreeEditLock.reset();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage();
    resetBusyLeave();
    setLanguage('en');
});

afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

describe('TreeEditLock', () => {
    it('lets edits go without a hold', () => {
        expect(TreeEditLock.held()).toBeNull();
        expect(TreeEditLock.refuse()).toBe(false);
        expect(toastCalls).toEqual([]);
    });

    it('refuses an edit while a load holds it, said by a toast once in 2 s', () => {
        const release = TreeEditLock.hold('load');
        expect(TreeEditLock.held()).toBe('load');
        expect(TreeEditLock.refuse()).toBe(true);
        expect(TreeEditLock.refuse()).toBe(true);
        expect(toastCalls).toEqual([strings.busy.editsWaitLoad]);
        vi.advanceTimersByTime(2000);
        expect(TreeEditLock.refuse()).toBe(true);
        expect(toastCalls).toHaveLength(2);
        release();
        expect(TreeEditLock.refuse()).toBe(false);
    });

    it('says the newest hold and stands until every hold is released', () => {
        const a = TreeEditLock.hold('load');
        const b = TreeEditLock.hold('adopt');
        expect(TreeEditLock.text()).toBe(strings.busy.editsWaitAdopt);
        b();
        b(); // twice: no harm
        expect(TreeEditLock.text()).toBe(strings.busy.editsWaitLoad);
        a();
        expect(TreeEditLock.held()).toBeNull();
        expect(TreeEditLock.text()).toBe('');
    });
});

describe('leaving the page (§2.7)', () => {
    it('a send leaves its note while it runs and takes it away at its end', () => {
        const release = holdLeave('send', 'tree_1', Date.parse('2026-11-18T10:15:00Z'));
        expect(leaveHeld()).toBe(true);
        expect(parseBusyPending(sessionStorage.getItem(BUSY_PENDING_KEY))).toEqual({ kind: 'send', treeId: 'tree_1', startedAt: Date.parse('2026-11-18T10:15:00Z') });
        release();
        expect(leaveHeld()).toBe(false);
        expect(sessionStorage.getItem(BUSY_PENDING_KEY)).toBeNull();
    });

    it('a load asks before leaving but leaves no note (nothing changes when it is cut)', () => {
        const release = holdLeave('load', 'tree_1');
        expect(leaveHeld()).toBe(true);
        expect(sessionStorage.getItem(BUSY_PENDING_KEY)).toBeNull();
        release();
        expect(leaveHeld()).toBe(false);
    });

    it('a note left by a closed page is said once', () => {
        sessionStorage.setItem(BUSY_PENDING_KEY, JSON.stringify({ kind: 'adopt', treeId: 't', startedAt: 5 }));
        expect(takeLeftPending()).toEqual({ kind: 'adopt', treeId: 't', startedAt: 5 });
        expect(takeLeftPending()).toBeNull();
    });

    it('a broken note is no note', () => {
        expect(parseBusyPending('{')).toBeNull();
        expect(parseBusyPending(JSON.stringify({ kind: 'other', startedAt: 1 }))).toBeNull();
        expect(parseBusyPending(JSON.stringify({ kind: 'send' }))).toBeNull();
        expect(parseBusyPending(JSON.stringify({ kind: 'send', startedAt: 1, treeId: 3 }))).toEqual({ kind: 'send', treeId: null, startedAt: 1 });
    });
});

describe('download progress (§2.3)', () => {
    const MB = 1024 * 1024;

    it('megabytes with one decimal in the language’s way', () => {
        expect(formatMb(1.4 * MB, 'en')).toBe('1.4 MB');
        expect(formatMb(1.4 * MB, 'cs')).toBe('1,4 MB');
        expect(formatMb(1.4 * MB, 'de')).toBe('1,4 MB');
        // A file on its way never reads 0.0 MB.
        expect(formatMb(2000, 'en')).toBe('0.1 MB');
        expect(formatMb(0, 'en')).toBe('0.0 MB');
    });

    it('a known size: the share and "x of y"', () => {
        expect(downloadStep(1.4 * MB, 3.2 * MB, 'en')).toEqual({ percent: 44, size: '1.4 MB of 3.2 MB' });
        setLanguage('cs');
        expect(downloadStep(1.4 * MB, 3.2 * MB, 'cs')).toEqual({ percent: 44, size: '1,4 MB z 3,2 MB' });
    });

    it('no size, or more than said (a compressed answer): a bar of unknown share and the megabytes so far', () => {
        expect(downloadStep(1.4 * MB, null, 'en')).toEqual({ percent: null, size: '1.4 MB' });
        expect(downloadStep(4 * MB, 3 * MB, 'en')).toEqual({ percent: null, size: '4.0 MB' });
        expect(downloadStep(0, null, 'en')).toEqual({ percent: null, size: '' });
    });

    it('counts the people of a GEDCOM file', () => {
        const ged = '0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Jan /Fíšek/\n0 @I2@ INDI\r\n0 @F1@ FAM\n1 HUSB @I1@\n0 TRLR\n';
        expect(countGedcomPersons(ged)).toBe(2);
        expect(countGedcomPersons('0 HEAD\n0 TRLR\n')).toBe(0);
    });

    it('reads a streamed body whole, telling its progress', async () => {
        const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
        const body = new ReadableStream<Uint8Array>({
            start(c) { for (const p of parts) c.enqueue(p); c.close(); },
        });
        const res = new Response(body, { headers: { 'content-length': '5' } });
        const seen: Array<[number, number | null]> = [];
        const buf = await readBodyWithProgress(res, { progress: (l, t) => seen.push([l, t]) });
        expect([...new Uint8Array(buf)]).toEqual([1, 2, 3, 4, 5]);
        expect(seen).toEqual([[0, 5], [3, 5], [5, 5]]);
    });
});
