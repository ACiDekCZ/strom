/**
 * The image pool: long data: URLs (photos, attachments, source excerpts) kept
 * once in the 'media' store under a content id, and referred to from stored
 * trees and backups instead of being copied into each of them.
 *
 * A tree with 80 MB of scans used to write all 80 MB on every save and again
 * into every backup. With the pool a save writes the text of the tree (a few
 * MB) plus only the images it has not stored yet, and a backup shares the
 * tree's images — the same picture is on disk once.
 *
 * Content ids: SHA-256 of the data URL ("p:"), or — with encryption on — of a
 * secret derived from the password plus the data URL ("e:"), so ids of
 * encrypted images do not tell which pictures are the same; those images are
 * stored encrypted. The prefixes keep the two kinds apart, and switching
 * encryption re-writes everything under the other kind.
 *
 * Cleanup: an image no stored tree and no backup refers to is removed
 * (collectPoolGarbage). Every change of the pool runs under one lock, shared
 * with the other tabs where the browser has Web Locks: a cleanup must never
 * run between a writer finding an image already stored and that writer's
 * record naming it.
 */

import { StorageManager } from './storage.js';
import { CryptoSession, EncryptedData } from './crypto.js';
import { bytesToBase64, base64ToBytes, canonicalBase64Bytes } from './base64.js';
import { sha256Bytes } from './sha256.js';
import { takeImageBytes } from './known-image-bytes.js';
import { computeImageMeta, imageMetaOf, setImageMeta, noteImageMeta, headMime, type ImageMeta, type ImageMetaRecord } from './image-meta.js';

/** Strings at least this long starting with "data:" go to the pool. */
export const POOL_MIN_LENGTH = 1024;

/**
 * Stands in stored data for a pooled string. The NUL makes it impossible to
 * be real tree text (JSON writes it as \u0000).
 */
export const POOL_REF = '\u0000sm:';
const POOL_REF_JSON = /"\\u0000sm:([pe]:[0-9a-f]+)"/g;
const POOL_REF_ID = /^\u0000sm:([pe]:[0-9a-f]+)$/;

/**
 * A pooled image. Plain: the data URL head and the decoded bytes (a quarter
 * smaller than base64), or the whole text when it is not canonical base64.
 * Encrypted: the data URL encrypted like tree data.
 */
interface StoredMedia {
    head?: string;
    bytes?: ArrayBuffer;
    text?: string;
    encrypted?: EncryptedData;
}

/** What a writer stored: each image's content id, id → stored bytes, and id → catalog entry (image-meta.ts). */
export interface PooledImages {
    ids: Map<string, string>;
    media: Record<string, number>;
    meta: ImageMetaRecord;
}

// ---- the lock ----

let localQueue: Promise<unknown> = Promise.resolve();

type LockManager = { request<T>(name: string, cb: () => Promise<T>): Promise<T> };

/**
 * Run `job` holding the pool lock: Web Locks (all tabs) where available,
 * otherwise a queue in this tab. Not re-entrant — never call from inside.
 */
export function withPoolLock<T>(job: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined'
        ? (navigator as { locks?: LockManager }).locks
        : undefined;
    if (locks?.request) return locks.request('strom-media-pool', job);
    const run = localQueue.then(job, job);
    localQueue = run.catch(() => undefined);
    return run;
}

// ---- base64 <-> bytes (src/base64.ts) ----

export { bytesToBase64, base64ToBytes };

function hex(buf: ArrayBuffer, bytes: number): string {
    return Array.from(new Uint8Array(buf, 0, bytes), b => b.toString(16).padStart(2, '0')).join('');
}

// ---- finding and naming images ----

/** Every long data: URL in the data, each once. */
export function collectPoolable(value: unknown, out: Set<string> = new Set()): Set<string> {
    if (typeof value === 'string') {
        if (value.length >= POOL_MIN_LENGTH && value.startsWith('data:')) out.add(value);
    } else if (Array.isArray(value)) {
        for (const v of value) collectPoolable(v, out);
    } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) collectPoolable(v, out);
    }
    return out;
}

