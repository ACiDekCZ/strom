/**
 * When following the agent (◎) keeps the open tree from taking a merge
 * (spec 134 K2.6): only when it is what the screen shows as following —
 * ◎ on, a live session of this very tree, and the agent working on someone
 * now (the tree jumps to them). ◎ alone is a device preference kept across
 * trees, and ◎ on with an idle agent says "waiting for the agent to work on
 * someone": neither is following the user sees, so neither blocks.
 */
export interface FollowBlockState {
    /** The ◎ switch as stored. */
    on: boolean;
    /** The live session, if any: the tree it is of, and whether it ended. */
    session: { treeId: string | null; ended?: boolean } | null;
    /** The tree in question (the merge target). */
    treeId: string;
    /** The tree open in this window (null: none, or a view). */
    openTreeId: string | null;
    /** The agent works on someone of the tree now (following moves it). */
    working: boolean;
}

export function followBlocksTree(s: FollowBlockState): boolean {
    return s.on && !!s.session && !s.session.ended && s.session.treeId === s.treeId
        && s.openTreeId === s.treeId && s.working;
}
