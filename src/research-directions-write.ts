/**
 * Research directions written through the research's bridge (spec 038, Strom
 * Research 1.26): create (`POST <token>/directions`), edit (`POST
 * <token>/directions/<G…>`), pause / end / restart (`…/state`), the order
 * of work (`POST <token>/directions/order`) and who is in which direction
 * (`GET <token>/directions/people`, kept by the research's head). Only from a
 * bridge that says so in `/status.caps` (`directionsWrite`); an older
 * research keeps the links through its terminal.
 *
 * Every answer comes typed, never thrown: 200 done; 503 `research.busy` (with
 * `Retry-After`); 409 `directions.exists` (with the direction that exists)
 * and `directions.archive`; 423 locked; 507 disk full; 400 a body it does not
 * take; 404 a direction or person it does not know. The generic write
 * (researchBridgeWrite) serves the other writes of the directions' panel
 * (work outside the directions, a task's own place) the same way.
 */

import {
    LiveDirection, LiveDirectionKind, DirectionLimits, LiveOffLine, LiveQueueItem, OffLineBranch, OffLineMode, OFF_LINE_MODES,
    cleanText, isResearchHead, researchBranchRef, researchDirectionRef, researchPersonRef, researchTaskRef,
    sanitizeDirections, sanitizeOffLine, sanitizeOffLineBranch, sanitizeQueue, withAppVersion,
} from './research-link.js';
import { ResearchWriteHeld, writeHeldOfCode } from './research-write-held.js';
import type { ResearchBranch, ResearchLine, ResearchPlace } from './types.js';

/**
 * Why nothing was written:
 * - `busy` (503 `research.busy`): try again (`retryAfter` seconds when said);
 * - `exists` (409 `directions.exists`): such a direction is there (`existing`);
 * - `archive` (409 `directions.archive`): an archive, or a research waiting for its agent;
 * - `conflict` (any other 409, e.g. `queue.doing`): `errorCode` says which;
 * - `held` (409 / 507 of a seal elsewhere, files not downloaded, a full disk): the research's sentence;
 * - `locked` (423): the research wrote a newer tree;
 * - `full` (507 `disk.full` without its capability);
 * - `bad-body` (400): a request it does not take;
 * - `none` (404 `directions.none`, `offline.none`, …): the direction (task, branch) is gone;
 * - `person` (404 `directions.person`): the research does not know the person;
 * - `app-only` (403): not taken for the app's;
 * - `failed` (other 5xx); `network`: no answer; `invalid`: not sent at all; `unknown`: any other answer.
 */
export type DirectionWriteCode =
    | 'busy' | 'exists' | 'archive' | 'conflict' | 'held' | 'locked' | 'full' | 'bad-body' | 'none' | 'person'
    | 'app-only' | 'failed' | 'network' | 'invalid' | 'unknown';

export interface DirectionWriteRefused {
    ok: false;
    code: DirectionWriteCode;
    /** The HTTP status (0: no answer, or not sent). */
    status: number;
    /** The bridge's own code ("directions.exists"; '' = none). */
    errorCode: string;
    /** `busy`: when to try again (seconds; null: not said). */
    retryAfter: number | null;
    /** The research's sentence, in its language ('' = none): shown in quotes. */
    reason: string;
    /** `exists`: the direction that is there. */
    existing?: { id: string; name: string; state: LiveDirection['state'] };
    /** `held`: what holds it and the research's sentence. */
    held?: ResearchWriteHeld;
}

/** A write done: the research's version after it and the one it was made on (absent: not said). */
export interface BridgeWriteDone {
    ok: true;
    head: string;
    parent?: string;
}

export type BridgeWriteResult<T = object> = (BridgeWriteDone & T) | DirectionWriteRefused;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** `Retry-After` in whole seconds (null: not said or not a number). */
function retryAfterSeconds(value: string | null | undefined): number | null {
    if (!value || !/^\s*\d{1,6}\s*$/.test(value)) return null;
    return Number.parseInt(value, 10);
}

const DIRECTION_STATES: readonly string[] = ['active', 'paused', 'done'];

