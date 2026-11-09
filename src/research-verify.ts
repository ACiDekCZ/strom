/**
 * Re-verification of facts through the research's bridge (spec 065):
 * - POST <token>/verify {person|family|fact, dry?}: an agent re-verifies the
 *   facts of a person, a family or one fact (`dry`: only what it would do);
 * - POST <token>/verify/bulk {scope, of?, order?, try?, budget?, dry?}: the
 *   same for a line, a lineage or the whole tree;
 * - POST <token>/facts/confirm {fact, confirm}: a person confirms a fact from
 *   the scan, or takes the confirmation back;
 * - POST <token>/verify/stop {scope?}: drop the tasks not yet begun (all, or
 *   the bulk ones only); a task in a session runs to its end;
 * - `/status verify`: how many facts wait, why, and how many are confirmed.
 * Each request only with its feature in /status.features; each answer typed,
 * its refusals by code. Never throws. Nothing here changes the tree: the
 * research's new state comes with loading its version (`head`).
 */

import {
    LiveStatus, researchTaskRef, researchSourceRef, isResearchHead, cleanText, withAppVersion,
    TREE_STATE_FEATURE, TREE_KIND_FEATURE,
} from './research-link.js';
import {
    VERIFY_FEATURE, VERIFY_BULK_FEATURE, VERIFY_STOP_FEATURE, FACTS_CONFIRM_FEATURE,
    researchFactRef, researchPersonRef, researchFamilyRef,
} from './verify.js';

export { VERIFY_FEATURE, VERIFY_BULK_FEATURE, VERIFY_STOP_FEATURE, FACTS_CONFIRM_FEATURE, researchFactRef };

/** How long the research has to answer (it may plan the work and commit). */
export const VERIFY_TIMEOUT_MS = 30_000;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** A lineage's id in the research ("G3"), or null. */
export function researchLineageRef(id: unknown): string | null {
    return typeof id === 'string' && /^G\d{1,9}$/.test(id.trim()) ? id.trim() : null;
}

/** The features a bridge said (its /status.features), or none. */
type Features = readonly string[] | null | undefined;

/** The bridge takes the request (its feature is in /status.features). */
export function bridgeVerifies(features: Features, feature: string = VERIFY_FEATURE): boolean {
    return !!features?.includes(feature);
}

// ==================== Bodies ====================

/** What one /verify is about: a person, a family, or one fact. */
export type VerifyTarget = { person: string } | { family: string } | { fact: string };

/** The body of POST /verify, or null when the target is not one the research takes. */
export function verifyRequestBody(target: VerifyTarget, dry = false): Record<string, string | boolean> | null {
    const t = asRecord(target);
    if (!t) return null;
    const keys = ['person', 'family', 'fact'].filter(k => t[k] !== undefined);
    if (keys.length !== 1) return null;
    const ref = keys[0] === 'person' ? researchPersonRef(t.person)
        : keys[0] === 'family' ? researchFamilyRef(t.family) : researchFactRef(t.fact);
    if (!ref) return null;
    return { [keys[0]]: ref, ...(dry ? { dry: true } : {}) };
}

export type VerifyBulkScope = 'line' | 'lineage' | 'tree';
export type VerifyBulkOrder = 'ancestors' | 'weakest' | 'oldest';

export interface VerifyBulkRequest {
    scope: VerifyBulkScope;
    /** The line's person ("P…") or the lineage ("G…"); not for the whole tree. */
    of?: string;
    order?: VerifyBulkOrder;
    /** At most this many (a first try). */
    try?: number;
    /** At most this much in USD. */
    budget?: number;
    dry?: boolean;
}

const BULK_SCOPES: readonly VerifyBulkScope[] = ['line', 'lineage', 'tree'];
const BULK_ORDERS: readonly VerifyBulkOrder[] = ['ancestors', 'weakest', 'oldest'];
const TRY_MAX = 10_000;
const BUDGET_MAX = 100_000;

/** The body of POST /verify/bulk, or null when it is not one the research takes. */
export function verifyBulkRequestBody(req: VerifyBulkRequest): Record<string, string | number | boolean> | null {
    const r = asRecord(req);
    if (!r || !BULK_SCOPES.includes(r.scope as VerifyBulkScope)) return null;
    const out: Record<string, string | number | boolean> = { scope: r.scope as string };
    if (r.of !== undefined && r.scope !== 'tree') {
        const of = researchPersonRef(r.of) ?? researchLineageRef(r.of);
        if (!of) return null;
        out.of = of;
    }
    if (r.order !== undefined) {
        if (!BULK_ORDERS.includes(r.order as VerifyBulkOrder)) return null;
        out.order = r.order as string;
    }
    if (r.try !== undefined) {
        if (typeof r.try !== 'number' || !Number.isInteger(r.try) || r.try < 1 || r.try > TRY_MAX) return null;
        out.try = r.try;
    }
    if (r.budget !== undefined) {
        if (typeof r.budget !== 'number' || !Number.isFinite(r.budget) || r.budget <= 0 || r.budget > BUDGET_MAX) return null;
        out.budget = r.budget;
    }
    if (r.dry === true) out.dry = true;
    return out;
}

