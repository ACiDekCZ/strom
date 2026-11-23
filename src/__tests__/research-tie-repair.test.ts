/**
 * One research, one tree for trees tied before that rule (package 134 point
 * 13): at start, once, every research tied to more than one tree keeps only
 * one of them (the tree without `copy`, of several the oldest); every other
 * one is taken off it as a copy of that tree, backed up first, its data
 * untouched, its tie kept in `researchDetached` for the one-time notice.
 *
 * StorageManager is replaced by an in-memory, per-store Map (no IndexedDB in
 * the node test env); the snapshots module is the real one. All data is
 * invented.
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
            return [...st(store).values()] as T[];
        },
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession } from '../crypto.js';
import { listSnapshots } from '../snapshots.js';
import { planSharedTieRepair, type SharedTieOf } from '../research-owner.js';
import { ResearchLink, StromData, TreeId, TreeIndex, TreeMetadata } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const R = '7a1d3c5e-2b4f-4a6c-8e0d-1f3b5d7e9a2c';
const R2 = '0c2e4a6b-8d1f-4e3a-9b5c-7d9f1a3c5e7b';

function link(extra: Partial<ResearchLink> = {}): ResearchLink {
    return { id: R, fingerprint: 'fp-1', syncedAt: '2026-10-01T10:00:00.000Z', head: 'h-1', sendMode: 'auto', ...extra };
}

function meta(id: string, name: string, createdAt: string, research?: ResearchLink): TreeMetadata {
    return {
        id: id as TreeId, name, createdAt, lastModifiedAt: createdAt,
        personCount: 1, partnershipCount: 0, sizeBytes: 0,
        ...(research ? { research } : {}),
    };
}

function treeData(first: string): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: { p0: { id: 'p0', firstName: first, lastName: 'Kvítková', gender: 'female', partnerships: [], parentIds: [], childIds: [] } },
        partnerships: {},
    } as unknown as StromData;
}

const tm = TreeManager as unknown as {
    index: TreeIndex; initialized: boolean; saveQueues: Map<TreeId, Promise<void>>;
    unreadableTrees: Set<TreeId>; preMigrationStates: Map<TreeId, unknown>;
};

/** A start of the app over the stored index (TreeManager.init reads it). */
async function start(): Promise<TreeIndex> {
    tm.index = { version: 1, activeTreeId: null, trees: [] };
    tm.initialized = false;
    await TreeManager.init();
    await TreeManager.flush();
    return st('trees').get('_index') as TreeIndex;
}

function storeIndex(trees: TreeMetadata[]): void {
    st('trees').set('_index', { version: 1, activeTreeId: trees[0].id, trees } satisfies TreeIndex);
}

async function backups(id: string) {
    return (await listSnapshots(id)).filter(m => m.reason === 'pre-migration');
}

beforeEach(() => {
    stores.clear();
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    vi.stubGlobal('window', new EventTarget());
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    tm.preMigrationStates = new Map();
});

