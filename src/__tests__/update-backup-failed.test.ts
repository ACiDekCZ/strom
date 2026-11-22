/**
 * Without the backup a stored tree is not updated (Milan, 19 Nov 2026): when
 * the backup "Before the data update of a new version" cannot be written
 * (here: the storage refuses the backup, as when it is full), reading a tree
 * an older app stored (v18 with sources made only for another QUAY, v19)
 * returns it as stored, saves nothing, and says so once per read; its first
 * write here is not stored without that backup either. With the backup
 * working again, the next read backs it up, updates and saves it.
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
/** The storage refuses backups (full). */
let backupsFail = false;

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            const v = st(store).get(key);
            return v === undefined ? null : structuredClone(v) as T;
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            if (store === 'snapshots' && backupsFail) return Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'));
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

import { TreeManager, UPDATE_BACKUP_FAILED_EVENT } from '../tree-manager.js';
import { migrateData } from '../data.js';
import { SettingsManager } from '../settings.js';
import { listSnapshots, getSnapshotJson } from '../snapshots.js';
import { qualityOnlySources } from '../citation-quality.js';
import { PersonId, StromData, TreeId, TreeMetadata } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const T1 = 'kvapilik' as TreeId;

/** A tree an older app stored: the same census entry made twice, once only for another QUAY. */
function storedTree(version: 18 | 19): StromData {
    const entry = { title: 'Sčítání lidu 1921, Pětikostelec', reference: 'č. d. 12', importId: 'imp-pet' };
    return {
        version,
        persons: {
            p0: {
                id: 'p0', firstName: 'Zbyhněv', lastName: 'Kvapilík', gender: 'male', partnerships: [], parentIds: [], childIds: [],
                birthSourceIds: ['s1~1'],
            },
            p1: {
                id: 'p1', firstName: 'Zbyhněva', lastName: 'Kvapilíková', gender: 'female', partnerships: [], parentIds: [], childIds: [],
                birthSourceIds: ['s1'],
            },
        },
        partnerships: {},
        sources: {
            s1: { id: 's1', ...entry, quality: 3 },
            's1~1': { id: 's1~1', ...entry, quality: 1 },
        },
    } as unknown as StromData;
}

function meta(id: string, name: string, dataVersion: number): TreeMetadata {
    return {
        id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 0, partnershipCount: 0, sizeBytes: 0, dataVersion,
    };
}

async function preMigrationBackups(id: TreeId) {
    return (await listSnapshots(id)).filter(m => m.reason === 'pre-migration');
}

let notices: string[];
let saveFailures: number;

function setUp(version: 18 | 19): StromData {
    const stored = storedTree(version);
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        preMigrationStates: Map<TreeId, unknown>; pendingSaves: Map<TreeId, unknown>; unsettledSaves: Map<TreeId, unknown>;
    };
    tm.index = { version: 1, activeTreeId: T1, trees: [meta(T1, 'Kvapilíkovi z Pětikostelce', version)] };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    tm.preMigrationStates = new Map();
    tm.pendingSaves = new Map();
    tm.unsettledSaves = new Map();
    st('trees').set(T1, structuredClone(stored));
    return stored;
}

beforeEach(() => {
    stores.clear();
    backupsFail = false;
    notices = [];
    saveFailures = 0;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const win = new EventTarget();
    win.addEventListener(UPDATE_BACKUP_FAILED_EVENT, e => notices.push((e as CustomEvent<{ treeId: string }>).detail.treeId));
    win.addEventListener('strom:save-failed', () => { saveFailures++; });
    vi.stubGlobal('window', win);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the backup before the data update fails: the stored tree is not updated', () => {
    for (const version of [18, 19] as const) {
        it(`v${version}: read as stored, nothing saved, one notice per read; read again with the backup working: updated and saved`, async () => {
            const stored = setUp(version);
            expect(qualityOnlySources(stored.sources).size).toBe(1);
            backupsFail = true;

            const first = await TreeManager.readTreeData(T1);
            if (first.status !== 'ok') throw new Error(first.status);
            await TreeManager.flush();
            // As read: the source made only for another QUAY is still there.
            expect(first.data).toEqual(stored);
            expect(st('trees').get(T1)).toEqual(stored);
            expect(await preMigrationBackups(T1)).toHaveLength(0);
            expect(notices).toEqual([T1]);

            // Another read tries again (backup first) and says it again.
            await TreeManager.readTreeData(T1);
            await TreeManager.flush();
            expect(st('trees').get(T1)).toEqual(stored);
            expect(notices).toEqual([T1, T1]);

            backupsFail = false;
            const next = await TreeManager.readTreeData(T1);
            if (next.status !== 'ok') throw new Error(next.status);
            await TreeManager.flush();
            const backups = await preMigrationBackups(T1);
            expect(backups).toHaveLength(1);
            expect(JSON.parse((await getSnapshotJson(backups[0].id))!)).toEqual(stored);
            const saved = st('trees').get(T1) as StromData;
            expect(saved.version).toBe(STROM_DATA_VERSION);
            if (version < 19) expect(saved.sources?.['s1~1']).toBeUndefined();
            expect(notices).toHaveLength(2);

            // Written once more: no second backup.
            TreeManager.saveTreeData(T1, next.data);
            await TreeManager.flush();
            expect(await preMigrationBackups(T1)).toHaveLength(1);
        });
    }

    it('the first write after such a read is not stored without the backup; it is once the backup works', async () => {
        const stored = setUp(18);
        backupsFail = true;
        const read = await TreeManager.readTreeData(T1);
        if (read.status !== 'ok') throw new Error(read.status);
        // The open tree in memory (migrateData joins the source there) is edited and saved.
        const open = migrateData(structuredClone(read.data));
        expect(open.sources?.['s1~1']).toBeUndefined();
        open.persons['p0' as PersonId].firstName = 'Zbyhněvek';
        TreeManager.saveTreeData(T1, open);
        await TreeManager.flush();
        expect(st('trees').get(T1)).toEqual(stored);
        expect(saveFailures).toBe(1);

        // Still without the backup: still not stored.
        TreeManager.saveTreeData(T1, open);
        await TreeManager.flush();
        expect(st('trees').get(T1)).toEqual(stored);
        expect(saveFailures).toBe(2);

        backupsFail = false;
        TreeManager.saveTreeData(T1, open);
        await TreeManager.flush();
        const backups = await preMigrationBackups(T1);
        expect(backups).toHaveLength(1);
        expect(JSON.parse((await getSnapshotJson(backups[0].id))!)).toEqual(stored);
        const saved = st('trees').get(T1) as StromData;
        expect(saved.version).toBe(STROM_DATA_VERSION);
        expect(saved.persons['p0' as PersonId].firstName).toBe('Zbyhněvek');
        expect(saveFailures).toBe(2);
    });

    it('automatic backups turned off: the backup before the update is taken all the same', async () => {
        const stored = setUp(18);
        TreeManager.setAutoBackups(T1, false);
        const read = await TreeManager.readTreeData(T1);
        if (read.status !== 'ok') throw new Error(read.status);
        await TreeManager.flush();
        expect(await preMigrationBackups(T1)).toHaveLength(1);
        expect((st('trees').get(T1) as StromData).version).toBe(STROM_DATA_VERSION);
        expect(read.data).not.toEqual(stored);
        expect(notices).toHaveLength(0);
    });
});
