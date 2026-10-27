/**
 * The device's copy of the research's events of the time (spec 020) and the
 * hidings waiting for its bridge (§4.5), keyed by the research's id. They name
 * the tree's places and its persons' REFNs, so they are kept like the
 * research's version of the tree (src/research-copy.ts): in the
 * `shareBaselines` store, encrypted with the session when encryption is on and
 * re-encoded with it (src/encryption-migrate.ts); with encryption locked
 * nothing is read or kept. Not tree data: never exported, never in the change
 * log. Read defensively (written by this app, but by any of its versions).
 */

import { StorageManager } from './storage.js';
import { historyCacheKey, historyQueueKey } from './storage-keys.js';
import { saveSideRecord, loadSideRecord, deleteSideRecord } from './share-baselines.js';
import { sanitizeCachedHistory, sanitizeHideQueue, type HistoryPayload, type HistoryHideOp } from './history.js';

/** The cached payload of a research, or null (none, encryption locked, or storage not open). */
export async function loadHistoryCache(researchId: string): Promise<HistoryPayload | null> {
    try {
        return sanitizeCachedHistory(await loadSideRecord(historyCacheKey(researchId)));
    } catch {
        return null;
    }
}

/** Keep the payload read from the bridge (replaces the last one). */
export async function saveHistoryCache(researchId: string, payload: HistoryPayload): Promise<void> {
    try {
        await saveSideRecord(historyCacheKey(researchId), payload, Date.now());
    } catch (err) {
        console.warn('History cache not saved', err);
    }
}

/** The hidings (and their undos) waiting for the bridge, in order. */
export async function loadHideQueue(researchId: string): Promise<HistoryHideOp[]> {
    try {
        return sanitizeHideQueue(await loadSideRecord(historyQueueKey(researchId)));
    } catch {
        return [];
    }
}

/** Keep the queue (an empty one is removed). */
export async function saveHideQueue(researchId: string, queue: readonly HistoryHideOp[]): Promise<void> {
    try {
        if (queue.length) await saveSideRecord(historyQueueKey(researchId), [...queue], Date.now());
        else await deleteSideRecord(historyQueueKey(researchId));
    } catch (err) {
        console.warn('History hide queue not saved', err);
    }
}

/** Forget both (the last tree of the research deleted). Also the plain records an earlier beta kept beside the trees. */
export async function deleteHistoryStore(researchId: string): Promise<void> {
    for (const key of [historyCacheKey(researchId), historyQueueKey(researchId)]) {
        await deleteSideRecord(key).catch(() => undefined);
        await StorageManager.delete('trees', key).catch(() => undefined);
    }
}
