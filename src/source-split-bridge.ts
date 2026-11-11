/**
 * The research bridge's routes of splitting older locations (spec 075 §5,
 * feature `sources.split`): the preview (`GET <token>/sources/split[?all=1]`),
 * the split on the person's click (`POST <token>/sources/split {plan}`) and its
 * undo (`POST <token>/sources/split/undo {undo}`). The bridge's `locator` is
 * the app's `reference` (the other location). Simple requests (text/plain
 * JSON, no cookies) like the other writes; replies typed; never throws.
 */

import { cleanText, isResearchHead, withAppVersion } from './research-link.js';
import type { SplitPlace, SplitPreview, SplitRow, SplitUndoInfo } from './source-split.js';

/** How long a reading or a write may take (the research commits the split). */
export const SPLIT_BRIDGE_TIMEOUT_MS = 15_000;
/** The preview's mark (`plan`), given back with the split. */
export const SPLIT_PLAN_RE = /^[0-9a-f]{16}$/;
/** A split's undo id (`YYYYMMDDhhmmss-<6 hex>`). */
export const SPLIT_UNDO_RE = /^\d{14}-[0-9a-f]{6}$/;
/** The longest reply read (a preview of every source). */
const MAX_REPLY_BYTES = 8 * 1024 * 1024;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

const countOf = (v: unknown): number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : 0;

