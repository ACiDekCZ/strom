/**
 * Tree fixes of the research (symbols of history §7, ZADANI_VYZKUM §1): the
 * bridge's `GET <token>/fixes` lists the bulk data fixes the research can
 * apply after an older version of it. The app only shows them and opens the
 * research's terminal at one (`strom-research://fixes?tree=…&id=…[&do=undo]`);
 * running and undoing are always confirmed there. A research that does not
 * announce `fixes.list` has no list here at all.
 *
 * The states stay the research's own words (`pending|declined|fixed|nothing`,
 * as `strom fixes --json`); what the app shows of them is mapped here, in one
 * place.
 */

import { withAppVersion } from './research-link.js';
import { retryAfterMs } from './surname-suggest-bridge.js';

/** In `/status.features`: the bridge serves `GET /fixes`. */
export const FIXES_LIST_FEATURE = 'fixes.list';

export const FIXES_READ_TIMEOUT_MS = 20_000;
const MAX_REPLY = 2_000_000;
const MAX_FIXES = 100;

export type ResearchFixState = 'pending' | 'declined' | 'fixed' | 'nothing';
const STATES: readonly string[] = ['pending', 'declined', 'fixed', 'nothing'];

/** What `count` counts; any other value of a newer research reads as `item`. */
export type ResearchFixUnit = 'reading' | 'place' | 'participant' | 'finding' | 'fact' | 'item';
const UNITS: readonly string[] = ['reading', 'place', 'participant', 'finding', 'fact'];

/** A fix's id in the research: what the link carries (and the research checks again). */
export const FIX_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export interface ResearchFixText { cs?: string; en?: string; de?: string }

export interface ResearchFix {
    id: string;
    title: ResearchFixText;
    summary: ResearchFixText;
    unit: ResearchFixUnit;
    count: number;
    state: ResearchFixState;
    undoable: boolean;
    /** When it was decided (fixed, or left as it is), or undone. */
    at?: string;
    /** Applied and then undone (`state: declined`, `at` = when undone). */
    undone: boolean;
    /** It reads images again with the agent (AI, costs). */
    paid: boolean;
}

export interface FixesReply {
    rev: string;
    fixes: ResearchFix[];
}

function text(raw: unknown, max: number): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const t = raw.replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, max) : undefined;
}

function localized(raw: unknown, max: number): ResearchFixText {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const out: ResearchFixText = {};
    for (const lang of ['cs', 'en', 'de'] as const) {
        const t = text(r[lang], max);
        if (t) out[lang] = t;
    }
    return out;
}

function parseFix(raw: unknown): ResearchFix | null {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!r || typeof r.id !== 'string' || !FIX_ID_RE.test(r.id)) return null;
    if (typeof r.state !== 'string' || !STATES.includes(r.state)) return null;
    const title = localized(r.title, 200);
    if (!title.cs && !title.en && !title.de) return null;
    const count = typeof r.count === 'number' && Number.isFinite(r.count) && r.count >= 0 ? Math.floor(r.count) : 0;
    const at = typeof r.at === 'string' && r.at.length <= 40 && Number.isFinite(Date.parse(r.at)) ? r.at : undefined;
    return {
        id: r.id,
        title,
        summary: localized(r.summary, 1200),
        unit: typeof r.unit === 'string' && UNITS.includes(r.unit) ? r.unit as ResearchFixUnit : 'item',
        count,
        state: r.state as ResearchFixState,
        undoable: r.undoable === true,
        ...(at ? { at } : {}),
        undone: r.undone === true,
        paid: r.paid === true,
    };
}

/** The bridge's reply, or null when it is not one; fixes the app cannot read are left out. */
export function parseFixesReply(raw: unknown): FixesReply | null {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!r || !Array.isArray(r.fixes)) return null;
    const seen = new Set<string>();
    const fixes: ResearchFix[] = [];
    for (const item of r.fixes.slice(0, MAX_FIXES)) {
        const fix = parseFix(item);
        if (!fix || seen.has(fix.id)) continue;
        seen.add(fix.id);
        fixes.push(fix);
    }
    return { rev: typeof r.rev === 'string' ? r.rev.slice(0, 80) : '', fixes };
}

/** A text in the language of the app, else in another one. */
export function fixText(t: ResearchFixText, lang: string): string {
    return (lang === 'cs' || lang === 'en' || lang === 'de' ? t[lang] : undefined) ?? t.en ?? t.cs ?? t.de ?? '';
}

