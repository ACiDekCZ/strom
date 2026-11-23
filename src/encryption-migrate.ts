/**
 * Encryption toggle helpers for the side stores (versioned backups, share
 * baselines, audit logs). Tree data is re-saved by the toggle itself; these
 * stores used to keep their old form, so after switching encryption off the
 * backups stayed unreadable forever (review S23).
 */

import { StorageManager } from './storage.js';
import { TreeManager } from './tree-manager.js';
import { AuditLogManager } from './audit-log.js';
import { isEncrypted, EncryptedData } from './crypto.js';

/**
 * Convert snapshots, baselines and audit logs to the CURRENT encryption mode.
 * Call with the session unlocked (the old key when disabling, the new key
 * when enabling). Returns the number of records that could not be converted.
 */
export async function reencodeSideStores(): Promise<number> {
    const { reencodeAllSnapshots } = await import('./snapshots.js');
    const { reencodeAllBaselines } = await import('./share-baselines.js');
    let failed = 0;
    for (const job of [reencodeMemoryImages, reencodeAllSnapshots, reencodeAllBaselines, () => AuditLogManager.reencodeAll()]) {
        try {
            failed += await job();
        } catch (err) {
            console.error('Side-store re-encoding failed', err);
            failed++;
        }
    }
    return failed;
}

/**
 * The open tree's states in memory (its undo and redo steps above all: the
 * data themselves moved with their save) name their pooled images by ids of
 * the other kind after a switch of the encryption: those images are stored
 * again under the current kind and the states take the new references
 * (spec 135, D6), so going back still finds them. Returns 0 (failures are
 * logged: an image left so is missing from that step only).
 */
export async function reencodeMemoryImages(): Promise<number> {
    const { DataManager } = await import('./data.js');
    const { SettingsManager } = await import('./settings.js');
    const { CryptoSession } = await import('./crypto.js');
    const { withPoolLock, poolImages } = await import('./media-pool.js');
    const { POOL_REF } = await import('./image-ref.js');
    const held = DataManager.imageIdsInMemory();
    if (!held) return 0;
    const encrypted = SettingsManager.isEncryptionEnabled();
    if (encrypted && !CryptoSession.isUnlocked()) return 0;
    const kind = encrypted ? 'e:' : 'p:';
    const wrong = new Set([...held.ids].filter(id => !id.startsWith(kind)));
    if (wrong.size === 0) return 0;
    try {
        await withPoolLock(async () => {
            const { ids } = await poolImages(new Set(), wrong, encrypted, `memory:${held.treeId}`);
            const map = new Map<string, string>();
            for (const [ref, id] of ids) map.set(ref, POOL_REF + id);
            DataManager.internImages(held.treeId, map);
        });
    } catch (err) {
        console.error('Re-storing the images of the undo steps failed', err);
    }
    return 0;
}

/**
 * Any encrypted record in local storage (trees first, then the side stores) —
 * the thing a password must decrypt before encryption may be switched off.
 */
export async function findAnyEncryptedRecord(): Promise<EncryptedData | null> {
    const tree = await TreeManager.getFirstEncryptedData();
    if (tree) return tree;
    for (const key of await StorageManager.keys('audit')) {
        const rec = await StorageManager.get<unknown>('audit', key);
        if (isEncrypted(rec)) return rec;
    }
    // One snapshot at a time: payloads can be tens of MB each (meta records skipped).
    for (const key of await StorageManager.keys('snapshots')) {
        if (key.startsWith('meta:')) continue;
        const rec = await StorageManager.get<{ encrypted?: unknown }>('snapshots', key);
        if (isEncrypted(rec?.encrypted)) return rec!.encrypted as EncryptedData;
    }
    for (const rec of await StorageManager.getAll<{ encrypted?: unknown }>('shareBaselines')) {
        if (isEncrypted(rec?.encrypted)) return rec.encrypted;
    }
    return null;
}