function bridgeCode(body: unknown): string {
    const r = asRecord(body);
    return typeof r?.code === 'string' && /^[a-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
}

/** One side of a row (`before` / `after`): the bridge's locator as the other location. */
function placeOf(v: unknown): SplitPlace {
    const r = asRecord(v) ?? {};
    const text = (x: unknown): string => cleanText(x, 400);
    const reference = text(r.locator);
    const folio = text(r.folio);
    const image = text(r.image);
    return { ...(reference ? { reference } : {}), ...(folio ? { folio } : {}), ...(image ? { image } : {}) };
}

/** What the bridge's preview says: the preview and the newest split it can undo. */
export interface BridgeSplitReading {
    preview: SplitPreview;
    undo: SplitUndoInfo | null;
}

/** The newest split the research can undo (`undos[0]`), or null. */
function undoOf(v: unknown): SplitUndoInfo | null {
    const first = asRecord(Array.isArray(v) ? v[0] : null);
    if (!first || typeof first.id !== 'string' || !SPLIT_UNDO_RE.test(first.id)) return null;
    const at = typeof first.at === 'string' ? Date.parse(first.at) : NaN;
    return { id: first.id, at: Number.isFinite(at) ? at : Date.now(), count: countOf(first.sources) };
}

/**
 * The bridge's preview (`GET /sources/split`, and the `preview` of a 409
 * `source.split.plan`), or null when it is not one. `all`: asked with
 * `?all=1` (every row).
 */
export function parseBridgeSplit(body: unknown, all: boolean): BridgeSplitReading | null {
    const r = asRecord(body);
    if (!r || !Array.isArray(r.split)) return null;
    const rows: SplitRow[] = [];
    for (const x of r.split) {
        const row = asRecord(x);
        const source = cleanText(row?.source, 64);
        if (!row || !source) continue;
        rows.push({ source, title: cleanText(row.title, 400) || source, before: placeOf(row.before), after: placeOf(row.after) });
    }
    const count = Math.max(countOf(r.count), rows.length);
    const plan = typeof r.plan === 'string' && SPLIT_PLAN_RE.test(r.plan) ? r.plan : undefined;
    return {
        preview: {
            rows, count, complete: all || rows.length >= count, unrecognized: countOf(r.unrecognized),
            unrecognizedExamples: [], fromNote: 0, ...(plan ? { plan } : {}),
        },
        undo: undoOf(r.undos),
    };
}

/** Why the bridge did not answer as asked. */
export type BridgeSplitRefusal = { ok: false; code: 'busy' | 'archive' | 'network' | 'unknown'; status: number };

export type BridgeSplitReadResult = { ok: true; reading: BridgeSplitReading } | BridgeSplitRefusal;

/** The refusals all three routes share: busy (503 `research.busy`), an archive, no answer, anything else. */
function refusalOf(status: number, body: unknown): BridgeSplitRefusal {
    const code = bridgeCode(body);
    if (status === 503 || code === 'research.busy') return { ok: false, code: 'busy', status };
    if (status === 409 && code === 'source.split.archive') return { ok: false, code: 'archive', status };
    return { ok: false, code: 'unknown', status };
}

/** The reply to `GET /sources/split`, typed. */
export function bridgeSplitReadReply(status: number, body: unknown, all: boolean): BridgeSplitReadResult {
    if (status >= 200 && status < 300) {
        const reading = parseBridgeSplit(body, all);
        return reading ? { ok: true, reading } : { ok: false, code: 'unknown', status };
    }
    return refusalOf(status, body);
}

export type BridgeSplitApplyResult =
    | { ok: true; count: number; undo?: string; head: string; parent: string }
    /** 409 `source.split.plan`: the sources changed meanwhile; the preview as it is now (null: not said). */
    | { ok: false; code: 'plan'; status: number; reading: BridgeSplitReading | null }
    | BridgeSplitRefusal;

function headsOf(r: Record<string, unknown>): { head: string; parent: string } {
    return { head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
}

/** The reply to `POST /sources/split`, typed. */
export function bridgeSplitApplyReply(status: number, body: unknown): BridgeSplitApplyResult {
    const r = asRecord(body);
    if (status >= 200 && status < 300) {
        if (!r) return { ok: false, code: 'unknown', status };
        const done = asRecord(r.done) ?? {};
        return {
            ok: true, count: countOf(done.split), ...headsOf(r),
            ...(typeof r.undo === 'string' && SPLIT_UNDO_RE.test(r.undo) ? { undo: r.undo } : {}),
        };
    }
    if (status === 409 && bridgeCode(body) === 'source.split.plan') return { ok: false, code: 'plan', status, reading: parseBridgeSplit(r?.preview, false) };
    return refusalOf(status, body);
}

export type BridgeSplitUndoResult =
    | { ok: true; restored: number; head: string; parent: string }
    /** 409 `source.split.changed`: sources changed after the split (how many, the first titles); nothing undone. */
    | { ok: false; code: 'changed'; status: number; count: number; titles: string[] }
    /** 404 `source.split.undo`: the research no longer has that split to undo. */
    | { ok: false; code: 'gone'; status: number }
    | BridgeSplitRefusal;

/** The reply to `POST /sources/split/undo`, typed. */
export function bridgeSplitUndoReply(status: number, body: unknown): BridgeSplitUndoResult {
    const r = asRecord(body);
    if (status >= 200 && status < 300) {
        if (!r) return { ok: false, code: 'unknown', status };
        return { ok: true, restored: countOf(asRecord(r.undone)?.restored), ...headsOf(r) };
    }
    const code = bridgeCode(body);
    if (status === 409 && code === 'source.split.changed') {
        const list = Array.isArray(r?.sources) ? r.sources : [];
        const titles = list.map(x => { const s = asRecord(x); return cleanText(s?.title, 200) || cleanText(s?.id, 64); }).filter(Boolean);
        return { ok: false, code: 'changed', status, count: Math.max(countOf(r?.count), titles.length), titles };
    }
    if (status === 404 && code === 'source.split.undo') return { ok: false, code: 'gone', status };
    return refusalOf(status, body);
}

async function request(url: string, init: RequestInit): Promise<{ status: number; body: unknown } | null> {
    if (typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), SPLIT_BRIDGE_TIMEOUT_MS) : null;
    try {
        const res = await fetch(withAppVersion(url), { mode: 'cors', credentials: 'omit', cache: 'no-store', ...init, signal: ctl?.signal });
        const text = await res.text();
        if (text.length > MAX_REPLY_BYTES) return { status: res.status, body: null };
        let body: unknown = null;
        try { body = JSON.parse(text); } catch { /* not JSON */ }
        return { status: res.status, body };
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const NETWORK: BridgeSplitRefusal = { ok: false, code: 'network', status: 0 };

const post = (base: string, path: string, body: unknown) => request(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify(body),
});

/** What splitting the older locations would do (`base`: the bridge's address with its token; `all`: every row). */
export async function getBridgeSplit(base: string, all = false): Promise<BridgeSplitReadResult> {
    const res = await request(`${base}/sources/split${all ? '?all=1' : ''}`, { method: 'GET' });
    return res ? bridgeSplitReadReply(res.status, res.body, all) : NETWORK;
}

/** The split the preview (`plan`) showed, as one operation of the research. */
export async function postBridgeSplit(base: string, plan: string): Promise<BridgeSplitApplyResult> {
    if (!SPLIT_PLAN_RE.test(plan)) return { ok: false, code: 'unknown', status: 0 };
    const res = await post(base, '/sources/split', { plan });
    return res ? bridgeSplitApplyReply(res.status, res.body) : NETWORK;
}

/** That split taken back whole. */
export async function postBridgeSplitUndo(base: string, undo: string): Promise<BridgeSplitUndoResult> {
    if (!SPLIT_UNDO_RE.test(undo)) return { ok: false, code: 'gone', status: 0 };
    const res = await post(base, '/sources/split/undo', { undo });
    return res ? bridgeSplitUndoReply(res.status, res.body) : NETWORK;
}