/** What /verify/stop drops: every task not yet begun, or the bulk ones only. */
export type VerifyStopScope = 'all' | 'bulk';

/** The body of POST /verify/stop (no scope: the research's default, all), or null when the scope is not one it takes. */
export function verifyStopRequestBody(scope?: VerifyStopScope): { scope?: VerifyStopScope } | null {
    if (scope === undefined) return {};
    return scope === 'all' || scope === 'bulk' ? { scope } : null;
}

/** The body of POST /facts/confirm, or null when the fact is not one the research names. */
export function factConfirmRequestBody(fact: string, confirm: boolean): { fact: string; confirm: boolean } | null {
    const ref = researchFactRef(fact);
    return ref && typeof confirm === 'boolean' ? { fact: ref, confirm } : null;
}

// ==================== Answers ====================

/** What a re-verification would cost: agent sessions, and USD when the research knows. */
export interface VerifyEstimate {
    sessions: number;
    usd?: number;
}

/**
 * The record a fact's re-verification goes by: for `read` the citation of the
 * original the agent reads, for `search` the family tree's citation it
 * searches by. Texts as the research names the source (shown as they are).
 */
export interface VerifyRecord {
    /** The source in the research ("S0042"). */
    source: string;
    title: string;
    /** The page or image ('' / absent: not said). */
    page?: string;
}

/** One fact /verify takes: by reading a record it cites, or by searching for one. */
export interface VerifyFact {
    fact: string;
    /** Its GEDCOM tag ("BIRT", "MARR"…). */
    kind: string;
    how: 'read' | 'search';
    /** The record it goes by (absent: not said). */
    record?: VerifyRecord;
}

export interface VerifyDone {
    ok: true;
    /** The task made ("T0042"); null for `dry` (nothing made). */
    task: string | null;
    facts: VerifyFact[];
    /** The task's place in the research's queue (1 = the next session takes it); absent for `dry` or not said. */
    position?: number;
    estimate: VerifyEstimate;
    /** The research's version after the write ('' = not said). */
    head: string;
    /** The version the write was made on (absent: not said). */
    parent?: string;
}

export interface VerifyBulkDone {
    ok: true;
    /** People and facts it takes. */
    people: number;
    facts: number;
    /** The tasks made (none for `dry`). */
    tasks: string[];
    /** People left for another round (beyond `try` or `budget`): the research counts the people it did not take, not their facts. */
    left: number;
    estimate: VerifyEstimate;
    head: string;
    parent?: string;
}

export interface VerifyStopDone {
    ok: true;
    /** The tasks dropped (0: nothing to stop). */
    dropped: number;
    /** The facts of those tasks. */
    facts: number;
    head: string;
    parent?: string;
}

export interface FactConfirmDone {
    ok: true;
    fact: string;
    /** Whose fact it is: the research's person ("P…") or family ("F…"); '' = not said. */
    owner: string;
    /** The day of the confirmation; absent: taken back. */
    confirmed?: string;
    head: string;
    parent?: string;
}

/**
 * Why /verify or /verify/bulk did nothing:
 * - `verify.invalid` (400): the research did not take the body;
 * - `verify.unknown` (404): no such person, family or fact (any more);
 * - `verify.archive` (409): an archive or a waiting tree does not verify;
 * - `verify.nothing` (409): nothing to verify (all confirmed, proven or waiting);
 * - `verify.retracted` (409): the fact was taken back;
 * - `busy` (503 `research.busy`): a send is being written — try again;
 * - `locked` (423): another session holds the tree;
 * - `network`: no answer; `invalid`: not sent (the body is not valid);
 * - `unsupported`: not sent (the bridge does not say the feature);
 * - `unknown`: any other answer.
 */
export type VerifyErrorCode =
    | 'verify.invalid' | 'verify.unknown' | 'verify.archive' | 'verify.nothing' | 'verify.retracted'
    | 'busy' | 'locked' | 'network' | 'invalid' | 'unsupported' | 'unknown';

