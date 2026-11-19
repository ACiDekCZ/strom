/**
 * A tree an older app stored (data v21–v23, 3.29) is read as it is and moved
 * to this data version in memory (v24: its attachments become the tree's
 * files); the first write stamps the new version. That first write takes the
 * backup "Before the data update of a new version" (pre-migration) with the
 * state as stored, once per tree and version step; a tree only opened gets
 * none, an empty tree none (verification of 3.30.0, finding N1).
 *
 * StorageManager is replaced by an in-memory, per-store Map (no IndexedDB in
 * the node test env); the snapshots module is the real one. All data is
 * invented.
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
            const v = st(store).get(key);
            return v === undefined ? null : structuredClone(v) as T;
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
import { CryptoSession } from '../crypto.js';
import { listSnapshots, getSnapshotJson } from '../snapshots.js';
import { StromData, TreeId, TreeMetadata, STROM_DATA_VERSION } from '../types.js';

const T1 = 't1' as TreeId;
const T2 = 't2' as TreeId;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';

/** A tree as 3.29 stored it: data v21, an attachment on a person (before v24's files). */
function v21Tree(): StromData {
    return {
        version: 21,
        persons: {
            p0: {
                id: 'p0', firstName: 'Wendelína', lastName: 'Kvítková', gender: 'female', partnerships: [], parentIds: [], childIds: [],
                attachments: [{ id: 'att1', name: 'Křestní list', mimeType: 'image/png', dataUrl: PNG, sizeBytes: 70 }],
            },
        },
        partnerships: {},
    } as unknown as StromData;
}

function currentTree(): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: { q0: { id: 'q0', firstName: 'Bohuslav', lastName: 'Mlčoch', gender: 'male', partnerships: [], parentIds: [], childIds: [] } },
        partnerships: {},
    } as unknown as StromData;
}

function meta(id: string, name: string): TreeMetadata {
    return {
        id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 0, partnershipCount: 0, sizeBytes: 0,
    };
}

async function preMigrationBackups(id: TreeId) {
    return (await listSnapshots(id)).filter(m => m.reason === 'pre-migration');
}

async function editAndSave(): Promise<void> {
    DataManager.createPerson({ firstName: 'Radegunda', lastName: 'Kvítková', gender: 'female' });
    await TreeManager.flush();
}

beforeEach(() => {
    stores.clear();
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    vi.stubGlobal('window', new EventTarget());
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        preMigrationStates: Map<TreeId, unknown>;
    };
    tm.index = { version: 1, activeTreeId: T1, trees: [meta('t1', 'Current'), meta('t2', 'Of 3.29')] };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    tm.preMigrationStates = new Map();
    st('trees').set('t1', currentTree());
});

afterEach(() => {
    CryptoSession.lock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a tree of an older data version, written here for the first time', () => {
    it('opened and edited: one pre-migration backup with the stored v21 state, the tree saved as v24', async () => {
        const stored = v21Tree();
        st('trees').set('t2', structuredClone(stored));
        expect(await DataManager.switchTree(T2)).toBe(true);
        await editAndSave();

        const backups = await preMigrationBackups(T2);
        expect(backups).toHaveLength(1);
        expect(JSON.parse((await getSnapshotJson(backups[0].id))!)).toEqual(stored);
        const saved = st('trees').get('t2') as StromData;
        expect(saved.version).toBe(STROM_DATA_VERSION);
        expect(Object.keys(saved.persons)).toHaveLength(2);
    });

    it('only once: further edits and opening it again take no other backup', async () => {
        st('trees').set('t2', v21Tree());
        expect(await DataManager.switchTree(T2)).toBe(true);
        await editAndSave();
        await editAndSave();
        expect(await DataManager.switchTree(T1)).toBe(true);
        expect(await DataManager.switchTree(T2)).toBe(true);
        await editAndSave();
        expect(await preMigrationBackups(T2)).toHaveLength(1);
    });

    it('only opened, not written: no backup (the stored data stay v21)', async () => {
        st('trees').set('t2', v21Tree());
        expect(await DataManager.switchTree(T2)).toBe(true);
        await TreeManager.flush();
        expect(await DataManager.switchTree(T1)).toBe(true);
        await TreeManager.flush();
        expect((st('trees').get('t2') as StromData).version).toBe(21);
        expect(await preMigrationBackups(T2)).toHaveLength(0);
    });

    it('encrypted profile: the backup is encrypted too and holds the stored v21 state', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
        await CryptoSession.unlock('backup-password-1');
        const stored = v21Tree();
        st('trees').set('t2', await CryptoSession.encrypt(JSON.stringify(stored)));
        expect(await DataManager.switchTree(T2)).toBe(true);
        await editAndSave();

        const backups = await preMigrationBackups(T2);
        expect(backups).toHaveLength(1);
        const record = st('snapshots').get(backups[0].id) as { encrypted?: unknown; plain?: string; gzip?: string };
        expect(record.encrypted).toBeDefined();
        expect(record.plain ?? record.gzip).toBeUndefined();
        expect(JSON.parse((await getSnapshotJson(backups[0].id))!)).toEqual(stored);
    });

    it('a tree of this data version takes no pre-migration backup', async () => {
        st('trees').set('t2', currentTree());
        expect(await DataManager.switchTree(T2)).toBe(true);
        await editAndSave();
        expect(await preMigrationBackups(T2)).toHaveLength(0);
    });

    it('an empty tree of an older version takes none', async () => {
        st('trees').set('t2', { version: 21, persons: {}, partnerships: {} });
        expect(await DataManager.switchTree(T2)).toBe(true);
        await editAndSave();
        expect(await preMigrationBackups(T2)).toHaveLength(0);
    });
});
