/**
 * Images arriving after the tree never cost the tree an image (spec 116,
 * K1.5, invariants I1–I5): a save while they come keeps the older image
 * (or none) and notes the rest with the tree for the next connect; a
 * portrait's source waits with the file it was cut from; undo, redo, a
 * dialog thrown away and the day's backup keep the images that came; the
 * pool's cleanup keeps the older image; a switch or a new load while they
 * come puts nothing anywhere. Through the real DataManager and TreeManager
 * over an in-memory store. Invented data only.
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
            return (st(store).get(key) as T) ?? null;
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
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, (st(store).get(k) as T) ?? null]));
        },
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { DataManager, migrateData } from '../data.js';
import { UndoManager } from '../undo.js';
import { AuditLogManager } from '../audit-log.js';
import { collectPoolGarbage } from '../media-pool.js';
import { getSnapshotJson, listSnapshots } from '../snapshots.js';
import {
    imageLoads, pendingFromNotes, resetImageLoads, startImageLoad, takePendingImages,
    type ImageLoadQueue, type PendingImage, type PendingImageNotes,
} from '../image-loads.js';
import { pendingImageUrl, sha256Hex, type ImageFetchDeps } from '../research-image-refs.js';
import { imageBySha } from '../renderer.js';
import { STROM_DATA_VERSION, toPersonId, type StromData, type TreeId, type TreeMetadata } from '../types.js';

/** A small JPEG; `salt` makes its bytes (and hash) its own. */
function jpeg(width: number, height: number, salt: number): Buffer {
    return Buffer.from([0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xFE, 0x00, 0x04, salt >> 8, salt & 0xFF,
        0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 0xFF, width >> 8, width & 0xFF,
        0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
        ...Array.from({ length: 600 }, (_, i) => (i * 7 + salt) & 0xFF),
        0xFF, 0xD9]);
}
const shaOf = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const urlOf = (b: Buffer): string => `data:image/jpeg;base64,${b.toString('base64')}`;
const standIn = (b: Buffer): string => pendingImageUrl({ sha: shaOf(b), mime: 'image/jpeg', bytes: b.length });

const OLD = jpeg(64, 64, 21);      // Velimír's portrait as stored
const NEW1 = jpeg(64, 64, 22);     // his portrait in the research's version
const NEW2 = jpeg(64, 64, 23);     // Vlastislava's portrait (none stored)
const FILE = jpeg(200, 100, 24);   // a file of Vlastislava's, her portrait cut from it
const CROP = jpeg(120, 80, 25);    // a crop of the parish book
const IMAGES = new Map([NEW1, NEW2, FILE, CROP].map(b => [shaOf(b), urlOf(b)]));

const T1 = 'tree_inv_1' as TreeId;
const T2 = 'tree_inv_2' as TreeId;
const URL_IMAGES = 'http://127.0.0.1:5994/abc/images';
const P1 = toPersonId('p1'), P2 = toPersonId('p2'), P3 = toPersonId('p3');
const PORTRAIT_SOURCE = { attachmentId: 'm1', region: { x: 0, y: 0, w: 0.5, h: 1 } };

function person(id: string, firstName: string, extra: Record<string, unknown> = {}) {
    return { id, firstName, lastName: 'Řeřichová', gender: 'female', partnerships: [], parentIds: [], childIds: [], ...extra };
}

/** The tree as stored before the research's version: Velimír's old portrait, the book without its crop. */
function storedTree(): StromData {
    return migrateData({
        version: STROM_DATA_VERSION,
        persons: { p1: person('p1', 'Velimír', { gender: 'male', photo: urlOf(OLD) }), p2: person('p2', 'Vlastislava'), p3: person('p3', 'Zdislava') },
        partnerships: {},
        sources: { s1: { id: 's1', title: 'Křestní matrika Mechovice 1851', excerpts: [] } },
    } as unknown as StromData);
}

