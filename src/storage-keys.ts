/** Keys of records kept beside others in a store (src/storage.ts). */

/** The research base of a stored tree: in 'trees' beside it (one transaction with it), under this key. */
export function researchBaseKey(treeId: string): string {
    return `researchBase:${treeId}`;
}

/** The research's events of the time for a research tree (spec 020): in 'trees', keyed by the research's id. */
export function historyCacheKey(researchId: string): string {
    return `history:${researchId.toLowerCase()}`;
}

/** Hidings of those events waiting for the research's bridge: in 'trees', beside the cache. */
export function historyQueueKey(researchId: string): string {
    return `historyHide:${researchId.toLowerCase()}`;
}

/** A side record of the history layer (never a tree). */
export function isHistoryKey(key: string): boolean {
    return key.startsWith('history:') || key.startsWith('historyHide:');
}
