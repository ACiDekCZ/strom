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
            // A copy, like IndexedDB: a reader's change is not the stored record's.
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
import { DataManager, DataLockedError } from '../data.js';
import { SettingsManager } from '../settings.js';
import { StromData, TreeId, TreeMetadata, STROM_DATA_VERSION, LAST_FOCUSED, PersonId } from '../types.js';

const events: Array<{ treeId?: string; dataVersion?: number }> = [];
const refused: string[] = [];

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
    refused.length = 0;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    const target = new EventTarget();
    target.addEventListener('strom:newer-data', (e) => events.push((e as CustomEvent).detail));
    target.addEventListener('strom:save-newer', (e) => refused.push((e as CustomEvent).detail.treeId));
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

/**
 * Milan 30 Oct 2026 ("1a"): such a tree opens READ-ONLY — at the start and
 * when switched to — and its stored record is never written, not by an edit,
 * an import into it, the research, nor a view state or setting.
 */
describe('a tree saved by a newer app is read-only and never written', () => {
    const T1 = 't1' as TreeId;
    const T2 = 't2' as TreeId;

    function newerTree(): StromData {
        const d = tree(STROM_DATA_VERSION + 1);
        // What only the newer app knows, and a view state it keeps.
        (d as unknown as Record<string, unknown>).futureField = { kept: true };
        d.defaultPersonId = LAST_FOCUSED;
        return d;
    }

    async function expectUntouched(stored: StromData): Promise<void> {
        await TreeManager.flush();
        expect(st('trees').get('t2')).toEqual(stored);
    }

    it('switched to: read-only, every write refused, the record stays as the newer app stored it', async () => {
        st('trees').set('t1', tree(STROM_DATA_VERSION));
        const stored = newerTree();
        st('trees').set('t2', structuredClone(stored));
        expect(await DataManager.switchTree(T2)).toBe(true);

        expect(DataManager.isNewerData()).toBe(true);
        expect(DataManager.isReadOnly()).toBe(true);
        expect(DataManager.isTreeLocked()).toBe(true);
        expect(DataManager.isLocked()).toBe(false);   // not the Unlock flow
        expect(TreeManager.isTreeNewer(T2)).toBe(true);

        // Edits and an import into it refuse before anything changes.
        expect(() => DataManager.createPerson({ firstName: 'Intruder', lastName: 'Newer', gender: 'male' }))
            .toThrow(DataLockedError);
        expect(() => DataManager.loadStromData(tree(STROM_DATA_VERSION))).toThrow(DataLockedError);
        expect(DataManager.beginEditSession()).toBe(false);
        expect(DataManager.canUndo()).toBe(false);
        expect(DataManager.getAllPersons()).toHaveLength(1);

        // The research: neither a whole new version nor its marks.
        DataManager.replaceWithSourceData(tree(STROM_DATA_VERSION));
        DataManager.replaceQualityDismissed([{ type: 'x', persons: ['p0'] } as never]);
        expect(DataManager.getData().qualityDismissed).toBeUndefined();

        // View state and settings stored in the tree record.
        DataManager.saveLastFocus('p0' as PersonId, 3, 2);
        DataManager.setDefaultPerson(undefined);
        DataManager.resaveCurrent();
        await TreeManager.setDefaultPerson(T2, 'p0' as PersonId);
        await TreeManager.saveLastFocus(T2, 'p0' as PersonId, 1, 1);

        // A direct save (a path the read-only UI does not close) is refused too, and said.
        TreeManager.saveTreeData(T2, tree(STROM_DATA_VERSION));
        expect(refused).toContain('t2');

        await expectUntouched(stored);
    });

    it('opened at the start: the same read-only state', async () => {
        const stored = newerTree();
        st('trees').set('t2', structuredClone(stored));
        const tm = TreeManager as unknown as { index: { activeTreeId: TreeId | null } };
        tm.index.activeTreeId = T2;
        vi.spyOn(TreeManager, 'getStartupTreeId').mockReturnValue(T2);
        await DataManager.init();

        expect(DataManager.getCurrentTreeId()).toBe(T2);
        expect(DataManager.isNewerData()).toBe(true);
        expect(DataManager.isReadOnly()).toBe(true);
        expect(() => DataManager.createPerson({ firstName: 'Intruder', lastName: 'Newer', gender: 'male' }))
            .toThrow(DataLockedError);
        DataManager.saveLastFocus('p0' as PersonId, 3, 2);
        await expectUntouched(stored);
    });

    it('known from the index before it is read: a write is refused all the same', async () => {
        const stored = newerTree();
        st('trees').set('t2', structuredClone(stored));
        TreeManager.getTreeMetadata(T2)!.dataVersion = STROM_DATA_VERSION + 1;
        TreeManager.updateTreeFromImport(T2, tree(STROM_DATA_VERSION));
        expect(refused).toEqual(['t2']);
        await expectUntouched(stored);
    });

    it('a tree of this version, back again: editable and saved, its version recorded', async () => {
        st('trees').set('t1', tree(STROM_DATA_VERSION));
        st('trees').set('t2', newerTree());
        expect(await DataManager.switchTree(T2)).toBe(true);
        expect(await DataManager.switchTree(T1)).toBe(true);
        expect(DataManager.isNewerData()).toBe(false);
        expect(DataManager.isReadOnly()).toBe(false);
        DataManager.createPerson({ firstName: 'Bertold', lastName: 'Kvítek', gender: 'male' });
        await TreeManager.flush();
        expect(Object.keys((st('trees').get('t1') as StromData).persons)).toHaveLength(2);
        expect(TreeManager.getTreeMetadata(T1)!.dataVersion).toBe(STROM_DATA_VERSION);
    });

    it('a copy of it keeps the newer version (read-only too); re-encoding writes it as stored', async () => {
        const stored = newerTree();
        st('trees').set('t2', structuredClone(stored));
        const copy = await TreeManager.duplicateTree(T2, 'Copy');
        await TreeManager.flush();
        expect(copy).not.toBeNull();
        expect(st('trees').get(copy!)).toEqual(stored);
        expect(TreeManager.isTreeNewer(copy!)).toBe(true);

        // What switching encryption on/off does with every tree.
        const data = await TreeManager.getTreeData(T2);
        TreeManager.saveTreeData(T2, data!, { asStored: true });
        await expectUntouched(stored);
        expect(refused).toEqual([]);
    });
});
