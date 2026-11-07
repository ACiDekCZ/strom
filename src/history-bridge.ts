/**
 * The research bridge's routes of the history layer (spec 020): read the
 * events of the time (`GET <token>/history`), hide one or show it again
 * (`POST <token>/history/hide`), switch the search off for the tree
 * (`POST <token>/experiments {"history": false}`; with `experiments.split` the
 * history of regions or of places alone: `{"regions": false}` / `{"places": false}`), and the history manager's
 * writes (R1–R7): a region first, not searching a region or a place, deleting
 * an event, a place's regions by hand, a place's own history (always the
 * research terminal's link), history in stories. Never `{"history": true}`:
 * switching the search on costs the user's agent time, so only the research's
 * own terminal does it (the `experiment` link). Simple requests (text/plain
 * JSON, no cookies) like the other writes; replies typed; never throws.
 */

import {
    cleanText, isResearchHead, researchPersonRef, researchSchemeUrl, withAppVersion, type ResearchExperiment, type ResearchHypothesesDecide,
} from './research-link.js';
import { writeHeldOfRefusal, type ResearchWriteHeld } from './research-write-held.js';
import { READ_TASK_NAMES, READ_TASK_SETTING_PATH, readTaskSettingBody, sanitizeTaskSetting, type ReadTaskSetting } from './research-read-task.js';
import {
    HISTORY_ALIGN_PLAN_RE, HISTORY_ALIGN_UNDO_RE, HISTORY_KINDS, HISTORY_LIMITS, HISTORY_PLACE_ID_RE, HISTORY_REGION_RE,
    parseHistoryAlignPreview, parseHistoryDeleted, parseHistoryKindList, parseHistoryPayload, parseHistoryText, parsePlaceRegions,
    type HistoryAlignPace, type HistoryAlignPreview, type HistoryDeleted, type HistoryHidden, type HistoryHideOp, type HistoryKind,
    type HistoryPayload, type HistoryPlaceRegion,
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

/** What `POST /experiments` switches off: both searches, or (`experiments.split`) the history of regions or of places alone. */
export type ExperimentSwitch = 'history' | 'regions' | 'places';

/** The `experiment` link's name of a switch (`places` → `placeHistory`). */
export function experimentOfSwitch(which: ExperimentSwitch): ResearchExperiment {
    return which === 'places' ? 'placeHistory' : which;
}

/** The reply to `POST /experiments {"<which>": false}`, typed. */
export function experimentsOffReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    tree: string, scheme?: string, which: ExperimentSwitch = 'history'): ExperimentsOffResult {
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
            .map(d => researchSchemeUrl('experiment', { tree, experiment: experimentOfSwitch(which), experimentDo: d }, scheme))
            .filter((u): u is string => !!u);
        const link = own.includes(said) ? said : own[0];
        return { ok: false, code: 'link', status, reason, ...(link ? { link } : {}) };
    }
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return { ok: false, code: 'held', status, reason, held };
    if (status === 503 || code === 'research.busy') return { ok: false, code: 'busy', status, reason };
    return { ok: false, code: 'unknown', status, reason };
}

/**
 * Switch the research's search for events off for this tree (never on: that is
 * the research terminal's): both (`history`), or with `experiments.split` the
 * history of regions or of places alone.
 */
export async function postBridgeExperimentsOff(base: string, features: readonly string[] | null | undefined, tree: string,
    scheme?: string, opts: { timeoutMs?: number; which?: ExperimentSwitch } = {}): Promise<ExperimentsOffResult> {
    const which = opts.which ?? 'history';
    const res = await request(`${base}/experiments`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify({ [which]: false }),
    }, opts.timeoutMs ?? HISTORY_WRITE_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0, reason: '' };
    return experimentsOffReply(res.status, jsonOf(res.text), features, tree, scheme, which);
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
    /**
     * For 409 history.off: the switch the app would offer when the research says no link of its own
     * (`experiments.split`: `placeHistory` for a place's history, `regions` for a region first); default `history`.
     */
    experiment?: ResearchExperiment;
}

