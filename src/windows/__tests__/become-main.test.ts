/**
 * A window becoming the main one (spec 079 §3.3, §5): the lock first (held by
 * another window: nothing happens), then the mark and the restart; the new
 * page tries again for the lock a few seconds; the mark counts once and only
 * for a while.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    becomeMain, peekBecomeMainMark, takeBecomeMainMark, writeBecomeMainMark, retryBecomeMain, resetBecomeMainForTests,
    BECOME_MAIN_KEY, BECOME_MAIN_MARK_MS, BECOME_MAIN_RETRY_MS,
} from '../become-main.js';
import type { HeldLock } from '../window-role.js';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => { map.set(k, v); },
        removeItem: (k) => { map.delete(k); },
    };
}

const lock: HeldLock = { release: () => {} };
const NOW = new Date('2026-11-12T10:00:00Z').getTime();

beforeEach(() => {
    resetBecomeMainForTests();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the mark', () => {
    it('counts for BECOME_MAIN_MARK_MS, is taken once, keeps the tree and the Table state', () => {
        const s = memoryStorage();
        writeBecomeMainMark({ tree: 'tree-a', table: { rowType: 'persons' }, at: NOW }, s);
        expect(peekBecomeMainMark(NOW + 500, s)).toEqual({ tree: 'tree-a', table: { rowType: 'persons' }, at: NOW });
        expect(peekBecomeMainMark(NOW + BECOME_MAIN_MARK_MS + 1, s)).toBeNull();
        expect(takeBecomeMainMark(NOW + 500, s)).toMatchObject({ tree: 'tree-a' });
        expect(s.map.has(BECOME_MAIN_KEY)).toBe(false);
        expect(takeBecomeMainMark(NOW + 600, s)).toBeNull();
    });

    it('an old or malformed mark is removed when taken and says nothing', () => {
        const s = memoryStorage();
        s.setItem(BECOME_MAIN_KEY, '{nope');
        expect(takeBecomeMainMark(NOW, s)).toBeNull();
        expect(s.map.size).toBe(0);
        writeBecomeMainMark({ tree: null, at: NOW - BECOME_MAIN_MARK_MS - 10 }, s);
        expect(takeBecomeMainMark(NOW, s)).toBeNull();
        expect(s.map.size).toBe(0);
    });
});

describe('becomeMain', () => {
    it('the lock taken: prepared, then started again', async () => {
        const order: string[] = [];
        const ok = await becomeMain({ tryLock: async () => lock, prepare: () => order.push('prepare'), restart: () => order.push('restart') });
        expect(ok).toBe(true);
        expect(order).toEqual(['prepare', 'restart']);
    });

    it('another window has the lock: nothing happens, and a later click tries again', async () => {
        const prepare = vi.fn();
        const restart = vi.fn();
        expect(await becomeMain({ tryLock: async () => null, prepare, restart })).toBe(false);
        expect(await becomeMain({ tryLock: async () => { throw new Error('no locks'); }, prepare, restart })).toBe(false);
        expect(prepare).not.toHaveBeenCalled();
        expect(restart).not.toHaveBeenCalled();
        expect(await becomeMain({ tryLock: async () => lock, prepare, restart })).toBe(true);
    });

    it('a second click on the way does nothing', async () => {
        const restart = vi.fn();
        let free: (l: HeldLock) => void = () => {};
        const first = becomeMain({ tryLock: () => new Promise(r => { free = r; }), prepare: () => {}, restart });
        expect(await becomeMain({ tryLock: async () => lock, prepare: () => {}, restart })).toBe(false);
        free(lock);
        expect(await first).toBe(true);
        expect(restart).toHaveBeenCalledTimes(1);
    });
});

describe('retryBecomeMain', () => {
    it('gets the lock once the old page released it', async () => {
        let tries = 0;
        const got = await retryBecomeMain(async () => (++tries >= 4 ? lock : null), async () => {});
        expect(got).toBe(lock);
        expect(tries).toBe(4);
    });

    it('gives up after BECOME_MAIN_RETRY_MS', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const tryLock = vi.fn(async () => null);
        let result: HeldLock | null | undefined;
        void retryBecomeMain(tryLock).then((r) => { result = r; });
        await vi.advanceTimersByTimeAsync(BECOME_MAIN_RETRY_MS + 200);
        expect(result).toBeNull();
        expect(tryLock.mock.calls.length).toBeGreaterThan(10);
    });
});
