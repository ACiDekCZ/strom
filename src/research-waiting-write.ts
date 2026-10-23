/**
 * "Awaiting action" written through the research's bridge (variant B of
 * Strom Research 1.13.2-beta.13): an item marked sent or back to do
 * (`POST <token>/waiting/<T…>`), a whole place marked sent or back (`POST
 * <token>/group/<key>`), the text of all a place's queries read (`GET
 * <token>/group/<key>/note`) and a file added to a task (`PUT
 * <token>/media/<sha256>` with `X-Strom-Task`). Only what the bridge
 * announces (`waiting.sent`, `waiting.note`, `accepts.media.task`) is ever
 * used; without it the task link of part (a) stays. Answers and choices
 * never go this way, nor an archive's question or a takeover.
 *
 * Also the pure half of the optimistic move: a row moved at once, kept so
 * until the status says the same (or a short while after the write), put
 * back when the write fails.
 */

import { LiveWaiting, ResearchAccepts, researchTaskRef, isResearchHead, cleanText, withAppVersion, waitingNote } from './research-link.js';
import { waitingPhase, waitingTaskActions, WaitingPhase } from './research-waiting.js';
import { uploadHeaders, mediaReplyId, DEFAULT_MEDIA_MAX_BYTES } from './originals.js';
import { sha256OfBlob } from './sha256.js';
import { ResearchWriteHeld, writeHeldOfCode } from './research-write-held.js';

/** The bridge takes "sent" / "unsent" for an item and for a place. */
export const WAITING_SENT_FEATURE = 'waiting.sent';
/** The bridge gives the text of all a place's queries. */
export const WAITING_NOTE_FEATURE = 'waiting.note';

/** What the bridge takes from "Awaiting action" (each false: the task link, when the research offers it). */
export interface WaitingWrites {
    sent: boolean;
    note: boolean;
    file: boolean;
}

export function waitingWrites(env: {
    features: readonly string[] | null | undefined;
    accepts: Pick<ResearchAccepts, 'mediaTask'> | null | undefined;
}): WaitingWrites {
    return {
        sent: !!env.features?.includes(WAITING_SENT_FEATURE),
        note: !!env.features?.includes(WAITING_NOTE_FEATURE),
        file: env.accepts?.mediaTask === true,
    };
}

/** No writes at all (no bridge answering here). */
export const NO_WAITING_WRITES: WaitingWrites = { sent: false, note: false, file: false };

/** Kinds the bridge marks sent (anything else: 409 `waiting.not-sendable`). */
const SENDABLE_KINDS: ReadonlySet<string> = new Set(['letter', 'family', 'other']);

/** An item to do the research offers to mark sent (`sent` in its actions) and the bridge marks so (its kind). */
export function waitingSendable(w: LiveWaiting): boolean {
    return !!researchTaskRef(w.id) && waitingPhase(w) === 'todo' && SENDABLE_KINDS.has(w.kind ?? '') && !!waitingTaskActions(w)?.includes('sent');
}

/** A sent item that can go back to do: a task of a kind the bridge marks sent. */
export function waitingUnsendable(w: LiveWaiting): boolean {
    return !!researchTaskRef(w.id) && waitingPhase(w) === 'sent'
        && (SENDABLE_KINDS.has(w.kind ?? '') || !!w.actions?.includes('sent'));
}

/** Of a place's items (every item of it, not only those a filter shows), those to mark sent at once. */
export function waitingGroupSendable<T extends LiveWaiting>(items: readonly T[]): T[] {
    return items.filter(waitingSendable);
}

/** A place has a query's text to read at once. */
export function waitingGroupHasNote(items: readonly LiveWaiting[]): boolean {
    return items.some(w => !!w.note);
}

/** Kinds that take no file (409 `waiting.no-file`; a story, a permission, a takeover offer no task actions anyway). */
const NO_FILE_KINDS: ReadonlySet<string> = new Set(['check', 'permission', 'takeover', 'story']);

/** An item the bridge takes a file for (`file` in its actions, a task of a kind that takes one). */
export function waitingFileWritable(w: LiveWaiting): boolean {
    return !!researchTaskRef(w.id) && !NO_FILE_KINDS.has(w.kind ?? '') && !!w.actions?.includes('file');
}

