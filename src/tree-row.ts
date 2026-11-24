/**
 * The Manage trees row's facts (spec 139 §7.2): what the third line says of a
 * tree's origin and research, read from the tree index alone (TreeMetadata),
 * never from the tree's data.
 */
import { strings } from './strings.js';
import type { StromData, TreeMetadata } from './types.js';

/** What a tree is, for its row's third line (in this order of precedence). */
export type TreeOriginKind = 'research' | 'copy' | 'fromTree' | 'import' | 'none';

export interface TreeOriginLine {
    kind: TreeOriginKind;
    /** The line's words ("from GEDCOM jesensti.ged · no research"). */
    text: string;
    /** The research's id, for a tree that owns one (its switch goes beside the words). */
    researchId?: string;
}

/** What the rule of one research, one tree says of the tree (research-owner.ts). */
export interface TreeOriginContext {
    /** The tree owns its research (isResearchOwner). */
    owner: boolean;
    /** A copy of a research tree (researchCopyOrigin): the original's name, null when not known. */
    copyOrigin: { name: string | null } | null;
}

/** A research's id as the row shows it: its first 8 characters (the whole id is in the tooltip). */
export function researchShortId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * The file a tree's data was last loaded from (its last StromData.imports
 * record with a file name; every record is a GEDCOM load), or undefined.
 */
export function importOriginOf(data: Pick<StromData, 'imports'>): TreeMetadata['importedFrom'] | undefined {
    const records = data.imports ?? [];
    for (let i = records.length - 1; i >= 0; i--) {
        const file = records[i]?.file?.trim();
        if (file) return { file, kind: /\.json$/i.test(file) ? 'json' : 'gedcom' };
    }
    return undefined;
}

/** The third line of a tree's row in Manage trees: origin and research, never empty. */
export function treeOriginLine(tree: TreeMetadata, ctx: TreeOriginContext): TreeOriginLine {
    const s = strings.structure;
    const none = strings.treeActions.researchNone;
    if (ctx.owner && tree.research?.id) {
        return { kind: 'research', text: s.research(researchShortId(tree.research.id)), researchId: tree.research.id };
    }
    const copyName = ctx.copyOrigin ? ctx.copyOrigin.name : tree.copyOf ? tree.copyOf.name || null : undefined;
    if (copyName !== undefined) return { kind: 'copy', text: strings.research.copyOf(copyName) };
    if (tree.fromTree) return { kind: 'fromTree', text: `${s.fromTree(tree.fromTree.name)} · ${none}` };
    if (tree.importedFrom) {
        const from = tree.importedFrom.kind === 'gedcom' ? s.fromGedcom(tree.importedFrom.file) : s.fromFile(tree.importedFrom.file);
        return { kind: 'import', text: `${from} · ${none}` };
    }
    return { kind: 'none', text: none };
}

/** What an unfinished merge session tells of its target and source (merge/persistence.ts SavedMergeSession). */
export interface PendingMergeOf {
    incomingFileName?: string;
    targetTreeName?: string;
    targetTreeId?: string;
    sourceTreeName?: string;
}

/**
 * The tree an unfinished merge writes into, of `trees` (spec 139 §9.1): by
 * the id it carries, else (an older session) by its target's name when one
 * tree has it. Null when its target is not among them (deleted) or not known.
 */
export function pendingMergeTreeId(session: PendingMergeOf, trees: readonly { id: string; name: string }[]): string | null {
    if (session.targetTreeId) return trees.some(t => t.id === session.targetTreeId) ? session.targetTreeId : null;
    if (!session.targetTreeName) return null;
    const named = trees.filter(t => t.name === session.targetTreeName);
    return named.length === 1 ? named[0].id : null;
}

/** The session names a target it merges into (pendingMergeTreeId null then means: that tree is gone). */
export function pendingMergeHasTarget(session: PendingMergeOf): boolean {
    return !!(session.targetTreeId || session.targetTreeName);
}

/**
 * What an unfinished merge brings in, for its row: the name it was given
 * (a file, or a rename), else the tree merged from, else `fallback`. The
 * name made of both trees ("Target + Source") gives way to the source's.
 */
export function pendingMergeSourceName(session: PendingMergeOf, fallback: string): string {
    const auto = session.targetTreeName && session.sourceTreeName ? `${session.targetTreeName} + ${session.sourceTreeName}` : null;
    const named = session.incomingFileName && session.incomingFileName !== auto ? session.incomingFileName : '';
    return named || session.sourceTreeName || session.incomingFileName || fallback;
}
