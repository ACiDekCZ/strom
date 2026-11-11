/**
 * A hypothesis of the research as "What the research knows" words it: its
 * state, and what its note adds to its versions. Pure (strings only).
 */

import { strings } from './strings.js';
import { formatFlexDate } from './dates.js';
import type { ResearchHypothesis, ResearchHypothesisVariant } from './types.js';
import type { ResearchHypothesisDo } from './research-link.js';
import { isOpenHypothesis } from './view-links.js';
import { HYPOTHESIS_BIG_JOIN, hypothesisCannotReopen, hypothesisChoiceKeepsTree } from './research-hypothesis-pick.js';
import { HypothesisCardNote, PendingHypothesisOutcome, hypothesisStateKey } from './research-hypothesis-wait.js';

/** A decision's reason longer than this shows its first lines, the rest unfolded on a click. */
export const HYPOTHESIS_REASON_FOLD = 200;

/**
 * What a decided or abandoned hypothesis says of its decision (spec 060):
 * "decided by the agent" (only the agent's), its day in the app's date
 * style and its reason; '' each where the research did not say it.
 */
export function researchHypothesisDecision(h: ResearchHypothesis): { by: string; day: string; reason: string } {
    if (isOpenHypothesis(h)) return { by: '', day: '', reason: '' };
    return {
        by: h.decidedBy === 'agent' ? strings.research.hypoByAgent : h.decidedBy === 'app' ? strings.research.hypoByApp : '',
        day: h.decidedAt ? formatFlexDate(h.decidedAt) : '',
        reason: h.decision?.trim() ?? '',
    };
}

/** The label of a hypothesis's way into the research: decide an open one, change a decided or abandoned one. */
export function researchHypothesisLinkLabel(h: ResearchHypothesis): string {
    return isOpenHypothesis(h) ? strings.research.decide : strings.research.hypoChange;
}

/** A hypothesis's state in words: open, decided (for which version), abandoned, or a newer word as written. */
export function researchHypothesisState(h: ResearchHypothesis): string {
    const r = strings.research;
    if (h.status === 'decided') return r.hypoDecided(h.chosen ?? '');
    if (h.status === 'abandoned') return r.hypoAbandoned;
    return !h.status || h.status === 'open' ? r.hypoOpen : h.status;
}

/**
 * The hypothesis's note without what its versions already say: the research
 * lists them there too ("A: …", "B: …"), each line a version's letter.
 */
export function researchHypothesisNote(h: ResearchHypothesis): string {
    const note = h.note?.trim() ?? '';
    if (!note || !h.variants?.length) return note;
    const ids = new Set(h.variants.map(v => v.id));
    return note.split('\n').map(l => l.trim()).filter(l => {
        const m = /^([A-Z]{1,3})\s*[:)]\s/.exec(l);
        return l && !(m && ids.has(m[1]));
    }).join(' ');
}

// ==================== DECIDING IN THE APP (spec 074) ====================

/** A version's count of people it joins, when that is a large link (over HYPOTHESIS_BIG_JOIN); else 0. */
export function researchHypothesisBigJoin(v: Pick<ResearchHypothesisVariant, 'people'> | undefined): number {
    return v?.people !== undefined && v.people > HYPOTHESIS_BIG_JOIN ? v.people : 0;
}

/** The chosen version of a decided hypothesis, or undefined. */
function chosenVariant(h: ResearchHypothesis): ResearchHypothesisVariant | undefined {
    return h.status === 'decided' && h.chosen ? h.variants?.find(v => v.id === h.chosen) : undefined;
}

/**
 * What reopening a decided or abandoned hypothesis does to the tree (DEV §6):
 * the link of the chosen version's people leaves it, or the link of the
 * chosen version (no count said), or nothing changes (abandoned, a version
 * without links).
 */
export function researchHypothesisReopenNote(h: ResearchHypothesis): string {
    const r = strings.research;
    const chosen = chosenVariant(h);
    if (!chosen || chosen.links.length === 0) return r.hypoReopenNone;
    return chosen.people ? r.hypoReopenLoss(chosen.people) : r.hypoReopenLossAny;
}

/** Why a decided hypothesis cannot be reopened, in words (DEV §6, `_REOPEN no`); '' when it can be. */
export function researchHypothesisCannotReopenText(h: ResearchHypothesis): string {
    const why = hypothesisCannotReopen(h);
    if (!why) return '';
    const r = strings.research;
    if (why.kind === 'tree') return r.hypoCannotReopenTree(why.count, why.change);
    if (why.kind === 'work') return r.hypoCannotReopenWork(why.count, why.change);
    return r.hypoCannotReopen;
}