/**
 * Content ids per writer (a tree id), reused while its strings stay the same
 * objects between saves. Rebuilt on every call with only the current images,
 * so it never keeps a picture the tree dropped alive.
 */
const idCaches = new Map<string, { pepper: string; ids: Map<string, string> }>();

/** Forget a writer's cached ids (its tree was deleted). */
export function forgetPoolScope(scope: string): void {
    idCaches.delete(scope);
}

/**
 * Seed a writer's cached ids with images just read back (their ids came with
 * them): the first save after loading a tree then hashes nothing.
 */
export async function seedPoolScope(scope: string, urlsById: Map<string, string>, encrypted: boolean): Promise<void> {
    if (urlsById.size === 0) return;
    const pepper = encrypted ? await CryptoSession.contentPepper() : null;
    const pepperKey = pepper ? hex(pepper.buffer as ArrayBuffer, pepper.byteLength) : 'plain';
    const prefix = encrypted ? 'e:' : 'p:';
    const ids = new Map<string, string>();
    for (const [id, url] of urlsById) if (id.startsWith(prefix) && url) ids.set(url, id);
    idCaches.set(scope, { pepper: pepperKey, ids });
}

async function contentIds(urls: Set<string>, encrypted: boolean, scope: string): Promise<Map<string, string>> {
    const pepper = encrypted ? await CryptoSession.contentPepper() : null;
    const pepperKey = pepper ? hex(pepper.buffer as ArrayBuffer, pepper.byteLength) : 'plain';
    const cached = idCaches.get(scope);
    const previous = cached?.pepper === pepperKey ? cached.ids : new Map<string, string>();
    const ids = new Map<string, string>();
    const encoder = new TextEncoder();
    for (const url of urls) {
        let id = previous.get(url);
        if (!id) {
            const text = encoder.encode(url);
            let input: Uint8Array = text;
            if (pepper) {
                input = new Uint8Array(pepper.length + text.length);
                input.set(pepper);
                input.set(text, pepper.length);
            }
            const digest = await sha256Bytes(input);
            id = (encrypted ? 'e:' : 'p:') + hex(digest, 20);
        }
        ids.set(url, id);
    }
    idCaches.set(scope, { pepper: pepperKey, ids });
    return ids;
}

// ---- storing images ----

/** The bytes as an ArrayBuffer of exactly their length (a view may sit in a larger one). */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer as ArrayBuffer
        : bytes.slice().buffer as ArrayBuffer;
}

/** The stored form of an image; `bytes`: its decoded bytes when they came along (for its catalog entry). */
async function encodeMedia(url: string, encrypted: boolean): Promise<{ record: StoredMedia; size: number; bytes?: Uint8Array }> {
    const known = takeImageBytes(url);
    if (encrypted) {
        const enc = await CryptoSession.encrypt(url);
        return { record: { encrypted: enc }, size: enc.data.length, ...(known ? { bytes: known } : {}) };
    }
    const comma = url.indexOf(',');
    const head = url.slice(0, comma + 1);
    if (!head.endsWith(';base64,')) return { record: { text: url }, size: url.length };
    // Only bytes that give back exactly the same text are stored as bytes.
    const bytes = known ?? canonicalBase64Bytes(url.slice(comma + 1));
    if (bytes) return { record: { head, bytes: ownBuffer(bytes) }, size: bytes.byteLength, bytes };
    return { record: { text: url }, size: url.length };
}

/** The catalog entry of an image (computed once per window, image-meta.ts). */
async function metaOf(id: string, url: string, bytes?: Uint8Array): Promise<ImageMeta> {
    let meta = imageMetaOf(id);
    if (!meta) {
        meta = await computeImageMeta(url, bytes);
        setImageMeta(id, meta);
    }
    return meta;
}

type Decrypt = (enc: EncryptedData) => Promise<string>;