/** Why /facts/confirm did nothing (as VerifyErrorCode; `factconfirm.merged`: the fact went into another one). */
export type FactConfirmErrorCode =
    | 'factconfirm.invalid' | 'factconfirm.unknown' | 'factconfirm.retracted' | 'factconfirm.merged'
    | 'busy' | 'locked' | 'network' | 'invalid' | 'unsupported' | 'unknown';

export interface BridgeRefused<C extends string> {
    ok: false;
    code: C;
    /** The HTTP status (0: no answer, or not sent). */
    status: number;
    /** The bridge's own sentence (`text`, else `error`), for the details only ('' = none). */
    reason: string;
}

export type VerifyResult = VerifyDone | BridgeRefused<VerifyErrorCode>;
export type VerifyBulkResult = VerifyBulkDone | BridgeRefused<VerifyErrorCode>;
/** /verify/stop refuses with `verify.archive` (409), `busy` (503) or as any request (not sent, no answer…). */
export type VerifyStopResult = VerifyStopDone | BridgeRefused<VerifyErrorCode>;
export type FactConfirmResult = FactConfirmDone | BridgeRefused<FactConfirmErrorCode>;

const VERIFY_CODES: Record<number, readonly VerifyErrorCode[]> = {
    400: ['verify.invalid'],
    404: ['verify.unknown'],
    409: ['verify.archive', 'verify.nothing', 'verify.retracted'],
};
const STOP_CODES: Record<number, readonly VerifyErrorCode[]> = {
    409: ['verify.archive'],
};
const CONFIRM_CODES: Record<number, readonly FactConfirmErrorCode[]> = {
    400: ['factconfirm.invalid'],
    404: ['factconfirm.unknown'],
    409: ['factconfirm.retracted', 'factconfirm.merged'],
};

function countOf(v: unknown): number | null {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e7 ? v : null;
}

function estimateOf(v: unknown): VerifyEstimate {
    const e = asRecord(v);
    const sessions = typeof e?.sessions === 'number' && Number.isFinite(e.sessions) && e.sessions >= 0 ? e.sessions : 0;
    const usd = typeof e?.usd === 'number' && Number.isFinite(e.usd) && e.usd >= 0 ? e.usd : undefined;
    return { sessions, ...(usd !== undefined ? { usd } : {}) };
}

function headsOf(r: Record<string, unknown>): { head: string; parent?: string } {
    const parent = isResearchHead(r.parent);
    return { head: isResearchHead(r.head) ?? '', ...(parent ? { parent } : {}) };
}

/** A refusal typed by its status and code (`known`: the codes of the route). */
function refusalOf<C extends string>(status: number, body: unknown, known: Record<number, readonly C[]>): BridgeRefused<C | 'busy' | 'locked' | 'unknown'> {
    const r = asRecord(body) ?? {};
    const code = typeof r.code === 'string' ? r.code : '';
    const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
    const out = (c: C | 'busy' | 'locked' | 'unknown'): BridgeRefused<C | 'busy' | 'locked' | 'unknown'> => ({ ok: false, code: c, status, reason });
    if (code === 'research.busy' || status === 503) return out('busy');
    if (status === 423) return out('locked');
    const listed = known[status]?.find(c => c === code);
    return out(listed ?? 'unknown');
}

const POSITION_MAX = 1_000_000;
const RECORD_TITLE_MAX = 300;
const RECORD_PAGE_MAX = 120;

/** `record` of a fact /verify takes, or null (no source of the research, or no title). */
function recordOf(v: unknown): VerifyRecord | null {
    const o = asRecord(v);
    const source = researchSourceRef(o?.source);
    const title = cleanText(o?.title, RECORD_TITLE_MAX);
    if (!source || !title) return null;
    const page = cleanText(o?.page, RECORD_PAGE_MAX);
    return { source, title, ...(page ? { page } : {}) };
}

/** The bridge's answer to /verify, typed. */
export function verifyReply(status: number, body: unknown): VerifyResult {
    const r = asRecord(body);
    if (status >= 200 && status < 300) {
        if (!r || r.ok === false) return { ok: false, code: 'unknown', status, reason: '' };
        const facts: VerifyFact[] = [];
        for (const f of Array.isArray(r.facts) ? r.facts : []) {
            const o = asRecord(f);
            const fact = researchFactRef(o?.fact);
            const kind = typeof o?.kind === 'string' && /^[A-Z_][A-Z0-9_]{0,30}$/.test(o.kind) ? o.kind : '';
            if (!fact || !kind || (o?.how !== 'read' && o?.how !== 'search')) continue;
            const record = recordOf(o.record);
            facts.push({ fact, kind, how: o.how, ...(record ? { record } : {}) });
        }
        const task = researchTaskRef(r.task);
        // A place in the queue only of a task made (not of a dry run).
        const position = task && typeof r.position === 'number' && Number.isInteger(r.position)
            && r.position >= 1 && r.position <= POSITION_MAX ? r.position : undefined;
        return {
            ok: true, task, facts, ...(position !== undefined ? { position } : {}),
            estimate: estimateOf(r.estimate), ...headsOf(r),
        };
    }
    return refusalOf(status, body, VERIFY_CODES);
}

