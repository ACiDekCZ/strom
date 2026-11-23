/**
 * The tree in memory holds pooled images as references (spec 135, D6): a
 * tree read from storage keeps them (no long data URL in memory); a new image
 * is a data URL until its save, then every state of the open tree — the data,
 * the undo and redo steps, the state a dialog goes back to — takes its
 * reference; an import, a merge, a restored backup end so too; an encrypted
 * tree holds `e:` references, and switching the encryption moves the
 * references in memory to the other kind; a long text starting with `data:`
 * outside an image's place (a note) stays text.
 *
 * StorageManager is an in-memory, per-store Map; encryption uses the real
 * Web Crypto session. All data is invented.
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
            const v = st(store).get(key);
            return v === undefined ? null : structuredClone(v) as T;
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            st(store).set(key, structuredClone(value));
            return Promise.resolve();
        },
        setTogether(writes: { store: string; key: string; value: unknown }[]): Promise<void> {
            for (const w of writes) st(w.store).set(w.key, structuredClone(w.value));
            return Promise.resolve();
        },
        async delete(store: string, key: string): Promise<void> {
            st(store).delete(key);
        },
        async keys(store: string): Promise<string[]> {
            return [...st(store).keys()];
        },
        async getAll<T>(store: string): Promise<T[]> {
            return [...st(store).values()].map(v => structuredClone(v)) as T[];
        },
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, st(store).has(k) ? structuredClone(st(store).get(k)) as T : null]));
        },
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession } from '../crypto.js';
import { createSnapshot, getSnapshotJson, listSnapshots } from '../snapshots.js';
import { reencodeSideStores } from '../encryption-migrate.js';
import { expandedData } from '../image-expand.js';
import { executeMerge } from '../merge/executor.js';
import { POOL_REF, poolIdOf } from '../image-ref.js';
import { clearImageMeta, imageMetaOf } from '../image-meta.js';
import { UndoManager } from '../undo.js';
import { openPhotoModel, setModelPhoto } from '../ui/person-photo-model.js';
import type { MergeState } from '../merge/types.js';
import { StromData, TreeId, TreeMetadata, PersonId } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const T1 = 't1' as TreeId;
const T2 = 't2' as TreeId;
const P0 = 'p0' as PersonId;

let encryptionOn = false;

/** A PNG-looking data URL of pseudo-random bytes (seeded, repeatable; over 1 kB, so the pool takes it). */
function image(seed: number, n = 2400): string {
    const bytes = new Uint8Array(n);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let x = seed * 2654435761 >>> 0;
    for (let i = 8; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; bytes[i] = x >>> 24; }
    return 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
}

/** A note as long as an image, starting like one: text, never an image. */
const DATA_NOTE = 'data:' + 'Zápis z matriky, opsaný celý. '.repeat(60);

function tree(photo?: string, extra: Partial<StromData> = {}): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: {
            p0: {
                id: 'p0', firstName: 'Zbyňka', lastName: 'Pertlová', gender: 'female', partnerships: [], parentIds: [], childIds: [],
                ...(photo ? { photo } : {}),
            },
        },
        partnerships: {},
        ...extra,
    } as unknown as StromData;
}

function meta(id: string, name: string): TreeMetadata {
    return { id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01', personCount: 0, partnershipCount: 0, sizeBytes: 0 };
}

/** Every long data URL in the value (an image held whole). */
function longDataUrls(value: unknown): string[] {
    return JSON.stringify(value).match(/"data:image[^"]{1000,}"/g) ?? [];
}

function photo(): string | undefined {
    return DataManager.getData().persons[P0]?.photo;
}

/** A reference, and the image it stands for. */
async function expectRef(value: string | undefined, url: string, kind: 'p:' | 'e:' = 'p:'): Promise<void> {
    const id = poolIdOf(value);
    expect(id).not.toBeNull();
    expect(id!.startsWith(kind)).toBe(true);
    expect((await expandedData({ v: value })).v).toBe(url);
}

/** Store a tree through the app (pooled) without opening it. */
async function store(id: TreeId, data: StromData): Promise<void> {
    TreeManager.saveTreeData(id, data);
    await TreeManager.flush(id);
}

beforeEach(() => {
    stores.clear();
    clearImageMeta();
    encryptionOn = false;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockImplementation(() => encryptionOn);
    vi.spyOn(SettingsManager, 'setEncryption').mockImplementation((on: boolean) => { encryptionOn = on; });
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    vi.stubGlobal('window', new EventTarget());
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        preMigrationStates: Map<TreeId, unknown>;
    };
    tm.index = { version: 1, activeTreeId: T1, trees: [meta('t1', 'One'), meta('t2', 'Two')] };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    tm.preMigrationStates = new Map();
    st('trees').set('t1', tree());
});

