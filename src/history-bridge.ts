/**
 * The research bridge's routes of the history layer (spec 020): read the
 * events of the time (`GET <token>/history`), hide one or show it again
 * (`POST <token>/history/hide`), switch the search off for the tree
 * (`POST <token>/experiments {"history": false}`), and the history manager's
 * writes (R1–R7): a region first, not searching a region or a place, deleting
 * an event, a place's regions by hand, a place's own history (always the
 * research terminal's link), history in stories. Never `{"history": true}`:
 * switching the search on costs the user's agent time, so only the research's
 * own terminal does it (the `experiment` link). Simple requests (text/plain
 * JSON, no cookies) like the other writes; replies typed; never throws.
 */

import { cleanText, isResearchHead, researchPersonRef, researchSchemeUrl, withAppVersion } from './research-link.js';
import { writeHeldOfRefusal, type ResearchWriteHeld } from './research-write-held.js';
import {
    HISTORY_LIMITS, HISTORY_PLACE_ID_RE, HISTORY_REGION_RE, parseHistoryDeleted, parseHistoryPayload, parseHistoryText, parsePlaceRegions,
    type HistoryDeleted, type HistoryHidden, type HistoryHideOp, type HistoryPayload, type HistoryPlaceRegion,
} from './history.js';

/** How long a read of the events may take (a large tree: up to 8 MB). */
export const HISTORY_READ_TIMEOUT_MS = 20_000;
/** How long a write may take (the research commits it). */
export const HISTORY_WRITE_TIMEOUT_MS = 15_000;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** The bridge's own sentence (`text`, else `error`), cleaned ('' = none). */
function bridgeSentence(body: unknown): string {
    const r = asRecord(body) ?? {};
    return cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
}

