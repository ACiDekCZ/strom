/**
 * The person card's timeline chips ("Children's events", "History") are
 * remembered per tree in this browser (spec 020 K4.5). The former one choice
 * for every tree stays the default of each tree (nothing lost on the move);
 * a tree's own choice does not touch the other trees; a deleted tree's
 * choices are forgotten.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SettingsManager } from '../settings.js';

/** SettingsManager over a stored settings object (its constructor default, then `load`). */
function loadSettings(stored: Record<string, unknown> | null): Map<string, string> {
    const store = new Map<string, string>();
    if (stored) store.set('strom-settings', JSON.stringify(stored));
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
    const sm = SettingsManager as unknown as { settings: Record<string, unknown>; load(): void };
    sm.settings = { theme: 'system', language: 'system', encryption: false, auditLog: false };
    sm.load();
    return store;
}

const saved = (store: Map<string, string>): Record<string, unknown> => JSON.parse(store.get('strom-settings') ?? '{}');

describe('timeline chips per tree', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('defaults: children\'s events off, history on, in every tree', () => {
        loadSettings(null);
        expect(SettingsManager.isLifelineChildEvents('lhotak')).toBe(false);
        expect(SettingsManager.isLifelineHistory('lhotak')).toBe(true);
        expect(SettingsManager.isLifelineChildEvents(null)).toBe(false);
        expect(SettingsManager.isLifelineHistory(null)).toBe(true);
    });

    it('the former choice for every tree is taken over by each tree', () => {
        loadSettings({ lifelineChildEvents: true, lifelineHistory: false });
        for (const tree of ['lhotak', 'novak', null]) {
            expect(SettingsManager.isLifelineChildEvents(tree)).toBe(true);
            expect(SettingsManager.isLifelineHistory(tree)).toBe(false);
        }
    });

    it('a choice in one tree stays in that tree; the others keep the former one', () => {
        const store = loadSettings({ lifelineChildEvents: true });
        SettingsManager.setLifelineChildEvents('lhotak', false);
        SettingsManager.setLifelineHistory('lhotak', false);
        expect(SettingsManager.isLifelineChildEvents('lhotak')).toBe(false);
        expect(SettingsManager.isLifelineHistory('lhotak')).toBe(false);
        expect(SettingsManager.isLifelineChildEvents('novak')).toBe(true);
        expect(SettingsManager.isLifelineHistory('novak')).toBe(true);
        // Kept in this browser across a reload; the former value untouched.
        const s = saved(store);
        expect(s.lifelineChildEvents).toBe(true);
        expect(s.lifelineHistory).toBeUndefined();
        expect(s.lifelineByTree).toEqual({ lhotak: { childEvents: false, history: false } });
        loadSettings(s);
        expect(SettingsManager.isLifelineChildEvents('lhotak')).toBe(false);
        expect(SettingsManager.isLifelineChildEvents('novak')).toBe(true);
    });

    it('one chip chosen keeps the other chip following the former choice', () => {
        loadSettings({ lifelineHistory: false });
        SettingsManager.setLifelineChildEvents('lhotak', true);
        expect(SettingsManager.isLifelineHistory('lhotak')).toBe(false);
        SettingsManager.setLifelineHistory('lhotak', true);
        expect(SettingsManager.isLifelineChildEvents('lhotak')).toBe(true);
        expect(SettingsManager.isLifelineHistory('lhotak')).toBe(true);
        expect(SettingsManager.isLifelineHistory('novak')).toBe(false);
    });

    it('a deleted tree\'s choices are forgotten', () => {
        const store = loadSettings(null);
        SettingsManager.setLifelineChildEvents('lhotak', true);
        SettingsManager.forgetLifelineChoices('lhotak');
        expect(SettingsManager.isLifelineChildEvents('lhotak')).toBe(false);
        expect(saved(store).lifelineByTree).toEqual({});
    });

    it('the Settings switch of the history layer stays one for every tree', () => {
        loadSettings(null);
        SettingsManager.setLifelineHistory('lhotak', false);
        expect(SettingsManager.isHistoryLayer()).toBe(true);
        SettingsManager.setHistoryLayer(false);
        expect(SettingsManager.isHistoryLayer()).toBe(false);
        expect(SettingsManager.isLifelineHistory('novak')).toBe(true);
    });
});
