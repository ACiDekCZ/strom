/**
 * Images arriving after the tree (spec 116): the tree is read with stand-ins
 * for the images not held, they never reach the data, the images come in
 * batches (the people shown first) and go only into the tree and the load
 * they belong to; one that does not come is failed and can be asked again;
 * a field keeps its older image until the new one comes. Invented data only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import {
    applyImageFills, awaitTreeImages, imageLoads, imagesToAwait, personsByNearness, resetImageLoads, startImageLoad,
    takePendingImages, withArrivedImages, type AwaitImagesChoice, type AwaitImagesView,
    IMAGES_ARRIVED_EVENT, IMAGES_STATE_EVENT, IMAGE_FIRST_BATCH,
    type ImageFill, type ImageLoadDeps, type ImageLoadSnapshot, type ImagesArrivedDetail, type PendingImage,
} from '../image-loads.js';
import {
    findImageRefs, forgetHeldImages, isPendingImageUrl, pendingImageUrl, resolveHeldImageRefs, sha256Hex,
    addHeldImages, heldImageShas, IMAGE_BATCH, type ImageFetchDeps, type ImageRef,
} from '../research-image-refs.js';
import { migrateData, DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { allMedia } from '../media.js';
import { countImages } from '../attachments.js';
import { toPersonId, type StromData, type TreeId } from '../types.js';

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
const dataUrlOf = (b: Buffer): string => `data:image/jpeg;base64,${b.toString('base64')}`;

const PORTRAIT = jpeg(64, 64, 9);
const OLD_PORTRAIT = jpeg(64, 64, 8);
const FILE_IMG = jpeg(200, 100, 4);
const CROP_A = jpeg(400, 100, 1);
const CROP_B = jpeg(120, 80, 3);
const UUID = '0b7e5c3a-91d2-4f60-8a1e-5d2c7f9b3e14';

const refLines = (img: Buffer, w: number, h: number): string[] =>
    [`2 FILE strom-image:${shaOf(img)}`, '3 _MIME image/jpeg', `3 _WIDTH ${w}`, `3 _HEIGHT ${h}`, `3 _BYTES ${img.length}`];

/** The research's tree with its images by their hash: a portrait, a file of a person, two crops of a source. */
const SLIM = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 9 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 7c1e9a3b5d20', '1 CHAR UTF-8',
    '0 @P0001@ INDI', '1 NAME Velimír /Šťovíček/', '1 SEX M', '1 REFN P0001', '1 SOUR @S0001@',
    '1 OBJE', '2 FORM jpg', '2 _STROM_KIND photo', ...refLines(PORTRAIT, 64, 64),
    '1 OBJE', '2 FORM jpg', '2 TITL Dopis z vojny', ...refLines(FILE_IMG, 200, 100),
    '0 @P0002@ INDI', '1 NAME Vlastislava /Řeřichová/', '1 SEX F', '1 REFN P0002', '1 SOUR @S0001@',
    '0 @S0001@ SOUR', '1 TITL Křestní matrika Mechovice 1851', '1 REFN S0001',
    '1 OBJE', '2 FORM jpg', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0001', ...refLines(CROP_A, 400, 100),
    '1 OBJE', '2 FORM jpg', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0002', ...refLines(CROP_B, 120, 80),
    '0 TRLR',
].join('\n');

const ALL = new Map([PORTRAIT, FILE_IMG, CROP_A, CROP_B].map(b => [shaOf(b), dataUrlOf(b)]));
const refsOf = (text: string): Map<string, ImageRef> => new Map(findImageRefs(text).map(r => [r.sha, r]));

/** The tree read with every image still on its way. */
function readPending(images?: ReadonlyMap<string, string>): StromData {
    return convertToStrom(parseGedcom(SLIM), { images: images ?? new Map(), pendingImages: refsOf(SLIM) }).data;
}


