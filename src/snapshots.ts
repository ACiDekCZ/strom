/**
 * Versioned backups ("time capsule"): compressed, optionally encrypted
 * snapshots of a tree's data, kept in IndexedDB outside StromData. Auto-taken
 * on the first mutation of the day and before import/merge, plus on demand.
 * Restore lives in DataManager (it must go through migrateData + the undo path).
 *
 * Images (photos, scans, excerpts — long data: URLs) are pooled: a snapshot
 * holds a reference per image, the image itself is stored once in the
 * 'snapshotMedia' store under a content id and shared by every snapshot that
 * has it. Consecutive backups differ in a few kB of text, not in their
 * images, so twenty backups of a tree with 80 MB of scans take ~80 MB, not
 * twenty times that.
 */

import { StromData } from './types.js';
import { StorageManager } from './storage.js';
import { SettingsManager } from './settings.js';
import { CryptoSession, EncryptedData } from './crypto.js';

export type SnapshotReason = 'auto' | 'manual' | 'pre-import' | 'pre-merge';

export interface SnapshotMeta {
    id: string;
    treeId: string;
    createdAt: number;      // ms epoch
    personCount: number;
    /** The snapshot record itself (the text of the tree; everything when not pooled). */
    sizeBytes: number;
    reason: SnapshotReason;
    /** Pooled images the snapshot refers to: content id → stored bytes. */
    media?: Record<string, number>;
}

/** IndexedDB record: meta + exactly one payload encoding. */
interface StoredSnapshot {
    meta: SnapshotMeta;
    encrypted?: EncryptedData;   // encryption on → same path as tree data
    gzip?: string;               // base64(gzip(JSON))
    plain?: string;              // uncompressed JSON (fallback)
}

/** Keep at most this many snapshots per tree (oldest dropped). */
export const MAX_SNAPSHOTS_PER_TREE = 20;

/**
 * Space a tree's snapshots may take. Past it the oldest go early — a tree
 * carrying tens of MB of scans would otherwise keep 20 copies of them. Plain
 * text trees (a few MB compressed at most) never get near it.
 */
export const SNAPSHOT_TREE_BUDGET_BYTES = 150 * 1024 * 1024;

/**
 * The space budget on a small device: this share of the browser's quota when
 * that is less than SNAPSHOT_TREE_BUDGET_BYTES.
 */
export const SNAPSHOT_QUOTA_SHARE = 0.1;

/** The newest snapshots always kept, whatever the space (a safety net). */
export const MIN_SNAPSHOTS_KEPT = 3;

/** Browser storage this full (usage / quota) keeps only MIN_SNAPSHOTS_KEPT. */
export const STORAGE_PRESSURE_RATIO = 0.8;

/** Fired on window when retention dropped snapshots for space; detail: SnapshotTrim. */
export const SNAPSHOTS_TRIMMED_EVENT = 'strom:snapshots-trimmed';

export interface SnapshotTrim {
    treeId: string;
    /** How many snapshots the space rule removed. */
    removed: number;
    /** How many are left. */
    kept: number;
    /** The browser's storage is nearly full (not just this tree's budget). */
    storageFull: boolean;
    /** Even the newest backup alone does not fit the budget: better turned off. */
    tooBig?: boolean;
}

/**
 * Snapshot records: the payload under the snapshot id, and a small copy of
 * its meta under META_PREFIX + id — listing and retention read only these,
 * never the payloads (tens of MB each for a tree with scans).
 */
const META_PREFIX = 'meta:';

/** Strings at least this long starting with "data:" go to the image pool. */
const POOL_MIN_LENGTH = 1024;

/**
 * Stands in a snapshot's JSON for a pooled string. The NUL makes it
 * impossible to be real tree text (JSON writes it as \u0000).
 */
const POOL_REF = '\u0000sm:';
const POOL_REF_JSON = /"\\u0000sm:([pe]:[0-9a-f]+)"/g;

/**
 * A pooled image. Plain: the data URL head and the decoded bytes (a third
 * smaller than base64), or the whole text when it is not canonical base64.
 * Encrypted: the data URL encrypted like tree data.
 */
