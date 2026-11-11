/**
 * A tree of 3.26 tied to a research and in step with it, opened by an app of
 * data version 19 (spec 077 K1.5, K1.6): the sources made only for another
 * QUAY join their entry, and the tree stays in step — no changes the
 * research does not know, no "saved in another window", nothing sent.
 *
 * The migration's write is queued and lands later (as IndexedDB's does, the
 * more so with images in the pool): the base stored with the tree before it
 * must not take back the fingerprint the migration moved on (3.27.0-beta.5:
 * the stored base was read before the write landed). Variant: the tree in
 * step through a written send — that send's fingerprint follows too, and the
 * kept copy of the research's version stays readable.
 *
 * StorageManager is an in-memory, per-store Map whose writes land a macrotask
 * later (no IndexedDB in the node test env). All data is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}
/** Writes not landed yet (StorageManager.flush waits for them). */
const landing = new Set<Promise<void>>();
function later(write: () => void): Promise<void> {
    const p = new Promise<void>(resolve => setTimeout(() => { write(); resolve(); }, 5));
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
    createSnapshot: vi.fn(async () => undefined),
}));

import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { researchChangesMethods, forgetResearchChanges } from '../ui/research-changes-ui.js';
import { researchSyncMethods } from '../ui/research-sync-ui.js';
import { saveResearchCopy } from '../research-copy.js';
import { contentFingerprint } from '../research-link.js';
import { qualityOnlySources } from '../citation-quality.js';
import { researchAutoState, patchResearchAutoState } from '../research-device.js';
import { researchBaseKey, RESEARCH_COPY_FP_KEY } from '../storage-keys.js';
import { StromData, TreeId, TreeMetadata, ResearchLink } from '../types.js';

const TREE = 'quay-research' as TreeId;
const RESEARCH = '0f3c2a7e-5b1d-4c8e-9a6f-2d4e8b1c7a90';

/** A JPEG-looking data URL (pooled: long enough to be an image of its own). */
function image(): string {
    let s = '';
    for (let i = 0; i < 3000; i++) s += String.fromCharCode(65 + (i * 7) % 26);
    return 'data:image/jpeg;base64,' + s;
}

/**
 * The tree as 3.26 stored it: the census entry (with its transcript), and the
 * same entry made again only for the birth's other QUAY; a portrait in the pool.
 */
function storedBy326(): StromData {
    return {
        version: 18,
        persons: {
            p1: {
                id: 'p1', firstName: 'Drahoslav', lastName: 'Zlatoňák', gender: 'male', partnerships: [], parentIds: [], childIds: [],
                birthSourceIds: ['s1~1'], sourceIds: ['s1'], photo: image(),
            },
        },
        partnerships: {},
        sources: {
            s1: { id: 's1', title: 'Census 1921, Zlatoňákov 14', reference: 'p. 3', quality: 3, transcription: 'Drahoslav Zlatoňák, born 1890' },
            's1~1': { id: 's1~1', title: 'Census 1921, Zlatoňákov 14', reference: 'p. 3', quality: 1 },
        },
    } as unknown as StromData;
}

function meta(link: ResearchLink): TreeMetadata {
    return {
        id: TREE, name: 'Zlatoňák', createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 1, partnershipCount: 0, sizeBytes: 0, dataVersion: 18, research: link,
    };
}

/** localStorage of the node env: a plain Map. */
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

/**
 * Stored as 3.26 left it: the tree, the base stored with it, the index with
 * the tie, the research's version kept for `copyFp`.
 */
async function storeTree(data: StromData, link: ResearchLink, copyFp: string): Promise<void> {
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        unsettledSaves: Map<TreeId, unknown>; storedBases: Map<TreeId, unknown>;
    };
    tm.index = { version: 1, activeTreeId: TREE, trees: [meta(link)] };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    tm.unsettledSaves = new Map();
    tm.storedBases = new Map();
    st('trees').set(TREE, structuredClone(data));
    st('trees').set(researchBaseKey(TREE), { researchId: RESEARCH, head: link.head, fingerprint: link.fingerprint, at: 1 });
    localStorage.setItem(RESEARCH_COPY_FP_KEY + TREE, copyFp);
    await saveResearchCopy(TREE, data, copyFp);
    await TreeManager.flush();
}

