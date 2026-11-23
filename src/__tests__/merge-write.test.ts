/**
 * The write of the import guide's plan (spec 134 §8): into the tree itself
 * or into a new tree; the backup "Before merge" whatever the automatic
 * backups setting and out of the rotation (K0.4, K6.6, 8e); the check before
 * saving stops the write (8b); a target changed since the comparison is not
 * written blindly (K6.5, 8c); success only after the write landed (K0.5);
 * nothing of the tree lost, its research link kept (random invented pairs);
 * "Save the list…" as text and JSON with the living protected (K6.4, 13e).
 *
 * StorageManager is an in-memory Map per store (no IndexedDB in node). All
 * people are invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Stores = Map<string, Map<string, unknown>>;
const stores: Stores = new Map();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}
/** A write the test makes fail: store + key → true. */
const failing = { write: (_store: string, _key: string) => false };

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return (st(store).get(key) as T) ?? null;
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            if (failing.write(store, key)) return Promise.reject(new Error('QuotaExceededError'));
            st(store).set(key, structuredClone(value));
            return Promise.resolve();
        },
        setTogether(writes: { store: string; key: string; value: unknown }[]): Promise<void> {
            for (const w of writes) {
                if (failing.write(w.store, w.key)) return Promise.reject(new Error('QuotaExceededError'));
            }
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
            return [...st(store).values()] as T[];
        },
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, (st(store).get(k) as T) ?? null]));
        },
        async flush(): Promise<void> {},
    },
}));

vi.mock('../merge/executor.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../merge/executor.js')>();
    return { ...real, executeMerge: vi.fn(real.executeMerge) };
});