/**
 * How a fix shows in the app:
 * - `available` (pending): "Open in the research";
 * - `opened`: opened from here in this session, its decision in the research ("confirm it there"), no action;
 * - `applied` (fixed): "Undo in the research" when undoable;
 * - `undone` (declined after an undo): "Open in the research" (to ask for it again);
 * - `declined` (left as it is): "Open in the research".
 * `nothing` (nothing to fix in this research) is not shown.
 */
export type FixView = 'available' | 'opened' | 'applied' | 'undone' | 'declined';

export interface FixRow {
    fix: ResearchFix;
    view: FixView;
    /** The link's action: `open` (`&id=`), `undo` (`&id=&do=undo`), none. */
    action: 'open' | 'undo' | null;
}

const VIEW_ORDER: Record<FixView, number> = { available: 0, opened: 1, applied: 2, undone: 3, declined: 3 };

function viewOf(fix: ResearchFix, opened: ReadonlySet<string>): FixView | null {
    if (fix.state === 'nothing') return null;
    // Opened from here (a row with an action): the decision is the research's now.
    if (opened.has(fix.id) && !(fix.state === 'fixed' && !fix.undoable)) return 'opened';
    switch (fix.state) {
        case 'pending': return 'available';
        case 'fixed': return 'applied';
        case 'declined': return fix.undone ? 'undone' : 'declined';
    }
}

/** The rows in their order: available, opened, applied (newest first), then undone and left as they are (newest first). */
export function fixRows(reply: FixesReply, opened: ReadonlySet<string> = new Set()): FixRow[] {
    const rows: FixRow[] = [];
    for (const fix of reply.fixes) {
        const view = viewOf(fix, opened);
        if (!view) continue;
        const action = view === 'available' || view === 'undone' || view === 'declined' ? 'open'
            : view === 'applied' && fix.undoable ? 'undo' : null;
        rows.push({ fix, view, action });
    }
    const time = (f: ResearchFix): number => (f.at ? Date.parse(f.at) : 0) || 0;
    return rows
        .map((row, i) => ({ row, i }))
        .sort((a, b) => VIEW_ORDER[a.row.view] - VIEW_ORDER[b.row.view]
            || (VIEW_ORDER[a.row.view] >= 2 ? time(b.row.fix) - time(a.row.fix) : 0)
            || a.i - b.i)
        .map(x => x.row);
}

/** Fixes waiting for a decision (the count at the menu item). */
export function availableFixCount(reply: FixesReply | null): number {
    return reply ? reply.fixes.filter(f => f.state === 'pending').length : 0;
}

/** Nothing to do (the empty state): no fix waits and none applied can be undone. */
export function fixesEmpty(reply: FixesReply | null): boolean {
    return !reply || !reply.fixes.some(f => f.state === 'pending' || (f.state === 'fixed' && f.undoable));
}

// ==================== The bridge ====================

export type FixesFetchResult =
    | { ok: true; reply: FixesReply }
    /** `missing`: the bridge does not know `/fixes`; `error`: no answer, still busy, or a reply the app does not read. */
    | { ok: false; code: 'missing' | 'error' };

type Raw = { status: number; text: string; retryAfter: string | null } | null;

async function get(url: string, timeoutMs: number): Promise<Raw> {
    if (typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
        const res = await fetch(withAppVersion(url), {
            method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ctl?.signal,
        });
        const body = await res.text();
        return { status: res.status, text: body.length > MAX_REPLY ? '' : body, retryAfter: res.headers.get('Retry-After') };
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function jsonOf(body: string): unknown {
    try { return JSON.parse(body); } catch { return null; }
}

function isBusy(res: Raw): boolean {
    if (!res) return false;
    if (res.status === 503) return true;
    return (jsonOf(res.text) as { code?: unknown } | null)?.code === 'research.busy';
}

/** The research's fixes (`GET /fixes`); a busy research is asked once more after its Retry-After. Never throws. */
export async function fetchResearchFixes(base: string, opts: { timeoutMs?: number; wait?: (ms: number) => Promise<void> } = {}): Promise<FixesFetchResult> {
    const timeout = opts.timeoutMs ?? FIXES_READ_TIMEOUT_MS;
    const wait = opts.wait ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    let res = await get(`${base}/fixes`, timeout);
    if (isBusy(res)) {
        await wait(retryAfterMs(res!.retryAfter));
        res = await get(`${base}/fixes`, timeout);
    }
    if (!res || isBusy(res)) return { ok: false, code: 'error' };
    if (res.status === 404 || res.status === 405 || res.status === 501) return { ok: false, code: 'missing' };
    if (res.status < 200 || res.status >= 300) return { ok: false, code: 'error' };
    const reply = parseFixesReply(jsonOf(res.text));
    return reply ? { ok: true, reply } : { ok: false, code: 'error' };
}