/** The research's version as read: every new image a stand-in; the portrait of Vlastislava cut from her file. */
function versionRead(): StromData {
    const d = storedTree();
    d.persons[P1].photo = standIn(NEW1);
    d.persons[P2].photo = standIn(NEW2);
    d.persons[P2].photoSource = { ...PORTRAIT_SOURCE };
    d.media = { m1: { id: 'm1', name: 'dopis.jpg', mimeType: 'image/jpeg', dataUrl: standIn(FILE), sizeBytes: 1, places: [{ personId: P2 }] } } as never;
    d.sources!.s1.excerpts = [
        { id: 'e1', dataUrl: standIn(CROP), width: 120, height: 80, sizeBytes: 1 },
        // A crop the tree has, re-croppable from the file still to come.
        { id: 'e2', dataUrl: urlOf(OLD), width: 64, height: 64, sizeBytes: 1, fromAttachmentId: 'm1', region: { x: 0, y: 0, w: 0.5, h: 1 } },
    ] as never;
    return d;
}

function meta(id: TreeId, name: string): TreeMetadata {
    return { id, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01', personCount: 3, partnershipCount: 0, sizeBytes: 0 };
}

const dm = DataManager as unknown as {
    data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
    editSession: unknown; batchActive: boolean; batchDepth: number; windowSink: unknown;
    imageHistory: unknown; imagesUnstored: boolean; lastAutoSnapshotDay: Map<TreeId, string>;
};

function resetAll(): void {
    stores.clear();
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
    };
    tm.index = { version: 1, activeTreeId: T1, trees: [meta(T1, 'Strom A'), meta(T2, 'Strom B')] };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
    dm.data = storedTree();
    dm.currentTreeId = T1;
    dm.viewMode = false;
    dm.pendingBefore = null;
    dm.editSession = null;
    dm.batchActive = false;
    dm.batchDepth = 0;
    dm.windowSink = null;
    dm.imageHistory = null;
    dm.imagesUnstored = false;
    dm.lastAutoSnapshotDay = new Map();
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(T1);
}

/** The bridge's `POST /images`: each answer held until `release`. */
function bridge(): { deps: ImageFetchDeps; release(): void } {
    const waiting: (() => void)[] = [];
    let open = false;
    return {
        deps: {
            fetch: async (_url, init) => {
                const shas = (JSON.parse(String(init.body)) as { images: string[] }).images;
                if (!open) await new Promise<void>(r => waiting.push(r));
                if ((init.signal as AbortSignal | undefined)?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
                const images = shas.filter(s => IMAGES.has(s)).map(sha => ({ sha, mime: 'image/jpeg', data: IMAGES.get(sha)!.split(',')[1] }));
                return new Response(JSON.stringify({ images, missing: shas.filter(s => !IMAGES.has(s)), more: [] }), { status: 200 });
            },
            sha256Hex,
            sleep: async () => {},
        },
        release: () => { open = true; for (const r of waiting.splice(0)) r(); },
    };
}

/** What the app does with a research's version (research-ui applyResearch + researchLoadImagesLater): step 1, then step 2 held. */
function loadVersion(o: { history?: 'now' | 'all'; pending?: PendingImage[]; treeId?: TreeId } = {}): { q: ImageLoadQueue; release(): void } {
    const treeId = o.treeId ?? T1;
    let pending = o.pending;
    if (!pending) {
        const out = takePendingImages(versionRead(), DataManager.getData());
        DataManager.loadStromData(out.data);
        pending = out.pending;
    }
    DataManager.noteImageLoadStart(treeId, o.history);
    const b = bridge();
    const q = startImageLoad({
        treeId, url: URL_IMAGES, pending,
        deps: {
            fetch: b.deps,
            currentTreeId: () => DataManager.getCurrentTreeId(),
            write: (id, fills) => DataManager.writeArrivedImages(id as TreeId, fills) ?? [],
            store: id => DataManager.storeArrivedImages(id as TreeId),
            emit: () => {},
        },
    })!;
    TreeManager.setPendingImages(treeId, q.notes(!SettingsManager.isEncryptionEnabled()));
    return { q, release: b.release };
}

async function stored(id: TreeId = T1): Promise<StromData> {
    await TreeManager.flush(id);
    const r = await TreeManager.readTreeData(id);
    if (r.status !== 'ok') throw new Error(r.status);
    return r.data;
}

const indexed = (id: TreeId = T1): TreeMetadata | undefined =>
    (st('trees').get('_index') as { trees: TreeMetadata[] } | undefined)?.trees.find(t => t.id === id);

const live = (): StromData => DataManager.getData();
const name = (d: StromData, id = P3): string => d.persons[id].firstName;

function noStandIns(x: unknown): void {
    const json = JSON.stringify(x);
    expect(json).not.toContain('STROMPENDING');
    expect(json).not.toContain('strom-image:');
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T10:30:00Z'));
    vi.stubGlobal('window', new EventTarget());
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    vi.spyOn(TreeManager, 'noteUserChange').mockImplementation(() => {});
    resetAll();
});