/** Everything `data` holds as text: no stand-in, no reference. */
function noStandIns(data: StromData): void {
    const json = JSON.stringify(data);
    expect(json).not.toContain('STROMPENDING');
    expect(json).not.toContain('strom-image:');
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    forgetHeldImages();
});
afterEach(() => {
    resetImageLoads();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('stand-ins: read, taken out, never stored', () => {
    it('the parser makes every record of an image on its way, with a stand-in that weighs as the image', () => {
        const data = readPending();
        const person = Object.values(data.persons).find(p => p.firstName === 'Velimír')!;
        expect(isPendingImageUrl(person.photo)).toBe(true);
        const files = allMedia(data);
        expect(files.length).toBe(1);
        expect(isPendingImageUrl(files[0].dataUrl)).toBe(true);
        const crops = Object.values(data.sources!).flatMap(s => s.excerpts ?? []);
        expect(crops.map(e => e.clip)).toEqual(['C0001', 'C0002']);
        expect(crops.every(e => isPendingImageUrl(e.dataUrl))).toBe(true);
        // The size of what comes counts the images on their way (the load dialog's "≈ N MB").
        expect(countImages(data).bytes).toBe(PORTRAIT.length + FILE_IMG.length + CROP_A.length + CROP_B.length);
        // Without it the records are not made at all (as before).
        const without = convertToStrom(parseGedcom(SLIM), { images: new Map() }).data;
        expect(allMedia(without).length).toBe(0);
    });

    it('validation drops any stand-in (a load, an import): never stored', () => {
        const data = migrateData(readPending());
        noStandIns(data);
        expect(Object.values(data.persons).some(p => p.photo)).toBe(false);
    });

    it('takePendingImages: the data without stand-ins, each waiting place by its key; the input untouched', () => {
        const data = readPending();
        const before = JSON.stringify(data);
        const { data: out, pending } = takePendingImages(data, null, refsOf(SLIM));
        expect(JSON.stringify(data)).toBe(before);
        noStandIns(out);
        const kinds = pending.map(p => p.key.split(':')[0]).sort();
        expect(kinds).toEqual(['excerpt', 'excerpt', 'media', 'person']);
        const portrait = pending.find(p => p.key.startsWith('person:'))!;
        expect(portrait.ref).toMatchObject({ sha: shaOf(PORTRAIT), width: 64, height: 64 });
        expect(portrait.expect).toBeUndefined();
        const crop = pending.find(p => p.excerpt?.record.clip === 'C0002')!;
        expect(crop.key).toBe(`excerpt:${crop.owner.sourceId}:${crop.excerpt!.record.id}`);
        expect(crop.excerpt!.after).toEqual([pending.find(p => p.excerpt?.record.clip === 'C0001')!.excerpt!.record.id]);
        // The people citing the source: whose crops they are (priority).
        expect(crop.owner.personIds.length).toBe(2);
    });

    it('a stand-in portrait over a stored tree: the old image stays until the new one comes ("refresh")', () => {
        const data = readPending();
        const id = Object.values(data.persons).find(p => p.firstName === 'Velimír')!.id;
        const previous = { ...data, persons: { ...data.persons, [id]: { ...data.persons[id], photo: dataUrlOf(OLD_PORTRAIT) } } } as StromData;
        const { data: out, pending } = takePendingImages(data, previous);
        expect(out.persons[id].photo).toBe(dataUrlOf(OLD_PORTRAIT));
        const entry = pending.find(p => p.key === `person:${id}:photo`)!;
        expect(entry.expect).toBe(dataUrlOf(OLD_PORTRAIT));
        // Comes: the new one over the old.
        expect(applyImageFills(out, [{ entry, url: dataUrlOf(PORTRAIT) }])).toEqual([entry.key]);
        expect(out.persons[id].photo).toBe(dataUrlOf(PORTRAIT));
    });

    it('applyImageFills: a file and the crops back in their places; a place changed meanwhile is left alone', () => {
        const { data, pending } = takePendingImages(readPending(), null, refsOf(SLIM));
        const fills: ImageFill[] = pending.map(entry => ({ entry, url: ALL.get(entry.ref.sha)! }));
        // The crop after: before the first is back, it goes first; the first then before it.
        const second = fills.find(f => f.entry.excerpt?.record.clip === 'C0002')!;
        const first = fills.find(f => f.entry.excerpt?.record.clip === 'C0001')!;
        expect(applyImageFills(data, [second])).toEqual([second.entry.key]);
        expect(applyImageFills(data, [first])).toEqual([first.entry.key]);
        const sid = first.entry.owner.sourceId!;
        expect(data.sources![sid].excerpts!.map(e => e.clip)).toEqual(['C0001', 'C0002']);
        expect(data.sources![sid].excerpts![0]).toMatchObject({ width: 400, height: 100, dataUrl: dataUrlOf(CROP_A), sizeBytes: CROP_A.length });
        // The portrait: the user put another photo meanwhile — theirs stays.
        const portrait = fills.find(f => f.entry.key.startsWith('person:'))!;
        const pid = portrait.entry.owner.personIds[0];
        data.persons[pid].photo = dataUrlOf(OLD_PORTRAIT);
        expect(applyImageFills(data, [portrait])).toEqual([]);
        expect(data.persons[pid].photo).toBe(dataUrlOf(OLD_PORTRAIT));
        // The file; twice is once.
        const file = fills.find(f => f.entry.key.startsWith('media:'))!;
        expect(applyImageFills(data, [file, file])).toEqual([file.entry.key]);
        expect(allMedia(data).map(a => a.dataUrl)).toEqual([dataUrlOf(FILE_IMG)]);
        noStandIns(data);
        expect(migrateData(data).sources![sid].excerpts!.length).toBe(2);
    });

    it('withArrivedImages: the version as read with what came, the rest left out', () => {
        const data = readPending();
        const got = withArrivedImages(data, new Map([[shaOf(PORTRAIT), dataUrlOf(PORTRAIT)]]));
        noStandIns(got);
        expect(Object.values(got.persons).find(p => p.firstName === 'Velimír')!.photo).toBe(dataUrlOf(PORTRAIT));
        expect(allMedia(got).length).toBe(0);
        // The input keeps its stand-ins (it is the version as read).
        expect(isPendingImageUrl(Object.values(data.persons).find(p => p.firstName === 'Velimír')!.photo)).toBe(true);
    });

    it('resolveHeldImageRefs: what is held or stored is had at once, the rest is to come, no bridge asked', async () => {
        const stored = new Map([[shaOf(CROP_A), dataUrlOf(CROP_A)]]);
        const got = await resolveHeldImageRefs({ researchId: UUID, refs: findImageRefs(SLIM) },
            { sha256Hex, treeImages: async () => [...stored.values()] });
        expect([...got.images.keys()]).toEqual([shaOf(CROP_A)]);
        expect(got.pending.map(r => r.sha).sort()).toEqual([PORTRAIT, FILE_IMG, CROP_B].map(shaOf).sort());
        // What comes later joins the images held for the next file.
        addHeldImages(UUID, new Map([[shaOf(PORTRAIT), dataUrlOf(PORTRAIT)]]));
        expect(heldImageShas(UUID).sort()).toEqual([shaOf(CROP_A), shaOf(PORTRAIT)].sort());
    });
});

// ==================== THE QUEUE ====================

const URL_IMAGES = 'http://127.0.0.1:5994/abc/images';

/** A bridge's `POST /images` over `store`; `gate` holds each answer until released. */
function bridge(store: ReadonlyMap<string, string>, o: { fault?: (n: number) => Error | Response | null; hold?: boolean } = {}) {
    const asks: string[][] = [];
    let inFlight = 0, maxInFlight = 0;
    const waiting: (() => void)[] = [];
    const deps: ImageFetchDeps = {
        fetch: async (url, init) => {
            expect(url).toBe(URL_IMAGES);
            const shas = (JSON.parse(String(init.body)) as { images: string[] }).images;
            const n = asks.length;
            asks.push(shas);
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            if (o.hold) await new Promise<void>(r => waiting.push(r));
            else await new Promise(r => setTimeout(r, 1));
            inFlight--;
            if ((init.signal as AbortSignal | undefined)?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            const fault = o.fault?.(n);
            if (fault instanceof Error) throw fault;
            if (fault) return fault;
            const images = shas.filter(s => store.has(s)).map(sha => {
                const url = store.get(sha)!;
                return { sha, mime: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
            });
            return new Response(JSON.stringify({ images, missing: shas.filter(s => !store.has(s)), more: [] }), { status: 200 });
        },
        sha256Hex,
        sleep: async () => {},
    };
    return { deps, asks, maxInFlight: () => maxInFlight, release: () => { for (const r of waiting.splice(0)) r(); } };
}

/** A load into `tree` (its data), with the app's parts as plain functions. */
function load(o: {
    pending: PendingImage[]; data: StromData; fetch: ImageFetchDeps; priority?: string[]; tree?: () => string | null;
    firstBatch?: number; batch?: number;
}) {
    const events: { type: string; detail: unknown }[] = [];
    const writes: ImageFill[][] = [];
    let stores = 0;
    const done: { failed: number }[] = [];
    const deps: ImageLoadDeps = {
        fetch: o.fetch,
        currentTreeId: o.tree ?? (() => 'tree-a'),
        write: (_id, fills) => {
            writes.push([...fills]);
            return applyImageFills(o.data, fills);
        },
        store: () => { stores++; },
        emit: (type, detail) => events.push({ type, detail }),
    };
    const q = startImageLoad({
        treeId: 'tree-a', url: URL_IMAGES, pending: o.pending, deps, priority: o.priority,
        onDone: r => done.push({ failed: r.failed }),
        ...(o.firstBatch ? { firstBatch: o.firstBatch } : {}), ...(o.batch ? { batch: o.batch } : {}),
    })!;
    const states = (): ImageLoadSnapshot[] => events.filter(e => e.type === IMAGES_STATE_EVENT).map(e => e.detail as ImageLoadSnapshot);
    const arrived = (): ImagesArrivedDetail[] => events.filter(e => e.type === IMAGES_ARRIVED_EVENT).map(e => e.detail as ImagesArrivedDetail);
    return { q, writes, stores: () => stores, done, states, arrived };
}

/** `n` people, each with a portrait on its way; person i is the child of person i-1. */
function chain(n: number): { data: StromData; pending: PendingImage[]; store: Map<string, string> } {
    const persons: StromData['persons'] = {};
    const store = new Map<string, string>();
    const pending: PendingImage[] = [];
    for (let i = 0; i < n; i++) {
        const id = toPersonId(`p${i}`);
        persons[id] = {
            id, firstName: `N${i}`, lastName: 'X', gender: 'male', partnerships: [],
            parentIds: i > 0 ? [toPersonId(`p${i - 1}`)] : [], childIds: i < n - 1 ? [toPersonId(`p${i + 1}`)] : [],
        } as unknown as StromData['persons'][typeof id];
        const img = jpeg(10, 10, 1000 + i);
        store.set(shaOf(img), dataUrlOf(img));
        pending.push({ key: `person:${id}:photo`, ref: { sha: shaOf(img), mime: 'image/jpeg' }, owner: { personIds: [id] } });
    }
    return { data: { persons, partnerships: {} } as unknown as StromData, pending, store };
}

describe('the queue', () => {
    it('the evidence and its snapshot: all to come, then all came; written once, stored once', async () => {
        const { data, pending, store } = chain(5);
        const b = bridge(store);
        const l = load({ pending, data, fetch: b.deps });
        expect(l.q.snapshot()).toMatchObject({ phase: 'running', total: 5, done: 0, left: 5, failed: 0 });
        expect(imageLoads.isPending('person:p0:photo')).toBe(true);
        expect(imageLoads.entryOf('person:p0:photo')).toMatchObject({ state: 'pending', hasValue: false, sha: pending[0].ref.sha });
        await l.q.whenIdle();
        expect(l.q.snapshot()).toMatchObject({ phase: 'done', total: 5, done: 5, left: 0, failed: 0, reasons: [] });
        expect(imageLoads.stateOf('person:p3:photo')).toBe('loaded');
        expect(data.persons[toPersonId('p3')].photo).toBe(store.get(pending[3].ref.sha));
        expect(l.stores()).toBe(1);
        expect(l.done).toEqual([{ failed: 0 }]);
        expect(l.arrived().flatMap(a => a.personIds).sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
        expect(l.arrived()[0]).toMatchObject({ treeId: 'tree-a', seq: l.q.seq });
        expect(l.states()[l.states().length - 1]).toMatchObject({ phase: 'done', done: 5 });
        noStandIns(data);
    });

    it('a first small batch, then up to 500; two asks at a time', async () => {
        const { data, pending, store } = chain(1100);
        const b = bridge(store);
        const l = load({ pending, data, fetch: b.deps });
        await l.q.whenIdle();
        expect(b.asks.map(a => a.length)).toEqual([IMAGE_FIRST_BATCH, IMAGE_BATCH, IMAGE_BATCH, 1100 - IMAGE_FIRST_BATCH - 2 * IMAGE_BATCH]);
        expect(b.maxInFlight()).toBe(2);
        expect(l.q.snapshot()).toMatchObject({ done: 1100, failed: 0 });
    });

    it('the people shown first, then around the focus by generations; setPriority orders anew', async () => {
        const { data, pending, store } = chain(12);
        // Shown: p9; focus p5 → p4, p6 → p3, p7 …
        const priority = personsByNearness(data, 'p5', ['p9']);
        expect(priority.slice(0, 6)).toEqual(['p9', 'p5', 'p4', 'p6', 'p3', 'p7']);
        const b = bridge(store, { hold: true });
        const l = load({ pending, data, fetch: b.deps, priority, firstBatch: 2, batch: 2 });
        const byId = (shas: string[]): string[] => shas.map(s => pending.find(p => p.ref.sha === s)!.owner.personIds[0]);
        expect(byId(b.asks[0])).toEqual(['p9', 'p5']);
        expect(byId(b.asks[1])).toEqual(['p4', 'p6']);
        // Moved: p0 and p1 on screen now.
        l.q.setPriority(['p0', 'p1']);
        b.release();
        await vi.waitFor(() => expect(b.asks.length).toBeGreaterThanOrEqual(4));
        expect(byId(b.asks[2])).toEqual(['p0', 'p1']);
        for (let i = 0; i < 10; i++) b.release();
        await vi.waitFor(() => { b.release(); expect(l.q.snapshot().phase).toBe('done'); });
    });

    it('another tree open: the load stops and nothing goes into any tree', async () => {
        const { data, pending, store } = chain(3);
        let open: string | null = 'tree-a';
        const b = bridge(store, { hold: true });
        const l = load({ pending, data, fetch: b.deps, tree: () => open });
        expect(b.asks.length).toBe(1);
        open = 'tree-b';
        imageLoads.onTreeSwitch(open);
        b.release();
        await l.q.whenIdle();
        await new Promise(r => setTimeout(r, 5));
        expect(l.writes).toEqual([]);
        expect(l.stores()).toBe(0);
        expect(Object.values(data.persons).some(p => p.photo)).toBe(false);
        expect(imageLoads.current()).toBeNull();
        expect(imageLoads.snapshot().phase).toBe('idle');
    });

    it('the tree switched while an answer was on its way (no event yet): checked before writing', async () => {
        const { data, pending, store } = chain(3);
        let open: string | null = 'tree-a';
        const b = bridge(store, { hold: true });
        const l = load({ pending, data, fetch: b.deps, tree: () => open });
        open = 'tree-b';
        b.release();
        await l.q.whenIdle();
        expect(l.writes).toEqual([]);
        expect(l.q.isAborted()).toBe(true);
    });

    it('a new load of the same tree: the old one goes nowhere', async () => {
        const { data, pending, store } = chain(3);
        const b = bridge(store, { hold: true });
        const first = load({ pending, data, fetch: b.deps });
        const second = load({ pending: pending.slice(0, 1), data, fetch: bridge(store).deps });
        expect(second.q.seq).toBe(first.q.seq + 1);
        b.release();
        await first.q.whenIdle();
        await second.q.whenIdle();
        expect(first.writes).toEqual([]);
        expect(second.writes.flat().map(f => f.entry.key)).toEqual(['person:p0:photo']);
    });

    it('the bridge does not answer: failed with why; retry brings them', async () => {
        const { data, pending, store } = chain(3);
        let down = true;
        const b = bridge(store, { fault: () => (down ? new TypeError('Failed to fetch') : null) });
        const l = load({ pending, data, fetch: b.deps });
        await l.q.whenIdle();
        expect(l.q.snapshot()).toMatchObject({ phase: 'done', done: 0, failed: 3, reasons: ['offline'] });
        expect(l.done).toEqual([{ failed: 3 }]);
        expect(imageLoads.failedKeys().length).toBe(3);
        expect(l.stores()).toBe(0);
        // Asked again after the retries (IMAGE_RETRY_MS), never the whole file.
        expect(b.asks.length).toBeGreaterThan(1);
        down = false;
        imageLoads.retry(['person:p1:photo']);
        await l.q.whenIdle();
        expect(l.q.snapshot()).toMatchObject({ done: 1, failed: 2 });
        imageLoads.retry();
        await l.q.whenIdle();
        expect(l.q.snapshot()).toMatchObject({ phase: 'done', done: 3, failed: 0, reasons: [] });
        expect(l.done.map(d => d.failed)).toEqual([3, 2, 0]);
        expect(l.stores()).toBe(2);
    });

    it('an image the bridge does not have: failed at once ("missing"), not asked again', async () => {
        const { data, pending, store } = chain(3);
        store.delete(pending[1].ref.sha);
        const b = bridge(store);
        const l = load({ pending, data, fetch: b.deps });
        await l.q.whenIdle();
        expect(b.asks.length).toBe(1);
        expect(l.q.snapshot()).toMatchObject({ done: 2, failed: 1, reasons: ['missing'] });
        expect(l.q.entryOf('person:p1:photo')).toMatchObject({ state: 'failed', reason: 'missing' });
    });

    it('a field the user changed meanwhile: dropped from the evidence, theirs kept', async () => {
        const { data, pending, store } = chain(2);
        const b = bridge(store, { hold: true });
        const l = load({ pending, data, fetch: b.deps });
        data.persons[toPersonId('p0')].photo = dataUrlOf(OLD_PORTRAIT);
        b.release();
        await l.q.whenIdle();
        expect(data.persons[toPersonId('p0')].photo).toBe(dataUrlOf(OLD_PORTRAIT));
        expect(l.q.stateOf('person:p0:photo')).toBeNull();
        expect(l.q.snapshot()).toMatchObject({ phase: 'done', total: 1, done: 1 });
    });

    it('one image for several places: asked once, put in each', async () => {
        const { data, pending, store } = chain(2);
        const same = [pending[0], { ...pending[1], ref: pending[0].ref }];
        const b = bridge(store);
        const l = load({ pending: same, data, fetch: b.deps });
        await l.q.whenIdle();
        expect(b.asks).toEqual([[pending[0].ref.sha]]);
        expect(data.persons[toPersonId('p1')].photo).toBe(data.persons[toPersonId('p0')].photo);
    });
});

/** The wait's look as a record: what it showed, and the answers to its question. */
function fakeView(answers: AwaitImagesChoice[] = []) {
    const shown: { done: number; total: number }[] = [];
    const asked: { failed: number; reasons: string[] }[] = [];
    let cancel: (() => void) | null = null;
    let closed = 0;
    const view: AwaitImagesView = {
        waiting: (title, s, c) => { expect(title).toBe('Printing the poster'); shown.push({ done: s.done, total: s.total }); cancel = c; },
        ask: async (_t, s) => { asked.push({ failed: s.failed, reasons: [...s.reasons] }); return answers.shift() ?? 'cancel'; },
        close: () => { closed++; },
    };
    return { view, shown, asked, cancel: () => cancel?.(), closed: () => closed };
}
const POSTER = { title: 'Printing the poster' };
const tick = (): Promise<void> => new Promise(r => setTimeout(r, 5));

describe('an output waits for the photos (awaitTreeImages, §8)', () => {
    it('nothing on its way: ready at once, nothing shown', async () => {
        const v = fakeView();
        expect(imagesToAwait()).toBe(false);
        expect(await awaitTreeImages(POSTER, v.view)).toBe('ready');
        expect(v.shown).toEqual([]);
        expect(v.closed()).toBe(0);
        // All came already: the same.
        const { data, pending, store } = chain(2);
        const l = load({ pending, data, fetch: bridge(store).deps });
        await l.q.whenIdle();
        expect(await awaitTreeImages(POSTER, v.view)).toBe('ready');
        expect(v.shown).toEqual([]);
    });

    it('photos on their way: counted, the output once all came', async () => {
        const { data, pending, store } = chain(3);
        const b = bridge(store, { hold: true });
        const l = load({ pending, data, fetch: b.deps, firstBatch: 1, batch: 1 });
        const v = fakeView();
        const wait = awaitTreeImages(POSTER, v.view);
        await tick();
        expect(v.shown[0]).toEqual({ done: 0, total: 3 });
        for (let i = 0; i < 3; i++) { b.release(); await tick(); }
        expect(await wait).toBe('ready');
        // The count moved on while it waited.
        expect(v.shown.some(x => x.done > 0 && x.done < 3)).toBe(true);
        expect(v.asked).toEqual([]);
        expect(v.closed()).toBe(1);
        expect(data.persons[toPersonId('p2')].photo).toBe(store.get(pending[2].ref.sha));
        expect(l.q.snapshot().left).toBe(0);
    });

    it('photos of another tree: not waited for', async () => {
        const { data, pending, store } = chain(2);
        load({ pending, data, fetch: bridge(store, { hold: true }).deps });
        const v = fakeView();
        expect(await awaitTreeImages({ ...POSTER, treeId: 'tree-b' }, v.view)).toBe('ready');
        expect(v.shown).toEqual([]);
    });

    it('Cancel during the wait, or its window closed: cancelled', async () => {
        const { data, pending, store } = chain(2);
        load({ pending, data, fetch: bridge(store, { hold: true }).deps });
        const v = fakeView();
        const wait = awaitTreeImages(POSTER, v.view);
        await tick();
        v.cancel();
        expect(await wait).toBe('cancelled');
        expect(v.closed()).toBe(1);
        const gone = new AbortController();
        const w2 = awaitTreeImages({ ...POSTER, signal: gone.signal }, v.view);
        await tick();
        gone.abort();
        expect(await w2).toBe('cancelled');
    });

    it('some did not come: asked once; Continue without makes it, Cancel does not', async () => {
        const { data, pending, store } = chain(3);
        const b = bridge(store, { fault: () => new TypeError('Failed to fetch') });
        load({ pending, data, fetch: b.deps });
        const v = fakeView(['without', 'cancel']);
        expect(await awaitTreeImages(POSTER, v.view)).toBe('without');
        expect(v.asked).toEqual([{ failed: 3, reasons: ['offline'] }]);
        expect(await awaitTreeImages(POSTER, v.view)).toBe('cancelled');
        expect(v.asked.length).toBe(2);
        expect(v.closed()).toBe(2);
    });

    it('Try again asks the bridge anew: they came, the output is made with them', async () => {
        const { data, pending, store } = chain(3);
        let down = true;
        const b = bridge(store, { fault: () => (down ? new TypeError('Failed to fetch') : null) });
        const l = load({ pending, data, fetch: b.deps });
        await l.q.whenIdle();
        const v: AwaitImagesView = {
            ...fakeView().view,
            ask: async () => { down = false; return 'retry'; },
        };
        expect(await awaitTreeImages(POSTER, v)).toBe('ready');
        expect(l.q.snapshot()).toMatchObject({ done: 3, failed: 0 });
        expect(data.persons[toPersonId('p0')].photo).toBe(store.get(pending[0].ref.sha));
    });

    it('the load let go meanwhile: ready while its tree is open, cancelled once another is', async () => {
        const { data, pending, store } = chain(2);
        let open: string | null = 'tree-a';
        load({ pending, data, fetch: bridge(store, { hold: true }).deps, tree: () => open });
        const v = fakeView();
        const wait = awaitTreeImages(POSTER, v.view);
        await tick();
        resetImageLoads();
        expect(await wait).toBe('ready');
        load({ pending, data, fetch: bridge(store, { hold: true }).deps, tree: () => open });
        const w2 = awaitTreeImages(POSTER, v.view);
        await tick();
        open = 'tree-b';
        resetImageLoads();
        expect(await w2).toBe('cancelled');
    });
});

describe('DataManager: images coming are no edit', () => {
    const TREE = 'image-loads-tree' as TreeId;

    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(TreeManager, 'noteUserChange').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = migrateData({ ...chain(1).data, version: 1 } as StromData);
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('written without an undo step, without a change of the user\'s; stored only when asked', () => {
        const rev = DataManager.getRevision();
        const url = dataUrlOf(PORTRAIT);
        const out = DataManager.applyImageArrivals(TREE, d => {
            d.persons[toPersonId('p0')].photo = url;
            return 1;
        });
        expect(out).toBe(1);
        expect(DataManager.getData().persons[toPersonId('p0')].photo).toBe(url);
        expect(DataManager.getRevision()).toBeGreaterThan(rev);
        expect(UndoManager.canUndo()).toBe(false);
        expect(TreeManager.noteUserChange).not.toHaveBeenCalled();
        expect(TreeManager.saveTreeData).not.toHaveBeenCalled();
        DataManager.storeArrivedImages(TREE);
        expect(TreeManager.saveTreeData).toHaveBeenCalledTimes(1);
        // Another tree: nothing written.
        expect(DataManager.applyImageArrivals('other' as TreeId, () => 1)).toBeNull();
    });

    it('the open tree replaced as a whole (a new load of it): its images on their way go nowhere', () => {
        const { data, pending } = chain(1);
        startImageLoad({ treeId: TREE, url: URL_IMAGES, pending, deps: {
            fetch: bridge(new Map(), { hold: true }).deps, currentTreeId: () => TREE, write: () => [], store: () => {}, emit: () => {},
        } });
        expect(imageLoads.current()?.treeId).toBe(TREE);
        DataManager.loadStromData(migrateData({ ...data, version: 1 } as StromData));
        expect(imageLoads.current()).toBeNull();
    });
});

