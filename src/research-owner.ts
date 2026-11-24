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

/** What the one-time repair reads of a tree besides its tie: when it was made, its last send. */
export interface SharedTieOf extends ResearchTieOf {
    createdAt?: string;
    research?: { id: string; copy?: boolean; sent?: { at: string; state: string } };
}

/** One tree the one-time repair takes off its research (planSharedTieRepair). */
export interface SharedTieDetach {
    treeId: string;
    /** The tree that keeps the research, and its name. */
    keeper: { treeId: string; name: string };
    /**
     * The tree sent changes to that research after it became a copy (its
     * last send, as it is recorded): the notice tells how the research takes
     * them back. Null: nothing it sent itself is known to stand there.
     */
    sentAfterCopy: { at: string; state: string } | null;
}

function madeAt(tree: SharedTieOf): number {
    const t = Date.parse(tree.createdAt ?? '');
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * One research, one tree for trees tied before that rule (spec 139 K5.1,
 * package 134 point 13): every research tied to more than one tree of the
 * app keeps only one of them — the tree without `copy` (of several such the
 * oldest; when every tie is a copy, the oldest copy stays as it is, writing
 * nothing). Every other tree of that research is to be detached. A copy
 * alone with its research shares it with no tree and stays as it is (it
 * writes nothing either: isResearchOwner).
 *
 * A send counts as the copy's own when it went after the copy was made: the
 * later of the two trees' creation (a duplicate is the younger tree; "Open as
 * a new copy" turns the older tree into the copy when the new one is made).
 * One taken back or discarded in the research stands there no more.
 */
export function planSharedTieRepair(trees: readonly SharedTieOf[]): SharedTieDetach[] {
    const groups = new Map<string, SharedTieOf[]>();
    for (const t of trees) {
        if (!t.research?.id) continue;
        const id = t.research.id.toLowerCase();
        groups.set(id, [...(groups.get(id) ?? []), t]);
    }
    const out: SharedTieDetach[] = [];
    for (const ties of groups.values()) {
        if (ties.length < 2) continue;
        const oldestFirst = [...ties].sort((a, b) => madeAt(a) - madeAt(b));
        const keeper = oldestFirst.find(t => !t.research?.copy) ?? oldestFirst[0];
        for (const t of ties) {
            if (t === keeper) continue;
            const sent = t.research?.sent;
            const copiedAt = Math.max(madeAt(t), madeAt(keeper));
            const own = !!sent && (sent.state === 'pending' || sent.state === 'written')
                && Number.isFinite(copiedAt) && Date.parse(sent.at) > copiedAt;
            out.push({
                treeId: t.id,
                keeper: { treeId: keeper.id, name: keeper.name ?? '' },
                sentAfterCopy: own && sent ? { at: sent.at, state: sent.state } : null,
            });
        }
    }
    return out;
}

/**
 * The tree whose research a copy came from and that owns it now (spec 139
 * K5.4, K5.5): the tree `copyOf` names when it owns a research, else (an
 * older copy still tied) the owner of the copy's research. Null when the copy
 * is no copy without research, or its original has no research any more.
 */
export function researchOriginalOf<T extends ResearchTieOf>(trees: readonly T[], copyId: string): T | null {
    const copy = trees.find(t => t.id === copyId);
    if (!copy || copy.demo || isResearchOwner(trees, copyId)) return null;
    if (copy.copyOf) {
        const of = trees.find(t => t.id === copy.copyOf!.treeId);
        if (of && of.id !== copyId && isResearchOwner(trees, of.id)) return of;
    }
    if (!copy.research?.id) return null;
    const owner = researchOwnerIn(trees, copy.research.id);
    return owner && owner.id !== copyId ? owner : null;
}

/** What a hand-over of a research moves: the tie and the marks of where a tree came from. */
export interface ResearchTransferOf extends ResearchTieOf {
    research?: { id: string; copy?: boolean; mergeHold?: unknown };
    researchDetached?: { link: { id: string } };
}

/**
 * Take over the research of `fromId` by `toId` (spec 139 K5.5): the tie
 * moves whole to `toId` (as its owner: no `copy`, no `copyOf`, no notice of an
 * older detached tie of that research), `fromId` stays a tree without
 * research (no `copyOf` either). The merges held for the original are its
 * own: their hold does not move. Nothing is sent. Changes `trees` in place;
 * false (nothing changed) unless `fromId` owns its research and `toId` is
 * another tree, not the sample tree.
 */
export function transferResearchTie(trees: ResearchTransferOf[], fromId: string, toId: string): boolean {
    const from = trees.find(t => t.id === fromId);
    const to = trees.find(t => t.id === toId);
    if (!from?.research || !to || from === to || to.demo || !isResearchOwner(trees, fromId)) return false;
    const { copy: _copy, mergeHold: _hold, ...link } = from.research;
    delete from.research;
    to.research = link;
    delete to.copyOf;
    if (to.researchDetached?.link.id === link.id) delete to.researchDetached;
    return true;
}
