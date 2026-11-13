/**
 * The kind shown in the overview's "What the research knows" (spec 052 §3):
 * all of it, its conflicts or its hypotheses. Chosen while the overview is
 * open, never kept.
 */

export type KnowsKind = 'all' | 'con' | 'hyp';

/**
 * Which kind is shown and whether the chips are offered: a kind without an
 * item is not offered, and with one kind left there are no chips at all.
 */
export function knowsKindChoice(conflicts: number, hypotheses: number, chosen: KnowsKind): { kind: KnowsKind; chips: boolean } {
    const chips = conflicts > 0 && hypotheses > 0;
    return { kind: chips ? chosen : 'all', chips };
}

/** A row (a conflict or a hypothesis) is shown under `kind`. */
export function knowsKindShows(kind: KnowsKind, conflict: boolean): boolean {
    return kind === 'all' || (kind === 'con') === conflict;
}
