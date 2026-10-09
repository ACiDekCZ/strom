/**
 * Deciding the research's open questions from the app: a conflict made by an
 * edit in the app, by a side — keep the app's value (`take: user`) or take
 * the research's (`take: research`) — and later a hypothesis, by a variant.
 * When a conflict can be decided here at all (canDecideInApp), how
 * (conflictDecideMode: the bridge, a link into the research, or not on this
 * device), and the one request both kinds share (postBridgeDecide:
 * POST <bridge>/conflict/<X…> or /hypothesis/<H…>, its answer and its refusals
 * typed). Nothing here changes the tree: a value the research's side brings
 * only comes with loading its version.
 */

import { Person, ResearchConflict } from './types.js';
import {
    ResearchConflictTake, researchConflictRef, researchPersonRef, isResearchHead, cleanText, withAppVersion,
} from './research-link.js';

/** The bridge's /status feature: it takes POST <token>/conflict/<X…> {"do":"decide","take":…}. */
export const CONFLICT_DECIDE_FEATURE = 'conflict.decide';

/**
 * The facts a conflict decided from the app can be about (phase 1): the value
 * of an event (its date, place or value — a person's or a couple's), the name,
 * the titles of the name and the sex. Never the parents (FAMC: moving a child
 * comes later), nor EVEN — also what a conflict says when the research does
 * not know which fact it is about.
 */
const DECIDE_FACTS: ReadonlySet<string> = new Set([
    // a person's events
    'BIRT', 'DEAT', 'BAPM', 'CHR', 'CHRA', 'CONF', 'FCOM', 'BARM', 'BASM', 'ORDN', 'EDUC', 'GRAD', 'OCCU', 'RESI',
    'EMIG', 'IMMI', 'NATU', 'RELI', 'TITL', 'NATI', 'ADOP', 'WILL', 'PROB', 'BURI', 'CREM', 'CENS', 'RETI', 'BLES',
    'CAST', 'DSCR', 'IDNO', 'NCHI', 'NMR', 'PROP', 'SSN', 'FACT',
    // a couple's events
    'MARR', 'DIV', 'MARB', 'MARC', 'MARL', 'MARS', 'ANUL', 'DIVF', 'ENGA',
    // the name, its titles, the sex
    'NAME', 'NPFX', 'NSFX', 'SEX',
]);

/** The fact of a conflict is one a side can decide from the app (phase 1). */
export function conflictFactDecidable(fact: string): boolean {
    return DECIDE_FACTS.has(fact.trim().toUpperCase());
}

/**
 * The app offers to decide this conflict by a side: it is open, the research
 * marked it decidable so (`take`, a conflict made by an edit in the app), it
 * has exactly two values — the user's and the research's, each said
 * (the order of the values is no contract) —, its fact is one of phase 1, and
 * the person it is shown at is one of the research (its number). The device
 * does not matter here: off a computer the sides still show, without the
 * choices (conflictDecideMode `none`).
 */
export function canDecideInApp(conflict: ResearchConflict | null | undefined, person: Pick<Person, 'refn'> | null | undefined): boolean {
    if (!conflict || conflict.status !== 'open' || conflict.take !== true) return false;
    if (!conflictFactDecidable(conflict.fact)) return false;
    if (!researchConflictRef(conflict.id)) return false;
    const values = conflict.values;
    if (values.length !== 2) return false;
    if (!values.some(v => v.side === 'user') || !values.some(v => v.side === 'research')) return false;
    return researchPersonRef(person?.refn) !== null;
}

/** The value of each side of a conflict canDecideInApp offers (null for any other). */
export function conflictSides(conflict: ResearchConflict): { user: ResearchConflict['values'][number]; research: ResearchConflict['values'][number] } | null {
    const user = conflict.values.find(v => v.side === 'user');
    const research = conflict.values.find(v => v.side === 'research');
    return user && research && user !== research ? { user, research } : null;
}

/**
 * How a decidable conflict is decided here: through the bridge (it answers in
 * this page and says `conflict.decide`), by a link into the research (no such
 * bridge, the research on this computer takes `conflict` links), or not on
 * this device (a phone, a tablet, a browser away from the research's
 * computer). An archive the same (only its agent is never offered).
 */
