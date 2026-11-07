/**
 * The source viewer after a newer reading (spec 059 §2, §3): the source's
 * state in the research (`/status.readAgain[S]`) as one quiet row with its
 * choices, and the agent's proposal for a transcript a person confirmed.
 * Plain data in, HTML out; the viewer wires the actions (`data-read-state`,
 * `data-read-how`, `data-proposal-act`, `data-proposal-take`).
 */

import { strings } from '../strings.js';
import { researchLinkMark } from '../research-link.js';
import { researchActionLabel, researchBridgeAgentLabel } from './research-open-mark.js';
import { compareWithTranscript, readerPlaces, transcriptLines, variantClass, locateSpan } from '../read-result.js';
import { changeWhatHtml, kindText } from './read-result-view.js';
import type { ReadProposalTake, ReadSourceProposal, ReadSourceState, ReadTaskHow } from '../research-read-task.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Dates ----

/** "7. 11." (cs, de), "7.11." (pl), "7 Nov" (en): the day of a newer reading. */
export function readStateShortDate(at: Date, lang: string): string {
    if (Number.isNaN(at.getTime())) return '';
    const d = at.getDate(), m = at.getMonth() + 1;
    if (lang === 'en') return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return lang === 'pl' ? `${d}.${m}.` : `${d}. ${m}.`;
}

/** "8. 11. 2026" (cs, de), "8.11.2026" (pl), "8 Nov 2026" (en). */
export function readStateLongDate(at: Date, lang: string): string {
    if (Number.isNaN(at.getTime())) return '';
    const d = at.getDate(), m = at.getMonth() + 1, y = at.getFullYear();
    if (lang === 'en') return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return lang === 'pl' ? `${d}.${m}.${y}` : `${d}. ${m}. ${y}`;
}

/** The day a reading was made, from its id (`D20261107093000-ab12`); null: not an id. */
export function readIdDate(id: string): Date | null {
    const m = /^D(\d{4})(\d{2})(\d{2})\d{6}-[0-9a-f]{4}$/.exec(id);
    if (!m) return null;
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(at.getTime()) ? null : at;
}

// ---- §2 The source's row ----

/** What the row says: the research's state, with the task's kind and the details that make it quiet. */
export type SourceRowKind = 'unchecked' | 'saved' | 'queued' | 'chat' | 'done' | 'person' | 'minor' | 'unsure';

/**
 * The row's kind: a task for a person, a closed task, a queued one, an open one not in the queue (a conversation:
 * "Check now" opens one); saved as the person said, or only minor details or uncertain places.
 */
export function sourceRowKind(s: Pick<ReadSourceState, 'state' | 'taskFor' | 'taskOpen' | 'taskQueued' | 'minorOnly' | 'unsureOnly'>): SourceRowKind {
    if (s.state === 'task') {
        if (s.taskFor === 'person') return 'person';
        if (!s.taskOpen) return 'done';
        return s.taskQueued ? 'queued' : 'chat';
    }
    if (s.state === 'saved') return s.minorOnly ? 'minor' : s.unsureOnly ? 'unsure' : 'saved';
    return 'unchecked';
}

type Icon = 'open' | 'save' | 'task' | 'done' | 'none';
const ICON_OF: Record<SourceRowKind, Icon> = {
    unchecked: 'open', saved: 'save', queued: 'task', chat: 'task', person: 'task', done: 'done', minor: 'none', unsure: 'none',
};
const ICON_TEXT: Record<Icon, string> = { open: '?', save: '✓', task: '…', done: '✓', none: '–' };

function iconHtml(icon: Icon, cls = 'viewer-read-state-icon'): string {
    return `<span class="${cls} is-${icon}" aria-hidden="true"><span>${ICON_TEXT[icon]}</span></span>`;
}

/** A choice made at the row: on its way, or failed (a done one shows as the research's new state). */
export interface SourceRowAct { how: ReadTaskHow; busy: boolean; failed?: boolean }

export interface SourceRowInput {
    state: ReadSourceState;
    /** The newer reading's day, as said ("7. 11."). */
    date: string;
    /** The reading's counts (sure substantive changes, uncertain places); null: not known here. */
    counts: { major: number; unsure: number } | null;
    /** A person confirmed the transcript: a person reviews, the agent never changes it. */
    confirmed: boolean;
    /** A phone (touch): the state, and a sentence where deciding works instead of the choices. */
    phone: boolean;
    /** The research's bridge answers: choices and the result work. */
    bridgeUp: boolean;
    /** The research's terminal link for a task is offered here. */
    canOpenTask: boolean;
    /** The choices are open. */
    open: boolean;
    act?: SourceRowAct | null;
}

