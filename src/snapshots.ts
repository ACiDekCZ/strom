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
    await enforceRetention(treeId);
    return stored.meta;
}

async function allForTree(treeId: string): Promise<StoredSnapshot[]> {
    const all = await StorageManager.getAll<StoredSnapshot>('snapshots');
    return all.filter(s => s?.meta?.treeId === treeId);
}

/**
 * Retention: merge same-day auto snapshots (keep the newest per day) and cap the
 * total per tree at MAX_SNAPSHOTS_PER_TREE (oldest dropped).
 */
async function enforceRetention(treeId: string): Promise<void> {
    let list = await allForTree(treeId);

    // Collapse auto snapshots to one per calendar day (keep the newest).
    const autosByDay = new Map<string, StoredSnapshot>();
    const toDelete = new Set<string>();
    for (const s of list) {
        if (s.meta.reason !== 'auto') continue;
        const key = dayKey(s.meta.createdAt);
        const kept = autosByDay.get(key);
        if (!kept) { autosByDay.set(key, s); continue; }
        // Keep the newer, delete the older.
        const older = s.meta.createdAt < kept.meta.createdAt ? s : kept;
        const newer = older === s ? kept : s;
        toDelete.add(older.meta.id);
        autosByDay.set(key, newer);
    }
    for (const id of toDelete) await StorageManager.delete('snapshots', id);

    // Cap total count.
    list = (await allForTree(treeId)).sort((a, b) => b.meta.createdAt - a.meta.createdAt);
    for (const s of list.slice(MAX_SNAPSHOTS_PER_TREE)) {
        await StorageManager.delete('snapshots', s.meta.id);
    }
}

/** List a tree's snapshots, newest first. */
export async function listSnapshots(treeId: string): Promise<SnapshotMeta[]> {
    const list = await allForTree(treeId);
    return list.map(s => s.meta).sort((a, b) => b.createdAt - a.createdAt);
}

/** Total bytes of a tree's snapshots. */
export async function totalSnapshotBytes(treeId: string): Promise<number> {
    return (await allForTree(treeId)).reduce((sum, s) => sum + (s.meta.sizeBytes || 0), 0);
}

export async function deleteSnapshot(id: string): Promise<void> {
    await StorageManager.delete('snapshots', id);
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
    return (await allForTree(treeId)).some(s => s.meta.reason === 'auto' && dayKey(s.meta.createdAt) === key);
}
