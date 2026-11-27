/**
 * Share baselines: a local copy of the exact tree data that was shared (keyed by
 * exportId), so a change packet can be diffed/reconstructed against it. Both
 * sides keep one — the sender when exporting with tracking, the recipient when
 * saving the received file. Stored in IndexedDB (outside StromData), encrypted
 * with the session when encryption is on (like snapshots). Retention: 5 newest
 * per tree.
 */

import { StromData } from './types.js';
import { StorageManager } from './storage.js';
import { SettingsManager } from './settings.js';
import { CryptoSession, EncryptedData } from './crypto.js';

export const MAX_BASELINES_PER_TREE = 5;

interface StoredBaseline {
    exportId: string;
    treeId: string;
    savedAt: number;
    encrypted?: EncryptedData;
    plain?: string;
    /**
     * The JSON as a Blob (1127): a baseline too large to be held as one text
     * (a tree whose images weigh gigabytes, written with its images read from
     * the pool), stored by the browser outside the page's memory. Only
     * without encryption (the text must be held whole to be encrypted).
     */
    blob?: Blob;
}

/** A baseline over this many bytes is stored as a Blob (StoredBaseline.blob), not as text. */
export const BASELINE_TEXT_MAX = 64 * 1024 * 1024;

/**
 * Save the shared data as a baseline. When encryption is enabled but the session
 * is locked, nothing is stored (and "send only changes" won't be offered).
 * Returns true when a baseline was written.
 */
export async function saveBaseline(treeId: string, exportId: string, data: StromData, now: number): Promise<boolean> {
    return saveBaselineJson(treeId, exportId, JSON.stringify(data), now);
}

/**
 * saveBaseline of data already written as JSON (`JSON.stringify(data)`; an
 * export writes it with its images read from the pool, as a Blob). A Blob
 * over BASELINE_TEXT_MAX is stored as it is; with encryption on it is not
 * kept ("send only changes" is not offered for that export).
 */
export async function saveBaselineJson(treeId: string, exportId: string, json: string | Blob, now: number): Promise<boolean> {
    const rec: StoredBaseline = { exportId, treeId, savedAt: now };
    const large = typeof json !== 'string' && json.size > BASELINE_TEXT_MAX;
    if (SettingsManager.isEncryptionEnabled()) {
        if (!CryptoSession.isUnlocked() || large) return false;
        rec.encrypted = await CryptoSession.encrypt(typeof json === 'string' ? json : await json.text());
    } else if (typeof json !== 'string' && large) {
        rec.blob = json;
    } else {
        rec.plain = typeof json === 'string' ? json : await json.text();
    }
    await StorageManager.set('shareBaselines', exportId, rec);
    await enforceRetention(treeId);
    return true;
}

/** Load a baseline's tree data, or null (missing, or locked encryption). */
export async function loadBaseline(exportId: string): Promise<StromData | null> {
    const rec = await StorageManager.get<StoredBaseline>('shareBaselines', exportId);
    if (!rec) return null;
    if (rec.encrypted) {
        if (!CryptoSession.isUnlocked()) return null;
        return JSON.parse(await CryptoSession.decrypt(rec.encrypted)) as StromData;
    }
    if (rec.blob) {
        try {
            return JSON.parse(await rec.blob.text()) as StromData;
        } catch (err) {
            console.error('Reading a baseline failed', exportId, err);
            return null;
        }
    }
    return rec.plain ? (JSON.parse(rec.plain) as StromData) : null;
}

/** The tree a baseline belongs to (for locating the tree when the exportId is
 * no longer the tree's lastExportId — e.g. it was re-exported since). */
export async function getBaselineTreeId(exportId: string): Promise<string | null> {
    const rec = await StorageManager.get<StoredBaseline>('shareBaselines', exportId);
    return rec?.treeId ?? null;
}

/** Whether a usable baseline exists for an exportId (decryptable if encrypted). */
export async function hasBaseline(exportId: string): Promise<boolean> {
    const rec = await StorageManager.get<StoredBaseline>('shareBaselines', exportId);
    if (!rec) return false;
    if (rec.encrypted) return CryptoSession.isUnlocked();
    return rec.plain !== undefined || rec.blob !== undefined;
}

async function allForTree(treeId: string): Promise<StoredBaseline[]> {
    const all = await StorageManager.getAll<StoredBaseline>('shareBaselines');
    return all.filter(b => b?.treeId === treeId);
}

async function enforceRetention(treeId: string): Promise<void> {
    const list = (await allForTree(treeId)).sort((a, b) => b.savedAt - a.savedAt);
    for (const b of list.slice(MAX_BASELINES_PER_TREE)) {
        await StorageManager.delete('shareBaselines', b.exportId);
    }
}

/** Remove every baseline belonging to a deleted tree (cascade cleanup). */
export async function deleteBaselinesForTree(treeId: string): Promise<void> {
    for (const b of await allForTree(treeId)) {
        await StorageManager.delete('shareBaselines', b.exportId);
    }
}

/**
 * Re-write every baseline in the CURRENT encryption mode (called when
 * encryption is switched on/off, with the session unlocked). Returns the
 * number of baselines that could not be converted (left untouched).
 */
export async function reencodeAllBaselines(): Promise<number> {
    const encryptionOn = SettingsManager.isEncryptionEnabled();
    let failed = 0;
    for (const b of await StorageManager.getAll<StoredBaseline>('shareBaselines')) {
        if (!b?.exportId) continue;
        if (!!b.encrypted === encryptionOn) continue;
        try {
            let json: string | undefined;
            if (b.encrypted) {
                if (!CryptoSession.isUnlocked()) { failed++; continue; }
                json = await CryptoSession.decrypt(b.encrypted);
            } else if (b.blob && b.blob.size > BASELINE_TEXT_MAX) {
                // Too large to be encrypted as one text: not kept in plain text with encryption on.
                await StorageManager.delete('shareBaselines', b.exportId);
                continue;
            } else {
                json = b.plain ?? (b.blob ? await b.blob.text() : undefined);
            }
            if (json === undefined) continue;
            const next: StoredBaseline = { exportId: b.exportId, treeId: b.treeId, savedAt: b.savedAt };
            if (encryptionOn) {
                if (!CryptoSession.isUnlocked()) { failed++; continue; }
                next.encrypted = await CryptoSession.encrypt(json);
            } else {
                next.plain = json;
            }
            await StorageManager.set('shareBaselines', b.exportId, next);
        } catch (err) {
            console.error('Baseline re-encoding failed', b.exportId, err);
            failed++;
        }
    }
    return failed;
}

/**
 * A side record of the app kept like a baseline (spec 020: the research's
 * events of the time, the hidings waiting for its bridge): encrypted with the
 * session when encryption is on, re-encoded with the baselines, its own key
 * as its retention group. False: not kept (encryption on, session locked).
 */
export async function saveSideRecord(key: string, value: unknown, now: number): Promise<boolean> {
    return saveBaseline(key, key, value as StromData, now);
}

/** A side record (any JSON), or null (none, or encryption locked). */
export async function loadSideRecord(key: string): Promise<unknown> {
    return loadBaseline(key);
}

/** Forget a side record. */
export async function deleteSideRecord(key: string): Promise<void> {
    await StorageManager.delete('shareBaselines', key);
}
