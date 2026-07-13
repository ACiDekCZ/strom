/**
 * Living-person privacy filter for exports.
 *
 * When a tree leaves the family (shared/embedded/GEDCOM export), details of
 * people who are probably still alive can be hidden. The filter always returns
 * a DEEP COPY and never mutates the original; the tree STRUCTURE (ids,
 * relationships, partnerships, gender) is always preserved so the exported tree
 * still renders.
 */

import { StromData, Person } from './types.js';
import { strings } from './strings.js';
import { yearOf } from './dates.js';

export type PrivacyMode = 'full' | 'initials' | 'anonymous' | 'minimal';

/** Ages beyond this (with no death date) are assumed deceased. */
const ASSUMED_MAX_AGE = 110;

/**
 * Whether a person should be treated as living. A death date (or isDeceased:
 * true) means deceased; isDeceased: false forces living. Otherwise: living if
 * there is no death date and the birth year is within ASSUMED_MAX_AGE (or there
 * is no birth date at all — unknown people are treated as living, to be safe).
 */
export function isLivingPerson(person: Person, currentYear: number = new Date().getFullYear()): boolean {
    if (person.isDeceased === true) return false;
    if (person.isDeceased === false) return true;
    if (person.deathDate) return false;
    const birthYear = yearOf(person.birthDate);
    if (birthYear === null) return true;
    return currentYear - birthYear < ASSUMED_MAX_AGE;
}

/** First letter + '.', e.g. "Jan" -> "J.". Empty stays empty. */
function initial(name: string): string {
    const trimmed = name.trim();
    return trimmed ? `${trimmed[0].toUpperCase()}.` : '';
}

/** Drop every detail field, keeping only identity/structure fields. */
function stripDetails(person: Person): void {
    delete person.birthDate;
    delete person.birthPlace;
    delete person.deathDate;
    delete person.deathPlace;
    delete person.notes;
    delete person.photo;
    delete person.photoOriginalName;
    // Life events carry places and dates — drop them for living people.
    delete person.events;
    // Source citations may point at sensitive references — drop them too.
    delete person.sourceIds;
}

/**
 * Return a deep copy of `data` with living persons obscured according to `mode`.
 * Deceased persons and placeholders are left untouched. 'full' is a no-op copy.
 */
export function applyLivingPrivacy(
    data: StromData,
    mode: PrivacyMode,
    currentYear: number = new Date().getFullYear()
): StromData {
    const copy = structuredClone(data);
    if (mode === 'full') return copy;

    // The source catalog may hold sensitive references (e.g. registers of the
    // living), so it is never exported under a privacy mode. Drop every citation
    // too, so no person/event points at a source that is no longer present.
    delete copy.sources;
    for (const person of Object.values(copy.persons)) {
        delete person.sourceIds;
        for (const ev of person.events ?? []) delete ev.sourceIds;
    }

    for (const person of Object.values(copy.persons)) {
        if (person.isPlaceholder) continue;
        if (!isLivingPerson(person, currentYear)) continue;

        switch (mode) {
            case 'initials': {
                const birthYear = yearOf(person.birthDate);
                person.firstName = initial(person.firstName);
                person.lastName = initial(person.lastName);
                stripDetails(person);
                if (birthYear !== null) person.birthDate = String(birthYear);
                break;
            }
            case 'anonymous': {
                stripDetails(person);
                person.firstName = strings.privacy.livingPerson;
                person.lastName = '';
                break;
            }
            case 'minimal': {
                const keptLastName = person.lastName;
                stripDetails(person);
                person.firstName = strings.privacy.livingPerson;
                person.lastName = keptLastName;
                break;
            }
        }
    }

    return copy;
}
