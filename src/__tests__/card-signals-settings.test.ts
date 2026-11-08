/**
 * The card signals' settings brought to version 2 (spec 066 P4 §8): the
 * evidence stripes and the tree cards' reliability become one "status"
 * switch, the cross-tree badges join the list; every switch is on by
 * default (§4) and what was switched off stays off.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager, migrateCardSignals, CARD_SIGNAL_DEFAULTS } from '../settings.js';

const KEY = 'strom-card-signals';
let store: Map<string, string>;

beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
});
afterEach(() => vi.unstubAllGlobals());

describe('migrateCardSignals', () => {
    it('status: the stripes on, or the tree cards\' reliability on', () => {
        const status = (evidence: boolean | undefined, reliabilityTree: boolean | undefined) =>
            migrateCardSignals(evidence === undefined ? {} : { evidence }, { reliabilityTree }).stored.status;
        expect(status(true, false)).toBe(true);
        expect(status(false, true)).toBe(true);
        expect(status(false, false)).toBe(false);
        expect(status(false, undefined)).toBe(false);
        expect(status(undefined, undefined)).toBe(true);
    });

    it('the cross-tree badges: off only when they were switched off', () => {
        expect(migrateCardSignals({}, { crossTreeBadges: false }).stored.crossTree).toBe(false);
        expect(migrateCardSignals({}, { crossTreeBadges: true }).stored.crossTree).toBe(true);
        expect(migrateCardSignals({}, {}).stored.crossTree).toBe(true);
    });

    it('keeps the other switches and the older keys; a second run changes nothing', () => {
        const first = migrateCardSignals({ evidence: false, story: false, agent: false }, { reliabilityTree: false });
        expect(first).toEqual({ stored: { evidence: false, story: false, agent: false, status: false, crossTree: true, v: 2 }, changed: true });
        const again = migrateCardSignals(first.stored, { reliabilityTree: true, crossTreeBadges: false });
        expect(again).toEqual({ stored: first.stored, changed: false });
    });
});

describe('SettingsManager card signals', () => {
    it('everything on by default', () => {
        expect(SettingsManager.getCardSignals()).toEqual(CARD_SIGNAL_DEFAULTS);
        expect(Object.values(CARD_SIGNAL_DEFAULTS).every(v => v)).toBe(true);
    });

    it('converts what an older build stored once, and writes it back', () => {
        store.set(KEY, JSON.stringify({ evidence: false, conflict: false }));
        store.set('strom-settings', JSON.stringify({ reliabilityTree: false, crossTreeBadges: false }));
        expect(SettingsManager.getCardSignals()).toMatchObject({ status: false, conflict: false, crossTree: false, story: true });
        expect(JSON.parse(store.get(KEY)!)).toMatchObject({ v: 2, status: false, crossTree: false, evidence: false });
        // The old switches no longer count once converted.
        store.set('strom-settings', JSON.stringify({ reliabilityTree: true, crossTreeBadges: true }));
        expect(SettingsManager.getCardSignals()).toMatchObject({ status: false, crossTree: false });
    });

    it('a switch set: kept with the version, the cross-tree badges through the same list', () => {
        SettingsManager.setCardSignal('status', false);
        expect(JSON.parse(store.get(KEY)!)).toMatchObject({ status: false, v: 2 });
        SettingsManager.setCrossTreeBadges(false);
        expect(SettingsManager.isCrossTreeBadgesEnabled()).toBe(false);
        expect(SettingsManager.getCardSignals()).toMatchObject({ status: false, crossTree: false });
    });
});
