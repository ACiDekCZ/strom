/**
 * Context-only people that the descendants / family views de-emphasize on
 * screen (rendered at opacity 0.5, CSS class `indirect`). Pure and shared
 * verbatim by the live renderer AND the poster export, so both dim exactly the
 * same set — the poster used to print everyone at full strength.
 *
 *  - descendants: visible people who are neither blood descendants of the focus
 *    nor a partner of one (i.e. step-relatives).
 *  - family: visible people outside the "lit" set
 *      BLOOD(focus) ∪ {partners of that blood} ∪ BLOOD(each partner of focus).
 *
 * Placeholders are never dimmed. Any other view mode yields an empty set.
 */

import { StromData, PersonId } from './types.js';
import { collectBloodDescendants, collectBloodRelatives } from './layout/index.js';

export function computeIndirectIds(
    data: StromData,
    focusPersonId: PersonId,
    viewMode: string,
    visibleIds: Iterable<string>
): Set<PersonId> {
    const indirect = new Set<PersonId>();

    if (viewMode === 'descendants') {
        const blood = collectBloodDescendants(data, focusPersonId);
        for (const raw of visibleIds) {
            const id = raw as PersonId;
            if (blood.has(id)) continue;
            const p = data.persons[id];
            if (!p || p.isPlaceholder) continue;
            const partnerOfBlood = p.partnerships.some(pid => {
                const u = data.partnerships[pid];
                if (!u) return false;
                const other = u.person1Id === id ? u.person2Id : u.person1Id;
                return blood.has(other);
            });
            if (!partnerOfBlood) indirect.add(id);
        }
        return indirect;
    }

    if (viewMode === 'family') {
        const keep = collectBloodRelatives(data, focusPersonId);
        // Partners of anyone in the focus blood set stay lit.
        for (const bid of [...keep]) {
            const bp = data.persons[bid];
            if (!bp) continue;
            for (const pid of bp.partnerships) {
                const u = data.partnerships[pid];
                if (!u) continue;
                keep.add(u.person1Id === bid ? u.person2Id : u.person1Id);
            }
        }
        // Each partner of the focus keeps their whole ancestry (V-fan) lit.
        const focus = data.persons[focusPersonId];
        if (focus) {
            for (const pid of focus.partnerships) {
                const u = data.partnerships[pid];
                if (!u) continue;
                const partnerId = u.person1Id === focusPersonId ? u.person2Id : u.person1Id;
                for (const b of collectBloodRelatives(data, partnerId)) keep.add(b);
            }
        }
        for (const raw of visibleIds) {
            const id = raw as PersonId;
            if (keep.has(id)) continue;
            const p = data.persons[id];
            if (!p || p.isPlaceholder) continue;
            indirect.add(id);
        }
        return indirect;
    }

    return indirect;
}
