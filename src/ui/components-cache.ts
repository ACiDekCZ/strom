/**
 * The separate parts of a tree (findComponents), counted once per tree and
 * change (spec 139 §5.3): Change structure… asks whether the tree is one
 * connected family, and Separate disconnected parts… right after it needs
 * the same parts — the second asks the cache instead of counting again.
 */

import { findComponents, type TreeComponent } from '../components.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import type { StromData, TreeId } from '../types.js';

/** The last tree counted (one is enough: the dialog and the split after it ask for the same tree). */
let last: { key: string; parts: TreeComponent[] } | null = null;

/** The tree as it is now: its last saved change, and for the open tree every edit since (the data revision). */
export function componentsKey(treeId: TreeId): string {
    const stamp = TreeManager.getTreeMetadata(treeId)?.lastModifiedAt ?? '';
    return treeId === DataManager.getCurrentTreeId() ? `${treeId}:${stamp}:r${DataManager.getRevision()}` : `${treeId}:${stamp}`;
}

/** The parts of `data` (the tree `key` names), counted when that tree changed since the last count. */
export function componentsOf(key: string, data: StromData): TreeComponent[] {
    if (last?.key === key) return last.parts;
    const parts = findComponents(data);
    last = { key, parts };
    return parts;
}

/** The parts known for `key` without counting (null: not counted yet). */
export function componentsKnown(key: string): TreeComponent[] | null {
    return last?.key === key ? last.parts : null;
}
