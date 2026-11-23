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
 * Cleanup: an image no stored tree, no backup and nothing in memory refers to
 * is marked, and removed by a cleanup a week later if still unused
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
import { computeImageMeta, imageMetaOf, setImageMeta, noteImageMeta, noteOwnImages, headMime, type ImageMeta, type ImageMetaRecord } from './image-meta.js';

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

export type Decrypt = (enc: EncryptedData) => Promise<string>;

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
    // A record of this browser's own storage names them: references to them are its own (validation.ts).
    noteOwnImages(media);
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
    noteOwnImages(media);
    return { ids, media, meta };
}

/** Images re-stored under the other kind of id per batch (poolImages: one batch in memory at a time). */
const CONVERT_BATCH_COUNT = 32;

/**
 * What a writer of tree data stores (spec 135, D6): the data hold new images
 * as data URLs (`urls`) and pooled ones as references (`refIds`, their ids).
 * The new ones go into the pool as storeImages puts them; a reference of
 * the current kind is named as it is (its stored size, its catalog entry);
 * one of the other kind (`p:` with encryption on, `e:` with it off: the
 * encryption was switched) is read and stored again under the current kind,
 * a batch at a time, and `ids` maps its reference (`\u0000sm:<old id>`) to
 * the new id — stringifyPooled and replacePooled write that. A reference
 * whose image is not in the pool (or cannot be read now) is named by
 * nothing: it stays in the data as it is. Call under withPoolLock.
 */
export async function poolImages(urls: Set<string>, refIds: ReadonlySet<string>, encrypted: boolean, scope: string): Promise<PooledImages> {
    const out = await storeImages(urls, encrypted, scope);
    if (refIds.size === 0) return out;
    const kind = encrypted ? 'e:' : 'p:';
    const stored = new Set(await StorageManager.keys('media'));
    const convert: string[] = [];
    const named: Record<string, number> = {};
    for (const id of refIds) {
        if (!stored.has(id) || out.media[id] !== undefined) continue;
        if (!id.startsWith(kind)) { convert.push(id); continue; }
        let size = sizeOfStored.get(id);
        if (size === undefined) {
            const record = await StorageManager.get<StoredMedia>('media', id);
            if (!record) continue;
            size = storedSize(record);
            sizeOfStored.set(id, size);
        }
        out.media[id] = size;
        named[id] = size;
        const meta = imageMetaOf(id);
        if (meta) out.meta[id] = meta;
    }
    noteOwnImages(named);
    const convertScope = `${scope}\u0000convert`;
    for (let i = 0; i < convert.length; i += CONVERT_BATCH_COUNT) {
        const part = convert.slice(i, i + CONVERT_BATCH_COUNT);
        const urlsById = await loadImageUrls(part);
        if (urlsById.size === 0) continue;
        const got = await storeImages(new Set(urlsById.values()), encrypted, convertScope);
        for (const [id, url] of urlsById) {
            const next = got.ids.get(url);
            if (!next) continue;
            out.ids.set(POOL_REF + id, next);
            out.media[next] = got.media[next];
            if (got.meta[next]) out.meta[next] = got.meta[next];
        }
    }
    forgetPoolScope(convertScope);
    return out;
}

/**
 * Catalog entries for pooled images this window has none for (a tree stored
 * before the catalog, read before its entries were filled): read in batches,
 * one image of a batch decoded at a time. An image not in the pool, or
 * encrypted while the session is locked, gets none.
 */
export async function ensureImageMeta(ids: Iterable<string>): Promise<void> {
    const want = [...new Set(ids)].filter(id => !imageMetaOf(id));
    for (let i = 0; i < want.length; i += URL_BATCH_COUNT) {
        const part = want.slice(i, i + URL_BATCH_COUNT);
        const records = await StorageManager.getMany<StoredMedia>('media', part);
        for (const id of part) {
            const record = records.get(id);
            if (!record || (record.encrypted && !CryptoSession.isUnlocked())) continue;
            try {
                const url = await decodeMedia(record);
                if (url) await metaOf(id, url, record.bytes && record.head !== undefined ? new Uint8Array(record.bytes) : undefined);
            } catch {
                // Not decodable: no entry (the values fall back as without one).
            }
        }
    }
}

