/**
 * Switching to another tree while that tree is tied to a research
 * (1115-app-prepnuti-stromu): until the new tree is read, the open tree is
 * still the previous one — its id AND its data. Nothing goes to the research
 * in that window (an answer of the bridge, the quiet time, the page left), a
 * read of the tree for the research gets that tree's own data, and a save
 * made meanwhile lands in the previous tree's storage, never the new one's.
 * Once read, the new tree goes with its own people.
 *
 * Reading the new tree is held by a promise the test lets go
 * (TreeManager.getTreeData). StorageManager is an in-memory Map; fetch is a
 * stub that records each POST to the bridge. All data is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}
const landing = new Set<Promise<void>>();
function later(write: () => void): Promise<void> {
    const p = new Promise<void>(resolve => setTimeout(() => { write(); resolve(); }, 1));
    landing.add(p);
    void p.then(() => landing.delete(p));
    return p;
}

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            const v = st(store).get(key);
            return v === undefined ? null : structuredClone(v) as T;
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            const copy = structuredClone(value);
            return later(() => { st(store).set(key, copy); });
        },
        setTogether(items: Array<{ store: string; key: string; value: unknown }>): Promise<void> {
            const copies = items.map(i => ({ ...i, value: structuredClone(i.value) }));
            return later(() => { for (const i of copies) st(i.store).set(i.key, i.value); });
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
        async flush(): Promise<void> {
            while (landing.size > 0) await Promise.all([...landing]);
        },
    },
}));

vi.mock('../snapshots.js', async (orig) => ({
    ...await orig<typeof import('../snapshots.js')>(),
    createSnapshot: vi.fn(async () => ({ id: 'b1' })),
}));

import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { researchSyncMethods } from '../ui/research-sync-ui.js';
import { readTree } from '../ui/research-ui.js';
import { contentFingerprint } from '../research-link.js';
import { StromData, TreeId, TreeMetadata, ResearchLink, PersonId } from '../types.js';

const DEMO = 'demo-tree' as TreeId;
const LINKED = 'linked-tree' as TreeId;
/** A third tree, no research (a switch to it is what holds). */
const PLAIN = 'plain-tree' as TreeId;
const RESEARCH = '6b2e9d14-3c7a-4f80-b1d5-8e0a2c4f6b93';

function person(id: string, firstName: string, lastName: string, refn?: string): StromData['persons'][PersonId] {
    return {
        id, firstName, lastName, gender: 'male', partnerships: [], parentIds: [], childIds: [], isPlaceholder: false,
        ...(refn ? { refn } : {}),
    } as unknown as StromData['persons'][PersonId];
}

/** The example tree: three people, no research. */
function demoData(): StromData {
    return {
        version: 19,
        persons: {
            d1: person('d1', 'Ukazek', 'Vzorovy'),
            d2: person('d2', 'Prikladna', 'Vzorova'),
            d3: person('d3', 'Demonstr', 'Vzorovy'),
        },
        partnerships: {},
    } as unknown as StromData;
}

/** The research tree: its people carry the research's numbers; one note added since the last send. */
function linkedData(note: boolean): StromData {
    const data = {
        version: 19,
        persons: {
            p1: person('p1', 'Bohuslav', 'Kvetonovsky', 'I0001'),
            p2: person('p2', 'Radmila', 'Kvetonovska', 'I0002'),
            p3: person('p3', 'Vlastimil', 'Kvetonovsky', 'I0003'),
        },
        partnerships: {},
    } as unknown as StromData;
    if (note) (data.persons['p1' as PersonId] as { notes?: string }).notes = 'Miller at Kvetonov';
    return data;
}

