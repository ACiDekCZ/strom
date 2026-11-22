/**
 * Step 2 – Who is who (spec 134 §4). Until §4 is built, today's list of pairs
 * (with its filter, the decisions and their dialogs) stands in its place,
 * so pairs can still be decided.
 */

import type { StepContext } from './context.js';
import { stepHeading } from './context.js';

export function renderStep2(host: HTMLElement, ctx: StepContext): void {
    host.innerHTML = `${stepHeading(2)}<div class="merge-step2"></div>`;
    const list = host.querySelector<HTMLElement>('.merge-step2');
    if (list && ctx.renderPairs) ctx.renderPairs(list);
}
