/**
 * The research bridge's `GET <token>/surnames` (spec 021 K2.1, ZADANI_DEV
 * §4.2): the spelling suggestions of the research. A simple request (no
 * cookies) like `GET /history`; a busy research (503 `research.busy`) is
 * asked once more after its Retry-After; never throws. The last reply is
 * kept on the device per research (with the features its bridge last told),
 * so the dialog shows it again without asking, also while the research does
 * not run.
 */

import { withAppVersion } from './research-link.js';
import { parseSurnamesReply, type SurnamesReply } from './surname-suggest.js';
import { saveSideRecord, loadSideRecord, deleteSideRecord } from './share-baselines.js';
import { surnamesBridgeKey } from './storage-keys.js';

export const SURNAMES_READ_TIMEOUT_MS = 30_000;
/** The longest wait for a busy research before the one more try. */
const MAX_RETRY_AFTER_MS = 10_000;
const MAX_REPLY = 4_000_000;

export type SurnamesFetchResult =
    | { ok: true; reply: SurnamesReply }
    /**
     * - `missing`: the bridge does not know `/surnames` (an older research);
     * - `error`: no answer, still busy after the second try, or an answer the app does not read
     *   (`text`: the research's own sentence, when it gave one).
     */
    | { ok: false; code: 'missing' | 'error'; text?: string };

type Raw = { status: number; text: string; retryAfter: string | null } | null;

async function get(url: string, timeoutMs: number): Promise<Raw> {
    if (typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
        const res = await fetch(withAppVersion(url), {
            method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ctl?.signal,
        });
        const text = await res.text();
        return { status: res.status, text: text.length > MAX_REPLY ? '' : text, retryAfter: res.headers.get('Retry-After') };
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function jsonOf(text: string): unknown {
    try { return JSON.parse(text); } catch { return null; }
}

/** Retry-After in ms (seconds or an HTTP date), within bounds. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
    if (!header) return 1000;
    const secs = Number(header);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - now;
    return Number.isFinite(ms) ? Math.max(0, Math.min(MAX_RETRY_AFTER_MS, ms)) : 1000;
}

function isBusy(res: Raw): boolean {
    if (!res) return false;
    if (res.status === 503) return true;
    const body = jsonOf(res.text) as { code?: unknown } | null;
    return body?.code === 'research.busy';
}

function errorText(res: Raw): string | undefined {
    const body = res ? jsonOf(res.text) as { error?: unknown } | null : null;
    const text = typeof body?.error === 'string' ? body.error.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    return text || undefined;
}

/** The research's suggestions (`GET /surnames`). */
export async function fetchSurnameSuggestions(base: string, opts: { timeoutMs?: number; wait?: (ms: number) => Promise<void> } = {}): Promise<SurnamesFetchResult> {
    const timeout = opts.timeoutMs ?? SURNAMES_READ_TIMEOUT_MS;
    const wait = opts.wait ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    let res = await get(`${base}/surnames`, timeout);
    if (isBusy(res)) {
        await wait(retryAfterMs(res!.retryAfter));
        res = await get(`${base}/surnames`, timeout);
    }
    if (!res) return { ok: false, code: 'error' };
    if (res.status === 404 || res.status === 405 || res.status === 501) {
        const body = jsonOf(res.text) as { code?: unknown } | null;
        // A known 404 of the research's own (e.g. no tree) is an error, not an older research.
        if (typeof body?.code !== 'string' || body.code === 'not-found' || body.code === 'route.unknown') return { ok: false, code: 'missing' };
    }
    if (res.status < 200 || res.status >= 300) return { ok: false, code: 'error', text: errorText(res) };
    const reply = parseSurnamesReply(jsonOf(res.text));
    return reply ? { ok: true, reply } : { ok: false, code: 'error' };
}

// ==================== The device's record ====================

/**
 * What this device keeps of a research's suggestions: the features its
 * bridge told last (`suggest`, `read`: the dialog decides without a running
 * bridge) and the last reply with when it came.
 */
export interface SurnamesBridgeRecord {
    suggest: boolean;
    read: boolean;
    reply?: SurnamesReply;
    at?: string;
}

export function sanitizeSurnamesBridgeRecord(raw: unknown): SurnamesBridgeRecord {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    const out: SurnamesBridgeRecord = { suggest: r?.suggest === true, read: r?.read === true };
    const reply = r?.reply ? parseSurnamesReply(r.reply) : null;
    if (reply) {
        out.reply = reply;
        // The record keeps the reply's own shape: `truncated` back under `state`.
        if ((r!.reply as { truncated?: unknown }).truncated === true) reply.truncated = true;
    }
    if (typeof r?.at === 'string' && r.at.length <= 40) out.at = r.at;
    return out;
}

export async function loadSurnamesBridgeRecord(researchId: string): Promise<SurnamesBridgeRecord> {
    try {
        return sanitizeSurnamesBridgeRecord(await loadSideRecord(surnamesBridgeKey(researchId)));
    } catch {
        return { suggest: false, read: false };
    }
}

export async function saveSurnamesBridgeRecord(researchId: string, record: SurnamesBridgeRecord): Promise<void> {
    try {
        await saveSideRecord(surnamesBridgeKey(researchId), record, Date.now());
    } catch (err) {
        console.warn('Surnames bridge record not saved', err);
    }
}

/** Forget it (the last tree of the research deleted). */
export async function deleteSurnamesBridgeRecord(researchId: string): Promise<void> {
    await deleteSideRecord(surnamesBridgeKey(researchId)).catch(() => undefined);
}