async function decodeMedia(record: StoredMedia, decrypt?: Decrypt): Promise<string> {
    if (record.encrypted) {
        if (decrypt) return decrypt(record.encrypted);
        if (!CryptoSession.isUnlocked()) throw new Error('locked');
        return CryptoSession.decrypt(record.encrypted);
    }
    if (record.bytes && record.head !== undefined) return record.head + bytesToBase64(new Uint8Array(record.bytes));
    return record.text ?? '';
}

function storedSize(record: StoredMedia): number {
    if (record.encrypted) return record.encrypted.data.length;
    if (record.bytes) return record.bytes.byteLength;
    return record.text?.length ?? 0;
}

/** New images written in one transaction: at most this many bytes … */
const MEDIA_BATCH_BYTES = 16 * 1024 * 1024;
/** … or this many images. */
const MEDIA_BATCH_COUNT = 256;

/** Stored sizes of images seen in this session (saves reading them back). */
const sizeOfStored = new Map<string, number>();

/** Remember sizes other records already name (a backup's meta). */
export function notePoolSizes(media: Record<string, number> | undefined): void {
    for (const [id, size] of Object.entries(media ?? {})) sizeOfStored.set(id, size);
}

/**
 * Make sure every image of `urls` is in the pool; returns their ids, sizes
 * and catalog entries. Call under withPoolLock, and write the record naming
 * them before releasing it.
 */
export async function storeImages(urls: Set<string>, encrypted: boolean, scope: string): Promise<PooledImages> {
    const ids = await contentIds(urls, encrypted, scope);
    const stored = new Set(await StorageManager.keys('media'));
    const media: Record<string, number> = {};
    const meta: ImageMetaRecord = {};
    // New images go in a few transactions, not one each (a transaction per
    // image took 1.5 s for a thousand photos; one took 0.2 s).
    let batch: { store: 'media'; key: string; value: StoredMedia }[] = [];
    let batchBytes = 0;
    const writeBatch = async (): Promise<void> => {
        if (!batch.length) return;
        const writes = batch;
        batch = [];
        batchBytes = 0;
        await StorageManager.setTogether(writes);
        for (const w of writes) sizeOfStored.set(w.key, media[w.key]);
    };
    for (const [url, id] of ids) {
        if (media[id] !== undefined) continue;
        if (stored.has(id)) {
            const known = sizeOfStored.get(id);
            if (known !== undefined) { media[id] = known; meta[id] = await metaOf(id, url); continue; }
            const record = await StorageManager.get<StoredMedia>('media', id);
            if (record) {
                media[id] = storedSize(record);
                sizeOfStored.set(id, media[id]);
                meta[id] = await metaOf(id, url, record.bytes && record.head !== undefined ? new Uint8Array(record.bytes) : undefined);
                continue;
            }
        }
        const { record, size, bytes } = await encodeMedia(url, encrypted);
        meta[id] = await metaOf(id, url, bytes);
        batch.push({ store: 'media', key: id, value: record });
        batchBytes += size;
        media[id] = size;
        if (batchBytes >= MEDIA_BATCH_BYTES || batch.length >= MEDIA_BATCH_COUNT) await writeBatch();
    }
    await writeBatch();
    return { ids, media, meta };
}

// ---- the catalog in stored records ----

/**
 * The catalog entries as a stored record keeps them: plain, or — for an
 * encrypted record — encrypted like its data (the entries carry the bytes'
 * hash, which would tell which pictures a tree has).
 */
export async function packImageMeta(meta: ImageMetaRecord, encrypted: boolean): Promise<ImageMetaRecord | EncryptedData | undefined> {
    if (Object.keys(meta).length === 0) return undefined;
    return encrypted ? CryptoSession.encrypt(JSON.stringify(meta)) : meta;
}

/**
 * Take a stored record's catalog entries into memory (image-meta.ts) and
 * return them; null when there are none or they cannot be read (locked,
 * another key: the entries are computed again when needed).
 */
