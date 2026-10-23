/**
 * Folding ancestors for children shown in place (the card's children tab).
 *
 * Showing an ancestor's children can leave them far from the couple they
 * belong to. Two rules fold some ancestors away for as long as the children
 * are shown (PipelineInput.foldAncestorsOf), each fold belonging to the
 * shown children that caused it:
 *
 * - B: an ancestor's siblings belong on the inner side of the pedigree and
 *   only the partner's parents keep them from standing beyond the partner
 *   (InnerSiblingRun with besidePartner false): the partner's ancestors fold,
 *   the row then reads person, partner, siblings.
 * - B2 (span): the clicked couple's line comes down more than two card
 *   widths from the nearest of its children: the ancestors of the partner
 *   whose ancestors stand between the couple and the children fold, then if
 *   that is not enough the other partner's too; if even that is not enough,
 *   nothing is folded for the span.
 *
 * Without children shown nothing folds and the layout is runLayoutPipeline's.
 */

import { PersonId, StromData } from '../../types.js';
import { LayoutResult, PipelineInput } from './types.js';
import { runLayoutPipeline } from './index.js';

export interface ShownChildrenFolding {
    /**
     * Each person of expandChildrenOf whose shown children fold ancestors →
     * the persons whose ancestors are folded for it, in folding order.
     */
    foldedAncestorsOf: Map<PersonId, PersonId[]>;
    /**
     * Each person whose ancestors are folded → the person of expandChildrenOf
     * whose shown children folded them (hiding those children brings the
     * ancestors back).
     */
    foldedFor: Map<PersonId, PersonId>;
    /** The layout with every fold applied. */
    result: LayoutResult;
}

/**
 * The layout of `input` with the ancestors folded that the children shown
 * (input.expandChildrenOf) call for (rules B and B2 above). The input's own
 * foldAncestorsOf is not used: the folds are decided here.
 */
export function planShownChildrenFolding(input: PipelineInput): ShownChildrenFolding {
    const { foldAncestorsOf: _ignored, ...base } = input;
    const shown = input.expandChildrenOf ?? [];
    const foldedAncestorsOf = new Map<PersonId, PersonId[]>();
    const foldedFor = new Map<PersonId, PersonId>();
    const run = (folds: readonly PersonId[]): LayoutResult =>
        runLayoutPipeline(folds.length > 0 ? { ...base, foldAncestorsOf: folds } : base);

    let result = run([]);
    if (shown.length === 0) return { foldedAncestorsOf, foldedFor, result };

    const data = result.viewLayer?.data ?? input.data;
    let folds: PersonId[] = [];
    const assign = (personId: PersonId, shownId: PersonId): void => {
        folds.push(personId);
        foldedFor.set(personId, shownId);
        const list = foldedAncestorsOf.get(shownId) ?? [];
        list.push(personId);
        foldedAncestorsOf.set(shownId, list);
    };
    const unassign = (personIds: readonly PersonId[]): void => {
        for (const personId of personIds) {
            const shownId = foldedFor.get(personId);
            foldedFor.delete(personId);
            folds = folds.filter(id => id !== personId);
            if (!shownId) continue;
            const list = (foldedAncestorsOf.get(shownId) ?? []).filter(id => id !== personId);
            if (list.length > 0) foldedAncestorsOf.set(shownId, list);
            else foldedAncestorsOf.delete(shownId);
        }
    };

    // B: the partner's parents keep an ancestor's siblings on the inner side
    const blocked = (result.innerSiblingRuns ?? []).filter(r => !r.besidePartner);
    const tried: PersonId[] = [];
    for (const r of blocked) {
        if (foldedFor.has(r.partnerId)) continue;
        // The siblings are there because a parent of the person shows them
        const parents = data.persons[r.personId]?.parentIds ?? [];
        const shownId = shown.find(id => parents.includes(id));
        if (!shownId) continue;
        assign(r.partnerId, shownId);
        tried.push(r.partnerId);
    }
    if (tried.length > 0) {
        let next = run(folds);
        // A fold that did not free the place (the partner's parents stay in
        // view another way) is given up
        const failed = tried.filter(q => !(next.innerSiblingRuns ?? []).some(r => r.partnerId === q && r.besidePartner));
        if (failed.length > 0) {
            unassign(failed);
            next = run(folds);
        }
        result = next;
    }

    // B2: the clicked couple's line far from its children
    const limit = 2 * input.config.cardWidth;
    for (const shownId of shown) {
        const span = coupleSpan(data, result, shownId, input.config.cardWidth);
        if (!span || span.gap <= limit) continue;
        const candidates = foldOrder(data, result, span, input.config.cardWidth)
            .filter(id => !foldedFor.has(id));
        const added: PersonId[] = [];
        let fixed: LayoutResult | null = null;
        for (const personId of candidates) {
            assign(personId, shownId);
            const next = run(folds);
            // Parents the view reaches another way stay: nothing to fold there
            if ((data.persons[personId]?.parentIds ?? []).some(id => next.positions.has(id))) {
                unassign([personId]);
                continue;
            }
            added.push(personId);
            const after = coupleSpan(data, next, shownId, input.config.cardWidth);
            if (after && after.gap <= limit) { fixed = next; break; }
        }
        // Not enough even with both: the span stays (nothing folded for it)
        if (fixed) result = fixed;
        else unassign(added);
    }
    return { foldedAncestorsOf, foldedFor, result };
}