function ownLinks(code: string, check: LinkCheck | undefined): string[] {
    if (!check) return [];
    if (code === 'history.off') {
        // The research names the switch that is off (split: regions or places); the app's own choice first.
        const first = check.experiment ?? 'history';
        const names: ResearchExperiment[] = [first, ...(['history', 'regions', 'placeHistory'] as const).filter(n => n !== first)];
        return names
            .map(experiment => researchSchemeUrl('experiment', { tree: check.tree, experiment, experimentDo: 'on' }, check.scheme))
            .filter((u): u is string => !!u);
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

// ==================== WHO DECIDES HYPOTHESES (spec 060) ====================

/**
 * Why `POST /hypotheses {decide}` did not go:
 * - `link`: 403 `hypotheses.link` — the research confirms the choice in its terminal (`link`, the agent);
 * - `archive`: 409 `hypotheses.archive`; `invalid`: 400; `busy`: 503 research.busy;
 * - `held`: sealed elsewhere / not downloaded / disk full; `network`: no answer; `unknown`: anything else.
 */
export type HypothesesDecideError = 'link' | 'archive' | 'invalid' | 'busy' | 'held' | 'network' | 'unknown';

export type HypothesesDecideResult =
    | { ok: true; decide?: ResearchHypothesesDecide }
    | { ok: false; code: HypothesesDecideError; status: number; reason: string; bridgeCode: string; link?: string; held?: ResearchWriteHeld };

/**
 * The research's `hypotheses` link when it is the one the app would build for this tree (the same scheme
 * and tree, `decide` one of the fixed values, nothing else); rebuilt from those parameters, else null.
 */
function saidHypothesesLink(said: string, tree: string, scheme?: string): string | null {
    const m = /^([a-z0-9-]+):\/\/hypotheses\?([^#]*)$/.exec(said);
    if (!m) return null;
    const q = new URLSearchParams(m[2]);
    if ([...q.keys()].sort().join() !== 'decide,tree' || q.get('tree') !== tree) return null;
    const decide = q.get('decide');
    if (decide !== 'person' && decide !== 'agent') return null;
    const built = researchSchemeUrl('hypotheses', { tree, decide }, scheme);
    return built && built.startsWith(`${m[1]}://`) ? built : null;
}

/** The reply to `POST /hypotheses {decide}`, typed (`check`: the tree and scheme its link is checked for). */
export function hypothesesDecideReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    sent: ResearchHypothesesDecide, check: { tree: string; scheme?: string }): HypothesesDecideResult {
    const r = asRecord(body) ?? {};
    if (status >= 200 && status < 300) {
        return { ok: true, ...(r.decide === 'agent' || r.decide === 'person' ? { decide: r.decide } : {}) };
    }
    const reason = bridgeSentence(body);
    const code = bridgeCode(body);
    const out = (c: HypothesesDecideError, extra: { link?: string; held?: ResearchWriteHeld } = {}): HypothesesDecideResult =>
        ({ ok: false, code: c, status, reason, bridgeCode: code, ...extra });
    if (status === 403 && code === 'hypotheses.link') {
        const params = asRecord(r.params);
        const said = typeof r.link === 'string' ? r.link : typeof params?.link === 'string' ? params.link : '';
        const url = (said && saidHypothesesLink(said, check.tree, check.scheme))
            || researchSchemeUrl('hypotheses', { tree: check.tree, decide: sent }, check.scheme) || '';
        return out('link', url ? { link: url } : {});
    }
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return out('held', { held });
    if (status === 400) return out('invalid');
    if (status === 409 && code === 'hypotheses.archive') return out('archive');
    if (status === 503 || code === 'research.busy' || code === 'busy') return out('busy');
    return out('unknown');
}

/**
 * Who decides the research's hypotheses: `person` is written at once; `agent` the research confirms in its
 * terminal (403 `hypotheses.link` with its link) — nothing written here.
 */
export async function postBridgeHypotheses(base: string, decide: ResearchHypothesesDecide, features: readonly string[] | null | undefined,
    check: { tree: string; scheme?: string }): Promise<HypothesesDecideResult> {
    const res = await postWrite(base, '/hypotheses', { decide });
    return res ? hypothesesDecideReply(res.status, res.body, features, decide, check) : { ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' };
}

// ==================== TASK FROM A NEW READING (spec 059 §4) ====================

/**
 * Why `POST /sourceTask {sourceTask}` did not go: `archive` 409 `sourceTask.archive`; `invalid` 400;
 * `busy` 503 research.busy; `held` sealed elsewhere / not downloaded / disk full; `network` no answer; `unknown` anything else.
 */
export type ReadTaskSettingError = 'archive' | 'invalid' | 'busy' | 'held' | 'network' | 'unknown';

export type ReadTaskSettingResult =
    | { ok: true; value?: ReadTaskSetting }
    | { ok: false; code: ReadTaskSettingError; status: number; reason: string; bridgeCode: string; held?: ResearchWriteHeld };

/** The reply to `POST /sourceTask`, typed: the value the research says it keeps now. */
export function readTaskSettingReply(status: number, body: unknown, features: readonly string[] | null | undefined): ReadTaskSettingResult {
    const r = asRecord(body) ?? {};
    if (status >= 200 && status < 300) {
        const value = sanitizeTaskSetting(r[READ_TASK_NAMES.settingValue]);
        return { ok: true, ...(value ? { value } : {}) };
    }
    const reason = bridgeSentence(body);
    // The research's codes of this route are camelCase (`sourceTask.archive`).
    const code = typeof r.code === 'string' && /^[A-Za-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
    const out = (c: ReadTaskSettingError, extra: { held?: ResearchWriteHeld } = {}): ReadTaskSettingResult =>
        ({ ok: false, code: c, status, reason, bridgeCode: code, ...extra });
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return out('held', { held });
    if (status === 400) return out('invalid');
    if (status === 409 && code === 'sourceTask.archive') return out('archive');
    if (status === 503 || code === 'research.busy' || code === 'busy') return out('busy');
    return out('unknown');
}

/** The research's setting "Task from a new reading": written at once (`tree`: the research's tree, kept for the log). */
export async function postBridgeReadTask(base: string, value: ReadTaskSetting, features: readonly string[] | null | undefined,
    _check: { tree: string }): Promise<ReadTaskSettingResult> {
    const res = await postWrite(base, READ_TASK_SETTING_PATH, readTaskSettingBody(value));
    return res ? readTaskSettingReply(res.status, res.body, features) : { ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' };
}

// ==================== KINDS OF EVENTS (spec 035) ====================

/** Whose value `POST /history/kinds` writes: this research's own (`tree`) or the default of the computer's researches. */
export type HistoryKindsScope = 'tree' | 'default';

/** The body of `POST /history/kinds`: the kinds to search, or drop the research's own value (`inherit`). */
export type HistoryKindsBody =
    | { kinds: HistoryKind[]; scope: HistoryKindsScope }
    | { scope: 'tree'; inherit: true };

/** The kinds searched as the research says them after a write. */
export interface HistoryKindsState {
    kinds: HistoryKind[];
    kindsOwn: boolean;
    kindsDefault: HistoryKind[];
}

/**
 * Why a write of the kinds or of an alignment did not go:
 * - `link`: 403 `*.link` — the research's terminal decides (`link`; adding kinds, searching the added ones);
 * - `changed`: 409 history.align.changed — the preview changed (`preview`: as it is now);
 * - `invalid`: 400 (the app's fault); `gone` / `undone`: 404 history.align.undo / 409 history.align.undone;
 * - `archive`: 409 history.archive; `busy`: 503 research.busy; `held`: sealed elsewhere / not downloaded / disk full;
 * - `failed`: 500 history.kinds.failed / history.align.failed; `network`: no answer; `unknown`: anything else.
 */
export type HistoryKindsError = 'link' | 'changed' | 'invalid' | 'gone' | 'undone' | 'archive' | 'busy' | 'held' | 'failed' | 'network' | 'unknown';

export interface HistoryKindsRefusal {
    ok: false;
    code: HistoryKindsError;
    status: number;
    /** The bridge's own sentence ('' none). */
    reason: string;
    bridgeCode: string;
    /** `link`: the link to offer — the research's own only when it is one the app would build. */
    link?: string;
    /** `link` of `POST /history/kinds`: the kinds the change would add. */
    added?: HistoryKind[];
    /** `changed`: the preview as it is now. */
    preview?: HistoryAlignPreview;
    held?: ResearchWriteHeld;
}

const KINDS_NETWORK: HistoryKindsRefusal = { ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' };

/** The value of `history.kinds` for a list of kinds (`all`, `none` or the kinds). */
export function historyKindsValue(kinds: readonly HistoryKind[]): string {
    const set = new Set(kinds);
    const list = HISTORY_KINDS.filter(k => set.has(k));
    if (!list.length) return 'none';
    return list.length === HISTORY_KINDS.length ? 'all' : list.join(',');
}

/** The `history-kinds` link the app would build for a body. */
export function historyKindsLink(body: HistoryKindsBody, tree: string, scheme?: string): string | null {
    return 'inherit' in body
        ? researchSchemeUrl('history-kinds', { tree, kindsScope: 'tree', inherit: true }, scheme)
        : researchSchemeUrl('history-kinds', { tree, kindsScope: body.scope, kinds: historyKindsValue(body.kinds) }, scheme);
}

/**
 * The research's `history-kinds` link when it says what the app would say for this tree: the same scheme
 * and tree, a fixed scope and kinds from the fixed list (any value shape, `all,-law`; any order of the
 * kinds) or inherit — its parameters compared, not the text, as the research writes them in its own order
 * (`tree, kinds|inherit, scope`) and reads them in any. Returned as the app builds it from those
 * parameters (nothing else of the text goes on); else null.
 */
function saidKindsLink(said: string, tree: string, scheme?: string): string | null {
    const m = /^([a-z0-9-]+):\/\/history-kinds\?([^#]*)$/.exec(said);
    if (!m) return null;
    const q = new URLSearchParams(m[2]);
    const keys = [...q.keys()];
    const inherit = q.has('inherit');
    const want = inherit ? ['inherit', 'scope', 'tree'] : ['kinds', 'scope', 'tree'];
    // Each parameter once, nothing else.
    if (keys.length !== want.length || [...keys].sort().join() !== want.join()) return null;
    const scope = q.get('scope');
    if (q.get('tree') !== tree || (scope !== 'tree' && scope !== 'default')) return null;
    if (inherit && q.get('inherit') !== '1') return null;
    const built = inherit
        ? researchSchemeUrl('history-kinds', { tree, kindsScope: scope, inherit: true }, scheme)
        : researchSchemeUrl('history-kinds', { tree, kindsScope: scope, kinds: q.get('kinds') ?? '' }, scheme);
    return built && built.startsWith(`${m[1]}://`) ? built : null;
}

function kindsRefusal(status: number, body: unknown, features: readonly string[] | null | undefined,
    link?: { said: (s: string) => string | null; own: string | null }): HistoryKindsRefusal {
    const reason = bridgeSentence(body);
    const code = bridgeCode(body);
    const r = asRecord(body) ?? {};
    const out = (c: HistoryKindsError, extra: Partial<HistoryKindsRefusal> = {}): HistoryKindsRefusal =>
        ({ ok: false, code: c, status, reason, bridgeCode: code, ...extra });
    if (status === 403 && (code === 'history.kinds.link' || code === 'history.align.link')) {
        const said = typeof r.link === 'string' ? r.link : '';
        const url = (said && link?.said(said)) || link?.own || '';
        const added = parseHistoryKindList(r.added);
        return out('link', { ...(url ? { link: url } : {}), ...(added?.length ? { added } : {}) });
    }
    if (status === 409 && code === 'history.align.changed') {
        const preview = parseHistoryAlignPreview(r.preview);
        return out('changed', preview ? { preview } : {});
    }
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return out('held', { held });
    if (status === 400) return out('invalid');
    if (status === 404 && code === 'history.align.undo') return out('gone');
    if (status === 409 && code === 'history.align.undone') return out('undone');
    if (status === 409 && code === 'history.archive') return out('archive');
    if (status === 503 || code === 'research.busy') return out('busy');
    if (status === 500 && (code === 'history.kinds.failed' || code === 'history.align.failed')) return out('failed');
    if (status >= 500) return out('failed');
    return out('unknown');
}

export type HistoryKindsResult =
    | { ok: true; head: string; parent: string; state?: HistoryKindsState; alignSuggested: boolean }
    | HistoryKindsRefusal;

/** The reply to `POST /history/kinds`, typed (`check`: the tree and scheme the links are checked for). */
export function historyKindsReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    sent: HistoryKindsBody, check: { tree: string; scheme?: string }): HistoryKindsResult {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ...KINDS_NETWORK, code: 'unknown', status };
        const ex = asRecord(r.experiments);
        const kinds = ex ? parseHistoryKindList(ex.kinds) : null;
        const def = ex ? parseHistoryKindList(ex.kindsDefault) : null;
        const state = kinds && def && typeof ex?.kindsOwn === 'boolean' ? { kinds, kindsOwn: ex.kindsOwn, kindsDefault: def } : undefined;
        return { ok: true, ...headsOf(r), ...(state ? { state } : {}), alignSuggested: r.alignSuggested === true };
    }
    return kindsRefusal(status, body, features, {
        said: s => saidKindsLink(s, check.tree, check.scheme),
        own: historyKindsLink(sent, check.tree, check.scheme),
    });
}

/**
 * Change the kinds of events searched. Taking kinds away is written at once;
 * a change that adds one (also `inherit` that would add) is refused with the
 * research terminal's `history-kinds` link (`code: 'link'`) — nothing written.
 */
export async function postHistoryKinds(base: string, body: HistoryKindsBody, features: readonly string[] | null | undefined,
    check: { tree: string; scheme?: string }): Promise<HistoryKindsResult> {
    const send = 'inherit' in body
        ? { scope: 'tree', inherit: true }
        : { kinds: HISTORY_KINDS.filter(k => body.kinds.includes(k)), scope: body.scope };
    const res = await postWrite(base, '/history/kinds', send);
    return res ? historyKindsReply(res.status, res.body, features, body, check) : KINDS_NETWORK;
}

export type HistoryAlignPreviewResult =
    | { ok: true; preview: HistoryAlignPreview }
    | { ok: false; code: 'invalid' | 'archive' | 'busy' | 'network' | 'unknown'; status: number; reason: string };

/** The reply to `GET /history/align`, typed. */
export function historyAlignPreviewReply(status: number, body: unknown): HistoryAlignPreviewResult {
    const reason = bridgeSentence(body);
    const code = bridgeCode(body);
    if (status >= 200 && status < 300) {
        const preview = parseHistoryAlignPreview(body);
        return preview ? { ok: true, preview } : { ok: false, code: 'unknown', status, reason };
    }
    if (status === 400) return { ok: false, code: 'invalid', status, reason };
    if (status === 409 && code === 'history.archive') return { ok: false, code: 'archive', status, reason };
    if (status === 503 || code === 'research.busy') return { ok: false, code: 'busy', status, reason };
    return { ok: false, code: 'unknown', status, reason };
}

/** What aligning the events with the kinds searched would do (`kinds`: as if these were searched; nothing is set). */
export async function getHistoryAlign(base: string, kinds?: readonly HistoryKind[], opts: { timeoutMs?: number } = {}): Promise<HistoryAlignPreviewResult> {
    const q = kinds ? `?kinds=${historyKindsValue(kinds)}` : '';
    const res = await request(`${base}/history/align${q}`, { method: 'GET' }, opts.timeoutMs ?? HISTORY_WRITE_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0, reason: '' };
    return historyAlignPreviewReply(res.status, jsonOf(res.text));
}

/** The research's offer to search the added kinds in its terminal (in a 200 of `POST /history/align`). */
export interface HistoryAlignBackfillLink {
    link: string;
    /** Regions and places to search. */
    n?: number;
    sessions?: number;
    pace?: HistoryAlignPace;
}

export type HistoryAlignResult =
    | { ok: true; head: string; parent: string; done: { hidden: number; shown: number }; undo?: string; backfill?: HistoryAlignBackfillLink }
    | HistoryKindsRefusal;

const countOf = (v: unknown): number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : 0;

/** The reply to `POST /history/align`, typed. */
export function historyAlignReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    check: { tree: string; scheme?: string }): HistoryAlignResult {
    const own = researchSchemeUrl('history-align', { tree: check.tree }, check.scheme);
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ...KINDS_NETWORK, code: 'unknown', status };
        const done = asRecord(r.done) ?? {};
        const out: Extract<HistoryAlignResult, { ok: true }> = {
            ok: true, ...headsOf(r), done: { hidden: countOf(done.hidden), shown: countOf(done.shown) },
        };
        if (typeof r.undo === 'string' && HISTORY_ALIGN_UNDO_RE.test(r.undo)) out.undo = r.undo;
        const b = asRecord(r.backfill);
        if (b && own) {
            // Only the app's own link (the research's may add `prune`, which stays the terminal's own option).
            out.backfill = { link: own };
            if (countOf(b.n)) out.backfill.n = countOf(b.n);
            if (countOf(b.sessions)) out.backfill.sessions = countOf(b.sessions);
            if (b.pace === 'sometimes' || b.pace === 'rare' || b.pace === 'idle') out.backfill.pace = b.pace;
        }
        return out;
    }
    return kindsRefusal(status, body, features, { said: s => (s === own ? s : null), own });
}

/**
 * Align the events with the kinds searched: hide the events of kinds not searched and
 * show again those of kinds searched again (`hide`), and with `backfill` get the
 * research terminal's link to search the added kinds (the bridge starts no task).
 */
export async function postHistoryAlign(base: string, plan: string, opts: { hide?: boolean; backfill?: boolean },
    features: readonly string[] | null | undefined, check: { tree: string; scheme?: string }): Promise<HistoryAlignResult> {
    if (!HISTORY_ALIGN_PLAN_RE.test(plan) || (!opts.hide && !opts.backfill)) return { ...KINDS_NETWORK, code: 'invalid' };
    const res = await postWrite(base, '/history/align', {
        plan, ...(opts.hide ? { hide: true } : {}), ...(opts.backfill ? { backfill: true } : {}),
    });
    return res ? historyAlignReply(res.status, res.body, features, check) : KINDS_NETWORK;
}

export type HistoryAlignUndoResult =
    | { ok: true; head: string; parent: string; undone: { shown: number; hidden: number } }
    | HistoryKindsRefusal;

/** The reply to `POST /history/align/undo`, typed. */
export function historyAlignUndoReply(status: number, body: unknown, features: readonly string[] | null | undefined): HistoryAlignUndoResult {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ...KINDS_NETWORK, code: 'unknown', status };
        const undone = asRecord(r.undone) ?? {};
        return { ok: true, ...headsOf(r), undone: { shown: countOf(undone.shown), hidden: countOf(undone.hidden) } };
    }
    return kindsRefusal(status, body, features);
}

/** Take an alignment back as a whole (its hidings and showings; tasks stay). */
export async function postHistoryAlignUndo(base: string, undo: string, features: readonly string[] | null | undefined): Promise<HistoryAlignUndoResult> {
    if (!HISTORY_ALIGN_UNDO_RE.test(undo)) return { ...KINDS_NETWORK, code: 'invalid' };
    const res = await postWrite(base, '/history/align/undo', { undo });
    return res ? historyAlignUndoReply(res.status, res.body, features) : KINDS_NETWORK;
}