export async function unpackImageMeta(stored: unknown, decrypt?: Decrypt): Promise<ImageMetaRecord | null> {
    if (!stored || typeof stored !== 'object') return null;
    let record: unknown = stored;
    if ((stored as { encrypted?: unknown }).encrypted === true) {
        try {
            if (decrypt) record = JSON.parse(await decrypt(stored as EncryptedData));
            else if (CryptoSession.isUnlocked()) record = JSON.parse(await CryptoSession.decrypt(stored as EncryptedData));
            else return null;
        } catch {
            return null;
        }
    }
    if (!record || typeof record !== 'object') return null;
    noteImageMeta(record);
    return record as ImageMetaRecord;
}

/**
 * The catalog entry of a pooled image, read from the pool when this window
 * has none yet (one image at a time). Null: not in the pool, or encrypted and
 * the session is locked.
 */
export async function pooledImageMeta(id: string): Promise<ImageMeta | null> {
    const known = imageMetaOf(id);
    if (known) return known;
    const record = await StorageManager.get<StoredMedia>('media', id);
    if (!record) return null;
    if (record.encrypted && !CryptoSession.isUnlocked()) return null;
    let url: string;
    try {
        url = await decodeMedia(record);
    } catch {
        return null;
    }
    return metaOf(id, url, record.bytes && record.head !== undefined ? new Uint8Array(record.bytes) : undefined);
}

/** JSON of `data` with its pooled images written as references. */
export function stringifyPooled(data: unknown, ids: Map<string, string>): string {
    if (ids.size === 0) return JSON.stringify(data);
    return JSON.stringify(data, (_key, value) =>
        typeof value === 'string' && value.length >= POOL_MIN_LENGTH && ids.has(value) ? POOL_REF + ids.get(value) : value);
}

/** A copy of `data` (shared strings) with its pooled images as references. */
export function replacePooled<T>(value: T, ids: Map<string, string>): T {
    if (typeof value === 'string') {
        return (value.length >= POOL_MIN_LENGTH && ids.has(value) ? POOL_REF + ids.get(value) : value) as T;
    }
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(v => replacePooled(v, ids)) as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = replacePooled(v, ids);
    return out as T;
}

// ---- reading images back ----

/**
 * A pooled image as a Blob of its bytes: straight from the stored bytes (no
 * base64 on the way), from a stored text, or decrypted. Null: not in the
 * pool, or encrypted and the session is locked.
 */
async function blobOf(record: StoredMedia): Promise<Blob | null> {
    if (record.bytes && record.head !== undefined) {
        return new Blob([record.bytes], { type: headMime(record.head) });
    }
    let url: string;
    if (record.encrypted) {
        if (!CryptoSession.isUnlocked()) return null;
        try {
            url = await CryptoSession.decrypt(record.encrypted);
        } catch {
            return null;
        }
    } else {
        url = record.text ?? '';
    }
    return dataUrlBlob(url);
}

/** The bytes a data URL carries as a Blob of its type (null: not a data URL). */
export function dataUrlBlob(url: string): Blob | null {
    const comma = url.indexOf(',');
    if (!url.startsWith('data:') || comma < 0) return null;
    const head = url.slice(0, comma + 1);
    const type = headMime(head);
    const body = url.slice(comma + 1);
    if (head.endsWith(';base64,')) {
        try {
            return new Blob([base64ToBytes(body.replace(/\s+/g, '')) as BlobPart], { type });
        } catch {
            return null;
        }
    }
    let text: string;
    try {
        text = decodeURIComponent(body);
    } catch {
        text = body;
    }
    return new Blob([text], { type });
}

/**
 * Pooled images as Blobs, read in one transaction (image-src.ts). An id
 * missing from the pool, or encrypted while the session is locked, maps to
 * null.
 */
export async function loadImageBlobs(ids: readonly string[]): Promise<Map<string, Blob | null>> {
    const out = new Map<string, Blob | null>();
    if (ids.length === 0) return out;
    const records = await StorageManager.getMany<StoredMedia>('media', [...ids]);
    for (const id of ids) {
        const record = records.get(id);
        out.set(id, record ? await blobOf(record) : null);
    }
    return out;
}

