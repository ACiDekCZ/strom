/**
 * Step 3 – Whom to add (spec 134 §5, part B). Skipped until it is built
 * (all new); the stand-in body says so.
 */

import { strings } from '../../strings.js';
import type { StepContext } from './context.js';
import { escapeHtml, stepHeading } from './context.js';

export function renderStep3(host: HTMLElement, _ctx: StepContext): void {
    host.innerHTML = `${stepHeading(3)}<p class="merge-step-note">${escapeHtml(strings.mergeWizard.subAllNew)}</p>`;
}
