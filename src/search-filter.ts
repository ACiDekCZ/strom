/**
 * Advanced search filtering — a pure, read-only function shared by the search
 * UI. Criteria combine with AND; text matching is diacritics/case-insensitive
 * (reusing normalizeName from the merge engine). No mutations, no DOM.
 */

import { StromData, PersonId, Person, Gender } from './types.js';
import { yearOf } from './dates.js';
import { isLivingPerson, inferBirthUpperBounds } from './privacy.js';
import { normalizeName } from './merge/matching.js';

export interface SearchCriteria {
    /** Free text matched against the full name. */
    query?: string;
    /** Substring of the last name. */
    lastName?: string;
    /** Substring of any place (birth / death / residence event). */
    place?: string;
    /** Birth-year range (inclusive); undefined = unbounded. */
    birthFrom?: number;
    birthTo?: number;
    gender?: Gender;
    /** 'living' / 'deceased' filter (privacy heuristic); undefined = any. */
    living?: 'living' | 'deceased';
}

/** All places attached to a person: birth, death and residence events. */
function personPlaces(person: Person): string[] {
    const places: string[] = [];
    if (person.birthPlace) places.push(person.birthPlace);
    if (person.deathPlace) places.push(person.deathPlace);
    for (const ev of person.events ?? []) {
        if (ev.type === 'residence' && ev.place) places.push(ev.place);
    }
    return places;
}

/** True when at least one criterion is set (i.e. the search is "active"). */
export function hasSearchCriteria(c: SearchCriteria): boolean {
    return !!(c.query?.trim() || c.lastName?.trim() || c.place?.trim()
        || c.birthFrom !== undefined || c.birthTo !== undefined || c.gender || c.living);
}

/**
 * Return the ids of non-placeholder persons matching all given criteria.
 * With no criteria set, returns every non-placeholder person.
 */
export function filterPersons(data: StromData, criteria: SearchCriteria, currentYear: number = new Date().getFullYear()): PersonId[] {
    // Smart liveness shared with the privacy filter (indirect evidence).
    const bounds = inferBirthUpperBounds(data);
    const q = criteria.query ? normalizeName(criteria.query) : '';
    const last = criteria.lastName ? normalizeName(criteria.lastName) : '';
    const place = criteria.place ? normalizeName(criteria.place) : '';
    const wantYear = criteria.birthFrom !== undefined || criteria.birthTo !== undefined;

    const result: PersonId[] = [];
    for (const person of Object.values(data.persons)) {
        if (person.isPlaceholder) continue;

        if (q && !normalizeName(`${person.firstName} ${person.lastName}`).includes(q)) continue;
        if (last && !normalizeName(person.lastName).includes(last)) continue;
        if (place && !personPlaces(person).some(pl => normalizeName(pl).includes(place))) continue;
        if (criteria.gender && person.gender !== criteria.gender) continue;

        if (wantYear) {
            const year = yearOf(person.birthDate);
            if (year === null) continue;
            if (criteria.birthFrom !== undefined && year < criteria.birthFrom) continue;
            if (criteria.birthTo !== undefined && year > criteria.birthTo) continue;
        }

        if (criteria.living === 'living' && !isLivingPerson(person, currentYear, bounds)) continue;
        if (criteria.living === 'deceased' && isLivingPerson(person, currentYear, bounds)) continue;

        result.push(person.id);
    }
    return result;
}