import { TreeManager } from '../tree-manager.js';
import { DataManager, migrateData, storedTreeForExport } from '../data.js';
import { validateJsonImport } from '../merge/validation.js';
import { applyContentOptions, applyLivingPrivacy } from '../privacy.js';
import { SettingsManager } from '../settings.js';
import { executeMerge } from '../merge/executor.js';
import { createMergeState, updateMatchDecision } from '../merge/matching.js';
import { buildPlan, type MergePlan, type PlanScope, type WizardChoices } from '../merge/plan.js';
import { exportPlan } from '../merge/plan-export.js';
import { backupFailureWhy, writePlan, writeRestore, writeUndo, type WriteResult } from '../merge/write.js';
import { contentFingerprint } from '../research-link.js';
import { noteResearchSends, settleMergeHold, syncMergeHold } from '../merge/research-hold.js';
import { researchSyncMethods } from '../ui/research-sync-ui.js';
import {
    createSnapshot, listSnapshots, planRetention, MAX_SNAPSHOTS_PER_TREE, type SnapshotMeta,
} from '../snapshots.js';
import { strings } from '../strings.js';
import type { MergeState } from '../merge/types.js';
import { STROM_DATA_VERSION, type PartnershipId, type PersonId, type StromData, type TreeId, type TreeMetadata } from '../types.js';
import { mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

const T1 = 't1' as TreeId;
const T2 = 't2' as TreeId;

function tree(people: Array<[string, string, string]>, extra: Partial<StromData> = {}): StromData {
    const persons: StromData['persons'] = {};
    for (const [id, firstName, birthDate] of people) {
        persons[id as PersonId] = {
            id, firstName, lastName: 'Fictus', gender: 'female', birthDate, partnerships: [],
            parentIds: [], childIds: [],
        } as never;
    }
    return { version: STROM_DATA_VERSION, persons, partnerships: {}, ...extra } as StromData;
}

function meta(id: string, name: string): TreeMetadata {
    return {
        id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 0, partnershipCount: 0, sizeBytes: 0, research: { ...RESEARCH },
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

/** The tree's research link (kept with the tree in the index) and a research detail of its data. */
const RESEARCH = { id: 'a1b2c3d4-0000-4000-8000-000000000001', fingerprint: 'fp-research', syncedAt: '2026-03-01T10:00:00.000Z' };
const TARGET = tree([['e1', 'Alma', '1901'], ['e2', 'Berta', '1903']], { researchAsOf: '2026-03-01' });
const linkOf = (id: TreeId) => TreeManager.getTrees().find(t => t.id === id)?.research;
const INCOMING = tree([['i1', 'Alma', '1901'], ['i2', 'Cecilie', '1930']]);

/** The target as the write reads it: the open tree's data, else as stored. */
async function targetNow(id: TreeId): Promise<StromData> {
    return DataManager.getDataFor(id) ?? (await TreeManager.getTreeData(id))!;
}

/** The plan of the guide over tree `id` and the source, every offered pair answered "same person". */
async function planFor(id: TreeId, source: StromData, over: Partial<WizardChoices> = {}): Promise<{ plan: MergePlan; target: StromData; state: MergeState }> {
    const target = await targetNow(id);
    const state = createMergeState(target, source);
    for (const m of state.matches) updateMatchDecision(state, m.incomingId, 'confirm');
    const w: WizardChoices = {
        mode: 'add', targetTreeId: id, scope: 'c', swapped: false,
        source: { kind: 'ged', label: 'rodokmen-jilmovi.ged', persons: 0 },
        targetName: TreeManager.getTrees().find(t => t.id === id)!.name, targetFingerprint: contentFingerprint(target),
        planId: `mp-${id}`, createdAt: '2026-05-04T10:00:00.000Z', ...over,
    };
    return { plan: buildPlan(state, w), target, state };
}

const premerge = async (id: TreeId): Promise<SnapshotMeta[]> => (await listSnapshots(id)).filter(s => s.reason === 'pre-merge');
const storedNames = async (id: TreeId): Promise<string[]> =>
    Object.values((await TreeManager.getTreeData(id))!.persons).map(p => p.firstName).sort();

beforeEach(async () => {
    stores.clear();
    failing.write = () => false;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { getElementById: () => null, addEventListener() {}, removeEventListener() {} });
    resetTreeManager([meta('t1', 'Modřínovi'), meta('t2', 'Jilmovi')]);
    st('trees').set('t1', structuredClone(TARGET));
    st('trees').set('t2', structuredClone(TARGET));
    expect(await DataManager.switchTree(T1)).toBe(true);
});

afterEach(async () => {
    await TreeManager.flush();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('planRetention and a backup kept for a merge (K6.6)', () => {
    const metas = (n: number, keptAt?: number): SnapshotMeta[] => Array.from({ length: n }, (_, i) => ({
        id: `s${i}`, treeId: 't1', createdAt: 1000 - i, personCount: 1, sizeBytes: 10, reason: 'auto' as const,
        ...(i === keptAt ? { keepFor: 'mp-1' } : {}),
    }));

    it('never drops it: the oldest other backup goes instead', () => {
        const list = metas(MAX_SNAPSHOTS_PER_TREE + 1, MAX_SNAPSHOTS_PER_TREE);
        const plan = planRetention(list, Infinity);
        expect(plan.keep.map(m => m.id)).toContain(`s${MAX_SNAPSHOTS_PER_TREE}`);
        expect(plan.keep.map(m => m.id)).not.toContain(`s${MAX_SNAPSHOTS_PER_TREE - 1}`);
        expect(plan.keep).toHaveLength(MAX_SNAPSHOTS_PER_TREE);
        // Without the mark the rotation would take it.
        expect(planRetention(list, Infinity, [], { ignoreKeep: true }).keep.map(m => m.id)).not.toContain(`s${MAX_SNAPSHOTS_PER_TREE}`);
    });

    it('not even for space: over the budget it stays', () => {
        const list = metas(6, 5);
        expect(planRetention(list, 0).keep.map(m => m.id)).toEqual(['s0', 's1', 's2', 's5']);
    });
});

describe('the backup "Before merge" (K0.4)', () => {
    it('snapshotNow takes it with automatic backups off', async () => {
        TreeManager.setAutoBackups(T1, false);
        expect(await DataManager.snapshotNow('auto')).toBeNull();
        expect(await DataManager.snapshotNow('pre-merge')).toBeTruthy();
        expect(await premerge(T1)).toHaveLength(1);
    });

    it('a write into the tree takes it with automatic backups off, kept for the merge', async () => {
        TreeManager.setAutoBackups(T1, false);
        const { plan, target } = await planFor(T1, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result.ok).toBe(true);
        const backups = await premerge(T1);
        expect(backups).toHaveLength(1);
        expect(backups[0].keepFor).toBe(plan.id);
        expect(result.ok && result.backupId).toBe(backups[0].id);
    });

    it('a write into a new tree backs the target up too, not kept for the merge (the target is not changed)', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'new' });
        expect(result.ok).toBe(true);
        const backups = await premerge(T1);
        expect(backups).toHaveLength(1);
        expect(backups[0].keepFor).toBeUndefined();
    });

    it('a backup that cannot be written: nothing is written (8d)', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        failing.write = store => store === 'snapshots';
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toMatchObject({ ok: false, reason: 'backup', why: 'The browser storage is almost full.', detail: 'QuotaExceededError' });
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta']);
        expect(Object.keys(DataManager.getData().persons)).toHaveLength(2);
        expect([...st('merge').keys()].filter(k => k.startsWith('backup-'))).toEqual([]);
    });

    it('8d says why in words: a full storage with the room the browser estimates, else a general sentence', async () => {
        const MB = 1024 * 1024;
        const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 100 * MB, usage: 97.5 * MB }) } });
        try {
            expect(await backupFailureWhy(quota)).toBe('The browser storage is almost full (2 MB left).');
            // A quota error wrapped by the storage layer is read through its cause.
            expect(await backupFailureWhy(Object.assign(new Error('save failed'), { cause: quota }))).toBe('The browser storage is almost full (2 MB left).');
            expect(await backupFailureWhy(new Error('IndexedDB transaction aborted'))).toBe('The browser did not accept the backup.');
            vi.stubGlobal('navigator', {});
            expect(await backupFailureWhy(quota)).toBe('The browser storage is almost full.');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('the rotation would delete the backup of an earlier merge (8e)', () => {
    /** The tree's backups: the oldest kept for an earlier merge, the rest up to the limit ordinary. */
    async function fullOfBackups(): Promise<SnapshotMeta> {
        const data = await targetNow(T1);
        const kept = await createSnapshot(T1, data, 'pre-merge', 1_000, null, { keepFor: 'mp-earlier' });
        for (let i = 1; i < MAX_SNAPSHOTS_PER_TREE; i++) await createSnapshot(T1, data, 'manual', 1_000 + i * 1000);
        expect(await listSnapshots(T1)).toHaveLength(MAX_SNAPSHOTS_PER_TREE);
        return kept;
    }

    it('asks first and writes nothing', async () => {
        const kept = await fullOfBackups();
        const { plan, target } = await planFor(T1, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toEqual({ ok: false, need: 'retention', date: kept.createdAt });
        expect(await listSnapshots(T1)).toHaveLength(MAX_SNAPSHOTS_PER_TREE);
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta']);
    });

    it('Keep both: nothing deleted, the tree over the limit', async () => {
        const kept = await fullOfBackups();
        const { plan, target } = await planFor(T1, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree', retention: 'keep-both' });
        expect(result.ok).toBe(true);
        const list = await listSnapshots(T1);
        expect(list).toHaveLength(MAX_SNAPSHOTS_PER_TREE + 1);
        expect(list.map(m => m.id)).toContain(kept.id);
        expect(list.filter(m => m.keepFor).map(m => m.keepFor).sort()).toEqual(['mp-earlier', plan.id].sort());
    });

    it('Delete the oldest other backup: both merges kept, the oldest ordinary one gone', async () => {
        const kept = await fullOfBackups();
        const before = await listSnapshots(T1);
        const oldestOther = before.filter(m => !m.keepFor).slice(-1)[0];
        const { plan, target } = await planFor(T1, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree', retention: 'drop-oldest' });
        expect(result.ok).toBe(true);
        const list = await listSnapshots(T1);
        expect(list).toHaveLength(MAX_SNAPSHOTS_PER_TREE);
        expect(list.map(m => m.id)).toContain(kept.id);
        expect(list.map(m => m.id)).not.toContain(oldestOther.id);
    });
});

describe('the check before saving stops the write (8b)', () => {
    it('a broken result: nothing stored, no backup, the issues said', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        vi.mocked(executeMerge).mockResolvedValueOnce({
            success: false, mergedData: target,
            stats: { merged: 0, added: 0, skipped: 0, partnerships: 0 },
            check: { ok: false, problems: [{ kind: 'personLost', count: 2 }] } as never,
        });
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toMatchObject({ ok: false, reason: 'verify', issues: [{ kind: 'personLost', count: 2 }] });
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta']);
        expect(await premerge(T1)).toHaveLength(0);
    });

    it('a plan that says more than the write did: the totals do not match', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        // A person the plan adds who is not in the source at all.
        plan.items.push({ kind: 'person-add', id: 'i-ghost' as PersonId, on: true });
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toMatchObject({ ok: false, reason: 'verify' });
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta']);
        expect(TreeManager.getTrees()).toHaveLength(2);
    });
});

describe('the target changed since the comparison (K6.5, 8c)', () => {
    it('the open tree edited meanwhile: nothing written, the plan to build again, what changed', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        const before = structuredClone(target);
        DataManager.createPerson({ firstName: 'Dora', lastName: 'Fictus', gender: 'female' } as never);
        DataManager.updatePerson('e2' as PersonId, { birthDate: '1904' } as never);
        await TreeManager.flush(T1);
        const result = await writePlan(plan, { target: before, source: INCOMING, into: 'tree' });
        expect(result).toMatchObject({ ok: false, need: 'replan', changed: { added: 1, edited: 1 } });
        expect(await premerge(T1)).toHaveLength(0);
        expect((await storedNames(T1)).sort()).toEqual(['Alma', 'Berta', 'Dora']);
    });

    it('the open tree edited in place, the very data the comparison read: the new people counted from the plan', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        DataManager.createPerson({ firstName: 'Dora', lastName: 'Fictus', gender: 'female' } as never);
        expect(target).toBe(DataManager.getDataFor(T1));
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toMatchObject({ ok: false, need: 'replan', changed: { added: 1, edited: 0 } });
        expect(await premerge(T1)).toHaveLength(0);
    });

    it('a tree not open, changed by another window: likewise', async () => {
        const { plan, target } = await planFor(T2, INCOMING);
        const stored = structuredClone(TARGET);
        stored.persons['e3' as PersonId] = { ...stored.persons['e1' as PersonId], id: 'e3' as PersonId, firstName: 'Ema' };
        st('trees').set('t2', stored);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toMatchObject({ ok: false, need: 'replan', changed: { added: 1, edited: 0 } });
        expect(await storedNames(T2)).toEqual(['Alma', 'Berta', 'Ema']);
    });
});