function bridgeCode(body: unknown): string {
    const r = asRecord(body);
    return typeof r?.code === 'string' && /^[a-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; text: string } | null> {
    if (typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
        const res = await fetch(withAppVersion(url), {
            mode: 'cors', credentials: 'omit', cache: 'no-store', ...init, signal: ctl?.signal,
        });
        const len = Number(res.headers?.get?.('Content-Length') ?? '');
        if (Number.isFinite(len) && len > HISTORY_LIMITS.bytes) {
            try { await res.body?.cancel(); } catch { /* nothing to cancel */ }
            return { status: res.status, text: '\u0000too-big' };
        }
        return { status: res.status, text: await res.text() };
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function jsonOf(text: string): unknown {
    try { return JSON.parse(text); } catch { return null; }
}

// ==================== READ ====================

export type HistoryReadResult =
    | { ok: true; payload: HistoryPayload }
    /** network: no answer; too-big: over 8 MB (the cache stays); invalid: not a reply the app reads; refused: any other status. */
    | { ok: false; code: 'network' | 'too-big' | 'invalid' | 'refused'; status: number };

/** The reply to `GET /history`, typed. `rev`: `/status.history.rev` the read was made for. */
export function historyReadReply(status: number, text: string, cachedAt: string, rev?: string): HistoryReadResult {
    if (text === '\u0000too-big') return { ok: false, code: 'too-big', status };
    if (status < 200 || status >= 300) return { ok: false, code: 'refused', status };
    if (text.length > HISTORY_LIMITS.bytes || new TextEncoder().encode(text).length > HISTORY_LIMITS.bytes) {
        return { ok: false, code: 'too-big', status };
    }
    const payload = parseHistoryText(text, cachedAt, rev);
    return payload ? { ok: true, payload } : { ok: false, code: 'invalid', status };
}

/** Read the events of the time (`base`: the bridge's address with its token). */
export async function fetchBridgeHistory(base: string, opts: { rev?: string; timeoutMs?: number; now?: () => Date } = {}): Promise<HistoryReadResult> {
    const res = await request(`${base}/history`, { method: 'GET' }, opts.timeoutMs ?? HISTORY_READ_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0 };
    return historyReadReply(res.status, res.text, (opts.now?.() ?? new Date()).toISOString(), opts.rev);
}

// ==================== HIDE ====================

/**
 * The body of `POST /history/hide`: an event for a place, for a person by
 * REFN or in the whole tree (`tree`, R2), or everything of a region in this
 * tree (`region`, R2); `do: "show"` takes it back.
 */
export interface HistoryHideBody {
    event?: string;
    place?: string;
    person?: string;
    tree?: true;
    region?: string;
    do?: 'show';
}

/** The body for a queued hiding, or null when it cannot go yet (a person without a research REFN). */
export function hideRequestBody(op: HistoryHideOp): HistoryHideBody | null {
    if (!op.event) {
        if (!op.region || !HISTORY_REGION_RE.test(op.region)) return null;
        return op.do === 'show' ? { region: op.region, do: 'show' } : { region: op.region };
    }
    if (!/^[A-Za-z0-9-]{1,32}$/.test(op.event)) return null;
    const body: HistoryHideBody = { event: op.event };
    if (op.place) body.place = op.place;
    else if (op.tree) body.tree = true;
    else {
        const person = researchPersonRef(op.personRefn);
        if (!person) return null;
        body.person = person;
    }
    if (op.do === 'show') body.do = 'show';
    return body;
}

export type HistoryHideResult =
    | { ok: true; hidden: HistoryHidden[]; head: string; parent: string }
    | {
        ok: false;
        /**
         * - `invalid` (400 history.body; 404 history.event / history.person / history.region): never goes, drop it;
         * - `held`: sealed elsewhere / files not downloaded / disk full: keep, try later;
         * - `busy` (503 research.busy): keep, try later;
         * - `network`: no answer; `unknown`: any other answer (an older bridge).
         */
        code: 'invalid' | 'held' | 'busy' | 'network' | 'unknown';
        status: number;
        reason: string;
        held?: ResearchWriteHeld;
    };

/** The reply to `POST /history/hide`, typed. */
export function hideReply(status: number, body: unknown, features: readonly string[] | null | undefined): HistoryHideResult {
    const reason = bridgeSentence(body);
    const code = bridgeCode(body);
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ok: false, code: 'unknown', status, reason };
        const parsed = parseHistoryPayload({ hidden: r.hidden }, '');
        return { ok: true, hidden: parsed?.hidden ?? [], head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
    }
    const r = asRecord(body) ?? {};
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return { ok: false, code: 'held', status, reason, held };
    if (status === 400 && code === 'history.body') return { ok: false, code: 'invalid', status, reason };
    if (status === 404 && (code === 'history.event' || code === 'history.person' || code === 'history.region')) return { ok: false, code: 'invalid', status, reason };
    if (status === 503 || code === 'research.busy') return { ok: false, code: 'busy', status, reason };
    return { ok: false, code: 'unknown', status, reason };
}

/** Hide an event (or show it again) in the research. */
export async function postBridgeHide(base: string, body: HistoryHideBody, features: readonly string[] | null | undefined,
    opts: { timeoutMs?: number } = {}): Promise<HistoryHideResult> {
    const res = await request(`${base}/history/hide`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify(body),
    }, opts.timeoutMs ?? HISTORY_WRITE_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0, reason: '' };
    return hideReply(res.status, jsonOf(res.text), features);
}

// ==================== EXPERIMENTS (off only) ====================

export type ExperimentsOffResult =
    | { ok: true; head: string; parent: string }
    | {
        ok: false;
        /** `link`: the research wants its terminal (403 experiments.link; defensive, the app never asks to switch on). */
        code: 'link' | 'held' | 'busy' | 'network' | 'unknown';
        status: number;
        reason: string;
        /** With `link`: the link to offer (the research's own only when it is one the app would build). */
        link?: string;
        held?: ResearchWriteHeld;
    };

/** The reply to `POST /experiments {"history": false}`, typed. */
export function experimentsOffReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    tree: string, scheme?: string): ExperimentsOffResult {
    const reason = bridgeSentence(body);
    const code = bridgeCode(body);
    const r = asRecord(body) ?? {};
    if (status >= 200 && status < 300) {
        return { ok: true, head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
    }
    if (status === 403 && code === 'experiments.link') {
        const params = asRecord(r.params);
        const said = typeof r.link === 'string' ? r.link : typeof params?.link === 'string' ? params.link : '';
        const own = (['off', 'on'] as const)
            .map(d => researchSchemeUrl('experiment', { tree, experiment: 'history', experimentDo: d }, scheme))
            .filter((u): u is string => !!u);
        const link = own.includes(said) ? said : own[0];
        return { ok: false, code: 'link', status, reason, ...(link ? { link } : {}) };
    }
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return { ok: false, code: 'held', status, reason, held };
    if (status === 503 || code === 'research.busy') return { ok: false, code: 'busy', status, reason };
    return { ok: false, code: 'unknown', status, reason };
}

/** Switch the research's search for events off for this tree (never on: that is the research terminal's). */
export async function postBridgeExperimentsOff(base: string, features: readonly string[] | null | undefined, tree: string,
    scheme?: string, opts: { timeoutMs?: number } = {}): Promise<ExperimentsOffResult> {
    const res = await request(`${base}/experiments`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify({ history: false }),
    }, opts.timeoutMs ?? HISTORY_WRITE_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0, reason: '' };
    return experimentsOffReply(res.status, jsonOf(res.text), features, tree, scheme);
}