/** The phase an item's write left it in: the answer's own when it names this task, else the one asked for. */
export function waitingWrittenPhase(result: WaitingSentResult, task: string, asked: WaitingPhase): WaitingPhase {
    return result.ok && result.task === task && result.phase ? result.phase : asked;
}

/** A file for a task: an image or a PDF. */
export const WAITING_FILE_ACCEPT = 'image/*,application/pdf,.pdf';

export function waitingFileTaken(file: { type: string; name: string }): boolean {
    return file.type.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

// ==================== ANSWERS ====================

/**
 * Why nothing was written:
 * - `none` (404 or 409 `waiting.none`, `group.none`): the task waits no more, or the place is gone — it goes quietly;
 * - `not-sendable` (409 `waiting.not-sendable`): not a kind the research marks sent;
 * - `no-file` (409 `waiting.no-file`): a task that takes no file (a web check, an archive's permission);
 * - `locked` (423): another session holds the tree in the research;
 * - `app-only` (403): the bridge took the request for not the app's;
 * - `bad-body` (any 400: `waiting.bad-body` a place back to do without its tasks, `media.bad-header`…): a request it does not take;
 * - `busy` (503 `research.busy`, `retryAfter` in seconds when said);
 * - `failed` (500 `waiting.failed`, any 5xx but 503 and 507): the research could not write it;
 * - `too-large` (413) / `type` (415) / `full` (507): a file it does not take;
 * - `network`: no answer (not running, unreachable, not in time);
 * - `invalid`: not sent at all (an id or key it does not take);
 * - `unknown`: any other answer (another 409 too).
 */
export type WaitingWriteCode =
    | 'none' | 'not-sendable' | 'no-file' | 'locked' | 'app-only' | 'bad-body' | 'busy' | 'failed' | 'too-large' | 'type' | 'full' | 'network' | 'invalid' | 'unknown'
    // Held until something is settled in the research (sealed elsewhere, files not downloaded, its disk full; 017 U7).
    | 'held';

export interface WaitingWriteRefused {
    ok: false;
    code: WaitingWriteCode;
    /** The HTTP status (0: no answer, or not sent). */
    status: number;
    /** `busy`: when to try again (seconds; null: not said). */
    retryAfter: number | null;
    /** The bridge's own sentence (for the details only; '' = none). */
    reason: string;
    /** `held`: what holds it and the research's sentence in its language (shown as it is). */
    held?: ResearchWriteHeld;
}

export interface WaitingSentDone {
    ok: true;
    /**
     * The tasks it moved ("T0004"): marked sent (`sent` of the answer), or back
     * to do (`unsent` of a place's answer; an item's: `unsent` or `sent`). Empty: none or not said.
     */
    sent: string[];
    /** The research's version after the write ('' = not said). */
    head: string;
    /** An item's answer: the task, and the phase it is in now (both or neither). */
    task?: string;
    phase?: WaitingPhase;
}

export type WaitingSentResult = WaitingSentDone | WaitingWriteRefused;

export interface GroupNoteDone {
    ok: true;
    /** The queries' text, plain (lines kept). */
    text: string;
    /** Where the texts are in the research (`notes/….md`). */
    notes: string[];
    /** The tasks whose queries it holds. */
    tasks: string[];
}

export type GroupNoteResult = GroupNoteDone | WaitingWriteRefused;

export interface WaitingFileDone {
    ok: true;
    /** The research's id for the file ("I0042"; '' = not said). */
    input: string;
}

export type WaitingFileResult = WaitingFileDone | WaitingWriteRefused;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Most tasks read from one answer. */
const MAX_TASKS = 200;
/** Most of a queries' text kept. */
const MAX_NOTE_TEXT = 50_000;

function taskList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const v of value.slice(0, MAX_TASKS)) {
        const t = researchTaskRef(v);
        if (t && !out.includes(t)) out.push(t);
    }
    return out;
}

/** `Retry-After` in seconds (a date is not used), or null. */
export function retryAfterSeconds(value: string | null | undefined): number | null {
    if (!value || !/^\s*\d{1,6}\s*$/.test(value)) return null;
    return Number.parseInt(value, 10);
}

