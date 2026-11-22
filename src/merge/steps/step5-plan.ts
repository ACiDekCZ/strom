/**
 * Step 5 – What will happen (spec 134 §8). The interim screen of part A:
 * the counts (in the guide's row of counts), one sentence of what the button
 * does, the button with the result. The write goes into a NEW tree
 * ("{target} + {source}"), the target stays unchanged; a comparison writes
 * nothing. The full list of the plan comes with §8.
 */

import { strings } from '../../strings.js';
import type { StepContext } from './context.js';
import { escapeHtml, stepHeading } from './context.js';
import { newTreeName } from '../write.js';
import { isCopyOfTarget } from './step2-who.js';

/** The interim step's sentences (what the button does). */
export function step5Lines(ctx: Pick<StepContext, 'plan' | 'counts' | 'choices'>): string[] {
    const W = strings.mergeWizard;
    const plan = ctx.plan;
    if (!plan || !ctx.counts) return [];
    // A copy of the tree (13b): nothing to write.
    if (isCopyOfTarget(ctx)) return [W.sameAsTarget(ctx.counts.total, ctx.choices.targetName)];
    if (plan.mode === 'add') return [W.writeNewDesc(plan.target.name), W.newTreeNamed(newTreeName(plan))];
    if (plan.mode === 'new') return [W.modeNewDesc(newTreeName(plan), ctx.counts.added)];
    return [W.modeCompareDesc];
}

export function renderStep5(host: HTMLElement, ctx: StepContext): void {
    host.innerHTML = stepHeading(5, strings.mergeWizard.planTitle)
        + step5Lines(ctx).map(l => `<p class="merge-step-note">${escapeHtml(l)}</p>`).join('');
}
