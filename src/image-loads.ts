/**
 * Images arriving after the tree (spec 116): the tree from the research's
 * bridge shows at once with the images this browser holds; the others come
 * in the background, the ones on screen first.
 *
 * The parser puts a stand-in (pendingImageUrl) where such an image goes.
 * Before the data are loaded or stored, takePendingImages takes every
 * stand-in out: a portrait or a couple's photo keeps the image the stored
 * tree had there until the new one comes (else none), a file of the tree or
 * a crop of a source waits aside. What waits is the evidence of one load
 * (ImageLoadQueue): field by field (FieldKey), each with the image's hash,
 * its state and what is shown meanwhile. The queue asks the bridge in
 * batches, checks each image against its hash and puts it into the open
 * tree — no undo step, no edit of the user's — only while that tree and that
 * load are still the current ones. A stand-in is never stored (validation
 * drops one that would be).
 *
 * Pure of the UI: the network, the tree and the events come in as
 * dependencies (tests, the app's wiring in ui/research-ui.ts).
 */

import type { Attachment, MediaPlace, PartnershipId, PersonId, PortraitSource, SourceExcerpt, StromData } from './types.js';
import { personSourceIds } from './types.js';
import {
    IMAGE_BATCH, IMAGE_CONCURRENCY, ImageBatchFailed, fetchImageBatch, isPendingImageUrl, pendingImageOf,
    type ImageFailReason, type ImageFetchDeps, type ImageRef,
} from './research-image-refs.js';
import { imageSizeFromDataUrl } from './excerpts.js';
import { dataUrlByteSize } from './photo.js';
import { portraitSourceHolds } from './validation.js';

export type { ImageFailReason } from './research-image-refs.js';

/**
 * A place an image goes in the tree:
 * `person:<id>:photo`, `union:<id>:photo`, `media:<attachment id>`,
 * `excerpt:<source id>:<excerpt id>`.
 */
export type FieldKey = string;

export type ImageLoadState = 'pending' | 'loaded' | 'failed';

/** The first batch asked (the images on screen come quickly). */
export const IMAGE_FIRST_BATCH = 30;

/** Event: images came into the open tree. Detail: ImagesArrivedDetail. */
export const IMAGES_ARRIVED_EVENT = 'strom:images-arrived';
/** Event: the state of the load changed. Detail: ImageLoadSnapshot. */
export const IMAGES_STATE_EVENT = 'strom:images-state';

/** Whose an image is: the people, couple, source or file it shows with (priority, events). */
export interface ImageOwner {
    /** The person whose portrait it is, the couple's two, the people of a file's places, the people citing a source. */
    personIds: PersonId[];
    partnershipId?: PartnershipId;
    sourceId?: string;
    mediaId?: string;
}

/** An image of the evidence, as the UI reads it. */
export interface ImageLoadEntry {
    key: FieldKey;
    sha: string;
    state: ImageLoadState;
    ref: ImageRef;
    /** The place shows an older image meanwhile (the research changed it): "refresh". */
    hasValue: boolean;
    /** Why it did not come (state 'failed'). */
    reason?: ImageFailReason;
    owner: ImageOwner;
}

/**
 * An image a load waits for (takePendingImages): what is in the data now
 * and, for a file or a crop, its record kept aside until the image comes.
 */
export interface PendingImage {
    key: FieldKey;
    ref: ImageRef;
    owner: ImageOwner;
    /** The value of the field in the data now (an older image, or none): the image goes in only over this. */
    expect?: string;
    /** A file of the tree waiting aside (key `media:`). */
    media?: Attachment;
    /** The ids of the files before it in the tree (it goes back to its place among them). */
    mediaAfter?: string[];
    /** A crop waiting aside (key `excerpt:`), with the ids of the crops before it in its source. */
    excerpt?: { record: SourceExcerpt; after: string[] };
    /**
     * Where portraits were cut from that need this image (its file, the
     * couple's photo, the person's own portrait not there yet): kept aside,
     * as validation would drop them, and put back once all they need is
     * here (spec 116).
     */
    portraits?: { personId: PersonId; source: PortraitSource }[];
}

/** One image put into the data. */
export interface ImageFill {
    entry: PendingImage;
    url: string;
}

/** What `strom:images-arrived` tells. */
export interface ImagesArrivedDetail {
    treeId: string;
    seq: number;
    keys: FieldKey[];
    personIds: PersonId[];
    partnershipIds: PartnershipId[];
    sourceIds: string[];
    mediaIds: string[];
}

export type ImageLoadPhase = 'idle' | 'running' | 'done';

/** What `strom:images-state` tells (and snapshot() gives). */
export interface ImageLoadSnapshot {
    treeId: string | null;
    seq: number;
    /** idle: nothing loads; running: images still to come; done: none left (some may have failed). */
    phase: ImageLoadPhase;
    /** Came. */
    done: number;
    /** In the evidence of this load (came, to come, failed). */
    total: number;
    /** Did not come. */
    failed: number;
    /** Still to come (waiting or asked). */
    left: number;
    /** Why the failed ones did not come, each once, in the order offline, timeout, missing. */
    reasons: ImageFailReason[];
}

// ==================== TAKING THE STAND-INS OUT ====================

/** Is `url` a real image (no stand-in)? */
const realImage = (url: unknown): url is string => typeof url === 'string' && url.startsWith('data:') && !isPendingImageUrl(url);

