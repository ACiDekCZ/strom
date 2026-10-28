/**
 * The research bridge's `/quality` (spec 021 §D): a finding of the tree check
 * marked "not an error" goes to the research (`POST <token>/quality/dismiss`,
 * `do: "undo"` takes it back), and the research tells its marks
 * (`GET <token>/quality`). Simple requests (text/plain JSON, no cookies) like
 * the other writes; replies typed; never throws. The device's record of what
 * the research holds (the base of the three-way merge) is kept beside the
 * other side records, never in the tree.
 */

import { cleanText, isResearchHead, withAppVersion } from './research-link.js';
import { writeHeldOfRefusal } from './research-write-held.js';
import { parseQualityReply, researchMarkKey, type ResearchQualityMark } from './quality-dismiss.js';
import { saveSideRecord, loadSideRecord, deleteSideRecord } from './share-baselines.js';
import { qualityBridgeKey } from './storage-keys.js';
import { parseDuplicatesReply } from './duplicate-verdicts.js';

export const QUALITY_WRITE_TIMEOUT_MS = 15_000;
export const QUALITY_READ_TIMEOUT_MS = 15_000;
/** The longest reply read (a list of marks). */
const MAX_REPLY = 2_000_000;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

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
        const text = await res.text();
        return { status: res.status, text: text.length > MAX_REPLY ? '' : text };
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function jsonOf(text: string): unknown {
    try { return JSON.parse(text); } catch { return null; }
}

/** The body of `POST /quality/dismiss` (the research's P… numbers). */
export interface QualityDismissBody {
    kind: string;
    persons: string[];
    subject?: string;
    do?: 'undo';
}

export type QualityDismissResult =
    | { ok: true; rev: string; head: string; parent: string }
    | {
        ok: false;
        /**
         * - `invalid` (400 quality.body, 404 person.no-match): never goes — the mark stays in the app only;
         * - `held` (sealed elsewhere, files not downloaded, disk full), `busy` (503 research.busy),
         *   `network` (no answer), `unknown` (any other answer): kept, tried again at the next status.
         */
        code: 'invalid' | 'held' | 'busy' | 'network' | 'unknown';
        status: number;
    };

/** The reply to `POST /quality/dismiss`, typed. */
export function dismissReply(status: number, body: unknown, features: readonly string[] | null | undefined): QualityDismissResult {
    const code = bridgeCode(body);
    const r = asRecord(body) ?? {};
    if (status >= 200 && status < 300) {
        if (r.ok !== true) return { ok: false, code: 'unknown', status };
        return {
            ok: true,
            rev: cleanText(r.rev, 128),
            head: isResearchHead(r.head) ?? '',
            parent: isResearchHead(r.parent) ?? '',
        };
    }
    if (writeHeldOfRefusal(code, r.error, features, r.params)) return { ok: false, code: 'held', status };
    if ((status === 400 && code === 'quality.body') || (status === 404 && code === 'person.no-match')) return { ok: false, code: 'invalid', status };
    if (status === 400 || status === 404) return { ok: false, code: 'invalid', status };
    if (status === 503 || code === 'research.busy') return { ok: false, code: 'busy', status };
    return { ok: false, code: 'unknown', status };
}

/** Mark a finding "not an error" in the research (or take the mark back with `do: "undo"`). */
export async function postQualityDismiss(base: string, body: QualityDismissBody, features: readonly string[] | null | undefined,
    opts: { timeoutMs?: number } = {}): Promise<QualityDismissResult> {
    const res = await request(`${base}/quality/dismiss`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify(body),
    }, opts.timeoutMs ?? QUALITY_WRITE_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0 };
    return dismissReply(res.status, jsonOf(res.text), features);
}

/** The research's marks (`GET /quality`), or null (no answer, refused, not a reply the app reads). */
export async function fetchQualityMarks(base: string, opts: { timeoutMs?: number } = {}): Promise<{ rev: string; dismissed: ResearchQualityMark[] } | null> {
    const res = await request(`${base}/quality`, { method: 'GET' }, opts.timeoutMs ?? QUALITY_READ_TIMEOUT_MS);
    if (!res || res.status < 200 || res.status >= 300) return null;
    return parseQualityReply(jsonOf(res.text));
}

// ==================== The device's record ====================

/**
 * What this device knows of a research's `/quality`: whether its bridge took
 * the marks the last time it said (`dismiss`, so a mark made while it does
 * not run waits for it), and the marks it knows the research holds
 * (`acked`, by the research's P… numbers) — its own confirmed sends and what
 * it last read. A mark the tree lost that the research holds is taken back
 * there; one the research lost that the device knew it held was taken back
 * in the research.
 */
export interface QualityBridgeRecord {
    dismiss: boolean;
    /**
     * The bridge judged possible duplicates (`duplicates.judge`) the last time
     * it said: while it does not run, the tree check says it is not assessed.
     */
    judge: boolean;
    acked: QualityDismissBody[];
}

export function sanitizeQualityBridgeRecord(raw: unknown): QualityBridgeRecord {
    const r = asRecord(raw);
    const acked: QualityDismissBody[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(r?.acked) ? r!.acked as unknown[] : []) {
        const m = asRecord(item);
        if (!m || typeof m.kind !== 'string' || !m.kind || !Array.isArray(m.persons)) continue;
        const persons = m.persons.filter((p): p is string => typeof p === 'string' && /^P\d{1,7}$/.test(p)).sort();
        if (persons.length === 0 || persons.length !== m.persons.length) continue;
        const body: QualityDismissBody = { kind: m.kind, persons, ...(typeof m.subject === 'string' && m.subject ? { subject: m.subject } : {}) };
        const key = researchMarkKey(body);
        if (seen.has(key)) continue;
        seen.add(key);
        acked.push(body);
    }
    return { dismiss: r?.dismiss === true, judge: r?.judge === true, acked };
}

export async function loadQualityBridgeRecord(researchId: string): Promise<QualityBridgeRecord> {
    try {
        return sanitizeQualityBridgeRecord(await loadSideRecord(qualityBridgeKey(researchId)));
    } catch {
        return { dismiss: false, judge: false, acked: [] };
    }
}

export async function saveQualityBridgeRecord(researchId: string, record: QualityBridgeRecord): Promise<void> {
    try {
        await saveSideRecord(qualityBridgeKey(researchId), record, Date.now());
    } catch (err) {
        console.warn('Quality bridge record not saved', err);
    }
}

/** Forget it (the last tree of the research deleted). */
export async function deleteQualityBridgeRecord(researchId: string): Promise<void> {
    await deleteSideRecord(qualityBridgeKey(researchId)).catch(() => undefined);
}

// ==================== Verdicts on possible duplicates ====================

export const DUPLICATES_TIMEOUT_MS = 15_000;

/**
 * The research's verdicts on pairs of its people (`POST <token>/duplicates`,
 * a read: nothing is written). Null: no answer, refused (400, 503 busy) or
 * not a reply the app reads.
 */
export async function postDuplicates(base: string, pairs: ReadonlyArray<readonly [string, string]>,
    opts: { timeoutMs?: number } = {}): Promise<ReturnType<typeof parseDuplicatesReply>> {
    const res = await request(`${base}/duplicates`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify({ pairs }),
    }, opts.timeoutMs ?? DUPLICATES_TIMEOUT_MS);
    if (!res || res.status < 200 || res.status >= 300) return null;
    return parseDuplicatesReply(jsonOf(res.text));
}