/** The ids of `ids` the pool holds now (one read of its keys). */
export async function pooledIds(ids: Iterable<string>): Promise<Set<string>> {
    const stored = new Set(await StorageManager.keys('media'));
    const out = new Set<string>();
    for (const id of ids) if (stored.has(id)) out.add(id);
    return out;
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

/** A string `ids` names: a long data URL, or a reference that moved to another id (poolImages). */
function pooledKey(value: string, ids: Map<string, string>): boolean {
    return (value.length >= POOL_MIN_LENGTH || value.charCodeAt(0) === 0) && ids.has(value);
}

/** JSON of `data` with its pooled images written as references. */
export function stringifyPooled(data: unknown, ids: Map<string, string>): string {
    if (ids.size === 0) return JSON.stringify(data);
    return JSON.stringify(data, (_key, value) =>
        typeof value === 'string' && pooledKey(value, ids) ? POOL_REF + ids.get(value) : value);
}

/** A copy of `data` (shared strings) with its pooled images as references. */
export function replacePooled<T>(value: T, ids: Map<string, string>): T {
    if (typeof value === 'string') {
        return (pooledKey(value, ids) ? POOL_REF + ids.get(value) : value) as T;
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

/** Images read back per transaction by loadImageUrls (an output's whole tree is read in parts). */
const URL_BATCH_COUNT = 64;

/**
 * Pooled images as data URLs, read in batches of one transaction each
 * (image-expand.ts). An id missing from the pool, one whose record cannot be
 * decoded, or an encrypted one while the session is locked is left out.
 * `decrypt`: decrypts an encrypted record instead of the session.
 */
export async function loadImageUrls(ids: readonly string[], decrypt?: Decrypt): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    for (let i = 0; i < ids.length; i += URL_BATCH_COUNT) {
        const part = ids.slice(i, i + URL_BATCH_COUNT);
        const records = await StorageManager.getMany<StoredMedia>('media', part);
        for (const id of part) {
            const record = records.get(id);
            if (!record) continue;
            try {
                const url = await decodeMedia(record, decrypt);
                if (url) urls.set(id, url);
            } catch {
                // Locked or not decodable: missing.
            }
        }
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
 * The record kinds that name pooled images, asked in this order. The cleanup
 * runs only when all of them have registered — one missing would make its
 * images look unused. 'memory': what this window (and its satellites) holds
 * of the open tree beyond its record (pool-memory.ts).
 */
const REFERENCE_KINDS = ['trees', 'snapshots', 'memory'] as const;

export type PoolReferenceKind = typeof REFERENCE_KINDS[number];

export function registerPoolReferences(kind: PoolReferenceKind, provider: () => Promise<Iterable<string>>): void {
    referenceProviders.set(kind, provider);
}

/**
 * Tells whether this window is the only one of the app that holds the pool's
 * images in memory (the main window registers it: tab-lock.ts). None
 * registered, or not sure: other windows are taken to be there.
 */
let aloneCheck: (() => Promise<boolean>) | null = null;

export function registerPoolAloneCheck(check: (() => Promise<boolean>) | null): void {
    aloneCheck = check;
}

/**
 * The key in the 'media' store of the cleanup's marks: content id → when the
 * cleanup first found that image unused (ms). Not a content id, so never an
 * image (an older version's cleanup removes it as unused: the marks then
 * start again, which only delays a removal).
 */
export const POOL_UNUSED_KEY = 'unused';

/**
 * How long an image stays unused before the cleanup removes it. Another tab
 * keeps its own memory (undo steps, an open dialog) that this one cannot see:
 * an image it still holds is either named again by a save within this time
 * (which takes the mark away) or that tab's state is long gone.
 */
export const POOL_UNUSED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const POOL_KEY = /^[pe]:[0-9a-f]+$/;

/** The cleanup's marks as stored (anything else in the record is dropped). */
async function readUnusedMarks(): Promise<Map<string, number>> {
    const raw = await StorageManager.get<unknown>('media', POOL_UNUSED_KEY);
    const out = new Map<string, number>();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
        if (POOL_KEY.test(id) && typeof at === 'number' && Number.isFinite(at)) out.set(id, at);
    }
    return out;
}

/** The cleanup's marks (tests, diagnostics): content id → when first found unused. */
export async function poolUnusedMarks(): Promise<Map<string, number>> {
    return readUnusedMarks();
}

/**
 * Two-phase cleanup. Call under withPoolLock. The keys are read first: an
 * image stored later is not a candidate. An image no stored tree, backup or
 * memory names is first only marked (the time, kept in the pool's own store
 * so every tab sees it); a later cleanup removes it once it has stayed unused
 * for POOL_UNUSED_GRACE_MS. An image named again loses its mark. Marks of an
 * older pool (none) are set by the first cleanup: it removes nothing.
 * When no other window of the app runs (registerPoolAloneCheck), every
 * memory that could hold an image was asked: an unused image goes at once.
 * `dropKind` (a switch of the encryption, every stored record moved to the
 * other kind): unused images of the old kind go at once — plaintext images
 * must not outlive the switch to encryption by a week.
 * Returns how many images were removed.
 */
export async function collectPoolGarbageLocked(now: number = Date.now(), opts: { dropKind?: 'p:' | 'e:' } = {}): Promise<number> {
    if (REFERENCE_KINDS.some(kind => !referenceProviders.has(kind))) return 0;
    const keys = (await StorageManager.keys('media')).filter(key => POOL_KEY.test(key));
    const marks = await readUnusedMarks();
    if (keys.length === 0 && marks.size === 0) return 0;
    // Each kind takes its images off the candidates; the costlier ones (memory) are not asked when none is left.
    const unused = new Set(keys);
    for (const kind of REFERENCE_KINDS) {
        if (unused.size === 0) break;
        for (const id of await referenceProviders.get(kind)!()) unused.delete(id);
    }
    // Asked after the memory: a window that starts meanwhile holds only what its stored trees name.
    let alone = false;
    if (unused.size > 0 && aloneCheck) {
        try { alone = await aloneCheck(); } catch { alone = false; }
    }
    const next = new Map<string, number>();
    let removed = 0;
    for (const key of unused) {
        const since = alone || (opts.dropKind && key.startsWith(opts.dropKind)) ? -Infinity : marks.get(key);
        // A mark from the future (the clock was set back) starts again from now.
        if (since === undefined || since > now) { next.set(key, now); continue; }
        if (now - since < POOL_UNUSED_GRACE_MS) { next.set(key, since); continue; }
        await StorageManager.delete('media', key);
        sizeOfStored.delete(key);
        removed++;
    }
    const same = next.size === marks.size && [...next].every(([id, at]) => marks.get(id) === at);
    if (!same) {
        if (next.size === 0) await StorageManager.delete('media', POOL_UNUSED_KEY);
        else await StorageManager.set('media', POOL_UNUSED_KEY, Object.fromEntries(next));
    }
    return removed;
}

/** collectPoolGarbageLocked taking the lock itself. Never throws. */
export function collectPoolGarbage(): Promise<number> {
    return withPoolLock(() => collectPoolGarbageLocked()).catch((err) => {
        console.error('Image pool cleanup failed', err);
        return 0;
    });
}