function refOf(url: string, refs?: ReadonlyMap<string, ImageRef>): ImageRef {
    const p = pendingImageOf(url)!;
    return refs?.get(p.sha) ?? { sha: p.sha, mime: p.mime, ...(p.bytes ? { bytes: p.bytes } : {}) };
}

function placePersons(places: readonly MediaPlace[], data: StromData): PersonId[] {
    const out = new Set<PersonId>();
    for (const pl of places) {
        if ('personId' in pl && pl.personId) out.add(pl.personId);
        if ('partnershipId' in pl && pl.partnershipId) {
            const u = data.partnerships?.[pl.partnershipId];
            if (u?.person1Id) out.add(u.person1Id);
            if (u?.person2Id) out.add(u.person2Id);
        }
    }
    return [...out];
}

/**
 * The data to load or store: `data` without its stand-ins (`data` itself is
 * left as it is; only the records that held one are new). A portrait or a
 * couple's photo gets the image `previous` (the stored tree) had there,
 * else none; a file of the tree or a crop of a source is left out and waits
 * aside. `pending`: what waits, by its place in `data` (the ids it has
 * after a research's version was matched to the tree). `refs`: what the
 * file says of each image (sizes).
 */
export function takePendingImages(data: StromData, previous?: StromData | null, refs?: ReadonlyMap<string, ImageRef>): { data: StromData; pending: PendingImage[] } {
    const pending: PendingImage[] = [];
    const out: StromData = { ...data };
    for (const [id, p] of Object.entries(data.persons ?? {})) {
        if (!p || !isPendingImageUrl(p.photo)) continue;
        const ref = refOf(p.photo, refs);
        const old = previous?.persons?.[id as PersonId]?.photo;
        const { photo: _standIn, ...rest } = p;
        if (out.persons === data.persons) out.persons = { ...data.persons };
        out.persons[id as PersonId] = realImage(old) ? { ...rest, photo: old } : rest;
        pending.push({ key: `person:${id}:photo`, ref, owner: { personIds: [id as PersonId] }, ...(realImage(old) ? { expect: old } : {}) });
    }
    for (const [id, u] of Object.entries(data.partnerships ?? {})) {
        if (!u || !isPendingImageUrl(u.photo)) continue;
        const ref = refOf(u.photo, refs);
        const old = previous?.partnerships?.[id as PartnershipId]?.photo;
        const { photo: _standIn, ...rest } = u;
        if (out.partnerships === data.partnerships) out.partnerships = { ...data.partnerships };
        out.partnerships[id as PartnershipId] = realImage(old) ? { ...rest, photo: old } : rest;
        pending.push({
            key: `union:${id}:photo`, ref,
            owner: { personIds: [u.person1Id, u.person2Id].filter(Boolean), partnershipId: id as PartnershipId },
            ...(realImage(old) ? { expect: old } : {}),
        });
    }
    const mediaBefore: string[] = [];
    for (const [id, att] of Object.entries(data.media ?? {})) {
        mediaBefore.push(id);
        if (!att || !isPendingImageUrl(att.dataUrl)) continue;
        const ref = refOf(att.dataUrl, refs);
        if (out.media === data.media) out.media = { ...data.media };
        delete out.media![id];
        const sourceId = att.places?.find((pl): pl is { sourceId: string } => 'sourceId' in pl)?.sourceId;
        pending.push({
            key: `media:${id}`, ref, media: { ...att, places: [...(att.places ?? [])] }, mediaAfter: mediaBefore.slice(0, -1),
            owner: { personIds: placePersons(att.places ?? [], data), mediaId: id, ...(sourceId ? { sourceId } : {}) },
        });
    }
    let citing: Map<string, PersonId[]> | null = null;
    for (const [sid, src] of Object.entries(data.sources ?? {})) {
        if (!src?.excerpts?.some(e => isPendingImageUrl(e?.dataUrl))) continue;
        if (!citing) {
            citing = new Map();
            for (const [pid, p] of Object.entries(data.persons ?? {})) {
                if (!p) continue;
                for (const s of personSourceIds(p)) {
                    const list = citing.get(s) ?? citing.set(s, []).get(s)!;
                    if (list.length < 8) list.push(pid as PersonId);
                }
            }
        }
        const kept: SourceExcerpt[] = [];
        const before: string[] = [];
        for (const exc of src.excerpts) {
            if (!exc || !isPendingImageUrl(exc.dataUrl)) {
                kept.push(exc);
                if (exc?.id) before.push(exc.id);
                continue;
            }
            const ref = refOf(exc.dataUrl, refs);
            const record = { ...exc };
            if (!(record.width > 0 && record.height > 0) && ref.width && ref.height) {
                const turned = (record.orient ?? 1) >= 5;
                record.width = turned ? ref.height : ref.width;
                record.height = turned ? ref.width : ref.height;
            }
            pending.push({
                key: `excerpt:${sid}:${exc.id}`, ref,
                excerpt: { record, after: [...before] },
                owner: { personIds: citing.get(sid) ?? [], sourceId: sid },
            });
            before.push(exc.id);
        }
        if (out.sources === data.sources) out.sources = { ...data.sources };
        const { excerpts: _all, ...rest } = src;
        out.sources![sid] = kept.length ? { ...rest, excerpts: kept } : rest;
    }
    if (pending.length) portraitsAside(out, pending, data);
    return { data: pending.length ? out : data, pending };
}

