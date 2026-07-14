/**
 * Branch classification for optional colour coding relative to the focus person:
 * paternal ancestry, maternal ancestry, descendants, or other (partners /
 * in-laws). Pure over StromData — the renderer only adds a CSS class per card.
 *
 * Ties (a person reachable from both sides via pedigree collapse) resolve to the
 * FIRST side that claims them: paternal is computed before maternal, and neither
 * overwrites the other. The focus person itself is never tagged.
 */

import { StromData, PersonId, Person } from './types.js';

export type Branch = 'paternal' | 'maternal' | 'descendant';

/**
 * Split the focus person's parents into the two colour slots. Gender picks the
 * slot when it disambiguates; with two same-gender parents the second parent
 * still gets the remaining slot (both sides deserve a colour).
 */
function identifyParents(focus: Person, data: StromData): [PersonId | null, PersonId | null] {
    const parents = focus.parentIds.map(id => data.persons[id]).filter(Boolean) as Person[];
    if (parents.length === 0) return [null, null];
    if (parents.length === 1) {
        return parents[0].gender === 'female' ? [null, parents[0].id] : [parents[0].id, null];
    }
    const father = parents.find(p => p.gender === 'male');
    const mother = parents.find(p => p.gender === 'female');
    if (father && mother && father !== mother) return [father.id, mother.id];
    // Same-gender or unresolved: keep declaration order.
    return [parents[0].id, parents[1].id];
}

/**
 * Tag one ancestral side: the root parent, all of its ancestors, and the
 * siblings at every level (aunts/uncles, great-aunts/uncles). Never overwrites
 * an already-tagged person.
 */
function tagAncestorSide(data: StromData, rootId: PersonId, out: Map<PersonId, Branch>, branch: Branch): void {
    // Walk strictly upward to collect the ancestor chain (incl. the root).
    const ancestors = new Set<PersonId>();
    const stack: PersonId[] = [rootId];
    while (stack.length) {
        const id = stack.pop()!;
        if (ancestors.has(id)) continue;
        ancestors.add(id);
        const p = data.persons[id];
        if (p) for (const pid of p.parentIds) stack.push(pid);
    }
    // The side = the ancestors plus their siblings (each ancestor's parents' children).
    const side = new Set<PersonId>(ancestors);
    for (const id of ancestors) {
        const p = data.persons[id];
        if (!p) continue;
        for (const pid of p.parentIds) {
            const parent = data.persons[pid];
            if (parent) for (const sib of parent.childIds) side.add(sib);
        }
    }
    for (const id of side) if (!out.has(id)) out.set(id, branch);
}

/** Tag every descendant of the focus (via childIds), excluding the focus itself. */
function tagDescendants(data: StromData, focusId: PersonId, out: Map<PersonId, Branch>): void {
    const seen = new Set<PersonId>([focusId]);
    const stack: PersonId[] = [focusId];
    while (stack.length) {
        const id = stack.pop()!;
        const p = data.persons[id];
        if (!p) continue;
        for (const childId of p.childIds) {
            if (seen.has(childId)) continue;
            seen.add(childId);
            if (!out.has(childId)) out.set(childId, 'descendant');
            stack.push(childId);
        }
    }
}

/**
 * Classify every person relative to `focusId`. People not in the map (and the
 * focus itself) are "other" — no stripe.
 */
export function classifyBranches(data: StromData, focusId: PersonId): Map<PersonId, Branch> {
    const out = new Map<PersonId, Branch>();
    const focus = data.persons[focusId];
    if (!focus) return out;

    const [fatherId, motherId] = identifyParents(focus, data);
    if (fatherId) tagAncestorSide(data, fatherId, out, 'paternal');   // paternal wins ties
    if (motherId) tagAncestorSide(data, motherId, out, 'maternal');
    tagDescendants(data, focusId, out);

    out.delete(focusId);   // the focus never gets a stripe
    return out;
}