interface CoupleSpan {
    /** The clicked person and their partner of the union measured (if drawn). */
    members: PersonId[];
    stemX: number;
    /** Card edges of the union's children in view. */
    left: number;
    right: number;
    /** Distance from the stem to the nearest child card edge (0: the stem is above the children). */
    gap: number;
}

/**
 * The line of the clicked person's union with the children farthest from it:
 * where the stem comes down and the card span of the children below.
 */
function coupleSpan(data: StromData, result: LayoutResult, personId: PersonId, cardWidth: number): CoupleSpan | null {
    let best: CoupleSpan | null = null;
    for (const conn of result.connections) {
        const kids = conn.drops.map(d => d.personId).filter(id => result.positions.has(id));
        if (kids.length === 0) continue;
        if (!kids.some(id => (data.persons[id]?.parentIds ?? []).includes(personId))) continue;
        const xs = kids.map(id => result.positions.get(id)!.x);
        const left = Math.min(...xs);
        const right = Math.max(...xs) + cardWidth;
        const gap = conn.stemX < left ? left - conn.stemX : conn.stemX > right ? conn.stemX - right : 0;
        const partners = new Set<PersonId>();
        for (const id of kids) for (const p of data.persons[id]?.parentIds ?? []) {
            if (p !== personId && result.positions.has(p)) partners.add(p);
        }
        const members = [personId, ...[...partners].slice(0, 1)];
        if (!best || gap > best.gap) best = { members, stemX: conn.stemX, left, right, gap };
    }
    return best;
}

/** Drawn ancestors of a person (parents, their parents, ...). */
function drawnAncestors(data: StromData, result: LayoutResult, personId: PersonId): PersonId[] {
    const out: PersonId[] = [];
    const seen = new Set<PersonId>([personId]);
    const queue = [...(data.persons[personId]?.parentIds ?? [])];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!result.positions.has(id)) continue;
        out.push(id);
        queue.push(...(data.persons[id]?.parentIds ?? []));
    }
    return out;
}

/**
 * The couple members to fold, in order: first the one whose ancestors stand
 * between the couple and the children (most card width inside that gap; on a
 * tie the one nearer the children), then the other. Members without
 * ancestors in view have nothing to fold; with no ancestors in the gap at all
 * nothing is folded (the span has another cause).
 */
function foldOrder(data: StromData, result: LayoutResult, span: CoupleSpan, cardWidth: number): PersonId[] {
    const lo = span.stemX < span.left ? span.stemX : span.right;
    const hi = span.stemX < span.left ? span.left : span.stemX;
    const towardChildren = span.stemX < span.left ? 1 : -1;
    const scored = span.members
        .map(id => {
            const ancestors = drawnAncestors(data, result, id);
            let inside = 0;
            for (const a of ancestors) {
                const x = result.positions.get(a)!.x;
                inside += Math.max(0, Math.min(hi, x + cardWidth) - Math.max(lo, x));
            }
            const x = result.positions.get(id)?.x ?? 0;
            return { id, inside, has: ancestors.length > 0, toward: x * towardChildren };
        })
        .filter(m => m.has);
    scored.sort((a, b) => (b.inside - a.inside) || (b.toward - a.toward));
    // Nobody's ancestors in the way: folding would not bring the couple nearer
    if (scored.length === 0 || scored[0].inside <= 0) return [];
    return scored.map(m => m.id);
}
