/**
 * What a step of the import guide gets to draw its body (spec 134 §0.4):
 * the choices, the plan and its counts, the merge state. The step keeps no
 * state of its own; a change goes through `update` (the guide redraws).
 */

import type { MergeState } from '../types.js';
import type { MergePlan, PlanCounts, ScopeExample, WizardChoices } from '../plan.js';
import type { MergeRecord, PartnershipId, PersonId, TreeId } from '../../types.js';
import type { GedcomDroppedTag } from '../../ged-parser.js';
import type { WizardStep } from '../wizard-steps.js';
import { strings } from '../../strings.js';

export interface StepContext {
    readonly step: WizardStep;
    readonly state: MergeState;
    readonly choices: WizardChoices;
    /** Null until the comparison of step 1 ran. */
    readonly plan: MergePlan | null;
    readonly counts: PlanCounts | null;
    readonly compared: boolean;
    /** The choices changed (merged in), or only the merge state: the guide saves and redraws. */
    update(change?: Partial<WizardChoices>): void;
    /** What step 2 does beyond the choices (§4). */
    step2?: Step2Env;
    /** What step 1 reads and does beyond the choices (§3). */
    step1?: Step1Env;
    /** What step 5 does beyond the choices (§8). */
    step5?: Step5Env;
    /** What step 6 says and does once the write landed (§9). */
    step6?: Step6Env;
}

/** Step 6 of the guide: the written merge and its actions (§9). */
export interface Step6Env {
    /** The merge's record as the write stored it in the tree. */
    readonly record: MergeRecord;
    readonly treeId: TreeId;
    /** The tree written into (or the new tree's name). */
    readonly treeName: string;
    /** Written into a tree that was there: the merge can be undone from here. */
    readonly intoExisting: boolean;
    /** A file from another program went into a tree that was there: the What next card does not follow, say so. */
    readonly noNextCard: boolean;
    showInTree(): void;
    saveAsList(): void;
    checkTree(): void;
    undoMerge(): void;
    /** A tree with a research and the merge not sent there yet (§11): the block "Research {t}". */
    readonly research?: Step6Research;
}

/** Step 6's block of the research (§11, 11a/11d/11e): what stays in the app, Send… or Keep. */
export interface Step6Research {
    /** People and links of the merges not sent yet. */
    readonly persons: number;
    readonly links: number;
    /** Keep in the app for now was chosen: the block is folded to its state. */
    readonly kept: boolean;
    /** An agent works on this direction now ("G0002"; '' when it does not say which): sending waits (11d). */
    readonly agent: string | null;
    /** The research is older, without sending after a merge: its version (11e). */
    readonly old: string | null;
    send(): void;
    keepLocal(): void;
}

/** Step 5 of the guide: Save the list… (K6.4), the plan as .txt and .json; where the write stands (§8). */
export interface Step5Env {
    savePlan(): void;
    /** Where the write stands (8a–8f), null before a write or after a choice changed. */
    readonly status: WriteStatus | null;
    /** A button of a state: Back to Whom to add, Backups…, Save the tree to a file…, Try again, the rotation's answer. */
    act(action: WriteAction): void;
}

/** Where the write of step 5 stands (spec 134 §8 8a–8f), said above the list. */
export type WriteStatus =
    /** 8a: the totals and links are checked (`p` people, `l` links, `s` sources). */
    | { kind: 'checking'; p: number; l: number; s: number }
    /** 8f, before the people: the backup "Before merge" of tree `t` is made. */
    | { kind: 'backup'; t: string }
    /** 8f: written into tree `t`, `a` of `n` people. */
    | { kind: 'writing'; t: string; a: number; n: number }
    /** 8b: the check before saving failed; `message` says what, `detail` the findings. */
    | { kind: 'bad'; message: string; detail: string }
    /** 8c: the target changed meanwhile; the plan was built again. */
    | { kind: 'changed'; text: string }
    /** 8d: the backup could not be made (`why` in words, `detail` the browser's message, for the title). */
    | { kind: 'backupFailed'; why: string; detail: string }
    /** A tree's write did not land (nothing left behind). */
    | { kind: 'failed'; message: string }
    /** 8e: the rotation would delete the backup of the merge of `date`. */
    | { kind: 'retention'; date: string };

export type WriteAction = 'whom' | 'backups' | 'save-tree' | 'retry' | 'keep-both' | 'drop-oldest';