/** The bridge's answer to /verify/stop, typed. */
export function verifyStopReply(status: number, body: unknown): VerifyStopResult {
    const r = asRecord(body);
    if (status >= 200 && status < 300) {
        if (!r || r.ok === false) return { ok: false, code: 'unknown', status, reason: '' };
        return { ok: true, dropped: countOf(r.dropped) ?? 0, facts: countOf(r.facts) ?? 0, ...headsOf(r) };
    }
    return refusalOf(status, body, STOP_CODES);
}

/** The bridge's answer to /verify/bulk, typed. */
export function verifyBulkReply(status: number, body: unknown): VerifyBulkResult {
    const r = asRecord(body);
    if (status >= 200 && status < 300) {
        if (!r || r.ok === false) return { ok: false, code: 'unknown', status, reason: '' };
        const tasks = (Array.isArray(r.tasks) ? r.tasks : []).map(researchTaskRef).filter((t): t is string => !!t);
        return {
            ok: true,
            people: countOf(r.people) ?? 0,
            facts: countOf(r.facts) ?? 0,
            tasks: [...new Set(tasks)],
            left: countOf(r.left) ?? 0,
            estimate: estimateOf(r.estimate),
            ...headsOf(r),
        };
    }
    return refusalOf(status, body, VERIFY_CODES);
}

/** The bridge's answer to /facts/confirm, typed (`fact`: the one asked about). */
export function factConfirmReply(fact: string, status: number, body: unknown): FactConfirmResult {
    const r = asRecord(body);
    if (status >= 200 && status < 300) {
        const said = r?.fact === undefined ? fact : researchFactRef(r.fact);
        if (!r || r.ok === false || said !== fact) return { ok: false, code: 'unknown', status, reason: '' };
        const owner = researchPersonRef(r.owner) ?? researchFamilyRef(r.owner) ?? '';
        const confirmed = typeof r.confirmed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.confirmed) ? r.confirmed : undefined;
        return { ok: true, fact, owner, ...(confirmed ? { confirmed } : {}), ...headsOf(r) };
    }
    return refusalOf(status, body, CONFIRM_CODES);
}

// ==================== Requests ====================

/** Requests on their way, one per bridge, route and body: a second ask while it runs gets the same answer. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * POST a JSON body to the bridge (`base`: its address with the token, as for
 * /sync) and type its answer by `reply`. A simple request (text/plain, no
 * cookies), as the sync. No answer is `network`.
 */
