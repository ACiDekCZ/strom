/**
 * "Source read again", the footer that says who creates the task (spec 059, `read.sourceTask`): the state from
 * what the research says, and its HTML. Plain data in, HTML out; the dialog wires the actions (`data-act`).
 */

import { strings } from '../strings.js';
import { researchLinkMark } from '../research-link.js';
import { researchActionLabel, researchBridgeAgentLabel } from './research-open-mark.js';
import type { ReadTaskFor, ReadTaskHow, ReadTaskReply, ReadTaskSetting } from '../research-read-task.js';
import type { VerdictSorted } from '../read-result.js';

/**
 * The footer's states (frames of the design): `A` the choices, `append` the choices for the source's open task,
 * `B` no sure change (only minor, uncertain or assessed places), `C` created by the setting "always", `D` the
 * setting "never", `E` the transcript confirmed (a person reviews), `decided` chosen before (opened again),
 * `phone` the choices where the bridge is not reached, `F` after a choice (busy, done, failed).
 */
export type ReadTaskFootState = 'A' | 'append' | 'B' | 'C' | 'D' | 'E' | 'decided' | 'phone' | 'F';

/** A choice made in the footer: on its way, answered or failed. */
export interface ReadTaskAct {
    how: ReadTaskHow;
    /** Chosen from the open task's choices (the places are added to it). */
    append: boolean;
    busy: boolean;
    reply?: ReadTaskReply;
    failed?: boolean;
}

export interface ReadTaskFootInput {
    setting: ReadTaskSetting;
    offer: boolean;
    /** The task the research made ('' none). */
    task: string;
    taskFor?: ReadTaskFor;
    decided?: 'saved';
    openTask?: string;
    /** A person confirmed the source's transcript. */
    confirmed: boolean;
    /** On a computer (the bridge reached); false: a phone. */
    computer: boolean;
    /** The sorted groups' counts (`sortedCounts`): `major` is the task's places. */
    counts: VerdictSorted;
    /** A task opens in the research's terminal from here. */
    canOpenTask: boolean;
    act?: ReadTaskAct | null;
}

/** The footer's state; null: the research said nothing usable (the footer as before the feature). */
export function readTaskFootState(i: ReadTaskFootInput): ReadTaskFootState | null {
    if (i.act) return 'F';
    if (i.setting === 'never') return 'D';
    if (!i.offer) return 'B';
    if (i.setting === 'always') return i.task ? 'C' : null;
    if (i.task || i.decided === 'saved') return 'decided';
    if (!i.computer) return 'phone';
    if (i.confirmed) return 'E';
    return i.openTask ? 'append' : 'A';
}

/** The sentence under the sure changes in "To check" for a state ('' none). */
export function readTaskMajorNote(state: ReadTaskFootState | null, i: Pick<ReadTaskFootInput, 'task' | 'openTask' | 'act' | 'confirmed' | 'taskFor'>): string {
    const t = strings.read;
    const reply = i.act?.reply?.task || i.task;
    if (state === 'C' || state === 'decided') return reply ? t.cMajTask(reply) : '';
    if (state === 'F' && i.act?.reply && i.act.how !== 'save') return reply ? t.cMajTask(reply) : '';
    if (state === 'append' || (state === 'F' && i.act?.append && i.openTask)) return t.cMajAppend(i.openTask ?? '');
    if (state === 'E' || (state === 'F' && i.act?.how === 'review')) return t.cMajPerson;
    if (state === 'A' || state === 'phone' || state === 'F') return t.cMajNote;
    return '';
}

