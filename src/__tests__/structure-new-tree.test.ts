/**
 * Change structure… (spec 139 K2.4, §4.2): a new tree made of a selection
 * and a copy of a whole tree are never tied to a research. The copy names
 * the tree it was copied from (copyOf), the selection tree the tree it was
 * made of (fromTree). StorageManager is an in-memory map; names are invented.
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
        async get<T>(store: string, key: string): Promise<T | null> { return (st(store).get(key) as T) ?? null; },
        set(store: string, key: string, value: unknown): Promise<void> { st(store).set(key, structuredClone(value)); return Promise.resolve(); },
        async delete(store: string, key: string): Promise<void> { st(store).delete(key); },
        async keys(store: string): Promise<string[]> { return [...st(store).keys()]; },
        async getAll<T>(store: string): Promise<T[]> { return [...st(store).values()] as T[]; },
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { extractSubtree } from '../subtree.js';
import { isResearchOwner } from '../research-owner.js';
import type { PersonId, StromData, TreeId, TreeMetadata } from '../types.js';

const POOL_PORTRAIT = '\u0000sm:p:' + 'b'.repeat(40);

function ostrozni(): StromData {
    const p = (id: string, first: string, extra: Record<string, unknown> = {}) => ({
        id, firstName: first, lastName: 'Ostrožní', gender: 'male', partnerships: [], parentIds: [], childIds: [], ...extra,
    });
    return {
        version: 1,
        persons: {
            jan: p('jan', 'Jan', { childIds: ['petr'] }),
            petr: p('petr', 'Petr', { parentIds: ['jan'], photo: POOL_PORTRAIT }),
        },
        partnerships: {},
    } as unknown as StromData;
}

function setIndex(trees: TreeMetadata[]): void {
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
    };
    tm.index = { version: 1, activeTreeId: trees[0]?.id ?? null, trees };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
}

const R = '3c5e7a9b-1d2f-4a6c-8e0b-2d4f6a8c0e1a';
const meta = (id: string, name: string, extra: Partial<TreeMetadata> = {}): TreeMetadata => ({
    id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01', personCount: 2, partnershipCount: 0, sizeBytes: 0, ...extra,
});

beforeEach(() => {
    stores.clear();
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a copy of the whole tree', () => {
    it('names the tree it was copied from also for a tree without research, and has no research', async () => {
        setIndex([meta('t-plain', 'Ostrožní z Mezihoře')]);
        st('trees').set('t-plain', ostrozni());
        const copy = await TreeManager.duplicateTree('t-plain' as TreeId, 'Ostrožní z Mezihoře (kopie)');
        const m = TreeManager.getTreeMetadata(copy!)!;
        expect(m.copyOf).toEqual({ treeId: 't-plain', name: 'Ostrožní z Mezihoře' });
        expect(m.research).toBeUndefined();
        expect(isResearchOwner(TreeManager.getTrees(), copy)).toBe(false);
    });

    it('of a research tree: copyOf, no research, not the owner; an image outside memory stays a reference', async () => {
        setIndex([meta('t-res', 'Jesenští', { research: { id: R, fingerprint: 'f', syncedAt: '2026-01-01' } })]);
        st('trees').set('t-res', ostrozni());
        const copy = await TreeManager.duplicateTree('t-res' as TreeId, 'Jesenští (kopie)');
        const m = TreeManager.getTreeMetadata(copy!)!;
        expect(m.copyOf).toEqual({ treeId: 't-res', name: 'Jesenští' });
        expect(m.research).toBeUndefined();
        expect(isResearchOwner(TreeManager.getTrees(), copy)).toBe(false);
        expect(isResearchOwner(TreeManager.getTrees(), 't-res')).toBe(true);
        await TreeManager.flush(copy!);
        // Stored as the reference: the image itself was never read.
        expect(JSON.stringify(st('trees').get(copy!))).toContain(JSON.stringify(POOL_PORTRAIT).slice(1, -1));
    });
});

describe('a new tree made of a selection', () => {
    it('names the tree it was made of and what, has no research, is not the owner and is no file copy', async () => {
        setIndex([meta('t-res', 'Jesenští', { research: { id: R, fingerprint: 'f', syncedAt: '2026-01-01' } })]);
        const subtree = extractSubtree(ostrozni(), new Set(['petr'] as PersonId[]));
        const id = TreeManager.createTreeFromImport(subtree, 'Jesenští — Petr', false,
            { treeId: 't-res' as TreeId, name: 'Jesenští', what: 'Petr' });
        const m = TreeManager.getTreeMetadata(id)!;
        expect(m.fromTree).toEqual({ treeId: 't-res', name: 'Jesenští', what: 'Petr' });
        expect(m.research).toBeUndefined();
        expect(m.copyOf).toBeUndefined();
        expect(m.fileCopyAt).toBeUndefined();
        expect(isResearchOwner(TreeManager.getTrees(), id)).toBe(false);
        // The portrait outside memory goes along as its reference.
        expect(subtree.persons['petr' as PersonId]?.photo).toBe(POOL_PORTRAIT);
    });
});
