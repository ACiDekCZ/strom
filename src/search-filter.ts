/**
 * Advanced search filtering — a pure, read-only function shared by the search
 * UI. Criteria combine with AND; text matching is diacritics/case-insensitive
 * (reusing normalizeName from the merge engine). No mutations, no DOM.
 */

import { StromData, PersonId, Person, Gender, LifeEventType } from './types.js';
import { yearOf } from './dates.js';
import { isLivingPerson, inferBirthUpperBounds } from './privacy.js';
import { normalizeName } from './merge/matching.js';
import { nameMatchesQuery, surnameMatchesQuery } from './name-search.js';
import { coupleEventLabel } from './events.js';

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

/** Where a search found a person outside the name: a cause or a house on one of their events. */
export interface DetailMatch {
    /** The event, as its type ('birth' / 'death' for the person's own fields). */
    type: LifeEventType;
    date?: string;
    place?: string;
    /** The matching value as written ("cholera", "čp. 13"). */
    value: string;
    /** A couple's event: its name in place of `type` ("Banns"). */
    label?: string;
}

/**
 * The first cause or house of a person's events that contains `query`
 * (normalized, see normalizeName) — "cholera" finds everyone who died of it.
 * With `data`, the person's couples' events count too: their name, place,
 * house and note ("ohlášky", "čp. 13" find both partners).
 * Null when nothing matches or the query is shorter than three letters.
 */
export function detailMatch(person: Person, query: string, data?: StromData | null): DetailMatch | null {
    if (query.length < 3) return null;
    const hit = (v?: string): boolean => !!v && normalizeName(v).includes(query);
    if (hit(person.deathCause)) return { type: 'death', date: person.deathDate, place: person.deathPlace, value: person.deathCause! };
    for (const ev of person.events ?? []) {
        if (hit(ev.cause)) return { type: ev.type, date: ev.date, place: ev.place, value: ev.cause! };
    }
    if (hit(person.deathAddress)) return { type: 'death', date: person.deathDate, place: person.deathPlace, value: person.deathAddress! };
    if (hit(person.birthAddress)) return { type: 'birth', date: person.birthDate, place: person.birthPlace, value: person.birthAddress! };
    for (const ev of person.events ?? []) {
        if (hit(ev.address)) return { type: ev.type, date: ev.date, place: ev.place, value: ev.address! };
    }
    for (const unionId of data ? person.partnerships : []) {
        for (const ev of data!.partnerships[unionId]?.events ?? []) {
            const label = coupleEventLabel(ev);
            const value = [label, ev.place, ev.address, ev.cause, ev.note].find(hit);
            if (value) return { type: 'custom', label, date: ev.date, place: ev.place, value: value.trim() };
        }
    }
    return null;
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
    // Names match under every form: other surname forms and name variants.
    const place = criteria.place ? normalizeName(criteria.place) : '';
    const wantYear = criteria.birthFrom !== undefined || criteria.birthTo !== undefined;

    const result: PersonId[] = [];
    for (const person of Object.values(data.persons)) {
        if (person.isPlaceholder) continue;

        if (q && !nameMatchesQuery(person, q, data) && !detailMatch(person, q, data)) continue;
        if (last && !surnameMatchesQuery(person, last, data)) continue;
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
