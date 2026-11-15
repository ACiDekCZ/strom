/**
 * A send that is not the tree's own (1115-app-prepnuti-stromu): its people
 * hardly name anyone of the research's version the tree builds on — another
 * tree's data under this tree's tie, the sample tree. It never goes
 * (foreignSendCheck before the post), and a send taken back that was so is
 * not offered again: "Load the research's version" is the block's main action.
 *
 * StorageManager is an in-memory Map; fetch is a stub that records each POST
 * to the bridge. All data is invented.
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
import { researchSyncMethods } from '../ui/research-sync-ui.js';
import { researchChangesMethods, forgetResearchChanges } from '../ui/research-changes-ui.js';
import { saveResearchCopy, saveResearchPrevCopy } from '../research-copy.js';
import { RESEARCH_COPY_FP_KEY, RESEARCH_PREV_COPY_FP_KEY } from '../storage-keys.js';
import { contentFingerprint } from '../research-link.js';
import { foreignSendCheck, researchRefsOf, FOREIGN_SEND_MIN_BASE } from '../research-foreign-send.js';
import { StromData, TreeId, TreeMetadata, ResearchLink, ResearchSend, PersonId } from '../types.js';

const LINKED = 'linked-tree' as TreeId;
const RESEARCH = '4d7c1a92-5e3b-4f06-a8d2-9b1e6c3f7a05';

function person(id: string, firstName: string, lastName: string, refn?: string, placeholder = false): StromData['persons'][PersonId] {
    return {
        id, firstName, lastName, gender: 'male', partnerships: [], parentIds: [], childIds: [], isPlaceholder: placeholder,
        ...(refn ? { refn } : {}),
    } as unknown as StromData['persons'][PersonId];
}

/** `n` people of the research (P0001…), and `added` new ones without a number. */
function tree(n: number, added = 0, from = 1): StromData {
    const persons: StromData['persons'] = {};
    for (let i = from; i < from + n; i++) persons[`r${i}` as PersonId] = person(`r${i}`, `Kvetoslav${i}`, 'Hrabanek', `P${String(i).padStart(4, '0')}`);
    for (let i = 1; i <= added; i++) persons[`a${i}` as PersonId] = person(`a${i}`, `Novy${i}`, 'Pridany');
    return { version: 19, persons, partnerships: {} } as unknown as StromData;
}

/** Another family altogether: `n` people without the research's numbers. */
function otherTree(n: number): StromData {
    const persons: StromData['persons'] = {};
    for (let i = 1; i <= n; i++) persons[`o${i}` as PersonId] = person(`o${i}`, `Vzorek${i}`, 'Ukazkovy');
    return { version: 19, persons, partnerships: {} } as unknown as StromData;
}

describe('foreignSendCheck: the people sent against the research\'s numbers of the base', () => {
    const base = (n: number): Set<string> => researchRefsOf(tree(n));

    it('a copy of another family (no number of the base) is foreign', () => {
        expect(foreignSendCheck(base(954), otherTree(30))).toEqual({ foreign: true, base: 954, persons: 30, kept: 0 });
    });

    it('under a tenth of the base and of the people sent: foreign; over it: not', () => {
        // 4 of 50 (8 %) among 44 sent (9 %).
        const under = { ...otherTree(40), persons: { ...otherTree(40).persons, ...tree(4).persons } };
        expect(foreignSendCheck(base(50), under).foreign).toBe(true);
        // 6 of 50 (12 %) among 46 sent (13 %).
        const over = { ...otherTree(40), persons: { ...otherTree(40).persons, ...tree(6).persons } };
        expect(foreignSendCheck(base(50), over).foreign).toBe(false);
    });

    it('a small research (fewer than ten numbered people in the base) is never checked', () => {
        expect(FOREIGN_SEND_MIN_BASE).toBe(10);
        expect(foreignSendCheck(base(9), otherTree(30)).foreign).toBe(false);
        expect(foreignSendCheck(base(10), otherTree(30)).foreign).toBe(true);
    });

    it('a base without the research\'s numbers is never checked', () => {
        expect(foreignSendCheck(researchRefsOf(otherTree(200)), otherTree(30)).foreign).toBe(false);
        expect(foreignSendCheck(new Set(), otherTree(30)).foreign).toBe(false);
    });

    it('the tree itself, many people added to it, or cut down to a branch is not foreign', () => {
        expect(foreignSendCheck(base(954), tree(954, 3)).foreign).toBe(false);
        // All 12 of the base kept, 500 added (2 % of those sent carry a number).
        expect(foreignSendCheck(base(12), tree(12, 500)).foreign).toBe(false);
        // 40 of 954 left (4 % of the base), all of them numbered.
        expect(foreignSendCheck(base(954), tree(40)).foreign).toBe(false);
    });

    it('nobody sent counts as foreign; placeholders do not count', () => {
        expect(foreignSendCheck(base(20), otherTree(0)).foreign).toBe(true);
        const withPlaceholders = tree(0);
        for (let i = 1; i <= 20; i++) withPlaceholders.persons[`ph${i}` as PersonId] = person(`ph${i}`, '', '', `P${String(i).padStart(4, '0')}`, true);
        expect(foreignSendCheck(base(20), withPlaceholders).foreign).toBe(true);
        expect(researchRefsOf(withPlaceholders).size).toBe(0);
    });
});

