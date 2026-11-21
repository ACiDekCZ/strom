/**
 * Where the focus goes when a family line is chosen in the tree view
 * (spec 039 §4.4). Pure: no DOM, no app state.
 *
 * The focus stays when any real member of the line is in the drawing (the
 * married-in spouses do not count). Otherwise, in the Family and Fan views,
 * the member the fewest steps away from the focus (over parents, children
 * and partners), a tie to the one born first; a line not connected to the
 * focus goes to its founder. In Descendants it always goes to the founder
 * (the view draws from the focus down).
 *
 * selectionFocusTarget: the same for every selection of people (spec 098 §9).
 */

import { LineageIndex, RodId, partnersOf, realRodMembers, sortByBirth } from './lineage.js';
import type { PersonId, StromData } from './types.js';

export type RodFocusView = 'family' | 'descendants' | 'timeline' | 'fan' | 'map';

/** The person to focus for `rodId`, or null to leave the focus where it is. */
export function rodFocusTarget(
    index: LineageIndex,
    rodId: RodId,
    focusId: PersonId | null,
    drawn: ReadonlySet<PersonId>,
    view: RodFocusView,
): PersonId | null {
    const rod = index.rods.get(rodId);
    if (!rod) return null;
    const members = realRodMembers(index, rodId);
    const founder = index.data.persons[rod.founderId] ? rod.founderId : members[0];
    return selectionFocusTarget(index.data, members, founder, focusId, drawn, view);
}

/**
 * The same for any selection of people (spec 098 §9: a family line, the
 * ancestors or descendants of a person, a research line, a list): null while
 * any of `members` is drawn; else the member the fewest steps away from the
 * focus (a tie to the one born first), `root` when none is connected to it
 * and always in Descendants (a family line's founder, the person whose
 * ancestors or descendants they are; null: the member born first).
 */
export function selectionFocusTarget(
    data: StromData,
    members: readonly PersonId[],
    root: PersonId | null,
    focusId: PersonId | null,
    drawn: ReadonlySet<PersonId>,
    view: RodFocusView,
): PersonId | null {
    const real = members.filter(id => !!data.persons[id] && !data.persons[id].isPlaceholder);
    if (real.length === 0) return null;
    if (real.some(id => drawn.has(id))) return null;
    const start = root && data.persons[root] ? root : sortByBirth(data, [...real])[0];
    const pick = (id: PersonId): PersonId | null => (id === focusId ? null : id);
    if (view === 'descendants' || !focusId || !data.persons[focusId]) return pick(start);

    const memberSet = new Set(real);
    const seen = new Set<PersonId>([focusId]);
    let level: PersonId[] = [focusId];
    while (level.length > 0) {
        const hits = level.filter(id => memberSet.has(id));
        if (hits.length > 0) return pick(sortByBirth(data, hits)[0]);
        const next: PersonId[] = [];
        for (const id of level) {
            const p = data.persons[id];
            if (!p) continue;
            for (const n of [...p.parentIds, ...p.childIds, ...partnersOf(data, id)]) {
                if (!n || seen.has(n) || !data.persons[n]) continue;
                seen.add(n);
                next.push(n);
            }
        }
        level = next;
    }
    return pick(start);
}
