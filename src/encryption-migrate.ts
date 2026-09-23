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
    for (const job of [reencodeAllSnapshots, reencodeAllBaselines, () => AuditLogManager.reencodeAll()]) {
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
    for (const rec of await StorageManager.getAll<{ encrypted?: unknown }>('snapshots')) {
        if (isEncrypted(rec?.encrypted)) return rec.encrypted;
    }
    for (const rec of await StorageManager.getAll<{ encrypted?: unknown }>('shareBaselines')) {
        if (isEncrypted(rec?.encrypted)) return rec.encrypted;
    }
    return null;
}