/** A refusal by its HTTP status and the bridge's code. */
export function directionRefusal(status: number, body: unknown, retryAfter?: string | null): DirectionWriteRefused {
    const r = asRecord(body) ?? {};
    const errorCode = typeof r.code === 'string' ? r.code.slice(0, 60) : typeof r.error === 'string' && /^[a-z]+\.[a-z.-]+$/.test(r.error) ? r.error : '';
    const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : typeof r.error === 'string' && r.error !== errorCode ? r.error : '', 400);
    const out = (code: DirectionWriteCode): DirectionWriteRefused => ({
        ok: false, code, status, errorCode, retryAfter: code === 'busy' ? retryAfterSeconds(retryAfter) : null, reason,
    });
    if (status === 503 || errorCode === 'research.busy') return out('busy');
    const held = status === 409 || status === 507 ? writeHeldOfCode(errorCode, r.error, r.params) : null;
    if (held) return { ...out('held'), held };
    if (status === 409) {
        if (errorCode === 'directions.exists') {
            const e = asRecord(r.existing);
            const id = researchDirectionRef(e?.id);
            const name = cleanText(e?.name, 120);
            const state = typeof e?.state === 'string' && DIRECTION_STATES.includes(e.state) ? e.state as LiveDirection['state'] : null;
            return { ...out('exists'), ...(id && state ? { existing: { id, name: name || id, state } } : {}) };
        }
        return out(errorCode === 'directions.archive' ? 'archive' : 'conflict');
    }
    if (status === 423) return out('locked');
    if (status === 507) return out('full');
    if (status === 400) return out('bad-body');
    if (status === 404) return out(errorCode === 'directions.person' ? 'person' : 'none');
    if (status === 403) return out('app-only');
    if (status >= 500 && status < 600) return out('failed');
    if (status === 0) return out('network');
    return out('unknown');
}

/**
 * Whether Try again goes with a refused direction write: a busy research
 * (503) and a bridge that did not answer; never with a refusal the research
 * gave (its sentence or "The change to the direction was not saved.").
 */
export function directionRetryHelps(r: DirectionWriteRefused): boolean {
    return r.code === 'busy' || r.code === 'network';
}

/** A 2xx answer's `head` and `parent` (each absent or '' when not said). */
function doneOf(body: unknown): BridgeWriteDone {
    const r = asRecord(body);
    const head = isResearchHead(r?.head) ?? '';
    const parent = isResearchHead(r?.parent);
    return { ok: true, head, ...(parent ? { parent } : {}) };
}

// ==================== REQUESTS ====================

/** How long the research has to write (a command of the tree under its lock). */
export const DIRECTION_WRITE_TIMEOUT_MS = 30_000;

const notSent = (): DirectionWriteRefused => ({ ok: false, code: 'invalid', status: 0, errorCode: '', retryAfter: null, reason: '' });
const noAnswer = (): DirectionWriteRefused => ({ ok: false, code: 'network', status: 0, errorCode: '', retryAfter: null, reason: '' });

/** Requests on their way, one per bridge, method, path and body: a second ask while one runs gets the same answer. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * One request to the bridge (no cookies; a body as text/plain JSON, so no
 * preflight), its answer typed by `parse` (2xx) or as a refusal. Never throws.
 */
export function researchBridgeWrite<T extends object>(base: string, method: 'GET' | 'POST', path: string, body: unknown,
    parse: (r: Record<string, unknown>) => T | null, opts: { timeoutMs?: number } = {}): Promise<BridgeWriteResult<T>> {
    if (typeof fetch !== 'function' || !base) return Promise.resolve(noAnswer());
    const text = body === undefined ? undefined : JSON.stringify(body);
    const key = `${base}|${method}|${path}|${text ?? ''}`;
    const running = inFlight.get(key);
    if (running) return running as Promise<BridgeWriteResult<T>>;
    const job = (async (): Promise<BridgeWriteResult<T>> => {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? DIRECTION_WRITE_TIMEOUT_MS) : null;
        try {
            const res = await fetch(withAppVersion(`${base}/${path}`), {
                method,
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                ...(text !== undefined ? { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text } : {}),
                signal: ctl?.signal,
            });
            let json: unknown = null;
            try { json = await res.json(); } catch { /* no JSON: the status alone */ }
            if (res.status >= 200 && res.status < 300) {
                const r = asRecord(json);
                const value = r ? parse(r) : null;
                if (!value) return directionRefusal(res.status, json) as DirectionWriteRefused;
                return { ...doneOf(json), ...value };
            }
            return directionRefusal(res.status, json, res.headers?.get?.('Retry-After') ?? null);
        } catch {
            return noAnswer();
        } finally {
            if (timer) clearTimeout(timer);
        }
    })();
    inFlight.set(key, job);
    void job.finally(() => inFlight.delete(key));
    return job;
}

