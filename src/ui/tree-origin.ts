/**
 * What a tree is, said the same wherever a tree is described by its origin
 * and research (spec 139 §11.2): the third line of its row in Manage trees
 * and its row among the merge guide's targets. One research, one tree: the
 * owner names its research, a copy is "copy of the tree … · no research".
 */
import { TreeManager } from '../tree-manager.js';
import { treeOriginLine, type TreeOriginLine } from '../tree-row.js';
import type { TreeMetadata } from '../types.js';

/** The tree's origin line (kind, words, research id) as the tree index says it now. */
export function treeOrigin(tree: TreeMetadata): TreeOriginLine {
    return treeOriginLine(tree, {
        owner: TreeManager.canSendToResearch(tree.id),
        copyOrigin: TreeManager.researchCopyOrigin(tree.id),
    });
}

/** The words of the tree's origin line ("copy of the tree “…” · no research"). */
export function treeOriginText(tree: TreeMetadata): string {
    return treeOrigin(tree).text;
}

/**
 * A copy of a research tree (spec 139 K5.2): an older copy still tied to the
 * research, or a copy whose original owns a research now. Where a tree never
 * tied to a research is to say no word of it (the merge guide, 134 §11), only
 * such a copy is said to have none.
 */
export function isResearchCopy(tree: TreeMetadata): boolean {
    if (TreeManager.canSendToResearch(tree.id) || !TreeManager.researchCopyOrigin(tree.id)) return false;
    return !!tree.research || (!!tree.copyOf && TreeManager.canSendToResearch(tree.copyOf.treeId));
}
