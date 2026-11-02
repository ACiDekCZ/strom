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
 */

import { LineageIndex, RodId, partnersOf, realRodMembers, sortByBirth } from './lineage.js';
import type { PersonId } from './types.js';

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
    if (members.length === 0) return null;
    if (members.some(id => drawn.has(id))) return null;
    const founder = index.data.persons[rod.founderId] ? rod.founderId : members[0];
    const pick = (id: PersonId): PersonId | null => (id === focusId ? null : id);
    if (view === 'descendants' || !focusId || !index.data.persons[focusId]) return pick(founder);

    const memberSet = new Set(members);
    const data = index.data;
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
    return pick(founder);
}