/** The direction in an answer (`direction`), checked as the status's are; null when absent or not valid. */
function directionOf(r: Record<string, unknown>): LiveDirection | null {
    return sanitizeDirections([r.direction])[0] ?? null;
}

/** What a new direction says (`POST /directions`). */
export interface DirectionCreateBody {
    person: string;
    direction: Exclude<LiveDirectionKind, 'person'>;
    name?: string;
    question?: string;
    limits?: DirectionLimits;
    /** What is known about the person (for the agent). */
    note?: string;
    /** A branch outside the directions it grows from ("B-P0031"). */
    branch?: string;
}

/** A branch's key ("B-P0031"), or null. */
export function offLineBranchRef(id: unknown): string | null {
    return researchBranchRef(id);
}

/** Create a direction; it comes last in the order. 409 `directions.exists`: `existing` says which is there. */
export function createDirection(base: string, body: DirectionCreateBody): Promise<BridgeWriteResult<{ direction: LiveDirection | null }>> {
    const person = researchPersonRef(body.person);
    const kinds = ['ancestors', 'descendants', 'question'];
    if (!person || !kinds.includes(body.direction)) return Promise.resolve(notSent());
    if (body.direction === 'question' && !body.question?.trim()) return Promise.resolve(notSent());
    const branch = body.branch === undefined ? undefined : offLineBranchRef(body.branch);
    if (body.branch !== undefined && !branch) return Promise.resolve(notSent());
    const limits = body.limits && (body.limits.generations !== undefined || body.limits.before !== undefined) ? body.limits : undefined;
    const sent = {
        person, direction: body.direction,
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        ...(body.question?.trim() ? { question: body.question.trim() } : {}),
        ...(limits ? { limits } : {}),
        ...(body.note?.trim() ? { note: body.note.trim() } : {}),
        ...(branch ? { branch } : {}),
    };
    return researchBridgeWrite(base, 'POST', 'directions', sent, r => ({ direction: directionOf(r) }));
}

/** What an edit changes (`null` limits: no limit of that kind; `reason`: why a paused one is paused). */
export interface DirectionEditBody {
    name?: string;
    question?: string;
    limits?: { generations?: number | null; before?: number | null };
    reason?: string;
}

/** The sentence a narrower (or wider) limit gives: tasks outside the direction now, or back in it. */
export interface DirectionEditEffect {
    said: string;
    outside: number;
    back?: number;
}

function effectOf(value: unknown): DirectionEditEffect | null {
    const r = asRecord(value);
    const said = cleanText(r?.said, 400);
    const outside = typeof r?.outside === 'number' && Number.isInteger(r.outside) && r.outside >= 0 ? r.outside : 0;
    const back = typeof r?.back === 'number' && Number.isInteger(r.back) && r.back > 0 ? r.back : 0;
    if (!said || (outside === 0 && back === 0)) return null;
    return { said, outside, ...(back ? { back } : {}) };
}

/** Edit a direction (kind and person stay); `effect` when a limit moved tasks out of it or back. */
export function editDirection(base: string, id: string, body: DirectionEditBody):
    Promise<BridgeWriteResult<{ direction: LiveDirection | null; effect?: DirectionEditEffect }>> {
    const ref = researchDirectionRef(id);
    if (!ref || ref !== id) return Promise.resolve(notSent());
    return researchBridgeWrite(base, 'POST', `directions/${ref}`, body, r => {
        const effect = effectOf(r.effect);
        return { direction: directionOf(r), ...(effect ? { effect } : {}) };
    });
}

export type DirectionStateDo = 'pause' | 'done' | 'resume';

/** Pause, end or restart a direction; one already in that state answers 200 with nothing changed. */
export function setDirectionState(base: string, id: string, what: DirectionStateDo, reason?: string):
    Promise<BridgeWriteResult<{ direction: LiveDirection | null }>> {
    const ref = researchDirectionRef(id);
    if (!ref || ref !== id || !['pause', 'done', 'resume'].includes(what)) return Promise.resolve(notSent());
    const why = reason?.trim() ? cleanText(reason, 400) : '';
    return researchBridgeWrite(base, 'POST', `directions/${ref}/state`, { do: what, ...(why ? { reason: why } : {}) },
        r => ({ direction: directionOf(r) }));
}