describe('success only after the write landed (K0.5)', () => {
    it('a write that fails: no success, the tree as it was, the working backup stays', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        failing.write = (store, key) => store === 'trees' && key.startsWith('t1');
        const saveFailed = vi.fn();
        window.addEventListener('strom:save-failed', saveFailed);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toEqual({ ok: false, reason: 'save', message: strings.merge.saveFailed });
        expect(saveFailed).not.toHaveBeenCalled();
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta']);
        expect(Object.keys(DataManager.getData().persons)).toHaveLength(2);
        expect([...st('merge').keys()].some(k => k.startsWith('backup-'))).toBe(true);
    });

    it('a write that lands: stored before success, the working backup gone, progress to the end', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        const phases: string[] = [];
        let storedAtDone = false;
        const result = await writePlan(plan, {
            target, source: INCOMING, into: 'tree',
            onProgress: (phase) => {
                phases.push(phase);
                if (phase === 'done') storedAtDone = Object.values((st('trees').get('t1') as StromData).persons).some(p => p.firstName === 'Cecilie');
            },
        });
        expect(result.ok).toBe(true);
        expect(storedAtDone).toBe(true);
        expect(phases[0]).toBe('check');
        expect(phases).toContain('backup');
        expect(phases[phases.length - 1]).toBe('done');
        expect([...st('merge').keys()].some(k => k.startsWith('backup-'))).toBe(false);
    });
});

