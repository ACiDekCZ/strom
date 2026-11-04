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

import {
    LiveWaiting, ResearchAccepts, WaitingInbox, researchTaskRef, isResearchHead, cleanText, withAppVersion, waitingNote, imageNumber, imageNumbers,
    sanitizeWaitingInbox, MAX_IMAGE_NUMBER,
} from './research-link.js';
import { waitingPhase, waitingTaskActions, WaitingPhase, fileExt } from './research-waiting.js';
import { uploadHeaders, mediaReplyId, DEFAULT_MEDIA_MAX_BYTES } from './originals.js';
import { sha256OfBlob } from './sha256.js';
import { ResearchWriteHeld, writeHeldOfCode } from './research-write-held.js';

/** The bridge takes "sent" / "unsent" for an item and for a place. */
export const WAITING_SENT_FEATURE = 'waiting.sent';
/** The bridge gives the text of all a place's queries. */
export const WAITING_NOTE_FEATURE = 'waiting.note';
/** The bridge takes the person's answer to a task (`POST <token>/waiting/<T…>` `{do: "answer"}`, research 1.27, spec 048). */
export const WAITING_ANSWER_FEATURE = 'waiting.answer';

/** What the bridge takes from "Awaiting action" (each false: the task link, when the research offers it). */
export interface WaitingWrites {
    sent: boolean;
    note: boolean;
    file: boolean;
    /** The person's answer to a task (`waiting.answer`). */
    answer: boolean;
    /** Images of a book a task waits for (`accepts.media.taskImages`). */
    images: boolean;
}

export function waitingWrites(env: {
    features: readonly string[] | null | undefined;
    accepts: Pick<ResearchAccepts, 'mediaTask' | 'mediaTaskImages'> | null | undefined;
}): WaitingWrites {
    return {
        sent: !!env.features?.includes(WAITING_SENT_FEATURE),
        note: !!env.features?.includes(WAITING_NOTE_FEATURE),
        file: env.accepts?.mediaTask === true,
        answer: !!env.features?.includes(WAITING_ANSWER_FEATURE),
        images: env.accepts?.mediaTaskImages === true,
    };
}

/** No writes at all (no bridge answering here). */
export const NO_WAITING_WRITES: WaitingWrites = { sent: false, note: false, file: false, answer: false, images: false };

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
 * An answer (spec 048): `changed` (409 `waiting.changed`, `at`: what the item says now) — the task waits for
 * something else since the item was read, nothing written; `no-answer` (409 `waiting.no-answer`) — answered in
 * the terminal (a check). A task's image: `image-exists` (409, `image`: saved already, again with Replace),
 * `image-unwanted` (409, `want`: the numbers it asks for), `image-unknown` (409, `missing`: which one it is
 * is not known — again with a number), `pdf` (415 `waiting.pdf`: no page of the PDF can be read), `no-images`
 * (409 `waiting.no-images`: the task waits for no images of a book), `image-same` (409 `waiting.image-same`,
 * `same`/`as`/`sameRecordset`/`sameImage`: the file is the same as another image taken already — nothing taken).
 */