/**
 * A portrait cut from an image still on its way (a file, a couple's photo)
 * or whose own image is not there yet: its source waits aside with each of
 * the images it needs (`out` gets fresh person records without it).
 */
function portraitsAside(out: StromData, pending: PendingImage[], input: StromData): void {
    const byKey = new Map(pending.map(p => [p.key, p]));
    for (const [id, p] of Object.entries(out.persons ?? {})) {
        const src = p?.photoSource;
        if (!src) continue;
        const needs = [
            byKey.get(`person:${id}:photo`),
            src.attachmentId ? byKey.get(`media:${src.attachmentId}`) : undefined,
            src.partnershipId ? byKey.get(`union:${src.partnershipId}:photo`) : undefined,
        ].filter((e): e is PendingImage => !!e && (e.key.startsWith('media:') || e.expect === undefined));
        if (!needs.length) continue;
        for (const e of needs) (e.portraits ??= []).push({ personId: id as PersonId, source: src });
        if (out.persons === input.persons) out.persons = { ...input.persons };
        const { photoSource: _aside, ...rest } = p;
        out.persons[id as PersonId] = rest;
    }
}

/**
 * `data` (a research's version as read, its stand-ins in it) with the images
 * that came in place of their stand-ins and the others left out — what the
 * version holds by now, for what is read of its images (the base of its own
 * files, spec 108). `data` is left as it is.
 */
export function withArrivedImages(data: StromData, arrived: ReadonlyMap<string, string>): StromData {
    // Its records that held a stand-in are fresh ones: filled here, the input's own stay untouched.
    const { data: out, pending } = takePendingImages(data);
    if (!pending.length) return data;
    const fills: ImageFill[] = [];
    for (const entry of pending) {
        const url = arrived.get(entry.ref.sha);
        if (url) fills.push({ entry, url });
    }
    applyImageFills(out, fills);
    return out;
}

/**
 * Put arrived images into `data` (changed in place). An image goes only
 * where its place still waits for it: the field still holds what it held
 * when the load began (a change of the user's wins), the person, couple or
 * source is still there, the file or crop is not there already. Returns the
 * keys written; the others are no longer waited for.
 */
export function applyImageFills(data: StromData, fills: readonly ImageFill[]): FieldKey[] {
    const written: FieldKey[] = [];
    for (const { entry, url } of fills) {
        const [kind, id, sub] = entry.key.split(':');
        if (kind === 'person') {
            const p = data.persons?.[id as PersonId];
            if (!p || p.photo !== entry.expect) continue;
            p.photo = url;
        } else if (kind === 'union') {
            const u = data.partnerships?.[id as PartnershipId];
            if (!u || u.photo !== entry.expect) continue;
            u.photo = url;
        } else if (kind === 'media' && entry.media) {
            if (data.media?.[id]) continue;
            const places = entry.media.places.filter(pl =>
                'personId' in pl ? !!data.persons?.[pl.personId]
                    : 'sourceId' in pl ? !!data.sources?.[pl.sourceId]
                        : !!data.partnerships?.[pl.partnershipId]);
            if (!places.length) continue;
            const record: Attachment = { ...entry.media, places, dataUrl: url, sizeBytes: dataUrlByteSize(url) };
            // Back in its place among the tree's files (their order is the galleries').
            const ids = Object.keys(data.media ?? {});
            let at = 0;
            for (const before of entry.mediaAfter ?? []) {
                const i = ids.indexOf(before);
                if (i >= 0) at = Math.max(at, i + 1);
            }
            const list = Object.entries(data.media ?? {});
            list.splice(at, 0, [id, record]);
            data.media = Object.fromEntries(list);
        } else if (kind === 'excerpt' && entry.excerpt) {
            const src = data.sources?.[id];
            if (!src || src.excerpts?.some(e => e?.id === sub)) continue;
            const exc: SourceExcerpt = { ...entry.excerpt.record, dataUrl: url, sizeBytes: dataUrlByteSize(url) };
            if (!(exc.width > 0 && exc.height > 0)) {
                const size = imageSizeFromDataUrl(url);
                if (size) {
                    const turned = (exc.orient ?? 1) >= 5;
                    exc.width = turned ? size.height : size.width;
                    exc.height = turned ? size.width : size.height;
                }
            }
            const list = src.excerpts ?? [];
            // After the last crop that was before it in the research's version and is here.
            let at = 0;
            for (const before of entry.excerpt.after) {
                const i = list.findIndex(e => e?.id === before);
                if (i >= 0) at = Math.max(at, i + 1);
            }
            src.excerpts = [...list.slice(0, at), exc, ...list.slice(at)];
        } else continue;
        written.push(entry.key);
    }
    // A portrait's source back once all it was cut from is here (none of the user's in its place).
    for (const { entry } of fills) {
        if (!entry.portraits || !written.includes(entry.key)) continue;
        for (const { personId, source } of entry.portraits) {
            const p = data.persons?.[personId];
            if (!p || p.photoSource || !realImage(p.photo)) continue;
            p.photoSource = source;
            if (!portraitSourceHolds(data, p)) delete p.photoSource;
        }
    }
    return written;
}

// ==================== NOTED FOR THE NEXT TIME ====================

