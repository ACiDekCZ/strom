/**
 * Step 1 – What to do (spec 134 §3). The skeleton's stand-in body: what the
 * import is and where it goes; the choices (mode, target, scope) come with §3.
 */

import { strings } from '../../strings.js';
import type { StepContext } from './context.js';
import { escapeHtml, stepHeading } from './context.js';

export function renderStep1(host: HTMLElement, ctx: StepContext): void {
    const W = strings.mergeWizard;
    const c = ctx.choices;
    const target = c.mode === 'new' ? W.modeNew : W.modeAdd;
    const desc = c.mode === 'new'
        ? W.modeNewDesc(c.targetName, c.source.persons)
        : c.mode === 'compare' ? W.modeCompareDesc : W.modeAddDesc;
    host.innerHTML = `${stepHeading(1)}
        <div class="merge-step1">
            <div class="merge-step1-src"><b>${escapeHtml(c.source.label)}</b></div>
            <div class="merge-step1-mode"><span class="merge-step1-mode-name">${escapeHtml(target)}</span>${c.mode === 'new' ? '' : ` · ${escapeHtml(c.targetName)}`}</div>
            <p class="merge-step-note">${escapeHtml(desc)}</p>
        </div>`;
}
