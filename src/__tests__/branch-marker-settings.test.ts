/**
 * Lineage markers (spec 112, R1): the shape of the marker and the tint, and
 * the migration from the old on/off "branch colours" switch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager } from '../settings.js';
import { AppSettings } from '../types.js';
import { SETTINGS_KEY } from '../model-values.js';

let store: Map<string, string>;
const internals = SettingsManager as unknown as { load(): void; settings: AppSettings };
/** Read the stored settings as a fresh start would (nothing kept from before). */
const restart = (): void => {
    internals.settings = { theme: 'system', language: 'system', encryption: false, auditLog: false };
    internals.load();
};
const stored = (): Record<string, unknown> => JSON.parse(store.get(SETTINGS_KEY) ?? '{}');

beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
    restart();
});
afterEach(() => {
    restart();
    vi.unstubAllGlobals();
});

describe('lineage marker settings', () => {
    it('default: the arc, no tint', () => {
        expect(SettingsManager.getBranchMarker()).toBe('arc');
        expect(SettingsManager.isBranchMarkingOn()).toBe(true);
        expect(SettingsManager.isBranchTintOn()).toBe(false);
    });

    it('migration: branch colours on → arc, off → no shape without the tint', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ branchColors: true }));
        restart();
        expect(SettingsManager.getBranchMarker()).toBe('arc');
        store.set(SETTINGS_KEY, JSON.stringify({ branchColors: false }));
        restart();
        expect(SettingsManager.getBranchMarker()).toBe('none');
        expect(SettingsManager.isBranchTintOn()).toBe(false);
        expect(SettingsManager.isBranchMarkingOn()).toBe(false);
    });

    it('the "off" stored by 3.30.0-beta.6 reads as no shape and is written as such', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ branchMarker: 'off', branchTint: true }));
        restart();
        expect(SettingsManager.getBranchMarker()).toBe('none');
        expect(SettingsManager.isBranchTintOn()).toBe(true);
        SettingsManager.setGenLabels(false);   // any other setting
        expect(stored().branchMarker).toBe('none');
    });

    it('the migration is not written at start; the first write of any setting stores it', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ branchColors: false }));
        restart();
        expect(stored()).toEqual({ branchColors: false });
        SettingsManager.setGenLabels(false);   // any other setting
        expect(stored().branchMarker).toBe('none');
        expect('branchColors' in stored()).toBe(false);
        restart();
        expect(SettingsManager.getBranchMarker()).toBe('none');
    });

    it('a chosen shape wins over the old flag and removes it', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ branchColors: false }));
        restart();
        SettingsManager.setBranchMarker('corner');
        expect(stored().branchMarker).toBe('corner');
        expect('branchColors' in stored()).toBe(false);
        restart();
        expect(SettingsManager.getBranchMarker()).toBe('corner');
    });

    it('an unknown stored shape falls back to the old flag, then the arc', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ branchMarker: 'wave', branchColors: false }));
        restart();
        expect(SettingsManager.getBranchMarker()).toBe('none');
        store.set(SETTINGS_KEY, JSON.stringify({ branchMarker: 'wave' }));
        restart();
        expect(SettingsManager.getBranchMarker()).toBe('arc');
    });

    it('the tint stands alone: no shape + tint is still a marking, no shape alone is none', () => {
        SettingsManager.setBranchTint(true);
        expect(SettingsManager.isBranchTintOn()).toBe(true);
        SettingsManager.setBranchMarker('none');
        expect(SettingsManager.isBranchTintOn()).toBe(true);
        expect(SettingsManager.isBranchMarkingOn()).toBe(true);
        SettingsManager.setBranchTint(false);
        expect(SettingsManager.isBranchMarkingOn()).toBe(false);
        SettingsManager.setBranchTint(true);
        SettingsManager.setBranchMarker('stripe');
        expect(SettingsManager.isBranchTintOn()).toBe(true);
        restart();
        expect(SettingsManager.isBranchTintOn()).toBe(true);
    });
});