/**
 * An image of a load that had not come when the tree was stored, noted in
 * the tree's metadata (TreeMetadata.pendingImages, the index — never the
 * data): the next connect to the research asks for it (spec 116, I1).
 */
export interface PendingImageNote {
    ref: ImageRef;
    owner: ImageOwner;
    /** The field held an older image meanwhile: its tag (the image goes in only over that one). */
    expectTag?: string;
    /** A file waiting aside, without its image (none when the tree is encrypted: the index is not). */
    media?: Omit<Attachment, 'dataUrl'>;
    mediaAfter?: string[];
    /** A crop waiting aside, without its image (likewise). */
    excerpt?: { record: Omit<SourceExcerpt, 'dataUrl'>; after: string[] };
    portraits?: { personId: PersonId; source: PortraitSource }[];
}

export type PendingImageNotes = Record<FieldKey, PendingImageNote>;

/** A short tag of an image (FNV-1a over its text, with its length): the same image, the same tag. */
export function imageTag(url: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) {
        h ^= url.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return `${url.length.toString(36)}.${(h >>> 0).toString(36)}`;
}

/** The note of an image still to come; `records`: with the file's or crop's record (not when the tree is encrypted). */
export function noteOf(p: PendingImage & { expectTag?: string }, records: boolean): PendingImageNote {
    const note: PendingImageNote = { ref: p.ref, owner: p.owner };
    if (p.expect !== undefined) note.expectTag = p.expectTag ?? imageTag(p.expect);
    if (records && p.media) {
        const { dataUrl: _standIn, ...m } = p.media;
        note.media = m;
        if (p.mediaAfter?.length) note.mediaAfter = p.mediaAfter;
    }
    if (records && p.excerpt) {
        const { dataUrl: _standIn, ...r } = p.excerpt.record;
        note.excerpt = { record: r, after: p.excerpt.after };
    }
    if (p.portraits?.length) note.portraits = p.portraits;
    return note;
}

/**
 * The images `notes` names that `data` still waits for: the field holds
 * what it held then (the same older image, or none), the person or couple
 * is there, the file or crop is not there yet and its record was noted.
 */
export function pendingFromNotes(data: StromData, notes: PendingImageNotes | undefined): PendingImage[] {
    const out: PendingImage[] = [];
    for (const [key, n] of Object.entries(notes ?? {})) {
        if (!n?.ref?.sha) continue;
        const [kind, id, sub] = key.split(':');
        const base = { key, ref: n.ref, owner: n.owner ?? { personIds: [] }, ...(n.portraits?.length ? { portraits: n.portraits } : {}) };
        if (kind === 'person' || kind === 'union') {
            const rec = kind === 'person' ? data.persons?.[id as PersonId] : data.partnerships?.[id as PartnershipId];
            if (!rec) continue;
            const now = realImage(rec.photo) ? rec.photo : undefined;
            if (n.expectTag ? !now || imageTag(now) !== n.expectTag : now !== undefined) continue;
            out.push({ ...base, ...(now !== undefined ? { expect: now } : {}) });
        } else if (kind === 'media') {
            if (!n.media || data.media?.[id]) continue;
            out.push({ ...base, media: { ...n.media, dataUrl: '' } as Attachment, ...(n.mediaAfter ? { mediaAfter: n.mediaAfter } : {}) });
        } else if (kind === 'excerpt') {
            const src = data.sources?.[id];
            if (!n.excerpt || !src || src.excerpts?.some(e => e?.id === sub)) continue;
            out.push({ ...base, excerpt: { record: { ...n.excerpt.record, dataUrl: '' } as SourceExcerpt, after: n.excerpt.after ?? [] } });
        }
    }
    return out;
}

// ==================== PRIORITY ====================

/**
 * People in the order their images are wanted: `first` (the cards on
 * screen), then the focus and the people around it generation by
 * generation (parents, children, partners), then nobody else (the rest
 * keeps the file's order).
 */
export function personsByNearness(data: StromData, focusId: string | null | undefined, first: Iterable<string> = [], max = 5000): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (id: string): void => {
        if (!seen.has(id) && data.persons?.[id as PersonId]) {
            seen.add(id);
            out.push(id);
        }
    };
    for (const id of first) add(id);
    if (!focusId || !data.persons?.[focusId as PersonId]) return out;
    let ring = [focusId];
    add(focusId);
    const reached = new Set<string>([focusId]);
    while (ring.length && out.length < max) {
        const next: string[] = [];
        for (const id of ring) {
            const p = data.persons[id as PersonId];
            if (!p) continue;
            const near = [...(p.parentIds ?? []), ...(p.childIds ?? [])];
            for (const uid of p.partnerships ?? []) {
                const u = data.partnerships?.[uid];
                if (u) near.push(u.person1Id === id ? u.person2Id : u.person1Id);
            }
            for (const n of near) {
                if (!n || reached.has(n)) continue;
                reached.add(n);
                next.push(n);
                add(n);
            }
        }
        ring = next;
    }
    return out;
}

// ==================== THE QUEUE ====================

/** What a load takes from the app (tests give their own). */
export interface ImageLoadDeps {
    /** The network and the hashing. */
    fetch: ImageFetchDeps;
    /** The tree open now. */
    currentTreeId(): string | null;
    /** Put the images into the open tree `treeId` (applyImageFills on its data, no undo step); the keys written. */
    write(treeId: string, fills: readonly ImageFill[]): FieldKey[];
    /** Store the open tree `treeId` once (after the images came). */
    store(treeId: string): void;
    /** Tell the app (window events by default). */
    emit(type: string, detail: unknown): void;
    /** Images came and were checked (the images held for the research grow, spec 116). */
    arrived?(images: ReadonlyMap<string, string>): void;
}