/** A person reviews the changes (the transcript confirmed, or the task is a person's). */
export function readTaskForPerson(i: Pick<ReadTaskFootInput, 'confirmed' | 'taskFor'>): boolean {
    return i.confirmed || i.taskFor === 'person';
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A choice's label with its mark: now = the agent badge and the terminal mark, queue = the agent badge alone (through the bridge), save and review none. */
function choiceLabel(how: ReadTaskHow, label: string): string {
    if (how === 'now') return researchActionLabel(label, researchLinkMark('task', { taskDo: 'chat' }));
    if (how === 'queue') return researchBridgeAgentLabel(label);
    return esc(label);
}

interface Choice { how: ReadTaskHow; title: string; sub: string; short?: string }

function choiceHtml(c: Choice, act: ReadTaskAct | null | undefined): string {
    const t = strings.read;
    const busy = !!act?.busy && act.how === c.how;
    const off = !!act?.busy;
    const title = busy
        ? `<span class="read-task-spin" aria-hidden="true"></span>${esc(c.how === 'save' ? t.tBusySave : t.tBusy)}`
        : choiceLabel(c.how, c.title);
    const sub = c.short
        ? `<span class="read-task-cs"><span class="read-task-long">${esc(c.sub)}</span><span class="read-task-short">${esc(c.short)}</span></span>`
        : `<span class="read-task-cs read-task-long">${esc(c.sub)}</span>`;
    return `<button type="button" class="read-task-choice" data-act="task-${c.how}"${busy ? ' aria-busy="true"' : ''}${off ? ' disabled' : ''}>`
        + `<span class="read-task-ct">${title}</span>${sub}</button>`;
}

function groupHtml(key: string, name: string, count: string, notes: string[], choices: Choice[], act: ReadTaskAct | null | undefined): string {
    const legend = `<legend><span class="read-task-gname">${esc(name)}</span>${count ? `<span class="read-task-gcount"> · ${esc(count)}</span>` : ''}</legend>`;
    return `<fieldset class="read-task-group" data-group="${key}">${legend}${notes.join('')}`
        + `<div class="read-task-row">${choices.map(c => choiceHtml(c, act)).join('')}</div></fieldset>`;
}

/** The choices of states A, append and E (and while one is on its way). */
function choicesHtml(state: 'A' | 'append' | 'E', i: ReadTaskFootInput): string {
    const t = strings.read;
    const n = i.counts.major;
    const save: Choice = { how: 'save', title: t.tSave, sub: t.tSaveSub, short: t.tSaveShort };
    const none = groupHtml('none', t.tNone, '', [], [save], i.act);
    if (state === 'E') {
        const person = groupHtml('person', t.tPerson, t.tPersonN(n), [`<p class="read-task-gnote">${esc(t.tPersonNote)}</p>`],
            [{ how: 'review', title: t.tReview, sub: t.tReviewSub }], i.act);
        return `<div class="read-task-choices is-even">${person}${none}</div>`;
    }
    const open = state === 'append' ? i.openTask ?? '' : '';
    const notes = [
        `<p class="read-task-gnote"><span class="read-task-long">${esc(t.tAgentNote)}</span><span class="read-task-short">${esc(t.tAgentShort)}</span></p>`,
        ...(open ? [`<p class="read-task-gnote read-task-append">${esc(t.tAppendNote(open))}</p>`] : []),
    ];
    const agent: Choice[] = open
        ? [{ how: 'now', title: t.tAppendNow(open), sub: t.tAppendNowSub(open) }, { how: 'queue', title: t.tAppendQueue(open), sub: t.tAppendQueueSub(open) }]
        : [{ how: 'now', title: t.tNow, sub: t.tNowSub }, { how: 'queue', title: t.tQueue, sub: t.tQueueSub }];
    return `<div class="read-task-choices">${groupHtml('agent', t.tAgent, t.tAgentN(n), notes, agent, i.act)}${none}</div>`;
}

type Icon = 'ok' | 'save' | 'err' | 'info' | 'open';
const ICON_TEXT: Record<Icon, string> = { ok: '✓', save: '✓', err: '!', info: 'i', open: '?' };

function statusHtml(icon: Icon, t1: string, t2: string, link = ''): string {
    return `<div class="read-task-status" role="status" aria-live="polite">`
        + `<span class="read-task-icon is-${icon}" aria-hidden="true"><span>${ICON_TEXT[icon]}</span></span>`
        + `<div class="read-task-msg"><p class="read-task-t1">${esc(t1)}</p>${t2 || link ? `<p class="read-task-t2">${esc(t2)}${t2 && link ? ' ' : ''}${link}</p>` : ''}</div></div>`;
}

function openTaskBtn(task: string, primary: boolean): string {
    return `<button type="button" class="${primary ? 'primary' : 'secondary'}" data-act="open-task" data-task="${esc(task)}">${researchActionLabel(strings.read.openTaskN(task), researchLinkMark('task'))}</button>`;
}

function closeBtn(primary: boolean): string {
    return `<button type="button" class="${primary ? 'primary' : 'secondary'}" data-act="close">${esc(strings.read.close)}</button>`;
}

function taskLink(task: string): string {
    return `<button type="button" class="read-link read-task-link" data-act="open-task" data-task="${esc(task)}">${researchActionLabel(strings.read.tTaskLink(task), researchLinkMark('task'))}</button>`;
}

function settingsLink(): string {
    return `<button type="button" class="read-link read-task-link" data-act="open-settings">${esc(strings.read.tSettingsLink)}</button>`;
}

function foot(state: ReadTaskFootState, inner: string, actions: string): string {
    return `<div class="read-task-foot" data-task-state="${state}">${inner}${actions ? `<div class="read-task-actions">${actions}</div>` : ''}</div>`;
}

/** The answer to a choice (or a decision made before): what was made, and the task to open. */
function doneHtml(how: ReadTaskHow, append: boolean, task: string, i: ReadTaskFootInput, state: ReadTaskFootState): string {
    const t = strings.read;
    const open = task && i.canOpenTask;
    const actions = (task ? open ? openTaskBtn(task, false) : '' : '') + closeBtn(true);
    if (how === 'save') return foot(state, statusHtml('save', t.tDoneSave, t.tDoneSave2), closeBtn(true));
    if (append && task) return foot(state, statusHtml('ok', t.tDoneAppend(task), how === 'now' ? t.tDoneNow : ''), actions);
    if (how === 'review') return foot(state, statusHtml('ok', t.tDoneReview(task), t.tDoneReview2), actions);
    if (how === 'now') return foot(state, statusHtml('ok', t.tDoneAgent(task), t.tDoneNow), actions);
    return foot(state, statusHtml('ok', t.tDoneQueue(task), t.tDoneQueue2), actions);
}

/** Retry: the label and mark of the choice it repeats. */
function retryBtn(how: ReadTaskHow): string {
    const t = strings.read;
    return `<button type="button" class="primary" data-act="task-retry" data-how="${how}">${choiceLabel(how, t.tRetry)}</button>`;
}

/** The footer's HTML for a state ('' for null: the caller draws the footer as before). */
export function readTaskFootHtml(i: ReadTaskFootInput): string {
    const t = strings.read;
    const state = readTaskFootState(i);
    if (!state) return '';
    switch (state) {
        case 'A': case 'append': case 'E':
            return foot(state, choicesHtml(state, i), '');
        case 'phone':
            return foot(state, statusHtml('open', t.tPhone(i.counts.major), ''), '');
        case 'B': {
            const judged = i.counts.judged.find(j => j.n > 0);
            if (judged) return foot(state, statusHtml('info', t.tAllJudged(judged.task), '', i.canOpenTask ? taskLink(judged.task) : ''), closeBtn(true));
            if (i.counts.unsure > 0) return foot(state, statusHtml('info', t.tOnlyUnsure(i.counts.unsure), ''), closeBtn(true));
            return foot(state, statusHtml('info', t.tOnlyMinor, ''), closeBtn(true));
        }
        case 'C': {
            const person = i.taskFor === 'person';
            const open = i.canOpenTask;
            return foot(state, statusHtml('ok', person ? t.tAlwaysPerson(i.task) : t.tAlways(i.task), '', settingsLink()),
                closeBtn(!open) + (open ? openTaskBtn(i.task, true) : ''));
        }
        case 'D':
            return foot(state, statusHtml('save', t.tNever, t.tNever2, settingsLink()), closeBtn(true));
        case 'decided':
            // Chosen before: what became of it, without how it was chosen.
            if (!i.task) return doneHtml('save', false, '', i, state);
            if (i.taskFor === 'person') return doneHtml('review', false, i.task, i, state);
            return foot(state, statusHtml('ok', t.tDoneAgent(i.task), ''), (i.canOpenTask ? openTaskBtn(i.task, false) : '') + closeBtn(true));
        case 'F': {
            const act = i.act!;
            if (act.busy) {
                // The choices stay (the chosen one busy, the others off): the footer keeps its height.
                const shown = i.confirmed ? 'E' : act.append && i.openTask ? 'append' : 'A';
                return foot(state, choicesHtml(shown, i), '');
            }
            if (act.failed || !act.reply) return foot(state, statusHtml('err', t.tFail, t.tFail2), closeBtn(false) + retryBtn(act.how));
            const task = act.reply.task || (act.append ? i.openTask ?? '' : '');
            if (act.how !== 'save' && !task) return foot(state, statusHtml('err', t.tFail, t.tFail2), closeBtn(false) + retryBtn(act.how));
            return doneHtml(act.how, act.append || act.reply.appended, task, i, state);
        }
    }
}
