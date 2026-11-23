/**
 * The image pool's cleanup (spec 135, D7). The tree in memory holds its
 * images as pool references, so an image no stored tree or backup names may
 * still be held: by an undo step, an open edit, the person dialog's portrait,
 * a satellite window, a rescue copy or a merge session — those are kept. And
 * as another tab's memory is out of reach, an unused image is first only
 * marked; a cleanup removes it once it has stayed unused for a week, and an
 * image named again loses its mark.
 *
 * StorageManager is an in-memory, per-store Map; the clock is fixed (Date
 * only). All data is invented.
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

import { TreeManager, RESCUE_PREFIX } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { listSnapshots } from '../snapshots.js';
import { collectPoolGarbage, poolUnusedMarks, POOL_UNUSED_GRACE_MS, POOL_UNUSED_KEY } from '../media-pool.js';
import { expandedData } from '../image-expand.js';
import { POOL_REF, poolIdOf } from '../image-ref.js';
import { clearImageMeta } from '../image-meta.js';
import { UndoManager } from '../undo.js';
import { openPhotoModel } from '../ui/person-photo-model.js';
import { holdSatelliteImages } from '../windows/window-images.js';
import { StromData, TreeId, TreeMetadata, PersonId } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const T1 = 't1' as TreeId;
const T2 = 't2' as TreeId;
const P0 = 'p0' as PersonId;
const DAY = 24 * 60 * 60 * 1000;
/** Mid-morning UTC: no day boundary near. */
const START = Date.UTC(2026, 2, 10, 10, 0, 0);

/** A PNG-looking data URL of pseudo-random bytes (seeded, repeatable; over 1 kB, so the pool takes it). */
function image(seed: number, n = 2400): string {
    const bytes = new Uint8Array(n);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let x = seed * 2654435761 >>> 0;
    for (let i = 8; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; bytes[i] = x >>> 24; }
    return 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
}

function tree(photo?: string): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: {
            p0: {
                id: 'p0', firstName: 'Zbyňka', lastName: 'Pertlová', gender: 'female', partnerships: [], parentIds: [], childIds: [],
                ...(photo ? { photo } : {}),
            },
        },
        partnerships: {},
    } as unknown as StromData;
}