/**
 * What the research's terminal asks to confirm for a link from the app, as
 * the waiting card describes it (DEV §3, §4) — not a quote: the terminal
 * words its question itself. Decide (or change) for a version, abandon,
 * reopen, leave open, with the count of a large link, the link that leaves
 * the tree, the agent's proposal not taken. '' for `decide` without a
 * version (the research's own screen, no waiting).
 */
export function researchHypothesisAsk(h: ResearchHypothesis, what: ResearchHypothesisDo, variant?: string): string {
    const r = strings.research;
    const id = h.id ?? '';
    let q: string;
    if (what === 'decide') {
        if (!variant) return '';
        const v = h.variants?.find(x => x.id === variant);
        const big = researchHypothesisBigJoin(v);
        q = h.status === 'decided' && h.chosen && h.chosen !== variant ? r.hypoAskChange(id, h.chosen, variant) : r.hypoAskDecide(id, variant);
        if (big) q += ` ${r.hypoAskBig(big)}`;
        // A version without a link (K1.6): the tree stays, only the decision is recorded.
        else if (hypothesisChoiceKeepsTree(h, variant)) q += ` ${r.hypoKeepsTree}`;
    } else if (what === 'abandon') {
        q = r.hypoAskAbandon(id);
    } else if (what === 'reopen') {
        const people = chosenVariant(h)?.people;
        q = r.hypoAskReopen(id) + (people ? ` ${r.hypoReopenLoss(people)}` : '');
    } else {
        q = r.hypoAskLeave(id) + (h.proposal ? ` ${r.hypoAskProposalDropped(h.proposal.variant)}` : '');
    }
    return q;
}

/** The waiting card's sentence (DEV §4): the terminal's question, then (not for "Leave open") the optional reason. */
export function researchHypothesisWaitText(h: ResearchHypothesis, what: ResearchHypothesisDo, variant?: string): string {
    const q = researchHypothesisAsk(h, what, variant);
    if (!q) return '';
    return what === 'keep-open' ? strings.research.hypoWaitAskPlain(q) : strings.research.hypoWaitAsk(q);
}

/**
 * The decision before the last one (DEV §6, `_PREV`, only the last): "before:
 * B, 9 Nov 2026 · its reason", or "before: no version held, …". '' without one.
 */
export function researchHypothesisPreviousText(h: ResearchHypothesis): string {
    const p = h.previous;
    if (!p) return '';
    const r = strings.research;
    const day = p.day ? formatFlexDate(p.day) : '';
    const head = p.variant ? r.hypoBefore(p.variant, day) : r.hypoBeforeNone(day);
    const reason = p.reason?.trim() ?? '';
    return reason ? `${head} · ${reason}` : head;
}

/**
 * While a decided hypothesis is being changed (DEV §6): "Holds since {day}:
 * {B} · its reason" above its versions. '' when it holds no version or no day is known.
 */
export function researchHypothesisHoldsSinceText(h: ResearchHypothesis): string {
    if (h.status !== 'decided' || !h.chosen || !h.decidedAt) return '';
    const head = strings.research.hypoHoldsSince(formatFlexDate(h.decidedAt), h.chosen);
    const reason = h.decision?.trim() ?? '';
    return reason ? `${head} · ${reason}` : head;
}

/**
 * The agent's proposal in words (DEV §1): its label ("proposed by the
 * agent:", in bold) and what follows it — the sentence and the day for a
 * version; "no version holds" and the sentence for none. Null without one.
 */
export function researchHypothesisProposalParts(h: ResearchHypothesis): { label: string; text: string } | null {
    const p = h.proposal;
    if (!p) return null;
    const r = strings.research;
    const label = r.hypoProposal('').trim();
    const said = [p.text?.trim() ?? '', p.day ? formatFlexDate(p.day) : ''].filter(Boolean).join(' · ');
    if (p.variant !== null) return { label, text: said };
    const none = r.hypoProposalNone.startsWith(label) ? r.hypoProposalNone.slice(label.length).trim() : r.hypoProposalNone;
    return { label, text: [none, said].filter(Boolean).join(' · ') };
}

/** The notice of a wait that ended as asked (DEV §4): decided for a version, no version holds, open again; '' for none. */
export function researchHypothesisOutcomeToast(id: string, outcome: PendingHypothesisOutcome): string {
    const r = strings.research;
    if (outcome.kind === 'asked') return outcome.variant ? r.hypoDecidedToast(id, outcome.variant) : r.hypoNoneToast(id);
    if (outcome.kind === 'reopened') return r.hypoReopenedToast(id);
    return '';
}

