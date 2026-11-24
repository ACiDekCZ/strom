/**
 * Split (spec 139 §11.1): the trees made by Separate unconnected parts and by
 * Split into families name the tree they came from (fromTree) and are never
 * tied to its research. StorageManager is an in-memory map; names are invented.
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
import { findComponents, componentName } from '../components.js';
import { decomposeIntoFamilies, seedIdsFor } from '../split-families.js';
import { isResearchOwner } from '../research-owner.js';
import type { PersonId, StromData, TreeId, TreeMetadata } from '../types.js';

type Raw = Record<string, unknown>;
const person = (id: string, first: string, last: string, gender: 'male' | 'female', extra: Raw = {}): Raw => ({
    id, firstName: first, lastName: last, gender, partnerships: [], parentIds: [], childIds: [], ...extra,
});

/** Two families with no tie between them: Ostrožní and Jesenští. */
function twoParts(): StromData {
    return {
        version: 1,
        persons: {
            jan: person('jan', 'Jan', 'Ostrožní', 'male', { childIds: ['petr'] }),
            petr: person('petr', 'Petr', 'Ostrožní', 'male', { parentIds: ['jan'] }),
            karel: person('karel', 'Karel', 'Jesenský', 'male', { childIds: ['eva'] }),
            eva: person('eva', 'Eva', 'Jesenská', 'female', { parentIds: ['karel'] }),
        },
        partnerships: {},
    } as unknown as StromData;
}

/** One connected tree of two surnames: Petr Ostrožní married Eva Jesenská, each with parents and a child. */
function twoFamilies(): StromData {
    return {
        version: 1,
        persons: {
            jan: person('jan', 'Jan', 'Ostrožní', 'male', { birthDate: '1850', childIds: ['petr', 'josef'] }),
            josef: person('josef', 'Josef', 'Ostrožní', 'male', { birthDate: '1882', parentIds: ['jan'] }),
            petr: person('petr', 'Petr', 'Ostrožní', 'male', { birthDate: '1880', parentIds: ['jan'], partnerships: ['u1'], childIds: ['tomas'] }),
            eva: person('eva', 'Eva', 'Jesenská', 'female', { birthDate: '1884', parentIds: ['karel'], partnerships: ['u1'], childIds: ['tomas'] }),
            karel: person('karel', 'Karel', 'Jesenský', 'male', { birthDate: '1855', childIds: ['eva', 'ludvik'] }),
            ludvik: person('ludvik', 'Ludvík', 'Jesenský', 'male', { birthDate: '1887', parentIds: ['karel'] }),
            tomas: person('tomas', 'Tomáš', 'Ostrožní', 'male', { birthDate: '1910', parentIds: ['petr', 'eva'] }),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'petr', person2Id: 'eva', childIds: ['tomas'], status: 'married' },
        },
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
const researchTree = (): TreeMetadata => ({
    id: 't-res' as TreeId, name: 'Ostrožní z Mezihoře', createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
    personCount: 4, partnershipCount: 0, sizeBytes: 0, research: { id: R, fingerprint: 'f', syncedAt: '2026-01-01' },
});

beforeEach(() => {
    stores.clear();
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.stubGlobal('window', new EventTarget());
    setIndex([researchTree()]);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Separate unconnected parts', () => {
    it('each part names the tree and the part it came from, has no research and is not the owner', () => {
        const data = twoParts();
        const parts = findComponents(data);
        expect(parts).toHaveLength(2);
        for (const part of parts) {
            const name = componentName(part, s => `Rodina ${s}`, 'Bez příjmení');
            const id = TreeManager.createTreeFromPart('t-res' as TreeId, extractSubtree(data, new Set<PersonId>(part.personIds)), name);
            const m = TreeManager.getTreeMetadata(id)!;
            expect(m.fromTree).toEqual({ treeId: 't-res', name: 'Ostrožní z Mezihoře', what: name });
            expect(m.research).toBeUndefined();
            expect(m.copyOf).toBeUndefined();
            expect(m.fileCopyAt).toBeUndefined();
            expect(isResearchOwner(TreeManager.getTrees(), id)).toBe(false);
        }
        // The tree split keeps its research.
        expect(isResearchOwner(TreeManager.getTrees(), 't-res' as TreeId)).toBe(true);
    });
});

describe('Split into families', () => {
    it('each family names the tree and the family it came from, has no research and is not the owner', () => {
        const data = twoFamilies();
        const families = decomposeIntoFamilies(data, 'tomas' as PersonId, 'surname');
        expect(families.length).toBeGreaterThanOrEqual(2);
        for (const [i, family] of families.entries()) {
            const name = `Rodina ${i + 1}`;
            const id = TreeManager.createTreeFromPart('t-res' as TreeId, extractSubtree(data, seedIdsFor(family)), name);
            const m = TreeManager.getTreeMetadata(id)!;
            expect(m.fromTree).toEqual({ treeId: 't-res', name: 'Ostrožní z Mezihoře', what: name });
            expect(m.research).toBeUndefined();
            expect(isResearchOwner(TreeManager.getTrees(), id)).toBe(false);
        }
    });
});
