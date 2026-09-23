/**
 * Locked local data is read-only: while the open tree is an unreadable
 * stand-in (session locked / other key), the data layer refuses mutations
 * before anything changes and never tries to save (no save-blocked spam).
 * After unlocking, editing works again without a reload.
 *
 * StorageManager is replaced by an in-memory, per-store Map (no IndexedDB in
 * the node test env); encryption uses the real Web Crypto session. All data
 * is invented.
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
import { DataManager, DataLockedError } from '../data.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession, isEncrypted, EncryptedData } from '../crypto.js';
import { StromData, TreeId, TreeMetadata, LAST_FOCUSED } from '../types.js';

const PASSWORD = 'correct horse battery';
const T1 = 't1' as TreeId;
const events: string[] = [];

function tree(names: string[]): StromData {
    const persons: StromData['persons'] = {};
    names.forEach((n, i) => {
        persons[`p${i}` as never] = {
            id: `p${i}`, firstName: n, lastName: 'Example', gender: 'female', partnerships: [],
            parentIds: [], childIds: [],
        } as never;
    });
    return { version: 1, persons, partnerships: {} } as StromData;
}

function meta(id: string, name: string): TreeMetadata {
    return {
        id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 0, partnershipCount: 0, sizeBytes: 0,
    };
}

function resetTreeManager(trees: TreeMetadata[]): void {
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
    };
    tm.index = { version: 1, activeTreeId: trees[0]?.id ?? null, trees };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
}

/** An encrypted tree on disk and a LOCKED session (startup prompt cancelled). */
async function setupLockedTree(): Promise<EncryptedData> {
    resetTreeManager([meta('t1', 'Family')]);
    await CryptoSession.unlock(PASSWORD);
    const cipher = await CryptoSession.encrypt(JSON.stringify(tree(['Anna', 'Bert'])));
    CryptoSession.lock();
    st('trees').set('t1', cipher);
    expect(await DataManager.switchTree(T1)).toBe(true);
    return cipher;
}

beforeEach(() => {
    stores.clear();
    events.length = 0;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    const target = new EventTarget();
    for (const type of ['strom:save-blocked', 'strom:save-failed']) {
        target.addEventListener(type, () => events.push(type));
    }
    vi.stubGlobal('window', target);
});

afterEach(() => {
    CryptoSession.lock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('locked local data is read-only', () => {
    it('reports the locked state and refuses every kind of mutation silently', async () => {
        const cipher = await setupLockedTree();
        expect(DataManager.isLocked()).toBe(true);
        expect(DataManager.isReadOnly()).toBe(true);
        expect(DataManager.isViewMode()).toBe(false);

        // The mutation entry point refuses before touching the stand-in.
        expect(() => DataManager.createPerson({ firstName: 'Intruder', lastName: 'Locked', gender: 'male' }))
            .toThrow(DataLockedError);
        expect(() => DataManager.addSurnameGroup(['Novak', 'Nowak'])).toThrow(DataLockedError);
        expect(DataManager.getAllPersons()).toHaveLength(0);
        expect(DataManager.getData().surnameVariants).toBeUndefined();

        // Flows with their own refusal value say no without throwing.
        expect(DataManager.beginEditSession()).toBe(false);
        expect(DataManager.canUndo()).toBe(false);
        expect(DataManager.undo()).toBeNull();
        expect(DataManager.redo()).toBeNull();
        expect(DataManager.runBatch('x', () => 1)).toBe(1);
        DataManager.setDefaultPerson(LAST_FOCUSED);
        expect(DataManager.getData().defaultPersonId).toBeUndefined();

        // Nothing was even attempted: the ciphertext is untouched and no
        // save-blocked / save-failed event (= toast) was raised.
        await TreeManager.flush(T1);
        expect(st('trees').get('t1')).toEqual(cipher);
        expect(events).toEqual([]);
    });

    it('unlocking restores normal editing without a reload', async () => {
        const cipher = await setupLockedTree();
        // The unlock prompt re-derives the key from the stored record's salt.
        await CryptoSession.unlock(PASSWORD, new Uint8Array(Buffer.from(cipher.salt, 'base64')));
        await DataManager.reloadCurrentTree();

        expect(DataManager.isLocked()).toBe(false);
        expect(DataManager.isReadOnly()).toBe(false);
        expect(DataManager.getAllPersons().map(p => p.firstName).sort()).toEqual(['Anna', 'Bert']);

        DataManager.createPerson({ firstName: 'Cyril', lastName: 'Example', gender: 'male' });
        expect(DataManager.canUndo()).toBe(true);
        await TreeManager.flush(T1);
        const stored = st('trees').get('t1');
        expect(isEncrypted(stored)).toBe(true);
        const saved = JSON.parse(await CryptoSession.decrypt(stored as EncryptedData)) as StromData;
        expect(Object.values(saved.persons).map(p => p.firstName).sort()).toEqual(['Anna', 'Bert', 'Cyril']);
        expect(events).toEqual([]);
    });
});
