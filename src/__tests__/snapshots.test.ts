/**
 * Versioned backups (snapshots) tests.
 *
 * StorageManager is mocked with an in-memory Map (no IndexedDB in the node test
 * env). Encryption is off by default, so createSnapshot takes the gzip path;
 * round-trips go back through getSnapshotJson. Retention (daily-auto merge +
 * 20-per-tree cap) is exercised directly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StromData } from '../types.js';
import { CryptoSession } from '../crypto.js';
import { registerPoolReferences } from '../media-pool.js';

// No stored trees here: they name no images (the cleanup needs every kind).
registerPoolReferences('trees', async () => []);

// In-memory stand-in for the IndexedDB-backed StorageManager, one Map per
// store (`mem` is the snapshots store, `media` the image pool).
const mem = new Map<string, unknown>();
const media = new Map<string, unknown>();
const storeOf = (store: string) => (store === 'media' ? media : mem);
vi.mock('../storage.js', () => ({
    StorageManager: {
        async get<T>(store: string, key: string): Promise<T | null> {
            return (storeOf(store).get(key) as T) ?? null;
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            storeOf(store).set(key, value);
            return Promise.resolve();
        },
        async delete(store: string, key: string): Promise<void> {
            storeOf(store).delete(key);
        },
        async getAll<T>(store: string): Promise<T[]> {
            return [...storeOf(store).values()] as T[];
        },
        async keys(store: string): Promise<string[]> {
            return [...storeOf(store).keys()];
        },
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, (storeOf(store).get(k) as T) ?? null]));
        },
    },
}));

// Keep encryption off so we take the compression path.
const settings = { encryption: false };
vi.mock('../settings.js', () => ({
    SettingsManager: { isEncryptionEnabled: () => settings.encryption },
}));

import {
    createSnapshot,
    listSnapshots,
    getSnapshotJson,
    totalSnapshotBytes,
    hasAutoSnapshotOnDay,
    deleteSnapshotsForTree,
    deleteSnapshot,
    getSnapshotPayload,
    reencodeAllSnapshots,
    planRetention,
    snapshotCosts,
    snapshotBudgetBytes,
    MAX_SNAPSHOTS_PER_TREE,
    MIN_SNAPSHOTS_KEPT,
    SNAPSHOT_TREE_BUDGET_BYTES,
    SNAPSHOTS_TRIMMED_EVENT,
    SnapshotMeta,
} from '../snapshots.js';

function data(names: string[]): StromData {
    const persons: StromData['persons'] = {};
    names.forEach((n, i) => {
        persons[`p${i}` as any] = {
            id: `p${i}`, firstName: n, lastName: 'X', gender: 'male', partnerships: [],
        } as any;
    });
    return { persons, partnerships: {} };
}

const TREE = 'tree-a';
const DAY = 24 * 60 * 60 * 1000;

describe('snapshots', () => {
    beforeEach(() => { mem.clear(); media.clear(); });

    it('round-trips data through create + getSnapshotJson', async () => {
        const d = data(['Anna', 'Bob']);
        const meta = await createSnapshot(TREE, d, 'manual', 1000);
        expect(meta.personCount).toBe(2);
        expect(meta.reason).toBe('manual');

        const json = await getSnapshotJson(meta.id);
        expect(json).not.toBeNull();
        expect(JSON.parse(json!)).toEqual(d);
    });

    it('excludes placeholders from personCount', async () => {
        const d = data(['Anna']);
        (d.persons as any)['ph'] = { id: 'ph', isPlaceholder: true, partnerships: [] };
        const meta = await createSnapshot(TREE, d, 'manual', 1000);
        expect(meta.personCount).toBe(1);
    });

    it('lists newest first and scopes to the tree', async () => {
        await createSnapshot(TREE, data(['A']), 'manual', 1000);
        await createSnapshot(TREE, data(['B']), 'manual', 3000);
        await createSnapshot('other', data(['C']), 'manual', 2000);

        const list = await listSnapshots(TREE);
        expect(list.map(s => s.createdAt)).toEqual([3000, 1000]);
        expect(await totalSnapshotBytes(TREE)).toBeGreaterThan(0);
    });

    it('caps at MAX_SNAPSHOTS_PER_TREE (drops oldest)', async () => {
        // Distinct days so the daily-auto merge does not collapse them, and
        // reason 'manual' is never merged anyway.
        for (let i = 0; i < MAX_SNAPSHOTS_PER_TREE + 1; i++) {
            await createSnapshot(TREE, data([`P${i}`]), 'manual', 1000 + i * DAY);
        }
        const list = await listSnapshots(TREE);
        expect(list.length).toBe(MAX_SNAPSHOTS_PER_TREE);
        // The very first (oldest) is gone.
        expect(list.some(s => s.createdAt === 1000)).toBe(false);
    });

    it('merges same-day auto snapshots keeping the newest', async () => {
        const t0 = 1_000_000_000_000; // fixed epoch
        await createSnapshot(TREE, data(['early']), 'auto', t0);
        await createSnapshot(TREE, data(['late']), 'auto', t0 + 60_000); // same calendar day
        const list = await listSnapshots(TREE);
        const autos = list.filter(s => s.reason === 'auto');
        expect(autos.length).toBe(1);
        expect(autos[0].createdAt).toBe(t0 + 60_000);
    });

    it('keeps auto snapshots on different days', async () => {
        const t0 = 1_000_000_000_000;
        await createSnapshot(TREE, data(['d1']), 'auto', t0);
        await createSnapshot(TREE, data(['d2']), 'auto', t0 + DAY);
        expect((await listSnapshots(TREE)).filter(s => s.reason === 'auto').length).toBe(2);
    });

    it('hasAutoSnapshotOnDay reflects same-day autos only', async () => {
        const t0 = 1_000_000_000_000;
        await createSnapshot(TREE, data(['x']), 'auto', t0);
        expect(await hasAutoSnapshotOnDay(TREE, t0 + 3600_000)).toBe(true);
        expect(await hasAutoSnapshotOnDay(TREE, t0 + DAY)).toBe(false);
        // A manual snapshot does not count as an auto.
        mem.clear();
        await createSnapshot(TREE, data(['x']), 'manual', t0);
        expect(await hasAutoSnapshotOnDay(TREE, t0)).toBe(false);
    });
});

describe('snapshot space budget', () => {
    beforeEach(() => { mem.clear(); media.clear(); });
    const MB = 1024 * 1024;
    const meta = (i: number, mb: number): SnapshotMeta =>
        ({ id: `s${i}`, treeId: TREE, createdAt: 100 - i, personCount: 1, sizeBytes: mb * MB, reason: 'auto' });

    it('keeps small snapshots up to the count cap', () => {
        const plan = planRetention(Array.from({ length: 25 }, (_, i) => meta(i, 1)), SNAPSHOT_TREE_BUDGET_BYTES);
        expect(plan.keep).toHaveLength(MAX_SNAPSHOTS_PER_TREE);
        expect(plan.dropSpace).toBe(0);
    });

    it('drops old big snapshots past the budget, never below the minimum', () => {
        const big = Array.from({ length: 10 }, (_, i) => meta(i, 60));
        const plan = planRetention(big, SNAPSHOT_TREE_BUDGET_BYTES);
        // 60 MB each against 150 MB: only the guaranteed newest ones stay.
        expect(plan.keep.map(m => m.id)).toEqual(['s0', 's1', 's2']);
        expect(plan.dropSpace).toBe(10 - plan.keep.length);
        // Full storage: budget 0 → exactly the minimum.
        expect(planRetention(big, 0).keep).toHaveLength(MIN_SNAPSHOTS_KEPT);
    });

    it('announces snapshots removed for space', async () => {
        const events: unknown[] = [];
        const target = new EventTarget();
        vi.stubGlobal('window', target);
        target.addEventListener(SNAPSHOTS_TRIMMED_EVENT, (e) => events.push((e as CustomEvent).detail));
        // Pretend the browser storage is nearly full.
        vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 95, quota: 100 }) } });
        for (let i = 0; i < MIN_SNAPSHOTS_KEPT + 1; i++) {
            await createSnapshot(TREE, data([`P${i}`]), 'manual', 1000 + i * DAY);
        }
        expect(await listSnapshots(TREE)).toHaveLength(MIN_SNAPSHOTS_KEPT);
        expect(events).toEqual([{ treeId: TREE, removed: 1, kept: MIN_SNAPSHOTS_KEPT, storageFull: true }]);
        vi.unstubAllGlobals();
    });

    it('lists without reading payloads, and upgrades old records once', async () => {
        const created = await createSnapshot(TREE, data(['A']), 'manual', 1000);
        // An old snapshot: payload only, no meta record.
        mem.set('snap_old', { meta: { ...created, id: 'snap_old', createdAt: 500 }, plain: '{}' });
        const list = await listSnapshots(TREE);
        expect(list.map(m => m.id)).toEqual([created.id, 'snap_old']);
        expect(mem.has('meta:snap_old')).toBe(true);
        await deleteSnapshotsForTree(TREE);
        expect([...mem.keys()]).toEqual([]);
    });
});

/** A JPEG-looking data URL of `n` pseudo-random bytes (seeded, so repeatable). */
function image(seed: number, n = 3000): string {
    const bytes = new Uint8Array(n);
    let x = seed * 2654435761 >>> 0;
    for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; bytes[i] = x >>> 24; }
    return 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
}

