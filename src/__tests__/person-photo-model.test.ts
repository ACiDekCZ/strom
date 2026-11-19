/**
 * The person dialog's portrait while photos come after the tree (spec 116
 * K1.5, PLAN I2): the dialog holds its portrait as a value of its own and
 * Save writes it only when it was changed there. Every way out of the dialog
 * (Save with nothing changed, Save after the photo came, a photo chosen, a
 * photo removed, a new crop, Cancel) against the real DataManager and the
 * real load of images, the bridge held until the test lets it answer.
 * Invented data only.
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
import { imageLoads, resetImageLoads, startImageLoad, takePendingImages, type ImageLoadQueue } from '../image-loads.js';
import { pendingImageUrl, sha256Hex } from '../research-image-refs.js';
import { STROM_DATA_VERSION, toPersonId, type PersonId, type StromData, type TreeId, type TreeMetadata } from '../types.js';
import {
    openPhotoModel, personPhotoKey, setModelPhoto, photoModelState, photoArrived, photoFollowsData,
    photoSaveFields, photoSaved, photoChanged, canRecropPhoto, type PhotoModel,
} from '../ui/person-photo-model.js';

/** A small JPEG; `salt` makes its bytes (and hash) its own. */
function jpeg(salt: number): Buffer {
    return Buffer.from([0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xFE, 0x00, 0x04, salt >> 8, salt & 0xFF,
        0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 64, 0x00, 64,
        0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
        ...Array.from({ length: 400 }, (_, i) => (i * 5 + salt) & 0xFF),
        0xFF, 0xD9]);
}
const shaOf = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const urlOf = (b: Buffer): string => `data:image/jpeg;base64,${b.toString('base64')}`;
const standIn = (b: Buffer): string => pendingImageUrl({ sha: shaOf(b), mime: 'image/jpeg', bytes: b.length });

const OLD = jpeg(41);      // Velimír's portrait as stored
const NEW1 = jpeg(42);     // his portrait in the research's version
const NEW2 = jpeg(43);     // Vlastislava's portrait (none stored)
const CHOSEN = urlOf(jpeg(44));  // a photo chosen in the dialog
const CROP = urlOf(jpeg(45));    // a new crop made in the dialog

const T1 = 'tree_ppm_1' as TreeId;
const P1 = toPersonId('p1'), P2 = toPersonId('p2');
const K1 = personPhotoKey(P1), K2 = personPhotoKey(P2);

function person(id: string, firstName: string, extra: Record<string, unknown> = {}) {
    return { id, firstName, lastName: 'Řeřichová', gender: 'female', partnerships: [], parentIds: [], childIds: [], ...extra };
}