describe('into the tree itself', () => {
    it('the open tree: stored and shown, its research link kept, one undo step', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toMatchObject({ ok: true, into: 'tree', treeId: T1, name: 'Modřínovi', ownTrees: [] });
        expect(TreeManager.getTrees()).toHaveLength(2);
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta', 'Cecilie']);
        expect(linkOf(T1)).toMatchObject(RESEARCH);
        expect((await TreeManager.getTreeData(T1))!.researchAsOf).toBe('2026-03-01');
        expect(Object.values(DataManager.getData().persons).map(p => p.firstName).sort()).toEqual(['Alma', 'Berta', 'Cecilie']);
        expect(DataManager.getData().researchAsOf).toBe('2026-03-01');
        expect(DataManager.lastUndoDescription()).toBe(strings.undo.mergeTrees);
        DataManager.undo();
        expect(Object.values(DataManager.getData().persons).map(p => p.firstName).sort()).toEqual(['Alma', 'Berta']);
    });

    it('a tree not open: stored, the open tree untouched', async () => {
        const { plan, target } = await planFor(T2, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result).toMatchObject({ ok: true, into: 'tree', treeId: T2 });
        expect(await storedNames(T2)).toEqual(['Alma', 'Berta', 'Cecilie']);
        expect(linkOf(T2)).toMatchObject(RESEARCH);
        expect((await TreeManager.getTreeData(T2))!.researchAsOf).toBe('2026-03-01');
        expect(DataManager.getCurrentTreeId()).toBe(T1);
        expect(Object.keys(DataManager.getData().persons)).toHaveLength(2);
        expect(await premerge(T2)).toHaveLength(1);
    });
});

