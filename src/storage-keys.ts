/** Keys of records kept beside others in a store (src/storage.ts). */

/** The research base of a stored tree: in 'trees' beside it (one transaction with it), under this key. */
export function researchBaseKey(treeId: string): string {
    return `researchBase:${treeId}`;
}

/** The research's events of the time for a research tree (spec 020): in 'shareBaselines', keyed by the research's id. */
export function historyCacheKey(researchId: string): string {
    return `history:${researchId.toLowerCase()}`;
}

/** Hidings of those events waiting for the research's bridge: beside the cache. */
export function historyQueueKey(researchId: string): string {
    return `historyHide:${researchId.toLowerCase()}`;
}

/** A side record of the history layer (never a tree; an early beta kept them in 'trees'). */
export function isHistoryKey(key: string): boolean {
    return key.startsWith('history:') || key.startsWith('historyHide:');
}

/** What this device knows of a research's "not an error" marks (spec 021 §D): in 'shareBaselines', keyed by the research's id. */
export function qualityBridgeKey(researchId: string): string {
    return `quality:${researchId.toLowerCase()}`;
}

/** The research's last spelling suggestions on this device (spec 021 §4.2): in 'shareBaselines', keyed by the research's id. */
export function surnamesBridgeKey(researchId: string): string {
    return `surnames:${researchId.toLowerCase()}`;
}
