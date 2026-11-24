/**
 * "Most helpful" in "Awaiting action" (spec 105 K4.1): an item's `gain` read
 * only from a research that announces `waiting.gain` (a bad or zero score is
 * none, unknown parts dropped), the order by score (an equal one in the
 * research's order, items without a gain last in it), grouped as a time
 * order, the order offered only with the feature (a kept choice falls back to
 * Recommended without it and stays kept), and the reason shown only in it.
 * Invented people and archives only.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { WAITING_GAIN_FEATURE, sanitizeLiveStatus, sanitizeWaitingGain, waitingGainOn } from '../research-link.js';
import { FLAT_GROUP, sortWaitingByGain, waitingOrdersFor, waitingPhases } from '../research-waiting.js';
import { WAITING_ORDER_KEY, storeWaitingOrder, storedWaitingOrder } from '../ui/waiting-order-ui.js';

const status = (features: string[], waiting: unknown[]) => sanitizeLiveStatus({
    tree: { id: 'R1', name: 'Smyšlenka' }, head: 'a1', persons: 1, families: 0, features, waiting,
})!;

const archive = { key: 'repo:R0001', name: 'Státní oblastní archiv Vzorov', kind: 'archive' };
const office = { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' };

const gain110 = {
    score: 110, says: 'nová generace: rodiče osoby Jan Smyšlený · přímá linie · odblokuje 3 úkoly',
    parts: [
        { kind: 'generation', person: 'P0012', name: 'Jan Smyšlený', missing: 'parents' },
        { kind: 'line' },
        { kind: 'unblocks', n: 3 },
    ],
};

const items = [
    { id: 'T0001', what: 'a', kind: 'images', section: 'images', group: archive, order: 0 },
    { id: 'T0002', what: 'b', kind: 'letter', section: 'letter', group: office, order: 1, gain: { score: 40, says: 'přímá linie', parts: [{ kind: 'line' }] } },
    { id: 'T0003', what: 'c', kind: 'images', section: 'images', group: archive, order: 2, gain: gain110 },
    { id: 'T0004', what: 'd', kind: 'letter', section: 'letter', group: office, order: 3, gain: { score: 0, says: '', parts: [] } },
    { id: 'T0005', what: 'e', kind: 'images', section: 'images', group: archive, order: 4, gain: { score: 40, says: '', parts: [] } },
    { id: 'T0006', what: 'f', kind: 'other', section: 'other', order: 5 },
];

const ids = (list: readonly { id: string }[]) => list.map(w => w.id);

describe('the gain read from the status', () => {
    it('only from a research that announces waiting.gain', () => {
        expect(status(['waiting.groups'], items).waiting.some(w => w.gain)).toBe(false);
        const s = status(['waiting.groups', WAITING_GAIN_FEATURE], items);
        expect(s.waiting.find(w => w.id === 'T0003')?.gain).toEqual(gain110);
        expect(waitingGainOn(s)).toBe(true);
        expect(waitingGainOn(status(['waiting.groups'], items))).toBe(false);
    });

    it('a zero, negative or missing score is no gain; unknown parts dropped; text cut', () => {
        expect(sanitizeWaitingGain({ score: 0, says: '', parts: [] })).toBeNull();
        expect(sanitizeWaitingGain({ score: -5, says: 'x' })).toBeNull();
        expect(sanitizeWaitingGain({ score: '50', says: 'x' })).toBeNull();
        expect(sanitizeWaitingGain({ score: Number.NaN })).toBeNull();
        expect(sanitizeWaitingGain(null)).toBeNull();
        const g = sanitizeWaitingGain({
            score: 60, says: `  ${'x'.repeat(400)}  `,
            parts: [
                { kind: 'generation', person: 'not a ref', name: 'Jan', missing: 'father' },
                { kind: 'generation', person: 'P0001', missing: 'uncle' },
                { kind: 'unblocks', n: -2 },
                { kind: 'unblocks', n: 0 },
                { kind: 'mystery' },
                'line',
                { kind: 'line', extra: true },
            ],
        })!;
        expect(g.score).toBe(60);
        expect(g.says.length).toBeLessThanOrEqual(300);
        expect(g.parts).toEqual([{ kind: 'generation', name: 'Jan', missing: 'father' }, { kind: 'line' }]);
        // No says or parts: an empty reason.
        expect(sanitizeWaitingGain({ score: 10 })).toEqual({ score: 10, says: '', parts: [] });
    });
});

describe('the order "Most helpful"', () => {
    const list = status(['waiting.groups', WAITING_GAIN_FEATURE], items).waiting;

    it('by score, an equal one in the research\'s order, items without a gain last in it', () => {
        expect(ids(sortWaitingByGain(list))).toEqual(['T0003', 'T0002', 'T0005', 'T0001', 'T0004', 'T0006']);
        // The research's order settles it, not the order the list came in.
        expect(ids(sortWaitingByGain([...list].reverse()))).toEqual(['T0003', 'T0002', 'T0005', 'T0001', 'T0004', 'T0006']);
    });

    it('grouped as a time order: each group where its most helpful item stands; one list without groups', () => {
        const grouped = waitingPhases(list, 'all', 'gain', true).todo;
        expect(grouped.map(g => g.key)).toEqual(['repo:R0001', 'to:MěÚ Vzorov', 'other']);
        expect(ids(grouped[0].items)).toEqual(['T0003', 'T0005', 'T0001']);
        expect(ids(grouped[1].items)).toEqual(['T0002', 'T0004']);
        const flat = waitingPhases(list, 'all', 'gain', false).todo;
        expect(flat.map(g => g.key)).toEqual([FLAT_GROUP]);
        expect(ids(flat[0].items)).toEqual(['T0003', 'T0002', 'T0005', 'T0001', 'T0004', 'T0006']);
    });

    it('offered only with the feature', () => {
        expect(waitingOrdersFor(false)).toEqual(['recommended', 'newest', 'oldest']);
        expect(waitingOrdersFor(false, true)).toEqual(['recommended', 'newest', 'oldest', 'gain']);
        expect(waitingOrdersFor(true, true)).toEqual(['recommended', 'newest', 'oldest', 'most', 'gain']);
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

    it('kept; without the feature Recommended, the kept choice stays for a research with it', () => {
        storeWaitingOrder('gain');
        expect(store.get(WAITING_ORDER_KEY)).toBe('gain');
        expect(storedWaitingOrder(false, true)).toBe('gain');
        expect(storedWaitingOrder(true, true)).toBe('gain');
        expect(storedWaitingOrder(true, false)).toBe('recommended');
        expect(storedWaitingOrder()).toBe('recommended');
        expect(store.get(WAITING_ORDER_KEY)).toBe('gain');
    });
});
