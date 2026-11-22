/**
 * Branch classification for optional lineage markers relative to the focus
 * person: paternal ancestry, maternal ancestry, descendants, or other
 * (partners / in-laws / siblings / cousins). Pure over StromData — the renderer
 * only adds CSS classes per card.
 *
 * A person reachable from both sides (pedigree collapse, e.g. a marriage of
 * cousins) belongs to BOTH lines and carries both markers (R4). The focus
 * person itself is never tagged.
 */

import { StromData, PersonId, Person } from './types.js';
import { parentSlots } from './model-values.js';

export type Branch = 'paternal' | 'maternal' | 'descendant';

/** The lines one person belongs to (R4: paternal and maternal may both be set). */
export interface BranchSet { paternal?: true; maternal?: true; descendant?: true; }

/**
 * Classification result. `numbered` is true when the focus person's two known
 * parents share a gender (R5): the two lines are then named "first parent's
 * line" / "second parent's line" instead of paternal / maternal.
 */
export interface BranchResult { map: Map<PersonId, BranchSet>; numbered: boolean; }

/**
 * Split the focus person's parents into the two slots. Gender picks the slot
 * when it disambiguates (a parent of unknown sex the slot the other one leaves
 * free); with two same-gender parents the second parent still gets the
 * remaining slot (both sides deserve a marker).
 */
function identifyParents(focus: Person, data: StromData): [PersonId | null, PersonId | null] {
    const parents = focus.parentIds.map(id => data.persons[id]).filter(Boolean) as Person[];
    const [father, mother] = parentSlots(parents.slice(0, 2));
    return [father?.id ?? null, mother?.id ?? null];
}

/** R5: both parents known and of the same (known) gender. */
function sameGenderParents(focus: Person, data: StromData): boolean {
    const parents = focus.parentIds.map(id => data.persons[id]).filter(Boolean) as Person[];
    if (parents.length < 2) return false;
    const [a, b] = parents;
    return (a.gender === 'male' || a.gender === 'female') && a.gender === b.gender;
}

/**
 * Collect one ancestral side: the root parent, all of its ancestors, and the
 * siblings at every level (aunts/uncles, great-aunts/uncles).
 */
function collectAncestorSide(data: StromData, rootId: PersonId): Set<PersonId> {
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
    return side;
}

function mark(out: Map<PersonId, BranchSet>, id: PersonId, branch: Branch): void {
    const set = out.get(id) ?? {};
    set[branch] = true;
    out.set(id, set);
}

/** Every descendant of the focus (via childIds), excluding the focus itself. */
function collectDescendants(data: StromData, focusId: PersonId): Set<PersonId> {
    const seen = new Set<PersonId>([focusId]);
    const result = new Set<PersonId>();
    const stack: PersonId[] = [focusId];
    while (stack.length) {
        const id = stack.pop()!;
        const p = data.persons[id];
        if (!p) continue;
        for (const childId of p.childIds) {
            if (seen.has(childId)) continue;
            seen.add(childId);
            result.add(childId);
            stack.push(childId);
        }
    }
    return result;
}

/**
 * Classify every person relative to `focusId`. People not in the map (and the
 * focus itself) are "other" — no marker. Paternal and maternal add up (R4);
 * a descendant marker is given only to people on neither ancestral side.
 */
export function classifyBranches(data: StromData, focusId: PersonId): BranchResult {
    const map = new Map<PersonId, BranchSet>();
    const focus = data.persons[focusId];
    if (!focus) return { map, numbered: false };

    const [fatherId, motherId] = identifyParents(focus, data);
    for (const [rootId, branch] of [[fatherId, 'paternal'], [motherId, 'maternal']] as const) {
        if (rootId) for (const id of collectAncestorSide(data, rootId)) mark(map, id, branch);
    }
    // Already on an ancestral side (only through a cycle in the data) → no descendant marker.
    for (const id of collectDescendants(data, focusId)) {
        if (!map.has(id)) mark(map, id, 'descendant');
    }

    map.delete(focusId);   // the focus never gets a marker
    return { map, numbered: sameGenderParents(focus, data) };
}

/** The lines of a set, in the fixed order paternal → maternal → descendant. */
export function branchesOf(set: BranchSet | undefined): Branch[] {
    if (!set) return [];
    const out: Branch[] = [];
    if (set.paternal) out.push('paternal');
    if (set.maternal) out.push('maternal');
    if (set.descendant) out.push('descendant');
    return out;
}