export type ConflictDecideMode = 'bridge' | 'link' | 'none';

export function conflictDecideMode(env: {
    /** What the tree's bridge said in this page (its /status features); null: it does not answer here. */
    bridge: { features: readonly string[] | null | undefined } | null | undefined;
    /** The research on this computer takes `conflict` links (researchLinkAvailable('conflict')). */
    linkAvailable: boolean;
}): ConflictDecideMode {
    if (env.bridge?.features?.includes(CONFLICT_DECIDE_FEATURE)) return 'bridge';
    return env.linkAvailable ? 'link' : 'none';
}

// ==================== THE REQUEST (shared by conflicts and hypotheses) ====================

/** What is decided: a conflict (by a side), later a hypothesis (by a variant). */
export type DecideKind = 'conflict' | 'hypothesis';

export interface ConflictDecideBody {
    do: 'decide';
    take: ResearchConflictTake;
    /** Why, in the user's words (at most 200 characters); the app sends none in phase 1. */
    note?: string;
}

export interface HypothesisDecideBody {
    do: 'decide';
    /** The variant's letter ("B"). */
    variant: string;
    note?: string;
}

export type DecideBody<K extends DecideKind> = K extends 'conflict' ? ConflictDecideBody : HypothesisDecideBody;

/** The research wrote the decision (200). */
export interface DecideDone {
    ok: true;
    /** The id decided ("X0007" / "H0022"). */
    decided: string;
    /** A conflict: the side it was decided for. */
    take?: ResearchConflictTake;
    /** A hypothesis: the variant chosen. */
    variant?: string;
    /** The research's version after the write ('' = not said). */
    head: string;
    /** What it wrote, in its words (for the details; '' = not said). */
    written: string;
    /** Whose it is: the research's person ("P0012") and / or family ("F0003"). */
    person?: string;
    family?: string;
}

/**
 * Why nothing was decided:
 * - `conflict.none` / `hypothesis.none` (404): the research has no such one (any more);
 * - `conflict.decided` / `hypothesis.decided` (409): decided meanwhile elsewhere — `resolution` (and `take` /
 *   `variant`, when said) is that decision;
 * - `conflict.no-edit` (422): not decidable by a side (no `_STROM_TAKE`);
 * - `busy` (409, or the research busy: 503): a send is being written — try again;
 * - `locked` (423): another session holds the tree in the research;
 * - `network`: no answer (not running, unreachable, or not in time);
 * - `invalid`: not sent at all (the id or the body is not what the research takes);
 * - `unknown`: any other answer (an older bridge without the route, a 500).
 */
export type DecideErrorCode =
    | 'conflict.none' | 'conflict.decided' | 'conflict.no-edit'
    | 'hypothesis.none' | 'hypothesis.decided'
    | 'busy' | 'locked' | 'network' | 'invalid' | 'unknown';

export interface DecideRefused {
    ok: false;
    code: DecideErrorCode;
    /** The HTTP status (0: no answer, or not sent). */
    status: number;
    /** `*.decided`: the decision made elsewhere, in the research's words. */
    resolution?: string;
    take?: ResearchConflictTake;
    variant?: string;
    /** The bridge's own sentence (English `text`, else `error`), for the details only ('' = none). */
    reason: string;
}

export type DecideResult = DecideDone | DecideRefused;

/** How long the research has to write a decision (it commits, maybe after a send's write). */
export const DECIDE_TIMEOUT_MS = 30_000;
/** The most of a note the research takes. */
const NOTE_MAX = 200;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** The research's id of what is decided, or null. */
function decideRef(kind: DecideKind, id: unknown): string | null {
    if (kind === 'conflict') return researchConflictRef(id);
    return typeof id === 'string' && /^H\d{1,7}$/.test(id.trim()) ? id.trim() : null;
}

function takeOf(v: unknown): ResearchConflictTake | undefined {
    return v === 'user' || v === 'research' ? v : undefined;
}

function variantOf(v: unknown): string | undefined {
    return typeof v === 'string' && /^[A-Z]{1,3}$/.test(v.trim()) ? v.trim() : undefined;
}

