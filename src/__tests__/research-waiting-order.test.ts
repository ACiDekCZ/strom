/**
 * The order of "Awaiting action" (spec 083 U6, K5.1–K5.4): recommended keeps
 * the research's order and places; newest / oldest first sort by `at` within
 * each phase (items without it last either way), groups standing where their
 * newest (oldest) item stands, or one list per phase without groups; the
 * "waits since" time on fixed clocks; the choice kept on this device.
 * Invented archives and offices only.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { sanitizeWaiting } from '../research-link.js';
import { FLAT_GROUP, groupWaiting, sortWaitingByTime, todoWaiting, waitingPhases, waitingSince } from '../research-waiting.js';
import { formatWaitingSince } from '../live-time.js';
import {
    WAITING_GROUPS_KEY, WAITING_ORDER_KEY, storeWaitingGroups, storeWaitingOrder, storedWaitingGroups, storedWaitingOrder,
} from '../ui/waiting-order-ui.js';

const archive = { key: 'repo:R0001', name: 'Státní oblastní archiv Vzorov', kind: 'archive' };
const office = { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' };
const web = { key: 'host:badatelna.example', name: 'badatelna.example', kind: 'web' };

const list = sanitizeWaiting([
    { id: 'T0001', what: 'a', kind: 'images', section: 'images', group: archive, order: 0, at: '2026-11-10T09:00:00Z' },
    { id: 'T0002', what: 'b', kind: 'web', section: 'web', group: web, order: 1, at: '2026-11-15T09:00:00Z' },
    { id: 'T0003', what: 'c', kind: 'images', section: 'images', group: archive, order: 2, at: '2026-11-16T08:00:00Z' },
    { id: 'T0004', what: 'd', kind: 'letter', section: 'letter', group: office, order: 3 },
    { id: 'T0005', what: 'e', kind: 'web', section: 'web', group: web, order: 4, at: '2026-11-12T09:00:00Z' },
    { id: 'T0006', what: 'f', kind: 'other', section: 'other', order: 5, at: '2026-11-14T09:00:00Z' },
    { id: 'T0007', what: 'g', kind: 'letter', section: 'letter', group: office, order: 6, phase: 'sent', sentAt: '2026-11-01T09:00:00Z', at: '2026-11-01T08:00:00Z' },
    { id: 'T0008', what: 'h', kind: 'letter', section: 'letter', group: office, order: 7, phase: 'sent', sentAt: '2026-11-11T09:00:00Z', at: '2026-11-11T08:00:00Z' },
    { id: 'T0009', what: 'i', kind: 'letter', section: 'letter', group: office, order: 8, phase: 'sent' },
], true);

const ids = (items: readonly { id: string }[]) => items.map(w => w.id);

describe('the order of Awaiting action', () => {
    it('recommended is the research\'s order in places, as before', () => {
        const p = waitingPhases(list, 'all', 'recommended', false);
        expect(p.todo).toEqual(groupWaiting(todoWaiting(list)));
        expect(p.todo.map(g => g.key)).toEqual(['repo:R0001', 'host:badatelna.example', 'to:MěÚ Vzorov', 'other']);
    });

    it('sorts by when an item has waited since; without a time last either way, in the research\'s order', () => {
        const todo = todoWaiting(list);
        expect(ids(sortWaitingByTime(todo, 'newest'))).toEqual(['T0003', 'T0002', 'T0006', 'T0005', 'T0001', 'T0004']);
        expect(ids(sortWaitingByTime(todo, 'oldest'))).toEqual(['T0001', 'T0005', 'T0006', 'T0002', 'T0003', 'T0004']);
        expect(waitingSince(list[3])).toBeNull();
        // Equal times keep the research's order.
        const same = sanitizeWaiting([
            { id: 'T0011', what: 'x', order: 1, at: '2026-11-10T09:00:00Z' },
            { id: 'T0010', what: 'y', order: 0, at: '2026-11-10T09:00:00Z' },
        ], true);
        expect(ids(sortWaitingByTime(same, 'newest'))).toEqual(['T0010', 'T0011']);
        expect(ids(sortWaitingByTime(same, 'oldest'))).toEqual(['T0010', 'T0011']);
    });

    it('in groups: each group by its newest (oldest) item, "other" sorted as any group', () => {
        const newest = waitingPhases(list, 'all', 'newest', true);
        expect(newest.todo.map(g => g.key)).toEqual(['repo:R0001', 'host:badatelna.example', 'other', 'to:MěÚ Vzorov']);
        expect(ids(newest.todo[0].items)).toEqual(['T0003', 'T0001']);
        const oldest = waitingPhases(list, 'all', 'oldest', true);
        expect(oldest.todo.map(g => g.key)).toEqual(['repo:R0001', 'host:badatelna.example', 'other', 'to:MěÚ Vzorov']);
        expect(ids(oldest.todo[0].items)).toEqual(['T0001', 'T0003']);
        expect(ids(oldest.todo[1].items)).toEqual(['T0005', 'T0002']);
    });

    it('without groups: one list per phase; Awaiting a reply by time too (H3 a)', () => {
        const p = waitingPhases(list, 'all', 'newest', false);
        expect(p.todo.map(g => g.key)).toEqual([FLAT_GROUP]);
        expect(ids(p.todo[0].items)).toEqual(['T0003', 'T0002', 'T0006', 'T0005', 'T0001', 'T0004']);
        expect(ids(p.sent[0].items)).toEqual(['T0008', 'T0007', 'T0009']);
        expect(ids(waitingPhases(list, 'all', 'oldest', false).sent[0].items)).toEqual(['T0007', 'T0008', 'T0009']);
        // A chip filters first; an empty phase has no list.
        const images = waitingPhases(list, 'images', 'oldest', false);
        expect(ids(images.todo[0].items)).toEqual(['T0001', 'T0003']);
        expect(images.sent).toEqual([]);
    });
});

describe('since when an item has waited', () => {
    // 16 Nov 2026 14:32 local time, away from midnight.
    const NOW = new Date(2026, 10, 16, 14, 32).getTime();
    const words = { justNow: 'just now', yesterday: 'yesterday' };
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('within the hour relative, today the time, then yesterday, the day, the day with its year', () => {
        expect(formatWaitingSince(NOW - 20_000, NOW, 'en', words)).toBe('just now');
        expect(formatWaitingSince(NOW - 25 * 60_000, NOW, 'en', words)).toBe('25 min. ago');
        expect(formatWaitingSince(new Date(2026, 10, 16, 12, 7).getTime(), NOW, 'de', words)).toBe('12:07');
        expect(formatWaitingSince(new Date(2026, 10, 15, 23, 50).getTime(), NOW, 'de', words)).toBe('yesterday');
        expect(formatWaitingSince(new Date(2026, 10, 12, 9, 0).getTime(), NOW, 'de', words)).toBe('12.11.');
        expect(formatWaitingSince(new Date(2026, 10, 12, 9, 0).getTime(), NOW, 'cs', words)).toBe('12. 11.');
        expect(formatWaitingSince(new Date(2025, 11, 30, 9, 0).getTime(), NOW, 'cs', words)).toBe('30. 12. 2025');
    });
});

describe('the choice kept on this device', () => {
    let store: Map<string, string>;
    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('recommended and groups on by default; a time order and groups off are kept', () => {
        expect(storedWaitingOrder()).toBe('recommended');
        expect(storedWaitingGroups()).toBe(true);
        storeWaitingOrder('oldest');
        storeWaitingGroups(false);
        expect(store.get(WAITING_ORDER_KEY)).toBe('oldest');
        expect(storedWaitingOrder()).toBe('oldest');
        expect(storedWaitingGroups()).toBe(false);
        // Back to recommended: the switch keeps its state for the next time order.
        storeWaitingOrder('recommended');
        expect(store.has(WAITING_ORDER_KEY)).toBe(false);
        expect(store.get(WAITING_GROUPS_KEY)).toBe('0');
        store.set(WAITING_ORDER_KEY, 'bogus');
        expect(storedWaitingOrder()).toBe('recommended');
    });

    it('storage that throws: the defaults', () => {
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
        expect(storedWaitingOrder()).toBe('recommended');
        expect(storedWaitingGroups()).toBe(true);
        expect(() => storeWaitingOrder('newest')).not.toThrow();
    });
});
