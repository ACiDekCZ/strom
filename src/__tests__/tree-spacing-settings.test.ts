/**
 * Spacing of the tree view and of an export (Settings → Spacing): a setting
 * of this device, normal unless dense was chosen.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager } from '../settings.js';
import { SETTINGS_KEY } from '../types.js';

let store: Map<string, string>;
const reload = () => (SettingsManager as unknown as { load(): void }).load();

beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
});
afterEach(() => {
    SettingsManager.setTreeSpacing('normal');
    SettingsManager.setPosterSpacing('normal');
    vi.unstubAllGlobals();
});

describe('tree and poster spacing settings', () => {
    it('absent or unknown: normal', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ treeSpacing: 'wide', posterSpacing: 3 }));
        reload();
        expect(SettingsManager.getTreeSpacing()).toBe('normal');
        expect(SettingsManager.getPosterSpacing()).toBe('normal');
    });

    it('dense is kept and read back, each on its own', () => {
        SettingsManager.setTreeSpacing('dense');
        expect(JSON.parse(store.get(SETTINGS_KEY)!)).toMatchObject({ treeSpacing: 'dense' });
        reload();
        expect(SettingsManager.getTreeSpacing()).toBe('dense');
        expect(SettingsManager.getPosterSpacing()).toBe('normal');
        SettingsManager.setPosterSpacing('dense');
        SettingsManager.setTreeSpacing('normal');
        reload();
        expect(SettingsManager.getTreeSpacing()).toBe('normal');
        expect(SettingsManager.getPosterSpacing()).toBe('dense');
    });
});
