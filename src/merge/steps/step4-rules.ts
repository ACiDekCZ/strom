/**
 * Step 4 – Who is right (spec 134 §7, part B). Skipped until it is built
 * (the tree's value stays everywhere); the stand-in body says so.
 */

import { strings } from '../../strings.js';
import type { StepContext } from './context.js';
import { escapeHtml, stepHeading } from './context.js';

export function renderStep4(host: HTMLElement, _ctx: StepContext): void {
    host.innerHTML = `${stepHeading(4)}<p class="merge-step-note">${escapeHtml(strings.mergeWizard.subMineRule)}</p>`;
}
