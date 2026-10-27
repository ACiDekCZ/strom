/**
 * The research bridge's routes of the history layer (spec 020): read the
 * events of the time (`GET <token>/history`), hide one or show it again
 * (`POST <token>/history/hide`), switch the search off for the tree
 * (`POST <token>/experiments {"history": false}`). Never `{"history": true}`:
 * switching the search on costs the user's agent time, so only the research's
 * own terminal does it (the `experiment` link). Simple requests (text/plain
 * JSON, no cookies) like the other writes; replies typed; never throws.
 */

import { cleanText, isResearchHead, researchPersonRef, researchSchemeUrl, withAppVersion } from './research-link.js';
import { writeHeldOfRefusal, type ResearchWriteHeld } from './research-write-held.js';
import {
    HISTORY_LIMITS, parseHistoryPayload, parseHistoryText,
    type HistoryHidden, type HistoryHideOp, type HistoryPayload,
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

/** The body of `POST /history/hide`: for a place, or for a person by REFN; `do: "show"` takes it back. */
export interface HistoryHideBody {
    event: string;
    place?: string;
    person?: string;
    do?: 'show';
}

/** The body for a queued hiding, or null when it cannot go yet (a person without a research REFN). */
export function hideRequestBody(op: HistoryHideOp): HistoryHideBody | null {
    if (!/^[A-Za-z0-9-]{1,32}$/.test(op.event)) return null;
    const body: HistoryHideBody = { event: op.event };
    if (op.place) body.place = op.place;
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
         * - `invalid` (400 history.body; 404 history.event / history.person): never goes, drop it;
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
    if (status === 404 && (code === 'history.event' || code === 'history.person')) return { ok: false, code: 'invalid', status, reason };
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