interface RowChoice { how: ReadTaskHow; label: string }

/** The choices the row offers (none: the row only says the state). */
export function sourceRowChoices(kind: SourceRowKind, confirmed: boolean): { toggle: 'decide' | 'give'; choices: RowChoice[]; note: string } | null {
    const t = strings.read;
    if (kind === 'unchecked') {
        return confirmed
            ? { toggle: 'decide', choices: [{ how: 'review', label: t.tReview }, { how: 'save', label: t.tSave }], note: t.sNoteConf }
            : { toggle: 'decide', choices: [{ how: 'now', label: t.tNow }, { how: 'queue', label: t.tQueue }, { how: 'save', label: t.tSave }], note: t.sNoteUn };
    }
    // A confirmed transcript saved: the agent never takes it (now/queue are refused there).
    if (kind === 'saved' && !confirmed) {
        return { toggle: 'give', choices: [{ how: 'now', label: t.tNow }, { how: 'queue', label: t.tQueue }], note: t.sNoteSaved };
    }
    return null;
}

function rowSentence(kind: SourceRowKind, s: ReadSourceState, d: string, counts: SourceRowInput['counts']): string {
    const t = strings.read;
    const task = s.task ?? '';
    switch (kind) {
        case 'unchecked': return counts && counts.major > 0 ? t.sUnchecked(d, counts.major) : t.sUncheckedAny(d);
        case 'saved': return t.sSaved(d);
        case 'queued': return t.sTaskQueued(d, task);
        case 'chat': return t.sTaskChat(d, task);
        case 'done': return t.sTaskDone(d, task);
        case 'person': return t.sTaskPerson(d, task);
        case 'minor': return t.sMinor(d);
        case 'unsure': return counts && counts.unsure > 0 ? t.sUnsure(d, counts.unsure) : t.sUnsureAny(d);
    }
}

function choiceLabel(how: ReadTaskHow, label: string): string {
    if (how === 'now') return researchActionLabel(label, researchLinkMark('task', { taskDo: 'chat' }));
    if (how === 'queue') return researchBridgeAgentLabel(label);
    return esc(label);
}

/** The row under the transcript's links: `<div class="viewer-read-state" data-state>`. */
export function sourceRowHtml(o: SourceRowInput): string {
    const t = strings.read;
    const kind = sourceRowKind(o.state);
    const offer = sourceRowChoices(kind, o.confirmed);
    const result = o.bridgeUp
        ? `<button type="button" class="link-button viewer-read-state-result" data-read-again-open="${esc(o.state.read)}">${esc(t.againResultLink)}</button>` : '';
    const task = o.state.task ?? '';
    const openTask = task && o.canOpenTask && (kind === 'queued' || kind === 'chat' || kind === 'person')
        ? `<button type="button" class="link-button viewer-read-state-task" data-read-state="task" data-task="${esc(task)}">${researchActionLabel(t.openTaskN(task), researchLinkMark('task'))}</button>` : '';
    const choosing = !!offer && !o.phone && o.bridgeUp;
    const open = choosing && (o.open || !!o.act);
    const toggle = choosing
        ? `<button type="button" class="link-button viewer-read-state-toggle${offer!.toggle === 'decide' ? ' is-decide' : ''}" data-read-state="toggle" aria-expanded="${open}">`
          + `${esc(offer!.toggle === 'decide' ? t.sDecide : t.sGiveAgent)} <span class="viewer-read-state-caret" aria-hidden="true">${open ? '▾' : '▸'}</span></button>` : '';
    const links = (offer?.toggle === 'decide' ? [toggle, result] : kind === 'saved' ? [result, toggle] : [openTask, result]).filter(Boolean);
    const linksHtml = links.length
        ? `<p class="viewer-read-state-links">${links.join('<span class="viewer-read-state-dot" aria-hidden="true"> · </span>')}</p>` : '';
    const phone = offer && o.phone ? `<p class="viewer-read-state-phone">${esc(t.sPhone)}</p>` : '';
    let opts = '';
    if (open && offer) {
        const busy = !!o.act?.busy;
        const choice = (c: RowChoice): string => {
            const on = busy && o.act!.how === c.how;
            const label = on
                ? `<span class="read-task-spin" aria-hidden="true"></span>${esc(c.how === 'save' ? t.tBusySave : t.tBusy)}`
                : choiceLabel(c.how, c.label);
            return `<button type="button" class="link-button viewer-read-state-choice${on ? ' is-busy' : ''}" data-read-how="${c.how}"${busy ? ' disabled' : ''}${on ? ' aria-busy="true"' : ''}>${label}</button>`;
        };
        opts = `<div class="viewer-read-state-opts" id="source-viewer-read-state-opts">`
            + `<div class="viewer-read-state-choices">${offer.choices.map(choice).join('')}</div>`
            + `<p class="viewer-read-state-note">${esc(offer.note)}</p>`
            + (o.act?.failed && !busy ? `<p class="viewer-read-state-fail" role="alert">${esc(t.tFail)}</p>` : '')
            + `</div>`;
    }
    return `<div class="viewer-read-state${kind === 'unchecked' ? ' is-open' : ''}" id="source-viewer-read-state" data-state="${kind}" role="status" aria-live="polite">`
        + iconHtml(ICON_OF[kind])
        + `<div class="viewer-read-state-body"><p class="viewer-read-state-text">${esc(rowSentence(kind, o.state, o.date, o.counts))}</p>${linksHtml}${phone}${opts}</div></div>`;
}

