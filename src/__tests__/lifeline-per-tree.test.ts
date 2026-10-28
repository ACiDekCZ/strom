/**
 * The person card timeline's chips ("Children's events", "History"), spec
 * 020 K4.5: each tree has its default, set in the tree's settings and kept in
 * this browser; the former one choice for every tree is each tree's default
 * (nothing lost on the move). A chip on the card changes the open tree's
 * default for a while only: in memory, gone when another tree is opened or
 * the app is loaded again (a new module), or when the tree's default is set.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
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

/** A fresh copy of the in-memory chips (as after loading the app again). */
async function freshView(): Promise<typeof import('../lifeline-view.js')> {
    vi.resetModules();
    const { SettingsManager: sm } = await import('../settings.js');
    // The fresh module's SettingsManager reads the same stubbed storage.
    (sm as unknown as { load(): void }).load();
    return import('../lifeline-view.js');
}

describe('the card timeline default per tree', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('defaults: children\'s events off, history on, in every tree', () => {
        loadSettings(null);
        expect(SettingsManager.getLifelineDefaults('lhotak')).toEqual({ childEvents: false, history: true });
        expect(SettingsManager.getLifelineDefaults(null)).toEqual({ childEvents: false, history: true });
    });

    it('the former choice for every tree is each tree\'s default', () => {
        loadSettings({ lifelineChildEvents: true, lifelineHistory: false });
        for (const tree of ['lhotak', 'novak', null]) {
            expect(SettingsManager.getLifelineDefaults(tree)).toEqual({ childEvents: true, history: false });
        }
    });

    it('a tree\'s default is its own; the other trees keep the former choice; kept in this browser', () => {
        const store = loadSettings({ lifelineChildEvents: true });
        SettingsManager.setLifelineDefaults('lhotak', { childEvents: false, history: false });
        expect(SettingsManager.getLifelineDefaults('lhotak')).toEqual({ childEvents: false, history: false });
        expect(SettingsManager.getLifelineDefaults('novak')).toEqual({ childEvents: true, history: true });
        const s = saved(store);
        expect(s.lifelineChildEvents).toBe(true);
        expect(s.lifelineHistory).toBeUndefined();
        expect(s.lifelineByTree).toEqual({ lhotak: { childEvents: false, history: false } });
        loadSettings(s);
        expect(SettingsManager.getLifelineDefaults('lhotak')).toEqual({ childEvents: false, history: false });
    });

    it('a deleted tree\'s default is forgotten', () => {
        const store = loadSettings(null);
        SettingsManager.setLifelineDefaults('lhotak', { childEvents: true, history: true });
        SettingsManager.forgetLifelineDefaults('lhotak');
        expect(SettingsManager.getLifelineDefaults('lhotak')).toEqual({ childEvents: false, history: true });
        expect(saved(store).lifelineByTree).toEqual({});
    });

    it('the Settings switch of the history layer stays one for every tree', () => {
        loadSettings(null);
        SettingsManager.setLifelineDefaults('lhotak', { childEvents: false, history: false });
        expect(SettingsManager.isHistoryLayer()).toBe(true);
        SettingsManager.setHistoryLayer(false);
        expect(SettingsManager.isHistoryLayer()).toBe(false);
        expect(SettingsManager.getLifelineDefaults('novak').history).toBe(true);
    });
});

describe('the card\'s chips change the default for a while', () => {
    beforeEach(() => { loadSettings(null); });
    afterEach(() => vi.unstubAllGlobals());

    it('a chip changes the open tree only, and is never stored', async () => {
        const store = loadSettings({ lifelineChildEvents: false });
        const v = await freshView();
        v.setLifelineChip('lhotak', 'childEvents', true);
        expect(v.lifelineChips('lhotak')).toEqual({ childEvents: true, history: true });
        expect(v.lifelineChips('novak')).toEqual({ childEvents: false, history: true });
        expect(saved(store).lifelineByTree).toBeUndefined();
        expect(saved(store).lifelineChildEvents).toBe(false);
    });

    it('another tree opened: the change is gone, also after coming back', async () => {
        const v = await freshView();
        v.setLifelineChip('lhotak', 'history', false);
        v.keepLifelineChipsFor('lhotak');
        expect(v.lifelineChips('lhotak').history).toBe(false);
        v.keepLifelineChipsFor('novak');
        v.keepLifelineChipsFor('lhotak');
        expect(v.lifelineChips('lhotak').history).toBe(true);
    });

    it('the app loaded again: the tree\'s default', async () => {
        let v = await freshView();
        v.setLifelineChip('lhotak', 'childEvents', true);
        v = await freshView();
        expect(v.lifelineChips('lhotak').childEvents).toBe(false);
    });

    it('the tree\'s default set anew: the card shows it', async () => {
        const v = await freshView();
        const { SettingsManager: sm } = await import('../settings.js');
        v.setLifelineChip('lhotak', 'childEvents', false);
        sm.setLifelineDefaults('lhotak', { childEvents: true, history: true });
        expect(v.lifelineChips('lhotak').childEvents).toBe(false);
        v.dropLifelineChips('lhotak');
        expect(v.lifelineChips('lhotak').childEvents).toBe(true);
    });
});
