/**
 * The image catalog (image-meta.ts) for trees stored before it: each pooled
 * image a tree record names is read from the pool and measured, one at a
 * time, then only the record's `imageMeta` is added — its data stay exactly
 * as they were (no new data version, no backup needed). An encrypted tree
 * waits until the session is unlocked. A tree saved meanwhile is left as its
 * save wrote it (the save writes the entries itself).
 */

import { StorageManager } from './storage.js';
import { CryptoSession } from './crypto.js';
import { packImageMeta, unpackImageMeta, pooledImageMeta } from './media-pool.js';
import { imageMetaFor } from './image-meta.js';

/** The parts of a stored tree record with pooled images (tree-manager.ts PooledTreeRecord) this needs. */
interface PooledRecord {
    pooled: 1;
    encrypted?: unknown;
    media?: Record<string, number>;
    imageMeta?: unknown;
}

function isPooled(raw: unknown): raw is PooledRecord {
    return !!raw && typeof raw === 'object' && (raw as { pooled?: unknown }).pooled === 1;
}

let running: Promise<{ filled: number; locked: number }> | null = null;

/**
 * Give the stored trees `treeIds` their catalog entries where they lack them.
 * `filled`: records written; `locked`: encrypted ones left for after an
 * unlock. Runs once at a time (a second call gets the running one).
 */
export function backfillImageMeta(treeIds: readonly string[]): Promise<{ filled: number; locked: number }> {
    if (!running) running = backfillNow(treeIds).finally(() => { running = null; });
    return running;
}

async function backfillNow(treeIds: readonly string[]): Promise<{ filled: number; locked: number }> {
    let filled = 0;
    let locked = 0;
    for (const treeId of [...treeIds]) {
        try {
            const raw = await StorageManager.get<unknown>('trees', treeId);
            if (!isPooled(raw)) continue;
            const encrypted = !!raw.encrypted;
            if (encrypted && !CryptoSession.isUnlocked()) { locked++; continue; }
            const ids = Object.keys(raw.media ?? {});
            const stored = await unpackImageMeta(raw.imageMeta);
            if (ids.every(i => stored?.[i])) continue;
            let complete = true;
            for (const i of ids) {
                if (!(await pooledImageMeta(i))) complete = false;
            }
            if (!complete) continue;
            const packed = await packImageMeta(imageMetaFor(ids), encrypted);
            if (!packed) continue;
            const want = ids.slice().sort().join(',');
            const before = JSON.stringify(raw.imageMeta ?? null);
            // One transaction: a save landing meanwhile (other images, another form, its own entries) is never overwritten.
            const wrote = await StorageManager.update<unknown>('trees', treeId, (now) => {
                if (!isPooled(now) || !!now.encrypted !== encrypted) return undefined;
                if (Object.keys(now.media ?? {}).sort().join(',') !== want) return undefined;
                if (JSON.stringify(now.imageMeta ?? null) !== before) return undefined;
                return { ...now, imageMeta: packed };
            });
            if (wrote) filled++;
        } catch (err) {
            console.warn('Image catalog backfill failed', treeId, err);
        }
    }
    return { filled, locked };
}
