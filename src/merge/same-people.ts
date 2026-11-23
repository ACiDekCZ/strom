/**
 * "The same people are also in the tree {x}, which is linked to a research"
 * (spec 134 K9.5, step 1). A cheap check, not a match: each side's people
 * become keys of their normalized first name, surname and birth year, only
 * people with all three (a name alone repeats too often to say anything).
 * The import shares its people with the other tree when at least
 * `SAME_PEOPLE_MIN` of its keyed people are there and they make at least
 * `SAME_PEOPLE_SHARE` of them: a branch exported from that tree, or a copy
 * of it, yes; two trees meeting in a few ancestors, no.
 */

import type { StromData } from '../types.js';
import { normalizeName } from './matching.js';
import { yearOf } from '../dates.js';

export const SAME_PEOPLE_MIN = 3;
export const SAME_PEOPLE_SHARE = 0.5;

/** Name + surname + birth year keys of a tree's people (placeholders and people without one of the three aside). */
export function peopleKeys(data: StromData): Set<string> {
    const keys = new Set<string>();
    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        const first = normalizeName(p.firstName ?? '');
        const last = normalizeName(p.lastName ?? '');
        const year = yearOf(p.birthDate);
        if (!first || !last || year === null) continue;
        keys.add(`${first}|${last}|${year}`);
    }
    return keys;
}

/** The import's people are largely in `other` too (see the module's note). */
export function sharesPeople(incoming: StromData | Set<string>, other: StromData | Set<string>): boolean {
    const a = incoming instanceof Set ? incoming : peopleKeys(incoming);
    if (a.size < SAME_PEOPLE_MIN) return false;
    const b = other instanceof Set ? other : peopleKeys(other);
    let common = 0;
    for (const k of a) if (b.has(k)) common++;
    return common >= SAME_PEOPLE_MIN && common >= a.size * SAME_PEOPLE_SHARE;
}
