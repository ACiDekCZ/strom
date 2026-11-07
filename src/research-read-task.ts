/**
 * Who creates the task after a source is read again (spec 059, `read.sourceTask`).
 *
 * The one place for the research's names of this part: the feature, the
 * fields of a source read again and of its differences, the source's state in
 * `/status.readAgain`, the agent's proposal, the bridge paths and bodies.
 * Everything from the bridge is untrusted: checked and cleaned here. Without
 * the feature or the fields every parser gives "nothing said" and the app
 * behaves as before the feature.
 */

import { cleanText } from './research-link.js';

/** `/status.features`: the app chooses who creates the task after a source is read again. */
export const READ_SOURCE_TASK_FEATURE = 'read.sourceTask';
/** `/status.features`: the bridge takes the answer to the agent's proposal (accept, keep). */
export const READ_PROPOSAL_FEATURE = 'sources.proposal';
/** `/status.features`: the bridge undoes an answer to the proposal (without it no Undo is offered). */
export const READ_PROPOSAL_UNDO_FEATURE = 'sources.proposal.undo';

/**
 * `POST sources/read`: the app chooses who creates the task only with a research that says the feature; an older
 * one (or a status not known) gets the request as before and creates its task itself.
 */
export function readTaskChoiceFor(features: readonly string[] | null | undefined): { taskChoice?: true } {
    return features?.includes(READ_SOURCE_TASK_FEATURE) ? { taskChoice: true } : {};
}

/** The research's setting "Task from a new reading" (`accepts.read.sourceTask`, `source.taskSetting`). */
export type ReadTaskSetting = 'ask' | 'always' | 'never';
export const READ_TASK_SETTINGS: readonly ReadTaskSetting[] = ['ask', 'always', 'never'];

/** What the app chose in the dialog's footer (`POST sources/<S>/read/<D>/task {how}`). */
export type ReadTaskHow = 'now' | 'queue' | 'save' | 'review';
export const READ_TASK_HOWS: readonly ReadTaskHow[] = ['now', 'queue', 'save', 'review'];

/** Who the task is for: the agent works on it, a person reviews it (the transcript is confirmed). */
export type ReadTaskFor = 'agent' | 'person';

/** The source's state in the research after a new reading (`readAgain[S].state`). */
export type ReadSourceStateKind = 'unchecked' | 'saved' | 'task';
const SOURCE_STATES: readonly ReadSourceStateKind[] = ['unchecked', 'saved', 'task'];

/** What the app answers to the agent's proposal (`POST sources/proposal {take}`). */
export type ReadProposalTake = 'proposal' | 'keep' | 'undo';
export const READ_PROPOSAL_TAKES: readonly ReadProposalTake[] = ['proposal', 'keep', 'undo'];

/** The research's field names of this part (one map; the research's Answer may rename them). */
export const READ_TASK_NAMES = {
    /** `accepts.read.<this>`: the setting. */
    acceptsSetting: 'sourceTask',
    /** `POST sources/read` body: the app chooses (the research then creates no task on its own). */
    choice: 'taskChoice',
    /** `result.source.*` */
    setting: 'taskSetting',
    offer: 'taskOffer',
    task: 'task',
    taskFor: 'taskFor',
    decided: 'decided',
    openTask: 'openTask',
    state: 'state',
    /** `variants[].*` */
    sure: 'sure',
    judged: 'judged',
    /** `POST …/task` body and answer. */
    how: 'how',
    replyTask: 'task',
    replyChat: 'chat',
    replyAppended: 'appended',
    /** `/status.<this>`: the sources' states. */
    sourceStates: 'readAgain',
    /** `readAgain[S].<this>`: the agent's proposal. */
    proposal: 'proposal',
    /** `POST sources/proposal` body. */
    take: 'take',
    /** `POST sourceTask` body. */
    settingValue: 'sourceTask',
} as const;

/** `POST <base>/sources/<S>/read/<D>/task {how}`: what the app chose after a source was read again. */
export function readTaskPath(source: string, read: string): string {
    return `/sources/${encodeURIComponent(source)}/read/${encodeURIComponent(read)}/task`;
}

/** `POST <base>/sources/proposal {source, task, take}`: the answer to the agent's proposal. */
export const READ_PROPOSAL_PATH = '/sources/proposal';

/** `POST <base>/sourceTask {sourceTask}`: the research's setting "Task from a new reading". */
export const READ_TASK_SETTING_PATH = '/sourceTask';

export function readTaskBody(how: ReadTaskHow): Record<string, unknown> {
    return { [READ_TASK_NAMES.how]: how };
}

