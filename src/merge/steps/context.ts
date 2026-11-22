/**
 * What a step of the import guide gets to draw its body (spec 134 §0.4):
 * the choices, the plan and its counts, the merge state. The step keeps no
 * state of its own; a change goes through `update` (the guide redraws).
 */

import type { MergeState } from '../types.js';
import type { MergePlan, PlanCounts, WizardChoices } from '../plan.js';
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
