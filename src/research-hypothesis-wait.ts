/**
 * A hypothesis asked of the research from the app and not confirmed yet
 * (spec 074, DEV §4). The research's bridge does not know its terminal waits
 * for Enter (V7): the app waits for a new version of the research (`head`,
 * `/status.rev`) and reads there what became of the hypothesis. Kept in this
 * page only (never in localStorage): a reload forgets it, and the card shows
 * what the research says. The card, the pinned bubble and the row of "What
 * waits" read the same records (D3, D4 draw them).
 */

import type { ResearchHypothesis } from './types.js';
import type { ResearchHypothesisDo } from './research-link.js';

/** After this long with the same version the wait reads "Not confirmed by the research yet". */
export const HYPOTHESIS_WAIT_LONG_MS = 10 * 60_000;

/** One hypothesis asked of the research (DEV §4). */
export interface PendingHypothesis {
    /** What was asked (the link's `do`). */
    do: ResearchHypothesisDo;
    /** The version chosen (`do: 'decide'` from "Choose"). */
    variant?: string;
    /** When it was asked (ms since the epoch). */
    since: number;
    /** The link asked (for "Open again"). */
    url: string;
    /** The research's version when it was asked (or last seen with the hypothesis unchanged). */
    head: string;
    /** The hypothesis's state when it was asked (hypothesisStateKey): unchanged means not written yet. */
    state: string;
}

/**
 * What became of a hypothesis asked, once the research has a new version:
 * - `asked`: decided as asked (a version, or no version holds) — announce it;
 * - `reopened`: open again, as asked — announce it;
 * - `left-open`: left open, as asked — no announcement;
 * - `elsewhere`: it changed otherwise (decided for another version, by the agent or in the terminal) — an info line;
 * - `waiting`: the hypothesis is unchanged (something else was written, or the same version) — keep waiting;
 * - `gone`: the research no longer has it — the wait ends quietly.
 */
export type PendingHypothesisOutcome =
    | { kind: 'asked'; variant: string | null }
    | { kind: 'reopened' }
    | { kind: 'left-open' }
    | { kind: 'elsewhere'; status: 'open' | 'decided' | 'abandoned' | string; variant: string | null; by: 'agent' | 'app' | 'person' }
    | { kind: 'waiting' }
    | { kind: 'gone' };

/**
 * The parts of a hypothesis that a decision changes, as one key (same key:
 * nothing was decided). An agent's proposal coming meanwhile is no decision.
 */
export function hypothesisStateKey(h: ResearchHypothesis): string {
    return [h.status ?? 'open', h.chosen ?? '', h.decidedBy ?? '', h.decidedAt ?? '', h.decision ?? '', h.leftOpen ?? ''].join('\u0000');
}

/** A new wait for a hypothesis asked now. */
export function newPendingHypothesis(h: ResearchHypothesis, what: ResearchHypothesisDo, url: string, head: string, now: number, variant?: string): PendingHypothesis {
    return { do: what, ...(what === 'decide' && variant ? { variant } : {}), since: now, url, head, state: hypothesisStateKey(h) };
}

/** Waiting, or waiting for over ten minutes (another heading; nothing goes away by itself, V7). */
export function pendingHypothesisPhase(p: PendingHypothesis, now: number): 'waiting' | 'long' {
    return now - p.since >= HYPOTHESIS_WAIT_LONG_MS ? 'long' : 'waiting';
}

/**
 * What became of a hypothesis asked, read from the research's version
 * `head` (`h`: the hypothesis there, undefined when it has none). Its
 * decision unchanged: still waiting (whatever else was written). The caller
 * drops the record for anything but `waiting`, and moves its `head` on for
 * `waiting` (settlePendingHypothesis).
 */