afterEach(async () => {
    await TreeManager.flush();
    UndoManager.setActiveTree(null);
    CryptoSession.lock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the tree in memory holds its pooled images as references', () => {
    it('a stored tree opens with references only, each standing for its image', async () => {
        const a = image(1), b = image(2);
        const d = tree(a, { media: { m1: { id: 'm1', name: 'Scan', mimeType: 'image/png', dataUrl: b, sizeBytes: 1, places: [{ personId: 'p0' }] } } } as never);
        await store(T2, d);
        expect(await DataManager.switchTree(T2)).toBe(true);
        expect(longDataUrls(DataManager.getData())).toEqual([]);
        await expectRef(photo(), a);
        await expectRef(DataManager.getData().media?.m1?.dataUrl, b);
        // Sizes and fingerprints answer from the catalog, as from the data URL.
        expect(imageMetaOf(photo()!)?.len).toBe(a.length);
    });

    it('a new photo becomes a reference once saved, in the data and in the undo and redo steps; going back gives the right image', async () => {
        const a = image(1), b = image(2), c = image(3);
        await store(T2, tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        DataManager.updatePerson(P0, { photo: b });
        expect(photo()).toBe(b);            // until its save lands
        await TreeManager.flush();
        DataManager.updatePerson(P0, { photo: c });
        await TreeManager.flush();
        await expectRef(photo(), c);
        // The undo step before the last edit held b whole: it holds its reference now.
        DataManager.undo();
        await expectRef(photo(), b);
        DataManager.undo();
        await expectRef(photo(), a);
        DataManager.redo();
        await expectRef(photo(), b);
        DataManager.redo();
        await expectRef(photo(), c);
        expect(longDataUrls(DataManager.getData())).toEqual([]);
        // The stored record names each image once; the pool holds the three.
        expect(st('media').size).toBe(3);
    });

    it('an image of an edit whose save another one took over is stored when it is the tree again', async () => {
        const a = image(1), b = image(2), c = image(3);
        await store(T2, tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        DataManager.updatePerson(P0, { photo: b });
        DataManager.updatePerson(P0, { photo: c });   // b's save waits and takes c instead
        await TreeManager.flush();
        await expectRef(photo(), c);
        DataManager.undo();
        expect(photo()).toBe(b);
        await TreeManager.flush();
        await expectRef(photo(), b);
    });

    it('the same file added again is found although the tree holds it as a reference', async () => {
        const b = image(13);
        const d = tree(undefined, { media: { m1: { id: 'm1', name: 'Scan', mimeType: 'image/png', dataUrl: b, sizeBytes: 1, places: [{ personId: 'p0' }] } } } as never);
        await store(T2, d);
        expect(await DataManager.switchTree(T2)).toBe(true);
        expect(poolIdOf(DataManager.getData().media?.m1?.dataUrl)).not.toBeNull();
        expect(DataManager.sameFileMedia({ dataUrl: b })?.id).toBe('m1');
        expect(DataManager.sameFileMedia({ dataUrl: image(14) })).toBeUndefined();
    });

    it('a dialog opened before the save landed goes back to the reference too', async () => {
        const a = image(1), b = image(2);
        await store(T2, tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        DataManager.updatePerson(P0, { photo: b });
        expect(DataManager.beginEditSession()).toBe(true);
        await TreeManager.flush();
        DataManager.updatePerson(P0, { firstName: 'Hroznata' });
        DataManager.rollbackEditSession();
        await expectRef(photo(), b);
        expect(DataManager.getData().persons[P0].firstName).toBe('Zbyňka');
    });

    it('the person dialog\'s untouched portrait follows the save to the reference; one changed in it stays', async () => {
        const a = image(1), b = image(2), c = image(3);
        await store(T2, tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        DataManager.updatePerson(P0, { photo: b });
        const model = openPhotoModel(P0, DataManager.getPerson(P0)!.photo);
        await TreeManager.flush();
        await expectRef(photo(), b);
        expect(model.value).toBe(photo());
        DataManager.updatePerson(P0, { photo: c });
        const changed = openPhotoModel(P0, DataManager.getPerson(P0)!.photo);
        setModelPhoto(changed, c);
        await TreeManager.flush();
        expect(changed.value).toBe(c);
    });

    it('a tree stored before the pool (images inside the record) moves to references with its first save', async () => {
        const a = image(4);
        st('trees').set('t2', tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        expect(photo()).toBe(a);
        DataManager.updatePerson(P0, { firstName: 'Hroznata' });
        await TreeManager.flush();
        await expectRef(photo(), a);
        expect((st('trees').get('t2') as { pooled?: number }).pooled).toBe(1);
    });

    it('an imported tree ends with references', async () => {
        const a = image(5);
        const id = await DataManager.importAsNewTree(tree(a), 'Imported');
        await TreeManager.flush();
        expect(DataManager.getCurrentTreeId()).toBe(id);
        await expectRef(photo(), a);
        expect(longDataUrls(st('trees').get(id))).toEqual([]);
    });

    it('a merge of a tree with images into a tree with references keeps both; its save pools the new ones', async () => {
        const a = image(6), b = image(7);
        await store(T2, tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        const existing = DataManager.getData();
        const incoming = {
            persons: { q0: { id: 'q0', firstName: 'Hroznata', lastName: 'Pertl', gender: 'male', partnerships: [], parentIds: [], childIds: [], photo: b, isPlaceholder: false } },
            partnerships: {},
        } as unknown as StromData;
        const state: MergeState = {
            existingData: existing, incomingData: incoming, matches: [], unmatchedExisting: [], unmatchedIncoming: ['q0' as PersonId],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const merged = result.mergedData;
        await expectRef(merged.persons[P0].photo, a);
        const added = Object.values(merged.persons).find(p => p.firstName === 'Hroznata')!;
        expect(added.photo).toBe(b);
        await store(T2, merged);
        const read = await TreeManager.getTreeData(T2);
        expect(longDataUrls(read)).toEqual([]);
        const whole = await expandedData(read!);
        expect(whole.persons[P0].photo).toBe(a);
        expect(Object.values(whole.persons).find(p => p.firstName === 'Hroznata')!.photo).toBe(b);
    });

    it('a restored backup holds references; its file holds the images whole', async () => {
        const a = image(8);
        await store(T2, tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        const snap = await createSnapshot('t2', DataManager.getData(), 'manual', 1000);
        DataManager.updatePerson(P0, { photo: undefined });
        await TreeManager.flush();
        expect(await DataManager.restoreSnapshot(snap.id)).toEqual({ missingImages: 0 });
        await expectRef(photo(), a);
        expect(JSON.parse((await getSnapshotJson(snap.id))!).persons.p0.photo).toBe(a);
        expect((await listSnapshots('t2')).length).toBe(1);
    });

    it('a long text starting with data: in a note stays text: stored as it is, and a record that pooled it gives it back', async () => {
        const d = tree(image(9));
        d.persons[P0].notes = DATA_NOTE;
        await store(T2, d);
        // Stored inline now, not as a pooled image.
        expect(JSON.stringify(st('trees').get('t2'))).toContain('Zápis z matriky');
        expect(await DataManager.switchTree(T2)).toBe(true);
        expect(DataManager.getData().persons[P0].notes).toBe(DATA_NOTE);

        // A record written before (every long data: text pooled): the note comes back as text.
        const rec = st('trees').get('t2') as { data: StromData; media: Record<string, number> };
        const { withPoolLock, storeImages } = await import('../media-pool.js');
        const pooled = await withPoolLock(() => storeImages(new Set([DATA_NOTE]), false, 'old'));
        const noteId = pooled.ids.get(DATA_NOTE)!;
        rec.data.persons[P0].notes = POOL_REF + noteId;
        rec.media[noteId] = pooled.media[noteId];
        expect(await DataManager.switchTree(T1)).toBe(true);
        expect(await DataManager.switchTree(T2)).toBe(true);
        expect(DataManager.getData().persons[P0].notes).toBe(DATA_NOTE);
        await expectRef(photo(), image(9));
    });

    it('an encrypted tree holds e: references; switching the encryption off moves memory and undo steps to p:', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('intern-password');
        const a = image(10), b = image(11);
        await store(T2, tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        await expectRef(photo(), a, 'e:');
        DataManager.updatePerson(P0, { photo: b });
        await TreeManager.flush();
        await expectRef(photo(), b, 'e:');

        // Off, as the encryption dialog does it: every tree saved again, then the side stores.
        encryptionOn = false;
        for (const t of TreeManager.getTrees()) {
            const data = await TreeManager.getTreeData(t.id as TreeId);
            if (data) TreeManager.saveTreeData(t.id as TreeId, data, { asStored: true });
        }
        await TreeManager.flush();
        await reencodeSideStores();
        await expectRef(photo(), b, 'p:');
        // The undo step's image (named by no stored tree any more) moved too.
        DataManager.undo();
        const back = photo();
        expect(poolIdOf(back)?.startsWith('p:')).toBe(true);
        expect(back).not.toBe(POOL_REF);
    });

    it('switching the encryption on moves the references in memory to e:', async () => {
        const a = image(12);
        await store(T2, tree(a));
        expect(await DataManager.switchTree(T2)).toBe(true);
        await expectRef(photo(), a, 'p:');
        encryptionOn = true;
        await CryptoSession.unlock('intern-password-2');
        for (const t of TreeManager.getTrees()) {
            const data = await TreeManager.getTreeData(t.id as TreeId);
            if (data) TreeManager.saveTreeData(t.id as TreeId, data, { asStored: true });
        }
        await TreeManager.flush();
        await expectRef(photo(), a, 'e:');
        expect(longDataUrls(DataManager.getData())).toEqual([]);
    });
});
