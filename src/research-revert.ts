/**
 * Putting back what an imported family tree said of a value the research or
 * a person changed (spec 066): the research's tree carries the earlier value
 * (`_STROM_WAS` with its `_REF`), and its bridge takes
 * POST <token>/facts/revert {"person": "P…", "ref": "<the 3 _REF>", "part"?: …}.
 * The value is the person's from then on. Read only from a bridge that names
 * `origin` in `/status.features` (researchShowsOrigin); nothing here changes
 * the tree — the value put back only comes with loading the research's version.
 */

import type { FactPart, LifeEvent, Partnership, Person, ResearchWriteHeld } from './types.js';
import type { ValueChange, ValueDiff, ValueField } from './research-changes.js';
import { cleanText, isResearchHead, researchPersonRef, withAppVersion } from './research-link.js';
import { writeHeldOfRefusal } from './research-write-held.js';

/** The bridge's /status feature: it shows the origin of values (the tree's `_STROM_ORIGIN` / `_STROM_WAS`) and takes /facts/revert. */
export const ORIGIN_FEATURE = 'origin';

/** The research shows where its values came from and can put back a family tree's value. */
export function researchShowsOrigin(features: readonly string[] | null | undefined): boolean {
    return !!features?.includes(ORIGIN_FEATURE);
}

/** What is put back: the research's person ("P0004"), the earlier value's `_REF`, and one part of it (none: every part changed). */
export interface RevertRequest {
    person: string;
    ref: string;
    part?: FactPart;
}

/**
 * The bridge's answer, typed:
 * - `ok`: written — `head` the research's version after it, `parent` before ('' = not said);
 * - `writeHeld`: writing to the research is held (the tree sealed on another computer, files not downloaded, the disk
 *   full; or a 403 refusal) — `computer` the other computer's name when said, `held` the research's own reason when typed;
 * - `busy` (503 `research.busy`): another write runs — `retryAfter` seconds when said;
 * - `unknown` (404 `revert.unknown`): no such value (any more), or not that person's;
 * - `nothing` (409 `revert.nothing`): nothing changed to put back (put back meanwhile);
 * - `noBridge`: no answer (the research not running) or no bridge known;
 * - `error`: anything else (an invalid request, an older bridge without the route, a failure there).
 */
export type RevertResult =
    | { kind: 'ok'; head: string; parent: string }
    | { kind: 'writeHeld'; computer?: string; held?: ResearchWriteHeld; reason: string }
    | { kind: 'busy'; retryAfter?: number; reason: string }
    | { kind: 'unknown'; reason: string }
    | { kind: 'nothing'; reason: string }
    | { kind: 'noBridge' }
    | { kind: 'error'; status: number; code: string; reason: string };

/** How long the research has to put a value back (one strom command and its commit). */
export const REVERT_TIMEOUT_MS = 30_000;

const PARTS: readonly FactPart[] = ['DATE', 'PLAC', 'VAL', 'GIVN', 'SURN', 'SEX'];

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** The body as it goes, or null when it is not one the research takes. */
export function revertRequestBody(req: RevertRequest): { person: string; ref: string; part?: FactPart } | null {
    const person = researchPersonRef(req?.person);
    const ref = typeof req?.ref === 'string' ? req.ref.trim() : '';
    if (!person || !ref || ref.length > 64 || !/^[A-Za-z0-9:._-]+$/.test(ref)) return null;
    if (req.part !== undefined && !PARTS.includes(req.part)) return null;
    return { person, ref, ...(req.part ? { part: req.part } : {}) };
}

/** Seconds of a Retry-After header or a body's `retry`, when sane. */
function retryOf(header: string | null | undefined, body: unknown): number | undefined {
    const raw = header != null && header !== '' ? Number(header) : asRecord(body)?.retry;
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 3600 ? Math.round(raw) : undefined;
}

/**
 * The bridge's answer to a revert, typed (`status`: its HTTP status, 0 = no answer; `body`: its JSON, null when none;
 * `features`: the bridge's /status features, for the held writes it announces; `retryAfter`: the header).
 */