export function readProposalBody(source: string, task: string, take: ReadProposalTake): Record<string, unknown> {
    return { source, task, [READ_TASK_NAMES.take]: take };
}

export function readTaskSettingBody(value: ReadTaskSetting): Record<string, unknown> {
    return { [READ_TASK_NAMES.settingValue]: value };
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** A task's id ("T0417"), or ''. */
export function readTaskId(v: unknown): string {
    return typeof v === 'string' && /^T\d{1,9}$/.test(v) ? v : '';
}

const readIdOf = (v: unknown): string => typeof v === 'string' && /^D\d{14}-[0-9a-f]{4}$/.test(v) ? v : '';

/**
 * A difference's `judged`: the task that holds or held the place, or whose wording a person turned down (T…), or
 * the reading a person just kept ("Save only", D…). Either way the place is not asked again. '' none. Untrusted.
 */
export function readJudgedId(v: unknown): string {
    return readTaskId(v) || readIdOf(v);
}

/** `judged` is a reading a person kept (D…), not a task. */
export function readJudgedKept(judged: string | undefined): boolean {
    return !!judged && judged.startsWith('D');
}

/** A setting, or null (absent, unknown). Untrusted. */
export function sanitizeTaskSetting(v: unknown): ReadTaskSetting | null {
    return READ_TASK_SETTINGS.includes(v as ReadTaskSetting) ? v as ReadTaskSetting : null;
}

const taskFor = (v: unknown): ReadTaskFor | null => v === 'agent' || v === 'person' ? v : null;

/** A difference's `sure` and `judged` (the task that assessed it, or the reading a person kept), where said. Untrusted. */
export function sanitizeVariantTask(x: Record<string, unknown>): { sure?: boolean; judged?: string } {
    const judged = readJudgedId(x[READ_TASK_NAMES.judged]);
    const sure = x[READ_TASK_NAMES.sure];
    return { ...(typeof sure === 'boolean' ? { sure } : {}), ...(judged ? { judged } : {}) };
}

/**
 * What a source read again says about its task (`read.sourceTask`): the
 * setting, whether there is a sure substantive change to make a task of, the
 * task made and for whom, a decision made earlier, the source's open task.
 * `task` itself stays `ReadSourceResult.task`.
 */
export interface ReadSourceTaskInfo {
    taskSetting: ReadTaskSetting;
    /** At least one sure substantive change. */
    taskOffer: boolean;
    taskFor?: ReadTaskFor;
    /** Saved without a task earlier (the dialog opened again). */
    decided?: 'saved';
    /** The source's open task from before: new places are added to it. */
    openTask?: string;
    /** The source's state after this reading, as `/status.readAgain[S]` says it (`source.state`). */
    state?: ReadSourceState;
}

/**
 * `source.taskSetting…` of a result, or null when the research does not say the setting. `read`: the result's
 * own id (D…), the reading a `source.state` without its `read` is of. Untrusted.
 */
export function sanitizeSourceTaskInfo(s: Record<string, unknown>, read = ''): ReadSourceTaskInfo | null {
    const taskSetting = sanitizeTaskSetting(s[READ_TASK_NAMES.setting]);
    if (!taskSetting) return null;
    const f = taskFor(s[READ_TASK_NAMES.taskFor]);
    const open = readTaskId(s[READ_TASK_NAMES.openTask]);
    const raw = s[READ_TASK_NAMES.state];
    const rec = asRecord(raw);
    // The same shape as `/status.readAgain[S]`; a bare state word or one without `read` is of this reading.
    const state = rec ? sanitizeReadSourceState(rec.read === undefined && readIdOf(read) ? { ...rec, read } : rec)
        : typeof raw === 'string' && readIdOf(read) ? sanitizeReadSourceState({ read, state: raw }) : null;
    return {
        taskSetting,
        taskOffer: s[READ_TASK_NAMES.offer] === true,
        ...(f ? { taskFor: f } : {}),
        ...(s[READ_TASK_NAMES.decided] === 'saved' ? { decided: 'saved' as const } : {}),
        ...(open ? { openTask: open } : {}),
        ...(state ? { state } : {}),
    };
}

/**
 * The answer to `POST …/task`: the task made or added to ('' none), the chat to open ('' none), the places added to
 * `openTask`. `outcome` (a refusal that is an answer, `readTaskRefusal`): `held` a task already holds the places
 * (`task`), `settled` nothing is left to decide (decided before, or only minor, uncertain, assessed places).
 */
export interface ReadTaskReply {
    task: string;
    chat: string;
    appended: boolean;
    outcome?: 'held' | 'settled';
}

/** The research's refusals of `POST …/task` and `POST sources/proposal` that the app answers on its own (the rest: failed). */
export const READ_TASK_CODES = {
    /** 409 (+`task`): a task already holds the places. */
    held: 'read.decide.task',
    /** 409: decided before. */
    done: 'read.decide.done',
    /** 409: nothing to decide (minor details, uncertain or assessed places). */
    nothing: 'read.decide.nothing',
    /** 409: the proposal was answered before (accept / keep). */
    proposalDecided: 'proposal.decided',
    /** 409 (+`proposed`): another wording was proposed meanwhile; undo: the transcript changed since. */
    proposalChanged: 'proposal.changed',
    /** 409: nothing to undo. */
    proposalUndo: 'proposal.undo',
} as const;

const codeOf = (body: unknown): { code: string; p: Record<string, unknown> } => {
    const b = asRecord(body);
    const code = b && typeof b.code === 'string' && /^[a-z][a-z0-9.-]{0,40}$/.test(b.code) ? b.code : '';
    return { code, p: { ...(asRecord(b?.params) ?? {}), ...(b ?? {}) } };
};

/**
 * A refusal of `POST …/task` the app takes as an answer: `held` (the task that holds the places) and `settled`
 * (the source's state is asked again, no choice is left); null: a failure (busy, other refusals, no answer).
 */
export function readTaskRefusal(status: number, body: unknown): ReadTaskReply | null {
    if (status !== 409) return null;
    const { code, p } = codeOf(body);
    if (code === READ_TASK_CODES.held) {
        const task = readTaskId(p[READ_TASK_NAMES.replyTask]);
        return task ? { task, chat: '', appended: false, outcome: 'held' } : null;
    }
    if (code === READ_TASK_CODES.done || code === READ_TASK_CODES.nothing) return { task: '', chat: '', appended: false, outcome: 'settled' };
    return null;
}

/** A refusal of `POST sources/proposal` saying the proposal moved on meanwhile (the state is asked again, not a failure). */
export function readProposalStale(status: number, code: string): boolean {
    return status === 409 && (code === READ_TASK_CODES.proposalDecided || code === READ_TASK_CODES.proposalChanged || code === READ_TASK_CODES.proposalUndo);
}

/** The answer to `POST …/task`. `chat` is kept only as a flag that a chat was asked for: the app opens its own link. Untrusted. */
export function sanitizeReadTaskReply(body: unknown): ReadTaskReply {
    const b = asRecord(body);
    return {
        task: b ? readTaskId(b[READ_TASK_NAMES.replyTask]) : '',
        chat: b ? cleanText(b[READ_TASK_NAMES.replyChat], 200) : '',
        appended: !!b && b[READ_TASK_NAMES.replyAppended] === true,
    };
}

/** One changed place of a proposal: where (`at`, the transcript's words around it), the old and new words, the kind. */
export interface ReadProposalPlace { at: string; old: string; new: string; kind: string }

/** The agent's proposal for a transcript a person confirmed (`readAgain[S].proposal`). */
export interface ReadSourceProposal {
    /** The whole proposed transcript. */
    text: string;
    /** Who proposed it, as the research says it ("agent · model · effort", readers joined " + "). */
    by: string;
    task: string;
    /** When it was proposed (ISO). */
    at: string;
    /** The places it changes; absent: the app counts them itself. */
    places?: ReadProposalPlace[];
}

/** Text that keeps its line breaks: control characters out, runs of spaces folded, capped. */
function blockText(v: unknown, max = 20_000): string {
    if (typeof v !== 'string') return '';
    const flat = v.replace(/\r\n?/g, '\n').split('\n')
        // eslint-disable-next-line no-control-regex
        .map(line => line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/[ \t]+/g, ' ').trimEnd())
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

const isoTime = (v: unknown): string => {
    const t = cleanText(v, 40);
    return t && Number.isFinite(Date.parse(t)) ? t : '';
};

/** A proposal, or null (no text, no task). Untrusted. */
export function sanitizeReadSourceProposal(v: unknown): ReadSourceProposal | null {
    const p = asRecord(v);
    const text = p ? blockText(p.text) : '';
    const task = p ? readTaskId(p.task) : '';
    if (!p || !text || !task) return null;
    // The research sends a string; an object {program, model} (the design's shape) is joined the same way.
    const byRec = asRecord(p.by);
    const by = typeof p.by === 'string' ? cleanText(p.by, 160)
        : byRec ? [cleanText(byRec.program, 60), cleanText(byRec.model, 80)].filter(Boolean).join(' · ') : '';
    const places: ReadProposalPlace[] = [];
    for (const item of Array.isArray(p.places) ? p.places.slice(0, 200) : []) {
        const x = asRecord(item);
        if (!x) continue;
        const old = cleanText(x.old, 500);
        const neu = cleanText(x.new, 500);
        if (!old && !neu) continue;
        const kind = typeof x.kind === 'string' && /^[a-z]{1,20}$/.test(x.kind) ? x.kind : '';
        places.push({ at: cleanText(x.at, 500), old, new: neu, kind });
    }
    return {
        text,
        by,
        task,
        at: isoTime(p.at),
        ...(Array.isArray(p.places) ? { places } : {}),
    };
}

/** A source's state in the research after a new reading (`/status.readAgain[S]`). */
export interface ReadSourceState {
    /** The newest reading of the source (D…). */
    read: string;
    state: ReadSourceStateKind;
    task?: string;
    taskFor?: ReadTaskFor;
    /** The task is still open. */
    taskOpen?: boolean;
    /** The task waits in the agent's queue. */
    taskQueued?: boolean;
    /** Only minor details differ. */
    minorOnly?: boolean;
    /** Only places the readers disagree on (no sure change). */
    unsureOnly?: boolean;
    proposal?: ReadSourceProposal;
}

/** One source's state, or null. Untrusted. */
export function sanitizeReadSourceState(v: unknown): ReadSourceState | null {
    const r = asRecord(v);
    const read = r ? readIdOf(r.read) : '';
    const state = r && SOURCE_STATES.includes(r.state as ReadSourceStateKind) ? r.state as ReadSourceStateKind : null;
    if (!r || !read || !state) return null;
    const task = readTaskId(r.task);
    const f = taskFor(r.taskFor);
    const proposal = sanitizeReadSourceProposal(r[READ_TASK_NAMES.proposal]);
    const flag = (k: string) => r[k] === true ? { [k]: true } : {};
    return {
        read, state,
        ...(task ? { task } : {}),
        ...(f ? { taskFor: f } : {}),
        ...flag('taskOpen'), ...flag('taskQueued'), ...flag('minorOnly'), ...flag('unsureOnly'),
        ...(proposal ? { proposal } : {}),
    };
}

/** `/status.readAgain` as a plain record (kept in the bridge's status), read only with `read.sourceTask` in `features`. Untrusted. */
export function readAgainSaid(v: unknown, features: readonly string[] | null | undefined): Record<string, ReadSourceState> | undefined {
    if (!features?.includes(READ_SOURCE_TASK_FEATURE)) return undefined;
    const m = sanitizeReadAgain(v);
    return asRecord(v) ? Object.fromEntries(m) : undefined;
}

/**
 * The agent's proposals for confirmed transcripts in `/status.waiting` (kind `transcript`, the task's id, its
 * `proposal {source, text, by, at, …}`), by source id (S…). The only place a proposal from the agent's own work is
 * said when the source has no differing newer reading (`readAgain` names only those). Untrusted.
 */
export function sanitizeWaitingProposals(v: unknown): Map<string, ReadSourceProposal> {
    const out = new Map<string, ReadSourceProposal>();
    if (!Array.isArray(v)) return out;
    for (const item of v.slice(0, 2000)) {
        const r = asRecord(item);
        if (!r || r.kind !== 'transcript') continue;
        const p = asRecord(r[READ_TASK_NAMES.proposal]);
        const source = p && typeof p.source === 'string' && /^S\d{1,9}$/.test(p.source) ? p.source : '';
        const proposal = p && source ? sanitizeReadSourceProposal({ ...p, task: r.id }) : null;
        if (proposal && !out.has(source)) out.set(source, proposal);
    }
    return out;
}

/** `sanitizeWaitingProposals` as a plain record, read only with `read.sourceTask` in `features`; undefined: none. */
export function waitingProposalsSaid(v: unknown, features: readonly string[] | null | undefined): Record<string, ReadSourceProposal> | undefined {
    if (!features?.includes(READ_SOURCE_TASK_FEATURE)) return undefined;
    const m = sanitizeWaitingProposals(v);
    return m.size ? Object.fromEntries(m) : undefined;
}

/** `/status.readAgain`: the sources' states by source id (S…); empty when absent. Untrusted. */
export function sanitizeReadAgain(v: unknown): Map<string, ReadSourceState> {
    const out = new Map<string, ReadSourceState>();
    const r = asRecord(v);
    if (!r) return out;
    for (const [key, value] of Object.entries(r).slice(0, 2000)) {
        if (!/^S\d{1,9}$/.test(key)) continue;
        const s = sanitizeReadSourceState(value);
        if (s) out.set(key, s);
    }
    return out;
}
