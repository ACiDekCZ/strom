/**
 * Which steps of the import and merge guide (spec 134 §1) can be entered:
 * worked out from the choices and the plan only, no DOM.
 *
 * Short ways: a new tree goes 1 → (3) → 5 → 6 (steps 2 and 4 skipped);
 * scopes a) and b), where no differing detail of a joined person changes,
 * go without step 4 unless relations conflict (then step 4 shows only them).
 */

import type { MergePlan, WizardChoices } from './plan.js';
import { planNeedsStep4 } from './plan-rules.js';

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
export const WIZARD_STEPS: readonly WizardStep[] = [1, 2, 3, 4, 5, 6];

/** ok: can be entered; skip: left out on this way (with a reason); locked: not yet (an earlier step is not done). */
export type StepState = 'ok' | 'skip' | 'locked';

/**
 * Why a step is skipped, for its second line in the step list:
 * newTree "new tree", scope "skipped · scope a)" (or b), allNew "all new",
 * compare (nothing is written, no step 6).
 */
export type StepSkipReason = 'newTree' | 'scope' | 'allNew' | 'compare';

export interface StepInfo {
    state: StepState;
    reason?: StepSkipReason;
}

/** What step 4 shows for a plan (Only compare shows what adding would decide). */
export function step4Need(plan: Pick<MergePlan, 'mode' | 'scope' | 'items'>): ReturnType<typeof planNeedsStep4> {
    return planNeedsStep4(plan.mode === 'compare' ? { ...plan, mode: 'add' } : plan);
}

/** Each step's state and, when skipped, why. A null plan: the comparison has not run yet. */
export function stepInfo(choices: Pick<WizardChoices, 'mode' | 'scope' | 'pickPeople' | 'writtenAt'>, plan: MergePlan | null): Record<WizardStep, StepInfo> {
    const newTree = choices.mode === 'new';
    // Pairs left to decide hold up step 3 on; unlinked groups left to decide (§6), only what comes after step 3.
    const pending = plan ? plan.items.some(i => i.kind === 'person-pending') : false;
    const groupsPending = plan ? plan.items.some(i => i.kind === 'group-pending') : false;
    const ready = !!plan && !pending;
    const done = ready && !groupsPending;

    const step2: StepInfo = newTree ? { state: 'skip', reason: 'newTree' } : { state: plan ? 'ok' : 'locked' };

    // A new tree goes past step 3 with everybody ("all new") unless people are picked (step 5's "Choose people…").
    const step3: StepInfo = newTree && !choices.pickPeople ? { state: 'skip', reason: 'allNew' } : { state: ready ? 'ok' : 'locked' };

    let step4: StepInfo;
    if (newTree) step4 = { state: 'skip', reason: 'newTree' };
    else if ((choices.scope === 'a' || choices.scope === 'b') && (!plan || step4Need(plan) === 'skip')) step4 = { state: 'skip', reason: 'scope' };
    else step4 = { state: done ? 'ok' : 'locked' };

    const step6: StepInfo = choices.mode === 'compare'
        ? { state: 'skip', reason: 'compare' }
        : { state: choices.writtenAt ? 'ok' : 'locked' };

    return {
        1: { state: 'ok' },
        2: step2,
        3: step3,
        4: step4,
        5: { state: done ? 'ok' : 'locked' },
        6: step6,
    };
}

/** Each step's state (§1 `stepAvailability`). */
export function stepAvailability(choices: Pick<WizardChoices, 'mode' | 'scope' | 'pickPeople' | 'writtenAt'>, plan: MergePlan | null): Record<WizardStep, StepState> {
    const info = stepInfo(choices, plan);
    const out = {} as Record<WizardStep, StepState>;
    for (const s of WIZARD_STEPS) out[s] = info[s].state;
    return out;
}

/** The step after `from` on this way (skipped ones passed over; a locked one is still the next); null after the last. */
export function nextStep(from: WizardStep, availability: Record<WizardStep, StepState>): WizardStep | null {
    for (const s of WIZARD_STEPS) if (s > from && availability[s] !== 'skip') return s;
    return null;
}

/** The step before `from` on this way (skipped ones passed over); null before the first. */
export function previousStep(from: WizardStep, availability: Record<WizardStep, StepState>): WizardStep | null {
    for (let i = WIZARD_STEPS.length - 1; i >= 0; i--) {
        const s = WIZARD_STEPS[i];
        if (s < from && availability[s] !== 'skip') return s;
    }
    return null;
}
