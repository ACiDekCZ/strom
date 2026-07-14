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
}

/**
 * Save the shared data as a baseline. When encryption is enabled but the session
 * is locked, nothing is stored (and "send only changes" won't be offered).
 * Returns true when a baseline was written.
 */
export async function saveBaseline(treeId: string, exportId: string, data: StromData, now: number): Promise<boolean> {
    const json = JSON.stringify(data);
    const rec: StoredBaseline = { exportId, treeId, savedAt: now };
    if (SettingsManager.isEncryptionEnabled()) {
        if (!CryptoSession.isUnlocked()) return false;
        rec.encrypted = await CryptoSession.encrypt(json);
    } else {
        rec.plain = json;
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
    return rec.plain !== undefined;
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