// ==================== MANAGER WRITES (R1–R7) ====================

/**
 * Why a write of the history manager did not go:
 * - `invalid`: 400 history.body / stories.body (the app's fault; never again as is);
 * - `gone`: 404 history.event / history.region / history.place / history.person (read again);
 * - `off`: 409 history.off — the research does not search; `link` switches it on in its terminal;
 * - `archive`: 409 history.archive — an archive or a research waiting for its agent (`reason` = its sentence);
 * - `done`: 409 history.done — the region is done already (read again);
 * - `retracted`: 409 history.retracted — deleted by the research's agent, not restorable;
 * - `skipped`: 409 history.skipped — the region is not searched for this tree (R4: "first" waits for "Search again");
 * - `link`: 403 history.link — the research's terminal decides (`link`);
 * - `held`: sealed elsewhere / not downloaded / disk full; `busy`: 503 research.busy (or 409 busy);
 * - `network`: no answer; `unknown`: anything else (an older bridge).
 */
export type HistoryWriteError = 'invalid' | 'gone' | 'off' | 'archive' | 'done' | 'retracted' | 'skipped' | 'link' | 'held' | 'busy' | 'network' | 'unknown';

export interface HistoryWriteRefusal {
    ok: false;
    code: HistoryWriteError;
    status: number;
    /** The bridge's own sentence ('' none). */
    reason: string;
    /** The bridge's code ("history.region"; '' none). */
    bridgeCode: string;
    /** `off` / `link`: the link to offer — the research's own only when it is the one the app would build. */
    link?: string;
    held?: ResearchWriteHeld;
}

export type HistoryWriteResult<T = object> = ({ ok: true; head: string; parent: string } & T) | HistoryWriteRefusal;

/** What a write's link may be (anything else is replaced by the app's own link, or dropped). */
interface LinkCheck {
    tree: string;
    scheme?: string;
    /** For 403 history.link (R6): the place record. */
    place?: string;
}

function ownLinks(code: string, check: LinkCheck | undefined): string[] {
    if (!check) return [];
    if (code === 'history.off') {
        const u = researchSchemeUrl('experiment', { tree: check.tree, experiment: 'history', experimentDo: 'on' }, check.scheme);
        return u ? [u] : [];
    }
    if (code === 'history.link' && check.place) {
        const u = researchSchemeUrl('history', { tree: check.tree, place: check.place, historyDo: 'search' }, check.scheme);
        return u ? [u] : [];
    }
    return [];
}

/** The common shape of a refused manager write. */
export function historyWriteRefusal(status: number, body: unknown, features: readonly string[] | null | undefined,
    check?: LinkCheck): HistoryWriteRefusal {
    const reason = bridgeSentence(body);
    const code = bridgeCode(body);
    const r = asRecord(body) ?? {};
    const out = (c: HistoryWriteError, extra: Partial<HistoryWriteRefusal> = {}): HistoryWriteRefusal =>
        ({ ok: false, code: c, status, reason, bridgeCode: code, ...extra });
    if ((status === 409 && code === 'history.off') || (status === 403 && code === 'history.link')) {
        const params = asRecord(r.params);
        const said = typeof r.link === 'string' ? r.link : typeof params?.link === 'string' ? params.link : '';
        const own = ownLinks(code, check);
        const link = own.includes(said) ? said : own[0];
        return out(code === 'history.off' ? 'off' : 'link', link ? { link } : {});
    }
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return out('held', { held });
    if (status === 400 && (code === 'history.body' || code === 'stories.body')) return out('invalid');
    if (status === 404 && /^history\.(event|region|place|person)$/.test(code)) return out('gone');
    if (status === 409 && code === 'history.archive') return out('archive');
    if (status === 409 && code === 'history.done') return out('done');
    if (status === 409 && code === 'history.retracted') return out('retracted');
    if (status === 409 && code === 'history.skipped') return out('skipped');
    if (status === 503 || code === 'research.busy' || code === 'busy') return out('busy');
    return out('unknown');
}