export type WaitingWriteCode =
    | 'none' | 'not-sendable' | 'no-file' | 'locked' | 'app-only' | 'bad-body' | 'busy' | 'failed' | 'too-large' | 'type' | 'full' | 'network' | 'invalid' | 'unknown'
    // Held until something is settled in the research (sealed elsewhere, files not downloaded, its disk full; 017 U7).
    | 'held'
    | 'changed' | 'no-answer' | 'image-exists' | 'image-unwanted' | 'image-unknown' | 'image-same' | 'pdf' | 'no-images';

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
    /** `changed`: the item's `at` now (the `expect` of a new try; absent: not said). */
    at?: string;
    /** `image-exists`: the number saved already. */
    image?: number;
    /** `image-unwanted`: the numbers the task asks for. */
    want?: number[];
    /** `image-unknown`: the numbers still missing. */
    missing?: number[];
    /** `image-same`: the research's id of the image the file is the same as ("M0123"). */
    same?: string;
    /** `image-same`: where that image is, as the research says it ("B0003:9"; for the details only). */
    as?: string;
    /** `image-same`: that image's book ("B0003") and number there. */
    sameRecordset?: string;
    sameImage?: number;
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
    /** The version the write was made on (said by a newer research; absent: not said). */
    parent?: string;
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
    /** The research's version after the write, and the one it was made on (absent: not said). */
    head?: string;
    parent?: string;
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
        if (code === 'waiting.changed') {
            const at = cleanText(r.at, 40);
            return { ...out('changed'), ...(at ? { at } : {}) };
        }
        if (code === 'waiting.image-exists') {
            const image = imageNumber(r.image);
            return { ...out('image-exists'), ...(image !== null ? { image } : {}) };
        }
        if (code === 'waiting.image-unwanted') return { ...out('image-unwanted'), want: imageNumbers(r.want, 1000) };
        if (code === 'waiting.image-unknown') return { ...out('image-unknown'), missing: imageNumbers(r.missing) };
        if (code === 'waiting.image-same') {
            const image = imageNumber(r.image);
            const same = typeof r.same === 'string' && /^[IM]\d{1,7}$/.test(r.same.trim()) ? r.same.trim() : '';
            const as = cleanText(r.as, 80);
            const book = typeof r.sameRecordset === 'string' && /^B\d{1,7}$/.test(r.sameRecordset.trim()) ? r.sameRecordset.trim() : '';
            const sameImage = imageNumber(typeof r.sameImage === 'string' && /^\d{1,6}$/.test(r.sameImage) ? Number(r.sameImage) : r.sameImage);
            return {
                ...out('image-same'), ...(image !== null ? { image } : {}), ...(same ? { same } : {}), ...(as ? { as } : {}),
                ...(book ? { sameRecordset: book } : {}), ...(sameImage !== null ? { sameImage } : {}),
            };
        }
        return out(gone ? 'none' : code === 'waiting.not-sendable' ? 'not-sendable' : code === 'waiting.no-file' ? 'no-file'
            : code === 'waiting.no-answer' ? 'no-answer' : code === 'waiting.no-images' ? 'no-images' : 'unknown');
    }
    if (status === 415 && code === 'waiting.pdf') return out('pdf');
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
        const parent = isResearchHead(r.parent);
        return { ok: true, sent: taskList(moved), head: isResearchHead(r.head) ?? '', ...(parent ? { parent } : {}), ...(task && phase ? { task, phase } : {}) };
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
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        const head = isResearchHead(r?.head);
        const parent = isResearchHead(r?.parent);
        return { ok: true, input: mediaReplyId(body) ?? '', ...(head ? { head } : {}), ...(parent ? { parent } : {}) };
    }
    return refusal(status, body, retryAfter);
}

export interface WaitingAnswerDone {
    ok: true;
    /** The task answered (back in the queue). */
    task: string;
    /** The research's version after the write, and the one it was made on ('' / absent: not said). */
    head: string;
    parent?: string;
}

export type WaitingAnswerResult = WaitingAnswerDone | WaitingWriteRefused;

/** The bridge's answer to the person's answer, typed (200: the task back in the queue). */
export function waitingAnswerReply(status: number, body: unknown, retryAfter?: string | null): WaitingAnswerResult {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return refusal(0, null, null);
        const parent = isResearchHead(r.parent);
        return { ok: true, task: researchTaskRef(r.task) ?? '', head: isResearchHead(r.head) ?? '', ...(parent ? { parent } : {}) };
    }
    return refusal(status, body, retryAfter);
}

/** How the research said it took an image's number: the header, the file's name, the order of the missing ones. */
export type TaskImageBy = 'image' | 'name' | 'order';

export interface TaskImageDone {
    ok: true;
    task: string;
    /** The number it went as (a PDF: its first page); null: not said. */
    image: number | null;
    /** Every number it went as (a PDF's pages). */
    images: number[];
    by: TaskImageBy | null;
    /** The same file was there already: nothing new. */
    same: boolean;
    /** The task got its last missing image and is back in the queue. */
    woken: boolean;
    /** The task's images now (null: not said). */
    inbox: WaitingInbox | null;
    /** The research's ids of the files added and of those it replaced ("M0123"). */
    added: string[];
    replaced: string[];
    head?: string;
    parent?: string;
}

export type TaskImageResult = TaskImageDone | WaitingWriteRefused;

/** Media ids of an answer ("M0123"), each once, at most 200. */
function mediaIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.slice(0, MAX_TASKS).filter((v): v is string => typeof v === 'string' && /^[IM]\d{1,7}$/.test(v)))];
}

/** The bridge's answer to a task's image, typed. */
export function taskImageReply(status: number, body: unknown, retryAfter?: string | null): TaskImageResult {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return refusal(0, null, null);
        const head = isResearchHead(r.head);
        const parent = isResearchHead(r.parent);
        const images = imageNumbers(r.images, 1000);
        const image = imageNumber(r.image) ?? images[0] ?? null;
        return {
            ok: true,
            task: researchTaskRef(r.task) ?? '',
            image,
            images: images.length ? images : image !== null ? [image] : [],
            by: r.by === 'image' || r.by === 'name' || r.by === 'order' ? r.by : null,
            same: r.same === true,
            woken: r.woken === true,
            inbox: sanitizeWaitingInbox(r.inbox),
            added: mediaIds(r.added),
            replaced: mediaIds(r.replaced),
            ...(head ? { head } : {}),
            ...(parent ? { parent } : {}),
        };
    }
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