/** The images of `ids` from the pool (missing ones left out). */
async function loadImages(ids: Set<string>, decrypt?: Decrypt): Promise<Map<string, string>> {
    const records = await StorageManager.getMany<StoredMedia>('media', [...ids]);
    const urls = new Map<string, string>();
    for (const [id, record] of records) {
        if (record) urls.set(id, await decodeMedia(record, decrypt));
    }
    return urls;
}

/**
 * Put the images back into JSON written by stringifyPooled. An image missing
 * from the pool becomes empty text — the load sanitiser drops such an image;
 * the rest is still worth having. `missing` counts them.
 */
export async function unpoolJson(json: string, decrypt?: Decrypt): Promise<{ json: string; missing: number; urls: Map<string, string> }> {
    const ids = new Set<string>();
    for (const m of json.matchAll(POOL_REF_JSON)) ids.add(m[1]);
    if (ids.size === 0) return { json, missing: 0, urls: new Map() };
    const urls = await loadImages(ids, decrypt);
    let missing = 0;
    for (const id of ids) if (!urls.has(id)) missing++;
    return {
        json: json.replace(POOL_REF_JSON, (_m, id: string) => JSON.stringify(urls.get(id) ?? '')),
        missing,
        urls,
    };
}

function collectRefs(value: unknown, out: Set<string>): void {
    if (typeof value === 'string') {
        const m = POOL_REF_ID.exec(value);
        if (m) out.add(m[1]);
    } else if (Array.isArray(value)) {
        for (const v of value) collectRefs(v, out);
    } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) collectRefs(v, out);
    }
}

function fillRefs(value: unknown, urls: Map<string, string>): unknown {
    if (typeof value === 'string') {
        const m = POOL_REF_ID.exec(value);
        return m ? urls.get(m[1]) ?? '' : value;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = fillRefs(value[i], urls);
        return value;
    }
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        for (const k of Object.keys(obj)) obj[k] = fillRefs(obj[k], urls);
    }
    return value;
}

/** Put the images back into data written by replacePooled (in place). */
export async function unpoolObject<T>(data: T): Promise<{ data: T; missing: number; urls: Map<string, string> }> {
    const ids = new Set<string>();
    collectRefs(data, ids);
    if (ids.size === 0) return { data, missing: 0, urls: new Map() };
    const urls = await loadImages(ids);
    let missing = 0;
    for (const id of ids) if (!urls.has(id)) missing++;
    return { data: fillRefs(data, urls) as T, missing, urls };
}

// ---- cleanup ----

/** Who refers to pooled images: each returns the ids its records name. */
const referenceProviders = new Map<string, () => Promise<Iterable<string>>>();

/**
 * The record kinds that name pooled images. The cleanup runs only when all of
 * them have registered — one missing would make its images look unused.
 */
const REFERENCE_KINDS = ['trees', 'snapshots'] as const;

export function registerPoolReferences(kind: typeof REFERENCE_KINDS[number], provider: () => Promise<Iterable<string>>): void {
    referenceProviders.set(kind, provider);
}

/**
 * Remove images nothing refers to. Call under withPoolLock. The keys are read
 * first: an image stored later is not a candidate.
 */
export async function collectPoolGarbageLocked(): Promise<number> {
    if (REFERENCE_KINDS.some(kind => !referenceProviders.has(kind))) return 0;
    const keys = await StorageManager.keys('media');
    if (keys.length === 0) return 0;
    const used = new Set<string>();
    for (const provider of referenceProviders.values()) {
        for (const id of await provider()) used.add(id);
    }
    let removed = 0;
    for (const key of keys) {
        if (used.has(key)) continue;
        await StorageManager.delete('media', key);
        sizeOfStored.delete(key);
        removed++;
    }
    return removed;
}

/** collectPoolGarbageLocked taking the lock itself. Never throws. */
export function collectPoolGarbage(): Promise<number> {
    return withPoolLock(collectPoolGarbageLocked).catch((err) => {
        console.error('Image pool cleanup failed', err);
        return 0;
    });
}
