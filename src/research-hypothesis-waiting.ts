/**
 * Research hypotheses in "What waits" and in the overview's "What the
 * research knows across the tree" (spec 074, DEV §9, §10). Pure: what a
 * hypothesis item's row offers (the agent's proposal with "Accept proposal"
 * and "Leave open", two or three versions to choose, or only a sentence and
 * "More"), which rows can be picked for accepting the agent's proposals at
 * once (P2), the picked ones of each research (at most
 * MAX_HYPOTHESES_ACCEPT), and the wait of a whole list asked at once with
 * what became of it. The offer of the card (hypothesisPickable), the waits
 * and the device come in from the UI.
 */

import type { ResearchHypothesis } from './types.js';
import type { LiveWaiting } from './research-link.js';
import { MAX_HYPOTHESES_ACCEPT } from './research-link.js';
import { HypothesisPick, hypothesisChoiceKeepsTree } from './research-hypothesis-pick.js';
import type { PendingHypothesis, PendingHypothesisOutcome } from './research-hypothesis-wait.js';
import { researchHypothesisBigJoin } from './research-hypotheses.js';
import { isOpenHypothesis } from './view-links.js';

/** A button of a row: drawn and working, drawn and switched off (a wait), or not drawn. */
export type WaitingHypothesisButton = 'on' | 'off' | null;

/** Most versions a row of "What waits" offers to choose; more are chosen in the card. */
export const WAITING_HYPOTHESIS_VERSIONS = 3;

/**
 * The agent's open proposal of a hypothesis: its version's letter, null for
 * "no version holds", undefined when there is none (decided, left open, or
 * nothing proposed). The tree's record first; the research's item (a version
 * not loaded yet) only for a version the tree knows.
 */
export function hypothesisOpenProposal(h: ResearchHypothesis | undefined, item?: Pick<LiveWaiting, 'proposal'>): string | null | undefined {
    if (!h || !isOpenHypothesis(h) || h.leftOpen) return undefined;
    if (h.proposal) return h.proposal.variant;
    if (item?.proposal === 'none') return null;
    if (item?.proposal && (h.variants ?? []).some(v => v.id === item.proposal)) return item.proposal;
    return undefined;
}

/** The people the proposed version joins when that is a large link (over HYPOTHESIS_BIG_JOIN), else 0. */
export function hypothesisProposalBigJoin(h: ResearchHypothesis | undefined, variant: string | null | undefined): number {
    if (!h || !variant) return 0;
    return researchHypothesisBigJoin((h.variants ?? []).find(v => v.id === variant));
}

/** One version offered to choose in the row. */
export interface WaitingHypothesisVersion {
    id: string;
    title: string;
    pick: Exclude<WaitingHypothesisButton, null>;
    /** The wait for the research is at this version (Choose asked). */
    waiting: boolean;
    /** Choosing it leaves the tree as it is, only the decision is recorded (K1.6). */
    keepsTree: boolean;
}

/** What the row of a hypothesis item in "What waits" offers (DEV §9). */
export interface WaitingHypothesisPlan {
    /**
     * `proposal`: the agent's proposal strip, with "Accept proposal" and "Leave open" where it is decided here;
     * `versions`: two or three versions, each with "Choose"; `text`: a sentence why it is decided in the card or
     * the research; `plain`: nothing beyond the row (the tree does not have the hypothesis open).
     */
    kind: 'proposal' | 'versions' | 'text' | 'plain';
    /** The proposed version (null: no version holds); only for `proposal`. */
    proposal?: string | null;
    /** The proposed version joins this many people (a large link's pill), else 0. */
    big: number;
    /** "Accept proposal B" (or "Accept: no version holds"). */
    accept: WaitingHypothesisButton;
    /** "Leave open". */
    leave: WaitingHypothesisButton;
    versions: WaitingHypothesisVersion[];
    /** The sentence: merging is decided in the research, it is decided on the research's computer, or it has more versions. */
    text: 'merge' | 'remote' | 'versions' | null;
    /** The wait drawn under the row's actions (not at a version). */
    rowWait: boolean;
    /** "More ›": the hypothesis's card at its person. */
    more: boolean;
    /**
     * Every choice the row offers leaves the tree as it is, only the decision is recorded (K1.6): the
     * accepted proposal's version, or each version offered. One sentence says so; with only some
     * versions keeping it, each of those says so itself (`versions[].keepsTree`).
     */
    keepsTree: boolean;
}

/**
 * The row of a hypothesis item (DEV §9). `h`: the hypothesis as the tree has
 * it (undefined: not in the tree); `pick`: its card's offer; `pending`: what
 * was asked and waits for the research; `held`: the research decided it
 * already and its version is not loaded ("Later"): the choices switched off.
 */