afterEach(() => {
    CryptoSession.lock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('which trees keep a shared research (planSharedTieRepair)', () => {
    const t = (id: string, createdAt: string, research?: SharedTieOf['research']): SharedTieOf => ({ id, name: id, createdAt, ...(research ? { research } : {}) });

    it('a copy (copy: true) leaves; the original keeps the research', () => {
        const plan = planSharedTieRepair([
            t('orig', '2026-01-01', { id: R }),
            t('copy', '2026-02-01', { id: R, copy: true }),
            t('other', '2026-01-05', { id: R2 }),
            t('plain', '2026-01-06'),
        ]);
        expect(plan.map(p => [p.treeId, p.keeper.treeId])).toEqual([['copy', 'orig']]);
    });

    it('two ties without copy: the oldest keeps it, whatever their order in the index', () => {
        const plan = planSharedTieRepair([
            t('young', '2026-05-01', { id: R }),
            t('old', '2026-03-01', { id: R }),
        ]);
        expect(plan.map(p => [p.treeId, p.keeper.treeId])).toEqual([['young', 'old']]);
    });

    it('every tie a copy: the oldest stays as it is; a copy alone with its research shares it with none', () => {
        expect(planSharedTieRepair([
            t('c2', '2026-04-01', { id: R, copy: true }),
            t('c1', '2026-02-01', { id: R, copy: true }),
        ]).map(p => [p.treeId, p.keeper.treeId])).toEqual([['c2', 'c1']]);
        expect(planSharedTieRepair([t('alone', '2026-02-01', { id: R, copy: true })])).toEqual([]);
    });

    it('a send counts as the copy\'s own only after the copy was made, and while it stands in the research', () => {
        const orig = t('orig', '2026-01-01', { id: R });
        const sent = (at: string, state: string) => planSharedTieRepair([orig,
            t('copy', '2026-02-01T12:00:00Z', { id: R, copy: true, sent: { at, state } })])[0].sentAfterCopy;
        expect(sent('2026-02-01T12:00:16Z', 'written')).toEqual({ at: '2026-02-01T12:00:16Z', state: 'written' });
        expect(sent('2026-02-03T08:00:00Z', 'pending')).toEqual({ at: '2026-02-03T08:00:00Z', state: 'pending' });
        // Before the copy was made: the original's send it inherited (Open as a new copy keeps the older tree's own).
        expect(sent('2026-01-20T08:00:00Z', 'written')).toBeNull();
        // Taken back or discarded in the research: nothing of it stands there.
        expect(sent('2026-02-03T08:00:00Z', 'undone')).toBeNull();
        expect(sent('2026-02-03T08:00:00Z', 'discarded')).toBeNull();
        // "Open as a new copy": the older tree became the copy when the newer one was made.
        expect(planSharedTieRepair([
            t('new', '2026-06-01T00:00:00Z', { id: R }),
            t('older', '2026-01-01T00:00:00Z', { id: R, copy: true, sent: { at: '2026-05-01T00:00:00Z', state: 'written' } }),
        ])[0].sentAfterCopy).toBeNull();
    });
});

describe('the one-time repair at start', () => {
    it('takes the copy off the research: backup first, data untouched, tie kept for the notice, original as it was', async () => {
        const original = meta('t-orig', 'Habrovi', '2026-01-01T09:00:00.000Z', link({ sent: { fingerprint: 'f', at: '2026-01-15T09:00:00.000Z', changes: 2, head: 'h-1', state: 'written' } }));
        const copyLink = link({ copy: true, sent: { fingerprint: 'g', at: '2026-02-01T12:00:16.000Z', changes: null, head: 'h-1', state: 'written', intake: 'in-7' } });
        const copy = meta('t-copy', 'Habrovi – kopie', '2026-02-01T12:00:00.000Z', copyLink);
        storeIndex([original, copy]);
        st('trees').set('t-orig', treeData('Wendelína'));
        st('trees').set('t-copy', treeData('Radegunda'));

        const index = await start();
        const after = index.trees.find(t => t.id === 't-copy')!;
        expect(after.research).toBeUndefined();
        expect(after.copyOf).toEqual({ treeId: 't-orig', name: 'Habrovi' });
        expect(after.researchDetached).toMatchObject({
            link: copyLink, keeper: { treeId: 't-orig', name: 'Habrovi' },
            sentAfterCopy: { at: '2026-02-01T12:00:16.000Z', state: 'written' },
        });
        expect(after.researchDetached!.noticed).toBeUndefined();
        expect(index.researchTiesRepaired).toBeTruthy();
        // The original keeps its tie exactly; neither tree's data changed.
        expect(index.trees.find(t => t.id === 't-orig')).toEqual(original);
        expect(st('trees').get('t-copy')).toEqual(treeData('Radegunda'));
        expect(st('trees').get('t-orig')).toEqual(treeData('Wendelína'));
        // Only the copy may not write: the original still owns the research.
        expect(TreeManager.canSendToResearch('t-orig' as TreeId)).toBe(true);
        expect(TreeManager.canSendToResearch('t-copy' as TreeId)).toBe(false);
        // The backup of the copy, none of the original.
        expect(await backups('t-copy')).toHaveLength(1);
        expect(await backups('t-orig')).toHaveLength(0);
    });

    it('two trees with one research and no copy mark: the oldest keeps it', async () => {
        storeIndex([
            meta('t-young', 'Habrovi znovu', '2026-03-01T00:00:00.000Z', link()),
            meta('t-old', 'Habrovi', '2026-01-01T00:00:00.000Z', link()),
        ]);
        st('trees').set('t-young', treeData('Radegunda'));
        st('trees').set('t-old', treeData('Wendelína'));
        const index = await start();
        expect(index.trees.find(t => t.id === 't-old')!.research?.id).toBe(R);
        const young = index.trees.find(t => t.id === 't-young')!;
        expect(young.research).toBeUndefined();
        expect(young.copyOf).toEqual({ treeId: 't-old', name: 'Habrovi' });
        expect(young.researchDetached?.sentAfterCopy).toBeUndefined();
        expect(TreeManager.canSendToResearch('t-old' as TreeId)).toBe(true);
    });

    it('once: a second start changes nothing and takes no second backup', async () => {
        storeIndex([
            meta('t-orig', 'Habrovi', '2026-01-01T00:00:00.000Z', link()),
            meta('t-copy', 'Habrovi – kopie', '2026-02-01T00:00:00.000Z', link({ copy: true })),
        ]);
        st('trees').set('t-copy', treeData('Radegunda'));
        const first = await start();
        TreeManager.markResearchDetachedNoticed('t-copy' as TreeId);
        await TreeManager.flush();
        const noticed = structuredClone(st('trees').get('_index'));
        const second = await start();
        expect(second).toEqual(noticed);
        expect(second.researchTiesRepaired).toBe(first.researchTiesRepaired);
        expect(second.trees.find(t => t.id === 't-copy')!.researchDetached?.noticed).toBe(true);
        expect(await backups('t-copy')).toHaveLength(1);
    });

    it('an encrypted tree while locked: only its index entry changes, its data are not read', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
        await CryptoSession.unlock('repair-password-1');
        const encrypted = await CryptoSession.encrypt(JSON.stringify(treeData('Radegunda')));
        CryptoSession.lock();
        storeIndex([
            meta('t-orig', 'Habrovi', '2026-01-01T00:00:00.000Z', link()),
            meta('t-copy', 'Habrovi – kopie', '2026-02-01T00:00:00.000Z', link({ copy: true })),
        ]);
        st('trees').set('t-copy', encrypted);
        const index = await start();
        expect(index.trees.find(t => t.id === 't-copy')!.research).toBeUndefined();
        expect(st('trees').get('t-copy')).toEqual(encrypted);
        // Not read: not marked unreadable (its saves are not refused), no backup.
        expect(tm.unreadableTrees.has('t-copy' as TreeId)).toBe(false);
        expect(await backups('t-copy')).toHaveLength(0);
    });

    it('nothing shared: the index only gets the mark', async () => {
        const trees = [meta('t-orig', 'Habrovi', '2026-01-01T00:00:00.000Z', link()), meta('t-plain', 'Klenovi', '2026-01-02T00:00:00.000Z')];
        storeIndex(trees);
        const index = await start();
        expect(index.trees).toEqual(trees);
        expect(index.researchTiesRepaired).toBeTruthy();
    });
});
