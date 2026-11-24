/**
 * Where files dropped onto the window go (spec 134 §2, K10.2): a GEDCOM file
 * or a Strom tree (.json) opens the import guide; for a tree whose research
 * takes batches, anything else is offered as material; otherwise the file is
 * refused. A tree's .json is never offered as material.
 * No DOM here: the drop handler and the tests share it.
 */

import { isGedcomFileName } from './research-link.js';
import { isMultiTreeBackup } from './backup-formats.js';
import { isChangePacket } from './share-diff.js';
import { isEncrypted } from './crypto.js';

/** A file name taken as a Strom tree (JSON). */
export function isJsonFileName(name: unknown): boolean {
    return typeof name === 'string' && /\.json$/i.test(name.trim());
}

/**
 * The route of the dropped files by their names:
 * - 'guide-ged': the (first) file is a GEDCOM file, into the guide;
 * - 'json': the (first) file is a .json, read to see what it is (jsonDropKind);
 * - 'batch': the research's batch review (anything but one tree file, when it takes batches);
 * - 'refuse': a file the window does not open (said so);
 * - 'none': no files.
 */
export type DropRoute = 'guide-ged' | 'json' | 'batch' | 'refuse' | 'none';

export function dropRoute(names: readonly string[], opts: { batch: boolean }): DropRoute {
    if (names.length === 0) return 'none';
    const first = names[0];
    if (names.length === 1 && isGedcomFileName(first)) return 'guide-ged';
    if (names.length === 1 && isJsonFileName(first)) return 'json';
    if (opts.batch) return 'batch';
    // Several files without a batch: the first one, as before.
    return isGedcomFileName(first) ? 'guide-ged' : isJsonFileName(first) ? 'json' : 'refuse';
}

/**
 * What a dropped .json holds:
 * - 'tree': one tree (or an encrypted file, a tree once opened): the import guide;
 * - 'app-file': an "Export all" backup or a change packet: the JSON import's own way;
 * - 'other': not a file of the app (material for a research that takes batches, else unreadable).
 */
export type JsonDropKind = 'tree' | 'app-file' | 'other';

export function jsonDropKind(parsed: unknown): JsonDropKind {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'other';
    if (isEncrypted(parsed)) return 'tree';
    if (isChangePacket(parsed) || isMultiTreeBackup(parsed)) return 'app-file';
    const persons = (parsed as { persons?: unknown }).persons;
    return persons && typeof persons === 'object' && !Array.isArray(persons) ? 'tree' : 'other';
}

/**
 * While dragging only the types are known: one file of type JSON is taken
 * as a tree (the overlay says the guide opens, not the batch).
 */
export function dragLooksLikeJson(items: ArrayLike<{ kind: string; type: string }> | null | undefined): boolean {
    const files = Array.from(items ?? []).filter(i => i.kind === 'file');
    return files.length === 1 && files[0].type.toLowerCase() === 'application/json';
}