/** Write the order of work (ids missing go after these, in their order so far; unknown ones come back in `ignored`). */
export function writeDirectionOrder(base: string, ids: readonly string[]): Promise<BridgeWriteResult<{ order: string[]; ignored: string[] }>> {
    const order = [...new Set(ids.map(researchDirectionRef).filter((x): x is string => !!x))];
    if (order.length === 0) return Promise.resolve(notSent());
    const list = (v: unknown): string[] => Array.isArray(v) ? v.map(researchDirectionRef).filter((x): x is string => !!x) : [];
    return researchBridgeWrite(base, 'POST', 'directions/order', { order }, r => ({ order: list(r.order), ignored: list(r.ignored) }));
}

// ==================== WORK OUTSIDE THE DIRECTIONS ====================

/** A branch's choice: how it is taken, added to a direction, or back to the tree's default. */
export type BranchModeWrite = OffLineMode | 'default' | { line: string };

/**
 * Set how a branch outside the directions is taken (`POST /offline/<B…>`), for
 * its tasks today and the new ones. `{ line }` adds it to that direction.
 * 404 `offline.none`: the branch is gone (done, or in a direction already).
 */
export function setBranchMode(base: string, branch: string, mode: BranchModeWrite):
    Promise<BridgeWriteResult<{ branch: OffLineBranch | null }>> {
    const ref = researchBranchRef(branch);
    if (!ref || ref !== branch) return Promise.resolve(notSent());
    let body: { mode: string; line?: string };
    if (typeof mode === 'object') {
        const line = researchDirectionRef(mode.line);
        if (!line) return Promise.resolve(notSent());
        body = { mode: 'line', line };
    } else if (mode === 'default' || (OFF_LINE_MODES as readonly string[]).includes(mode)) {
        body = { mode };
    } else {
        return Promise.resolve(notSent());
    }
    return researchBridgeWrite(base, 'POST', `offline/${ref}`, body, r => ({ branch: sanitizeOffLineBranch(r.branch) }));
}

/** The tree's choice for work outside the directions (`POST /offline`): how it is taken, and the growing branches' question. */
export function setOffLineTree(base: string, body: { mode?: OffLineMode | 'default'; suggest?: boolean }):
    Promise<BridgeWriteResult<{ offLine: LiveOffLine | null }>> {
    const mode = body.mode === 'default' || (body.mode && (OFF_LINE_MODES as readonly string[]).includes(body.mode)) ? body.mode : undefined;
    const suggest = typeof body.suggest === 'boolean' ? body.suggest : undefined;
    if (mode === undefined && suggest === undefined) return Promise.resolve(notSent());
    return researchBridgeWrite(base, 'POST', 'offline', { ...(mode ? { mode } : {}), ...(suggest !== undefined ? { suggest } : {}) },
        r => ({ offLine: sanitizeOffLine(r.offLine) }));
}

/** A task's own place in the queue. */
export type TaskOrderDo = 'next' | 'last' | 'default';

/** Set a task's own place (`POST /queue/<T…>`): next once, after everything, or back. 409 `queue.doing`: the agent works on it. */
export function setTaskOrder(base: string, task: string, what: TaskOrderDo): Promise<BridgeWriteResult<{ task: LiveQueueItem | null }>> {
    const ref = researchTaskRef(task);
    if (!ref || ref !== task || !['next', 'last', 'default'].includes(what)) return Promise.resolve(notSent());
    return researchBridgeWrite(base, 'POST', `queue/${ref}`, { do: what }, r => ({ task: sanitizeQueue([r.task], true, true)[0] ?? null }));
}

/** The answer to a growing branch in Awaiting action: add it to a direction, leave it as it is, or do not research it. */
export type BranchWaitingDo = 'line' | 'keep' | 'never';

/** Answer a growing branch (`POST /waiting/W-B-…`); `line` adds it to `line` (or the nearest direction). 404 `waiting.none`: answered already. */
export function answerBranchWaiting(base: string, id: string, what: BranchWaitingDo, line?: string):
    Promise<BridgeWriteResult<{ answer: string }>> {
    const ok = typeof id === 'string' && /^W-B-P\d{1,7}(-\d{1,7})?$/.test(id);
    const to = line === undefined ? undefined : researchDirectionRef(line);
    if (!ok || !['line', 'keep', 'never'].includes(what) || (line !== undefined && !to)) return Promise.resolve(notSent());
    return researchBridgeWrite(base, 'POST', `waiting/${id}`, { do: what, ...(what === 'line' && to ? { line: to } : {}) },
        r => ({ answer: typeof r.answer === 'string' ? r.answer.slice(0, 20) : what }));
}

