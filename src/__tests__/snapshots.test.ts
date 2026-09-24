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

// In-memory stand-in for the IndexedDB-backed StorageManager.
const mem = new Map<string, unknown>();
vi.mock('../storage.js', () => ({
    StorageManager: {
        async get<T>(_store: string, key: string): Promise<T | null> {
            return (mem.get(key) as T) ?? null;
        },
        set(_store: string, key: string, value: unknown): Promise<void> {
            mem.set(key, value);
            return Promise.resolve();
        },
        async delete(_store: string, key: string): Promise<void> {
            mem.delete(key);
        },
        async getAll<T>(_store: string): Promise<T[]> {
            return [...mem.values()] as T[];
        },
        async keys(_store: string): Promise<string[]> {
            return [...mem.keys()];
        },
    },
}));

// Keep encryption off so we take the compression path.
vi.mock('../settings.js', () => ({
    SettingsManager: { isEncryptionEnabled: () => false },
}));

import {
    createSnapshot,
    listSnapshots,
    getSnapshotJson,
    totalSnapshotBytes,
    hasAutoSnapshotOnDay,
    deleteSnapshotsForTree,
    planRetention,
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
    beforeEach(() => mem.clear());

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
    beforeEach(() => mem.clear());
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