export function waitingHypothesisPlan(
    item: Pick<LiveWaiting, 'proposal'>, h: ResearchHypothesis | undefined, pick: HypothesisPick,
    opts: { pending?: PendingHypothesis | null; held?: boolean } = {},
): WaitingHypothesisPlan {
    const plan: WaitingHypothesisPlan = { kind: 'plain', big: 0, accept: null, leave: null, versions: [], text: null, rowWait: false, more: false, keepsTree: false };
    if (!h || !isOpenHypothesis(h)) return plan;
    plan.more = true;
    const choosing = pick === 'pick';
    const pending = choosing ? opts.pending ?? null : null;
    const busy = !!pending || (choosing && !!opts.held);
    const variants = h.variants ?? [];
    const proposal = hypothesisOpenProposal(h, item);
    const sentence = pick === 'merge' ? 'merge' : pick === 'remote' ? 'remote' : null;
    if (proposal !== undefined) {
        plan.kind = 'proposal';
        plan.proposal = proposal;
        plan.big = hypothesisProposalBigJoin(h, proposal);
        if (choosing) {
            plan.accept = busy ? 'off' : 'on';
            plan.leave = busy ? 'off' : 'on';
            plan.keepsTree = hypothesisChoiceKeepsTree(h, proposal);
        } else {
            plan.text = sentence;
        }
        plan.rowWait = !!pending;
        return plan;
    }
    if (choosing && variants.length >= 2 && variants.length <= WAITING_HYPOTHESIS_VERSIONS) {
        plan.kind = 'versions';
        plan.versions = variants.map(v => ({
            id: v.id, title: v.title ?? '',
            pick: busy ? 'off' : 'on',
            waiting: !!pending && pending.do === 'decide' && pending.variant === v.id,
            keepsTree: hypothesisChoiceKeepsTree(h, v.id),
        }));
        plan.keepsTree = plan.versions.every(v => v.keepsTree);
        plan.rowWait = !!pending && !plan.versions.some(v => v.waiting);
        return plan;
    }
    plan.text = sentence ?? (choosing && variants.length > WAITING_HYPOTHESIS_VERSIONS ? 'versions' : null);
    plan.kind = plan.text ? 'text' : 'plain';
    plan.rowWait = !!pending;
    return plan;
}

/** What "Accept proposal" of a row asks: the proposed version decided, or no version holds. */
export function hypothesisAcceptAsk(proposal: string | null): { do: 'decide'; variant: string } | { do: 'abandon' } {
    return proposal ? { do: 'decide', variant: proposal } : { do: 'abandon' };
}

// ==================== P2: ACCEPTING THE AGENT'S PROPOSALS AT ONCE ====================

/**
 * The box of a hypothesis in a list that accepts proposals at once (DEV §10):
 * `on` — it has an open proposal and is decided here; `only-research` — it
 * has one, but only the research decides it (switched off, a sentence says
 * so); `none` — no proposal (an empty place keeps the rows aligned).
 */
export type HypothesisAcceptBox = 'on' | 'only-research' | 'none';

export function hypothesisAcceptBox(h: ResearchHypothesis | undefined, pick: HypothesisPick, item?: Pick<LiveWaiting, 'proposal'>): HypothesisAcceptBox {
    if (hypothesisOpenProposal(h, item) === undefined) return 'none';
    return pick === 'pick' ? 'on' : 'only-research';
}

const selections = new Map<string, Set<string>>();

function sel(researchId: string): Set<string> {
    const k = researchId.toLowerCase();
    let s = selections.get(k);
    if (!s) selections.set(k, s = new Set());
    return s;
}

/** The hypotheses picked for accepting at once in a research (one choice for the overview and "What waits"). */
export function acceptSelection(researchId: string): ReadonlySet<string> {
    return selections.get(researchId.toLowerCase()) ?? new Set();
}

/** The picked ones reached the most taken at once: the boxes not picked are switched off. */
export function acceptSelectionFull(researchId: string): boolean {
    return acceptSelection(researchId).size >= MAX_HYPOTHESES_ACCEPT;
}

/** Pick (or drop) one; false when it cannot be picked (the most taken at once reached). */
export function toggleAcceptSelection(researchId: string, id: string, on: boolean): boolean {
    const s = sel(researchId);
    if (!on) { s.delete(id); return true; }
    if (s.has(id)) return true;
    if (s.size >= MAX_HYPOTHESES_ACCEPT) return false;
    s.add(id);
    return true;
}

/** "Select all with a proposal": these (in their order) up to the most taken at once. */
export function selectAllAccept(researchId: string, ids: readonly string[]): void {
    const s = sel(researchId);
    for (const id of ids) {
        if (s.size >= MAX_HYPOTHESES_ACCEPT) break;
        s.add(id);
    }
}