export function revertReply(status: number, body: unknown, features?: readonly string[] | null, retryAfter?: string | null): RevertResult {
    if (status === 0) return { kind: 'noBridge' };
    const r = asRecord(body) ?? {};
    const code = typeof r.code === 'string' && /^[a-z0-9.-]{1,40}$/i.test(r.code) ? r.code : '';
    const reasonCode = typeof r.reasonCode === 'string' ? r.reasonCode : '';
    const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
    if (status >= 200 && status < 300) {
        if (!asRecord(body) || r.ok === false) return { kind: 'error', status, code, reason };
        return { kind: 'ok', head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
    }
    const params = asRecord(r.params);
    const computerRaw = params?.computer ?? params?.host ?? r.computer;
    const computer = cleanText(computerRaw, 80);
    const held = writeHeldOfRefusal(code, r.error, features, params) ?? writeHeldOfRefusal(reasonCode, r.error, features, params);
    if (held) return { kind: 'writeHeld', held, reason, ...(computer ? { computer } : {}) };
    if (status === 403 && code !== 'app.only') return { kind: 'writeHeld', reason, ...(computer ? { computer } : {}) };
    if (status === 503 || code === 'research.busy') {
        const after = retryOf(retryAfter, body);
        return { kind: 'busy', reason, ...(after ? { retryAfter: after } : {}) };
    }
    if (status === 404 && code === 'revert.unknown') return { kind: 'unknown', reason };
    if (status === 409 && code === 'revert.nothing') return { kind: 'nothing', reason };
    return { kind: 'error', status, code, reason };
}

/** Reverts on their way, one per bridge and value: a second ask while it runs gets the same answer. */
const inFlight = new Map<string, Promise<RevertResult>>();

/**
 * POST a revert to the research's bridge (`base`: its address with the token, as for /sync) and type its answer.
 * A simple request (text/plain, no cookies). Never throws: no answer is `noBridge`, a request the research would not
 * take is `error` (status 0, code `invalid`).
 */
export function postBridgeRevert(base: string, req: RevertRequest, features?: readonly string[] | null,
    opts: { timeoutMs?: number } = {}): Promise<RevertResult> {
    const payload = revertRequestBody(req);
    if (!payload) return Promise.resolve({ kind: 'error', status: 0, code: 'invalid', reason: '' });
    if (!base || typeof fetch !== 'function') return Promise.resolve({ kind: 'noBridge' });
    const key = `${base}|${payload.person}|${payload.ref}|${payload.part ?? ''}`;
    const running = inFlight.get(key);
    if (running) return running;
    const job = (async (): Promise<RevertResult> => {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? REVERT_TIMEOUT_MS) : null;
        try {
            const res = await fetch(withAppVersion(`${base}/facts/revert`), {
                method: 'POST',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                body: JSON.stringify(payload),
                signal: ctl?.signal,
            });
            let json: unknown = null;
            try { json = await res.json(); } catch { /* no JSON: the status alone */ }
            return revertReply(res.status, json, features, res.headers?.get?.('Retry-After') ?? null);
        } catch {
            return { kind: 'noBridge' };
        } finally {
            if (timer) clearTimeout(timer);
        }
    })();
    inFlight.set(key, job);
    void job.finally(() => inFlight.delete(key));
    return job;
}

/** The rows of "Load the research version?" a fact put back is about: its people (a couple: both partners) and fields. */
export interface RevertedFact {
    persons: readonly string[];
    fields: readonly ValueField[];
    /** An event's type (its rows carry it as `of`). */
    of?: string;
}

/** The load rows of a fact of a person (name, sex, birth, death, event:<id>) or a couple (marriage, divorce, event:<id>). */
export function revertedFact(holder: Person | Partnership, fact: string): RevertedFact {
    const couple = 'person1Id' in holder;
    const persons = couple ? [holder.person1Id, holder.person2Id].filter(Boolean) as string[] : [holder.id];
    if (fact.startsWith('event:')) {
        const ev = ((holder.events ?? []) as LifeEvent[]).find(e => e?.id === fact.slice(6));
        return { persons, fields: ['eventDate', 'eventPlace', 'eventValue'], ...(ev?.type ? { of: ev.type } : {}) };
    }
    const fields: Record<string, ValueField[]> = couple
        ? { marriage: ['marriageDate', 'marriagePlace'] }
        : { name: ['name', 'marriedSurname', 'primaryName'], sex: ['gender'], birth: ['birthDate', 'birthPlace'], death: ['deathDate', 'deathPlace'] };
    return { persons, fields: fields[fact] ?? [] };
}

/** A load row is one of the fact put back. */
export function isRevertedRow(row: ValueChange, reverted: RevertedFact): boolean {
    return reverted.persons.includes(row.personId) && reverted.fields.includes(row.field)
        && (reverted.of === undefined || row.of === reverted.of);
}

/**
 * What loading the research's version after a revert changes besides the
 * value put back (0: it loads quietly, as after a decided conflict); a value
 * coming back into a field empty here is that value, not an added fact.
 */
export function otherRevertChanges(diff: ValueDiff, reverted: RevertedFact): number {
    const fills = diff.filled.filter(r => isRevertedRow(r, reverted)).length;
    return diff.rows.filter(r => !isRevertedRow(r, reverted)).length + diff.addedPersons + diff.addedFacts - fills;
}
