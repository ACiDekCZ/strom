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

/** What a writer stored: each image's content id, and id → stored bytes. */
export interface PooledImages {
    ids: Map<string, string>;
    media: Record<string, number>;
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

// ---- base64 <-> bytes ----

/** Native base64 of typed arrays (Chrome 140+, Firefox 133+, Safari 18.2+). */
type NativeBase64 = { toBase64?: () => string };
type NativeFromBase64 = { fromBase64?: (b64: string) => Uint8Array };

export function bytesToBase64(bytes: Uint8Array): string {
    const native = (bytes as unknown as NativeBase64).toBase64;
    if (typeof native === 'function') return native.call(bytes);
    // Fallback: build the binary string in large slices. The spread of a
    // 32 KB chunk per call was ~40x slower than native on 80 MB of images.
    const parts: string[] = [];
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]));
    }
    return btoa(parts.join(''));
}

export function base64ToBytes(b64: string): Uint8Array {
    const native = (Uint8Array as unknown as NativeFromBase64).fromBase64;
    if (typeof native === 'function') return native(b64);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

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
            const digest = await crypto.subtle.digest('SHA-256', input as BufferSource);
            id = (encrypted ? 'e:' : 'p:') + hex(digest, 20);
        }
        ids.set(url, id);
    }
    idCaches.set(scope, { pepper: pepperKey, ids });
    return ids;
}

// ---- storing images ----

async function encodeMedia(url: string, encrypted: boolean): Promise<{ record: StoredMedia; size: number }> {
    if (encrypted) {
        const enc = await CryptoSession.encrypt(url);
        return { record: { encrypted: enc }, size: enc.data.length };
    }
    const comma = url.indexOf(',');
    const head = url.slice(0, comma + 1);
    const b64 = url.slice(comma + 1);
    if (head.endsWith(';base64,') && b64.length > 0 && b64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
        try {
            const bytes = base64ToBytes(b64);
            // atob accepts stray bits in the last group; only store bytes that
            // give back exactly the same text.
            const lastGroup = (b64.length / 4 - 1) * 3;
            if (bytesToBase64(bytes.subarray(lastGroup)) === b64.slice(-4)) {
                return { record: { head, bytes: bytes.buffer as ArrayBuffer }, size: bytes.byteLength };
            }
        } catch { /* not base64 after all: kept as text */ }
    }
    return { record: { text: url }, size: url.length };
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

/** Stored sizes of images seen in this session (saves reading them back). */
const sizeOfStored = new Map<string, number>();

/** Remember sizes other records already name (a backup's meta). */
export function notePoolSizes(media: Record<string, number> | undefined): void {
    for (const [id, size] of Object.entries(media ?? {})) sizeOfStored.set(id, size);
}

/**
 * Make sure every image of `urls` is in the pool; returns their ids and
 * sizes. Call under withPoolLock, and write the record naming them before
 * releasing it.
 */
export async function storeImages(urls: Set<string>, encrypted: boolean, scope: string): Promise<PooledImages> {
    const ids = await contentIds(urls, encrypted, scope);
    const stored = new Set(await StorageManager.keys('media'));
    const media: Record<string, number> = {};
    for (const [url, id] of ids) {
        if (media[id] !== undefined) continue;
        if (stored.has(id)) {
            const known = sizeOfStored.get(id);
            if (known !== undefined) { media[id] = known; continue; }
            const record = await StorageManager.get<StoredMedia>('media', id);
            if (record) { media[id] = storedSize(record); sizeOfStored.set(id, media[id]); continue; }
        }
        const { record, size } = await encodeMedia(url, encrypted);
        await StorageManager.set('media', id, record);
        media[id] = size;
        sizeOfStored.set(id, size);
    }
    return { ids, media };
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
