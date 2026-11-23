/**
 * The write of the import guide's plan (spec 134 §8): into the target tree
 * itself or into a new tree (a copy of the target + the import), each
 * "Separate tree" group as a tree of its own.
 *
 * In this order, nothing written until the last step:
 * 1. into the tree: the target as it is now against the fingerprint the plan
 *    was built over (another window, the research, a phone changed it: the
 *    plan is built again, §8 8c);
 * 2. applyPlan and its check before saving (8b);
 * 3. the backup "Before merge" of the target, whatever the automatic backups
 *    setting, kept out of the rotation when the merge goes into the tree
 *    (K0.4, K6.6; 8d, 8e);
 * 4. the trees stored, success only once their writes have landed; the open
 *    tree takes the result as one undo step (K0.5, K8.5; 8f).
 * Each tree is one stored record: a window closed during the write leaves
 * the tree as it was or as the merge made it, nothing between.
 */

import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { AuditLogManager } from '../audit-log.js';
import { strings } from '../strings.js';
import { contentFingerprint } from '../research-link.js';
import { keptBackupAtRisk } from '../snapshots.js';
import type { PersonId, StromData, TreeId } from '../types.js';
import { applyPlan, type MergePlan, type MergeRecord, type PlanTarget, type VerifyIssue } from './plan.js';
import { deleteBackup } from './executor.js';
import { mergeCheckMessage, type MergeCheckProblem } from './merge-check.js';

/** Where the plan goes: the target tree itself, or a new tree (a copy of the target + the import). */
export type WriteInto = 'tree' | 'new';

/** A stage of the write (8a check, 8f backup and write) for the progress. */
export type WritePhase = 'check' | 'backup' | 'persons' | 'done';

export interface WriteOptions {
    /** The import's data. */
    source: StromData;
    /**
     * The target as the comparison read it (what the plan was built over): the
     * new tree's base when the target has no id, and what a change of the
     * target is counted against (8c).
     */
    target: StromData;
    into: WriteInto;
    /** The new tree's name (into 'new'); newTreeName(plan) when not given. */
    name?: string;
    /**
     * The answer to `need: 'retention'` (8e): keep both backups of merges over
     * the limit, or let the rotation delete the oldest other backup.
     */
    retention?: 'keep-both' | 'drop-oldest';
    /** The progress of the write: `a` of `n` (persons for 'persons'). */
    onProgress?: (phase: WritePhase, a: number, n: number) => void;
}

/** A tree the write stored. */
export interface WrittenTree {
    treeId: TreeId;
    name: string;
}

export type WriteResult =
    | {
        ok: true; into: WriteInto; treeId: TreeId; name: string; data: StromData; record: MergeRecord;
        /** The trees of the "Separate tree" groups (§6). */
        ownTrees: WrittenTree[];
        /** The backup "Before merge" (none for a new tree from a file). */
        backupId?: string;
        importMap?: Map<string, string>; sharedJoined?: number;
    }
    /** 8b: the check before saving failed; `message` says what would have gone wrong. */
    | { ok: false; reason: 'verify'; issues: VerifyIssue[]; message: string }
    /** 8d: the backup could not be made (quota, a locked or unreadable tree): `why` in words, `detail` the browser's own message. */
    | { ok: false; reason: 'backup'; why: string; detail: string }
    /** A tree's write did not land (nothing is left behind). */
    | { ok: false; reason: 'save'; message: string }
    /** 8c: the target changed since the comparison; nothing written, the plan is to be built again. */
    | { ok: false; need: 'replan'; changed: TargetChange }
    /** 8e: the rotation would delete the backup of an earlier merge (`date`, ms epoch); ask with `opts.retention`. */
    | { ok: false; need: 'retention'; date: number };

/** How the target changed since the comparison (8c). */
export interface TargetChange {
    /** When it was last changed (ISO), '' when unknown. */
    when: string;
    /** Persons in the tree now that were not there. */
    added: number;
    /** Persons whose details changed, or who are gone. */
    edited: number;
}

/** What the tree keeps of where its work stands, whatever a merge writes (data.ts WINDOW_STATE_KEYS). */
const TREE_STATE_KEYS = ['lastFocusPersonId', 'lastFocusDepthUp', 'lastFocusDepthDown', 'defaultPersonId', 'defaultView'] as const;

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