/**
 * The card's line of a decision it did not load (DEV §4): "Already decided in
 * the research: A (decided by the agent)" — the version, "no version holds",
 * or "open"; who decided where the research says it.
 */
export function researchHypothesisNoteText(note: HypothesisCardNote): string {
    const r = strings.research;
    const what = note.status === 'decided' ? note.variant ?? '' : note.status === 'abandoned' ? r.hypoNoneWord : r.hypoOpen;
    const who = note.by === 'agent' ? r.hypoByAgent : note.by === 'app' ? r.hypoByApp : '';
    return r.hypoElsewhere(what, who);
}

/**
 * How a hypothesis changed between this tree (`was`) and the research's
 * version (`now`) as one row of the Load dialog and of the history (DEV §5):
 * "H0022 decided for B", "H0022 changed to C", "H0022: no version holds",
 * "H0022 reopened", "H0031 left open"; '' when its decision is as it was.
 */
export function researchHypothesisChangeText(was: ResearchHypothesis | undefined, now: ResearchHypothesis): string {
    if (was && hypothesisStateKey(was) === hypothesisStateKey(now)) return '';
    const r = strings.research;
    const id = now.id ?? '';
    const status = now.status ?? 'open';
    if (status === 'decided' && now.chosen) {
        return was?.status === 'decided' && was.chosen && was.chosen !== now.chosen ? r.hypoRowChanged(id, now.chosen) : r.hypoRowDecided(id, now.chosen);
    }
    if (status === 'abandoned') return r.hypoRowNone(id);
    if (was && !isOpenHypothesis(was) && isOpenHypothesis(now)) return r.hypoRowReopened(id);
    if (isOpenHypothesis(now) && now.leftOpen && !was?.leftOpen) return r.hypoRowLeftOpen(id);
    return '';
}

/** One hypothesis row of the Load dialog: whose it is, what became of it, decided in the app. */
export interface HypothesisLoadRow {
    id: string;
    personName: string;
    text: string;
    inApp: boolean;
}

/**
 * The Load dialog's hypothesis rows (DEV §4, §5): each hypothesis whose
 * decision the research's version changes and that was decided in the app
 * (`_BY app`) or asked from this page (`asked`), in the research's order.
 * `owner`: the name of the person a hypothesis belongs to (there).
 */
export function researchHypothesisLoadRows(
    here: ReadonlyMap<string, ResearchHypothesis>, there: ReadonlyMap<string, ResearchHypothesis>,
    asked: ReadonlySet<string>, owner: (id: string) => string,
): HypothesisLoadRow[] {
    const rows: HypothesisLoadRow[] = [];
    for (const [id, h] of there) {
        const inApp = h.decidedBy === 'app' && !isOpenHypothesis(h);
        if (!inApp && !asked.has(id)) continue;
        const text = researchHypothesisChangeText(here.get(id), h);
        if (text) rows.push({ id, personName: owner(id), text, inApp: inApp || asked.has(id) });
    }
    return rows;
}

/**
 * A line of the research's history (`/log` what) that tells a decision made
 * in the Strom app (DEV §5, V14): "H0022 decided for B in the Strom app",
 * "… abandoned …", "… reopened …", "… decided again for C …", "… left open …".
 * Its words here and the hypothesis, or null for any other line.
 */
export function researchHypothesisLogLine(line: string): { id: string; text: string } | null {
    const m = /^(H\d+)\b[\s:–-]*(.*?)\s+in the Strom app\b/i.exec(line.trim());
    if (!m) return null;
    const id = m[1];
    const what = m[2].toLowerCase();
    const r = strings.research;
    const v = /\bfor\s+(?:version\s+)?([A-Z]{1,3})\b/i.exec(m[2])?.[1]?.toUpperCase();
    let text: string;
    if ((what.startsWith('decided') || what.startsWith('changed')) && v) {
        text = what.startsWith('decided again') || what.startsWith('changed') ? r.hypoRowChanged(id, v) : r.hypoRowDecided(id, v);
    } else if (what.startsWith('abandoned') || what.includes('no version')) text = r.hypoRowNone(id);
    else if (what.startsWith('reopened')) text = r.hypoRowReopened(id);
    else if (what.startsWith('left open') || what.startsWith('kept open')) text = r.hypoRowLeftOpen(id);
    else return null;
    return { id, text };
}