describe('into a new tree', () => {
    it('a copy of the target + the import as "{target} + {source}", the target unchanged', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        const fingerprint = contentFingerprint(target);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'new' });
        expect(result).toMatchObject({ ok: true, into: 'new', name: 'Modřínovi + rodokmen-jilmovi' });
        const id = (result as Extract<WriteResult, { ok: true }>).treeId;
        expect(id).not.toBe(T1);
        expect(await storedNames(id)).toEqual(['Alma', 'Berta', 'Cecilie']);
        expect(contentFingerprint((await TreeManager.getTreeData(T1))!)).toBe(fingerprint);
        expect(contentFingerprint(DataManager.getData())).toBe(fingerprint);
    });
});

describe(`into the tree on random invented pairs`, () => {
    const RUNS = 30;
    const SCOPES: readonly PlanScope[] = ['a', 'b', 'c', 'd'];
    const links = (d: StromData): string[] => Object.values(d.persons).flatMap(p => p.parentIds.map(par => `${p.id}<${par}`));

    it('nothing of the tree is lost (people, couples, links, sources, files, research link), the open one or not', async () => {
        const failures: string[] = [];
        for (let seed = 1; seed <= RUNS; seed++) {
            const rnd = mulberry32(seed);
            const base = targetTree(rnd);
            base.version = STROM_DATA_VERSION;
            base.researchAsOf = `2026-03-${10 + (seed % 20)}`;
            const source = sourceTree(base, rnd);
            const id = (seed % 2 ? 't1' : 't2') as TreeId;
            stores.clear();
            resetTreeManager([meta('t1', 'Modřínovi'), meta('t2', 'Jilmovi')]);
            const link = linkOf(id);
            st('trees').set(id, structuredClone(base));
            if (id === T1) await DataManager.switchTree(T1);
            else { st('trees').set('t1', structuredClone(TARGET)); await DataManager.switchTree(T1); }
            const target = await targetNow(id);
            const state = createMergeState(target, source);
            randomDecisions(state, rnd);
            delete state.updateOnly;
            const w: WizardChoices = {
                mode: 'add', targetTreeId: id, scope: SCOPES[seed % 4], swapped: false,
                source: { kind: 'ged', label: 'rodokmen-jilmovi.ged', persons: 0 },
                targetName: 'Modřínovi', targetFingerprint: contentFingerprint(target), planId: `mp-${seed}`, createdAt: '2026-05-04T10:00:00.000Z',
            };
            const plan = buildPlan(state, w);
            const result = await writePlan(plan, { target, source, into: 'tree' });
            if (!result.ok) { failures.push(`seed ${seed}: ${JSON.stringify(result).slice(0, 200)}`); continue; }
            await TreeManager.flush();
            const after = (await TreeManager.getTreeData(id))!;
            const errors: string[] = [];
            for (const p of Object.keys(target.persons)) if (!after.persons[p as PersonId]) errors.push(`person ${p}`);
            for (const u of Object.keys(target.partnerships)) if (!after.partnerships[u as PartnershipId]) errors.push(`couple ${u}`);
            const have = new Set(links(after));
            for (const l of links(target)) if (!have.has(l)) errors.push(`link ${l}`);
            for (const s of Object.keys(target.sources ?? {})) if (!after.sources?.[s]) errors.push(`source ${s}`);
            for (const m of Object.keys(target.media ?? {})) if (!after.media?.[m]) errors.push(`file ${m}`);
            if (after.researchAsOf !== target.researchAsOf) errors.push('research detail');
            // The link as it was, the merge held back from sending by itself (K9.2).
            const { mergeHold, ...linkAfter } = linkOf(id) ?? {} as NonNullable<ReturnType<typeof linkOf>>;
            if (JSON.stringify(linkAfter) !== JSON.stringify(link)) errors.push('research link');
            if (mergeHold?.mergeId !== plan.id) errors.push('merge hold');
            if (Object.keys(after.persons).length !== Object.keys(result.data.persons).length) errors.push('stored ≠ result');
            if (id === T1 && contentFingerprint(DataManager.getData()) !== contentFingerprint(after)) errors.push('open tree ≠ stored');
            if ((await premerge(id)).length !== 1) errors.push('backups');
            if (errors.length) failures.push(`seed ${seed} (${id}): ${errors.slice(0, 5).join('; ')}`);
        }
        expect(failures).toEqual([]);
    }, 120_000);
});