interface Item extends PendingImage {
    state: ImageLoadState;
    /** imageTag(expect), once asked for. */
    expectTag?: string;
    reason?: ImageFailReason;
    order: number;
}

const REASON_ORDER: readonly ImageFailReason[] = ['offline', 'timeout', 'missing'];

/** The events go to the window (when there is one). */
export function windowEmit(type: string, detail: unknown): void {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent(type, { detail }));
}

export interface ImageLoadOptions {
    treeId: string;
    /** The bridge's `<token>/images`. */
    url: string;
    pending: readonly PendingImage[];
    deps: ImageLoadDeps;
    /** People in the order their images are wanted (personsByNearness). */
    priority?: readonly string[];
    /** Every image came or failed (once per round; again after a retry). */
    onDone?(o: { arrived: ReadonlyMap<string, string>; failed: number }): void;
    firstBatch?: number;
    batch?: number;
    concurrency?: number;
}

/** The images of one load of a tree: their evidence and the asking. */
export class ImageLoadQueue {
    readonly treeId: string;
    readonly seq: number;
    private readonly items = new Map<FieldKey, Item>();
    private readonly bySha = new Map<string, FieldKey[]>();
    /** Hashes to ask, in the order wanted. */
    private waiting: string[] = [];
    private readonly inFlight = new Set<string>();
    private running = 0;
    private batches = 0;
    private rank = new Map<string, number>();
    private readonly ctl: AbortController | null = typeof AbortController === 'function' ? new AbortController() : null;
    private aborted = false;
    private unstored = false;
    /** A round (the start, a retry) not yet told done. */
    private roundOpen = true;
    private readonly arrived = new Map<string, string>();
    private idleWaiters: (() => void)[] = [];

    constructor(private readonly o: ImageLoadOptions, seq: number) {
        this.treeId = o.treeId;
        this.seq = seq;
        let order = 0;
        for (const p of o.pending) {
            if (this.items.has(p.key)) continue;
            this.items.set(p.key, { ...p, state: 'pending', order: order++ });
            const keys = this.bySha.get(p.ref.sha) ?? this.bySha.set(p.ref.sha, []).get(p.ref.sha)!;
            keys.push(p.key);
        }
        if (o.priority) this.rankBy(o.priority);
        this.waiting = this.sorted([...this.bySha.keys()]);
    }

    /** Begin asking (call once the tree with its stand-ins taken out is the open one). */
    start(): void {
        this.emitState();
        this.pump();
    }

    /** The people whose images are wanted first, in order (the cards on screen, then around the focus): the queue is ordered anew. */
    setPriority(personIds: readonly string[]): void {
        if (this.aborted) return;
        this.rankBy(personIds);
        this.waiting = this.sorted(this.waiting);
    }

    /** Ask again for the images that did not come (all, or those of `keys`). */
    retry(keys?: readonly FieldKey[]): void {
        if (this.aborted) return;
        const want = keys ? new Set(keys) : null;
        const shas = new Set<string>();
        for (const it of this.items.values()) {
            if (it.state !== 'failed' || (want && !want.has(it.key))) continue;
            it.state = 'pending';
            delete it.reason;
            shas.add(it.ref.sha);
        }
        if (!shas.size) return;
        this.roundOpen = true;
        for (const sha of shas) if (!this.inFlight.has(sha) && !this.waiting.includes(sha)) this.waiting.push(sha);
        this.waiting = this.sorted(this.waiting);
        this.emitState();
        this.pump();
    }

    /** No longer wait for the image of `key` (the user put another value there: their will wins). */
    drop(key: FieldKey): void {
        const it = this.items.get(key);
        if (!it) return;
        this.items.delete(key);
        const keys = (this.bySha.get(it.ref.sha) ?? []).filter(k => k !== key);
        if (keys.length) this.bySha.set(it.ref.sha, keys);
        else {
            this.bySha.delete(it.ref.sha);
            this.waiting = this.waiting.filter(s => s !== it.ref.sha);
        }
        this.emitState();
        this.settle();
    }

    /** Stop: nothing more is asked, and nothing of what is on its way goes into any tree. */
    abort(): void {
        if (this.aborted) return;
        this.aborted = true;
        this.ctl?.abort();
        this.waiting = [];
        this.wakeIdle();
    }

    isAborted(): boolean {
        return this.aborted;
    }

    /** Is its tree the open one? */
    holdsOpenTree(): boolean {
        return this.o.deps.currentTreeId() === this.treeId;
    }

    stateOf(key: FieldKey): ImageLoadState | null {
        return this.items.get(key)?.state ?? null;
    }

    entryOf(key: FieldKey): ImageLoadEntry | null {
        const it = this.items.get(key);
        return it ? this.publicEntry(it) : null;
    }

    /** Every image of the evidence. */
    entries(): ImageLoadEntry[] {
        return [...this.items.values()].map(it => this.publicEntry(it));
    }

    failedKeys(): FieldKey[] {
        return [...this.items.values()].filter(it => it.state === 'failed').map(it => it.key);
    }