// ---- The send and the block of a send taken back ----

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

let posts: Array<{ url: string; body: string }> = [];

type Page = typeof researchSyncMethods & typeof researchChangesMethods;

/** The sync UI's and the change list's methods with the page's other parts left out (no DOM). */
function page(): Page {
    return Object.assign(Object.create(null), researchChangesMethods, researchSyncMethods, {
        researchSyncCapable: () => true,
        researchBridgeFresh: () => true,
        researchBridgeKnownDown: () => false,
        researchWriteHeldNow: () => null,
        askResearchBridge: async () => ({ head: 'h-2' }),
        researchBridgeVersion: () => '1.33.0',
        researchStatusOf: () => null,
        researchHeld: () => null,
        researchNoteSending: () => undefined,
        researchConnectionNote: () => null,
        researchUndoneConflicts: () => 0,
        maybeAskResearchSendMode: () => undefined,
        scheduleResearchAutoSend: () => undefined,
        refreshResearchSyncUi: () => undefined,
        showToast: () => undefined,
    }) as Page;
}

/** The tree tied to a research open with `open`; the research's version it builds on kept as `base`. */
async function start(open: StromData, base: StromData, sent?: ResearchSend): Promise<void> {
    const baseFp = contentFingerprint(base);
    const link = { id: RESEARCH, head: 'h-1', fingerprint: baseFp, syncedAt: '2026-11-15T13:00:00Z', sendMode: 'manual',
        ...(sent ? { sent } : {}) } as ResearchLink;
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        unsettledSaves: Map<TreeId, unknown>; storedBases: Map<TreeId, unknown>;
    };
    tm.index = { version: 1, activeTreeId: LINKED, trees: [meta(LINKED, 'Hrabanek', link)] };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    tm.unsettledSaves = new Map();
    tm.storedBases = new Map();
    st('trees').set(LINKED, open);
    await saveResearchCopy(LINKED, base, baseFp);
    localStorage.setItem(RESEARCH_COPY_FP_KEY + LINKED, baseFp);
    localStorage.setItem('strom-research-bridge:' + RESEARCH, JSON.stringify({ base: 'http://127.0.0.1:47321/t0k3n' }));
    vi.spyOn(TreeManager, 'getStartupTreeId').mockReturnValue(LINKED);
    await (DataManager as unknown as { loadStartupTree: () => Promise<void> }).loadStartupTree();
    expect(DataManager.getCurrentTreeId()).toBe(LINKED);
}

/** The research wrote `sentData` (kept as its version, the base before it as the previous copy), then took it back. */
async function keepTakenBack(sentData: StromData, base: StromData): Promise<ResearchSend> {
    const sentFp = contentFingerprint(sentData);
    await saveResearchCopy(LINKED, sentData, sentFp);
    localStorage.setItem(RESEARCH_COPY_FP_KEY + LINKED, sentFp);
    const baseFp = contentFingerprint(base);
    await saveResearchPrevCopy(LINKED, base, baseFp);
    localStorage.setItem(RESEARCH_PREV_COPY_FP_KEY + LINKED, baseFp);
    return { fingerprint: sentFp, at: '2026-11-15T14:15:00Z', changes: 30, head: '', state: 'undone',
        closedAt: '2026-11-15T14:40:00Z', intake: 'R0042', noticed: true };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 2));
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
    forgetResearchChanges(LINKED);
});

