/**
 * The write of the import guide's plan (spec 134 §8, the interim way of part A):
 * the plan goes through applyPlan and its check before saving, and the result
 * becomes a NEW tree; the target tree stays unchanged. Nothing is saved when
 * the check fails or the new tree's write does not land (K0.2, K0.5).
 */

import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { strings } from '../strings.js';
import type { StromData, TreeId } from '../types.js';
import { applyPlan, type MergePlan, type MergeRecord, type VerifyIssue } from './plan.js';
import { deleteBackup } from './executor.js';
import { mergeCheckMessage, type MergeCheckProblem } from './merge-check.js';

export type WriteOutcome =
    | {
        ok: true; treeId: TreeId; name: string; data: StromData; record: MergeRecord;
        importMap?: Map<string, string>; sharedJoined?: number;
    }
    | { ok: false; message: string };

/** The new tree's name: "{target} + {source}" (behaviour question 6), the source alone for a new tree. */
export function newTreeName(plan: MergePlan): string {
    const source = plan.source.label.replace(/\.(ged|gedcom|json)$/i, '') || plan.source.label;
    if (plan.mode === 'new') return source || strings.treeManager.newTree;
    const target = plan.target.name;
    if (target && source) return `${target} + ${source}`;
    return target || source || strings.treeManager.newTree;
}

/** What the check before saving found, as one message: the plan's own findings first, then merge-check's. */
export function writeIssuesMessage(issues: readonly VerifyIssue[]): string {
    if (issues.length === 0) return strings.merge.failed;
    const known = issues.filter((i): i is VerifyIssue & { kind: MergeCheckProblem['kind'] } =>
        i.kind !== 'planAddedMissing' && i.kind !== 'planSkippedPresent');
    if (known.length === issues.length) return mergeCheckMessage(known);
    return known.length ? `${strings.mergeWizard.badTotals} ${mergeCheckMessage(known)}` : strings.mergeWizard.badTotals;
}

/**
 * Write the plan into a new tree named `name`. The target and the source
 * are not changed. The new tree exists only once its data is stored; on any
 * failure nothing is left behind and the message says why.
 */
export async function writePlanAsNewTree(plan: MergePlan, target: StromData, source: StromData, name: string): Promise<WriteOutcome> {
    const applied = await applyPlan(plan, target, source);
    if (!applied.ok) return { ok: false, message: writeIssuesMessage(applied.issues) };

    const treeId = TreeManager.createTree(name);
    // Quiet: only the merge's own message says it failed, not the general "saving failed" toast too.
    if (!await TreeManager.saveTreeDataConfirmed(treeId, applied.data, { quiet: true })) {
        await TreeManager.deleteTree(treeId).catch(() => false);
        return { ok: false, message: strings.merge.saveFailed };
    }
    TreeManager.noteUserChange(treeId);

    const counts = applied.record.counts;
    if (plan.mode !== 'new') {
        AuditLogManager.log(treeId, 'data.import', strings.auditLog.treeMerge(counts.joined, counts.added, plan.source.label || '?'));
    }
    if (applied.backupKey) await deleteBackup(applied.backupKey);

    return {
        ok: true, treeId, name, data: applied.data, record: applied.record,
        ...(applied.importMap ? { importMap: applied.importMap } : {}),
        ...(applied.sharedJoined ? { sharedJoined: applied.sharedJoined } : {}),
    };
}
