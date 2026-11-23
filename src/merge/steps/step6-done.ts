/**
 * Step 6 – What happened (spec 134 §9, frames 6, 14a–14k).
 *
 * Shown once the write landed: the check mark with "Written into the tree
 * {t}" and when, the totals of the merge's record (the backup line when one
 * was made), the actions (Show in the tree, Save as a list of people, Check
 * the tree, Undo the merge… for a tree that was there) and step 5's list
 * read only, with its search (K7.3). At the right: the place of the
 * research's block (filled by the research part) and where the merge stays
 * (the tree's merge history). The steps before cannot be opened any more;
 * Done (or Esc) closes the guide.
 */

import { strings, getCurrentLanguage } from '../../strings.js';
import { formatDateTime } from '../../format.js';
import type { StepContext } from './context.js';
import { escapeHtml, glyph } from './context.js';
import { renderPlanListReadOnly } from './step5-plan.js';

const EYE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const UNDO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>';

/** When the merge was written, as the language writes a day with its year and the time. */
export function writtenWhen(at: string): string {
    const ts = Date.parse(at);
    return Number.isFinite(ts) ? formatDateTime(ts, getCurrentLanguage()) : '';
}

export function renderStep6(host: HTMLElement, ctx: StepContext): void {
    const env = ctx.step6;
    if (!env) {
        host.innerHTML = '';
        return;
    }
    const W = strings.mergeWizard;
    const r = env.record;
    const c = r.counts;
    const when = writtenWhen(r.at);
    const bt = (act: string, label: string, icon = ''): string =>
        `<button type="button" class="secondary merge-s6-act" data-act="${act}">${icon}<span>${escapeHtml(label)}</span></button>`;
    host.innerHTML = `<div class="merge-s6">
  <div class="merge-s6-main">
    <div class="merge-s6-head">
      <span class="merge-s6-ok" aria-hidden="true">${glyph('joined', 16)}</span>
      <h3 class="merge-step-title" tabindex="-1" data-step-title="6">${escapeHtml(W.doneTitle(env.treeName))}</h3>
      ${when ? `<span class="merge-s6-at">${escapeHtml(when)}</span>` : ''}
    </div>
    <p class="merge-s6-totals">${escapeHtml(W.doneTotals(c.total, c.joined, c.added, c.skipped))}${r.backupId ? ` ${escapeHtml(W.doneBackup)}` : ''}</p>
    <div class="merge-s6-acts">
      ${bt('show', W.showInTree, EYE)}${bt('list', W.saveAsList)}${bt('check', W.checkTree)}${env.intoExisting ? bt('undo', W.undoMerge, UNDO) : ''}
    </div>
    <div class="merge-s6-list"></div>
  </div>
  <div class="merge-s6-side">
    <div class="merge-s6-research" hidden></div>
    <p class="merge-s6-note">${escapeHtml(W.inHistory)}</p>
    ${env.noNextCard ? `<p class="merge-s6-note">${escapeHtml(W.noNextCard)}</p>` : ''}
  </div>
</div>`;
    renderPlanListReadOnly(host.querySelector<HTMLElement>('.merge-s6-list')!, ctx);
    host.querySelector('.merge-s6-acts')!.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
        switch (b?.dataset.act) {
            case 'show': env.showInTree(); break;
            case 'list': env.saveAsList(); break;
            case 'check': env.checkTree(); break;
            case 'undo': env.undoMerge(); break;
        }
    });
}
