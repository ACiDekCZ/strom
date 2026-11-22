/**
 * The tree's own pictures and files that only the browser keeps (spec 108
 * K1b.1): portraits, couples' photos and person attachments. Strom Research and
 * its archive before 1.35 take the tree's text from a write but none of these
 * (the archive holds at most an attachment's original as a material, never
 * the attachment itself), so a research that "holds" a tree's edits does not
 * hold them: the "only in browser" indicator keeps counting them until a file
 * copy has them — or, with a research that keeps them (`media.app`, spec 108
 * U8), once a write handed them to its archive (archiveHoldsAppMedia).
 *
 * Pure: the fingerprints live in TreeMetadata (mediaFp, fileCopyMediaFp);
 * tree-manager records them, the UI asks these functions.
 */

import { hasTreeMedia, personFilesAnyVersion } from './media.js';
import type { PersonId, StromData } from './types.js';
import { mediaToken as token, fnvHash as fnv } from './image-meta.js';

/**
 * Does a tree's research keep its portraits, couples' photos and attachments,
 * so a tree it holds is safe with them (spec 108 K2.6)? Only a research that
 * keeps the app's files (`media.app`; `keeps` null: not asked in this page —
 * its word at the write stands) and only once a write of this tree handed
 * them to it saying it carries every file (`sentTo`, the research it went to:
 * ResearchAutoState.appMediaSent). A picture added since is an edit not sent
 * like any other: it waits as they do (researchHoldsTree).
 */
export function archiveHoldsAppMedia(o: { keeps: boolean | null; researchId: string; sentTo: string | undefined }): boolean {
    return o.keeps !== false && !!o.researchId && o.sentTo === o.researchId;
}

/**
 * Fingerprint of the pictures and files only the browser keeps: '' when the
 * tree has none. Counts what a lost browser storage would lose — the
 * portraits, the couples' photos and the attachments (by their content and
 * owner) — not their notes or crops, which an export may write differently.
 */
export function browserMediaFingerprint(data: StromData): string {
    const parts: string[] = [];
    for (const id of Object.keys(data.persons ?? {}).sort()) {
        const p = data.persons[id as keyof typeof data.persons];
        if (!p) continue;
        // An attachment that is only its original (no preview) lives in the research, not here.
        const atts = personFilesAnyVersion(data, id as PersonId).filter(a => a.dataUrl);
        if (!p.photo && atts.length === 0) continue;
        parts.push(`p${id}:${token(p.photo)}:${atts.map(a => `${a.id}=${token(a.dataUrl)}`).join(',')}`);
    }
    for (const id of Object.keys(data.partnerships ?? {}).sort()) {
        const photo = data.partnerships[id as keyof typeof data.partnerships]?.photo;
        if (photo) parts.push(`u${id}:${token(photo)}`);
    }
    if (parts.length === 0) return '';
    const text = parts.join('|');
    return `${parts.length.toString(36)}-${fnv(text, 0, 1, 0x811c9dc5).toString(36)}-${fnv(text, 0, 1, 0x01000193).toString(36)}`;
}

/**
 * The tree has any portrait, couple's photo or attachment (one that is only
 * its original too): what a write to a research that keeps the app's files
 * hands to its archive (spec 108 K2.7).
 */
export function treeHasAppMedia(data: StromData): boolean {
    if (hasTreeMedia(data)) return true;
    for (const p of Object.values(data.persons ?? {})) {
        const legacy = (p as { attachments?: unknown } | undefined)?.attachments;
        if (p?.photo || (Array.isArray(legacy) && legacy.length > 0)) return true;
    }
    for (const u of Object.values(data.partnerships ?? {})) if (u?.photo) return true;
    return false;
}

/**
 * The tree's pictures and files are safe without a file copy beyond the one
 * made: it has none, the archive keeps them, or the last file copy holds
 * exactly these. `current` undefined: not known (an index saved before spec
 * 108, for a tree not read since, which TreeManager.learnMediaFingerprints
 * could not read either: locked) — not counted against the tree, as before
 * spec 108; it is known once the tree opens.
 */
export function browserMediaSafe(current: string | undefined, fileCopy: string | undefined, archiveHolds: boolean): boolean {
    if (archiveHolds) return true;
    if (current === '' || current === undefined) return true;
    return current === fileCopy;
}
