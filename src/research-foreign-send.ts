/**
 * A send that is not this tree's own: the people it carries hardly name any
 * person of the research's version the tree builds on (its kept copy). Such a
 * copy reads there as a second family tree written into the research — e.g.
 * another tree's data sent under this tree's tie, or the sample tree. Never
 * sent; a send taken back that looked so is not offered again.
 */

import { StromData } from './types.js';

/** A research's number for a person (`REFN P…`, as holdsResearchIds reads it). */
const RESEARCH_REF = /^P\d{1,9}$/;

/**
 * Below this many people with a research number in the base, the check does
 * not apply: in a small research one or two people are already more than a
 * tenth, so ordinary edits (a person removed, two added) would trip it, and
 * the research's own check of a copy without its numbers (`tree.no-ids`)
 * covers what little such a tree could lose.
 */
export const FOREIGN_SEND_MIN_BASE = 10;

/**
 * The share both sides must fall under: the research's numbers of the base
 * found in the send, against the base and against the people sent. A tenth
 * leaves room for a few people that happen to carry a number, and matches the
 * research's own branch for the same case (`kept < given / 10`).
 */
export const FOREIGN_SEND_SHARE = 0.1;

/** The research's numbers of a tree's people (placeholders aside). */
export function researchRefsOf(data: Pick<StromData, 'persons'> | null | undefined): Set<string> {
    const out = new Set<string>();
    for (const p of Object.values(data?.persons ?? {})) {
        if (!p || p.isPlaceholder) continue;
        const ref = p.refn?.trim();
        if (ref && RESEARCH_REF.test(ref)) out.add(ref);
    }
    return out;
}

export interface ForeignSendCheck {
    /** The send is not this tree's own: never sent. */
    foreign: boolean;
    /** People with a research number in the base. */
    base: number;
    /** People sent (placeholders aside). */
    persons: number;
    /** People sent that carry a number of the base. */
    kept: number;
}

/**
 * Whether `data` would go to the research as another tree: the base has at
 * least {@link FOREIGN_SEND_MIN_BASE} people with the research's numbers, and
 * fewer than a tenth of them are among the people sent, who themselves carry
 * such a number less than a tenth of the time (nobody sent counts as such).
 * Both shares are needed: many people added to a small research keep all of
 * the base, and a tree cut down to a branch carries the numbers of what is
 * left — only a copy that is neither reads as another tree.
 */
export function foreignSendCheck(baseRefs: ReadonlySet<string>, data: Pick<StromData, 'persons'>): ForeignSendCheck {
    let persons = 0;
    let kept = 0;
    for (const p of Object.values(data.persons ?? {})) {
        if (!p || p.isPlaceholder) continue;
        persons++;
        const ref = p.refn?.trim();
        if (ref && baseRefs.has(ref)) kept++;
    }
    const base = baseRefs.size;
    const foreign = base >= FOREIGN_SEND_MIN_BASE
        && kept < base * FOREIGN_SEND_SHARE
        && (persons === 0 || kept < persons * FOREIGN_SEND_SHARE);
    return { foreign, base, persons, kept };
}
