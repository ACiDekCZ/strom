/**
 * Which re-verification actions a fact offers (spec 065, table 10z): the
 * research's "Verify", a hand confirmation "Verified from the scan" and its
 * "Take back", and the extra row of the fact's pill. Pure.
 */

import type { FactVerifyPending } from './types.js';
import type { ReliabilityStepName } from './reliability.js';
import type { ResearchTreeState } from './research-link.js';
import { VERIFY_FEATURE, FACTS_CONFIRM_FEATURE } from './verify.js';

/** The research the tree is linked to, as the offer needs it; null: no research. */
export interface VerifyResearch {
    /** /status.features of its bridge. */
    features: readonly string[];
    /** /status.tree.state; an archive or a waiting tree does not verify. */
    treeState?: ResearchTreeState;
}

export interface VerifyOfferInput {
    /** The fact's reliability step (null: no mark). */
    step: ReliabilityStepName | null;
    research: VerifyResearch | null;
    /** The fact cites a source. */
    cited: boolean;
    /**
     * The fact has a record to confirm it against: a citation, or the record
     * the research read its value from (what the tip lists under Sources).
     * Absent: as `cited`. Without one there is no scan, so no "Confirm against
     * the scan".
     */
    source?: boolean;
    /** It waits for re-verification in the research. */
    pending?: FactVerifyPending;
    /** Where it was confirmed (factVerifyInfo.confirmedBy). */
    confirmedBy?: 'app' | 'research';
    /** The research's reason a kept fact stays (factVerifyInfo.checked.why). */
    why?: string;
}

/** The extra row under the fact in its pill. */
export type VerifyOfferRow =
    /** Who and when confirmed it. */
    | 'confirmed'
    /** The research's reason it stays as it is. */
    | 'reason'
    /** From the family tree, cited there. */
    | 'importCited'
    /** From the family tree, without a citation. */
    | 'importUncited'
    /** It waits for re-verification. */
    | 'pending'
    /** A research of ancestors would verify it. */
    | 'noResearch';

export interface VerifyOffer {
    /** "Verify" (an agent of the research re-verifies it). */
    verify: boolean;
    /** Its rough cost: low when a record is cited (read), high otherwise (search). */
    cost?: 'low' | 'high';
    /** "Verified from the scan" (a person confirms it by hand). */
    scan: boolean;
    /** "Take back" a confirmation. */
    undo: boolean;
    row: VerifyOfferRow | null;
}

/** The research verifies (feature, and a tree that is not an archive or waiting). */
export function researchVerifies(research: VerifyResearch | null, feature: string = VERIFY_FEATURE): boolean {
    if (!research || !research.features.includes(feature)) return false;
    return research.treeState !== 'archive' && research.treeState !== 'waiting';
}

/** The research takes a hand confirmation (`facts.confirm`; also in an archive or a waiting tree). */
export function researchConfirms(research: VerifyResearch | null): boolean {
    return !!research && research.features.includes(FACTS_CONFIRM_FEATURE);
}

/**
 * Which re-verification actions one fact offers (spec 065, table 10z):
 * 1. confirmed by a person: only "Take back" (in the research: with
 *    `facts.confirm`), and who and when;
 * 2. proven, with the research: "Verified from the scan";
 * 3–5. probable / possible / lead / from the family tree, with the research's
 *    `verify`: "Verify" (cheap with a citation, costlier without; a lead
 *    costlier) and the scan; the reason a kept fact stays, or whether the
 *    family tree cited it;
 * 6. no source: "Verify" (costlier), no scan;
 * 7. waiting: no "Verify", the scan, the waiting row;
 * 8. a research without `verify`: no "Verify"; the scan only with `facts.confirm`;
 * 9. no research: the scan when the fact cites a source, and the row that a
 *    research would verify it.
 * A fact with no mark offers the scan alone (with a source) and no row.
 * The scan stands only where the fact has a record to confirm it against
 * (`source`): a fact the tip lists without a source offers none.
 */
export function verifyOffer(input: VerifyOfferInput): VerifyOffer {
    const { step, research, cited } = input;
    const sourced = input.source ?? cited;
    const none: VerifyOffer = { verify: false, scan: false, undo: false, row: null };
    if (step === 'human') {
        const undo = input.confirmedBy === 'app' || (input.confirmedBy === 'research' && researchConfirms(research));
        return { ...none, undo, row: input.confirmedBy ? 'confirmed' : null };
    }
    if (!research) {
        if (step === null) return { ...none, scan: sourced };
        return { ...none, scan: sourced, row: 'noResearch' };
    }
    const scan = step !== 'none' && sourced && researchConfirms(research);
    if (input.pending) return { ...none, scan, row: 'pending' };
    const canVerify = step !== null && step !== 'proven' && researchVerifies(research);
    const offer: VerifyOffer = { ...none, scan };
    if (canVerify) {
        offer.verify = true;
        offer.cost = (step === 'probable' || step === 'possible' || step === 'import') && cited ? 'low' : 'high';
    }
    if (!researchVerifies(research)) return offer;
    if (step === 'import') offer.row = cited ? 'importCited' : 'importUncited';
    else if ((step === 'probable' || step === 'possible' || step === 'lead') && input.why) offer.row = 'reason';
    return offer;
}

export interface PersonVerifyOffer {
    /** "Verify facts (N)" on the person card: opens the person's preview. */
    verify: boolean;
    /** The facts it would verify (N). */
    count: number;
    /** Facts waiting for re-verification ("N facts wait for verification"). */
    pending: number;
}

/**
 * The person card's offer (table 10z, row 10): "Verify facts (N)" with the
 * research's `verify` when some of the facts would be verified; the count of
 * those waiting either way.
 */
export function personVerifyOffer(offers: readonly VerifyOffer[], pending: number,
    research: VerifyResearch | null): PersonVerifyOffer {
    const count = researchVerifies(research) ? offers.filter(o => o.verify).length : 0;
    return { verify: count > 0, count, pending };
}