/** A refusal by its HTTP status and the bridge's code (shared by every write). */
function refusal(status: number, body: unknown, retryAfter: string | null | undefined): WaitingWriteRefused {
    const r = asRecord(body) ?? {};
    const code = typeof r.code === 'string' ? r.code : '';
    const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
    const out = (c: WaitingWriteCode): WaitingWriteRefused => ({
        ok: false, code: c, status, retryAfter: c === 'busy' ? retryAfterSeconds(retryAfter) : null, reason,
    });
    const held = status === 409 || status === 507 ? writeHeldOfCode(code, r.error, r.params) : null;
    if (held) return { ...out('held'), held };
    const gone = code === 'waiting.none' || code === 'group.none';
    if (status === 404) return out(gone ? 'none' : 'unknown');
    if (status === 409) {
        return out(gone ? 'none' : code === 'waiting.not-sendable' ? 'not-sendable' : code === 'waiting.no-file' ? 'no-file' : 'unknown');
    }
    if (status === 423) return out('locked');
    if (status === 403) return out('app-only');
    if (status === 400) return out('bad-body');
    if (status === 413) return out('too-large');
    if (status === 415) return out('type');
    if (status === 503) return out('busy');
    if (status === 507) return out('full');
    if (status >= 500 && status < 600) return out('failed');
    return out('unknown');
}

/**
 * The bridge's answer to "sent" / "unsent" (an item or a place), typed. `list`:
 * where the moved tasks are (`sent`; a place back to do: `unsent`; an item
 * back to do: `unsent` or `sent`, or none at all).
 */
export function waitingSentReply(status: number, body: unknown, retryAfter?: string | null,
    list: 'sent' | 'unsent' | 'either' = 'sent'): WaitingSentResult {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return refusal(0, null, null);
        const moved = list === 'sent' ? r.sent : list === 'unsent' ? r.unsent : Array.isArray(r.unsent) ? r.unsent : r.sent;
        const task = researchTaskRef(r.task);
        const phase = r.phase === 'todo' || r.phase === 'sent' ? r.phase : null;
        return { ok: true, sent: taskList(moved), head: isResearchHead(r.head) ?? '', ...(task && phase ? { task, phase } : {}) };
    }
    return refusal(status, body, retryAfter);
}

/** Task ids as they go in a body: well-formed ones only, each once, at most 200. */
export function waitingTaskIds(tasks: readonly unknown[]): string[] {
    return taskList(tasks);
}

/** The queries' text as plain text: lines kept, other control characters out, capped. */
function noteText(value: unknown): string {
    if (typeof value !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const plain = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
    return plain.length > MAX_NOTE_TEXT ? plain.slice(0, MAX_NOTE_TEXT - 1) + '…' : plain;
}

/** The bridge's answer to a place's queries' text, typed (no text: the place has none any more). */
export function groupNoteReply(status: number, body: unknown, retryAfter?: string | null): GroupNoteResult {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return refusal(0, null, null);
        const text = noteText(r.text);
        if (!text) return { ok: false, code: 'none', status, retryAfter: null, reason: '' };
        const notes = Array.isArray(r.notes)
            ? [...new Set(r.notes.slice(0, MAX_TASKS).map(waitingNote).filter((n): n is string => !!n))] : [];
        return { ok: true, text, notes, tasks: taskList(r.tasks) };
    }
    return refusal(status, body, retryAfter);
}

/** The bridge's answer to a task's file, typed. */
export function waitingFileReply(status: number, body: unknown, retryAfter?: string | null): WaitingFileResult {
    if (status >= 200 && status < 300) return { ok: true, input: mediaReplyId(body) ?? '' };
    return refusal(status, body, retryAfter);
}

// ==================== REQUESTS ====================

/** How long the research has to write (it commits, maybe after a send's write). */
export const WAITING_WRITE_TIMEOUT_MS = 30_000;
/** A file gets at least this long, more for a large one. */
const FILE_MIN_TIMEOUT_MS = 60_000;

/** A place's key as it goes in the path (any text the research gave, encoded), or null. */
export function waitingGroupPath(key: unknown): string | null {
    if (typeof key !== 'string') return null;
    const k = key.trim();
    return k && k.length <= 200 ? encodeURIComponent(k) : null;
}

