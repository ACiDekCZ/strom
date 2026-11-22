/**
 * What a step of the import guide gets to draw its body (spec 134 §0.4):
 * the choices, the plan and its counts, the merge state. The step keeps no
 * state of its own; a change goes through `update` (the guide redraws).
 */

import type { MergeState } from '../types.js';
import type { MergePlan, PlanCounts, ScopeExample, WizardChoices } from '../plan.js';
import type { TreeId } from '../../types.js';
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
    /** Today's list of pairs (until step 2 of part A4 replaces it). */
    renderPairs?(host: HTMLElement): void;
    /** What step 1 reads and does beyond the choices (§3). */
    step1?: Step1Env;
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
    /** The chosen target is encrypted and locked: it can be compared only once unlocked (13f). */
    encLocked(): boolean;
    unlock(): void;
    /** The scope's options said on one person of the target (null: the general sentences). */
    example(): ScopeExample | null;
    /** The same source merged before (13c): the sentence, '' when not. */
    repeat(): string;
    /** "Save list…": the lines not taken over as a .txt file. */
    saveNotTaken(): void;
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
