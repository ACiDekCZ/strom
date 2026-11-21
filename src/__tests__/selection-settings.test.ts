/**
 * The selection of people remembered per tree (spec 098 §7): the family line
 * remembered before (`rodByTree`) becomes the tree's selection
 * (`selectionByTree`), stored once by the main window; a window that only
 * reads the settings writes nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager, migrateRodByTree } from '../settings.js';
import { SETTINGS_KEY, type AppSettings } from '../types.js';
import type { RodId } from '../lineage.js';

const rod = (id: string) => id as RodId;

let store: Map<string, string>;
let writes: string[];

beforeEach(() => {
    store = new Map<string, string>();
    writes = [];
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { writes.push(k); store.set(k, v); },
        removeItem: (k: string) => { writes.push(k); store.delete(k); },
    });
    vi.stubGlobal('window', {
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        addEventListener: () => {},
        removeEventListener: () => {},
    });
    vi.stubGlobal('document', { documentElement: { setAttribute: () => {}, lang: '' } });
});
afterEach(() => {
    SettingsManager.setReadOnly(false);
    vi.unstubAllGlobals();
});

describe('migrateRodByTree', () => {
    it('a family line per tree becomes a line selection, Hide others off; rodByTree goes', () => {
        const s = { rodByTree: { t1: 'rod_a', t2: 'rod_b' } } as unknown as AppSettings;
        expect(migrateRodByTree(s)).toBe(true);
        expect(s.rodByTree).toBeUndefined();
        expect(s.selectionByTree).toEqual({
            t1: { ref: { kind: 'rod', rodId: 'rod_a' }, hideOthers: false },
            t2: { ref: { kind: 'rod', rodId: 'rod_b' }, hideOthers: false },
        });
    });

    it('a selection already stored for the tree wins; empty or broken entries are dropped', () => {
        const kept = { ref: { kind: 'list', listId: 'l1' }, hideOthers: true };
        const s = {
            rodByTree: { t1: 'rod_a', t2: '', t3: 7 },
            selectionByTree: { t1: kept },
        } as unknown as AppSettings;
        expect(migrateRodByTree(s)).toBe(true);
        expect(s.rodByTree).toBeUndefined();
        expect(s.selectionByTree).toEqual({ t1: kept });
    });

    it('nothing to move: nothing changes', () => {
        const s = { selectionByTree: {} } as unknown as AppSettings;
        expect(migrateRodByTree(s)).toBe(false);
        expect(s).toEqual({ selectionByTree: {} });
    });
});

describe('the selection remembered per tree', () => {
    it('the main window moves the old family line once and stores it', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ rodByTree: { t1: 'rod_a' } }));
        SettingsManager.init();
        expect(SettingsManager.getSelectionForTree('t1')).toEqual({ ref: { kind: 'rod', rodId: 'rod_a' }, hideOthers: false });
        const saved = JSON.parse(store.get(SETTINGS_KEY)!);
        expect(saved.rodByTree).toBeUndefined();
        expect(saved.selectionByTree.t1.ref).toEqual({ kind: 'rod', rodId: 'rod_a' });

        // Stored only when it changed.
        writes = [];
        SettingsManager.setSelectionForTree('t1', { ref: { kind: 'rod', rodId: rod('rod_a') }, hideOthers: false });
        expect(writes).toEqual([]);
        SettingsManager.setSelectionForTree('t1', { ref: { kind: 'rod', rodId: rod('rod_a') }, hideOthers: true });
        expect(writes).toEqual([SETTINGS_KEY]);
        SettingsManager.setSelectionForTree('t1', null);
        expect(SettingsManager.getSelectionForTree('t1')).toBeNull();
    });

    it('a read-only window reads the old family line as the selection but writes nothing', () => {
        const before = JSON.stringify({ rodByTree: { t1: 'rod_a' } });
        store.set(SETTINGS_KEY, before);
        SettingsManager.setReadOnly(true);
        SettingsManager.init();
        expect(SettingsManager.getSelectionForTree('t1')).toEqual({ ref: { kind: 'rod', rodId: 'rod_a' }, hideOthers: false });
        SettingsManager.setSelectionForTree('t1', { ref: { kind: 'rod', rodId: rod('rod_b') }, hideOthers: true });
        SettingsManager.setMapScopeForTree('t1', 'tree');
        expect(writes).toEqual([]);
        expect(store.get(SETTINGS_KEY)).toBe(before);
    });

    it('a broken stored ref reads as no selection; the map scope is checked too', () => {
        store.set(SETTINGS_KEY, JSON.stringify({
            selectionByTree: { t1: { ref: { kind: 'nonsense' } } },
            mapScopeByTree: { t1: 'sel', t2: 'everything' },
        }));
        SettingsManager.init();
        expect(SettingsManager.getSelectionForTree('t1')).toBeNull();
        expect(SettingsManager.getMapScopeForTree('t1')).toBe('sel');
        expect(SettingsManager.getMapScopeForTree('t2')).toBeNull();
    });
});
