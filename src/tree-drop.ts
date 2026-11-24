/**
 * Dropping onto a tree's row in Manage trees (spec 134 K10.3): a file (.ged or
 * a Strom tree .json) dropped on a row opens the import guide with that tree
 * as its target; another tree's row dragged onto it opens the guide with the
 * dragged tree as the import. A tree dropped on itself does nothing.
 * No DOM here: the row handlers and the tests share it.
 */

import { dropRoute } from './drop-route.js';
import type { TreeId } from './types.js';

/** A file dropped on a tree's row: that tree the import guide's target (the guide returns to Manage trees). */
export interface DropInto { target: TreeId }

/** The drag data type of a tree's row (its id); a file manager or another page never sends it. */
export const TREE_DRAG_TYPE = 'application/x-strom-tree';

/** What is being dragged over the rows: files from outside, or a tree's row. */
export type TreeDrag = { kind: 'files' } | { kind: 'tree'; treeId: string } | null;

/** What dropping `drag` on a row does. */
export type TreeRowDrop =
    | { kind: 'none' }
    | { kind: 'file'; target: string }
    | { kind: 'tree'; source: string; target: string };

/**
 * The drop on the row of tree `rowTreeId`. `canEdit`: the app can write trees
 * (not a view); a read-only app leaves files to the window's own drop.
 */
export function treeRowDrop(drag: TreeDrag, rowTreeId: string | null | undefined, opts: { canEdit: boolean }): TreeRowDrop {
    if (!drag || !rowTreeId || !opts.canEdit) return { kind: 'none' };
    if (drag.kind === 'files') return { kind: 'file', target: rowTreeId };
    if (!drag.treeId || drag.treeId === rowTreeId) return { kind: 'none' };
    return { kind: 'tree', source: drag.treeId, target: rowTreeId };
}

/**
 * How the dropped files open on a row: one GEDCOM file or one Strom tree
 * (the first of several, as the window's drop takes them); anything else is
 * refused as the window refuses it. No research batch here: the row asks for
 * the guide.
 */
export function treeRowFileRoute(names: readonly string[]): 'guide-ged' | 'json' | 'refuse' | 'none' {
    const route = dropRoute(names, { batch: false });
    return route === 'batch' ? 'refuse' : route;
}

/** A name cut to `max` characters with an ellipsis, for the row's one-line sentence. */
export function shortName(name: string, max = 28): string {
    const s = name.trim();
    const chars = Array.from(s);
    return chars.length <= max ? s : `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`;
}

/**
 * The target the import guide starts with (spec 134 §2, K10.3):
 * - a tree asked for (dropped on its row): that tree when it can take the
 *   import; when it cannot (locked, followed live, …) none is chosen and step
 *   1 says why on its tile, Add to a tree stays the mode (`keepAdd`);
 * - otherwise the open tree when it can take it, else for two trees or a
 *   view the first tree that can, else none (the import starts as a new tree).
 */
export function initialMergeTarget<T extends string>(o: {
    requested?: T | null;
    openId: T | null;
    trees: readonly T[];
    usable: (id: T | null) => boolean;
    twoTrees: boolean;
}): { targetId: T | null; keepAdd: boolean } {
    if (o.requested) return { targetId: o.usable(o.requested) ? o.requested : null, keepAdd: true };
    if (o.usable(o.openId)) return { targetId: o.openId, keepAdd: false };
    return { targetId: o.twoTrees ? o.trees.find(id => o.usable(id)) ?? null : null, keepAdd: false };
}
