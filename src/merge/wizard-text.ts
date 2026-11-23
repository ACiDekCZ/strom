/**
 * Texts of the import and merge guide (spec 134) put together from data:
 * no DOM here, so the steps and the tests share them.
 */

import { strings } from '../strings.js';
import type { GedcomDroppedTag } from '../ged-parser.js';

/** How many kinds of not taken over lines step 1 names in its line; the rest is behind "Show all". */
export const NOT_TAKEN_SHOWN = 3;

/**
 * The line of step 1 "The tree will not take over: …" (§3, K1.2): the most
 * frequent kinds of the file's lines the tree has no place for, with their
 * count and an example; "…" when there are more. Empty when the tree takes
 * over everything.
 */
export function notTakenLine(stats: { droppedTags?: readonly GedcomDroppedTag[] } | null | undefined): string {
    const dropped = (stats?.droppedTags ?? []).filter(d => d.count > 0);
    if (dropped.length === 0) return '';
    const t = strings.mergeWizard;
    const items = dropped.slice(0, NOT_TAKEN_SHOWN).map(d => t.notTakenItem(d.label ?? d.tag, d.count, d.example));
    if (dropped.length > NOT_TAKEN_SHOWN) items.push('…');
    return t.notTaken(items.join(', '));
}

/**
 * "Save list…" of step 1 (§3, K1.6): every kind of line the tree does not
 * take over, one per line under the file's name, for a .txt file.
 */
export function notTakenText(sourceLabel: string, dropped: readonly GedcomDroppedTag[]): string {
    const t = strings.mergeWizard;
    const lines = dropped.filter(d => d.count > 0).map(d => t.notTakenItem(d.label ? `${d.tag} – ${d.label}` : d.tag, d.count, d.example));
    return [`${t.notTakenTitle}: ${sourceLabel}`, '', ...lines, ''].join('\n');
}