function headsOf(body: unknown): { head: string; parent: string } {
    const r = asRecord(body) ?? {};
    return { head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
}

async function postWrite(base: string, path: string, body: unknown, timeoutMs?: number): Promise<{ status: number; body: unknown } | null> {
    const res = await request(`${base}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify(body),
    }, timeoutMs ?? HISTORY_WRITE_TIMEOUT_MS);
    return res ? { status: res.status, body: jsonOf(res.text) } : null;
}

const NETWORK: HistoryWriteRefusal = { ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' };

const regionIds = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && HISTORY_REGION_RE.test(x)))] : [];

// ---- /history/first ----

/** `POST /history/first {region}`: the region goes first in the research's queue. */
export interface HistoryFirstOk {
    region: string;
    /** The regions asked first, in order. */
    first: { region: string; at?: string }[];
}

export function firstReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    check?: LinkCheck): HistoryWriteResult<HistoryFirstOk> {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ...NETWORK, code: 'unknown', status };
        const first = (Array.isArray(r.first) ? r.first : [])
            .map(asRecord)
            .filter((x): x is Record<string, unknown> => !!x && typeof x.region === 'string' && HISTORY_REGION_RE.test(x.region))
            .map(x => ({ region: x.region as string, ...(typeof x.at === 'string' && !Number.isNaN(Date.parse(x.at)) ? { at: x.at } : {}) }));
        const region = typeof r.region === 'string' && HISTORY_REGION_RE.test(r.region) ? r.region : '';
        return { ok: true, ...headsOf(r), region, first };
    }
    return historyWriteRefusal(status, body, features, check);
}

export async function postBridgeFirst(base: string, region: string, features: readonly string[] | null | undefined,
    check?: LinkCheck): Promise<HistoryWriteResult<HistoryFirstOk>> {
    if (!HISTORY_REGION_RE.test(region)) return { ...NETWORK, code: 'invalid' };
    const res = await postWrite(base, '/history/first', { region });
    return res ? firstReply(res.status, res.body, features, check) : NETWORK;
}

// ---- /history/skip ----

export type HistorySkipBody = ({ region: string } | { place: string }) & { do?: 'undo' };

export interface HistorySkipOk {
    skip: { regions: string[]; places: string[] };
}

export function skipReply(status: number, body: unknown, features: readonly string[] | null | undefined): HistoryWriteResult<HistorySkipOk> {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ...NETWORK, code: 'unknown', status };
        const skip = asRecord(r.skip) ?? {};
        const places = Array.isArray(skip.places)
            ? [...new Set(skip.places.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 500))] : [];
        return { ok: true, ...headsOf(r), skip: { regions: regionIds(skip.regions), places } };
    }
    return historyWriteRefusal(status, body, features);
}

/** Do not search a region or a place for this tree (`do: "undo"`: search it again). */
export async function postBridgeSkip(base: string, body: HistorySkipBody, features: readonly string[] | null | undefined): Promise<HistoryWriteResult<HistorySkipOk>> {
    if ('region' in body && !HISTORY_REGION_RE.test(body.region)) return { ...NETWORK, code: 'invalid' };
    if ('place' in body && (!body.place.trim() || body.place.length > 500)) return { ...NETWORK, code: 'invalid' };
    const res = await postWrite(base, '/history/skip', body);
    return res ? skipReply(res.status, res.body, features) : NETWORK;
}

// ---- /history/delete ----

export interface HistoryDeleteBody {
    event: string;
    do?: 'restore';
}

/**
 * R4's answer `{event, scope, deleted, head, parent}`. A regional event lives
 * in the shared catalogue, not in the tree: `head` equals `parent` (no commit,
 * only `/status.history.rev` moves) — still a done write. `deleted`: the whole
 * list as `GET /history` has it now (absent: an older bridge).
 */
export interface HistoryDeleteOk {
    event?: string;
    scope?: 'region' | 'local' | 'place';
    deleted?: HistoryDeleted[];
}

export function deleteReply(status: number, body: unknown, features: readonly string[] | null | undefined): HistoryWriteResult<HistoryDeleteOk> {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ...NETWORK, code: 'unknown', status };
        const out: { ok: true; head: string; parent: string } & HistoryDeleteOk = { ok: true, ...headsOf(body) };
        if (typeof r.event === 'string' && /^[A-Za-z0-9-]{1,32}$/.test(r.event)) out.event = r.event;
        if (r.scope === 'region' || r.scope === 'local' || r.scope === 'place') out.scope = r.scope;
        if (Array.isArray(r.deleted)) {
            const deleted: HistoryDeleted[] = [];
            for (const d of r.deleted) {
                if (deleted.length >= HISTORY_LIMITS.deleted) break;
                const x = parseHistoryDeleted(d);
                if (x && !deleted.some(y => y.event === x.event)) deleted.push(x);
            }
            out.deleted = deleted;
        }
        return out;
    }
    return historyWriteRefusal(status, body, features);
}

/** Delete an event (from all trees on this computer; a local one from this tree), or restore it. */
export async function postBridgeDelete(base: string, body: HistoryDeleteBody, features: readonly string[] | null | undefined): Promise<HistoryWriteResult<HistoryDeleteOk>> {
    if (!/^[A-Za-z0-9-]{1,32}$/.test(body.event)) return { ...NETWORK, code: 'invalid' };
    const res = await postWrite(base, '/history/delete', body);
    return res ? deleteReply(res.status, res.body, features) : NETWORK;
}

// ---- /history/map ----

/** Longest note for the research (code points after NFC, P2). */
export const HISTORY_MAP_NOTE_MAX = 200;

/** A note for the research: NFC, no U+FFFD, at most 200 code points (a surrogate pair never split). */
export function historyMapNote(note: string): string {
    return Array.from(note.normalize('NFC').replace(/�/g, '').trim()).slice(0, HISTORY_MAP_NOTE_MAX).join('').trim();
}

export type HistoryMapBody =
    | { place: string; regions: HistoryPlaceRegion[] }
    | { place: string; redo: true; note?: string }
    | { place: string; do: 'auto' };

/** R5's answer: the place as its facts write it, and its regions now (null: it waits to be placed). */
export interface HistoryMapOk {
    place: string;
    map: { regions: HistoryPlaceRegion[]; manual: boolean; at?: string } | null;
}

export function mapReply(status: number, body: unknown, features: readonly string[] | null | undefined): HistoryWriteResult<HistoryMapOk> {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ...NETWORK, code: 'unknown', status };
        const place = typeof r.place === 'string' && r.place.length <= 500 ? r.place : '';
        const m = asRecord(r.map);
        const map = m ? {
            regions: parsePlaceRegions(m.regions),
            manual: m.manual === true,
            ...(typeof m.at === 'string' && !Number.isNaN(Date.parse(m.at)) ? { at: m.at } : {}),
        } : null;
        return { ok: true, ...headsOf(r), place, map };
    }
    return historyWriteRefusal(status, body, features);
}

/** A place's regions by hand, or let the research decide again (with a note), or back to the research's choice. */
export async function postBridgeMap(base: string, body: HistoryMapBody, features: readonly string[] | null | undefined): Promise<HistoryWriteResult<HistoryMapOk>> {
    if (!body.place.trim() || body.place.length > 500) return { ...NETWORK, code: 'invalid' };
    let send: HistoryMapBody = body;
    if ('regions' in body) {
        const regions = body.regions.filter(r => HISTORY_REGION_RE.test(r.id)).map(r => ({
            id: r.id,
            ...(r.from !== undefined ? { from: r.from } : {}),
            ...(r.to !== undefined ? { to: r.to } : {}),
        }));
        if (!regions.length) return { ...NETWORK, code: 'invalid' };
        send = { place: body.place, regions };
    } else if ('redo' in body) {
        const note = body.note !== undefined ? historyMapNote(body.note) : '';
        send = { place: body.place, redo: true, ...(note ? { note } : {}) };
    }
    const res = await postWrite(base, '/history/map', send);
    return res ? mapReply(res.status, res.body, features) : NETWORK;
}

// ---- /history/place ----

/**
 * `POST /history/place {place: "L0001"}`: the research always answers
 * `403 history.link` (its terminal says the estimate and asks), so the
 * refusal with `link` is the expected answer; ok only from a research that
 * says `history.place.direct`.
 */
export function placeReply(status: number, body: unknown, features: readonly string[] | null | undefined, check: LinkCheck): HistoryWriteResult {
    if (status >= 200 && status < 300) return deleteReply(status, body, features);
    return historyWriteRefusal(status, body, features, check);
}

export async function postBridgePlace(base: string, place: string, features: readonly string[] | null | undefined,
    check: Omit<LinkCheck, 'place'>): Promise<HistoryWriteResult> {
    if (!HISTORY_PLACE_ID_RE.test(place)) return { ...NETWORK, code: 'invalid' };
    const res = await postWrite(base, '/history/place', { place });
    return res ? placeReply(res.status, res.body, features, { ...check, place }) : NETWORK;
}

// ---- /stories ----

export function storiesReply(status: number, body: unknown, features: readonly string[] | null | undefined, check?: LinkCheck): HistoryWriteResult {
    if (status >= 200 && status < 300) return deleteReply(status, body, features);
    return historyWriteRefusal(status, body, features, check);
}

/** History in stories on or off (`409 history.off` for on when the research does not search: `link` switches it on). */
export async function postBridgeStories(base: string, history: boolean, features: readonly string[] | null | undefined,
    check?: LinkCheck): Promise<HistoryWriteResult> {
    const res = await postWrite(base, '/stories', { history });
    return res ? storiesReply(res.status, res.body, features, check) : NETWORK;
}