afterEach(() => {
    resetImageLoads();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('I1: a save while the images come', () => {
    it('keeps the older image or none, never a stand-in; notes the rest with the tree; the data version stays', async () => {
        const l = loadVersion();
        // Noted by the save itself (not only when the load began).
        TreeManager.setPendingImages(T1, null);
        DataManager.updatePerson(P3, { firstName: 'Zdislava 2' });
        const d = await stored();
        expect(d.version).toBe(STROM_DATA_VERSION);
        expect(d.persons[P1].photo).toBe(urlOf(OLD));
        expect(d.persons[P2].photo).toBeUndefined();
        expect(d.media?.m1).toBeUndefined();
        expect(name(d)).toBe('Zdislava 2');
        noStandIns(d);

        // The index notes what had not come: by its place, with what the next connect needs.
        const notes = indexed()!.pendingImages!;
        expect(Object.keys(notes).sort()).toEqual(['excerpt:s1:e1', 'media:m1', 'person:p1:photo', 'person:p2:photo']);
        expect(notes['person:p2:photo']).toMatchObject({ ref: { sha: shaOf(NEW2) } });
        expect(notes['person:p2:photo'].expectTag).toBeUndefined();
        expect(notes['person:p1:photo'].expectTag).toEqual(expect.any(String));
        expect(notes['media:m1'].media).toMatchObject({ id: 'm1', places: [{ personId: P2 }] });
        expect(notes['excerpt:s1:e1'].excerpt?.record).toMatchObject({ id: 'e1', width: 120 });
        noStandIns(indexed());
        expect(JSON.stringify(indexed())).not.toContain('data:image');

        // All came: stored with them, the note gone.
        l.release();
        await l.q.whenIdle();
        const after = await stored();
        expect(after.persons[P1].photo).toBe(urlOf(NEW1));
        expect(after.persons[P2].photo).toBe(urlOf(NEW2));
        expect(after.media?.m1.dataUrl).toBe(urlOf(FILE));
        expect(after.sources?.s1.excerpts?.map(e => e.id)).toEqual(['e1', 'e2']);
        expect(indexed()!.pendingImages).toBeUndefined();
    });

    it('an encrypted tree notes only the images, no record of a file or crop (the index is not encrypted)', () => {
        vi.mocked(SettingsManager.isEncryptionEnabled).mockReturnValue(true);
        loadVersion();
        const notes = TreeManager.getTreeMetadata(T1)!.pendingImages!;
        expect(notes['media:m1'].media).toBeUndefined();
        expect(notes['excerpt:s1:e1'].excerpt).toBeUndefined();
        expect(JSON.stringify(notes)).not.toContain('dopis.jpg');
    });

    it('an index with noted images is read by this version as it is', async () => {
        const notes: PendingImageNotes = { 'person:p2:photo': { ref: { sha: shaOf(NEW2), mime: 'image/jpeg' }, owner: { personIds: [P2] } } };
        st('trees').set('_index', { version: 1, activeTreeId: T1, trees: [{ ...meta(T1, 'Strom A'), pendingImages: notes }] });
        (TreeManager as unknown as { initialized: boolean }).initialized = false;
        await TreeManager.init();
        expect(TreeManager.getTreeMetadata(T1)?.pendingImages).toEqual(notes);
    });

    it('the next connect asks for what the tree still lacks; a field the user changed meanwhile is let go', async () => {
        const first = loadVersion();
        const notes = structuredClone(TreeManager.getTreeMetadata(T1)!.pendingImages!);
        // The page closed before they came: what is stored, opened again.
        first.q.abort();
        resetImageLoads();
        dm.data = await stored();
        UndoManager.clear();
        DataManager.updatePerson(P1, { photo: urlOf(jpeg(64, 64, 30)) });   // the user's own portrait wins

        const waiting = pendingFromNotes(live(), notes);
        expect(waiting.map(p => p.key).sort()).toEqual(['excerpt:s1:e1', 'media:m1', 'person:p2:photo']);
        // Without the records (an encrypted tree): only the portraits.
        const bare = Object.fromEntries(Object.entries(notes).map(([k, n]) => [k, { ref: n.ref, owner: n.owner }]));
        expect(pendingFromNotes(live(), bare).map(p => p.key)).toEqual(['person:p2:photo']);

        const again = loadVersion({ pending: waiting, history: 'all' });
        again.release();
        await again.q.whenIdle();
        expect(live().persons[P1].photo).toBe(urlOf(jpeg(64, 64, 30)));
        expect(live().persons[P2].photo).toBe(urlOf(NEW2));
        expect(live().persons[P2].photoSource).toEqual(PORTRAIT_SOURCE);
        expect(live().media?.m1.dataUrl).toBe(urlOf(FILE));
        expect((await stored()).persons[P2].photo).toBe(urlOf(NEW2));
        expect(indexed()!.pendingImages).toBeUndefined();
    });
});

describe('a portrait cut from a file on its way', () => {
    it('keeps its source through a save while it comes and an open of what was stored; back once the file came', async () => {
        const l = loadVersion();
        // Not dropped by the load's validation: waiting aside.
        expect(live().persons[P2].photoSource).toBeUndefined();
        expect(imageLoads.current()!.notes(true)['media:m1'].portraits).toEqual([{ personId: P2, source: PORTRAIT_SOURCE }]);
        DataManager.updatePerson(P3, { firstName: 'Zdislava 2' });
        const opened = migrateData(await stored());
        // A crop cut from the file keeps its link while the file comes (no validation drops it).
        expect(opened.sources?.s1.excerpts?.find(e => e.id === 'e2')?.fromAttachmentId).toBe('m1');
        expect(TreeManager.getTreeMetadata(T1)!.pendingImages!['media:m1'].portraits).toEqual([{ personId: P2, source: PORTRAIT_SOURCE }]);

        l.release();
        await l.q.whenIdle();
        expect(live().persons[P2].photoSource).toEqual(PORTRAIT_SOURCE);
        const reopened = migrateData(await stored());
        expect(reopened.persons[P2].photoSource).toEqual(PORTRAIT_SOURCE);
        expect(reopened.sources?.s1.excerpts?.find(e => e.id === 'e2')?.fromAttachmentId).toBe('m1');
    });
});

describe('I3: undo and redo after an image came', () => {
    it('an edit, the image comes, undo: the image stays; redo: likewise', async () => {
        const l = loadVersion();
        DataManager.updatePerson(P3, { firstName: 'Zdislava 2' });
        l.release();
        await l.q.whenIdle();
        expect(DataManager.undo()).not.toBeNull();
        expect(name(live())).toBe('Zdislava');
        expect(live().persons[P1].photo).toBe(urlOf(NEW1));
        expect(live().persons[P2].photo).toBe(urlOf(NEW2));
        expect(live().media?.m1.dataUrl).toBe(urlOf(FILE));
        expect((await stored()).persons[P2].photo).toBe(urlOf(NEW2));
        expect(DataManager.redo()).not.toBeNull();
        expect(name(live())).toBe('Zdislava 2');
        expect(live().persons[P2].photo).toBe(urlOf(NEW2));
        expect(live().persons[P1].photo).toBe(urlOf(NEW1));
    });

    it('an edit undone while the image comes, then redone: the image stays', async () => {
        const l = loadVersion();
        DataManager.updatePerson(P3, { firstName: 'Zdislava 2' });
        DataManager.undo();
        l.release();
        await l.q.whenIdle();
        DataManager.redo();
        expect(name(live())).toBe('Zdislava 2');
        expect(live().persons[P2].photo).toBe(urlOf(NEW2));
    });

    it('undo back over the research\'s version: the images still to come go nowhere, nothing is noted', async () => {
        const l = loadVersion();
        DataManager.undo();
        expect(imageLoads.current()).toBeNull();
        expect(TreeManager.getTreeMetadata(T1)!.pendingImages).toBeUndefined();
        l.release();
        await l.q.whenIdle();
        expect(live().persons[P1].photo).toBe(urlOf(OLD));
        expect(live().persons[P2].photo).toBeUndefined();
        expect(live().media).toBeFalsy();
    });
});

describe('I2: a dialog open while the images come (the data)', () => {
    it('thrown away after an edit: the images that came stay, stored', async () => {
        const l = loadVersion();
        expect(DataManager.beginEditSession()).toBe(true);
        DataManager.updatePerson(P3, { firstName: 'Zdislava 2' });
        l.release();
        await l.q.whenIdle();
        expect(DataManager.rollbackEditSession()).toBe(true);
        expect(name(live())).toBe('Zdislava');
        expect(live().persons[P2].photo).toBe(urlOf(NEW2));
        expect(live().persons[P1].photo).toBe(urlOf(NEW1));
        expect((await stored()).persons[P2].photo).toBe(urlOf(NEW2));
    });

    it('thrown away or kept without an edit: the images that came are stored', async () => {
        for (const end of ['rollback', 'commit'] as const) {
            resetAll();
            const l = loadVersion();
            await stored();
            DataManager.beginEditSession();
            l.release();
            await l.q.whenIdle();
            expect((await stored()).persons[P2].photo).toBeUndefined();   // the dialog holds the save
            if (end === 'rollback') DataManager.rollbackEditSession();
            else DataManager.commitEditSession(null);
            expect((await stored()).persons[P2].photo, end).toBe(urlOf(NEW2));
            resetImageLoads();
        }
    });

    it('the satellites\' copy during a dialog (the state before it) has the images that came', async () => {
        const l = loadVersion();
        DataManager.beginEditSession();
        l.release();
        await l.q.whenIdle();
        expect((JSON.parse(DataManager.storedDataJson()) as StromData).persons[P2].photo).toBe(urlOf(NEW2));
        DataManager.rollbackEditSession();
    });
});

describe('I4: the pool\'s cleanup while the images come', () => {
    it('keeps the older image of a field waiting for its new one; the new one stored once it came', async () => {
        TreeManager.saveTreeData(T1, storedTree());
        await collectPoolGarbage();
        expect((await stored()).persons[P1].photo).toBe(urlOf(OLD));
        const l = loadVersion();
        DataManager.updatePerson(P3, { firstName: 'Zdislava 2' });
        await stored();
        await collectPoolGarbage();
        expect((await stored()).persons[P1].photo).toBe(urlOf(OLD));
        l.release();
        await l.q.whenIdle();
        await stored();
        await collectPoolGarbage();
        const d = await stored();
        expect(d.persons[P1].photo).toBe(urlOf(NEW1));
        expect(d.media?.m1.dataUrl).toBe(urlOf(FILE));
    });
});

describe('I5: the day\'s automatic backup', () => {
    it('waits for the images still to come and has those that came', async () => {
        const l = loadVersion();
        // The load's own step took the day's backup (the state before the version); a new day's first edit:
        vi.setSystemTime(new Date('2026-11-20T09:15:00Z'));
        DataManager.updatePerson(P3, { firstName: 'Zdislava 2' });
        await stored();
        await Promise.resolve();
        const autos = async () => (await listSnapshots(T1)).filter(s => s.reason === 'auto' && s.createdAt >= Date.parse('2026-11-20'));
        expect(await autos()).toHaveLength(0);
        l.release();
        await l.q.whenIdle();
        await vi.waitFor(async () => expect(await autos()).toHaveLength(1));
        const backup = JSON.parse((await getSnapshotJson((await autos())[0].id))!) as StromData;
        expect(name(backup)).toBe('Zdislava');
        expect(backup.persons[P2].photo).toBe(urlOf(NEW2));
        expect(backup.persons[P1].photo).toBe(urlOf(NEW1));
        noStandIns(backup);
    });
});

describe('step 2: another tree, another load, every way of saving', () => {
    it('another tree opened while they come: nothing goes into either tree; the first keeps its note', async () => {
        const l = loadVersion();
        await stored();
        dm.currentTreeId = T2;
        dm.data = storedTree();
        imageLoads.onTreeSwitch(T2);
        l.release();
        await l.q.whenIdle();
        expect(live().persons[P2].photo).toBeUndefined();
        expect((await stored(T1)).persons[P2].photo).toBeUndefined();
        expect(Object.keys(TreeManager.getTreeMetadata(T1)!.pendingImages!)).toContain('person:p2:photo');
        expect(TreeManager.getTreeMetadata(T2)!.pendingImages).toBeUndefined();
    });

    it('a new load of the tree while they come: the first load goes nowhere, its note goes', async () => {
        const l = loadVersion();
        DataManager.loadStromData(storedTree());
        expect(TreeManager.getTreeMetadata(T1)!.pendingImages).toBeUndefined();
        l.release();
        await l.q.whenIdle();
        expect(live().persons[P2].photo).toBeUndefined();
        expect(live().persons[P1].photo).toBe(urlOf(OLD));
    });

    it('the person dialog saving through the data API while they come: the image still comes', async () => {
        const l = loadVersion();
        // The dialog saves the photo it shows: the older one, or none.
        DataManager.updatePerson(P1, { firstName: 'Velimír 2', photo: urlOf(OLD) });
        DataManager.updatePerson(P2, { firstName: 'Vlastislava 2', photo: undefined });
        expect((await stored()).persons[P1].photo).toBe(urlOf(OLD));
        l.release();
        await l.q.whenIdle();
        const d = await stored();
        expect(d.persons[P1]).toMatchObject({ firstName: 'Velimír 2', photo: urlOf(NEW1) });
        expect(d.persons[P2]).toMatchObject({ firstName: 'Vlastislava 2', photo: urlOf(NEW2) });
    });

    it('a new tree from the version (import): stored without stand-ins, noted, filled', async () => {
        const out = takePendingImages(versionRead(), null);
        const id = await DataManager.importAsNewTree(out.data, 'Strom C');
        UndoManager.setActiveTree(id);
        noStandIns(await stored(id));
        const l = loadVersion({ pending: out.pending, treeId: id });
        expect(Object.keys(TreeManager.getTreeMetadata(id)!.pendingImages!)).toHaveLength(4);
        l.release();
        await l.q.whenIdle();
        const d = await stored(id);
        expect(d.persons[P1].photo).toBe(urlOf(NEW1));
        expect(d.persons[P2].photoSource).toEqual(PORTRAIT_SOURCE);
        expect(TreeManager.getTreeMetadata(id)!.pendingImages).toBeUndefined();
    });

    it('a backup taken while they come: the older image or none, no stand-in', async () => {
        loadVersion();
        const id = await DataManager.snapshotNow('manual');
        const backup = JSON.parse((await getSnapshotJson(id!))!) as StromData;
        expect(backup.persons[P1].photo).toBe(urlOf(OLD));
        expect(backup.persons[P2].photo).toBeUndefined();
        noStandIns(backup);
    });
});

describe('I7: a card tells a portrait that comes by its hash', () => {
    const sha = shaOf(NEW2);
    const shell = (photo: boolean) => `<div class="person-card female has-avatar${photo ? ' has-photo' : ''}" data-id="p2"></div>`;
    const inner = (img: string) => `<div class="card-body"><div class="card-avatar-wrap"><div class="card-avatar" data-img-sha="${sha}">${img}</div></div>`
        + `<div class="name"><span class="name-text">Vlastislava Řeřichová</span></div>`
        + `<div class="card-tooltip${img.startsWith('<img') ? ' has-photo' : ''}" data-img-sha="${sha}">${img.startsWith('<img') ? `<img class="tt-photo" src="${urlOf(NEW2)}" alt="">` : ''}<div class="tt-body">*1862</div></div></div>`;

    it('the image that came is no change of the card; a change of its text is', () => {
        const before = imageBySha(shell(false), inner('<span class="avatar-initials">LV</span>'));
        const after = imageBySha(shell(true), inner(`<img src="${urlOf(NEW2)}" alt="">`));
        expect(after).toBe(before);
        expect(after).not.toContain('data:image');
        expect(imageBySha(shell(true), inner(`<img src="${urlOf(NEW2)}" alt="">`).replace('Vlastislava', 'Vlastislava 2'))).not.toBe(before);
        // A portrait no load brings: compared as it is.
        const plain = (img: string) => imageBySha(shell(true), `<div class="card-avatar">${img}</div>`);
        expect(plain(`<img src="${urlOf(OLD)}">`)).not.toBe(plain(`<img src="${urlOf(NEW1)}">`));
    });
});
