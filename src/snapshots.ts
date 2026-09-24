/**
 * Versioned backups ("time capsule"): compressed, optionally encrypted
 * snapshots of a tree's data, kept in IndexedDB outside StromData. Auto-taken
 * on the first mutation of the day and before import/merge, plus on demand.
 * Restore lives in DataManager (it must go through migrateData + the undo path).
 *
 * Images (photos, scans, excerpts) go to the image pool (media-pool.ts): a
 * snapshot holds a reference per image, shared with the stored tree and every
 * other snapshot that has it. Consecutive backups differ in a few kB of text,
 * not in their images, so twenty backups of a tree with 80 MB of scans add
 * little beyond the tree itself.
 */

import { StromData } from './types.js';
import { StorageManager } from './storage.js';
import { SettingsManager } from './settings.js';
import { CryptoSession, EncryptedData } from './crypto.js';
import {
    withPoolLock, collectPoolable, storeImages, stringifyPooled, unpoolJson, notePoolSizes,
    collectPoolGarbageLocked, registerPoolReferences, bytesToBase64, base64ToBytes,
} from './media-pool.js';

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

/** Fired on window after a snapshot was created; detail: { treeId }. */
export const SNAPSHOT_CREATED_EVENT = 'strom:snapshot-created';

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

/** Write a snapshot record + its meta for `data` in the current encryption mode. */
async function writeSnapshot(data: StromData, meta: SnapshotMeta): Promise<SnapshotMeta> {
    const encrypted = SettingsManager.isEncryptionEnabled() && CryptoSession.isUnlocked();
    for (const m of await allMetas()) notePoolSizes(m.media);
    const { ids, media } = await storeImages(collectPoolable(data), encrypted, meta.treeId);
    const json = stringifyPooled(data, ids);
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
    return withPoolLock(async () => {
        const personCount = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const id = `snap_${now}_${Math.random().toString(36).slice(2, 7)}`;
        const meta = await writeSnapshot(data, { id, treeId, createdAt: now, personCount, sizeBytes: 0, reason });
        await enforceRetention(treeId);
        await collectPoolGarbageLocked();
        // Automatic backups finish in the background: an open backups list
        // must learn about them.
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(SNAPSHOT_CREATED_EVENT, { detail: { treeId } }));
        }
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
 * pooled images neither the stored tree (`free`) nor a newer snapshot already
 * has. The costs sum to the space the tree's backups really take. Pure, for
 * tests and the backups list.
 */
export function snapshotCosts(metas: SnapshotMeta[], free: Iterable<string> = []): Map<string, number> {
    const seen = new Set<string>(free);
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
 * MIN_SNAPSHOTS_KEPT — only while their total fits `budget`. Images the
 * stored tree (`free`) or a newer kept snapshot has cost nothing. Pure, for tests.
 */
export function planRetention(metas: SnapshotMeta[], budget: number, free: Iterable<string> = []): { keep: SnapshotMeta[]; dropCount: number; dropSpace: number } {
    const keep: SnapshotMeta[] = [];
    const seen = new Set<string>(free);
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
    const free = await treeImageIds(treeId);
    const plan = planRetention(afterDaily, storageFull ? 0 : budget, free);
    const kept = new Set(plan.keep.map(m => m.id));
    for (const m of afterDaily) {
        if (!kept.has(m.id)) await removeSnapshotRecords(m.id);
    }
    // The newest backup alone (text + all its images) over the budget: the
    // tree is too big for backups on this device — worth saying so.
    const tooBig = !storageFull && afterDaily.length > 0
        && (snapshotCosts(afterDaily, free).get(afterDaily[0].id) ?? 0) > budget;
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

/**
 * The pooled images the stored tree itself names: backups share them, so
 * they take no space on the backups' account.
 */
export async function treeImageIds(treeId: string): Promise<string[]> {
    const raw = await StorageManager.get<{ pooled?: number; media?: Record<string, number> }>('trees', treeId);
    return raw?.pooled === 1 ? Object.keys(raw.media ?? {}) : [];
}

/** Space a tree's snapshots take (shared images counted once). */
export async function totalSnapshotBytes(treeId: string): Promise<number> {
    let sum = 0;
    for (const cost of snapshotCosts(await metasForTree(treeId), await treeImageIds(treeId)).values()) sum += cost;
    return sum;
}

async function removeSnapshotRecords(id: string): Promise<void> {
    await StorageManager.delete('snapshots', id);
    await StorageManager.delete('snapshots', META_PREFIX + id);
}

export function deleteSnapshot(id: string): Promise<void> {
    return withPoolLock(async () => {
        await removeSnapshotRecords(id);
        await collectPoolGarbageLocked();
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
    const { json, missing } = await unpoolJson(text);
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
    return withPoolLock(async () => {
        // Records keep id/treeId under `meta` (reading them top-level matched
        // nothing, so a deleted tree's backups stayed forever — review V1).
        for (const meta of await metasForTree(treeId)) {
            await removeSnapshotRecords(meta.id);
        }
        await collectPoolGarbageLocked();
    });
}

/**
 * Re-write every snapshot payload in the CURRENT encryption mode (called when
 * encryption is switched on/off, with the session unlocked). Its images move
 * to pool entries of the new mode; the old ones go with the cleanup. A
 * payload that cannot be decoded is left untouched and counted.
 */
export function reencodeAllSnapshots(): Promise<number> {
    return withPoolLock(async () => {
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
                const { json } = await unpoolJson(text);
                await writeSnapshot(JSON.parse(json) as StromData, s.meta);
            } catch (err) {
                console.error('Snapshot re-encoding failed', s.meta.id, err);
                failed++;
            }
        }
        await collectPoolGarbageLocked();
        return failed;
    });
}

// The pool keeps every image a snapshot names.
registerPoolReferences('snapshots', async () => {
    const ids: string[] = [];
    for (const meta of await allMetas()) ids.push(...Object.keys(meta.media ?? {}));
    return ids;
});
