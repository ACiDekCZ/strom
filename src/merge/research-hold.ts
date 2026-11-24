/**
 * A merge into a tree tied to a research (spec 134 §11, K9.2): what the
 * merge brought stays in the app until it is sent there by hand ("Send to
 * the research…", the tree's own send) or undone. While it waits, the
 * tree's link holds `mergeHold` and nothing goes by itself
 * (researchAutoOn). A send that lands marks the merges it took (`sentAt`,
 * `sentIntake`) and, once the research's sends name it, the research's
 * input (`sentToResearch`, what `strom sync undo` takes).
 */

import type { MergeRecord, ResearchLink, StromData, TreeId, TreeMetadata } from '../types.js';
import type { ResearchSendRecord } from '../research-link.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';

type Hold = NonNullable<ResearchLink['mergeHold']>;

/** The tree's link when the tree owns its research (a copy or a second tree of it never holds: spec 139 K5.3). */
function linkOf(treeId: TreeId): ResearchLink | undefined {
    const link = TreeManager.getTreeMetadata(treeId)?.research;
    return link && TreeManager.canSendToResearch(treeId) ? link : undefined;
}

/**
 * The merges of `data` not in the research yet: written into the tree
 * itself (not a new tree), not undone, not sent, and newer than the
 * tree's last send (a merge from before the tree was sent went with it).
 */
export function unsentMerges(data: StromData | null | undefined, link: ResearchLink | undefined): MergeRecord[] {
    if (!data?.merges?.length || !link || link.copy) return [];
    const since = link.sent?.at ?? '';
    return data.merges.filter(r => !r.target.newTree && r.state !== 'undone' && !r.sentAt && !r.sentToResearch && r.at > since);
}

/** The hold the unsent merges make (undefined: none). */
export function holdOf(pending: readonly MergeRecord[]): Hold | undefined {
    if (!pending.length) return undefined;
    return {
        mergeId: pending[pending.length - 1].id,
        at: pending[0].at,
        persons: pending.reduce((n, r) => n + r.counts.added, 0),
    };
}

/** The links (couples, parents and children) the unsent merges brought. */
export function heldLinks(pending: readonly MergeRecord[]): number {
    return pending.reduce((n, r) => n + r.counts.links, 0);
}

function sameHold(a: Hold | undefined, b: Hold | undefined): boolean {
    return a?.mergeId === b?.mergeId && a?.at === b?.at && a?.persons === b?.persons;
}

/**
 * The tree's hold as its data `data` say now: set by a merge written into
 * the tree (in the same write, before the tree shows it), gone when the
 * merges were undone (the undo, Ctrl+Z) or sent; back with a redo. No-op
 * for a tree without a research.
 */
export function syncMergeHold(treeId: TreeId, data: StromData | null | undefined): void {
    const link = linkOf(treeId);
    if (!link || !data) return;
    const next = holdOf(unsentMerges(data, link));
    if (sameHold(link.mergeHold, next)) return;
    TreeManager.patchResearchLink(treeId, { mergeHold: next });
    // The tree switcher and Manage trees say it (11b).
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MERGE_HOLD_EVENT, { detail: { treeId } }));
}

/** The event after a tree's hold came or went. */
export const MERGE_HOLD_EVENT = 'strom:merge-hold';

/** A tree's hold, when it waits for a send after a merge (a tree tied to a research itself). */
export function treeHold(tree: TreeMetadata | null | undefined): Hold | undefined {
    if (!tree?.research) return undefined;
    return TreeManager.canSendToResearch(tree.id) ? tree.research.mergeHold : undefined;
}

/** The tree's data now: the open tree's, else stored. */
async function dataNow(treeId: TreeId): Promise<StromData | null> {
    return DataManager.getDataFor(treeId) ?? await TreeManager.getTreeData(treeId);
}

/** Store a change of the tree's merge records only (not part of the tree's content: no Undo step, nothing to send). */
function storeRecords(treeId: TreeId, data: StromData): void {
    TreeManager.saveTreeData(treeId, data);
}

/**
 * A send of tree `treeId` landed in the research (`intake`: its mark): the
 * merges the sent data `sent` held unsent went with it. They are marked
 * sent, and the hold goes (sending by itself goes on).
 */
export async function settleMergeHold(treeId: TreeId, sent: StromData, intake: string | undefined): Promise<void> {
    const link = linkOf(treeId);
    if (!link) return;
    const ids = new Set(unsentMerges(sent, link).map(r => r.id));
    const data = ids.size ? await dataNow(treeId) : null;
    if (data?.merges) {
        const at = new Date().toISOString();
        let changed = false;
        for (const r of data.merges) {
            if (!ids.has(r.id) || r.sentAt) continue;
            r.sentAt = at;
            if (intake) r.sentIntake = intake;
            changed = true;
        }
        if (changed) storeRecords(treeId, data);
    }
    syncMergeHold(treeId, data ?? DataManager.getDataFor(treeId) ?? sent);
}

/**
 * The research's sends (`/status.sends`) name the input of a send that
 * took a merge: kept in the merge's record (`sentToResearch`). Only the
 * open tree's records are looked at here (cheap); the undo dialog asks
 * for any tree (resolveSentInput).
 */
export function noteResearchSends(researchId: string, sends: readonly ResearchSendRecord[] | null | undefined): void {
    const treeId = DataManager.getCurrentTreeId();
    if (!treeId || !sends?.length || linkOf(treeId)?.id !== researchId.toLowerCase()) return;
    const data = DataManager.getDataFor(treeId);
    if (data && resolveInputs(data, sends)) storeRecords(treeId, data);
}

/** Fill `sentToResearch` of records whose send the research names with its input; true when any changed. */
export function resolveInputs(data: StromData, sends: readonly ResearchSendRecord[]): boolean {
    let changed = false;
    for (const r of data.merges ?? []) {
        if (r.sentToResearch || !r.sentIntake) continue;
        const input = sends.find(s => s.intake === r.sentIntake)?.input;
        if (input) {
            r.sentToResearch = input;
            changed = true;
        }
    }
    return changed;
}

/** Record `recordId` of tree `treeId` with its input read from `sends` when the research names it now (stored). */
export async function resolveSentInput(treeId: TreeId, recordId: string, sends: readonly ResearchSendRecord[] | null | undefined): Promise<MergeRecord | null> {
    const data = await dataNow(treeId);
    const record = data?.merges?.find(r => r.id === recordId) ?? null;
    if (data && record && !record.sentToResearch && sends?.length && resolveInputs(data, sends)) storeRecords(treeId, data);
    return record;
}
