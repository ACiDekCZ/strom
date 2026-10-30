/**
 * A tree stored by a newer app (data version above STROM_DATA_VERSION),
 * opened by switching or reloading after the start: the app announces it
 * (strom:newer-data), so the UI can say some details may not show and a
 * change here can lose them (prod 3.17 N1 — the startup check covers only
 * the tree opened first). A tree of this version or older says nothing.
 *
 * StorageManager is replaced by an in-memory, per-store Map (no IndexedDB in
 * the node test env). All data is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Stores = Map<string, Map<string, unknown>>;
const stores: Stores = new Map();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return (st(store).get(key) as T) ?? null;
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            st(store).set(key, structuredClone(value));
            return Promise.resolve();
        },
        async delete(store: string, key: string): Promise<void> {
            st(store).delete(key);
        },
        async keys(store: string): Promise<string[]> {
            return [...st(store).keys()];
        },
        async getAll<T>(store: string): Promise<T[]> {
            return [...st(store).values()] as T[];
        },
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { StromData, TreeId, TreeMetadata, STROM_DATA_VERSION } from '../types.js';

const events: Array<{ treeId?: string; dataVersion?: number }> = [];

function tree(version: number): StromData {
    return {
        version,
        persons: { p0: { id: 'p0', firstName: 'Wendelína', lastName: 'Kvítková', gender: 'female', partnerships: [], parentIds: [], childIds: [] } },
        partnerships: {},
    } as unknown as StromData;
}

function meta(id: string, name: string): TreeMetadata {
    return {
        id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 0, partnershipCount: 0, sizeBytes: 0,
    };
}

beforeEach(() => {
    stores.clear();
    events.length = 0;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    const target = new EventTarget();
    target.addEventListener('strom:newer-data', (e) => events.push((e as CustomEvent).detail));
    vi.stubGlobal('window', target);
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
    };
    tm.index = { version: 1, activeTreeId: 't1' as TreeId, trees: [meta('t1', 'Current'), meta('t2', 'Newer')] };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a tree saved by a newer app, opened after the start', () => {
    it('switching to it or reloading it announces the newer data version', async () => {
        st('trees').set('t1', tree(STROM_DATA_VERSION));
        st('trees').set('t2', tree(STROM_DATA_VERSION + 1));
        expect(await DataManager.switchTree('t2' as TreeId)).toBe(true);
        expect(events).toEqual([{ treeId: 't2', dataVersion: STROM_DATA_VERSION + 1 }]);
        events.length = 0;
        await DataManager.reloadCurrentTree();
        expect(events).toEqual([{ treeId: 't2', dataVersion: STROM_DATA_VERSION + 1 }]);
    });

    it('a tree of this version or an older one says nothing', async () => {
        st('trees').set('t1', tree(STROM_DATA_VERSION + 1));
        st('trees').set('t2', tree(STROM_DATA_VERSION));
        expect(await DataManager.switchTree('t2' as TreeId)).toBe(true);
        st('trees').set('t2', tree(1));
        await DataManager.reloadCurrentTree();
        expect(events).toEqual([]);
    });
});
