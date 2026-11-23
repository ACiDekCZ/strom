/**
 * The tree in memory holds pooled images as references (spec 135, part D6):
 * `\u0000sm:<id>` (image-ref.ts) where an image may be — a person's or a
 * couple's photo, an attachment's file, a source excerpt's crop — exactly
 * as the stored tree record names them. Reading a tree does not put the
 * images back (settleStoredImages); a new image (uploaded, cropped, from an
 * import or a research) is a data URL until its tree is saved, and the save
 * replaces it with its reference wherever the tree's states hold it
 * (imagesInterned → the open tree, its undo and redo steps, the state a
 * dialog goes back to): going back and forth and saving copy no image.
 *
 * Only the four places of an image take part. A long text starting with
 * `data:` anywhere else (a note) is text: it is stored as it is — a record
 * written before this part pooled it like an image, and reading puts it
 * back as text.
 */

import type { StromData } from './types.js';
import { poolIdOf, POOL_REF } from './image-ref.js';
import {
    POOL_MIN_LENGTH, loadImageUrls, pooledIds, ensureImageMeta, withPoolLock, storeImages, forgetPoolScope, type Decrypt,
} from './media-pool.js';
import { imageMetaOf } from './image-meta.js';

type Holder = Record<string, unknown>;

/** Every place an image may be: its holder object and the key under which it stands. */
export function forEachImagePlace(data: StromData, fn: (holder: Holder, key: string) => void): void {
    const visit = (holder: unknown, key: string): void => {
        if (holder && typeof holder === 'object' && !Array.isArray(holder)) fn(holder as Holder, key);
    };
    for (const p of Object.values(data.persons ?? {})) visit(p, 'photo');
    for (const u of Object.values(data.partnerships ?? {})) visit(u, 'photo');
    for (const a of Object.values(data.media ?? {})) visit(a, 'dataUrl');
    for (const src of Object.values(data.sources ?? {})) {
        const list = src && typeof src === 'object' ? (src as { excerpts?: unknown }).excerpts : undefined;
        if (Array.isArray(list)) for (const e of list) visit(e, 'dataUrl');
    }
}

/** A long data URL, as the pool takes one. */
function isPoolable(value: unknown): value is string {
    return typeof value === 'string' && value.length >= POOL_MIN_LENGTH && value.startsWith('data:');
}

/** The images tree data hold: new ones (long data URLs) and pooled ones (ids of their references). */
export function treeImages(data: StromData): { urls: Set<string>; refIds: Set<string> } {
    const urls = new Set<string>();
    const refIds = new Set<string>();
    forEachImagePlace(data, (holder, key) => {
        const v = holder[key];
        if (isPoolable(v)) urls.add(v);
        else {
            const id = poolIdOf(v);
            if (id) refIds.add(id);
        }
    });
    return { urls, refIds };
}

/**
 * How many more characters the data's JSON would have with every pooled
 * image whole (from the catalog: an image without an entry counts 0) — a
 * tree's size as the list of trees shows it stays what it was.
 */
export function pooledImageChars(data: StromData): number {
    let n = 0;
    forEachImagePlace(data, (holder, key) => {
        const id = poolIdOf(holder[key]);
        const len = id ? imageMetaOf(id)?.len : undefined;
        if (len) n += Math.max(0, len - 46);
    });
    return n;
}

/**
 * Replace in place every image of `data` that `map` names (a data URL just
 * stored → its reference; a reference of the other kind → the new one).
 * The number replaced.
 */
export function internImages(data: StromData | null | undefined, map: ReadonlyMap<string, string>): number {
    if (!data || map.size === 0) return 0;
    let n = 0;
    forEachImagePlace(data, (holder, key) => {
        const v = holder[key];
        if (typeof v !== 'string') return;
        const next = map.get(v);
        if (next !== undefined && next !== v) { holder[key] = next; n++; }
    });
    return n;
}

/**
 * A copy of `data` with every image `map` names replaced; the input is not
 * changed and shares with the copy all it did not need changed (a record
 * without a replaced image is the same object in both).
 */
export function withImagesReplaced(data: StromData, map: ReadonlyMap<string, string>): StromData {
    const swap = (v: unknown): string | undefined => typeof v === 'string' ? map.get(v) : undefined;
    const records = <T extends object>(list: Record<string, T> | undefined, key: string): Record<string, T> | undefined => {
        if (!list) return list;
        let out: Record<string, T> | undefined;
        for (const [id, rec] of Object.entries(list)) {
            const next = rec && typeof rec === 'object' ? swap((rec as Holder)[key]) : undefined;
            if (next === undefined) continue;
            out ??= { ...list };
            out[id] = { ...rec, [key]: next };
        }
        return out ?? list;
    };
    const copy: StromData = { ...data };
    copy.persons = records(data.persons, 'photo') ?? data.persons;
    copy.partnerships = records(data.partnerships, 'photo') ?? data.partnerships;
    if (data.media) copy.media = records(data.media, 'dataUrl');
    if (data.sources) {
        let sources: typeof data.sources | undefined;
        for (const [id, src] of Object.entries(data.sources)) {
            const list = src && typeof src === 'object' ? (src as { excerpts?: unknown }).excerpts : undefined;
            if (!Array.isArray(list) || !list.some(e => e && typeof e === 'object' && swap((e as Holder).dataUrl) !== undefined)) continue;
            sources ??= { ...data.sources };
            sources[id as keyof typeof sources] = {
                ...src,
                excerpts: list.map(e => {
                    const next = e && typeof e === 'object' ? swap((e as Holder).dataUrl) : undefined;
                    return next === undefined ? e : { ...e, dataUrl: next };
                }),
            } as typeof src;
        }
        if (sources) copy.sources = sources;
    }
    return copy;
}

