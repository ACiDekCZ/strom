/**
 * Confirming the research's transcript of a source from the app (spec 022):
 * "I read it from the record and it agrees", without changing the text — and
 * taking that back. Only through the bridge (`POST <token>/sources/confirm
 * {source, txt, confirm}`), never in a file: the research writes the user's
 * reading of that very wording and says it back in its file (`2 _CONF` /
 * `2 _TXT` under `1 _STROM_READ`). The wording's mark (`_TXT`) is the
 * research's own and opaque here: it is only given back.
 *
 * What a source allows (sourceConfirmAction), what the app offers now
 * (sourceConfirmOffer), the request and its answer typed (postSourceConfirm,
 * sourceConfirmReply). Nothing here changes the tree.
 */

import { cleanText, isResearchHead, withAppVersion } from './research-link.js';
import { writeHeldOfRefusal } from './research-write-held.js';
import type { ResearchWriteHeld, Source, SourceReadBy } from './types.js';

/** The bridge's /status feature: it takes POST <token>/sources/confirm and writes _CONF / _TXT. */
export const SOURCES_CONFIRM_FEATURE = 'sources.confirm';

/** How long the research has to write a confirmation (it commits). */
export const SOURCE_CONFIRM_TIMEOUT_MS = 15_000;

/** The research's mark of a wording, as it may be given back (`[A-Za-z0-9_-]`, at most 64). */
export function isTranscriptMark(v: unknown): v is string {
    return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

/** A day of a confirmation (ISO `YYYY-MM-DD`, a real date). */
export function isConfirmDay(v: unknown): v is string {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The research's id of a source (`S0042`), or null. */
export function sourceConfirmRef(refn: unknown): string | null {
    const ref = typeof refn === 'string' ? refn.trim() : '';
    return /^S\d{1,9}$/.test(ref) ? ref : null;
}

/** Who read a source and whether the user's part is a confirmation, as the app shows it. */
export interface SourceReadState {
    read: SourceReadBy | undefined;
    /** The day of the confirmation ('' none). */
    conf: string;
    /** The research's mark of the wording ('' none). */
    txt: string;
}

export function sourceReadState(src: Pick<Source, 'readBy' | 'readConfirmed' | 'readMark'>): SourceReadState {
    const read = src.readBy === 'user' || src.readBy === 'research' || src.readBy === 'both' ? src.readBy : undefined;
    return {
        read,
        conf: read && isConfirmDay(src.readConfirmed) ? src.readConfirmed : '',
        txt: read && isTranscriptMark(src.readMark) ? src.readMark : '',
    };
}

export type SourceConfirmAction = 'confirm' | 'unconfirm';

/**
 * What the source itself allows: confirm a transcript only the research read
 * (`research` with its mark), take back a confirmation (`both` with `_CONF`).
 * Nothing for a source without a transcript, without the research's id or
 * mark, one the user read in another way (`user`, `both` without `_CONF`).
 */
export function sourceConfirmAction(src: Pick<Source, 'transcript' | 'refn'>, state: SourceReadState): SourceConfirmAction | null {
    if (!src.transcript?.trim() || !sourceConfirmRef(src.refn) || !state.txt) return null;
    if (state.read === 'research') return 'confirm';
    if (state.read === 'both' && state.conf) return 'unconfirm';
    return null;
}

/**
 * What the viewer offers: nothing; the action at rest with its sentence (the
 * bridge said the feature before and is not running now); or the action.
 */
export type SourceConfirmOffer =
    | { kind: 'none' }
    | { kind: 'rest'; action: SourceConfirmAction }
    | { kind: 'ready'; action: SourceConfirmAction };

export function sourceConfirmOffer(action: SourceConfirmAction | null, env: {
    /** The bridge's features: as it says them now, else as it last said them in this page (null: never). */
    features: readonly string[] | null | undefined;
    /** The bridge answers now. */
    bridgeUp: boolean;
    /** An archive, or a research waiting for its agent. */
    agentless: boolean;
    /** The tree is read-only here (a view, a locked file, newer data); following the research does not count. */
    readOnly: boolean;
}): SourceConfirmOffer {
    if (!action || env.agentless || env.readOnly) return { kind: 'none' };
    if (!env.features?.includes(SOURCES_CONFIRM_FEATURE)) return { kind: 'none' };
    return env.bridgeUp ? { kind: 'ready', action } : { kind: 'rest', action };
}

// ==================== THE REQUEST ====================

export interface SourceConfirmBody {
    source: string;
    txt: string;
    confirm: boolean;
}

/** The research wrote it (200; the same state again: 200, nothing written). */
export interface SourceConfirmDone {
    ok: true;
    source: string;
    read: SourceReadBy;
    /** The day of the confirmation ('' after taking it back). */
    conf: string;
    txt: string;
    /** The research's version after the write ('' = not said). */
    head: string;
    parent: string;
}

/**
 * Why nothing was written:
 * - `changed` (409 confirm.changed): the wording changed meanwhile — `txt` is the wording now; wait for the new file;
 * - `merged` (409, `into`): the source was merged into another; `retracted` (409): taken out, nothing to confirm;
 * - `reader` (409): not the research's reading, or the user's own of another kind; `archive` (409);
 * - `none` (404): no such source in the research; `invalid` (400, or not sent: the body is not one it takes);
 * - `busy` (503 research.busy); `locked` (423, a newer tree); `held`: sealed elsewhere, not downloaded, disk full;
 * - `failed` (500 confirm.failed); `network`: no answer; `unknown`: anything else (an older bridge without the route).
 */
export type SourceConfirmError = 'changed' | 'merged' | 'retracted' | 'reader' | 'archive' | 'none' | 'invalid'
    | 'busy' | 'locked' | 'held' | 'failed' | 'network' | 'unknown';

export interface SourceConfirmRefused {
    ok: false;
    code: SourceConfirmError;
    /** The HTTP status (0: no answer, or not sent). */
    status: number;
    /** The bridge's own sentence ('' none). */
    reason: string;
    /** `changed`: the wording's mark now. */
    txt?: string;
    /** `merged`: the source it went into. */
    into?: string;
    held?: ResearchWriteHeld;
}

export type SourceConfirmResult = SourceConfirmDone | SourceConfirmRefused;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** The body as it goes (exactly the three keys), or null when it is not one the research takes. */
export function sourceConfirmRequestBody(body: SourceConfirmBody): SourceConfirmBody | null {
    const source = sourceConfirmRef(body.source);
    if (!source || source !== body.source || !isTranscriptMark(body.txt) || typeof body.confirm !== 'boolean') return null;
    return { source, txt: body.txt, confirm: body.confirm };
}

/** The bridge's answer to a confirmation, typed (`status`: its HTTP status; `body`: its JSON, null when none). */
export function sourceConfirmReply(sent: SourceConfirmBody, status: number, body: unknown,
    features: readonly string[] | null | undefined): SourceConfirmResult {
    const r = asRecord(body) ?? {};
    const code = typeof r.code === 'string' && /^[a-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
    const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
    const params = asRecord(r.params);
    const refused = (c: SourceConfirmError, extra: Partial<SourceConfirmRefused> = {}): SourceConfirmRefused =>
        ({ ok: false, code: c, status, reason, ...extra });
    if (status >= 200 && status < 300) {
        const read = r.read === 'user' || r.read === 'research' || r.read === 'both' ? r.read : null;
        const txt = isTranscriptMark(r.txt) ? r.txt : sent.txt;
        const conf = r.conf === undefined || r.conf === null ? '' : isConfirmDay(r.conf) ? r.conf : null;
        if (!asRecord(body) || r.ok !== true || sourceConfirmRef(r.source) !== sent.source || !read || conf === null) return refused('unknown');
        // A confirmation is the user's part with its day; taking it back leaves none.
        if (sent.confirm ? read !== 'both' || !conf : !!conf) return refused('unknown');
        return { ok: true, source: sent.source, read, conf, txt, head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
    }
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return refused('held', { held });
    if (status === 400) return refused('invalid');
    if (status === 404) return code === 'confirm.none' ? refused('none') : refused('unknown');
    if (status === 409) {
        if (code === 'confirm.changed') {
            const now = r.txt ?? params?.txt;
            return refused('changed', isTranscriptMark(now) ? { txt: now } : {});
        }
        if (code === 'confirm.merged') {
            const into = sourceConfirmRef(r.into ?? params?.into);
            return refused('merged', into ? { into } : {});
        }
        if (code === 'confirm.retracted') return refused('retracted');
        if (code === 'confirm.reader') return refused('reader');
        if (code === 'confirm.archive') return refused('archive');
        if (code === 'research.busy' || code === 'busy') return refused('busy');
        return refused('unknown');
    }
    if (status === 423) return refused('locked');
    if (status === 503 || code === 'research.busy') return refused('busy');
    if (status === 500 && code === 'confirm.failed') return refused('failed');
    return refused('unknown');
}

/** Confirmations on their way, one per bridge and source: a second ask while it runs gets the same answer. */
const inFlight = new Map<string, Promise<SourceConfirmResult>>();

/**
 * POST a confirmation (or taking it back) to the research's bridge (`base`:
 * its address with the token, as for /sync) and type its answer. A simple
 * request (text/plain JSON, no cookies), as the other writes. Never throws:
 * no answer is `network`.
 */
export function postSourceConfirm(base: string, body: SourceConfirmBody, features: readonly string[] | null | undefined,
    opts: { timeoutMs?: number } = {}): Promise<SourceConfirmResult> {
    const payload = sourceConfirmRequestBody(body);
    if (!payload) return Promise.resolve({ ok: false, code: 'invalid', status: 0, reason: '' });
    if (typeof fetch !== 'function') return Promise.resolve({ ok: false, code: 'network', status: 0, reason: '' });
    const key = `${base}|${payload.source}`;
    const running = inFlight.get(key);
    if (running) return running;
    const job = (async (): Promise<SourceConfirmResult> => {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? SOURCE_CONFIRM_TIMEOUT_MS) : null;
        try {
            const res = await fetch(withAppVersion(`${base}/sources/confirm`), {
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
            return sourceConfirmReply(payload, res.status, json, features);
        } catch {
            return { ok: false, code: 'network', status: 0, reason: '' };
        } finally {
            if (timer) clearTimeout(timer);
        }
    })();
    inFlight.set(key, job);
    void job.finally(() => inFlight.delete(key));
    return job;
}