/** The body as it goes (JSON), or null when it is not one the research takes. */
export function decideRequestBody(kind: DecideKind, body: ConflictDecideBody | HypothesisDecideBody): Record<string, string> | null {
    const rec = asRecord(body);
    if (!rec || rec.do !== 'decide') return null;
    const note = typeof rec.note === 'string' ? rec.note.trim().slice(0, NOTE_MAX) : '';
    const withNote: Record<string, string> = note ? { note } : {};
    if (kind === 'conflict') {
        const take = takeOf(rec.take);
        return take ? { do: 'decide', take, ...withNote } : null;
    }
    const variant = variantOf(rec.variant);
    return variant ? { do: 'decide', variant, ...withNote } : null;
}

/** The bridge's answer to a decision, typed (`status`: its HTTP status; `body`: its JSON, null when none). */
export function decideReply(kind: DecideKind, id: string, status: number, body: unknown): DecideResult {
    const r = asRecord(body) ?? {};
    const code = typeof r.code === 'string' && /^[a-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
    const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
    const refused = (c: DecideErrorCode, extra: Partial<DecideRefused> = {}): DecideRefused => ({ ok: false, code: c, status, reason, ...extra });
    if (status >= 200 && status < 300) {
        const said = r.decided === undefined ? id : decideRef(kind, r.decided);
        if (!asRecord(body) || said !== id) return refused('unknown');
        const take = kind === 'conflict' ? takeOf(r.take) : undefined;
        const variant = kind === 'hypothesis' ? variantOf(r.variant) : undefined;
        const person = researchPersonRef(r.person);
        const family = typeof r.family === 'string' && /^F\d{1,9}$/.test(r.family.trim()) ? r.family.trim() : null;
        return {
            ok: true,
            decided: id,
            ...(take ? { take } : {}),
            ...(variant ? { variant } : {}),
            head: isResearchHead(r.head) ?? '',
            written: cleanText(r.written, 300),
            ...(person ? { person } : {}),
            ...(family ? { family } : {}),
        };
    }
    const params = asRecord(r.params);
    if (status === 404) return code === `${kind}.none` ? refused(`${kind}.none`) : refused('unknown');
    if (status === 409) {
        if (code === `${kind}.decided`) {
            const resolution = cleanText(typeof r.resolution === 'string' ? r.resolution : params?.resolution, 300);
            const take = kind === 'conflict' ? takeOf(r.take ?? params?.take) : undefined;
            const variant = kind === 'hypothesis' ? variantOf(r.variant ?? r.chosen ?? params?.variant) : undefined;
            return refused(`${kind}.decided`, {
                ...(resolution ? { resolution } : {}), ...(take ? { take } : {}), ...(variant ? { variant } : {}),
            });
        }
        return refused('busy');
    }
    if (status === 422 && kind === 'conflict' && code === 'conflict.no-edit') return refused('conflict.no-edit');
    if (status === 423) return refused('locked');
    if (status === 503) return refused('busy');
    return refused('unknown');
}

/** Decisions on their way, one per bridge and id: a second ask while it runs gets the same answer. */
const inFlight = new Map<string, Promise<DecideResult>>();

/**
 * POST a decision to the research's bridge (`base`: its address with the
 * token, as for /sync) and type its answer. A simple request (text/plain, no
 * cookies), as the sync. Never throws: no answer is `network`.
 */
export function postBridgeDecide<K extends DecideKind>(base: string, kind: K, id: string, body: DecideBody<K>,
    opts: { timeoutMs?: number } = {}): Promise<DecideResult> {
    const ref = decideRef(kind, id);
    const payload = decideRequestBody(kind, body);
    if (!ref || ref !== id || !payload) return Promise.resolve({ ok: false, code: 'invalid', status: 0, reason: '' });
    if (typeof fetch !== 'function') return Promise.resolve({ ok: false, code: 'network', status: 0, reason: '' });
    const key = `${base}|${kind}|${ref}`;
    const running = inFlight.get(key);
    if (running) return running;
    const job = (async (): Promise<DecideResult> => {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? DECIDE_TIMEOUT_MS) : null;
        try {
            const res = await fetch(withAppVersion(`${base}/${kind}/${encodeURIComponent(ref)}`), {
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
            return decideReply(kind, ref, res.status, json);
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
