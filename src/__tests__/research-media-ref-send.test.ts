/**
 * A send to a research that takes pictures by reference (spec 133 U1): it
 * asks `media/known`, sends what the research holds by reference, and after
 * a refusal `sync.mediaRef-unknown` sends the same tree once more with every
 * picture's data — once, nothing told. Without the feature the send is as ever.
 *
 * StorageManager is an in-memory Map; fetch is a stub for the bridge. All data is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

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
import { saveResearchCopy } from '../research-copy.js';
import { RESEARCH_COPY_FP_KEY } from '../storage-keys.js';
import { contentFingerprint } from '../research-link.js';
import { forgetMediaRefMemory } from '../research-media-ref.js';
import { StromData, TreeId, TreeMetadata, ResearchLink, PersonId } from '../types.js';

const LINKED = 'linked-tree' as TreeId;
const RESEARCH = '7e2b5c10-3a4d-4c8e-9f61-2d0a8b4e6c17';

const bytesOf = (n: number): Buffer => Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 31 + n * 97) % 256));
const jpeg = (n: number): string => `data:image/jpeg;base64,${bytesOf(n).toString('base64')}`;
const sha = (n: number): string => createHash('sha256').update(bytesOf(n)).digest('hex');
const ORIG = 'e5'.repeat(32);

function person(id: string, firstName: string, refn?: string, extra: Record<string, unknown> = {}): StromData['persons'][PersonId] {
    return {
        id, firstName, lastName: 'Kallstrom', gender: 'male', partnerships: [], parentIds: [], childIds: [], isPlaceholder: false,
        ...(refn ? { refn } : {}), ...extra,
    } as unknown as StromData['persons'][PersonId];
}

/** 12 people of the research (the first two with portraits), a source with two excerpts; `added` new people. */
function tree(added = 0): StromData {
    const persons: StromData['persons'] = {};
    for (let i = 1; i <= 12; i++) {
        persons[`r${i}` as PersonId] = person(`r${i}`, `Edvin${i}`, `P${String(i).padStart(4, '0')}`, i <= 2 ? { photo: jpeg(i) } : {});
    }
    for (let i = 1; i <= added; i++) persons[`a${i}` as PersonId] = person(`a${i}`, `Nykomling${i}`);
    return {
        version: 19, persons, partnerships: {},
        sources: {
            s1: { id: 's1', title: 'Church book of Vallby', excerpts: [
                { id: 'x1', dataUrl: jpeg(20), width: 10, height: 10, sizeBytes: 600, clip: 'K0003', originalSha: ORIG },
                { id: 'x2', dataUrl: jpeg(21), width: 10, height: 10, sizeBytes: 600 },
            ] },
        },
    } as unknown as StromData;
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

let posts: Array<{ url: string; body: string }> = [];
/** The bridge's answers to the sends, in turn (the last one repeats). */
let syncAnswers: Array<{ status: number; body: unknown }> = [];
let syncCount = 0;

type Page = typeof researchSyncMethods & typeof researchChangesMethods;

function page(features: string[] | null): Page {
    return Object.assign(Object.create(null), researchChangesMethods, researchSyncMethods, {
        researchSyncCapable: () => true,
        researchBridgeFresh: () => true,
        researchBridgeKnownDown: () => false,
        researchWriteHeldNow: () => null,
        askResearchBridge: async () => ({ head: 'h-2' }),
        researchBridgeVersion: () => '1.37.0',
        researchStatusOf: () => (features ? { features } : null),
        researchHeld: () => null,
        researchNoteSending: () => undefined,
        researchConnectionNote: () => null,
        researchUndoneConflicts: () => 0,
        maybeAskResearchSendMode: () => undefined,
        scheduleResearchAutoSend: () => undefined,
        refreshResearchSyncUi: () => undefined,
        showToast: vi.fn(),
        tellResearchAutoStopped: vi.fn(),
    }) as Page;
}

async function start(open: StromData, base: StromData): Promise<void> {
    const baseFp = contentFingerprint(base);
    const link = { id: RESEARCH, head: 'h-1', fingerprint: baseFp, syncedAt: '2026-11-15T13:00:00Z', sendMode: 'manual' } as ResearchLink;
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        unsettledSaves: Map<TreeId, unknown>; storedBases: Map<TreeId, unknown>;
    };
    tm.index = { version: 1, activeTreeId: LINKED, trees: [meta(LINKED, 'Kallstrom', link)] };
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

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 2));
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const syncPosts = () => posts.filter(p => new URL(p.url).pathname.endsWith('/sync'));
const knownPosts = () => posts.filter(p => new URL(p.url).pathname.endsWith('/media/known'));
/** The excerpts of a send, in order: whether each carries its data. */
const excerptData = (body: string) => body.split('\n1 OBJE\n').filter(b => b.includes('_STROM_KIND excerpt')).map(b => b.includes('2 FILE data:'));

