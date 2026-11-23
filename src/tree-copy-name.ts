/**
 * The name offered for a copy of a tree (Manage trees → Duplicate, 134 S-N4):
 * "<name> (copy)", then "(copy 2)", "(copy 3)"… while a tree of that name
 * exists, in the UI language.
 */
import { strings } from './strings.js';

/** A tree name as compared: trimmed, regardless of case. */
function nameKey(name: string): string {
    return name.trim().toLocaleLowerCase();
}

/** Whether `name` is the name of one of `names` (trimmed, regardless of case). */
export function treeNameTaken(name: string, names: readonly string[]): boolean {
    const key = nameKey(name);
    return !!key && names.some(n => nameKey(n) === key);
}

/** The first free name of a copy of tree `name` among `names`. */
export function freeCopyName(name: string, names: readonly string[]): string {
    const base = name.trim();
    const first = `${base} ${strings.treeManager.duplicateSuffix}`;
    if (!treeNameTaken(first, names)) return first;
    for (let n = 2; ; n++) {
        const next = `${base} ${strings.treeManager.duplicateSuffixN(n)}`;
        if (!treeNameTaken(next, names)) return next;
    }
}