/** The app started: the startup tree read (migrated) and its stored base adopted, as DataManager does. */
async function start(): Promise<void> {
    await (DataManager as unknown as { loadStartupTree: () => Promise<void> }).loadStartupTree();
}

const ui = researchChangesMethods as unknown as {
    researchSyncLink(): { treeId: TreeId; link: ResearchLink } | null;
    researchSyncFingerprints(treeId: TreeId, link: ResearchLink): { current: string; matchesBase: boolean };
    researchChangesReady(): Promise<unknown[] | null>;
    researchChangesNow(): unknown[] | null;
    refreshResearchSyncUi(): void;
    researchKeepCopy(treeId: TreeId, data: StromData, fp?: string): void;
};

function linkNow(): ResearchLink {
    return TreeManager.getTreeMetadata(TREE)!.research!;
}

beforeEach(() => {
    stores.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T10:12:00Z'));
    vi.stubGlobal('localStorage', memoryStorage());
    // The research's version this page kept of the tree in the test before.
    forgetResearchChanges(TREE);
    vi.stubGlobal('window', new EventTarget());
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    vi.spyOn(TreeManager, 'getStartupTreeId').mockReturnValue(TREE);
    // The sync UI's context, without the page.
    Object.assign(ui, {
        researchSyncLink: () => ({ treeId: TREE, link: linkNow() }),
        researchSyncFingerprints: researchSyncMethods.researchSyncFingerprints,
        refreshResearchSyncUi: () => undefined,
    });
    (DataManager as unknown as { currentTreeId: TreeId | null }).currentTreeId = TREE;
});