// ---- §3 The agent's proposal ----

/** One changed place of the proposal against the confirmed transcript. */
export interface ProposalPlace {
    /** The transcript's line (0-based); -1: not found in a line. */
    line: number;
    before: string;
    old: string;
    new: string;
    after: string;
    kind: string;
}

const lastWord = (s: string): string => s.trimEnd().split(/\s+/).filter(Boolean).pop() ?? '';
const firstWord = (s: string): string => s.trimStart().split(/\s+/).filter(Boolean)[0] ?? '';

/** The proposal's places: as the research lists them, else counted here against the confirmed transcript. */
export function proposalPlaces(transcript: string, p: Pick<ReadSourceProposal, 'text' | 'places'>): ProposalPlace[] {
    const lines = transcriptLines(transcript);
    const vk = strings.read.vk as Record<string, string>;
    if (p.places) {
        return p.places.map(x => {
            const j = x.old ? lines.findIndex(l => locateSpan(l, x.old) !== null) : -1;
            const span = j >= 0 ? locateSpan(lines[j], x.old) : null;
            return {
                line: j, old: x.old, new: x.new, kind: x.kind ? vk[x.kind] ?? x.kind : '',
                before: span ? lastWord(lines[j].slice(0, span[0])) : '', after: span ? firstWord(lines[j].slice(span[1])) : '',
            };
        });
    }
    const { text } = readerPlaces({ transcript, variants: compareWithTranscript(transcript, p.text) });
    return text.map(pl => {
        const line = pl.line >= 0 ? lines[pl.line] ?? '' : '';
        return {
            line: pl.span ? pl.line : -1, old: pl.v.at, new: pl.v.other, kind: kindText(variantClass(pl.v)),
            before: pl.span ? lastWord(line.slice(0, pl.span[0])) : '', after: pl.span ? firstWord(line.slice(pl.span[1])) : '',
        };
    });
}

/** An answer to the proposal: on its way, failed, or answered (`done`, until the research's state moves on). */
export interface ProposalAct { take: ReadProposalTake; busy: boolean; failed?: boolean }

export interface ProposalInput {
    proposal: ReadSourceProposal;
    /** The confirmed transcript the proposal changes. */
    transcript: string;
    lang: string;
    /** `bridge`: Accept / Keep here; `phone`: a sentence where it works; `none`: neither (an older bridge). */
    actions: 'bridge' | 'phone' | 'none';
    /** The bridge undoes an answer (`sources.proposal.undo`). */
    undo: boolean;
    canOpenTask: boolean;
    /** The whole text side by side is open. */
    whole: boolean;
    /** The answer the research took ('' none yet). */
    done: '' | 'proposal' | 'keep';
    act?: ProposalAct | null;
}

function spinLabel(on: boolean, label: string): string {
    return on ? `<span class="read-task-spin" aria-hidden="true"></span>${esc(label)}` : esc(label);
}

