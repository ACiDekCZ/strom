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
    LiveDirection, LiveDirectionKind, DirectionLimits, cleanText, isResearchHead, researchDirectionRef, researchPersonRef,
    sanitizeDirections, withAppVersion,
} from './research-link.js';
import { ResearchWriteHeld, writeHeldOfCode } from './research-write-held.js';

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
    return typeof id === 'string' && /^B-P\d{1,7}$/.test(id.trim()) ? id.trim() : null;
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

// ==================== WHO IS IN WHICH DIRECTION ====================

/** Person (REFN) → the directions they are in, the narrowest first (active and paused only). */
export type DirectionPeople = ReadonlyMap<string, readonly string[]>;

/** Most persons read from one answer. */
const MAX_PEOPLE = 50_000;

/** `{ people: { "P0012": ["G0003", …] }, head }`, checked. */
export function directionPeopleOf(r: Record<string, unknown>): { people: Map<string, string[]> } | null {
    const p = asRecord(r.people);
    if (!p) return null;
    const people = new Map<string, string[]>();
    for (const [refn, list] of Object.entries(p).slice(0, MAX_PEOPLE)) {
        const person = researchPersonRef(refn);
        if (!person || !Array.isArray(list)) continue;
        const ids = [...new Set(list.slice(0, 50).map(researchDirectionRef).filter((x): x is string => !!x))];
        if (ids.length > 0) people.set(person, ids);
    }
    return { people };
}

/** The last answer per bridge, by the research's head it was read at. */
const peopleCache = new Map<string, { head: string; people: DirectionPeople }>();

/**
 * Who is in which direction (`GET /directions/people`), read again only when
 * the research's head moved since the last answer (`head`: the head the
 * status says now; '' = not known, always read).
 */
export async function fetchDirectionPeople(base: string, head: string): Promise<BridgeWriteResult<{ people: DirectionPeople }>> {
    const kept = peopleCache.get(base);
    if (kept && head && kept.head === head) return { ok: true, head: kept.head, people: kept.people };
    const r = await researchBridgeWrite(base, 'GET', 'directions/people', undefined, directionPeopleOf);
    if (r.ok) peopleCache.set(base, { head: r.head || head, people: r.people });
    return r;
}

/** The people kept for a bridge (null: never read). */
export function directionPeopleKept(base: string): DirectionPeople | null {
    return peopleCache.get(base)?.people ?? null;
}

/** Forget what was read (tests; a bridge that went away). */
export function forgetDirectionPeople(base?: string): void {
    if (base) peopleCache.delete(base);
    else peopleCache.clear();
}
