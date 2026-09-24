/**
 * Versioned backups ("time capsule"): compressed, optionally encrypted
 * snapshots of a tree's data, kept in IndexedDB outside StromData. Auto-taken
 * on the first mutation of the day and before import/merge, plus on demand.
 * Restore lives in DataManager (it must go through migrateData + the undo path).
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
    sizeBytes: number;
    reason: SnapshotReason;
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
}

/**
 * Snapshot records: the payload under the snapshot id, and a small copy of
 * its meta under META_PREFIX + id — listing and retention read only these,
 * never the payloads (tens of MB each for a tree with scans).
 */
const META_PREFIX = 'meta:';

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

/**
 * Create a snapshot of `data` for a tree. `now` is passed in for testability.
 * Encrypts like tree data when encryption is unlocked, else gzips (or stores
 * plain if compression is unavailable). Enforces retention before returning.
 */
export async function createSnapshot(
    treeId: string, data: StromData, reason: SnapshotReason, now: number
): Promise<SnapshotMeta> {
    const json = JSON.stringify(data);
    const personCount = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
    const id = `snap_${now}_${Math.random().toString(36).slice(2, 7)}`;

    const stored: StoredSnapshot = { meta: { id, treeId, createdAt: now, personCount, sizeBytes: 0, reason } };
    let sizeBytes: number;
    if (SettingsManager.isEncryptionEnabled() && !CryptoSession.isUnlocked()) {
        // Defense in depth: with encryption on but the session locked, the
        // else-branch would write a PLAINTEXT copy of encrypted-tree data
        // into IndexedDB. Refuse instead (auto snapshots are best-effort
        // and swallow this; manual creation surfaces the error).
        throw new Error('Encryption enabled but session locked — refusing to write an unencrypted snapshot');
    }
    if (SettingsManager.isEncryptionEnabled() && CryptoSession.isUnlocked()) {
        stored.encrypted = await CryptoSession.encrypt(json);
        sizeBytes = JSON.stringify(stored.encrypted).length;
    } else {
        const gz = await gzipToBase64(json);
        if (gz !== null) { stored.gzip = gz; sizeBytes = gz.length; }
        else { stored.plain = json; sizeBytes = json.length; }
    }
    stored.meta.sizeBytes = sizeBytes;

    await StorageManager.set('snapshots', id, stored);
    await StorageManager.set('snapshots', META_PREFIX + id, stored.meta);
    await enforceRetention(treeId);
    return stored.meta;
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

/** usage / quota of the browser's storage, or null when unknown. */
async function storageUsageRatio(): Promise<number | null> {
    try {
        const nav = typeof navigator !== 'undefined'
            ? navigator as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }
            : undefined;
        const est = await nav?.storage?.estimate?.();
        if (!est?.quota || est.usage === undefined) return null;
        return est.usage / est.quota;
    } catch {
        return null;
    }
}

/**
 * Which snapshots to keep (metas newest first, after the one-auto-per-day
 * merge): at most MAX_SNAPSHOTS_PER_TREE, and — beyond the newest
 * MIN_SNAPSHOTS_KEPT — only while their total fits `budget`. Pure, for tests.
 */
export function planRetention(metas: SnapshotMeta[], budget: number): { keep: SnapshotMeta[]; dropCount: number; dropSpace: number } {
    const keep: SnapshotMeta[] = [];
    let used = 0;
    let dropCount = 0;
    let dropSpace = 0;
    for (const m of metas) {
        if (keep.length >= MAX_SNAPSHOTS_PER_TREE) { dropCount++; continue; }
        const size = m.sizeBytes || 0;
        if (keep.length >= MIN_SNAPSHOTS_KEPT && used + size > budget) { dropSpace++; continue; }
        keep.push(m);
        used += size;
    }
    return { keep, dropCount, dropSpace };
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
            if (seenAutoDays.has(key)) { await deleteSnapshot(m.id); continue; }
            seenAutoDays.add(key);
        }
        afterDaily.push(m);
    }

    const ratio = await storageUsageRatio();
    const storageFull = ratio !== null && ratio > STORAGE_PRESSURE_RATIO;
    const plan = planRetention(afterDaily, storageFull ? 0 : SNAPSHOT_TREE_BUDGET_BYTES);
    const kept = new Set(plan.keep.map(m => m.id));
    for (const m of afterDaily) {
        if (!kept.has(m.id)) await deleteSnapshot(m.id);
    }
    if (plan.dropSpace > 0 && typeof window !== 'undefined') {
        const detail: SnapshotTrim = { treeId, removed: plan.dropSpace, kept: plan.keep.length, storageFull };
        window.dispatchEvent(new CustomEvent(SNAPSHOTS_TRIMMED_EVENT, { detail }));
    }
}