/** The block under the source's row: who proposed it, the places, the whole text, Accept / Keep (or the answer and Undo). */
export function proposalHtml(o: ProposalInput): string {
    const t = strings.read;
    const p = o.proposal;
    const at = p.at ? readStateLongDate(new Date(p.at), o.lang) : '';
    const from = o.canOpenTask
        ? `<button type="button" class="link-button viewer-proposal-task" data-proposal-act="task" data-task="${esc(p.task)}">${researchActionLabel(t.pFrom(p.task), researchLinkMark('task'))}</button>`
        : `<span>${esc(t.pFrom(p.task))}</span>`;
    const meta = [p.by ? `<span class="viewer-proposal-by">${esc(p.by)}</span>` : '', from, at ? `<span>${esc(at)}</span>` : '']
        .filter(Boolean).join('<span aria-hidden="true"> · </span>');
    const busy = !!o.act?.busy;
    const fail = o.act?.failed && !busy ? `<p class="viewer-proposal-fail" role="alert">${esc(t.pFail)}</p>` : '';
    const head = `<h4 class="viewer-proposal-title" id="source-viewer-proposal-title">${esc(t.pTitle)}</h4><p class="viewer-proposal-meta">${meta}</p>`;
    if (o.done) {
        const accepted = o.done === 'proposal';
        const undo = o.undo && o.actions === 'bridge'
            ? ` <button type="button" class="link-button viewer-proposal-undo" data-proposal-take="undo"${busy ? ' disabled aria-busy="true"' : ''}>${spinLabel(busy, t.pUndo)}</button>` : '';
        return `<section class="viewer-proposal is-done" id="source-viewer-proposal" data-take="${o.done}" aria-labelledby="source-viewer-proposal-title">${head}`
            + `<div class="viewer-proposal-status" role="status" aria-live="polite">${iconHtml(accepted ? 'done' : 'save', 'viewer-read-state-icon')}`
            + `<div><p class="viewer-proposal-t1">${esc(accepted ? t.pAccepted : t.pKept)}</p><p class="viewer-proposal-t2">${esc(accepted ? t.pAccepted2 : t.pKept2)}${undo}</p></div></div>`
            + `${fail}</section>`;
    }
    const rows = proposalPlaces(o.transcript, p).map(x => `<li class="read-check-row viewer-proposal-row">`
        + `<span class="read-check-ln">${x.line >= 0 ? esc(`${t.ln} ${x.line + 1}`) : ''}</span>`
        + `<span class="read-check-what">${changeWhatHtml(x.old, x.new, 'read-mk-chg', x.before, x.after)}</span>`
        + `<span class="read-check-kind">${esc(x.kind)}</span></li>`).join('');
    const whole = `<button type="button" class="link-button viewer-proposal-whole" data-proposal-act="whole" aria-expanded="${o.whole}">`
        + `${esc(t.pWhole)} <span class="viewer-read-state-caret" aria-hidden="true">${o.whole ? '▾' : '▸'}</span></button>`;
    const cols = o.whole
        ? `<div class="viewer-proposal-cols"><div class="viewer-proposal-col"><h5>${esc(t.pOld)}</h5><p class="viewer-proposal-text">${esc(o.transcript)}</p></div>`
          + `<div class="viewer-proposal-col is-new"><h5>${esc(t.pNew)}</h5><p class="viewer-proposal-text">${esc(p.text)}</p></div></div>` : '';
    let foot = '';
    if (o.actions === 'bridge') {
        const btn = (take: ReadProposalTake, label: string): string => {
            const on = busy && o.act!.take === take;
            return `<button type="button" class="secondary" data-proposal-take="${take}"${busy ? ' disabled' : ''}${on ? ' aria-busy="true"' : ''}>${spinLabel(on, label)}</button>`;
        };
        foot = `<p class="viewer-proposal-note">${esc(t.pNote)}</p><div class="viewer-proposal-actions">${btn('proposal', t.pAccept)}${btn('keep', t.pKeep)}</div>${fail}`;
    } else if (o.actions === 'phone') {
        foot = `<p class="viewer-proposal-phone">${esc(t.sPhone)}</p>`;
    }
    return `<section class="viewer-proposal" id="source-viewer-proposal" aria-labelledby="source-viewer-proposal-title">${head}`
        + (rows ? `<ul class="viewer-proposal-places">${rows}</ul>` : '')
        + `<p class="viewer-proposal-links">${whole}</p>${cols}${foot}</section>`;
}
