/**
 * The tree as the research last had it (A2), kept in this browser to tell
 * what the user changed since, person by person. Stored like a share
 * baseline (IndexedDB `shareBaselines`, encrypted with the session when
 * encryption is on, re-encoded with the others) under its own key, without
 * images (research-changes.ts baseCopy).
 */

import { StromData } from './types.js';
import { normalizeSingleParents } from './single-parent.js';
import { saveBaseline, loadBaseline, deleteBaselinesForTree } from './share-baselines.js';
import { baseCopy } from './research-changes.js';

const key = (treeId: string): string => `research-base:${treeId}`;

/** Keep `data` as the research's version of the tree (after a load, a written send, a hand-over). */
export async function saveResearchCopy(treeId: string, data: StromData): Promise<void> {
    try {
        await saveBaseline(key(treeId), key(treeId), baseCopy(data), Date.now());
    } catch (err) {
        console.warn('Keeping the research version failed', err);
    }
}

/** The research's version of the tree as last kept, or null (none, or locked). */
export async function loadResearchCopy(treeId: string): Promise<StromData | null> {
    try {
        const base = await loadBaseline(key(treeId));
        // Kept before a child with one known parent got its "?" family: the same conversion as the tree
        // had on load (same ids), so the changes per person do not show those families as weddings.
        if (base) normalizeSingleParents(base);
        return base;
    } catch {
        return null;
    }
}

/** Forget it (the tree deleted or unlinked). */
export async function deleteResearchCopy(treeId: string): Promise<void> {
    try { await deleteBaselinesForTree(key(treeId)); } catch { /* nothing kept */ }
}