    /**
     * What has not come (still to come or failed), as noted with the stored
     * tree (I1); empty once all came. `records`: with the records of files
     * and crops (not for an encrypted tree).
     */
    notes(records: boolean): PendingImageNotes {
        const out: PendingImageNotes = {};
        if (this.aborted) return out;
        for (const it of this.items.values()) {
            if (it.state === 'loaded') continue;
            if (it.expect !== undefined) it.expectTag ??= imageTag(it.expect);
            out[it.key] = noteOf(it, records);
        }
        return out;
    }

    /** The images put into the tree so far, each where it went (for other copies of the data: I3, I5). */
    fillsWritten(): ImageFill[] {
        const out: ImageFill[] = [];
        for (const it of this.items.values()) {
            const url = it.state === 'loaded' ? this.arrived.get(it.ref.sha) : undefined;
            if (url) out.push({ entry: it, url });
        }
        return out;
    }

    snapshot(): ImageLoadSnapshot {
        let done = 0, failed = 0, left = 0;
        const reasons = new Set<ImageFailReason>();
        for (const it of this.items.values()) {
            if (it.state === 'loaded') done++;
            else if (it.state === 'failed') {
                failed++;
                if (it.reason) reasons.add(it.reason);
            } else left++;
        }
        const total = this.items.size;
        return {
            treeId: this.treeId, seq: this.seq,
            phase: this.aborted || total === 0 ? 'idle' : left > 0 ? 'running' : 'done',
            done, total, failed, left,
            reasons: REASON_ORDER.filter(r => reasons.has(r)),
        };
    }

    /** Resolves once nothing is to come (or the load stopped). */
    whenIdle(): Promise<void> {
        if (this.aborted || (this.running === 0 && !this.hasPending())) return Promise.resolve();
        return new Promise(resolve => this.idleWaiters.push(resolve));
    }

    private publicEntry(it: Item): ImageLoadEntry {
        return {
            key: it.key, sha: it.ref.sha, state: it.state, ref: it.ref,
            hasValue: it.expect !== undefined,
            ...(it.reason ? { reason: it.reason } : {}),
            owner: it.owner,
        };
    }

    private hasPending(): boolean {
        for (const it of this.items.values()) if (it.state === 'pending') return true;
        return false;
    }