export function evaluatePendingHypothesis(p: PendingHypothesis, h: ResearchHypothesis | undefined, head: string): PendingHypothesisOutcome {
    if (!h) return head && head !== p.head ? { kind: 'gone' } : { kind: 'waiting' };
    if (hypothesisStateKey(h) === p.state) return { kind: 'waiting' };
    const status = h.status ?? 'open';
    if (p.do === 'decide' && p.variant && status === 'decided' && h.chosen === p.variant) return { kind: 'asked', variant: p.variant };
    if (p.do === 'abandon' && status === 'abandoned') return { kind: 'asked', variant: null };
    if (p.do === 'reopen' && status === 'open') return { kind: 'reopened' };
    if (p.do === 'keep-open' && status === 'open' && !!h.leftOpen && !h.proposal) return { kind: 'left-open' };
    return {
        kind: 'elsewhere', status,
        variant: status === 'decided' ? h.chosen ?? null : null,
        by: h.decidedBy ?? 'person',
    };
}

/** What a new version of the research does to the wait: drop it, or keep it with the new `head`. */
export function settlePendingHypothesis(p: PendingHypothesis, h: ResearchHypothesis | undefined, head: string): { outcome: PendingHypothesisOutcome; next: PendingHypothesis | null } {
    const outcome = evaluatePendingHypothesis(p, h, head);
    return { outcome, next: outcome.kind === 'waiting' ? (head && head !== p.head ? { ...p, head } : p) : null };
}

// ==================== THE RECORDS OF THIS PAGE ====================

/** The waits by research and hypothesis ("<research>|H0022"). */
const pending = new Map<string, PendingHypothesis>();
type PendingListener = (researchId: string, hypothesisId: string) => void;
const listeners: PendingListener[] = [];

function key(researchId: string, hypothesisId: string): string {
    return `${researchId.toLowerCase()}|${hypothesisId}`;
}

function tell(researchId: string, hypothesisId: string): void {
    for (const l of listeners) {
        try { l(researchId, hypothesisId); } catch (err) { console.warn('Hypothesis wait listener failed', err); }
    }
}

/** Told whenever a wait is set or ends (the card, the bubble and "What waits" draw again). */
export function onPendingHypothesisChange(listener: PendingListener): void {
    if (!listeners.includes(listener)) listeners.push(listener);
}

/** The wait for a hypothesis of a research, or null. */
export function pendingHypothesis(researchId: string, hypothesisId: string): PendingHypothesis | null {
    return pending.get(key(researchId, hypothesisId)) ?? null;
}

/** The waits of a research, by hypothesis id. */
export function pendingHypothesesOf(researchId: string): Map<string, PendingHypothesis> {
    const prefix = `${researchId.toLowerCase()}|`;
    const out = new Map<string, PendingHypothesis>();
    for (const [k, p] of pending) if (k.startsWith(prefix)) out.set(k.slice(prefix.length), p);
    return out;
}

/** Set (null: end, e.g. "Stop waiting") the wait for a hypothesis of a research. */
export function setPendingHypothesis(researchId: string, hypothesisId: string, p: PendingHypothesis | null): void {
    if (p) pending.set(key(researchId, hypothesisId), p);
    else if (!pending.delete(key(researchId, hypothesisId))) return;
    tell(researchId, hypothesisId);
}

/**
 * A new version of the research (`head`) with its hypotheses by id: each
 * wait of that research settled. Returns the outcomes other than `waiting`
 * (to announce or show); those waits end, the others go on with the new head.
 */
export function settlePendingHypotheses(researchId: string, hypotheses: ReadonlyMap<string, ResearchHypothesis>, head: string): Map<string, PendingHypothesisOutcome> {
    const done = new Map<string, PendingHypothesisOutcome>();
    for (const [id, p] of pendingHypothesesOf(researchId)) {
        const { outcome, next } = settlePendingHypothesis(p, hypotheses.get(id), head);
        if (next) {
            if (next !== p) pending.set(key(researchId, id), next);
            continue;
        }
        done.set(id, outcome);
        setPendingHypothesis(researchId, id, null);
    }
    return done;
}