describe('exportPlan (K6.4, 13e)', () => {
    const SOURCE = tree([['i1', 'Alma', '1901'], ['i2', 'Cecilie', '1990'], ['i3', 'Dora', '1850']]);
    SOURCE.persons['i3' as PersonId].deathDate = '1920';

    it('lists the groups as text and the plan as JSON; the living by initials, their details left out', async () => {
        const { plan } = await planFor(T1, SOURCE);
        const { txt, json } = exportPlan(plan, { source: SOURCE, target: TARGET, year: 2026 });
        const t = strings.mergeWizard;
        expect(txt).toContain(`${t.gNew} (2)`);
        expect(txt).toContain(`${t.gJoined} (1)`);
        expect(txt).toContain('+ C. F.');
        expect(txt).not.toContain('Cecilie');
        expect(txt).toContain('+ Dora Fictus (1850–1920)');
        expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(plan)));
    });

    it('in full when the protection is off; "Living person" when anonymous', async () => {
        const { plan } = await planFor(T1, SOURCE);
        expect(exportPlan(plan, { source: SOURCE, target: TARGET, year: 2026, privacy: 'full' }).txt).toContain('+ Cecilie Fictus (1990–)');
        const anon = exportPlan(plan, { source: SOURCE, target: TARGET, year: 2026, privacy: 'anonymous' }).txt;
        expect(anon).toContain(`+ ${strings.privacy.livingPerson}`);
        expect(anon).not.toContain('Cecilie');
    });

    it('a person unticked is under Not added', async () => {
        const { plan } = await planFor(T1, SOURCE, { leftOut: ['i3' as PersonId] });
        const { txt } = exportPlan(plan, { source: SOURCE, target: TARGET, year: 2026 });
        expect(txt).toContain(`${strings.mergeWizard.gSkipped} (1)`);
        expect(txt).toContain('- Dora Fictus (1850–1920)');
    });
});

describe('the record of the merge in the tree (§0.3, K7.2)', () => {
    const INCOMING2 = tree([['k1', 'Berta', '1903'], ['k2', 'Dorota', '1932']]);

    it('a write into the tree stores its record with the tree in the same write, the backup named', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const stored = (await TreeManager.getTreeData(T1))!;
        expect(stored.merges).toHaveLength(1);
        const rec = stored.merges![0];
        expect(rec.id).toBe(plan.id);
        expect(rec.state).toBe('valid');
        expect(rec.target).toEqual({ name: 'Modřínovi', newTree: false });
        expect(rec.backupId).toBe(result.backupId);
        expect(rec.added.map(id => stored.persons[id]?.firstName)).toEqual(['Cecilie']);
        expect(rec.joined).toEqual([['e1', 'i1']]);
        expect(rec.prints && Object.keys(rec.prints)).toEqual(rec.added);
        // The open tree holds it too (the undo step of the write is the whole result).
        expect(DataManager.getDataFor(T1)?.merges?.map(r => r.id)).toEqual([plan.id]);
    });

    it('a second merge is checked against the tree with the first one\'s record and adds its own after it', async () => {
        const first = await planFor(T1, INCOMING);
        expect((await writePlan(first.plan, { target: first.target, source: INCOMING, into: 'tree' })).ok).toBe(true);
        const second = await planFor(T1, INCOMING2, { planId: 'mp-second', createdAt: '2026-05-05T10:00:00.000Z' });
        const result = await writePlan(second.plan, { target: second.target, source: INCOMING2, into: 'tree' });
        expect(result.ok).toBe(true);
        expect((await TreeManager.getTreeData(T1))!.merges!.map(r => r.id)).toEqual([`mp-${T1}`, 'mp-second']);
    });

    it('a write into a new tree: the new tree has the record (new tree, its name), the target none', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        const result = await writePlan(plan, { target, source: INCOMING, into: 'new', name: 'Modřínovi a Jilmovi' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const made = (await TreeManager.getTreeData(result.treeId))!;
        expect(made.merges?.map(r => r.target)).toEqual([{ name: 'Modřínovi a Jilmovi', newTree: true }]);
        expect((await TreeManager.getTreeData(T1))!.merges).toBeUndefined();
    });

    it('survives a load, a JSON export and its import; a tree of v25 without it loads without one; a privacy export leaves it out', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        expect((await writePlan(plan, { target, source: INCOMING, into: 'tree' })).ok).toBe(true);
        const stored = (await TreeManager.getTreeData(T1))!;
        const exported = await storedTreeForExport(T1);
        expect(exported?.merges).toEqual(stored.merges);
        const imported = validateJsonImport(JSON.stringify(exported));
        expect(imported.valid).toBe(true);
        expect(imported.data?.merges).toEqual(stored.merges);
        // A tree of v25: no history, and a merge into it adds the first record.
        const old = migrateData({ ...structuredClone(TARGET), version: 25 });
        expect('merges' in old).toBe(false);
        // A crafted record is dropped, a good one stays.
        const mixed = migrateData({ ...structuredClone(TARGET), merges: [{ id: 3 }, 'x', stored.merges![0]] });
        expect(mixed.merges).toEqual(stored.merges);
        expect(applyLivingPrivacy(stored, 'initials').merges).toBeUndefined();
        expect(applyLivingPrivacy(stored, 'full').merges).toEqual(stored.merges);
        expect(applyContentOptions(stored, { photos: true, attachments: true, notes: false, sources: true }).merges).toBeUndefined();
    });
});