/**
 * Tree data from outside the trees (a file or a packet to merge) with their
 * new images stored in the pool, as an import stores them: a copy holding
 * references where the data hold long data URLs (withImagesReplaced; the
 * input stays as it is). `adopt` takes the copy while the pool lock is still
 * held — the holder that names its images (pool-memory.ts) has them before
 * a cleanup can look — and says whether it did. Null when nothing was
 * stored (no long data URL, or not adopted).
 */
export async function poolTreeImages(
    data: StromData, scope: string, encrypted: boolean, adopt: (pooled: StromData) => boolean,
): Promise<StromData | null> {
    if (treeImages(data).urls.size === 0) return null;
    return withPoolLock(async () => {
        // Asked again under the lock: the data may have changed meanwhile.
        const { urls } = treeImages(data);
        if (urls.size === 0) return null;
        try {
            const { ids } = await storeImages(urls, encrypted, scope);
            const map = new Map<string, string>();
            for (const [url, id] of ids) map.set(url, POOL_REF + id);
            const pooled = withImagesReplaced(data, map);
            return adopt(pooled) ? pooled : null;
        } finally {
            forgetPoolScope(scope);
        }
    });
}

/** Every string of `value` that is exactly a pool reference, outside the places of an image. */
function strayRefs(data: StromData): { at: Holder | unknown[]; key: string | number; id: string }[] {
    const places = new Map<object, string>();
    forEachImagePlace(data, (holder, key) => places.set(holder, key));
    const out: { at: Holder | unknown[]; key: string | number; id: string }[] = [];
    const walk = (value: object, depth: number): void => {
        if (depth > 64) return;
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const v: unknown = value[i];
                if (typeof v === 'string') {
                    const id = v.length === 46 ? poolIdOf(v) : null;
                    if (id) out.push({ at: value, key: i, id });
                } else if (v && typeof v === 'object') walk(v, depth + 1);
            }
            return;
        }
        const obj = value as Holder;
        const own = places.get(value);
        for (const k in obj) {
            const v = obj[k];
            if (typeof v === 'string') {
                if (k === own || v.length !== 46) continue;
                const id = poolIdOf(v);
                if (id) out.push({ at: obj, key: k, id });
            } else if (v && typeof v === 'object') walk(v, depth + 1);
        }
    };
    walk(data, 0);
    return out;
}

export interface SettleOptions {
    /** Decrypts an encrypted text put back instead of the session. */
    decrypt?: Decrypt;
}

/**
 * Tree data as a stored record or backup gives them, made ready for memory
 * (in place): the images stay references; a reference outside the places of
 * an image (a long text starting with `data:` a record pooled before this
 * part) gets its text back; a reference whose image the pool no longer has
 * becomes empty text, as reading the images back did (the load sanitizer
 * drops it); pooled images without a catalog entry get one (their sizes and
 * fingerprints then come out as from their data URL). `missing`: images not
 * in the pool.
 */
export async function settleStoredImages(data: StromData, o: SettleOptions = {}): Promise<{ missing: number }> {
    let missing = 0;
    const stray = strayRefs(data);
    if (stray.length) {
        const texts = await loadImageUrls([...new Set(stray.map(s => s.id))], o.decrypt);
        for (const s of stray) {
            const text = texts.get(s.id);
            if (text === undefined) missing++;
            (s.at as Record<string | number, unknown>)[s.key] = text ?? '';
        }
    }
    const { refIds } = treeImages(data);
    if (refIds.size === 0) return { missing };
    const held = await pooledIds(refIds);
    if (held.size < refIds.size) {
        forEachImagePlace(data, (holder, key) => {
            const id = poolIdOf(holder[key]);
            if (id && !held.has(id)) { holder[key] = ''; missing++; }
        });
    }
    await ensureImageMeta(held);
    return { missing };
}

// ---- telling the states of a tree that its images were stored ----

type InternListener = (treeId: string, map: ReadonlyMap<string, string>) => void;

const listeners = new Set<InternListener>();

/** Listen to images of a tree stored (the open tree's states take their references). */
export function onImagesInterned(listener: InternListener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/**
 * Images of tree `treeId` were stored (under the pool lock, with the record
 * naming them written): `map` takes each stored value to its reference.
 */
export function imagesInterned(treeId: string, map: ReadonlyMap<string, string>): void {
    if (map.size === 0) return;
    for (const l of [...listeners]) {
        try { l(treeId, map); } catch (err) { console.error('image intern listener failed', err); }
    }
}