/** A task of a branch (`GET /offline/<B…>`). */
export interface BranchTask { id: string; text: string; person?: string; own?: 'next' | 'last' }

/** All tasks of a branch, the ones not taken too (`GET /offline/<B…>`). */
export function fetchBranchTasks(base: string, branch: string): Promise<BridgeWriteResult<{ branch: OffLineBranch | null; tasks: BranchTask[] }>> {
    const ref = researchBranchRef(branch);
    if (!ref) return Promise.resolve(notSent());
    return researchBridgeWrite(base, 'GET', `offline/${ref}`, undefined, r => {
        const tasks: BranchTask[] = [];
        for (const raw of Array.isArray(r.tasks) ? r.tasks.slice(0, 500) : []) {
            const t = asRecord(raw);
            const id = researchTaskRef(t?.id);
            const text = cleanText(t?.text);
            if (!t || !id || !text) continue;
            const person = researchPersonRef(t.person);
            tasks.push({ id, text, ...(person ? { person } : {}), ...(t.own === 'next' || t.own === 'last' ? { own: t.own } : {}) });
        }
        return { branch: sanitizeOffLineBranch(r.branch), tasks };
    });
}

// ==================== WHO IS IN WHICH DIRECTION ====================

/** Person (REFN) → the directions they are in, the narrowest first (active and paused only). */
export type DirectionPeople = ReadonlyMap<string, readonly string[]>;

/** Most persons read from one answer. */
const MAX_PEOPLE = 50_000;

/**
 * Where each person stands in the lines, read live (`directions.places`,
 * spec 073 §16.9): person (REFN) → places, the narrowest first; the lines in
 * the research's order; the side branches; the print they were read at.
 */
export interface DirectionPlaces {
    places: ReadonlyMap<string, readonly ResearchPlace[]>;
    lines: readonly ResearchLine[];
    branches: readonly ResearchBranch[];
    rev: string;
}

const PLACE_ROLES: readonly string[] = ['line', 'partner', 'branch', 'island'];
const LINE_KINDS: readonly string[] = ['ancestors', 'descendants', 'person', 'question'];
const LINE_STATES: readonly string[] = ['active', 'paused', 'done'];
const BRANCH_RELS: readonly string[] = ['sibling', 'partner', 'child', 'parent', 'other'];
const BRANCH_MODES: readonly string[] = ['never', 'occasional', 'last', 'normal'];

const oneOf = <T extends string>(v: unknown, list: readonly string[]): T | undefined =>
    typeof v === 'string' && list.includes(v) ? v as T : undefined;