/** The longest answer the research takes (characters). */
export const WAITING_ANSWER_MAX = 4000;

/**
 * An answer's text as it goes: NFC, trimmed, without NUL; null when it is
 * empty or longer than the research takes (nothing is sent then).
 */
export function waitingAnswerText(text: string): string | null {
    // eslint-disable-next-line no-control-regex
    const t = text.normalize('NFC').replace(/\u0000/g, '').trim();
    return t && [...t].length <= WAITING_ANSWER_MAX ? t : null;
}

/**
 * The person's answer to a task (`POST <base>/waiting/<T…>` `{do: "answer",
 * text, expect}`, `waiting.answer`): the task goes back to the queue with it,
 * no agent starts. `expect`: the item's `at` as read (another one now: 409
 * `changed`, nothing written). The same answer twice: 404 `none` (taken as done).
 */
export function answerWaiting(base: string, task: string, answer: { text: string; expect?: string }, opts: { timeoutMs?: number } = {}): Promise<WaitingAnswerResult> {
    const ref = researchTaskRef(task);
    const text = waitingAnswerText(answer.text);
    if (!ref || ref !== task || !text) return Promise.resolve(notSent());
    const expect = typeof answer.expect === 'string' && answer.expect ? answer.expect : undefined;
    const body = JSON.stringify({ do: 'answer', text, ...(expect ? { expect } : {}) });
    return bridgeRequest(`${base}|POST|waiting/${ref}|answer|${body}`, `${base}/waiting/${encodeURIComponent(ref)}`,
        { method: 'POST', headers: JSON_TEXT, body }, waitingAnswerReply, opts.timeoutMs ?? WAITING_WRITE_TIMEOUT_MS);
}

/** A file's type as it goes: the browser's, else by its extension (a TIFF or HEIC often has none). */
const EXT_MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', pdf: 'application/pdf',
};
export function taskImageMime(file: { type?: string; name?: string }): string {
    return file.type || EXT_MIME[fileExt(file.name ?? '')] || 'application/octet-stream';
}

/** A file's SHA-256, once per file (a try again or a Replace does not read it again); large files in a worker. */
const shaOfFile = new WeakMap<Blob, Promise<string>>();
export function taskImageSha(file: Blob): Promise<string> {
    let sha = shaOfFile.get(file);
    if (!sha) {
        sha = sha256OfBlob(file);
        shaOfFile.set(file, sha);
        sha.catch(() => shaOfFile.delete(file));
    }
    return sha;
}

export interface TaskImageOptions {
    /** The number it goes as (`X-Strom-Image`); absent: the research tells it by the name or the order. */
    image?: number | null;
    /** Replace the image saved at that number (`X-Strom-Replace: 1`). */
    replace?: boolean;
    /** The research's limit (`accepts.media.max`). */
    maxBytes?: number | null;
    timeoutMs?: number;
    /** Bytes sent so far of all (while the file goes). */
    onProgress?: (sent: number, total: number) => void;
}

/**
 * An image of a book for a task waiting for it (`PUT <base>/media/<sha256>`
 * with `X-Strom-Task`, `X-Strom-Image`, `X-Strom-Replace`, `X-Strom-Name`;
 * `accepts.media.taskImages`). The research saves it into the task's folder as
 * `<n>.<ext>` and brings the task back with its last missing image (`woken`).
 * Its progress is said while it goes (XMLHttpRequest; without it, none).
 */
export async function uploadTaskImage(base: string, task: string, file: Blob & { name?: string }, opts: TaskImageOptions = {}): Promise<TaskImageResult> {
    const ref = researchTaskRef(task);
    if (!ref || ref !== task) return notSent();
    const image = opts.image ?? null;
    if (image !== null && (!Number.isInteger(image) || image < 1 || image > MAX_IMAGE_NUMBER)) return notSent();
    if (file.size > (opts.maxBytes ?? DEFAULT_MEDIA_MAX_BYTES)) return { ok: false, code: 'too-large', status: 0, retryAfter: null, reason: '' };
    let sha: string;
    try {
        sha = await taskImageSha(file);
    } catch {
        return notSent();
    }
    const headers = uploadHeaders({ mimeType: taskImageMime(file), name: file.name || 'image' }, { task: ref });
    if (image !== null) headers['X-Strom-Image'] = String(image);
    if (opts.replace) headers['X-Strom-Replace'] = '1';
    const key = `${base}|PUT|media/${sha}|${ref}|${image ?? ''}|${opts.replace ? 1 : 0}`;
    const running = inFlight.get(key);
    if (running) return running as Promise<TaskImageResult>;
    const job = sendWithProgress(`${base}/media/${sha}`, headers, file,
        opts.timeoutMs ?? Math.max(FILE_MIN_TIMEOUT_MS, file.size / 2000), opts.onProgress)
        .then(res => res ? taskImageReply(res.status, res.body, res.retryAfter) : noAnswer());
    inFlight.set(key, job);
    void job.finally(() => inFlight.delete(key));
    return job;
}

