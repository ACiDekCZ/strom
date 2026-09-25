/**
 * Stored trees keep their images in the image pool (media-pool.ts): the tree
 * record names them, the pool holds each once, shared with other trees and
 * with backups; the cleanup removes only images nothing names.
 *
 * StorageManager is an in-memory, per-store Map; encryption uses the real Web
 * Crypto session. All data is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();
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
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, (st(store).get(k) as T) ?? null]));
        },
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession } from '../crypto.js';
import { createSnapshot, deleteSnapshotsForTree, getSnapshotJson, totalSnapshotBytes } from '../snapshots.js';
import { collectPoolGarbage } from '../media-pool.js';
import { StromData, TreeId, TreeMetadata, STROM_DATA_VERSION } from '../types.js';

let encryptionOn = false;

/** A JPEG-looking data URL of pseudo-random bytes (seeded, repeatable). */
function image(seed: number, n = 3000): string {
    const bytes = new Uint8Array(n);
    let x = seed * 2654435761 >>> 0;
    for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; bytes[i] = x >>> 24; }
    return 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
}

function tree(name: string, images: string[] = []): StromData {
    const d = {
        version: STROM_DATA_VERSION,
        persons: { p0: { id: 'p0', firstName: name, lastName: 'Example', gender: 'female', partnerships: [], parentIds: [], childIds: [] } },
        partnerships: {},
    } as unknown as StromData;
    if (images.length) {
        (d.persons as Record<string, { photo?: string }>).p0.photo = images[0];
        d.sources = { s1: { id: 's1', title: 'Entry', excerpts: images.slice(1).map((url, i) =>
            ({ id: `e${i}`, dataUrl: url, width: 10, height: 10, sizeBytes: 1 })) } } as never;
    }
    return d;
}

