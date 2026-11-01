/**
 * The map's kinds of places (spec 031 §1) are kept per device, apart from the
 * tree: all four by default, and an empty or broken list reads as all four.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager, MAP_KINDS_KEY } from '../settings.js';

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

describe('SettingsManager map kinds', () => {
    it('shows all four kinds by default', () => {
        expect(SettingsManager.getMapKinds()).toEqual(['birth', 'death', 'wedding', 'event']);
    });

    it('remembers a choice under its own key, in the map\'s order', () => {
        SettingsManager.setMapKinds(['event', 'birth']);
        expect(JSON.parse(store.get(MAP_KINDS_KEY)!)).toEqual(['birth', 'event']);
        expect(SettingsManager.getMapKinds()).toEqual(['birth', 'event']);
        expect(store.has('strom-settings')).toBe(false);   // not in the general settings
    });

    it('reads an empty, unknown or broken list as all four', () => {
        for (const raw of ['[]', '["house"]', '{"birth":true}', 'not json', '"birth"']) {
            store.set(MAP_KINDS_KEY, raw);
            expect(SettingsManager.getMapKinds(), raw).toEqual(['birth', 'death', 'wedding', 'event']);
        }
        store.set(MAP_KINDS_KEY, '["death","house"]');
        expect(SettingsManager.getMapKinds()).toEqual(['death']);
        SettingsManager.setMapKinds([]);
        expect(SettingsManager.getMapKinds()).toEqual(['birth', 'death', 'wedding', 'event']);
    });
});