function meta(id: TreeId, name: string, research?: ResearchLink): TreeMetadata {
    return {
        id, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 3, partnershipCount: 0, sizeBytes: 0, dataVersion: 19, ...(research ? { research } : {}),
    } as TreeMetadata;
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

/** POSTs that reached the bridge (each fails as a bridge gone away: the answer is not the point). */
let posts: Array<{ url: string; body: string }> = [];

/** Reading LINKED waits for `release()`. */
let release: () => void = () => undefined;

/** The sync UI's methods with the page's other parts left out (no DOM, the bridge answered just now). */
function page(): typeof researchSyncMethods {
    return Object.assign(Object.create(null), researchSyncMethods, {
        researchSyncCapable: () => true,
        researchBridgeFresh: () => true,
        researchBridgeKnownDown: () => false,
        researchWriteHeldNow: () => null,
        askResearchBridge: async () => ({ head: 'h-2' }),
        researchBridgeVersion: () => '1.33.0',
        researchStatusOf: () => null,
        researchHeld: () => null,
        researchNoteSending: () => undefined,
        researchBaseRefs: async () => null,
        currentResearchSyncState: () => ({ core: 'unsentAndNewer' }),
        maybeAskResearchSendMode: () => undefined,
        scheduleResearchAutoSend: () => undefined,
        refreshResearchSyncUi: () => undefined,
        showToast: () => undefined,
    }) as typeof researchSyncMethods;
}

/** The trees stored, the example tree open (as after the switch to it); reading `held` waits for `release()`. */
async function start(held: TreeId = LINKED): Promise<void> {
    const sentBefore = contentFingerprint(linkedData(false));
    const link = { id: RESEARCH, head: 'h-1', fingerprint: sentBefore, syncedAt: '2026-11-15T13:00:00Z', sendMode: 'auto' } as ResearchLink;
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        unsettledSaves: Map<TreeId, unknown>; storedBases: Map<TreeId, unknown>;
    };
    tm.index = { version: 1, activeTreeId: DEMO, trees: [meta(DEMO, 'Example'), meta(LINKED, 'Kvetonovsky', link), meta(PLAIN, 'Plain')] };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    tm.unsettledSaves = new Map();
    tm.storedBases = new Map();
    st('trees').set(DEMO, demoData());
    st('trees').set(LINKED, linkedData(true));
    st('trees').set(PLAIN, { version: 19, persons: {}, partnerships: {} });
    localStorage.setItem('strom-research-bridge:' + RESEARCH, JSON.stringify({ base: 'http://127.0.0.1:47321/t0k3n' }));
    vi.spyOn(TreeManager, 'getStartupTreeId').mockReturnValue(DEMO);
    await (DataManager as unknown as { loadStartupTree: () => Promise<void> }).loadStartupTree();
    expect(DataManager.getCurrentTreeId()).toBe(DEMO);

    const read = TreeManager.getTreeData.bind(TreeManager);
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(TreeManager, 'getTreeData').mockImplementation(async (id: TreeId) => {
        if (id === held) await gate;
        return read(id);
    });
}

/** Lets pending promise chains (locks, flushes) run. */
async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 2));
}

beforeEach(() => {
    stores.clear();
    posts = [];
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === 'POST') posts.push({ url: String(url), body: String(init.body ?? '') });
        throw new TypeError('bridge gone');
    }));
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
});

