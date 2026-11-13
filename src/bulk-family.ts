/**
 * Children and siblings at once (the family view): which families one step
 * shows in place. The person's children, the siblings of the person and of
 * every ancestor of theirs that stands in view with a parent in view (the
 * top row of the depth keeps its "▸ parents": its siblings would bring a
 * new generation, the depth's work). Siblings are the children of the
 * parents in view of every marriage, as the siblings tab shows them;
 * neither the siblings' partners nor their children come.
 *
 * Pure functions over the data and what the view draws (`inView`): the
 * person menu counts the people a step adds when it opens, the focus bar's
 * switch after every render, both without routing or drawing (bulkNewIds).
 */

import type { PersonId, StromData } from './types.js';
import { hiddenChildIds } from './marriage-order.js';
import { drawnPersonIds, type PipelineInput } from './layout/pipeline/index.js';

/** Who one step shows: the persons whose children come, the persons whose siblings come. */
export interface BulkFamily {
    childrenOf: Set<PersonId>;
    siblingsOf: Set<PersonId>;
}

/** Above this many new people a step asks first (the bubble with the count and the screen widths). */
export const BULK_CONFIRM_ABOVE = 150;

/** "Only 2 ancestor generations": the siblings of the person, the parents and the grandparents. */
export const BULK_TWO_GENERATIONS = 2;

/**
 * The person's parents in view (a "?" stand-in too: its children are the
 * person's siblings as the siblings tab has them).
 */
function parentsInView(data: StromData, personId: PersonId, inView: (id: PersonId) => boolean): PersonId[] {
    return (data.persons[personId]?.parentIds ?? []).filter(q => !!data.persons[q] && inView(q));
}

/**
 * Who a step for `personId` shows: its children, and the siblings of the
 * person and of each ancestor in view whose parents are in view, the
 * ancestors walked along the parents in view. `maxGeneration`: only the
 * siblings of the person and of the ancestors up to that many generations
 * above (bulk.two: 2, the parents and the grandparents).
 */
export function collectBulkFamily(data: StromData, personId: PersonId, inView: (id: PersonId) => boolean,
    maxGeneration = Infinity): BulkFamily {
    const out: BulkFamily = { childrenOf: new Set(), siblingsOf: new Set() };
    if (!data.persons[personId] || !inView(personId)) return out;
    out.childrenOf.add(personId);
    const seen = new Set<PersonId>([personId]);
    let row: PersonId[] = [personId];
    for (let generation = 0; row.length > 0 && generation <= maxGeneration; generation++) {
        const next: PersonId[] = [];
        for (const id of row) {
            const parents = parentsInView(data, id, inView);
            if (parents.length === 0) continue;
            out.siblingsOf.add(id);
            for (const q of parents) {
                if (seen.has(q)) continue;
                seen.add(q);
                next.push(q);
            }
        }
        row = next;
    }
    return out;
}

/**
 * The persons whose children a step shows in place for `family`, each once,
 * in the order of the walk (the person first, then the parents in view of
 * each person whose siblings come). `canShow`: the persons left out (their
 * children shown already, a click that drew none of them).
 */
export function bulkParents(data: StromData, family: BulkFamily, inView: (id: PersonId) => boolean,
    canShow: (id: PersonId) => boolean = () => true): PersonId[] {
    const out: PersonId[] = [];
    const add = (q: PersonId) => {
        if (out.includes(q) || !canShow(q) || hiddenChildIds(data, q, inView).length === 0) return;
        out.push(q);
    };
    for (const id of family.childrenOf) add(id);
    for (const id of family.siblingsOf) for (const q of parentsInView(data, id, inView)) add(q);
    return out;
}

/**
 * The people a step with `parents` brings into view, each once (the count
 * of the menu row and the switch): the cards a layout of the view (`input`,
 * the view's own layout input) draws with the children of `parents` shown
 * too and `drawn` (the cards drawn now) does not hold, worked out by
 * drawnPersonIds (steps 1 to 5 of the pipeline, no routing or drawing): the
 * children, the other parent of their marriages, the partners the view
 * draws with them and what the depth holds below them, as the layout then
 * draws them. The view's folds are the input's.
 */
export function bulkNewIds(input: PipelineInput, parents: readonly PersonId[], drawn: ReadonlySet<PersonId>): PersonId[] {
    if (parents.length === 0) return [];
    const shown = [...(input.expandChildrenOf ?? []), ...parents.filter(q => !input.expandChildrenOf?.includes(q))];
    return [...drawnPersonIds({ ...input, expandChildrenOf: shown })].filter(id => !drawn.has(id));
}

/**
 * The keys of `family` a step with `parents` adds: a person whose children
 * come, a person whose siblings come (any of its parents in view among
 * `parents`). Keys already shown are not among them.
 */
export function bulkAddedKeys(data: StromData, family: BulkFamily, parents: readonly PersonId[],
    inView: (id: PersonId) => boolean): { childrenOf: PersonId[]; siblingsOf: PersonId[] } {
    const set = new Set(parents);
    return {
        childrenOf: [...family.childrenOf].filter(id => set.has(id)),
        siblingsOf: [...family.siblingsOf].filter(id => parentsInView(data, id, inView).some(q => set.has(q))),
    };
}

/**
 * The cards a step brought (`broughtIn`) by the person whose children it
 * showed: each child under its parents, a card that is no child of them
 * under the parents it is a partner of (the other parent of a marriage's
 * children), a partner of a brought child under that child's parents,
 * anything else under all. Each family of the step then closes
 * alone with its own cards.
 */
export function bulkBroughtInByParent(data: StromData, parents: readonly PersonId[],
    broughtIn: ReadonlySet<PersonId>): Map<PersonId, Set<PersonId>> {
    const out = new Map(parents.map(q => [q, new Set<PersonId>()] as const));
    const partnersOf = (q: PersonId) => (data.persons[q]?.partnerships ?? []).flatMap(u => {
        const p = data.partnerships[u];
        return p ? [p.person1Id, p.person2Id] : [];
    });
    const childOf = (id: PersonId) => parents.filter(q => (data.persons[q]?.childIds ?? []).includes(id));
    for (const id of broughtIn) {
        let owners = childOf(id);
        // A partner of a parent (the other parent of a marriage's children), else of a brought child
        if (owners.length === 0) owners = parents.filter(q => partnersOf(q).includes(id));
        if (owners.length === 0) owners = [...new Set(partnersOf(id).filter(c => c !== id && broughtIn.has(c)).flatMap(childOf))];
        if (owners.length === 0) owners = [...parents];
        for (const q of owners) out.get(q)!.add(id);
    }
    return out;
}