    private rankBy(ids: readonly string[]): void {
        const pos = new Map<string, number>();
        ids.forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); });
        this.rank = new Map();
        for (const [sha, keys] of this.bySha) {
            let best = Infinity;
            for (const k of keys) {
                for (const pid of this.items.get(k)?.owner.personIds ?? []) best = Math.min(best, pos.get(pid) ?? Infinity);
            }
            this.rank.set(sha, best);
        }
    }

    private firstOrder(sha: string): number {
        let best = Infinity;
        for (const k of this.bySha.get(sha) ?? []) best = Math.min(best, this.items.get(k)?.order ?? Infinity);
        return best;
    }

    private sorted(shas: string[]): string[] {
        const at = new Map(shas.map(s => [s, [this.rank.get(s) ?? Infinity, this.firstOrder(s)] as const]));
        return [...new Set(shas)].sort((a, b) => {
            const [ra, oa] = at.get(a)!, [rb, ob] = at.get(b)!;
            return ra !== rb ? (ra < rb ? -1 : 1) : oa - ob;
        });
    }

    /** Still the current load of the open tree. */
    private current(): boolean {
        return !this.aborted && this.o.deps.currentTreeId() === this.treeId && currentLoad === this;
    }

    private pump(): void {
        if (this.aborted) return;
        const concurrency = this.o.concurrency ?? IMAGE_CONCURRENCY;
        while (this.running < concurrency && this.waiting.length) {
            if (!this.current()) {
                this.abort();
                return;
            }
            const size = this.batches === 0 ? (this.o.firstBatch ?? IMAGE_FIRST_BATCH) : (this.o.batch ?? IMAGE_BATCH);
            const shas = this.waiting.splice(0, Math.max(1, Math.min(size, IMAGE_BATCH)));
            this.batches++;
            this.running++;
            for (const s of shas) this.inFlight.add(s);
            void this.runBatch(shas).finally(() => {
                this.running--;
                for (const s of shas) this.inFlight.delete(s);
                this.pump();
                this.settle();
            });
        }
    }

    private async runBatch(shas: string[]): Promise<void> {
        const refs: ImageRef[] = [];
        for (const sha of shas) {
            const k = this.bySha.get(sha)?.[0];
            const it = k ? this.items.get(k) : undefined;
            if (it) refs.push(it.ref);
        }
        if (!refs.length) return;
        let got;
        try {
            got = await fetchImageBatch(this.o.url, refs, this.o.deps.fetch, this.ctl?.signal);
        } catch (err) {
            if (this.aborted || !(err instanceof ImageBatchFailed)) {
                if (!this.aborted) this.fail(shas, 'offline');
                return;
            }
            this.fail(shas, err.reason);
            return;
        }
        // Another tree open, another load: nothing of this goes anywhere.
        if (!this.current()) {
            this.abort();
            return;
        }
        if (got.more.length) {
            this.waiting = [...got.more.filter(s => this.bySha.has(s)), ...this.waiting];
        }
        this.fail(got.missing, 'missing');
        const fills: ImageFill[] = [];
        for (const [sha, url] of got.images) {
            for (const k of this.bySha.get(sha) ?? []) {
                const it = this.items.get(k);
                if (it && it.state === 'pending') fills.push({ entry: it, url });
            }
        }
        if (!fills.length) return;
        const written = new Set(this.o.deps.write(this.treeId, fills));
        const keys: FieldKey[] = [];
        for (const { entry } of fills) {
            if (written.has(entry.key)) {
                const it = this.items.get(entry.key);
                if (it) it.state = 'loaded';
                keys.push(entry.key);
            } else {
                // Its place no longer waits for it (the user's value, the person gone).
                this.drop(entry.key);
            }
        }
        for (const [sha, url] of got.images) this.arrived.set(sha, url);
        this.o.deps.arrived?.(got.images);
        if (keys.length) {
            this.unstored = true;
            this.o.deps.emit(IMAGES_ARRIVED_EVENT, this.arrivedDetail(keys));
        }
        this.emitState();
    }

    private fail(shas: readonly string[], reason: ImageFailReason): void {
        if (!shas.length) return;
        for (const sha of shas) {
            for (const k of this.bySha.get(sha) ?? []) {
                const it = this.items.get(k);
                if (it && it.state === 'pending') {
                    it.state = 'failed';
                    it.reason = reason;
                }
            }
        }
        this.emitState();
    }

    private arrivedDetail(keys: FieldKey[]): ImagesArrivedDetail {
        const persons = new Set<PersonId>(), unions = new Set<PartnershipId>(), sources = new Set<string>(), media = new Set<string>();
        for (const k of keys) {
            const it = this.items.get(k);
            if (!it) continue;
            if (k.startsWith('person:')) persons.add(it.owner.personIds[0]);
            else if (k.startsWith('media:')) for (const p of it.owner.personIds) persons.add(p);
            if (it.owner.partnershipId) unions.add(it.owner.partnershipId);
            if (it.owner.sourceId) sources.add(it.owner.sourceId);
            if (it.owner.mediaId) media.add(it.owner.mediaId);
        }
        return { treeId: this.treeId, seq: this.seq, keys, personIds: [...persons], partnershipIds: [...unions], sourceIds: [...sources], mediaIds: [...media] };
    }

    private emitState(): void {
        if (currentLoad !== this) return;
        const s = this.snapshot();
        this.o.deps.emit(IMAGES_STATE_EVENT, s);
        tellState(s);
    }

    /** Tell that nothing loads any more (this load was let go). */
    emitIdle(): void {
        const s: ImageLoadSnapshot = { treeId: null, seq: this.seq, phase: 'idle', done: 0, total: 0, failed: 0, left: 0, reasons: [] };
        this.o.deps.emit(IMAGES_STATE_EVENT, s);
        tellState(s);
    }

    /** Nothing more to come: the tree is stored once, and whoever waits is told. */
    private settle(): void {
        if (this.aborted || this.running > 0 || this.waiting.length || this.hasPending()) return;
        if (this.unstored && this.current()) {
            this.unstored = false;
            this.o.deps.store(this.treeId);
        }
        if (this.roundOpen) {
            this.roundOpen = false;
            this.o.onDone?.({ arrived: this.arrived, failed: this.failedKeys().length });
        }
        this.wakeIdle();
    }

    private wakeIdle(): void {
        const list = this.idleWaiters;
        this.idleWaiters = [];
        for (const fn of list) fn();
    }
}

// ==================== THE APP'S ONE LOAD ====================

let currentLoad: ImageLoadQueue | null = null;
let loadSeq = 0;
const stateListeners = new Set<(s: ImageLoadSnapshot) => void>();

function tellState(s: ImageLoadSnapshot): void {
    for (const fn of [...stateListeners]) fn(s);
}

/** Listen to the state of the current load (as `strom:images-state`, without a window); returns the unsubscribe. */
export function onImageLoadState(fn: (s: ImageLoadSnapshot) => void): () => void {
    stateListeners.add(fn);
    return () => { stateListeners.delete(fn); };
}

/**
 * Begin loading the images of `o.pending` into tree `o.treeId` (the open
 * one): any earlier load stops (its images go nowhere). Null when nothing
 * waits.
 */
export function startImageLoad(o: ImageLoadOptions): ImageLoadQueue | null {
    resetImageLoads();
    if (!o.pending.length) return null;
    const q = new ImageLoadQueue(o, ++loadSeq);
    currentLoad = q;
    q.start();
    return q;
}

/** Stop the current load and forget its evidence (another load of the research, tests). */
export function resetImageLoads(): void {
    const q = currentLoad;
    if (!q) return;
    currentLoad = null;
    q.abort();
    q.emitIdle();
}

const IDLE: ImageLoadSnapshot = { treeId: null, seq: 0, phase: 'idle', done: 0, total: 0, failed: 0, left: 0, reasons: [] };