function meta(id: string, name: string): TreeMetadata {
    return { id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01', personCount: 0, partnershipCount: 0, sizeBytes: 0 };
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

async function save(id: string, data: StromData): Promise<void> {
    TreeManager.saveTreeData(id as TreeId, data);
    await TreeManager.flush(id as TreeId);
}

async function read(id: string): Promise<StromData> {
    const r = await TreeManager.readTreeData(id as TreeId);
    if (r.status !== 'ok') throw new Error(r.status);
    return r.data;
}

beforeEach(() => {
    stores.clear();
    encryptionOn = false;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockImplementation(() => encryptionOn);
    vi.stubGlobal('window', new EventTarget());
    resetTreeManager([meta('t1', 'One'), meta('t2', 'Two')]);
});

afterEach(() => {
    CryptoSession.lock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('stored trees and the image pool', () => {
    it('a tree without images is stored exactly as before', async () => {
        await save('t1', tree('Anna'));
        expect(st('trees').get('t1')).toEqual(tree('Anna'));
        expect(st('media').size).toBe(0);
    });

    it('a tree with images stores them once in the pool and reads back whole', async () => {
        const d = tree('Anna', [image(1), image(2), image(3)]);
        await save('t1', d);
        const rec = st('trees').get('t1') as { pooled: number; data: StromData; media: Record<string, number> };
        expect(rec.pooled).toBe(1);
        expect(Object.keys(rec.media)).toHaveLength(3);
        // The record holds references, not the pictures.
        expect(JSON.stringify(rec).length).toBeLessThan(3000);
        expect(st('media').size).toBe(3);
        expect(await read('t1')).toEqual(d);
    });

    it('another save writes only the images the pool does not have yet', async () => {
        await save('t1', tree('Anna', [image(1), image(2)]));
        const setSpy = vi.spyOn((await import('../storage.js')).StorageManager, 'set');
        await save('t1', tree('Anna B.', [image(1), image(2), image(3)]));
        expect(setSpy.mock.calls.filter(c => c[0] === 'media')).toHaveLength(1);
        setSpy.mockRestore();
    });

    it('trees and backups share images; the cleanup keeps what anything names', async () => {
        const imgs = [image(1), image(2)];
        await save('t1', tree('Anna', imgs));
        await save('t2', tree('Bea', [image(1)]));
        const snap = await createSnapshot('t1', tree('Anna', imgs), 'manual', 1000);
        expect(st('media').size).toBe(2);

        // The tree drops image 2: the backup still names it.
        await save('t1', tree('Anna', [image(1)]));
        await collectPoolGarbage();
        expect(st('media').size).toBe(2);
        expect(JSON.parse((await getSnapshotJson(snap.id))!)).toEqual(tree('Anna', imgs));

        // Backup gone: image 2 is unused; image 1 stays (both trees name it).
        await deleteSnapshotsForTree('t1');
        expect(st('media').size).toBe(1);
        expect(await read('t2')).toEqual(tree('Bea', [image(1)]));

        // Deleting the trees frees the pool completely.
        await TreeManager.deleteTree('t1' as TreeId);
        await TreeManager.deleteTree('t2' as TreeId);
        await collectPoolGarbage();
        expect(st('media').size).toBe(0);
    });

    it('backups of a tree with images take only their text', async () => {
        const d = tree('Anna', [image(1), image(2)]);
        await save('t1', d);
        const a = await createSnapshot('t1', d, 'manual', 1000);
        const b = await createSnapshot('t1', d, 'manual', 2000);
        expect(await totalSnapshotBytes('t1')).toBe(a.sizeBytes + b.sizeBytes);
    });

    it('encrypted: record and images are ciphertext under keyed ids', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('pool-password');
        const d = tree('Secret Anna', [image(1), image(2)]);
        await save('t1', d);
        const rec = st('trees').get('t1') as { encrypted: unknown; data?: unknown; media: Record<string, number> };
        expect(rec.data).toBeUndefined();
        expect(Object.keys(rec.media).every(id => id.startsWith('e:'))).toBe(true);
        const everything = JSON.stringify([...st('trees').values(), ...st('media').values()]);
        expect(everything).not.toContain('Secret Anna');
        expect(everything).not.toContain(image(1).slice(40, 120));
        expect(await TreeManager.isTreeDataEncrypted('t1' as TreeId)).toBe(true);
        expect(await TreeManager.getEncryptedData('t1' as TreeId)).not.toBeNull();
        expect(await read('t1')).toEqual(d);

        CryptoSession.lock();
        expect((await TreeManager.readTreeData('t1' as TreeId)).status).toBe('locked');
    });

    it('switching encryption off re-saves under plain ids and the old images go', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('pool-password');
        const d = tree('Anna', [image(1)]);
        await save('t1', d);
        encryptionOn = false;
        await save('t1', d);
        await collectPoolGarbage();
        expect([...st('media').keys()].every(id => id.startsWith('p:'))).toBe(true);
        expect(st('media').size).toBe(1);
        expect(await read('t1')).toEqual(d);
    });

    it('a pooled tree under another key is rescued with its password', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('old-password');
        const d = tree('Anna', [image(1)]);
        await save('t1', d);
        CryptoSession.lock();
        await CryptoSession.unlock('new-password');
        expect((await TreeManager.readTreeData('t1' as TreeId)).status).toBe('undecryptable');
        expect(await TreeManager.recoverTreeWithPassword('t1' as TreeId, 'wrong')).toBe('wrong-password');
        expect(await TreeManager.recoverTreeWithPassword('t1' as TreeId, 'old-password')).toBe('ok');
        expect(await read('t1')).toEqual(d);
    });

    it('an old record with the images inline still reads', async () => {
        const d = tree('Anna', [image(1)]);
        st('trees').set('t1', d);
        expect(await read('t1')).toEqual(d);
        // A tree still encrypted whole (before the pool) as well.
        encryptionOn = true;
        await CryptoSession.unlock('pw');
        st('trees').set('t2', await CryptoSession.encrypt(JSON.stringify(d)));
        const r = await TreeManager.readTreeData('t2' as TreeId);
        expect(r.status === 'ok' ? r.data : null).toEqual(d);
    });
});

describe('base64 without the native typed-array methods', () => {
    it('the fallback gives the same text and bytes', async () => {
        const { bytesToBase64, base64ToBytes } = await import('../media-pool.js');
        const bytes = new Uint8Array(100_003);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 0xff;
        const expected = Buffer.from(bytes).toString('base64');
        const proto = Uint8Array.prototype as unknown as { toBase64?: unknown };
        const ctor = Uint8Array as unknown as { fromBase64?: unknown };
        const saved = [proto.toBase64, ctor.fromBase64];
        try {
            delete proto.toBase64;
            delete ctor.fromBase64;
            expect(bytesToBase64(bytes)).toBe(expected);
            expect(base64ToBytes(expected)).toEqual(bytes);
        } finally {
            if (saved[0]) proto.toBase64 = saved[0];
            if (saved[1]) ctor.fromBase64 = saved[1];
        }
        expect(bytesToBase64(bytes)).toBe(expected);
    });
});