/** The target's data as they are now: the open tree's, else as stored. Null when it cannot be read. */
function errorText(err: unknown): string {
    return err instanceof Error || err instanceof DOMException ? err.message : String(err);
}

/** The storage was full: the error says so, itself or through its cause. */
function isQuotaError(err: unknown): boolean {
    for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
        const name = (e as { name?: unknown }).name;
        if (name === 'QuotaExceededError' || /quota/i.test(errorText(e))) return true;
    }
    return false;
}

/**
 * 8d: why the backup failed, in a sentence of the app's language: a full
 * storage with the room left (the browser's estimate), else a general one.
 * The browser's own message stays for the title.
 */
export async function backupFailureWhy(err: unknown): Promise<string> {
    const W = strings.mergeWizard;
    if (!isQuotaError(err)) return W.backupWhyOther;
    let freeMb: number | null = null;
    try {
        const est = await (navigator as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }).storage?.estimate?.();
        if (est?.quota && est.usage !== undefined) freeMb = Math.max(0, Math.floor((est.quota - est.usage) / (1024 * 1024)));
    } catch { /* unknown: the sentence without the number */ }
    return W.storageFull(freeMb);
}

async function currentTarget(treeId: TreeId): Promise<StromData | null> {
    return DataManager.getDataFor(treeId) ?? await TreeManager.getTreeData(treeId).catch(() => null);
}

/**
 * The target is as the plan was built over it (K6.5): its fingerprint now
 * against the plan's. Null when unchanged (or the plan has no fingerprint:
 * a new tree), else how it changed since `before`.
 */
export function verifyTargetUnchanged(target: PlanTarget, now: StromData, before: StromData): TargetChange | null {
    if (!target.treeId || !target.fingerprint) return null;
    if (contentFingerprint(now) === target.fingerprint) return null;
    const when = TreeManager.getTrees().find(t => t.id === target.treeId)?.lastModifiedAt ?? '';
    // The open tree edited in place is the data the comparison read: only its count tells what came.
    if (now === before) {
        const persons = Object.values(now.persons).filter(p => !p.isPlaceholder).length;
        return { when, added: Math.max(0, persons - target.persons), edited: 0 };
    }
    let added = 0;
    let edited = 0;
    for (const p of Object.values(now.persons)) {
        if (p.isPlaceholder) continue;
        const was = before.persons[p.id];
        if (!was) added++;
        else if (JSON.stringify(was) !== JSON.stringify(p)) edited++;
    }
    for (const p of Object.values(before.persons)) if (!p.isPlaceholder && !now.persons[p.id as PersonId]) edited++;
    return { when, added, edited };
}

/** Store `data` as a new tree `name`; null (and no tree left) when the write did not land. */
async function storeNewTree(name: string, data: StromData): Promise<TreeId | null> {
    const treeId = TreeManager.createTree(name);
    // Quiet: only the merge's own message says it failed, not the general "saving failed" toast too.
    if (!await TreeManager.saveTreeDataConfirmed(treeId, data, { quiet: true })) {
        await TreeManager.deleteTree(treeId).catch(() => false);
        return null;
    }
    TreeManager.noteUserChange(treeId);
    return treeId;
}

/**
 * Write the plan (§8). Nothing is written unless every check passed, the
 * backup was made and every write landed; any other result says why.
 */
