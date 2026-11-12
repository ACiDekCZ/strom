/**
 * Settings in a window that is not the main one (spec 079 §0): read, never
 * written; the settings the main window stores are followed through the
 * `storage` event.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager, CARD_SIGNALS_KEY, MAP_KINDS_KEY } from '../settings.js';
import { SETTINGS_KEY } from '../types.js';

let store: Map<string, string>;
let writes: string[];
let listeners: ((e: { key: string | null }) => void)[];
let theme: string | null;

beforeEach(() => {
    store = new Map<string, string>();
    writes = [];
    listeners = [];
    theme = null;
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { writes.push(k); store.set(k, v); },
        removeItem: (k: string) => { writes.push(k); store.delete(k); },
    });
    vi.stubGlobal('window', {
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        addEventListener: (type: string, fn: (e: { key: string | null }) => void) => { if (type === 'storage') listeners.push(fn); },
        removeEventListener: (type: string, fn: (e: { key: string | null }) => void) => { listeners = listeners.filter(l => l !== fn); },
    });
    vi.stubGlobal('document', { documentElement: { setAttribute: (_: string, v: string) => { theme = v; } } });
    SettingsManager.setReadOnly(true);
});
afterEach(() => {
    SettingsManager.setReadOnly(false);
    vi.unstubAllGlobals();
});

describe('settings in a satellite or a second tab', () => {
    it('a change stays in the window: nothing is stored', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
        SettingsManager.setTheme('dark');
        SettingsManager.setMinimap(false);
        SettingsManager.setCardSignal('status', false);
        SettingsManager.setMapKinds(['birth']);
        expect(writes).toEqual([]);
        expect(SettingsManager.getTheme()).toBe('dark');
        expect(JSON.parse(store.get(SETTINGS_KEY)!)).toEqual({ theme: 'light' });
    });

    it('card signals and map kinds changed here are kept in the window, not stored', () => {
        store.set(CARD_SIGNALS_KEY, JSON.stringify({ v: 2, status: true }));
        store.set(MAP_KINDS_KEY, JSON.stringify(['birth', 'death']));
        SettingsManager.setCardSignal('status', false);
        SettingsManager.setMapKinds(['death']);
        expect(SettingsManager.getCardSignals().status).toBe(false);
        expect(SettingsManager.getMapKinds()).toEqual(['death']);
        expect(writes).toEqual([]);
        expect(JSON.parse(store.get(CARD_SIGNALS_KEY)!).status).toBe(true);
        expect(JSON.parse(store.get(MAP_KINDS_KEY)!)).toEqual(['birth', 'death']);
        // The main window stores them: its values win, as for the other settings.
        const stop = SettingsManager.watchOtherWindows(() => {});
        listeners.forEach(l => l({ key: CARD_SIGNALS_KEY }));
        expect(SettingsManager.getCardSignals().status).toBe(true);
        expect(SettingsManager.getMapKinds()).toEqual(['birth', 'death']);
        stop();
    });

    it('follows what the main window stores: read again, the theme at once, the language told', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ theme: 'light', language: 'en' }));
        const changes: string[] = [];
        const stop = SettingsManager.watchOtherWindows((c) => changes.push(c.languageBefore));
        // Another key: nothing to read.
        listeners.forEach(l => l({ key: 'strom-tree-index' }));
        expect(changes).toEqual([]);

        listeners.forEach(l => l({ key: SETTINGS_KEY }));
        expect(SettingsManager.getTheme()).toBe('light');
        expect(theme).toBe('light');

        store.set(SETTINGS_KEY, JSON.stringify({ theme: 'dark', language: 'cs' }));
        listeners.forEach(l => l({ key: SETTINGS_KEY }));
        expect(SettingsManager.getTheme()).toBe('dark');
        expect(SettingsManager.getLanguage()).toBe('cs');
        expect(theme).toBe('dark');
        expect(changes).toHaveLength(2);
        expect(changes[1]).toBe('en');

        // The main window's settings removed (storage cleared): the defaults.
        store.clear();
        listeners.forEach(l => l({ key: null }));
        expect(SettingsManager.getTheme()).toBe('system');
        expect(writes).toEqual([]);
        stop();
        expect(listeners).toEqual([]);
    });
});