function bridgePost<T>(base: string, path: string, payload: object, reply: (status: number, json: unknown) => T,
    network: T, timeoutMs: number): Promise<T> {
    if (typeof fetch !== 'function') return Promise.resolve(network);
    const key = `${base}|${path}|${JSON.stringify(payload)}`;
    const running = inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const job = (async (): Promise<T> => {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
        try {
            const res = await fetch(withAppVersion(`${base}/${path}`), {
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
            return reply(res.status, json);
        } catch {
            return network;
        } finally {
            if (timer) clearTimeout(timer);
        }
    })();
    inFlight.set(key, job);
    void job.finally(() => inFlight.delete(key));
    return job;
}

const notSent = <C extends string>(code: C): BridgeRefused<C> => ({ ok: false, code, status: 0, reason: '' });

interface PostOptions {
    /** The bridge's /status.features: without the route's feature nothing is sent (`unsupported`). */
    features: Features;
    timeoutMs?: number;
}

/** POST /verify: re-verify a person's, a family's facts or one fact (`dry`: only say what it would do). */
export function postVerify(base: string, target: VerifyTarget, opts: PostOptions & { dry?: boolean }): Promise<VerifyResult> {
    if (!bridgeVerifies(opts.features, VERIFY_FEATURE)) return Promise.resolve(notSent('unsupported'));
    const payload = verifyRequestBody(target, opts.dry === true);
    if (!payload) return Promise.resolve(notSent('invalid'));
    return bridgePost(base, 'verify', payload, verifyReply, notSent<VerifyErrorCode>('network'), opts.timeoutMs ?? VERIFY_TIMEOUT_MS);
}

/** POST /verify/bulk: re-verify a line, a lineage or the whole tree. */
export function postVerifyBulk(base: string, req: VerifyBulkRequest, opts: PostOptions): Promise<VerifyBulkResult> {
    if (!bridgeVerifies(opts.features, VERIFY_BULK_FEATURE)) return Promise.resolve(notSent('unsupported'));
    const payload = verifyBulkRequestBody(req);
    if (!payload) return Promise.resolve(notSent('invalid'));
    return bridgePost(base, 'verify/bulk', payload, verifyBulkReply, notSent<VerifyErrorCode>('network'), opts.timeoutMs ?? VERIFY_TIMEOUT_MS);
}

/**
 * POST /verify/stop: drop the re-verification tasks not yet begun (`scope`:
 * 'bulk' only the bulk ones; none: all). Nothing to stop is `ok` with 0.
 */
export function postVerifyStop(base: string, opts: PostOptions & { scope?: VerifyStopScope }): Promise<VerifyStopResult> {
    if (!bridgeVerifies(opts.features, VERIFY_STOP_FEATURE)) return Promise.resolve(notSent('unsupported'));
    const payload = verifyStopRequestBody(opts.scope);
    if (!payload) return Promise.resolve(notSent('invalid'));
    return bridgePost(base, 'verify/stop', payload, verifyStopReply, notSent<VerifyErrorCode>('network'), opts.timeoutMs ?? VERIFY_TIMEOUT_MS);
}

/** POST /facts/confirm: confirm a fact from the scan (`confirm: false`: take the confirmation back). */
export function postFactConfirm(base: string, fact: string, confirm: boolean, opts: PostOptions): Promise<FactConfirmResult> {
    if (!bridgeVerifies(opts.features, FACTS_CONFIRM_FEATURE)) return Promise.resolve(notSent('unsupported'));
    const payload = factConfirmRequestBody(fact, confirm);
    if (!payload) return Promise.resolve(notSent('invalid'));
    return bridgePost(base, 'facts/confirm', payload, (status, json) => factConfirmReply(payload.fact, status, json),
        notSent<FactConfirmErrorCode>('network'), opts.timeoutMs ?? VERIFY_TIMEOUT_MS);
}

// ==================== /status verify ====================

/** `/status verify` (spec 065): counts of facts by their re-verification state. */
export interface LiveVerifyStatus {
    /** Waiting for an agent (`wait`). */
    waiting: number;
    /** Asked by a person (`asked`). */
    asked: number;
    /** Waiting for scans (`images`). */
    images: number;
    /** Waiting for an archive's permission (`permission`). */
    permission: number;
    /** Kept as they were after a check (`kept`). */
    kept: number;
    /** Confirmed by a person. */
    confirmed: number;
    /** A run of re-verification under way: since when, and how many facts of how many people. */
    fix?: { at: string; facts: number; people: number };
}

/** `fix.at`: "2026-11-08T22:41:07.123Z" (ISO 8601, UTC, date and time). */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/;

/**
 * `verify` of /status, read only when `features` names `verify` and the tree
 * is neither an archive nor waiting for its agent (the research leaves it out
 * there). A count that is not one reads as 0; nothing valid: absent.
 */
export function verifyStatusSaid(r: Record<string, unknown>, features: readonly string[] | null): Pick<LiveStatus, 'verify'> {
    if (!features?.includes(VERIFY_FEATURE)) return {};
    const tree = asRecord(r.tree);
    if (features.includes(TREE_STATE_FEATURE) && (tree?.state === 'archive' || tree?.state === 'waiting')) return {};
    if (features.includes(TREE_KIND_FEATURE) && tree?.kind === 'archive') return {};
    const v = asRecord(r.verify);
    if (!v) return {};
    const out: LiveVerifyStatus = {
        waiting: countOf(v.waiting) ?? 0,
        asked: countOf(v.asked) ?? 0,
        images: countOf(v.images) ?? 0,
        permission: countOf(v.permission) ?? 0,
        kept: countOf(v.kept) ?? 0,
        confirmed: countOf(v.confirmed) ?? 0,
    };
    // A run of re-verification: an ISO 8601 UTC date and time with whole counts, else none.
    const fix = asRecord(v.fix);
    const at = typeof fix?.at === 'string' && ISO_UTC.test(fix.at) && Number.isFinite(Date.parse(fix.at)) ? fix.at : '';
    const facts = countOf(fix?.facts);
    const people = countOf(fix?.people);
    if (at && facts !== null && people !== null) out.fix = { at, facts, people };
    return { verify: out };
}
