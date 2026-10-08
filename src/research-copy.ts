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
import { unknownSexFromTie } from './research-link.js';

const key = (treeId: string): string => `research-base:${treeId}`;
/** The copy before the last written send replaced it (a send taken back puts the research there again). */
const prevKey = (treeId: string): string => `research-base-prev:${treeId}`;

/**
 * The fingerprint a copy stands for, kept with it: the one in localStorage is
 * written at once, the copy a moment later — another window (or a page left
 * meanwhile) could pair the new fingerprint with the old copy (N60-3).
 */
type KeptCopy = StromData & { copyFp?: string };

/** The copy, unless it was kept for another fingerprint than `fp` (one kept before 3.9.0-beta.61 says none; no `fp`: any). */
function standsFor(base: KeptCopy | null, fp?: string): StromData | null {
    if (!base) return null;
    if (fp !== undefined && base.copyFp !== undefined && base.copyFp !== fp) return null;
    delete base.copyFp;
    return base;
}

/** Keep `data` as the research's version of the tree (after a load, a written send, a hand-over), for fingerprint `fp`. */
export async function saveResearchCopy(treeId: string, data: StromData, fp: string): Promise<void> {
    try {
        await saveBaseline(key(treeId), key(treeId), { ...baseCopy(data), copyFp: fp } as KeptCopy, Date.now());
    } catch (err) {
        console.warn('Keeping the research version failed', err);
    }
}

/** The research's version of the tree as last kept (for fingerprint `fp` when given), or null (none, another one, or locked). */
export async function loadResearchCopy(treeId: string, fp?: string): Promise<StromData | null> {
    try {
        const base = standsFor(await loadBaseline(key(treeId)) as KeptCopy | null, fp);
        // Kept before a child with one known parent got its "?" family: the same conversion as the tree
        // had on load (same ids), so the changes per person do not show those families as weddings.
        if (base) normalizeSingleParents(base);
        return base;
    } catch {
        return null;
    }
}

/** Keep the copy a written send replaces: the research's version again when that send is taken back. */
export async function saveResearchPrevCopy(treeId: string, data: StromData, fp: string): Promise<void> {
    try {
        await saveBaseline(prevKey(treeId), prevKey(treeId), { ...baseCopy(data), copyFp: fp } as KeptCopy, Date.now());
    } catch (err) {
        console.warn('Keeping the previous research version failed', err);
    }
}

/** The copy before the last written send, or null. */
export async function loadResearchPrevCopy(treeId: string, fp: string): Promise<StromData | null> {
    try {
        const base = standsFor(await loadBaseline(prevKey(treeId)) as KeptCopy | null, fp);
        if (base) normalizeSingleParents(base);
        return base;
    } catch {
        return null;
    }
}

/**
 * Data version 12 for the kept copies (N30): the research's unknown sex that
 * a tie of an older app named (`sexU`) becomes 'unknown' in them as in the
 * tree (unknownSexFromTie), so the changes per person do not show the guessed
 * sexes as the user's. Each copy keeps the fingerprint it stands for.
 */
export async function unknownSexInResearchCopies(treeId: string, sexU: unknown): Promise<void> {
    for (const k of [key(treeId), prevKey(treeId)]) {
        try {
            const kept = await loadBaseline(k) as KeptCopy | null;
            const next = kept ? unknownSexFromTie(kept, sexU) as KeptCopy | null : null;
            if (next) await saveBaseline(k, k, next, Date.now());
        } catch (err) {
            console.warn('Converting the kept research version failed', err);
        }
    }
}

/** Forget it (the tree deleted or unlinked). */
export async function deleteResearchCopy(treeId: string): Promise<void> {
    try { await deleteBaselinesForTree(key(treeId)); } catch { /* nothing kept */ }
    try { await deleteBaselinesForTree(prevKey(treeId)); } catch { /* nothing kept */ }
}