const notSent = (): WaitingWriteRefused => ({ ok: false, code: 'invalid', status: 0, retryAfter: null, reason: '' });
const noAnswer = (): WaitingWriteRefused => ({ ok: false, code: 'network', status: 0, retryAfter: null, reason: '' });

/** Requests on their way, one per bridge, path and body: a second ask while one runs gets the same answer. */
const inFlight = new Map<string, Promise<unknown>>();

/** One request of a simple kind (no cookies, text/plain JSON body), its answer typed; never throws. */
function bridgeRequest<R>(key: string, url: string, init: { method: 'GET' | 'POST' | 'PUT'; body?: BodyInit; headers?: Record<string, string> },
    reply: (status: number, body: unknown, retryAfter: string | null) => R, timeoutMs: number): Promise<R> {
    if (typeof fetch !== 'function') return Promise.resolve(noAnswer() as unknown as R);
    const running = inFlight.get(key);
    if (running) return running as Promise<R>;
    const job = (async (): Promise<R> => {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
        try {
            const res = await fetch(withAppVersion(url), {
                method: init.method,
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                ...(init.headers ? { headers: init.headers } : {}),
                ...(init.body !== undefined ? { body: init.body } : {}),
                signal: ctl?.signal,
            });
            let json: unknown = null;
            try { json = await res.json(); } catch { /* no JSON: the status alone */ }
            return reply(res.status, json, res.headers?.get?.('Retry-After') ?? null);
        } catch {
            return noAnswer() as unknown as R;
        } finally {
            if (timer) clearTimeout(timer);
        }
    })();
    inFlight.set(key, job);
    void job.finally(() => inFlight.delete(key));
    return job;
}

const JSON_TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };

/** Mark a task sent, or back to do (`POST <base>/waiting/<T…>`). */
export function postWaitingSent(base: string, task: string, what: 'sent' | 'unsent', opts: { timeoutMs?: number } = {}): Promise<WaitingSentResult> {
    const ref = researchTaskRef(task);
    if (!ref || ref !== task || (what !== 'sent' && what !== 'unsent')) return Promise.resolve(notSent());
    const reply = what === 'sent' ? waitingSentReply
        : (status: number, body: unknown, retryAfter: string | null) => waitingSentReply(status, body, retryAfter, 'either');
    return bridgeRequest(`${base}|POST|waiting/${ref}|${what}`, `${base}/waiting/${encodeURIComponent(ref)}`,
        { method: 'POST', headers: JSON_TEXT, body: JSON.stringify({ do: what }) }, reply, opts.timeoutMs ?? WAITING_WRITE_TIMEOUT_MS);
}

/** Mark a whole place sent (`POST <base>/group/<key>`, the key encoded); the answer's `sent` lists the tasks it marked. */
export function postGroupSent(base: string, key: string, opts: { timeoutMs?: number } = {}): Promise<WaitingSentResult> {
    const path = waitingGroupPath(key);
    if (!path) return Promise.resolve(notSent());
    return bridgeRequest(`${base}|POST|group/${path}|sent`, `${base}/group/${path}`,
        { method: 'POST', headers: JSON_TEXT, body: JSON.stringify({ do: 'sent' }) }, waitingSentReply, opts.timeoutMs ?? WAITING_WRITE_TIMEOUT_MS);
}

/**
 * Put a place's tasks back to do (`POST <base>/group/<key>` with
 * `{"do":"unsent","tasks":[…]}`): only the tasks named (those a place's Sent
 * marked, never taken from the state), of them those in the place and sent;
 * the answer's `unsent` lists those it moved back. No task: not sent.
 */
export function postGroupUnsent(base: string, key: string, tasks: readonly string[], opts: { timeoutMs?: number } = {}): Promise<WaitingSentResult> {
    const path = waitingGroupPath(key);
    const ids = waitingTaskIds(tasks);
    if (!path || ids.length === 0) return Promise.resolve(notSent());
    return bridgeRequest(`${base}|POST|group/${path}|unsent|${ids.join(',')}`, `${base}/group/${path}`,
        { method: 'POST', headers: JSON_TEXT, body: JSON.stringify({ do: 'unsent', tasks: ids }) },
        (status, body, retryAfter) => waitingSentReply(status, body, retryAfter, 'unsent'), opts.timeoutMs ?? WAITING_WRITE_TIMEOUT_MS);
}