function storedTree(): StromData {
    return migrateData({
        version: STROM_DATA_VERSION,
        persons: { p1: person('p1', 'Velimír', { gender: 'male', photo: urlOf(OLD) }), p2: person('p2', 'Vlastislava') },
        partnerships: {},
    } as unknown as StromData);
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
    tm.index = { version: 1, activeTreeId: T1, trees: [{ id: T1, name: 'Strom A', createdAt: '2026-01-01', lastModifiedAt: '2026-01-01', personCount: 2, partnershipCount: 0, sizeBytes: 0 }] };
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

/**
 * The research's version loaded (both portraits new, still to come) and the
 * bridge held: `release` lets it answer; the images in `absent` it does not
 * have (they fail) until `provide` adds them.
 */
function loadVersion(absent: Buffer[] = []): { q: ImageLoadQueue; release(): void; provide(b: Buffer): void } {
    const have = new Map([NEW1, NEW2].filter(b => !absent.includes(b)).map(b => [shaOf(b), urlOf(b)]));
    const d = storedTree();
    d.persons[P1].photo = standIn(NEW1);
    d.persons[P2].photo = standIn(NEW2);
    const out = takePendingImages(d, DataManager.getData());
    DataManager.loadStromData(out.data);
    DataManager.noteImageLoadStart(T1);
    const waiting: (() => void)[] = [];
    let open = false;
    const q = startImageLoad({
        treeId: T1, url: 'http://127.0.0.1:5994/abc/images', pending: out.pending,
        deps: {
            fetch: {
                fetch: async (_url, init) => {
                    const shas = (JSON.parse(String(init.body)) as { images: string[] }).images;
                    if (!open) await new Promise<void>(r => waiting.push(r));
                    const images = shas.filter(s => have.has(s)).map(sha => ({ sha, mime: 'image/jpeg', data: have.get(sha)!.split(',')[1] }));
                    return new Response(JSON.stringify({ images, missing: shas.filter(s => !have.has(s)), more: [] }), { status: 200 });
                },
                sha256Hex,
                sleep: async () => {},
            },
            currentTreeId: () => DataManager.getCurrentTreeId(),
            write: (id, fills) => DataManager.writeArrivedImages(id as TreeId, fills) ?? [],
            store: id => DataManager.storeArrivedImages(id as TreeId),
            emit: () => {},
        },
    })!;
    return {
        q,
        release: () => { open = true; for (const r of waiting.splice(0)) r(); },
        provide: (b: Buffer) => { have.set(shaOf(b), urlOf(b)); },
    };
}

/** The dialog opened on a person, as person-modal does. */
const openDialog = (id: PersonId): PhotoModel => openPhotoModel(id, DataManager.getPerson(id)?.photo);

/** The dialog's Save, as savePerson does: its fields (a name typed) and the portrait only when changed there. */
function saveDialog(id: PersonId, model: PhotoModel, firstName: string): void {
    DataManager.updatePerson(id, { firstName, ...photoSaveFields(model) });
    photoSaved(model);
}

const photoOf = (id: PersonId): string | undefined => DataManager.getPerson(id)?.photo;

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

describe('the dialog shows the state of its portrait', () => {
    it('the older portrait under the veil, none yet, one that did not come; a change made in the dialog shows as itself', async () => {
        const l = loadVersion([NEW2]);
        const m1 = openDialog(P1), m2 = openDialog(P2);
        expect(m1.value).toBe(urlOf(OLD));
        expect(photoModelState(m1)).toBe('refresh');
        expect(m2.value).toBeUndefined();
        expect(photoModelState(m2)).toBe('loading');
        l.release();
        await l.q.whenIdle();
        expect(photoModelState(openDialog(P2))).toBe('failed');
        expect(photoModelState(openDialog(P1))).toBe('none');
        setModelPhoto(m2, CHOSEN);
        expect(photoModelState(m2)).toBe('none');
        expect(photoModelState(openPhotoModel(null, undefined))).toBe('none');
    });
});

describe('every way out of the dialog keeps the photo on its way (I2)', () => {
    it('Save with the portrait not changed while it comes: writes no portrait, the photos come after it', async () => {
        const l = loadVersion();
        const update = vi.spyOn(DataManager, 'updatePerson');
        const m1 = openDialog(P1), m2 = openDialog(P2);
        saveDialog(P1, m1, 'Velimír 2');
        saveDialog(P2, m2, 'Vlastislava 2');
        // Neither the older portrait nor "none" goes into the data.
        for (const call of update.mock.calls) expect('photo' in call[1]).toBe(false);
        expect(photoOf(P1)).toBe(urlOf(OLD));
        expect(imageLoads.stateOf(K1)).toBe('pending');
        expect(imageLoads.stateOf(K2)).toBe('pending');
        l.release();
        await l.q.whenIdle();
        expect(photoOf(P1)).toBe(urlOf(NEW1));
        expect(photoOf(P2)).toBe(urlOf(NEW2));
        expect(DataManager.getPerson(P1)?.firstName).toBe('Velimír 2');
    });

    it('Save after the photo came into the open dialog: the dialog shows it and Save keeps it', async () => {
        const l = loadVersion();
        const m1 = openDialog(P1);
        l.release();
        await l.q.whenIdle();
        expect(photoArrived(m1, [K1], photoOf(P1))).toBe(true);
        expect(m1.value).toBe(urlOf(NEW1));
        expect(photoModelState(m1)).toBe('none');
        expect(photoChanged(m1, urlOf(OLD))).toBe(false);
        saveDialog(P1, m1, 'Velimír 2');
        expect(photoOf(P1)).toBe(urlOf(NEW1));
    });

    it('a photo chosen while one comes: Save writes it, the one on its way no longer comes over it', async () => {
        const l = loadVersion();
        const m2 = openDialog(P2);
        setModelPhoto(m2, CHOSEN);
        expect(photoChanged(m2, '')).toBe(true);
        saveDialog(P2, m2, 'Vlastislava');
        expect(photoOf(P2)).toBe(CHOSEN);
        expect(imageLoads.stateOf(K2)).toBeNull();
        l.release();
        await l.q.whenIdle();
        expect(photoOf(P2)).toBe(CHOSEN);
        expect(imageLoads.stateOf(K2)).toBeNull();
        // The other person's photo still came.
        expect(photoOf(P1)).toBe(urlOf(NEW1));
    });

    it('a photo that came while another was chosen in the dialog: the choice stays', async () => {
        const l = loadVersion();
        const m1 = openDialog(P1);
        setModelPhoto(m1, CHOSEN);
        l.release();
        await l.q.whenIdle();
        expect(photoArrived(m1, [K1], photoOf(P1))).toBe(false);
        expect(photoFollowsData(m1, photoOf(P1))).toBe(false);
        expect(m1.value).toBe(CHOSEN);
        saveDialog(P1, m1, 'Velimír');
        expect(photoOf(P1)).toBe(CHOSEN);
    });

    it('Remove of the older portrait whose new one did not come: Save removes it and Try again brings nothing over it', async () => {
        const l = loadVersion([NEW1]);
        l.release();
        await l.q.whenIdle();
        expect(imageLoads.stateOf(K1)).toBe('failed');
        const m1 = openDialog(P1);
        expect(photoModelState(m1)).toBe('failed');
        expect(m1.value).toBe(urlOf(OLD));
        setModelPhoto(m1, undefined);
        saveDialog(P1, m1, 'Velimír');
        expect(photoOf(P1)).toBeUndefined();
        expect(imageLoads.stateOf(K1)).toBeNull();
        expect(imageLoads.failedKeys()).not.toContain(K1);
        l.provide(NEW1);
        imageLoads.retry([K1]);
        await l.q.whenIdle();
        expect(photoOf(P1)).toBeUndefined();
    });

    it('a new crop: not over a photo still on its way; once it is there (or the older one stays after a failure) the crop is saved', async () => {
        const l = loadVersion([NEW2]);
        const m1 = openDialog(P1), m2 = openDialog(P2);
        expect(canRecropPhoto(m1)).toBe(false);
        expect(canRecropPhoto(m2)).toBe(false);
        l.release();
        await l.q.whenIdle();
        photoArrived(m1, [K1], photoOf(P1));
        expect(canRecropPhoto(m1)).toBe(true);
        // Failed without a photo: nothing to crop.
        expect(canRecropPhoto(openDialog(P2))).toBe(false);
        setModelPhoto(m1, CROP);
        saveDialog(P1, m1, 'Velimír');
        expect(photoOf(P1)).toBe(CROP);
        expect(imageLoads.stateOf(K1)).toBeNull();
    });

    it('a crop over the older portrait whose new one failed is allowed and wins over Try again', async () => {
        const l = loadVersion([NEW1]);
        l.release();
        await l.q.whenIdle();
        const m1 = openDialog(P1);
        expect(canRecropPhoto(m1)).toBe(true);
        setModelPhoto(m1, CROP);
        saveDialog(P1, m1, 'Velimír');
        l.provide(NEW1);
        imageLoads.retry([K1]);
        await l.q.whenIdle();
        expect(photoOf(P1)).toBe(CROP);
    });

    it('Cancel after a photo was chosen: nothing written, the photo on its way still comes', async () => {
        const l = loadVersion();
        const m2 = openDialog(P2);
        setModelPhoto(m2, CHOSEN);
        // Closed without Save: neither saveDialog nor photoSaved.
        expect(imageLoads.stateOf(K2)).toBe('pending');
        l.release();
        await l.q.whenIdle();
        expect(photoOf(P2)).toBe(urlOf(NEW2));
    });

    it('a research version under the open dialog: an untouched portrait follows the data', () => {
        const m1 = openDialog(P1);
        expect(photoFollowsData(m1, CHOSEN)).toBe(true);
        expect(m1.value).toBe(CHOSEN);
        expect(m1.touched).toBe(false);
        expect(photoSaveFields(m1)).toEqual({});
    });
});