function meta(id: string, name: string): TreeMetadata {
    return { id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01', personCount: 0, partnershipCount: 0, sizeBytes: 0 };
}

/** Store a tree through the app (pooled) without opening it. */
async function store(id: TreeId, data: StromData): Promise<void> {
    TreeManager.saveTreeData(id, data);
    await TreeManager.flush(id);
}

/** The content id the pool gives an image (stored once with a tree, which then lets it go). */
async function pooledUnused(url: string): Promise<string> {
    await store(T2, tree(url));
    const id = Object.keys((st('trees').get('t2') as { media: Record<string, number> }).media)[0];
    await store(T2, tree());
    return id;
}

/** The pooled images (the cleanup's marks are no image). */
function images(): string[] {
    return [...st('media').keys()].filter(k => k !== POOL_UNUSED_KEY);
}

/** The clock `days` after START. */
function at(days: number): void {
    vi.setSystemTime(START + days * DAY);
}

/** Open T2 (stored with `photo`): its data hold the reference. */
async function openWith(photo: string): Promise<string> {
    await store(T2, tree(photo));
    expect(await DataManager.switchTree(T2)).toBe(true);
    const ref = DataManager.getData().persons[P0].photo!;
    expect(poolIdOf(ref)).not.toBeNull();
    return ref;
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    stores.clear();
    clearImageMeta();
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    // No automatic backup (it would name the images too).
    vi.spyOn(TreeManager, 'isAutoBackupEnabled').mockReturnValue(false);
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
    holdSatelliteImages('sat-1', null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('two phases: an unused image is marked, removed a week later', () => {
    it('the first cleanup only marks (also an older pool without marks); it goes once a week has passed', async () => {
        const id = await pooledUnused(image(1));
        expect(await collectPoolGarbage()).toBe(0);
        expect(images()).toEqual([id]);
        expect(await poolUnusedMarks()).toEqual(new Map([[id, START]]));
        at(6.9);
        expect(await collectPoolGarbage()).toBe(0);
        expect(images()).toEqual([id]);
        expect((await poolUnusedMarks()).get(id)).toBe(START);
        at(7);
        expect(await collectPoolGarbage()).toBe(1);
        expect(images()).toEqual([]);
        // No marks left: their record goes too.
        expect(st('media').has(POOL_UNUSED_KEY)).toBe(false);
    });

    it('an image named again loses its mark; unused again, its week starts anew', async () => {
        const a = image(2);
        const id = await pooledUnused(a);
        await collectPoolGarbage();
        at(3);
        await store(T2, tree(a));
        await collectPoolGarbage();
        expect((await poolUnusedMarks()).has(id)).toBe(false);
        at(9);
        await store(T2, tree());
        expect(await collectPoolGarbage()).toBe(0);
        expect(images()).toEqual([id]);
        expect((await poolUnusedMarks()).get(id)).toBe(START + 9 * DAY);
        at(15);
        expect(await collectPoolGarbage()).toBe(0);
        at(16);
        expect(await collectPoolGarbage()).toBe(1);
    });

    it('a mark from the future (the clock was set back) starts again from now', async () => {
        const id = await pooledUnused(image(3));
        st('media').set(POOL_UNUSED_KEY, { [id]: START + 30 * DAY });
        expect(await collectPoolGarbage()).toBe(0);
        expect((await poolUnusedMarks()).get(id)).toBe(START);
    });

    it('a cleanup and a save under the lock: the save of an image marked long ago keeps it, in either order', async () => {
        const a = image(4), b = image(5);
        await pooledUnused(a);
        await pooledUnused(b);
        await collectPoolGarbage();
        at(8);
        // Save first: the cleanup finds it named.
        TreeManager.saveTreeData(T2, tree(a));
        const first = collectPoolGarbage();
        await TreeManager.flush(T2);
        await first;
        let r = await TreeManager.readTreeData(T2);
        expect(r.status === 'ok' && (await expandedData(r.data)).persons[P0].photo).toBe(a);
        // Cleanup first: it removes b, and the save then stores b again.
        const second = collectPoolGarbage();
        TreeManager.saveTreeData(T2, tree(b));
        await second;
        await TreeManager.flush(T2);
        r = await TreeManager.readTreeData(T2);
        expect(r.status === 'ok' && (await expandedData(r.data)).persons[P0].photo).toBe(b);
    });
});

describe('what memory holds is kept, however long', () => {
    it('an image only in an undo step', async () => {
        const a = image(6);
        await openWith(a);
        DataManager.updatePerson(P0, { photo: undefined });
        await TreeManager.flush();
        expect(Object.keys((st('trees').get('t2') as { media?: Record<string, number> }).media ?? {})).toEqual([]);
        expect(await listSnapshots('t2')).toEqual([]);
        await collectPoolGarbage();
        at(8);
        expect(await collectPoolGarbage()).toBe(0);
        DataManager.undo();
        expect((await expandedData(DataManager.getData())).persons[P0].photo).toBe(a);
    });

    it('an image only in an edit still open (the state it goes back to)', async () => {
        const a = image(7);
        await openWith(a);
        UndoManager.clear();
        expect(DataManager.beginEditSession()).toBe(true);
        DataManager.updatePerson(P0, { photo: undefined });
        // Another tab stores the tree without it meanwhile.
        await store(T2, tree());
        await collectPoolGarbage();
        at(8);
        expect(await collectPoolGarbage()).toBe(0);
        DataManager.rollbackEditSession();
        expect((await expandedData(DataManager.getData())).persons[P0].photo).toBe(a);
    });

    it('the portrait the person dialog holds', async () => {
        const a = image(8);
        const ref = await openWith(a);
        openPhotoModel(P0, ref);
        DataManager.updatePerson(P0, { photo: undefined });
        await TreeManager.flush();
        UndoManager.clear();
        await collectPoolGarbage();
        at(8);
        expect(await collectPoolGarbage()).toBe(0);
        expect((await expandedData({ v: ref })).v).toBe(a);
        openPhotoModel(P0, undefined);
    });

    it('an image only a satellite window holds; once it lets go, the week starts', async () => {
        const id = await pooledUnused(image(9));
        holdSatelliteImages('sat-1', () => [id]);
        await collectPoolGarbage();
        at(8);
        expect(await collectPoolGarbage()).toBe(0);
        expect(await poolUnusedMarks()).toEqual(new Map());
        holdSatelliteImages('sat-1', null);
        await collectPoolGarbage();
        at(15);
        expect(await collectPoolGarbage()).toBe(1);
    });

    it('a satellite that cannot be asked any more is forgotten', async () => {
        const id = await pooledUnused(image(10));
        holdSatelliteImages('sat-1', () => { throw new Error('closed'); });
        await collectPoolGarbage();
        at(8);
        expect(await collectPoolGarbage()).toBe(1);
        expect(images()).not.toContain(id);
    });

    it('an image a rescue copy or a merge session names', async () => {
        const a = image(11), b = image(12);
        const idA = await pooledUnused(a);
        const idB = await pooledUnused(b);
        const local = new Map<string, string>([
            [`${RESCUE_PREFIX}t2@w1`, JSON.stringify({ at: START, base: null, data: tree(POOL_REF + idA) })],
            ['strom-other', JSON.stringify({ photo: POOL_REF + idB })],
        ]);
        vi.stubGlobal('localStorage', {
            get length() { return local.size; },
            key: (i: number) => [...local.keys()][i] ?? null,
            getItem: (k: string) => local.get(k) ?? null,
        });
        st('merge').set('current', { id: 'current', state: { existingData: tree(), incomingData: tree(), matches: [
            { incomingId: 'p0', conflicts: [{ field: 'photo', existingValue: POOL_REF + idB, incomingValue: '' }] },
        ] } });
        await collectPoolGarbage();
        at(8);
        expect(await collectPoolGarbage()).toBe(0);
        expect(images().sort()).toEqual([idA, idB].sort());
        st('merge').clear();
        local.clear();
        await collectPoolGarbage();
        at(15);
        expect(await collectPoolGarbage()).toBe(2);
    });
});