/** Read the text of all a place's queries (`GET <base>/group/<key>/note`). */
export function getGroupNote(base: string, key: string, opts: { timeoutMs?: number } = {}): Promise<GroupNoteResult> {
    const path = waitingGroupPath(key);
    if (!path) return Promise.resolve(notSent());
    return bridgeRequest(`${base}|GET|group/${path}/note`, `${base}/group/${path}/note`,
        { method: 'GET' }, groupNoteReply, opts.timeoutMs ?? WAITING_WRITE_TIMEOUT_MS);
}

/**
 * Add a file to a task: the originals' path (`PUT <base>/media/<sha256>`)
 * with `X-Strom-Task`. The person comes from the task, not from the app.
 * `maxBytes`: the research's limit (`accepts.media.max`).
 */
export async function putWaitingFile(base: string, task: string, file: Blob & { name?: string },
    opts: { maxBytes?: number | null; timeoutMs?: number } = {}): Promise<WaitingFileResult> {
    const ref = researchTaskRef(task);
    if (!ref || ref !== task) return notSent();
    if (file.size > (opts.maxBytes ?? DEFAULT_MEDIA_MAX_BYTES)) return { ok: false, code: 'too-large', status: 0, retryAfter: null, reason: '' };
    let sha: string;
    try {
        sha = await sha256OfBlob(file);
    } catch {
        return notSent();
    }
    const headers = uploadHeaders({ mimeType: file.type, name: file.name || 'file' }, { task: ref });
    return bridgeRequest(`${base}|PUT|media/${sha}|${ref}`, `${base}/media/${sha}`, { method: 'PUT', headers, body: file },
        waitingFileReply, opts.timeoutMs ?? Math.max(FILE_MIN_TIMEOUT_MS, file.size / 2000));
}

// ==================== THE OPTIMISTIC MOVE ====================

/**
 * A row moved before the research said so: to which phase (or gone: the
 * research waits on it no more), and until when it holds without the status
 * agreeing (Infinity while the write runs).
 */
export interface WaitingPending {
    phase: WaitingPhase;
    /** When it was marked sent (ISO; phase 'sent'). */
    sentAt?: string;
    gone?: boolean;
    until: number;
}

/** How long a written move holds while the status still says otherwise (a status asked before the write). */
export const WAITING_SETTLE_MS = 15_000;

/** The items as shown: each pending move applied (the research's list untouched). */
export function applyWaitingPending<T extends LiveWaiting>(items: readonly T[], pending: ReadonlyMap<string, WaitingPending>, now = Date.now()): T[] {
    if (pending.size === 0) return [...items];
    const out: T[] = [];
    for (const w of items) {
        const p = pending.get(w.id);
        if (!p || p.until < now) {
            out.push(w);
            continue;
        }
        if (p.gone) continue;
        if (p.phase === waitingPhase(w)) {
            out.push(w);
        } else if (p.phase === 'sent') {
            out.push({ ...w, phase: 'sent', ...(p.sentAt ? { sentAt: p.sentAt } : {}) });
        } else {
            const back = { ...w };
            delete back.phase;
            delete back.sentAt;
            out.push(back);
        }
    }
    return out;
}

/**
 * Drop the moves the research's list now agrees with (the item in that phase,
 * or gone), and those whose time ran out. A move whose write still runs stays.
 */
export function settleWaitingPending(pending: Map<string, WaitingPending>, items: readonly LiveWaiting[], now = Date.now()): void {
    for (const [id, p] of [...pending]) {
        if (p.until === Infinity) continue;
        const w = items.find(x => x.id === id);
        if (p.until < now || !w || (!p.gone && waitingPhase(w) === p.phase)) pending.delete(id);
    }
}

/** The day a row was marked sent, short ("11. 10.", "10/11"), in the UI language. */
export function waitingSentDay(ts: number, lang: string): string {
    return new Date(ts).toLocaleDateString(lang, { day: 'numeric', month: 'numeric' });
}