export async function writePlan(plan: MergePlan, opts: WriteOptions): Promise<WriteResult> {
    if (plan.mode === 'compare') throw new Error('A comparison plan is not written');
    const progress = opts.onProgress ?? (() => {});
    const targetId = plan.target.treeId;
    const into: WriteInto = plan.mode === 'new' || !targetId ? 'new' : opts.into;

    // 1. The target as it is now, unchanged since the comparison (8c). A new
    // tree is the copy the plan was built over + the import: the target is
    // not written, so a merge gone on with as saved over a changed tree
    // (K0.6) writes what its plan says.
    progress('check', 0, 1);
    let target = opts.target;
    if (targetId && into === 'tree') {
        const now = await currentTarget(targetId);
        if (!now) return { ok: false, reason: 'backup', why: strings.merge.failed, detail: '' };
        const changed = verifyTargetUnchanged(plan.target, now, opts.target);
        if (changed) return { ok: false, need: 'replan', changed };
        // What the comparison did not read (settings of the tree, its research link) as it is now.
        target = now;
    }

    // 2. The result and its check before saving (8b).
    const applied = await applyPlan(plan, target, opts.source);
    if (!applied.ok) return { ok: false, reason: 'verify', issues: applied.issues, message: writeIssuesMessage(applied.issues) };
    const data = applied.data;
    if (into === 'tree') {
        for (const key of TREE_STATE_KEYS) {
            if (target[key] === undefined) delete data[key];
            else (data as unknown as Record<string, unknown>)[key] = target[key];
        }
    }
    progress('check', 1, 1);

    // 3. The backup "Before merge" (K0.4), out of the rotation when the merge goes into the tree (K6.6).
    let backupId: string | undefined;
    if (targetId) {
        const keepFor = into === 'tree' ? plan.id : undefined;
        if (keepFor && !opts.retention) {
            const atRisk = await keptBackupAtRisk(targetId).catch(() => null);
            if (atRisk) return { ok: false, need: 'retention', date: atRisk.createdAt };
        }
        progress('backup', 0, 1);
        try {
            const meta = await DataManager.backupBeforeMerge(targetId, {
                ...(keepFor ? { keepFor } : {}),
                ...(opts.retention === 'keep-both' ? { retention: 'skip' as const } : {}),
            });
            backupId = meta.id;
        } catch (err) {
            if (applied.backupKey) await deleteBackup(applied.backupKey).catch(() => {});
            return { ok: false, reason: 'backup', why: await backupFailureWhy(err), detail: errorText(err) };
        }
        progress('backup', 1, 1);
        applied.record.backupId = backupId;
    }

    // The record goes into the tree's history in the same write (§0.3, K7.2): the tree itself,
    // a new tree (a copy of the target + the import, or the import alone) and each separate tree.
    const newName = into === 'tree' && targetId ? plan.target.name : opts.name ?? newTreeName(plan);
    if (into !== 'tree' || !targetId) applied.record.target = { name: newName, newTree: true };
    data.merges = [...(data.merges ?? []), applied.record];
    for (const own of applied.ownTrees) own.data.merges = [...(own.data.merges ?? []), own.record];

    // 4. The trees stored: the separate ones first (taken back when the main write fails).
    const persons = applied.record.counts.added + applied.record.counts.joined;
    progress('persons', 0, persons);
    const ownTrees: WrittenTree[] = [];
    const undoOwn = async (): Promise<void> => {
        for (const t of ownTrees) await TreeManager.deleteTree(t.treeId).catch(() => false);
    };
    for (const own of applied.ownTrees) {
        const id = await storeNewTree(own.name, own.data);
        if (!id) {
            await undoOwn();
            return { ok: false, reason: 'save', message: strings.merge.saveFailed };
        }
        ownTrees.push({ treeId: id, name: own.name });
    }

    let treeId: TreeId;
    let name: string;
    if (into === 'tree' && targetId) {
        treeId = targetId;
        name = plan.target.name;
        if (!await TreeManager.saveTreeDataConfirmed(targetId, data, { quiet: true })) {
            await undoOwn();
            return { ok: false, reason: 'save', message: strings.merge.saveFailed };
        }
        // The open tree shows the result, one step back with Undo (K8.5).
        if (!DataManager.adoptMergeResult(targetId, data, strings.undo.mergeTrees)) TreeManager.noteUserChange(targetId);
    } else {
        name = newName;
        const id = await storeNewTree(name, data);
        if (!id) {
            await undoOwn();
            return { ok: false, reason: 'save', message: strings.merge.saveFailed };
        }
        treeId = id;
    }
    progress('persons', persons, persons);

    // 5. The log, and the working backups go only now that the writes have landed (K0.5).
    const counts = applied.record.counts;
    if (plan.mode !== 'new') {
        AuditLogManager.log(treeId, 'data.import', `${strings.auditLog.treeMerge(counts.joined, counts.added, plan.source.label || '?')} · ${strings.auditLog.mergeLink}`);
    }
    if (applied.backupKey) await deleteBackup(applied.backupKey);
    for (const own of applied.ownTrees) if (own.backupKey) await deleteBackup(own.backupKey);
    progress('done', 1, 1);

    return {
        ok: true, into, treeId, name, data, record: applied.record, ownTrees,
        ...(backupId ? { backupId } : {}),
        ...(applied.importMap ? { importMap: applied.importMap } : {}),
        ...(applied.sharedJoined ? { sharedJoined: applied.sharedJoined } : {}),
    };
}