/** `places`, `lines`, `branches` and `rev` of `/directions/people`, checked; null when the answer has no `places`. */
export function directionPlacesOf(r: Record<string, unknown>): DirectionPlaces | null {
    const p = asRecord(r.places);
    if (!p) return null;
    const places = new Map<string, ResearchPlace[]>();
    for (const [refn, list] of Object.entries(p).slice(0, MAX_PEOPLE)) {
        const person = researchPersonRef(refn);
        if (!person || !Array.isArray(list)) continue;
        const out: ResearchPlace[] = [];
        const seen = new Set<string>();
        for (const raw of list.slice(0, 50)) {
            const x = asRecord(raw);
            const role = oneOf<ResearchPlace['role']>(x?.role, PLACE_ROLES);
            if (!x || !role) continue;
            const line = researchDirectionRef(x.line);
            const branch = researchBranchRef(x.branch);
            if ((role === 'line' || role === 'partner') && !line) continue;
            const key = `${role}|${line ?? ''}|${branch ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ role, ...(line ? { line } : {}), ...(branch ? { branch } : {}) });
        }
        if (out.length > 0) places.set(person, out);
    }
    const lines: ResearchLine[] = [];
    const lineIds = new Set<string>();
    for (const raw of Array.isArray(r.lines) ? r.lines.slice(0, 500) : []) {
        const x = asRecord(raw);
        const id = researchDirectionRef(x?.id);
        const name = cleanText(x?.name, 200);
        if (!x || !id || !name || lineIds.has(id)) continue;
        lineIds.add(id);
        const kind = oneOf<NonNullable<ResearchLine['kind']>>(x.direction, LINE_KINDS);
        const focus = researchPersonRef(x.focus);
        const state = oneOf<NonNullable<ResearchLine['state']>>(x.state, LINE_STATES);
        lines.push({ id, name, ...(kind ? { kind } : {}), ...(focus ? { focus } : {}), ...(state ? { state } : {}) });
    }
    const branches: ResearchBranch[] = [];
    const branchIds = new Set<string>();
    for (const raw of Array.isArray(r.branches) ? r.branches.slice(0, 2000) : []) {
        const x = asRecord(raw);
        const id = researchBranchRef(x?.id);
        if (!x || !id || branchIds.has(id)) continue;
        branchIds.add(id);
        const person = researchPersonRef(x.person) ?? id.slice(2);
        const via = asRecord(x.via);
        const viaPerson = researchPersonRef(via?.person);
        const rel = oneOf<NonNullable<ResearchBranch['via']>['rel'] & string>(via?.rel, BRANCH_RELS);
        const nearest = researchDirectionRef(x.nearest);
        const line = researchDirectionRef(x.line);
        const mode = oneOf<NonNullable<ResearchBranch['mode']>>(x.mode, BRANCH_MODES);
        branches.push({
            id, person,
            ...(viaPerson ? { via: { person: viaPerson, ...(rel ? { rel } : {}) } } : {}),
            ...(nearest ? { nearest } : {}), ...(line ? { line } : {}), ...(mode ? { mode } : {}),
        });
    }
    return { places, lines, branches, rev: cleanText(r.rev, 128) };
}

/** `{ people: { "P0012": ["G0003", …] }, head }`, checked; with `places` (`directions.places`) those too. */
export function directionPeopleOf(r: Record<string, unknown>): { people: Map<string, string[]>; places?: DirectionPlaces } | null {
    const p = asRecord(r.people);
    if (!p) return null;
    const people = new Map<string, string[]>();
    for (const [refn, list] of Object.entries(p).slice(0, MAX_PEOPLE)) {
        const person = researchPersonRef(refn);
        if (!person || !Array.isArray(list)) continue;
        const ids = [...new Set(list.slice(0, 50).map(researchDirectionRef).filter((x): x is string => !!x))];
        if (ids.length > 0) people.set(person, ids);
    }
    const places = directionPlacesOf(r);
    return { people, ...(places ? { places } : {}) };
}

/** The last answer per bridge, by the research's head (and the places' print) it was read at. */
const peopleCache = new Map<string, { head: string; rev: string; people: DirectionPeople; places: DirectionPlaces | null }>();

/** Who wants to know when the places of a bridge were read anew. */
const placesListeners = new Set<(base: string) => void>();

/**
 * Who is in which direction (`GET /directions/people`), read again only when
 * the research's head moved since the last answer (`head`: the head the
 * status says now; '' = not known, always read) or the places' print did
 * (`rev`: `/status.directions.rev`; '' = not said, the head decides).
 */
export async function fetchDirectionPeople(base: string, head: string, rev = ''): Promise<BridgeWriteResult<{ people: DirectionPeople }>> {
    const kept = peopleCache.get(base);
    if (kept && head && kept.head === head && (!rev || kept.rev === rev)) return { ok: true, head: kept.head, people: kept.people };
    const r = await researchBridgeWrite(base, 'GET', 'directions/people', undefined, directionPeopleOf);
    if (r.ok) {
        const places = r.places ?? null;
        peopleCache.set(base, { head: r.head || head, rev: places?.rev || rev, people: r.people, places });
        if (places || kept?.places) for (const fn of placesListeners) fn(base);
    }
    return r;
}

/** The people kept for a bridge (null: never read). */
export function directionPeopleKept(base: string): DirectionPeople | null {
    return peopleCache.get(base)?.people ?? null;
}

/** Where people stand in the lines, as last read from a bridge (null: never read, or the research does not say). */
export function directionPlacesKept(base: string): DirectionPlaces | null {
    return peopleCache.get(base)?.places ?? null;
}

/** Be told when a bridge's places were read anew (the table's line column); returns the way to stop. */
export function onDirectionPlaces(fn: (base: string) => void): () => void {
    placesListeners.add(fn);
    return () => { placesListeners.delete(fn); };
}

/** Forget what was read (tests; a bridge that went away). */
export function forgetDirectionPeople(base?: string): void {
    if (base) peopleCache.delete(base);
    else peopleCache.clear();
}