function withImages(names: string[], images: string[]): StromData {
    const d = data(names);
    const p = Object.values(d.persons)[0] as any;
    p.photo = images[0];
    d.sources = { s1: { id: 's1', title: 'Entry', excerpts: images.slice(1).map((url, i) =>
        ({ id: `e${i}`, dataUrl: url, width: 10, height: 10, sizeBytes: 1 })) } } as any;
    return d;
}

describe('image pool', () => {
    beforeEach(() => { mem.clear(); media.clear(); });

    it('stores each image once, outside the snapshot, and puts it back', async () => {
        const d = withImages(['Anna'], [image(1), image(2), image(3)]);
        const meta = await createSnapshot(TREE, d, 'manual', 1000);
        expect(media.size).toBe(3);
        expect(Object.keys(meta.media!)).toHaveLength(3);
        // Stored as bytes: a quarter smaller than the base64 text.
        expect(Object.values(meta.media!).every(size => size === 3000)).toBe(true);
        // The snapshot record itself is small — the images are not in it.
        expect(meta.sizeBytes).toBeLessThan(2000);
        expect(JSON.parse((await getSnapshotJson(meta.id))!)).toEqual(d);
    });

    it('shares images between snapshots and counts them once', async () => {
        const imgs = [image(1), image(2)];
        const a = await createSnapshot(TREE, withImages(['Anna'], imgs), 'manual', 1000);
        const b = await createSnapshot(TREE, withImages(['Anna', 'Bob'], [...imgs, image(3)]), 'manual', 1000 + DAY);
        expect(media.size).toBe(3);
        const costs = snapshotCosts(await listSnapshots(TREE));
        // Newest pays for all three images; the older one only for its text.
        expect(costs.get(b.id)).toBe(b.sizeBytes + 9000);
        expect(costs.get(a.id)).toBe(a.sizeBytes);
        expect(await totalSnapshotBytes(TREE)).toBe(a.sizeBytes + b.sizeBytes + 9000);
    });

    it('drops an image once no snapshot refers to it', async () => {
        const a = await createSnapshot(TREE, withImages(['Anna'], [image(1), image(2)]), 'manual', 1000);
        const b = await createSnapshot(TREE, withImages(['Anna'], [image(1)]), 'manual', 1000 + DAY);
        expect(media.size).toBe(2);
        await deleteSnapshot(a.id);
        expect([...media.keys()]).toEqual(Object.keys(b.media!));
        await deleteSnapshotsForTree(TREE);
        expect(media.size).toBe(0);
    });

    it('keeps text that is not canonical base64 exactly as it was', async () => {
        const odd = image(4).slice(0, -1) + 'B';   // stray bits in the last group
        const d = withImages(['Anna'], [odd]);
        const meta = await createSnapshot(TREE, d, 'manual', 1000);
        expect(JSON.parse((await getSnapshotJson(meta.id))!).persons.p0.photo).toBe(odd);
    });

    it('restores the rest when an image is gone, and says how many', async () => {
        const meta = await createSnapshot(TREE, withImages(['Anna'], [image(1), image(2)]), 'manual', 1000);
        media.delete(Object.keys(meta.media!)[1]);
        const payload = await getSnapshotPayload(meta.id);
        expect(payload!.missingImages).toBe(1);
        const back = JSON.parse(payload!.json);
        expect(back.persons.p0.firstName).toBe('Anna');
        expect(back.sources.s1.excerpts[0].dataUrl).toBe('');
    });

    it('does not count shared images against the budget twice', () => {
        const MB = 1024 * 1024;
        const shared = { 'p:1': 80 * MB };
        const metas: SnapshotMeta[] = Array.from({ length: 10 }, (_, i) =>
            ({ id: `s${i}`, treeId: TREE, createdAt: 100 - i, personCount: 1, sizeBytes: MB, reason: 'auto', media: shared }));
        expect(planRetention(metas, SNAPSHOT_TREE_BUDGET_BYTES).keep).toHaveLength(10);
    });

    it('a phone gets a smaller budget; the newest alone over it is announced', async () => {
        vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 0, quota: 200_000 }) } });
        expect(await snapshotBudgetBytes()).toBe(20_000);
        const events: any[] = [];
        const target = new EventTarget();
        vi.stubGlobal('window', target);
        target.addEventListener(SNAPSHOTS_TRIMMED_EVENT, (e) => events.push((e as CustomEvent).detail));
        await createSnapshot(TREE, withImages(['Anna'], Array.from({ length: 8 }, (_, i) => image(i))), 'manual', 1000);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ treeId: TREE, removed: 0, tooBig: true });
        vi.unstubAllGlobals();
    });
});

describe('image pool with encryption', () => {
    beforeEach(async () => {
        mem.clear(); media.clear();
        settings.encryption = true;
        await CryptoSession.unlock('correct horse');
    });

    it('encrypts pooled images under keyed ids, and moves them when encryption goes off', async () => {
        const d = withImages(['Anna'], [image(1), image(2)]);
        const meta = await createSnapshot(TREE, d, 'manual', 1000);
        const ids = Object.keys(meta.media!);
        expect(ids.every(id => id.startsWith('e:'))).toBe(true);
        expect([...media.values()].every((r: any) => r.encrypted && !r.bytes && !r.text)).toBe(true);
        expect(JSON.parse((await getSnapshotJson(meta.id))!)).toEqual(d);

        settings.encryption = false;
        expect(await reencodeAllSnapshots()).toBe(0);
        const [after] = await listSnapshots(TREE);
        expect(Object.keys(after.media!).every(id => id.startsWith('p:'))).toBe(true);
        expect([...media.keys()].sort()).toEqual(Object.keys(after.media!).sort());
        expect(JSON.parse((await getSnapshotJson(meta.id))!)).toEqual(d);
        CryptoSession.lock();
    });
});