/** The overview's own window (K3): a research's waits as the main window said them, in place of those kept here. */
export function replacePendingHypotheses(researchId: string, waits: Readonly<Record<string, PendingHypothesis>>): void {
    const prefix = `${researchId.toLowerCase()}|`;
    for (const k of [...pending.keys()]) if (k.startsWith(prefix)) pending.delete(k);
    for (const [id, p] of Object.entries(waits)) pending.set(key(researchId, id), p);
}

/** Forget every wait (tests; a tree closed). */
export function clearPendingHypotheses(researchId?: string): void {
    if (researchId === undefined) { pending.clear(); return; }
    for (const id of pendingHypothesesOf(researchId).keys()) setPendingHypothesis(researchId, id, null);
}

/** Tell every listener (the wait turned long: the card and the bubble draw their other heading). */
export function touchPendingHypotheses(): void {
    tell('', '');
}

/**
 * When the next wait turns long (HYPOTHESIS_WAIT_LONG_MS after it was asked),
 * after `now`; null when none will (no wait, or each long already).
 */
export function nextPendingHypothesisLongAt(now: number): number | null {
    let next: number | null = null;
    for (const p of pending.values()) {
        const at = p.since + HYPOTHESIS_WAIT_LONG_MS;
        if (at > now && (next === null || at < next)) next = at;
    }
    return next;
}

// ==================== WHAT A WAIT LEFT ON THE CARD ====================

/**
 * What the card says after a wait ended without the tree loading the decision:
 * - `elsewhere`: the research decided otherwise ("Already decided in the research: A (by the agent)"),
 *   shown while the hypothesis is as it was then (`state`);
 * - `later`: decided as asked, the Load dialog put off ("Later") — "Already decided in the research: B
 *   (decided in the app)" with "Load", until a version of the research loads.
 */
export type HypothesisCardNote =
    | { kind: 'elsewhere'; status: string; variant: string | null; by: 'agent' | 'app' | 'person'; state: string }
    | { kind: 'later'; status: string; variant: string | null; by: 'agent' | 'app' | 'person' };

const notes = new Map<string, HypothesisCardNote>();

/** The card's note of a hypothesis, or null. */
export function hypothesisCardNote(researchId: string, hypothesisId: string): HypothesisCardNote | null {
    return notes.get(key(researchId, hypothesisId)) ?? null;
}

/** Set (null: drop) the card's note of a hypothesis; the card draws again. */
export function setHypothesisCardNote(researchId: string, hypothesisId: string, note: HypothesisCardNote | null): void {
    if (note) notes.set(key(researchId, hypothesisId), note);
    else if (!notes.delete(key(researchId, hypothesisId))) return;
    tell(researchId, hypothesisId);
}

/** Drop the notes of a research (of one kind, or all; every research without one). */
export function clearHypothesisCardNotes(researchId?: string, kind?: HypothesisCardNote['kind']): void {
    const prefix = researchId === undefined ? '' : `${researchId.toLowerCase()}|`;
    for (const [k, n] of [...notes]) {
        if (k.startsWith(prefix) && (!kind || n.kind === kind)) notes.delete(k);
    }
    if (researchId !== undefined) tell(researchId, '');
}

/**
 * The note an elsewhere outcome or a put-off load leaves (`h`: the hypothesis
 * in the research's version). Null for an outcome that leaves none.
 */
export function hypothesisNoteOf(outcome: PendingHypothesisOutcome, h: ResearchHypothesis | undefined, later: boolean): HypothesisCardNote | null {
    if (!h) return null;
    const status = h.status ?? 'open';
    const by = h.decidedBy ?? 'person';
    const variant = status === 'decided' ? h.chosen ?? null : null;
    if (outcome.kind === 'elsewhere' && !later) return { kind: 'elsewhere', status, variant, by, state: hypothesisStateKey(h) };
    if (later && outcome.kind !== 'waiting' && outcome.kind !== 'gone') return { kind: 'later', status, variant, by };
    return null;
}