afterEach(async () => {
    await settle();
    forgetResearchChanges(LINKED);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('a send that is not the tree\'s own never goes (1115-app-prepnuti-stromu)', () => {
    it('another family open under the tie: nothing posted, said for developers; the changes still wait', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await start(otherTree(30), tree(40));
        const ui = page();
        await ui.postResearchSendNow(LINKED, { auto: true });
        await ui.postResearchSendNow(LINKED, { auto: false });
        // Leaving the page: what the sends before read of the copy holds it back too.
        await ui.postResearchSendNow(LINKED, { auto: true, keepalive: true });
        await settle();
        expect(posts).toEqual([]);
        expect(warn.mock.calls.some(c => String(c[0]).includes('hardly names the research'))).toBe(true);
        // Nothing marked as sent: the state stays "to send", a send can be asked again.
        expect(TreeManager.getTreeMetadata(LINKED)?.research?.sent).toBeUndefined();
    });

    it('the tree\'s own people with an edit go', async () => {
        const own = tree(40, 1);
        await start(own, tree(40));
        await page().postResearchSendNow(LINKED, { auto: false });
        await settle();
        expect(posts).toHaveLength(1);
        expect(posts[0].body).toContain('_STROM_APP_TREE ' + LINKED);
        expect(posts[0].body).toContain('Pridany');
    });

    it('a small research (fewer than ten numbered people) is not held back', async () => {
        await start(otherTree(5), tree(6));
        await page().postResearchSendNow(LINKED, { auto: false });
        await settle();
        expect(posts).toHaveLength(1);
    });
});

describe('a send taken back that was not the tree\'s own (1115-app-prepnuti-stromu)', () => {
    it('another family written, then taken back: no Send again, Load the research\'s version is the main action', async () => {
        const base = tree(40);
        const sent = await keepTakenBack(otherTree(30), base);
        await start(tree(40, 1), base, sent);
        // keepTakenBack's copies replace what start kept.
        await keepTakenBack(otherTree(30), base);
        const ui = page();
        // The copies are read first (the block is drawn again once they are).
        expect(ui.researchKeptSendForeign(LINKED, [sent.fingerprint])).toBeNull();
        await settle();
        const link = TreeManager.getTreeMetadata(LINKED)!.research!;
        expect(ui.researchUndoneForeign(LINKED, link)).toBe(true);
        const block = ui.researchUndoneBlock(LINKED, false, link.sent);
        expect(block.actions.map(a => a.action)).not.toContain('sendAgain');
        expect(block.actions[0]).toEqual({ action: 'acceptUndo', label: "Load the research's version" });
        expect(block.sub).toContain("did not carry this tree's people");

        // Send again asked anyway (an older toast): nothing written there again.
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await ui.postResearchSendNow(LINKED, { auto: false, undoAgain: true });
        await settle();
        expect(posts).toEqual([]);
    });

    it('the tree\'s own send taken back: Send again as before, loading its version beside it', async () => {
        const base = tree(40);
        const sentData = tree(40, 2);
        const sent = await keepTakenBack(sentData, base);
        await start(tree(40, 2), base, sent);
        await keepTakenBack(sentData, base);
        const ui = page();
        ui.researchKeptSendForeign(LINKED, [sent.fingerprint]);
        await settle();
        const link = TreeManager.getTreeMetadata(LINKED)!.research!;
        expect(ui.researchUndoneForeign(LINKED, link)).toBe(false);
        const block = ui.researchUndoneBlock(LINKED, false, link.sent);
        expect(block.actions[0].action).toBe('sendAgain');
        expect(block.actions.find(a => a.action === 'acceptUndo')?.asLink).toBe(true);
    });

    it('the research\'s record names another app tree: not offered again', async () => {
        const base = tree(40);
        const sent: ResearchSend = { fingerprint: 'f-other', at: '2026-11-15T14:15:00Z', changes: 3, head: '', state: 'undone',
            closedAt: '2026-11-15T14:40:00Z', intake: 'R0043', noticed: true };
        await start(tree(40, 1), base, sent);
        const ui = page();
        (ui as unknown as { researchStatusOf: () => unknown }).researchStatusOf = () => ({
            sends: [{ intake: 'R0043', state: 'undone', tree: 'another-app-tree', sent: 'f-other' }],
        });
        const link = TreeManager.getTreeMetadata(LINKED)!.research!;
        expect(ui.researchUndoneForeign(LINKED, link)).toBe(true);
    });
});
