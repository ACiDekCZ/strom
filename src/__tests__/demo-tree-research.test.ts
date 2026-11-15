/**
 * The sample tree and the research (1115-app-prepnuti-stromu): it is never
 * sent to a research nor tied to one. A sample made now carries the mark
 * (TreeMetadata.demo); an older one is known by its content when it is
 * opened. Making a sample leaves the open tree as a switch does: its research
 * is no longer followed.
 *
 * StorageManager is an in-memory Map; fetch is a stub that records each POST.
 * All data is invented.
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
        async set(store: string, key: string, value: unknown): Promise<void> {
            st(store).set(key, structuredClone(value));
        },
        async setTogether(items: Array<{ store: string; key: string; value: unknown }>): Promise<void> {
            for (const i of items) st(i.store).set(i.key, structuredClone(i.value));
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
            return new Map(keys.map(k => [k, (structuredClone(st(store).get(k)) as T) ?? null]));
        },
        async flush(): Promise<void> {},
    },
}));

vi.mock('../snapshots.js', async (orig) => ({
    ...await orig<typeof import('../snapshots.js')>(),
    createSnapshot: vi.fn(async () => ({ id: 'b1' })),
}));

import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { TreeRenderer } from '../renderer.js';
import { getDemoTree } from '../demo-tree.js';
import { looksLikeSampleTree } from '../demo-sample.js';
import { researchSyncMethods } from '../ui/research-sync-ui.js';
import { researchAdoptMethods } from '../ui/research-adopt-ui.js';
import { importExportMethods } from '../ui/import-export.js';
import { StromData, TreeId, TreeMetadata, ResearchLink, PersonId } from '../types.js';

const SAMPLE = 'sample-tree' as TreeId;
const OWN = 'own-tree' as TreeId;
const RESEARCH = '8e3f5b21-7c4d-4a19-b6e0-2d9a1f4c8e37';

function meta(id: TreeId, name: string, extra: Partial<TreeMetadata> = {}): TreeMetadata {
    return {
        id, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 3, partnershipCount: 0, sizeBytes: 0, dataVersion: 19, ...extra,
    } as TreeMetadata;
}

function ownData(): StromData {
    const persons: StromData['persons'] = {};
    for (let i = 1; i <= 3; i++) {
        persons[`p${i}` as PersonId] = {
            id: `p${i}`, firstName: `Bohdan${i}`, lastName: 'Lesovsky', gender: 'male', partnerships: [], parentIds: [], childIds: [],
        } as unknown as StromData['persons'][PersonId];
    }
    return { version: 19, persons, partnerships: {} } as unknown as StromData;
}

function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: (k: string) => m.get(k) ?? null,
        key: (i: number) => [...m.keys()][i] ?? null,
        removeItem: (k: string) => { m.delete(k); },
        setItem: (k: string, v: string) => { m.set(k, String(v)); },
    };
}

let posts: string[] = [];

function index(trees: TreeMetadata[], active: TreeId): void {
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        unsettledSaves: Map<TreeId, unknown>; storedBases: Map<TreeId, unknown>;
    };
    tm.index = { version: 1, activeTreeId: active, trees };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    tm.unsettledSaves = new Map();
    tm.storedBases = new Map();
}

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 2));
}

beforeEach(() => {
    stores.clear();
    posts = [];
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method === 'POST') posts.push(String(url));
        throw new TypeError('bridge gone');
    }));
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
});

afterEach(async () => {
    await settle();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('the sample tree known by its content', () => {
    it('the sample as made, edited a little; not a tree of the user\'s nor one with a research\'s numbers', () => {
        const sample = getDemoTree();
        expect(looksLikeSampleTree(sample)).toBe(true);
        // A few people added: still the sample.
        const edited = structuredClone(sample);
        edited.persons['x1' as PersonId] = { ...ownData().persons['p1' as PersonId], id: 'x1' } as StromData['persons'][PersonId];
        expect(looksLikeSampleTree(edited)).toBe(true);
        // One person with a research's number: a research's tree (never taken for the sample).
        const numbered = structuredClone(sample);
        Object.values(numbered.persons)[0].refn = 'P0001';
        expect(looksLikeSampleTree(numbered)).toBe(false);
        expect(looksLikeSampleTree(ownData())).toBe(false);
        expect(looksLikeSampleTree(null)).toBe(false);
    });
});

describe('the sample tree is never tied to a research nor sent (1115-app-prepnuti-stromu)', () => {
    it('a tie, a hand-over token and "Start research with this tree" are refused for it', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        index([meta(SAMPLE, 'Sample', { demo: true }), meta(OWN, 'Own')], SAMPLE);
        const link = { id: RESEARCH, fingerprint: 'f', syncedAt: '2026-11-15T13:00:00Z' } as ResearchLink;
        TreeManager.setResearchLink(SAMPLE, link);
        TreeManager.setResearchAdoptToken(SAMPLE, { token: 'tok', at: '2026-11-15T13:00:00Z' });
        expect(TreeManager.getTreeMetadata(SAMPLE)?.research).toBeUndefined();
        expect(TreeManager.getTreeMetadata(SAMPLE)?.researchAdoptToken).toBeUndefined();
        // Another tree still can.
        TreeManager.setResearchLink(OWN, link);
        expect(TreeManager.getTreeMetadata(OWN)?.research?.id).toBe(RESEARCH);

        const ui = Object.assign(Object.create(null), researchAdoptMethods, { researchLinkAvailable: () => true }) as typeof researchAdoptMethods;
        expect(ui.researchAdoptAvailable(TreeManager.getTreeMetadata(SAMPLE))).toBe(false);
        expect(ui.researchAdoptAvailable(meta(OWN, 'Own'))).toBe(true);
    });

    it('a sample with a tie (made before the mark) is never sent', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const link = { id: RESEARCH, fingerprint: 'f-old', syncedAt: '2026-11-15T13:00:00Z', sendMode: 'auto' } as ResearchLink;
        index([meta(SAMPLE, 'Sample', { demo: true, research: link })], SAMPLE);
        st('trees').set(SAMPLE, getDemoTree());
        localStorage.setItem('strom-research-bridge:' + RESEARCH, JSON.stringify({ base: 'http://127.0.0.1:47321/t0k3n' }));
        vi.spyOn(TreeManager, 'getStartupTreeId').mockReturnValue(SAMPLE);
        await (DataManager as unknown as { loadStartupTree: () => Promise<void> }).loadStartupTree();
        const ui = Object.assign(Object.create(null), researchSyncMethods, {
            researchSyncCapable: () => true, researchBridgeVersion: () => '1.33.0', researchStatusOf: () => null,
            askResearchBridge: async () => ({ head: 'h-2' }), researchNoteSending: () => undefined, researchBaseRefs: async () => null,
            refreshResearchSyncUi: () => undefined, showToast: () => undefined, scheduleResearchAutoSend: () => undefined,
        }) as typeof researchSyncMethods;
        await ui.postResearchSend(SAMPLE, { auto: true });
        await ui.postResearchSend(SAMPLE, { auto: false });
        await ui.postResearchSend(SAMPLE, { auto: true, keepalive: true });
        await ui.postResearchSendNow(SAMPLE, { auto: false });
        await settle();
        expect(posts).toEqual([]);
        expect(warn.mock.calls.some(c => String(c[0]).includes('sample tree'))).toBe(true);
    });

    it('an older sample without the mark gets it once opened; a tree of the user\'s does not', async () => {
        index([meta(SAMPLE, 'Sample'), meta(OWN, 'Own')], OWN);
        st('trees').set(SAMPLE, getDemoTree());
        st('trees').set(OWN, ownData());
        vi.spyOn(TreeManager, 'getStartupTreeId').mockReturnValue(OWN);
        await (DataManager as unknown as { loadStartupTree: () => Promise<void> }).loadStartupTree();
        expect(TreeManager.isDemoTree(OWN)).toBe(false);
        expect(await DataManager.switchTree(SAMPLE)).toBe(true);
        expect(TreeManager.isDemoTree(SAMPLE)).toBe(true);
        expect(TreeManager.isDemoTree(OWN)).toBe(false);
        // An older sample tied to a research already keeps its tie (not marked).
        const tied = 'tied-sample' as TreeId;
        TreeManager.markDemoTree(tied, getDemoTree());
        index([meta(tied, 'Tied', { research: { id: RESEARCH, fingerprint: 'f', syncedAt: '2026-11-15T13:00:00Z' } as ResearchLink })], tied);
        TreeManager.markDemoTree(tied, getDemoTree());
        expect(TreeManager.isDemoTree(tied)).toBe(false);
    });

    it('a new sample is marked, and the research of the tree left is no longer followed', async () => {
        index([meta(OWN, 'Own', { research: { id: RESEARCH, fingerprint: 'f', syncedAt: '2026-11-15T13:00:00Z' } as ResearchLink })], OWN);
        st('trees').set(OWN, ownData());
        vi.spyOn(TreeManager, 'getStartupTreeId').mockReturnValue(OWN);
        await (DataManager as unknown as { loadStartupTree: () => Promise<void> }).loadStartupTree();
        vi.spyOn(SettingsManager, 'hasCardDensity').mockReturnValue(true);
        vi.spyOn(TreeRenderer, 'setFocus').mockImplementation(async () => undefined);
        vi.spyOn(TreeRenderer, 'resetFocusHistory').mockImplementation(() => undefined);
        const order: string[] = [];
        const ui = Object.assign(Object.create(null), importExportMethods, {
            closeMobileMenu: () => undefined, closeNewTreeMenu: () => undefined, updateTreeSwitcher: () => undefined,
            updateTreeManagerList: () => undefined, refreshSearch: () => undefined, updateUrlTreeParam: () => undefined,
            showToast: () => undefined, offerTourAfterDemo: () => undefined,
            researchFollowBeforeSwitch: async (target: TreeId | null) => {
                order.push(`before:${target}:${DataManager.getCurrentTreeId()}`);
                return { followed: OWN, open: OWN, panelShown: false };
            },
            researchFollowLeft: (left: TreeId | null) => {
                order.push(`left:${left}:${DataManager.getCurrentTreeId() === left ? 'still open' : 'left'}`);
            },
        }) as typeof importExportMethods;
        await ui.loadDemoTree();
        const sample = DataManager.getCurrentTreeId()!;
        expect(sample).not.toBe(OWN);
        expect(TreeManager.isDemoTree(sample)).toBe(true);
        expect(TreeManager.getTreeMetadata(sample)?.research).toBeUndefined();
        expect(order).toEqual([`before:null:${OWN}`, `left:${OWN}:left`]);
    });
});