interface StoredMedia {
    head?: string;
    bytes?: ArrayBuffer;
    text?: string;
    encrypted?: EncryptedData;
}

/**
 * Snapshot operations of this tab, one at a time: the pool cleanup must never
 * run between a new snapshot deciding an image is already stored and that
 * snapshot's record listing it.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
}

// ---- base64 <-> bytes ----
function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// ---- gzip via CompressionStream (with graceful fallback) ----
async function gzipToBase64(text: string): Promise<string | null> {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
        const buf = await new Response(stream).arrayBuffer();
        return bytesToBase64(new Uint8Array(buf));
    } catch {
        return null;
    }
}
async function gunzipFromBase64(b64: string): Promise<string> {
    const stream = new Blob([base64ToBytes(b64) as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}

/** Local calendar day key (for daily-auto merging). */
function dayKey(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

// ---- the image pool ----

function hex(buf: ArrayBuffer, bytes: number): string {
    return Array.from(new Uint8Array(buf, 0, bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/** Every long data: URL in the tree, each once. */
function collectPoolable(value: unknown, out: Set<string>): void {
    if (typeof value === 'string') {
        if (value.length >= POOL_MIN_LENGTH && value.startsWith('data:')) out.add(value);
    } else if (Array.isArray(value)) {
        for (const v of value) collectPoolable(v, out);
    } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) collectPoolable(v, out);
    }
}

/**
 * Content ids of the last snapshot's images, reused while the strings are the
 * same (the tree keeps its images as the same string objects between edits).
 * Rebuilt every time, so it never holds an image the tree dropped.
 */
let idCache: { pepper: string; ids: Map<string, string> } = { pepper: '', ids: new Map() };

/**
 * The content id of an image: SHA-256 of the data URL, keyed with a secret
 * from the password when encrypted (so ids do not tell whether two encrypted
 * backups hold the same picture). The prefix keeps the two kinds apart.
 */
async function contentIds(urls: Set<string>, encrypted: boolean): Promise<Map<string, string>> {
    const pepper = encrypted ? await CryptoSession.contentPepper() : null;
    const pepperKey = pepper ? hex(pepper.buffer as ArrayBuffer, pepper.byteLength) : 'plain';
    const previous = idCache.pepper === pepperKey ? idCache.ids : new Map<string, string>();
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
    idCache = { pepper: pepperKey, ids };
    return ids;
}

/** An image as stored in the pool. */
async function encodeMedia(url: string, encrypted: boolean): Promise<{ record: StoredMedia; size: number }> {
    if (encrypted) {
        const enc = await CryptoSession.encrypt(url);
        return { record: { encrypted: enc }, size: enc.data.length };
    }
    const comma = url.indexOf(',');
    const head = url.slice(0, comma + 1);
    const b64 = url.slice(comma + 1);
    if (head.endsWith(';base64,') && b64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
        try {
            const bytes = base64ToBytes(b64);
            // atob accepts stray bits in the last group; only store bytes that
            // give back exactly the same text.
            const lastGroup = (b64.length / 4 - 1) * 3;
            if (b64.length === 0 || bytesToBase64(bytes.subarray(lastGroup)) === b64.slice(-4)) {
                return { record: { head, bytes: bytes.buffer as ArrayBuffer }, size: bytes.byteLength };
            }
        } catch { /* not base64 after all: kept as text */ }
    }
    return { record: { text: url }, size: url.length };
}

async function decodeMedia(record: StoredMedia): Promise<string> {
    if (record.encrypted) {
        if (!CryptoSession.isUnlocked()) throw new Error('locked');
        return CryptoSession.decrypt(record.encrypted);
    }
    if (record.bytes && record.head !== undefined) return record.head + bytesToBase64(new Uint8Array(record.bytes));
    return record.text ?? '';
}

/**
 * The snapshot's JSON with its images replaced by references, the images
 * missing from the pool written there, and the content ids it uses.
 */
async function poolImages(data: StromData, encrypted: boolean): Promise<{ json: string; media: Record<string, number> }> {
    const urls = new Set<string>();
    collectPoolable(data, urls);
    if (urls.size === 0) return { json: JSON.stringify(data), media: {} };
    const ids = await contentIds(urls, encrypted);
    const stored = new Set(await StorageManager.keys('snapshotMedia'));
    for (const meta of await allMetas()) {
        for (const [id, size] of Object.entries(meta.media ?? {})) sizeOfStored.set(id, size);
    }
    const media: Record<string, number> = {};
    for (const [url, id] of ids) {
        if (media[id] !== undefined) continue;
        if (stored.has(id)) {
            const known = sizeOfStored.get(id);
            if (known !== undefined) { media[id] = known; continue; }
            const record = await StorageManager.get<StoredMedia>('snapshotMedia', id);
            if (record) { media[id] = storedSize(record); sizeOfStored.set(id, media[id]); continue; }
        }
        const { record, size } = await encodeMedia(url, encrypted);
        await StorageManager.set('snapshotMedia', id, record);
        media[id] = size;
        sizeOfStored.set(id, size);
    }
    const json = JSON.stringify(data, (_key, value) =>
        typeof value === 'string' && value.length >= POOL_MIN_LENGTH ? (ids.has(value) ? POOL_REF + ids.get(value) : value) : value);
    return { json, media };
}

/** Stored sizes of pooled images seen in this session (saves reading them back). */
const sizeOfStored = new Map<string, number>();

function storedSize(record: StoredMedia): number {
    if (record.encrypted) return record.encrypted.data.length;
    if (record.bytes) return record.bytes.byteLength;
    return record.text?.length ?? 0;
}

/**
 * Put the images back into a snapshot's JSON. An image missing from the pool
 * (a cleanup raced by another tab) becomes empty text — the load sanitiser
 * drops such an image; the rest of the backup is still worth having.
 */
async function unpoolImages(json: string): Promise<{ json: string; missing: number }> {
    const ids = new Set<string>();
    for (const m of json.matchAll(POOL_REF_JSON)) ids.add(m[1]);
    if (ids.size === 0) return { json, missing: 0 };
    const urls = new Map<string, string>();
    let missing = 0;
    for (const id of ids) {
        const record = await StorageManager.get<StoredMedia>('snapshotMedia', id);
        if (record) urls.set(id, await decodeMedia(record));
        else missing++;
    }
    return {
        json: json.replace(POOL_REF_JSON, (_m, id: string) => JSON.stringify(urls.get(id) ?? '')),
        missing,
    };
}

/**
 * Remove pooled images no snapshot refers to. The keys are read BEFORE the
 * metas: an image written after that is not a candidate, and one written
 * before belongs to a snapshot whose record (written first) is then seen.
 */
async function collectPoolGarbage(): Promise<void> {
    const keys = await StorageManager.keys('snapshotMedia');
    if (keys.length === 0) return;
    const used = new Set<string>();
    for (const meta of await allMetas()) {
        for (const id of Object.keys(meta.media ?? {})) used.add(id);
    }
    for (const key of keys) {
        if (used.has(key)) continue;
        await StorageManager.delete('snapshotMedia', key);
        sizeOfStored.delete(key);
    }
}

/** Write a snapshot record + its meta for `data` in the current encryption mode. */
async function writeSnapshot(data: StromData, meta: SnapshotMeta): Promise<SnapshotMeta> {
    const encrypted = SettingsManager.isEncryptionEnabled() && CryptoSession.isUnlocked();
    const { json, media } = await poolImages(data, encrypted);
    const stored: StoredSnapshot = { meta: { ...meta, sizeBytes: 0 } };
    delete stored.meta.media;
    if (Object.keys(media).length) stored.meta.media = media;
    if (encrypted) {
        stored.encrypted = await CryptoSession.encrypt(json);
        stored.meta.sizeBytes = JSON.stringify(stored.encrypted).length;
    } else {
        const gz = await gzipToBase64(json);
        if (gz !== null) { stored.gzip = gz; stored.meta.sizeBytes = gz.length; }
        else { stored.plain = json; stored.meta.sizeBytes = json.length; }
    }
    await StorageManager.set('snapshots', meta.id, stored);
    await StorageManager.set('snapshots', META_PREFIX + meta.id, stored.meta);
    return stored.meta;
}

/**
 * Create a snapshot of `data` for a tree. `now` is passed in for testability.
 * Encrypts like tree data when encryption is unlocked, else gzips (or stores
 * plain if compression is unavailable). Enforces retention before returning.
 */
export function createSnapshot(
    treeId: string, data: StromData, reason: SnapshotReason, now: number
): Promise<SnapshotMeta> {
    if (SettingsManager.isEncryptionEnabled() && !CryptoSession.isUnlocked()) {
        // Defense in depth: with encryption on but the session locked, the
        // plain path would write a PLAINTEXT copy of encrypted-tree data
        // into IndexedDB. Refuse instead (auto snapshots are best-effort
        // and swallow this; manual creation surfaces the error).
        return Promise.reject(new Error('Encryption enabled but session locked — refusing to write an unencrypted snapshot'));
    }
    return serialized(async () => {
        const personCount = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const id = `snap_${now}_${Math.random().toString(36).slice(2, 7)}`;
        const meta = await writeSnapshot(data, { id, treeId, createdAt: now, personCount, sizeBytes: 0, reason });
        await enforceRetention(treeId);
        await collectPoolGarbage();
        return meta;
    });
}

/**
 * Metas of every snapshot, read from the small meta records. A snapshot from
 * before those records existed is read once in full and gets its meta record.
 */
async function allMetas(): Promise<SnapshotMeta[]> {
    const keys = await StorageManager.keys('snapshots');
    const metaKeys = new Set(keys.filter(k => k.startsWith(META_PREFIX)));
    const out: SnapshotMeta[] = [];
    for (const key of keys) {
        if (key.startsWith(META_PREFIX)) continue;
        if (metaKeys.has(META_PREFIX + key)) continue;
        const legacy = await StorageManager.get<StoredSnapshot>('snapshots', key);
        if (legacy?.meta?.id) {
            await StorageManager.set('snapshots', META_PREFIX + key, legacy.meta);
            metaKeys.add(META_PREFIX + key);
        }
    }
    for (const key of metaKeys) {
        const meta = await StorageManager.get<SnapshotMeta>('snapshots', key);
        if (meta?.id && meta.treeId) out.push(meta);
    }
    return out;
}

/** A tree's snapshot metas, newest first. */
async function metasForTree(treeId: string): Promise<SnapshotMeta[]> {
    return (await allMetas()).filter(m => m.treeId === treeId).sort((a, b) => b.createdAt - a.createdAt);
}

/** The browser's storage estimate, or null when unknown. */
async function storageEstimate(): Promise<{ usage?: number; quota?: number } | null> {
    try {
        const nav = typeof navigator !== 'undefined'
            ? navigator as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }
            : undefined;
        return (await nav?.storage?.estimate?.()) ?? null;
    } catch {
        return null;
    }
}

/** usage / quota of the browser's storage, or null when unknown. */
async function storageUsageRatio(): Promise<number | null> {
    const est = await storageEstimate();
    if (!est?.quota || est.usage === undefined) return null;
    return est.usage / est.quota;
}

/**
 * What each snapshot adds to the space, newest first: its record plus the
 * pooled images no newer snapshot already has. The costs sum to the space the
 * tree's backups really take. Pure, for tests and the backups list.
 */
export function snapshotCosts(metas: SnapshotMeta[]): Map<string, number> {
    const seen = new Set<string>();
    const out = new Map<string, number>();
    for (const m of metas) {
        let cost = m.sizeBytes || 0;
        for (const [id, size] of Object.entries(m.media ?? {})) {
            if (seen.has(id)) continue;
            seen.add(id);
            cost += size;
        }
        out.set(m.id, cost);
    }
    return out;
}

/**
 * Which snapshots to keep (metas newest first, after the one-auto-per-day
 * merge): at most MAX_SNAPSHOTS_PER_TREE, and — beyond the newest
 * MIN_SNAPSHOTS_KEPT — only while their total fits `budget`. Images shared
 * with a newer kept snapshot cost nothing. Pure, for tests.
 */
export function planRetention(metas: SnapshotMeta[], budget: number): { keep: SnapshotMeta[]; dropCount: number; dropSpace: number } {
    const keep: SnapshotMeta[] = [];
    const seen = new Set<string>();
    let used = 0;
    let dropCount = 0;
    let dropSpace = 0;
    for (const m of metas) {
        if (keep.length >= MAX_SNAPSHOTS_PER_TREE) { dropCount++; continue; }
        let size = m.sizeBytes || 0;
        const fresh = Object.keys(m.media ?? {}).filter(id => !seen.has(id));
        for (const id of fresh) size += m.media![id];
        if (keep.length >= MIN_SNAPSHOTS_KEPT && used + size > budget) { dropSpace++; continue; }
        keep.push(m);
        for (const id of fresh) seen.add(id);
        used += size;
    }
    return { keep, dropCount, dropSpace };
}

/**
 * The space one tree's backups may take: SNAPSHOT_TREE_BUDGET_BYTES, or a
 * tenth of the browser's quota when that is smaller (a phone).
 */
export async function snapshotBudgetBytes(): Promise<number> {
    const quota = (await storageEstimate())?.quota;
    return quota ? Math.min(SNAPSHOT_TREE_BUDGET_BYTES, Math.floor(quota * SNAPSHOT_QUOTA_SHARE)) : SNAPSHOT_TREE_BUDGET_BYTES;
}

/**
 * Retention: merge same-day auto snapshots (keep the newest per day), cap the
 * count at MAX_SNAPSHOTS_PER_TREE and the space at SNAPSHOT_TREE_BUDGET_BYTES
 * (nearly full browser storage: only the newest MIN_SNAPSHOTS_KEPT). Snapshots
 * removed for space are announced (SNAPSHOTS_TRIMMED_EVENT) — the user should
 * know their safety net got shorter, and why.
 */
async function enforceRetention(treeId: string): Promise<void> {
    const list = await metasForTree(treeId);

    // Collapse auto snapshots to one per calendar day (keep the newest).
    const seenAutoDays = new Set<string>();
    const afterDaily: SnapshotMeta[] = [];
    for (const m of list) {
        if (m.reason === 'auto') {
            const key = dayKey(m.createdAt);
            if (seenAutoDays.has(key)) { await removeSnapshotRecords(m.id); continue; }
            seenAutoDays.add(key);
        }
        afterDaily.push(m);
    }

    const ratio = await storageUsageRatio();
    const storageFull = ratio !== null && ratio > STORAGE_PRESSURE_RATIO;
    const budget = await snapshotBudgetBytes();
    const plan = planRetention(afterDaily, storageFull ? 0 : budget);
    const kept = new Set(plan.keep.map(m => m.id));
    for (const m of afterDaily) {
        if (!kept.has(m.id)) await removeSnapshotRecords(m.id);
    }
    // The newest backup alone (text + all its images) over the budget: the
    // tree is too big for backups on this device — worth saying so.
    const tooBig = !storageFull && afterDaily.length > 0
        && (snapshotCosts(afterDaily).get(afterDaily[0].id) ?? 0) > budget;
    if ((plan.dropSpace > 0 || tooBig) && typeof window !== 'undefined') {
        const detail: SnapshotTrim = { treeId, removed: plan.dropSpace, kept: plan.keep.length, storageFull };
        if (tooBig) detail.tooBig = true;
        window.dispatchEvent(new CustomEvent(SNAPSHOTS_TRIMMED_EVENT, { detail }));
    }
}

/** List a tree's snapshots, newest first. */
export async function listSnapshots(treeId: string): Promise<SnapshotMeta[]> {
    return metasForTree(treeId);
}

/** Space a tree's snapshots take (shared images counted once). */
export async function totalSnapshotBytes(treeId: string): Promise<number> {
    let sum = 0;
    for (const cost of snapshotCosts(await metasForTree(treeId)).values()) sum += cost;
    return sum;
}

async function removeSnapshotRecords(id: string): Promise<void> {
    await StorageManager.delete('snapshots', id);
    await StorageManager.delete('snapshots', META_PREFIX + id);
}

export function deleteSnapshot(id: string): Promise<void> {
    return serialized(async () => {
        await removeSnapshotRecords(id);
        await collectPoolGarbage();
    });
}

/** A snapshot's record decoded to its JSON, images still as references. */
async function readSnapshotText(s: StoredSnapshot): Promise<string | null> {
    if (s.encrypted) {
        if (!CryptoSession.isUnlocked()) throw new Error('locked');
        return CryptoSession.decrypt(s.encrypted);
    }
    if (s.gzip !== undefined) return gunzipFromBase64(s.gzip);
    return s.plain ?? null;
}

/**
 * Decode a snapshot back to the tree's JSON (decrypt / gunzip / plain, images
 * put back). `missingImages` counts images the pool no longer had.
 */
export async function getSnapshotPayload(id: string): Promise<{ json: string; missingImages: number } | null> {
    const s = await StorageManager.get<StoredSnapshot>('snapshots', id);
    if (!s) return null;
    const text = await readSnapshotText(s);
    if (text === null) return null;
    const { json, missing } = await unpoolImages(text);
    return { json, missingImages: missing };
}

/** Decode a snapshot back to a raw JSON string (see getSnapshotPayload). */
export async function getSnapshotJson(id: string): Promise<string | null> {
    return (await getSnapshotPayload(id))?.json ?? null;
}

/** Whether an auto snapshot already exists for `treeId` on the given day. */
export async function hasAutoSnapshotOnDay(treeId: string, now: number): Promise<boolean> {
    const key = dayKey(now);
    return (await metasForTree(treeId)).some(m => m.reason === 'auto' && dayKey(m.createdAt) === key);
}

/** Remove every snapshot belonging to a deleted tree (cascade cleanup). */
export function deleteSnapshotsForTree(treeId: string): Promise<void> {
    return serialized(async () => {
        // Records keep id/treeId under `meta` (reading them top-level matched
        // nothing, so a deleted tree's backups stayed forever — review V1).
        for (const meta of await metasForTree(treeId)) {
            await removeSnapshotRecords(meta.id);
        }
        await collectPoolGarbage();
    });
}

/**
 * Re-write every snapshot payload in the CURRENT encryption mode (called when
 * encryption is switched on/off, with the session unlocked). Its images move
 * to pool entries of the new mode; the old ones go with the cleanup. A
 * payload that cannot be decoded is left untouched and counted.
 */
export function reencodeAllSnapshots(): Promise<number> {
    return serialized(async () => {
        const encryptionOn = SettingsManager.isEncryptionEnabled();
        if (encryptionOn && !CryptoSession.isUnlocked()) {
            return (await allMetas()).length;
        }
        const wrongPool = (meta: SnapshotMeta) =>
            Object.keys(meta.media ?? {}).some(id => id.startsWith(encryptionOn ? 'p:' : 'e:'));
        let failed = 0;
        // One payload in memory at a time (they can be tens of MB each).
        for (const meta of await allMetas()) {
            const s = await StorageManager.get<StoredSnapshot>('snapshots', meta.id);
            if (!s?.meta?.id) continue;
            if (!!s.encrypted === encryptionOn && !wrongPool(s.meta)) continue;   // already in the right form
            try {
                const text = await readSnapshotText(s);
                if (text === null) { failed++; continue; }
                const { json } = await unpoolImages(text);
                await writeSnapshot(JSON.parse(json) as StromData, s.meta);
            } catch (err) {
                console.error('Snapshot re-encoding failed', s.meta.id, err);
                failed++;
            }
        }
        await collectPoolGarbage();
        return failed;
    });
}