/** The images of the current load, as the UI asks about them. */
export const imageLoads = {
    /** The current load (null when none). */
    current(): ImageLoadQueue | null {
        return currentLoad;
    },
    /** The state of the image of `key` in the open tree; null when it is not waited for. */
    stateOf(key: FieldKey): ImageLoadState | null {
        return currentLoad?.stateOf(key) ?? null;
    },
    /** The image of `key` is still on its way. */
    isPending(key: FieldKey): boolean {
        return currentLoad?.stateOf(key) === 'pending';
    },
    entryOf(key: FieldKey): ImageLoadEntry | null {
        return currentLoad?.entryOf(key) ?? null;
    },
    snapshot(): ImageLoadSnapshot {
        return currentLoad?.snapshot() ?? { ...IDLE, seq: loadSeq };
    },
    /** The user put another value there: the image is no longer waited for. */
    drop(key: FieldKey): void {
        currentLoad?.drop(key);
    },
    /** Ask again for those that did not come (all, or `keys`). */
    retry(keys?: readonly FieldKey[]): void {
        currentLoad?.retry(keys);
    },
    failedKeys(): FieldKey[] {
        return currentLoad?.failedKeys() ?? [];
    },
    setPriority(personIds: readonly string[]): void {
        currentLoad?.setPriority(personIds);
    },
    /** The data of tree `treeId` were replaced as a whole (a load, an import): its images on their way go nowhere. */
    onDataReplaced(treeId: string | null): void {
        if (currentLoad && currentLoad.treeId === treeId) resetImageLoads();
    },
    /** Another tree is open now: a load of any other tree stops, its evidence forgotten. */
    onTreeSwitch(treeId: string | null): void {
        if (currentLoad && currentLoad.treeId !== treeId) resetImageLoads();
    },
    reset: resetImageLoads,
};

// ==================== OUTPUTS WAIT FOR THE PHOTOS (§8, K1.7) ====================

/** How the wait before an output ended: all came, made without those that did not, or not made. */
export type AwaitImagesResult = 'ready' | 'without' | 'cancelled';
/** The choice once some did not come: ask again, make the output without them, or not at all. */
export type AwaitImagesChoice = 'retry' | 'without' | 'cancel';

export interface AwaitImagesOptions {
    /** The output (its toast's title). */
    title: string;
    /** Aborted: the wait ends 'cancelled' (the output's window closed…). */
    signal?: AbortSignal;
    /** The tree the output is made of (none: any); the photos of another tree are not waited for. */
    treeId?: string | null;
}

/** What the wait shows (the app's progress toast; a test's record). */
export interface AwaitImagesView {
    /** Photos on their way: the count anew (the first call shows the wait; `cancel` ends it 'cancelled'). */
    waiting(title: string, s: ImageLoadSnapshot, cancel: () => void): void;
    /** Some did not come: the three choices (Try again, Continue without N photos, Cancel). */
    ask(title: string, s: ImageLoadSnapshot): Promise<AwaitImagesChoice>;
    /** The wait is over: what it showed goes. */
    close(): void;
}

/** Has an output of tree `treeId` (none: any) photos to wait for: some still on their way, or not loaded? */
export function imagesToAwait(treeId?: string | null): boolean {
    const q = currentLoad;
    if (!q || q.isAborted() || (treeId != null && q.treeId !== treeId)) return false;
    const s = q.snapshot();
    return s.total > 0 && (s.left > 0 || s.failed > 0);
}

/**
 * Before an output (print, a file, the book): wait until the tree's photos
 * came, so none is made without them. Nothing to wait for: 'ready' at once,
 * nothing shown. Else the view counts them (Cancel: 'cancelled'); all came:
 * 'ready'; some did not: the view asks — Try again waits anew, Continue
 * without makes the output from the data as they are ('without', the one
 * deliberate way to an output without them), Cancel ('cancelled'). The load
 * let go meanwhile: a new load of the same tree is waited for instead; the
 * same tree still open without one: 'ready'; another tree open: 'cancelled'.
 */
export async function awaitTreeImages(o: AwaitImagesOptions, view: AwaitImagesView): Promise<AwaitImagesResult> {
    let q = currentLoad;
    if (!q || !imagesToAwait(o.treeId)) return 'ready';
    if (o.signal?.aborted) return 'cancelled';
    let cancelled = false;
    let wake: (() => void) | null = null;
    const cancel = (): void => {
        cancelled = true;
        wake?.();
    };
    o.signal?.addEventListener('abort', cancel, { once: true });
    let counting = false;
    const off = onImageLoadState(s => {
        if (counting && !cancelled && q && s.treeId === q.treeId && s.seq === q.seq && s.phase === 'running') view.waiting(o.title, s, cancel);
    });
    try {
        for (;;) {
            const load: ImageLoadQueue = q!;
            if (load.isAborted() || currentLoad !== load) {
                const next = currentLoad;
                if (next && next.treeId === load.treeId && !next.isAborted()) {
                    q = next;
                    continue;
                }
                return load.holdsOpenTree() ? 'ready' : 'cancelled';
            }
            const s = load.snapshot();
            if (s.left > 0) {
                counting = true;
                view.waiting(o.title, s, cancel);
                await new Promise<void>(resolve => {
                    wake = resolve;
                    void load.whenIdle().then(resolve);
                });
                wake = null;
                counting = false;
                if (cancelled) return 'cancelled';
                continue;
            }
            if (s.failed === 0) return 'ready';
            const choice = await new Promise<AwaitImagesChoice>(resolve => {
                wake = () => resolve('cancel');
                void view.ask(o.title, s).then(resolve);
            });
            wake = null;
            if (cancelled || choice === 'cancel') return 'cancelled';
            if (choice === 'without') return 'without';
            load.retry(load.failedKeys());
        }
    } finally {
        off();
        o.signal?.removeEventListener('abort', cancel);
        view.close();
    }
}