/** List a tree's snapshots, newest first. */
export async function listSnapshots(treeId: string): Promise<SnapshotMeta[]> {
    return metasForTree(treeId);
}

/** Total bytes of a tree's snapshots. */
export async function totalSnapshotBytes(treeId: string): Promise<number> {
    return (await metasForTree(treeId)).reduce((sum, m) => sum + (m.sizeBytes || 0), 0);
}

export async function deleteSnapshot(id: string): Promise<void> {
    await StorageManager.delete('snapshots', id);
    await StorageManager.delete('snapshots', META_PREFIX + id);
}

/** Decode a snapshot back to a raw JSON string (decrypt / gunzip / plain). */
export async function getSnapshotJson(id: string): Promise<string | null> {
    const s = await StorageManager.get<StoredSnapshot>('snapshots', id);
    if (!s) return null;
    if (s.encrypted) {
        if (!CryptoSession.isUnlocked()) throw new Error('locked');
        return CryptoSession.decrypt(s.encrypted);
    }
    if (s.gzip !== undefined) return gunzipFromBase64(s.gzip);
    return s.plain ?? null;
}

/** Whether an auto snapshot already exists for `treeId` on the given day. */
export async function hasAutoSnapshotOnDay(treeId: string, now: number): Promise<boolean> {
    const key = dayKey(now);
    return (await metasForTree(treeId)).some(m => m.reason === 'auto' && dayKey(m.createdAt) === key);
}

/** Remove every snapshot belonging to a deleted tree (cascade cleanup). */
export async function deleteSnapshotsForTree(treeId: string): Promise<void> {
    // Records keep id/treeId under `meta` (reading them top-level matched
    // nothing, so a deleted tree's backups stayed forever — review V1).
    for (const meta of await metasForTree(treeId)) {
        await deleteSnapshot(meta.id);
    }
}

/**
 * Re-write every snapshot payload in the CURRENT encryption mode (called when
 * encryption is switched on/off, with the session unlocked). A payload that
 * cannot be decoded is left untouched and counted.
 */
export async function reencodeAllSnapshots(): Promise<number> {
    const encryptionOn = SettingsManager.isEncryptionEnabled();
    let failed = 0;
    // One payload in memory at a time (they can be tens of MB each).
    for (const meta of await allMetas()) {
        const s = await StorageManager.get<StoredSnapshot>('snapshots', meta.id);
        if (!s?.meta?.id) continue;
        const isEnc = !!s.encrypted;
        if (isEnc === encryptionOn) continue;   // already in the right form
        try {
            const json = await getSnapshotJson(s.meta.id);
            if (json === null) { failed++; continue; }
            const next: StoredSnapshot = { meta: { ...s.meta } };
            if (encryptionOn) {
                if (!CryptoSession.isUnlocked()) { failed++; continue; }
                next.encrypted = await CryptoSession.encrypt(json);
                next.meta.sizeBytes = JSON.stringify(next.encrypted).length;
            } else {
                const gz = await gzipToBase64(json);
                if (gz !== null) { next.gzip = gz; next.meta.sizeBytes = gz.length; }
                else { next.plain = json; next.meta.sizeBytes = json.length; }
            }
            await StorageManager.set('snapshots', s.meta.id, next);
            await StorageManager.set('snapshots', META_PREFIX + s.meta.id, next.meta);
        } catch (err) {
            console.error('Snapshot re-encoding failed', s.meta.id, err);
            failed++;
        }
    }
    return failed;
}
