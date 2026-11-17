/**
 * The tree's own pictures and files that only the browser keeps (spec 108
 * K1b.1): portraits, couples' photos and person attachments. Strom Research and
 * its archive take the tree's text from a write but none of these (the
 * archive holds at most an attachment's original as a material, never the
 * attachment itself), so a research that "holds" a tree's edits does not hold
 * them: the "only in browser" indicator keeps counting them until a file copy
 * has them, or until the archive holds them (spec 108 U8 — one switch below).
 *
 * Pure: the fingerprints live in TreeMetadata (mediaFp, fileCopyMediaFp);
 * tree-manager records them, the UI asks these functions.
 */

import type { StromData } from './types.js';

/**
 * Does the archive (Strom Research) keep the app's portraits, couples' photos
 * and attachments, so a tree it holds is safe with them? Not yet: spec 108 U8
 * (K2.1–K2.7) turns this on once a write hands them to the archive.
 */
export const ARCHIVE_HOLDS_APP_MEDIA = false;

function fnv(text: string, start: number, step: number, seed: number): number {
    let h = seed >>> 0;
    for (let i = start; i < text.length; i += step) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

/**
 * Stands for one picture or file: its length and a hash of a sample (every
 * 64th character) and the tail. A new picture, a new crop or a rotation
 * changes the length or the sample; hashing every byte of a tree's images on
 * each edit would cost far more than the indicator is worth.
 */
function token(url: string | undefined): string {
    if (!url) return '';
    const sample = fnv(url, 0, 64, 0x811c9dc5);
    const tail = fnv(url, Math.max(0, url.length - 64), 1, sample);
    return `${url.length.toString(36)}.${tail.toString(36)}`;
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
        const atts = (p.attachments ?? []).filter(a => a.dataUrl);
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
 * The tree's pictures and files are safe without a file copy beyond the one
 * made: it has none, the archive keeps them, or the last file copy holds
 * exactly these. `current` undefined: not known (an index saved before spec
 * 108, for a tree not read since, which TreeManager.learnMediaFingerprints
 * could not read either: locked) — not counted against the tree, as before
 * spec 108; it is known once the tree opens.
 */
export function browserMediaSafe(current: string | undefined, fileCopy: string | undefined,
    archiveHolds: boolean = ARCHIVE_HOLDS_APP_MEDIA): boolean {
    if (archiveHolds) return true;
    if (current === '' || current === undefined) return true;
    return current === fileCopy;
}