beforeEach(() => {
    stores.clear();
    posts = [];
    syncAnswers = [];
    syncCount = 0;
    forgetMediaRefMemory();
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        if (init?.method !== 'POST') throw new TypeError('not here');
        posts.push({ url: String(url), body: String(init.body ?? '') });
        if (new URL(String(url)).pathname.endsWith('/media/known')) {
            const asked: string[] = JSON.parse(String(init.body)).shas;
            // Portrait 1 held, portrait 2 waiting in the queue.
            return json(200, { known: Object.fromEntries(asked.map(s => [s, s === sha(1) ? { id: 'I0001', kind: 'image', mime: 'image/jpeg', bytes: 600, here: true } : s === sha(2) ? { queued: true } : null])) });
        }
        const a = syncAnswers[Math.min(syncCount++, syncAnswers.length - 1)];
        return json(a.status, a.body);
    }));
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    forgetResearchChanges(LINKED);
});

afterEach(async () => {
    await settle();
    forgetResearchChanges(LINKED);
    forgetMediaRefMemory();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const REFUSED = { status: 409, body: { ok: false, code: 'sync.mediaRef-unknown', error: 'A picture by reference is not here.', shas: [sha(1)] } };

describe('a send with pictures by reference (spec 133 U1)', () => {
    it('what the research holds goes by reference; refused, the same tree goes once with every picture\'s data, nothing told', async () => {
        await start(tree(1), tree());
        syncAnswers = [REFUSED, { status: 503, body: { ok: false, error: 'busy' } }];
        const ui = page(['sync.mediaRef', 'media.known']);
        await ui.postResearchSendNow(LINKED, { auto: true });
        await settle();
        expect(knownPosts()).toHaveLength(1);
        // Asked: the two portraits (the excerpt with a clip needs no asking, the other has no original).
        expect(JSON.parse(knownPosts()[0].body).shas.sort()).toEqual([sha(1), sha(2)].sort());
        const sends = syncPosts();
        expect(sends).toHaveLength(2);
        expect(sends[0].body).toContain(`_STROM_DATA ${sha(1)}`);
        expect(sends[0].body.match(/_STROM_DATA/g)).toHaveLength(1);
        expect(excerptData(sends[0].body)).toEqual([false, true]);
        expect(sends[0].body).toContain('2 _STROM_CLIP K0003');
        // Again with data: no reference at all, every excerpt with its FILE.
        expect(sends[1].body).not.toContain('_STROM_DATA');
        expect(excerptData(sends[1].body)).toEqual([true, true]);
        expect(sends[1].body.match(/ FILE data:image\/jpeg/g)).toHaveLength(4);
        expect(sends[1].body.length).toBeGreaterThan(sends[0].body.length);
        expect((ui as unknown as { showToast: ReturnType<typeof vi.fn> }).showToast).not.toHaveBeenCalled();
        const info = (console.info as unknown as ReturnType<typeof vi.fn>).mock.calls;
        expect(info.some(c => c[0] === 'Research send' && c[1].withData === false && c[1].filesRef === 1 && c[1].excerptsRef === 1)).toBe(true);
        expect(info.some(c => c[0] === 'Research send' && c[1].withData === true && c[1].filesRef === 0 && c[1].excerptsData === 2)).toBe(true);

        // The next send: the refused portrait goes with data, the excerpt with a clip still by reference.
        syncAnswers = [{ status: 503, body: { ok: false, error: 'busy' } }];
        syncCount = 0;
        posts = [];
        await ui.postResearchSendNow(LINKED, { auto: true });
        await settle();
        expect(syncPosts()).toHaveLength(1);
        expect(syncPosts()[0].body).not.toContain('_STROM_DATA');
        expect(excerptData(syncPosts()[0].body)).toEqual([false, true]);
    });

    it('refused again after the send with data: no third send', async () => {
        await start(tree(1), tree());
        syncAnswers = [REFUSED];
        const ui = page(['sync.mediaRef', 'media.known']);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await ui.postResearchSendNow(LINKED, { auto: true });
        await settle();
        expect(syncPosts()).toHaveLength(2);
        expect(syncPosts()[1].body).not.toContain('_STROM_DATA');
        expect(excerptData(syncPosts()[1].body)).toEqual([true, true]);
        // The second refusal is a refusal as any.
        expect((ui as unknown as { tellResearchAutoStopped: ReturnType<typeof vi.fn> }).tellResearchAutoStopped).toHaveBeenCalledTimes(1);
    });

    it('a bridge without sync.mediaRef: nothing asked, every picture with its data, as ever', async () => {
        await start(tree(1), tree());
        syncAnswers = [{ status: 503, body: { ok: false, error: 'busy' } }];
        for (const features of [null, ['media.known', 'media.app']]) {
            posts = [];
            syncCount = 0;
            await page(features).postResearchSendNow(LINKED, { auto: true });
            await settle();
            expect(knownPosts()).toHaveLength(0);
            expect(syncPosts()).toHaveLength(1);
            expect(syncPosts()[0].body).not.toContain('_STROM_DATA');
            expect(excerptData(syncPosts()[0].body)).toEqual([true, true]);
            expect(console.info).not.toHaveBeenCalled();
        }
    });
});