afterEach(async () => {
    await TreeManager.flush();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('a tree in step with its research through the data update to version 19 (spec 077 K1.6)', () => {
    it('in step with the version loaded: still in step once read, nothing to send, no other window', async () => {
        const data = storedBy326();
        expect(qualityOnlySources(data.sources).size).toBe(1);
        const was = contentFingerprint(data);
        await storeTree(data, { id: RESEARCH, head: 'h-2026-11-10', fingerprint: was, syncedAt: '2026-11-10T08:00:00Z' } as ResearchLink, was);

        await start();

        const now = DataManager.getData();
        expect(now.sources?.['s1~1']).toBeUndefined();
        const link = linkNow();
        // The link's fingerprint followed the data, and the base stored with them is the same one.
        expect(link.fingerprint).toBe(contentFingerprint(now));
        expect(link.fingerprint).not.toBe(was);
        expect(ui.researchSyncFingerprints(TREE, link).matchesBase).toBe(true);
        expect(await TreeManager.researchBaseMatches(TREE)).toBe(true);
        expect(TreeManager.researchBaseKnownMatches(TREE)).toBe(true);
        expect((st('trees').get(researchBaseKey(TREE)) as { fingerprint: string }).fingerprint).toBe(link.fingerprint);
        // The changes per person are known: none.
        expect(await ui.researchChangesReady()).not.toBeNull();
        expect(ui.researchChangesNow()).toEqual([]);
    });

    it('in step through a written send: that send\'s fingerprint follows, the kept copy is read, no changes', async () => {
        const loaded = storedBy326();
        // Loaded earlier, then a change sent and written by the research.
        const loadedFp = contentFingerprint(loaded);
        const data = structuredClone(loaded);
        data.persons['p1' as keyof typeof data.persons].notes = 'Miller at Zlatoňákov';
        const sentFp = contentFingerprint(data);
        await storeTree(data, {
            id: RESEARCH, head: 'h-2026-11-09', fingerprint: loadedFp, syncedAt: '2026-11-09T08:00:00Z',
            sent: { fingerprint: sentFp, at: '2026-11-10T09:00:00Z', changes: 1, head: 'h-2026-11-09', state: 'written', closedAt: '2026-11-10T09:01:00Z', intake: 'i-1' },
        } as ResearchLink, sentFp);
        patchResearchAutoState(TREE, { lastWritten: { at: '2026-11-10T09:01:00Z', changes: 1, conflicts: 0, intake: 'i-1', fingerprint: sentFp } });

        await start();

        const now = DataManager.getData();
        expect(now.sources?.['s1~1']).toBeUndefined();
        const link = linkNow();
        const current = contentFingerprint(now);
        // Nothing the research lacks: the state written is the one here.
        expect(link.sent?.fingerprint).toBe(current);
        expect(link.sent?.intake).toBe('i-1');
        expect(researchAutoState(TREE).lastWritten?.fingerprint).toBe(current);
        expect(localStorage.getItem(RESEARCH_COPY_FP_KEY + TREE)).toBe(current);
        expect(await TreeManager.researchBaseMatches(TREE)).toBe(true);
        expect(TreeManager.researchBaseKnownMatches(TREE)).toBe(true);
        // The kept copy stands for the send as written: the changes per person are known, none.
        expect(await ui.researchChangesReady()).toEqual([]);
    });

    it('a tree edited since it was in step keeps its link: its changes stay to be sent', async () => {
        const loaded = storedBy326();
        const loadedFp = contentFingerprint(loaded);
        const data = structuredClone(loaded);
        data.persons['p1' as keyof typeof data.persons].notes = 'Miller at Zlatoňákov';
        await storeTree(data, { id: RESEARCH, head: 'h-2026-11-09', fingerprint: loadedFp, syncedAt: '2026-11-09T08:00:00Z' } as ResearchLink, loadedFp);

        await start();

        const link = linkNow();
        expect(link.fingerprint).toBe(loadedFp);
        expect(ui.researchSyncFingerprints(TREE, link).matchesBase).toBe(false);
        expect(await TreeManager.researchBaseMatches(TREE)).toBe(true);
    });
});

describe('leaving the page: the base known at once (audit 017 a-D1)', () => {
    it('a stored base taken over this window\'s while its own write is on its way: nothing goes', async () => {
        const data = storedBy326();
        const was = contentFingerprint(data);
        await storeTree(data, { id: RESEARCH, head: 'h-1', fingerprint: was, syncedAt: '2026-11-10T08:00:00Z' } as ResearchLink, was);
        await start();
        expect(TreeManager.researchBaseKnownMatches(TREE)).toBe(true);
        // A write queued with this base, then the link put on another one before it lands.
        TreeManager.saveTreeData(TREE, DataManager.getData());
        TreeManager.patchResearchLink(TREE, { fingerprint: 'other' });
        expect(TreeManager.researchBaseKnownMatches(TREE)).toBe(false);
        await TreeManager.flush(TREE);
        expect(TreeManager.researchBaseKnownMatches(TREE)).toBe(false);
        // Stored again with the link's base: they agree.
        TreeManager.saveTreeData(TREE, DataManager.getData());
        expect(TreeManager.researchBaseKnownMatches(TREE)).toBe(true);
    });

    it('the send on leaving does not go while the base drifted, and goes once they agree', async () => {
        const data = storedBy326();
        const was = contentFingerprint(data);
        await storeTree(data, { id: RESEARCH, head: 'h-1', fingerprint: was, syncedAt: '2026-11-10T08:00:00Z', sendMode: 'auto' } as ResearchLink, was);
        await start();
        await TreeManager.flush();
        const now = vi.fn(async () => undefined);
        const page = { ...researchSyncMethods, postResearchSendNow: now, showToast: vi.fn() };
        const send = (): Promise<void> => researchSyncMethods.postResearchSend.call(page, TREE, { auto: true, keepalive: true });
        // The stored base unlike the link (its write landed with another one).
        TreeManager.patchResearchLink(TREE, { fingerprint: 'other' });
        await send();
        expect(now).not.toHaveBeenCalled();
        TreeManager.patchResearchLink(TREE, { fingerprint: contentFingerprint(DataManager.getData()) });
        await send();
        expect(now).toHaveBeenCalledTimes(1);
    });
});