/** A decision of step 2: same, new, not added, another person of the tree; null = undecided again. */
export type PairDecision = 'confirm' | 'reject' | 'skip' | { type: 'manual_match'; targetId: PersonId };

/** A couple both trees know that differs (a line under "What speaks against"). */
export interface UnionConflictLine {
    id: PartnershipId;
    text: string;
}

/** Step 2 of the guide: the decisions on the pairs and what opens from them (§4). */
export interface Step2Env {
    decide(incomingId: PersonId, decision: PairDecision | null): void;
    /** Several persons at once (the undecided rest, the joins of the selected undone). */
    decideMany(incomingIds: readonly PersonId[], decision: 'reject' | 'skip'): void;
    /** "Another person…": the tree's person picked by hand (#merge-manual-dialog). */
    other(incomingId: PersonId): void;
    /** The couples of the person both trees know that differ. */
    unionConflicts(incomingId: PersonId): UnionConflictLine[];
    /** The pair side by side in both trees, or the import's person in its tree. */
    compare(incomingId: PersonId, treeId?: PersonId): void;
    preview(incomingId: PersonId): void;
    reanalyze(): void;
}

/** Why a tree cannot be the target (§2), or why it cannot be compared yet (13f). */
export type TargetBlock = 'locked' | 'readOnly' | 'newer' | 'live';

/** A tree in step 1's list of targets (or the tree the import comes from). */
export interface TargetRow {
    treeId: TreeId;
    name: string;
    persons: number;
    /** The tree open in the window. */
    open: boolean;
    research: boolean;
    /** The latest backup, as said ("today 9:12"), or null. */
    backup: string | null;
    block: TargetBlock | null;
    /** The block said in words ('' when none). */
    why: string;
}

/** Step 1 of the guide: what the import is, the trees it can go to, and what the step can do. */
export interface Step1Env {
    /** Today's GEDCOM summary (`#gedcom-summary`), drawn for the file; null when the import is not a file being read now. */
    gedcomSummary(): HTMLElement | null;
    /** The file's program, date and encoding ("MyHeritage · 14 NOV 2026 · UTF-8"), '' when unknown. */
    sourceMeta(): string;
    /** What the file holds beyond people, for an import that is not a GEDCOM file being read: tiles (label, count). */
    sourceTiles(): Array<[string, number]>;
    /** The lines of the file the tree has no place for. */
    notTaken(): readonly GedcomDroppedTag[];
    /** The tree the import comes from (two trees, 3b), null otherwise. */
    sourceTree(): TargetRow | null;
    /** The trees the import can go to, the source tree aside. */
    targets(): TargetRow[];
    /** Step 1's mode choice: one of the plan's modes, or "Save as JSON". */
    setMode(mode: WizardChoices['mode'] | 'json'): void;
    selectTarget(treeId: TreeId): void;
    /** Source and target swapped (two trees): the reason it cannot be, '' when it can. */
    swapBlocked(): string;
    swap(): void;
    /** "End following" of a target followed live from the research (2f): the open tree takes the import again. */
    endFollow(): void;
    /** The chosen target is encrypted and locked: it can be compared only once unlocked (13f). */
    encLocked(): boolean;
    unlock(): void;
    /** The scope's options said on one person of the target (null: the general sentences). */
    example(): ScopeExample | null;
    /** The same source merged before (13c): the sentence, '' when not. */
    repeat(): string;
    /** Another tree linked to a research with the import's people (K9.5): its name, null when none (or not read yet). */
    samePeople(): string | null;
    /** "Save list…": the lines not taken over as a .txt file. */
    saveNotTaken(): void;
}

const GLYPH = {
    joined: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    added: '<path d="M12 5v14M5 12h14"/>',
    skipped: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
    pending: '<path d="M12 5v9"/><path d="M12 18h.01"/>',
} as const;

export type GlyphKind = keyof typeof GLYPH;

/** A person's fate as a stroked glyph: ✓ joined, + added, ⊘ not added, ! to decide. */
export function glyph(kind: GlyphKind, size = 12, width = 2.5): string {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[kind]}</svg>`;
}

/** The step's name ("Who is who"). */
export function stepName(step: WizardStep): string {
    return strings.mergeWizard.steps[step - 1] ?? '';
}

export function escapeHtml(text: string): string {
    return String(text ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** The step's heading: focused after a change of step (§1, §13). */
export function stepHeading(step: WizardStep, text = stepName(step)): string {
    return `<h3 class="merge-step-title" tabindex="-1" data-step-title="${step}">${escapeHtml(text)}</h3>`;
}
