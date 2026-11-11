/**
 * What the card of a research hypothesis in "What the research knows" shows
 * (spec 074, DEV §1, §2, §5, §6): for each version its "Choose", its tag
 * ("chosen", "holds now") and its note on the tree; under the box "No
 * version holds", "Leave open", "Change", "Reopen" or why it cannot be
 * reopened; the way into the research, as the main action or below a line;
 * the wait for the research's confirmation (DEV §4). Pure: the offer
 * (hypothesisPickable), the change mode and the wait come in from the UI.
 */

import type { ResearchHypothesis, ResearchHypothesisVariant } from './types.js';
import { HypothesisPick, hypothesisCannotReopen, hypothesisChoiceKeepsTree, hypothesisChoiceStays } from './research-hypothesis-pick.js';
import type { PendingHypothesis } from './research-hypothesis-wait.js';
import { isOpenHypothesis } from './view-links.js';

/** A button of the card: drawn and working, drawn and switched off (a wait), or not drawn. */
export type HypothesisCardButton = 'on' | 'off' | null;

/** One version's row. */
export interface HypothesisVariantPlan {
    id: string;
    /** "Choose" (a link into the research's terminal). */
    pick: HypothesisCardButton;
    /** The decided version's tag: "chosen", or "holds now" while it is being changed. */
    tag: 'chosen' | 'holds' | null;
    /** Its title in the quieter colour: a version not chosen, or every one of an abandoned hypothesis. */
    dim: boolean;
    /**
     * The sentence under a version that can be chosen and changes nothing drawn: it links nobody
     * (`noLink`), the tree records it already (`inTree`), or choosing it leaves the old link (`stays`).
     */
    note: 'noLink' | 'inTree' | 'stays' | null;
    /** The agent proposes this version (its strip under the claim). */
    proposal: boolean;
    /** The wait for the research is at this version (Choose asked). */
    waiting: boolean;
}

/** The whole card. */
export interface HypothesisCardPlan {
    pick: HypothesisPick;
    /**
     * The research's new marks are drawn (the sources for and against, the agent's proposal, the
     * decision before, "left open"): every card that knows deciding in the app but today's and
     * merging (their rows stay as they are).
     */
    extras: boolean;
    variants: HypothesisVariantPlan[];
    /** The agent proposes that no version holds (its strip under the box). */
    proposalNone: boolean;
    /** "Holds since {day}: {B} · {reason}" above the box in place of the reason (changing a decided one). */
    holdsSince: boolean;
    /** "No version holds" / "Leave open" / "Cancel the change" under the box. */
    foot: { none: HypothesisCardButton; leave: HypothesisCardButton; cancelChange: boolean } | null;
    /** "Change" and "Reopen" under the box of a decided or abandoned one, with what reopening does, or why it cannot be. */
    decided: { change: boolean; reopen: boolean; cannot: boolean; off: boolean } | null;
    /** The wait under the box (No version holds, Leave open, Reopen asked). */
    footWait: boolean;
    /** The sentence that the research's terminal asks for the reason of a change. */
    changeHint: boolean;
    /** The way into the research ("Decide / Change in the research"): the card's main action, or quiet below a line. */
    link: 'main' | 'faint' | null;
    /** The info line: away from the research's computer, or merging people is decided in the research. */
    info: 'remote' | 'merge' | null;
}

/**
 * A version that changes nothing drawn when it is chosen: it links nobody, or
 * the tree records it already. One that links nobody says so only when its
 * choice keeps the tree (a change away from a linked choice takes that link
 * out): the same sentence as the wait's.
 */
function variantNote(h: ResearchHypothesis, v: ResearchHypothesisVariant): 'noLink' | 'inTree' | null {
    if (v.links.length > 0 || (v.people ?? 0) > 0) return null;
    if (v.inTree?.length) return 'inTree';
    return hypothesisChoiceKeepsTree(h, v.id) ? 'noLink' : null;
}

/**
 * What the card of a hypothesis shows (DEV §1–§6). `changing`: "Change"
 * was clicked (a mode of this page; a decided or abandoned hypothesis only);
 * `pending`: what was asked of the research and waits for its confirmation
 * (only a `pick` card waits; any other ignores it). `linkable`: the
 * hypothesis link is there for "Decide in the research" (today's way).
 * `held`: the research decided it already and its version is not loaded yet
 * ("Later" in the Load dialog): every choice is switched off as during a wait,
 * and the way into the research is not offered, until the version loads.
 */
export function hypothesisCardPlan(
    h: ResearchHypothesis, pick: HypothesisPick, opts: { changing?: boolean; pending?: PendingHypothesis | null; linkable?: boolean; held?: boolean } = {},
): HypothesisCardPlan {
    const variants = h.variants ?? [];
    const open = isOpenHypothesis(h);
    const decided = h.status === 'decided';
    const extras = pick === 'pick' || pick === 'remote' || pick === 'readonly';
    const choosing = pick === 'pick';
    const pending = choosing ? opts.pending ?? null : null;
    // A wait, or a decision of the research not loaded yet: the choices are drawn switched off.
    const busy = !!pending || (choosing && !!opts.held);
    // Changing a decided or abandoned one: by "Change", or a version or "No version holds" asked from it.
    const changeWait = !open && !!pending && pending.do !== 'reopen';
    const changing = choosing && !open && (!!opts.changing || changeWait);
    const reopenWait = !open && pending?.do === 'reopen';
    const proposal = extras && open && !h.leftOpen ? h.proposal : undefined;
    const plan: HypothesisCardPlan = {
        pick, extras,
        variants: variants.map(v => {
            const chosen = decided && h.chosen === v.id;
            let pickBtn: HypothesisCardButton = null;
            if (choosing && open) pickBtn = busy ? 'off' : 'on';
            else if (changing) pickBtn = busy || chosen ? 'off' : 'on';
            const note = pickBtn !== 'on' ? null
                : changing && hypothesisChoiceStays(h, v.id) ? 'stays'
                : variantNote(h, v);
            return {
                id: v.id,
                pick: pickBtn,
                tag: chosen ? (changing ? 'holds' : 'chosen') : null,
                dim: extras && !open && !chosen,
                note,
                proposal: !!proposal && proposal.variant === v.id,
                waiting: !!pending && pending.do === 'decide' && pending.variant === v.id,
            };
        }),
        proposalNone: !!proposal && proposal.variant === null,
        holdsSince: changing && decided && !!h.chosen,
        foot: null,
        decided: null,
        footWait: !!pending && (pending.do === 'abandon' || pending.do === 'keep-open' || pending.do === 'reopen'),
        changeHint: changing && !busy,
        link: null,
        info: pick === 'remote' ? 'remote' : pick === 'merge' ? 'merge' : null,
    };
    if (choosing && open) {
        plan.foot = { none: busy ? 'off' : 'on', leave: h.leftOpen ? null : busy ? 'off' : 'on', cancelChange: false };
    } else if (changing) {
        plan.foot = { none: decided ? (busy ? 'off' : 'on') : null, leave: null, cancelChange: !busy };
    } else if (choosing && !reopenWait) {
        const cannot = !!hypothesisCannotReopen(h);
        plan.decided = { change: true, reopen: !cannot, cannot, off: busy };
    }
    // The way into the research: today's main action where nothing is chosen here; quiet below a
    // line beside the choice; not while a wait or a change goes on.
    if (opts.linkable !== false && h.id) {
        if (pick === 'old' || pick === 'merge') plan.link = 'main';
        else if (choosing && !busy && !changing) plan.link = 'faint';
    }
    return plan;
}