describe('the undo of a merge written (K8.4)', () => {
    it('takes a backup kept for the merge, stores the tree as before, one Undo step; the undo of the undo stores it as merged', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        const written = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(written.ok).toBe(true);
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta', 'Cecilie']);
        const undone = await writeUndo(T1, plan.id, { at: '2026-05-05T10:00:00.000Z' });
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta']);
        const stored = (await TreeManager.getTreeData(T1))!;
        expect(stored.merges?.map(r => [r.id, r.state])).toEqual([[plan.id, 'undone']]);
        expect(stored.merges?.[0].undone?.[0].at).toBe('2026-05-05T10:00:00.000Z');
        expect(DataManager.getDataFor(T1)?.merges?.[0].state).toBe('undone');
        const backups = (await premerge(T1)).filter(b => b.keepFor === plan.id);
        expect(backups.map(b => b.id)).toContain(undone.backupId);
        expect(backups).toHaveLength(2);
        expect(linkOf(T1)).toEqual(RESEARCH);

        expect(await writeRestore(T1, undone.before, plan.id)).toBe(true);
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta', 'Cecilie']);
        expect((await TreeManager.getTreeData(T1))!.merges?.[0].state).toBe('valid');
    });

    it('a backup that cannot be written: nothing is undone', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        expect((await writePlan(plan, { target, source: INCOMING, into: 'tree' })).ok).toBe(true);
        failing.write = store => store === 'snapshots';
        const undone = await writeUndo(T1, plan.id);
        expect(undone.ok).toBe(false);
        expect(!undone.ok && undone.reason).toBe('backup');
        expect(await storedNames(T1)).toEqual(['Alma', 'Berta', 'Cecilie']);
        expect((await writeUndo(T1, 'mp-none')).ok).toBe(false);
    });
});