/** One PUT of a file, its progress said (XMLHttpRequest; fetch where there is none); null: no answer. Never throws. */
function sendWithProgress(url: string, headers: Record<string, string>, body: Blob, timeoutMs: number,
    onProgress?: (sent: number, total: number) => void): Promise<{ status: number; body: unknown; retryAfter: string | null } | null> {
    const target = withAppVersion(url);
    const parse = (text: string): unknown => {
        try { return JSON.parse(text); } catch { return null; }
    };
    if (typeof XMLHttpRequest !== 'function') {
        if (typeof fetch !== 'function') return Promise.resolve(null);
        return (async () => {
            const ctl = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
            try {
                const res = await fetch(target, { method: 'PUT', mode: 'cors', credentials: 'omit', cache: 'no-store', headers, body, signal: ctl?.signal });
                let text = '';
                try { text = await res.text(); } catch { /* the status alone */ }
                onProgress?.(body.size, body.size);
                return { status: res.status, body: parse(text), retryAfter: res.headers?.get?.('Retry-After') ?? null };
            } catch {
                return null;
            } finally {
                if (timer) clearTimeout(timer);
            }
        })();
    }
    return new Promise(resolve => {
        let xhr: XMLHttpRequest;
        try {
            xhr = new XMLHttpRequest();
            xhr.open('PUT', target, true);
            xhr.withCredentials = false;
            xhr.timeout = timeoutMs;
            for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        } catch {
            resolve(null);
            return;
        }
        if (onProgress && xhr.upload) {
            xhr.upload.onprogress = (e: ProgressEvent) => onProgress(e.loaded, e.lengthComputable ? e.total : body.size);
        }
        xhr.onload = () => resolve({ status: xhr.status, body: parse(xhr.responseText ?? ''), retryAfter: xhr.getResponseHeader('Retry-After') });
        xhr.onerror = () => resolve(null);
        xhr.ontimeout = () => resolve(null);
        xhr.onabort = () => resolve(null);
        try {
            xhr.send(body);
        } catch {
            resolve(null);
        }
    });
}

// ==================== AN ANSWER'S DRAFT ====================

/** Where an answer's draft waits on this device (per tree and task). */
export const WAITING_DRAFT_PREFIX = 'strom.waiting.draft.';
/** Most of a draft kept (the field takes 4000). */
const MAX_DRAFT = 8000;

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const draftStorage = (): DraftStorage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

/** The draft's key (`strom.waiting.draft.<treeId>.<T…>`), or null for an id not a task's. */
export function waitingDraftKey(treeId: string, task: string): string | null {
    const ref = researchTaskRef(task);
    return ref && ref === task && treeId && treeId.length <= 200 ? `${WAITING_DRAFT_PREFIX}${treeId}.${ref}` : null;
}

/** An answer's draft ('' = none, or storage not there). */
export function readWaitingDraft(treeId: string, task: string, storage: DraftStorage | null = draftStorage()): string {
    const key = waitingDraftKey(treeId, task);
    if (!key || !storage) return '';
    try {
        const v = storage.getItem(key);
        return typeof v === 'string' ? v.slice(0, MAX_DRAFT) : '';
    } catch {
        return '';
    }
}

/** Keep an answer's draft (blank: it goes). Storage refused (private window, full): nothing kept, nothing thrown. */
export function writeWaitingDraft(treeId: string, task: string, text: string, storage: DraftStorage | null = draftStorage()): void {
    const key = waitingDraftKey(treeId, task);
    if (!key || !storage) return;
    try {
        if (text.trim()) storage.setItem(key, text.slice(0, MAX_DRAFT));
        else storage.removeItem(key);
    } catch { /* not kept */ }
}

/** Drop an answer's draft (the answer saved, or the task waits no more). */
export function clearWaitingDraft(treeId: string, task: string, storage: DraftStorage | null = draftStorage()): void {
    writeWaitingDraft(treeId, task, '', storage);
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
