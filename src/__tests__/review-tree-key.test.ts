/**
 * K8 remainder: a tree encrypted with a different key than the session is
 * rescued with its own password and re-encrypted with the session key.
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
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession, encrypt, decrypt, isEncrypted, EncryptedData } from '../crypto.js';
import { StromData, TreeId, TreeMetadata } from '../types.js';

let encryptionOn = false;
const events: Array<{ type: string; treeId?: string }> = [];

function tree(names: string[]): StromData {
    const persons: StromData['persons'] = {};
    names.forEach((n, i) => {
        persons[`p${i}` as never] = {
            id: `p${i}`, firstName: n, lastName: 'Example', gender: 'male', partnerships: [],
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

function resetTreeManager(trees: TreeMetadata[] = []): void {
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
    };
    tm.index = { version: 1, activeTreeId: trees[0]?.id ?? null, trees };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
}

beforeEach(() => {
    stores.clear();
    events.length = 0;
    encryptionOn = false;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockImplementation(() => encryptionOn);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    const target = new EventTarget();
    for (const type of ['strom:save-blocked', 'strom:tree-unreadable']) {
        target.addEventListener(type, (e) => events.push({ type, treeId: (e as CustomEvent).detail?.treeId }));
    }
    vi.stubGlobal('window', target);
    resetTreeManager();
});

afterEach(() => {
    CryptoSession.lock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function setupOtherKeyTree(): Promise<EncryptedData> {
    resetTreeManager([meta('t1', 'Current'), meta('t2', 'Older')]);
    const cipher = await encrypt(JSON.stringify(tree(['Anna', 'Bert'])), 'old-password');
    st('trees').set('t2', cipher);
    encryptionOn = true;
    await CryptoSession.unlock('new-password');
    return cipher;
}

describe('K8 tree encrypted with another key', () => {
    it('a wrong password changes nothing and the tree stays blocked', async () => {
        const cipher = await setupOtherKeyTree();
        expect((await TreeManager.readTreeData('t2' as TreeId)).status).toBe('undecryptable');

        expect(await TreeManager.recoverTreeWithPassword('t2' as TreeId, 'guess')).toBe('wrong-password');
        expect(st('trees').get('t2')).toEqual(cipher);
        expect(TreeManager.isTreeUnreadable('t2' as TreeId)).toBe(true);

        TreeManager.saveTreeData('t2' as TreeId, tree([]));
        await TreeManager.flush('t2' as TreeId);
        expect(st('trees').get('t2')).toEqual(cipher);
        expect(events.map(e => e.type)).toContain('strom:save-blocked');
    });

    it('the right password re-encrypts the tree with the session key', async () => {
        await setupOtherKeyTree();
        await TreeManager.readTreeData('t2' as TreeId);

        expect(await TreeManager.recoverTreeWithPassword('t2' as TreeId, 'old-password')).toBe('ok');
        expect(TreeManager.isTreeUnreadable('t2' as TreeId)).toBe(false);

        const stored = st('trees').get('t2');
        expect(isEncrypted(stored)).toBe(true);
        // Now the SESSION key opens it; the old password no longer does.
        const plain = JSON.parse(await CryptoSession.decrypt(stored as EncryptedData)) as StromData;
        expect(Object.values(plain.persons).map(p => p.firstName)).toEqual(['Anna', 'Bert']);
        expect(JSON.parse(await decrypt(stored as EncryptedData, 'new-password')).persons).toBeDefined();
        await expect(decrypt(stored as EncryptedData, 'old-password')).rejects.toThrow();

        const read = await TreeManager.readTreeData('t2' as TreeId);
        expect(read.status).toBe('ok');
        const meta2 = TreeManager.getTrees().find(t => t.id === 't2');
        expect(meta2?.personCount).toBe(2);

        // Saving works again.
        TreeManager.saveTreeData('t2' as TreeId, tree(['Anna', 'Bert', 'Cyril']));
        await TreeManager.flush('t2' as TreeId);
        const saved = JSON.parse(await CryptoSession.decrypt(st('trees').get('t2') as EncryptedData)) as StromData;
        expect(Object.keys(saved.persons)).toHaveLength(3);
        expect(events.map(e => e.type)).not.toContain('strom:save-blocked');
    });

    it('a locked session is reported, not treated as a wrong password', async () => {
        resetTreeManager([meta('t2', 'Older')]);
        st('trees').set('t2', await encrypt(JSON.stringify(tree(['Anna'])), 'old-password'));
        encryptionOn = true;
        expect(await TreeManager.recoverTreeWithPassword('t2' as TreeId, 'old-password')).toBe('locked');
    });

    it('a readable tree needs no rescue', async () => {
        resetTreeManager([meta('t1', 'Plain')]);
        st('trees').set('t1', tree(['Anna']));
        await CryptoSession.unlock('new-password');
        expect(await TreeManager.recoverTreeWithPassword('t1' as TreeId, 'anything')).toBe('ok');
        expect(st('trees').get('t1')).toEqual(tree(['Anna']));
        expect(await TreeManager.recoverTreeWithPassword('nope' as TreeId, 'x')).toBe('missing');
    });

    it('switching to / reloading such a tree announces it as unreadable', async () => {
        await setupOtherKeyTree();
        st('trees').set('t1', await CryptoSession.encrypt(JSON.stringify(tree(['Dana']))));
        expect(await DataManager.switchTree('t2' as TreeId)).toBe(true);
        expect(events).toContainEqual({ type: 'strom:tree-unreadable', treeId: 't2' });

        events.length = 0;
        await DataManager.reloadCurrentTree();
        expect(events).toContainEqual({ type: 'strom:tree-unreadable', treeId: 't2' });

        // After the rescue the reload loads the family.
        await TreeManager.recoverTreeWithPassword('t2' as TreeId, 'old-password');
        events.length = 0;
        await DataManager.reloadCurrentTree();
        expect(events).toEqual([]);
        expect(Object.keys(DataManager.getData().persons)).toHaveLength(2);
    });
});