describe('a merge into a tree with a research waits for a send by hand (§11, K9.2)', () => {
    /** researchAutoOn of the research sync, over a research that takes the tree's changes (sync capable). */
    const autoOn = (id: TreeId): boolean => {
        const ui = { ...researchSyncMethods, researchSyncCapable: () => true } as unknown as typeof researchSyncMethods;
        return ui.researchAutoOn(linkOf(id));
    };
    const byItself = (id: TreeId): void => TreeManager.patchResearchLink(id, { sendMode: 'auto' });

    it('the write holds the tree in the same write: nothing goes by itself, kept over an update from the research', async () => {
        byItself(T1);
        expect(autoOn(T1)).toBe(true);
        const { plan, target } = await planFor(T1, INCOMING);
        const written = await writePlan(plan, { target, source: INCOMING, into: 'tree' });
        expect(written.ok).toBe(true);
        // The hold's day is the merge's (the record's write time, not when the plan was made).
        const recordAt = DataManager.getDataFor(T1)?.merges?.find(r => r.id === plan.id)?.at;
        expect(recordAt).toBeTruthy();
        expect(linkOf(T1)?.mergeHold).toEqual({ mergeId: plan.id, at: recordAt, persons: 1 });
        expect(autoOn(T1)).toBe(false);
        // A new version of the research ties the tree again: the hold stays.
        TreeManager.setResearchLink(T1, { ...RESEARCH, fingerprint: 'fp-newer' });
        expect(linkOf(T1)?.mergeHold?.mergeId).toBe(plan.id);
        expect(autoOn(T1)).toBe(false);
    });

    it('a tree without a research, and a merge into a new tree: no hold', async () => {
        TreeManager.setResearchLink(T1, undefined);
        const { plan, target } = await planFor(T1, INCOMING);
        expect((await writePlan(plan, { target, source: INCOMING, into: 'tree' })).ok).toBe(true);
        expect(TreeManager.getTreeMetadata(T1)?.research).toBeUndefined();
        resetTreeManager([meta('t1', 'Modřínovi'), meta('t2', 'Jilmovi')]);
        st('trees').set('t1', structuredClone(TARGET));
        await DataManager.switchTree(T1);
        const again = await planFor(T1, INCOMING, { planId: 'mp-new' });
        const res = await writePlan(again.plan, { target: again.target, source: INCOMING, into: 'new' });
        expect(res.ok).toBe(true);
        expect(linkOf(T1)?.mergeHold).toBeUndefined();
        expect(res.ok && TreeManager.getTreeMetadata(res.treeId)?.research).toBeUndefined();
    });

    it('undone before the send: the hold goes (the research gets nothing); its redo holds again', async () => {
        byItself(T1);
        const { plan, target } = await planFor(T1, INCOMING);
        expect((await writePlan(plan, { target, source: INCOMING, into: 'tree' })).ok).toBe(true);
        const undone = await writeUndo(T1, plan.id);
        expect(undone.ok).toBe(true);
        expect(linkOf(T1)?.mergeHold).toBeUndefined();
        expect(autoOn(T1)).toBe(true);
        if (!undone.ok) return;
        expect(await writeRestore(T1, undone.before, plan.id)).toBe(true);
        expect(linkOf(T1)?.mergeHold?.mergeId).toBe(plan.id);
    });

    it('Ctrl+Z of the merge: the hold follows the data (syncMergeHold)', async () => {
        const { plan, target } = await planFor(T1, INCOMING);
        expect((await writePlan(plan, { target, source: INCOMING, into: 'tree' })).ok).toBe(true);
        expect(DataManager.undo()).not.toBeNull();
        syncMergeHold(T1, DataManager.getData());
        expect(linkOf(T1)?.mergeHold).toBeUndefined();
        expect(DataManager.redo()).not.toBeNull();
        syncMergeHold(T1, DataManager.getData());
        expect(linkOf(T1)?.mergeHold?.mergeId).toBe(plan.id);
    });

    it('a send that lands: the merge marked sent, the hold gone; the research\'s sends name its input for the undo', async () => {
        byItself(T1);
        const { plan, target } = await planFor(T1, INCOMING);
        expect((await writePlan(plan, { target, source: INCOMING, into: 'tree' })).ok).toBe(true);
        await settleMergeHold(T1, DataManager.getData(), 'R2026112316020000-ab12');
        expect(linkOf(T1)?.mergeHold).toBeUndefined();
        expect(autoOn(T1)).toBe(true);
        const record = () => DataManager.getData().merges!.find(r => r.id === plan.id)!;
        expect(record().sentIntake).toBe('R2026112316020000-ab12');
        expect(record().sentAt).toBeTruthy();
        expect(record().sentToResearch).toBeUndefined();
        noteResearchSends(RESEARCH.id, [{
            intake: 'R2026112316020000-ab12', input: 'I0412', at: '2026-11-23T16:02:00.000Z', state: 'written', changes: 3, tries: null,
            tree: T1, sent: '', decidedAt: '', reason: '', conflicts: null, conflictPersons: [],
        }]);
        expect(record().sentToResearch).toBe('I0412');
        await TreeManager.flush();
        expect((await TreeManager.getTreeData(T1))!.merges![0].sentToResearch).toBe('I0412');
        // Sent: an undo later does not hold the tree again.
        expect((await writeUndo(T1, plan.id)).ok).toBe(true);
        expect(linkOf(T1)?.mergeHold).toBeUndefined();
    });
});
