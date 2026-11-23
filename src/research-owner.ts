/**
 * One research, one tree (spec 139 K5.1): of every tree of the app tied to a
 * research, only its owner writes to it — the tree that takes its updates
 * (the tie without `copy`; with several such, the first). A copy (Duplicate,
 * "Open as a new copy", a second import of the research's file) has no tie:
 * `copyOf` names the tree it came from, and it is described as a tree without
 * research. A copy made before that kept the tie as `copy: true`: it sends
 * nothing either, by itself or by hand, and follows nothing.
 *
 * Every way of writing a tree to a research (the sends by themselves and by
 * hand, the send link, the research's bridge) asks `isResearchOwner`.
 */

/** What the rule reads of a tree (TreeMetadata has it). */
export interface ResearchTieOf {
    id: string;
    name?: string;
    /** The bundled sample tree: never written to a research. */
    demo?: boolean;
    research?: { id: string; copy?: boolean };
    /** A copy: the tree it was copied from and its name then (TreeMetadata.copyOf). */
    copyOf?: { treeId: string; name: string };
}

/** The tree that owns the research `researchId` (the first tie that is not a copy), or null. */
export function researchOwnerIn<T extends ResearchTieOf>(trees: readonly T[], researchId: string): T | null {
    const id = researchId.toLowerCase();
    return trees.find(t => t.research?.id === id && !t.research.copy) ?? null;
}

/** The tree `treeId` may write to its research: it has one, owns it, and is not the sample tree. */
export function isResearchOwner(trees: readonly ResearchTieOf[], treeId: string | null | undefined): boolean {
    if (!treeId) return false;
    const tree = trees.find(t => t.id === treeId);
    if (!tree?.research?.id || tree.research.copy || tree.demo) return false;
    return researchOwnerIn(trees, tree.research.id)?.id === treeId;
}

/**
 * A copy of a tree with a research (spec 139 K5.2): the name of the tree it
 * was copied from (null: not known any more). A new copy names it in
 * `copyOf`; an older copy still tied to the research (`copy: true`, or a
 * second tie of the same research) names the research's owner. Null for any
 * other tree.
 */
export function researchCopyOrigin(trees: readonly ResearchTieOf[], treeId: string): { name: string | null } | null {
    const tree = trees.find(t => t.id === treeId);
    // A copy that got a research of its own since is no copy without research any more.
    if (!tree || tree.demo || isResearchOwner(trees, treeId)) return null;
    if (tree.copyOf) return { name: tree.copyOf.name || null };
    if (!tree.research?.id) return null;
    const original = researchOwnerIn(trees, tree.research.id);
    return { name: original && original.id !== treeId ? original.name ?? null : null };
}
