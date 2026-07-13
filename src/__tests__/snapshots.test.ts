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
    MAX_SNAPSHOTS_PER_TREE,
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
