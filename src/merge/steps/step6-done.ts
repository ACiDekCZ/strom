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
import type { MergeRecord } from '../../types.js';
import type { Step6Env, Step6Research, StepContext } from './context.js';
import { escapeHtml, glyph } from './context.js';
import { renderPlanListReadOnly } from './step5-plan.js';
import { researchLinkMark } from '../../research-link.js';
import { researchActionLabel } from '../../ui/research-open-mark.js';

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
    renderDone(host, env, list => renderPlanListReadOnly(list, ctx), {
        title: W.doneTitle(env.treeName),
        notes: [W.inHistory, ...(env.noNextCard ? [W.noNextCard] : [])],
    });
}

/** What the done view says around the record: its title, a state tag (the history's record), the side notes. */
export interface DoneHead {
    title: string;
    /** The record's state as the Merge history tags it (9b); none in the guide. */
    tag?: { text: string; state: MergeRecord['state'] };
    notes: readonly string[];
}

/**
 * Step 6's body (§9): the head with when, the totals, the actions, the list
 * (`fillList` draws it into its place) and the side column with the
 * research's place. The guide's step 6 and the Merge history's record (9b)
 * draw the same.
 */
export function renderDone(host: HTMLElement, env: Step6Env, fillList: (list: HTMLElement) => void, head: DoneHead): void {
    const W = strings.mergeWizard;
    const r = env.record;
    const c = r.counts;
    const when = writtenWhen(r.at);
    const bt = (act: string, label: string, icon = ''): string =>
        `<button type="button" class="secondary merge-s6-act" data-act="${act}">${icon}<span>${escapeHtml(label)}</span></button>`;
    const tag = head.tag ? `<span class="merge-state-tag" data-state="${head.tag.state}">${escapeHtml(head.tag.text)}</span>` : '';
    host.innerHTML = `<div class="merge-s6">
  <div class="merge-s6-main">
    <div class="merge-s6-head">
      <span class="merge-s6-ok" aria-hidden="true">${glyph('joined', 16)}</span>
      <h3 class="merge-step-title" tabindex="-1" data-step-title="6">${escapeHtml(head.title)}</h3>
      ${when ? `<span class="merge-s6-at">${escapeHtml(when)}</span>` : ''}${tag}
    </div>
    <p class="merge-s6-totals">${escapeHtml(W.doneTotals(c.total, c.joined, c.added, c.skipped))}${r.backupId ? ` ${escapeHtml(W.doneBackup)}` : ''}</p>
    <div class="merge-s6-acts">
      ${bt('show', W.showInTree, EYE)}${bt('list', W.saveAsList)}${bt('check', W.checkTree)}${env.intoExisting ? bt('undo', W.undoMerge, UNDO) : ''}
    </div>
    <div class="merge-s6-list"></div>
  </div>
  <div class="merge-s6-side">
    <div class="merge-s6-research" hidden></div>
    ${head.notes.map(n => `<p class="merge-s6-note">${escapeHtml(n)}</p>`).join('\n    ')}
  </div>
</div>`;
    fillList(host.querySelector<HTMLElement>('.merge-s6-list')!);
    renderResearch(host.querySelector<HTMLElement>('.merge-s6-research')!, env);
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

/**
 * The block "Research {t}" (§11): what the merge left in the app, Send to
 * the research… (What will be sent, 11a) and Keep in the app for now; an
 * agent at work (11d) or an older research (11e) said under it. Kept: the
 * block folds to the state the tree keeps saying. No mark on either action
 * (11i: in the app or through the bridge, no agent, no terminal), except
 * Send to an older research: its terminal takes the tree.
 */
function renderResearch(box: HTMLElement, env: Step6Env): void {
    const res: Step6Research | undefined = env.research;
    box.hidden = !res;
    if (!res) {
        box.innerHTML = '';
        return;
    }
    const W = strings.mergeWizard;
    const note = res.old !== null ? W.resOld(res.old) : res.agent !== null ? W.resAgent(res.agent, '') : '';
    // An older research takes the tree through its terminal (the research's send link): its mark then.
    const sendLabel = res.old !== null ? researchActionLabel(W.sendRes, researchLinkMark('send')) : escapeHtml(W.sendRes);
    const send = `<button type="button" class="secondary merge-s6-ract" data-ract="send">${sendLabel}</button>`;
    box.classList.toggle('is-kept', res.kept);
    box.innerHTML = `<h4 class="merge-s6-rhead">${escapeHtml(W.resBlock(env.treeName))}</h4>`
        + (res.kept
            ? `<p class="merge-s6-rtext">${escapeHtml(W.notSent(res.persons))}</p><div class="merge-s6-racts">${send}</div>`
            : `<p class="merge-s6-rtext">${escapeHtml(W.resPending(res.persons, res.links))}</p>`
                + (note ? `<p class="merge-s6-rtext merge-s6-rnote">${escapeHtml(note)}</p>` : '')
                + `<div class="merge-s6-racts">${send}<button type="button" class="secondary merge-s6-ract" data-ract="keep">${escapeHtml(W.keepLocal)}</button></div>`);
    box.onclick = e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-ract]');
        if (b?.dataset.ract === 'send') res.send();
        else if (b?.dataset.ract === 'keep') res.keepLocal();
    };
}
