/**
 * Which steps of the import and merge guide (spec 134 §1) can be entered:
 * worked out from the choices and the plan only, no DOM.
 *
 * Short ways: a new tree goes 1 → (3) → 5 → 6 (steps 2 and 4 skipped);
 * scope a) with no differing couples goes without step 4.
 */

import type { MergePlan, WizardChoices } from './plan.js';

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
export const WIZARD_STEPS: readonly WizardStep[] = [1, 2, 3, 4, 5, 6];

/** ok: can be entered; skip: left out on this way (with a reason); locked: not yet (an earlier step is not done). */
export type StepState = 'ok' | 'skip' | 'locked';

/**
 * Why a step is skipped, for its second line in the step list:
 * newTree "new tree", scopeA "skipped · scope a)", allNew "all new",
 * mineRule "my tree applies", compare (nothing is written, no step 6).
 */
export type StepSkipReason = 'newTree' | 'scopeA' | 'allNew' | 'mineRule' | 'compare';

export interface StepInfo {
    state: StepState;
    reason?: StepSkipReason;
}

/**
 * Steps 3 (Whom to add) and 4 (Who is right) are not built yet (parts B and
 * C): until steps 3/4 exist, they are always skipped (3 "all new", 4 "my tree
 * applies"). Part B turns this off.
 */
export const STEPS_3_4_PENDING = true;

/** Each step's state and, when skipped, why. A null plan: the comparison has not run yet. */
export function stepInfo(choices: Pick<WizardChoices, 'mode' | 'scope' | 'pickPeople' | 'writtenAt'>, plan: MergePlan | null): Record<WizardStep, StepInfo> {
    const newTree = choices.mode === 'new';
    const pending = plan ? plan.items.some(i => i.kind === 'person-pending') : false;
    const ready = !!plan && !pending;

    const step2: StepInfo = newTree ? { state: 'skip', reason: 'newTree' } : { state: plan ? 'ok' : 'locked' };

    let step3: StepInfo;
    if (STEPS_3_4_PENDING) step3 = { state: 'skip', reason: 'allNew' };
    else if (newTree && !choices.pickPeople) step3 = { state: 'skip', reason: 'allNew' };
    else step3 = { state: ready ? 'ok' : 'locked' };

    let step4: StepInfo;
    if (newTree) step4 = { state: 'skip', reason: 'newTree' };
    else if (STEPS_3_4_PENDING) step4 = { state: 'skip', reason: 'mineRule' };
    else if (choices.scope === 'a' && (!plan || plan.conflicts.unions === 0)) step4 = { state: 'skip', reason: 'scopeA' };
    else step4 = { state: ready ? 'ok' : 'locked' };

    const step6: StepInfo = choices.mode === 'compare'
        ? { state: 'skip', reason: 'compare' }
        : { state: choices.writtenAt ? 'ok' : 'locked' };

    return {
        1: { state: 'ok' },
        2: step2,
        3: step3,
        4: step4,
        5: { state: ready ? 'ok' : 'locked' },
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