afterEach(async () => {
    release();
    await settle();
    await TreeManager.flush();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('switching to a tree tied to a research (1115-app-prepnuti-stromu)', () => {
    it('sends nothing while the tree is read — bridge answer, quiet time, page left — and then that tree with its own people', async () => {
        await start();
        const ui = page();
        const switching = DataManager.switchTree(LINKED);
        await settle();

        // An answer of the bridge, the quiet time's end, the page hidden, a send asked straight.
        await ui.researchAutoCheck();
        await ui.researchAutoSend(LINKED, 'quiet');
        await ui.researchAutoSend(LINKED, 'bridge');
        await ui.researchAutoLeave();
        await ui.postResearchSendNow(LINKED, { auto: true });
        await settle();
        expect(posts.map(p => p.body.includes('Vzorov') ? 'the example tree' : 'another')).toEqual([]);

        // The open tree is still the example one, id and data together.
        expect(DataManager.getCurrentTreeId()).toBe(DEMO);
        expect(DataManager.getDataFor(LINKED)).toBeNull();
        expect(DataManager.isSwitchingTree()).toBe(true);

        // A read of the tree for the research is that tree's, not the open one's.
        const reading = readTree(LINKED);
        release();
        expect(await switching).toBe(true);
        const read = await reading;
        expect(Object.keys(read?.persons ?? {}).sort()).toEqual(['p1', 'p2', 'p3']);

        expect(DataManager.isSwitchingTree()).toBe(false);
        expect(DataManager.getCurrentTreeId()).toBe(LINKED);
        expect(DataManager.getDataFor(LINKED)).toBe(DataManager.getData());

        // Read: the next answer of the bridge sends the tree itself.
        await ui.researchAutoCheck();
        await settle();
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toContain('/sync');
        const ged = posts[0].body;
        expect(ged).toContain('_STROM_APP_TREE ' + LINKED);
        expect(ged).toContain('Kvetonovsky');
        expect(ged).toContain('Miller at Kvetonov');
        expect(ged).not.toContain('Vzorov');
    });

    it('a save made while the tree is read stays the previous tree\'s: the new tree\'s storage keeps its own data', async () => {
        await start();
        const switching = DataManager.switchTree(LINKED);
        await settle();

        // An edit of the example tree still open: saved, to the example tree.
        DataManager.updatePerson('d1' as PersonId, { notes: 'Edited while switching' });
        DataManager.resaveCurrent();
        await settle();

        release();
        expect(await switching).toBe(true);
        await TreeManager.flush();

        const linked = st('trees').get(LINKED) as StromData;
        expect(Object.keys(linked.persons).sort()).toEqual(['p1', 'p2', 'p3']);
        const demo = st('trees').get(DEMO) as StromData;
        expect((demo.persons['d1' as PersonId] as { notes?: string }).notes).toBe('Edited while switching');
        // The tree open now is the linked one, as stored.
        expect(Object.keys(DataManager.getData().persons).sort()).toEqual(['p1', 'p2', 'p3']);
    });

    it('a switch to another tree holds back only that tree: the research tree, not the one read, goes at once with its own people', async () => {
        // The tree left just before is sent while a switch that follows at once reads a third tree
        // (a tree made and opened, then a switch): it goes then, not only when it is opened again.
        await start(PLAIN);
        const ui = page();
        const switching = DataManager.switchTree(PLAIN);
        await settle();
        expect(DataManager.isSwitchingTree()).toBe(true);
        expect(DataManager.isSwitchingTo(PLAIN)).toBe(true);
        expect(DataManager.isSwitchingTo(LINKED)).toBe(false);

        await ui.researchAutoSend(LINKED, 'switch');
        await settle();
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toContain('/sync');
        const ged = posts[0].body;
        expect(ged).toContain('_STROM_APP_TREE ' + LINKED);
        expect(ged).toContain('Kvetonovsky');
        expect(ged).toContain('Miller at Kvetonov');
        expect(ged).not.toContain('Vzorov');

        release();
        expect(await switching).toBe(true);
        expect(DataManager.getCurrentTreeId()).toBe(PLAIN);
    });

    it('without a navigator (no Web Locks) the tree left still goes at once with its own people', async () => {
        // A runtime without navigator (Node 20 runs the unit tests on CI): the send runs without a window lock.
        vi.stubGlobal('navigator', undefined);
        await start(PLAIN);
        const ui = page();
        const switching = DataManager.switchTree(PLAIN);
        await settle();

        await ui.researchAutoSend(LINKED, 'switch');
        await settle();
        expect(posts).toHaveLength(1);
        expect(posts[0].body).toContain('_STROM_APP_TREE ' + LINKED);
        expect(posts[0].body).not.toContain('Vzorov');

        release();
        expect(await switching).toBe(true);
    });

    it('a later switch wins over one still reading: the tree opened is the last one asked', async () => {
        await start();
        const first = DataManager.switchTree(LINKED);
        await settle();
        const second = DataManager.switchTree(DEMO);
        release();
        await Promise.all([first, second]);
        expect(DataManager.getCurrentTreeId()).toBe(DEMO);
        expect(Object.keys(DataManager.getData().persons).sort()).toEqual(['d1', 'd2', 'd3']);
        expect(await first).toBe(false);
        expect(await second).toBe(true);
        expect(DataManager.isSwitchingTree()).toBe(false);
    });
});
