/**
 * How much a merge's target changed since its matching ran (spec 134 §2, 13c):
 * the persons and partnerships added, removed or changed between the copy the
 * saved merge holds and the tree as it is now.
 */

import type { StromData } from '../types.js';
import { sameWithImages } from '../image-equal.js';

function recordEdits(before: Record<string, unknown>, after: Record<string, unknown>): number {
    let n = 0;
    for (const id of Object.keys(before)) {
        if (!(id in after)) n++;
        // An image saved meanwhile (its data URL now a pooled reference) is no change.
        else if (!sameWithImages(before[id], after[id])) n++;
    }
    for (const id of Object.keys(after)) if (!(id in before)) n++;
    return n;
}

/** The number of persons and partnerships added, removed or changed from `before` to `after`. */
export function treeEditCount(before: StromData, after: StromData): number {
    return recordEdits(before.persons ?? {}, after.persons ?? {})
        + recordEdits(before.partnerships ?? {}, after.partnerships ?? {});
}
