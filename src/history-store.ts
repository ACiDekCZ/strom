/**
 * The device's copy of the research's events of the time (spec 020) and the
 * hidings waiting for its bridge (§4.5), in IndexedDB beside the trees, keyed
 * by the research's id. Not tree data: never exported, never in the change
 * log. Read defensively (written by this app, but by any of its versions).
 */

import { StorageManager } from './storage.js';
import { historyCacheKey, historyQueueKey } from './storage-keys.js';
import { sanitizeCachedHistory, sanitizeHideQueue, type HistoryPayload, type HistoryHideOp } from './history.js';

/** The cached payload of a research, or null (none, or storage not open). */
export async function loadHistoryCache(researchId: string): Promise<HistoryPayload | null> {
    try {
        return sanitizeCachedHistory(await StorageManager.get<unknown>('trees', historyCacheKey(researchId)));
    } catch {
        return null;
    }
}

/** Keep the payload read from the bridge (replaces the last one). */
export async function saveHistoryCache(researchId: string, payload: HistoryPayload): Promise<void> {
    try {
        await StorageManager.set('trees', historyCacheKey(researchId), payload);
    } catch (err) {
        console.warn('History cache not saved', err);
    }
}

/** The hidings (and their undos) waiting for the bridge, in order. */
export async function loadHideQueue(researchId: string): Promise<HistoryHideOp[]> {
    try {
        return sanitizeHideQueue(await StorageManager.get<unknown>('trees', historyQueueKey(researchId)));
    } catch {
        return [];
    }
}

/** Keep the queue (an empty one is removed). */
export async function saveHideQueue(researchId: string, queue: readonly HistoryHideOp[]): Promise<void> {
    try {
        if (queue.length) await StorageManager.set('trees', historyQueueKey(researchId), [...queue]);
        else await StorageManager.delete('trees', historyQueueKey(researchId));
    } catch (err) {
        console.warn('History hide queue not saved', err);
    }
}