/** Keep only the picked ones that can still be picked (decided meanwhile, or the proposal gone). */
export function pruneAcceptSelection(researchId: string, pickable: ReadonlySet<string>): void {
    const s = selections.get(researchId.toLowerCase());
    if (!s) return;
    for (const id of [...s]) if (!pickable.has(id)) s.delete(id);
}

/** Forget the picked ones (a research, or all). */
export function clearAcceptSelection(researchId?: string): void {
    if (researchId === undefined) selections.clear();
    else selections.delete(researchId.toLowerCase());
}

/** A picked hypothesis whose proposed version is a large link: said in the list's foot. */
export interface AcceptBigJoin { id: string; variant: string; people: number }

/** The large links among the picked ones (DEV §10: "Large link: H0052 → A links 214 people."), in their order. */
export function acceptBigJoins(picked: readonly { id: string; h: ResearchHypothesis | undefined }[]): AcceptBigJoin[] {
    const out: AcceptBigJoin[] = [];
    for (const { id, h } of picked) {
        const variant = hypothesisOpenProposal(h);
        const people = hypothesisProposalBigJoin(h, variant);
        if (variant && people) out.push({ id, variant, people });
    }
    return out;
}

// ==================== THE WAIT OF A LIST ASKED AT ONCE ====================

/**
 * A list of proposals asked at once (DEV §10): each hypothesis waits as its
 * own (its card and row show it); the list's block says how many wait, with
 * "Open again" (the same link) and "Stop waiting". When none waits any more
 * the list is done: the notice says how many were accepted and its rows say
 * what became of each until the next list.
 */
export interface AcceptBatch {
    ids: string[];
    url: string;
    since: number;
    /** What became of each one whose wait ended (by the research's version). */
    outcomes: Map<string, PendingHypothesisOutcome>;
    done: boolean;
}

const batches = new Map<string, AcceptBatch>();

/** The list asked at once of a research (waiting, or done with its rows' outcomes), or null. */
export function acceptBatch(researchId: string): AcceptBatch | null {
    return batches.get(researchId.toLowerCase()) ?? null;
}

/** A list asked now: it replaces the one before (and its rows' outcomes). */
export function startAcceptBatch(researchId: string, ids: readonly string[], url: string, now: number): AcceptBatch {
    const b: AcceptBatch = { ids: [...ids], url, since: now, outcomes: new Map(), done: false };
    batches.set(researchId.toLowerCase(), b);
    return b;
}

/** A hypothesis is in the list that waits now (its own notice is held for the list's). */
export function inWaitingAcceptBatch(researchId: string, id: string): boolean {
    const b = acceptBatch(researchId);
    return !!b && !b.done && b.ids.includes(id);
}

/** What became of one of the waiting list (true: it is in it). */
export function noteAcceptOutcome(researchId: string, id: string, outcome: PendingHypothesisOutcome): boolean {
    const b = acceptBatch(researchId);
    if (!b || b.done || !b.ids.includes(id)) return false;
    b.outcomes.set(id, outcome);
    return true;
}

/** How many of the list still wait (`waiting`: a hypothesis waits for the research). */
export function acceptBatchWaitingCount(b: AcceptBatch, waiting: (id: string) => boolean): number {
    return b.done ? 0 : b.ids.filter(waiting).length;
}

/**
 * The list is done when none of it waits any more: its counts for the
 * notice ("{k} of {n} proposals accepted"), or null while one still waits
 * (or it was done already).
 */
export function finishAcceptBatch(researchId: string, waiting: (id: string) => boolean): { accepted: number; of: number } | null {
    const b = acceptBatch(researchId);
    if (!b || b.done || b.ids.some(waiting)) return null;
    b.done = true;
    return { accepted: [...b.outcomes.values()].filter(o => o.kind === 'asked').length, of: b.ids.length };
}

/** "Stop waiting" for the whole list: done without its notice (its waits end with it). */
export function stopAcceptBatch(researchId: string): void {
    const b = acceptBatch(researchId);
    if (b) b.done = true;
}

/** Forget the list (a research, or all). */
export function clearAcceptBatch(researchId?: string): void {
    if (researchId === undefined) batches.clear();
    else batches.delete(researchId.toLowerCase());
}

/**
 * What a row of the overview says after its list was done: `accepted` — decided as
 * asked; `elsewhere` — the card's line says what the research decided; null — as it was.
 */
export function acceptBatchRowResult(b: AcceptBatch | null, id: string): 'accepted' | 'elsewhere' | null {
    if (!b || !b.done) return null;
    const o = b.outcomes.get(id);
    if (!o) return null;
    return o.kind === 'asked' ? 'accepted' : o.kind === 'elsewhere' ? 'elsewhere' : null;
}
