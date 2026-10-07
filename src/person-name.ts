/**
 * A person's name as it is shown: with the titles of the name (Person.
 * titleBefore / titleAfter — "Ing. Jan Novák ml.") while Settings → "Show
 * titles" is on, the bare name otherwise.
 *
 * Only for showing. Search, duplicate and merge matching, initials and the
 * GEDCOM name read firstName / lastName alone: a title says nothing about who
 * someone is ("Ing." must not make two records of one man look different, nor
 * two different men alike).
 */

import { Person } from './types.js';
import { SettingsManager } from './settings.js';

type Named = Pick<Person, 'firstName' | 'lastName' | 'titleBefore' | 'titleAfter'> & { isPlaceholder?: boolean };

/** Whether titles are shown with names (the setting; default on). */
export function titlesShown(): boolean {
    return SettingsManager.isShowTitles();
}

/** The titles to show for a person: none for a placeholder or with the setting off. */
function titlesOf(person: Named, show: boolean): { before: string; after: string } {
    if (!show || person.isPlaceholder) return { before: '', after: '' };
    return { before: person.titleBefore?.trim() ?? '', after: person.titleAfter?.trim() ?? '' };
}

/**
 * The name's two shown parts: the given name with the title before it ("Ing.
 * Jan") and the surname with the title after it ("Novák ml.") — the two lines
 * of a card whose name breaks in two. `emptyGiven` stands in for a missing
 * given name ('?' on a card).
 */
export function shownNameParts(person: Named, emptyGiven = '', show = titlesShown()): { given: string; surname: string } {
    const { before, after } = titlesOf(person, show);
    const given = person.firstName || emptyGiven;
    const surname = person.lastName ?? '';
    return {
        given: [before, given].filter(Boolean).join(' '),
        surname: [surname, after].filter(Boolean).join(' '),
    };
}

/**
 * The whole name as shown: "Ing. Jan Novák ml.". `emptyGiven` stands in for a
 * missing given name; a name with nothing at all is '?'.
 */
export function shownName(person: Named, emptyGiven = '', show = titlesShown()): string {
    const { given, surname } = shownNameParts(person, emptyGiven, show);
    return `${given} ${surname}`.trim() || '?';
}

/**
 * The whole name as shown, '' for a person with no name at all — for a place
 * that has a stand-in of its own (a note's name, the person's id).
 */
export function shownNameOrEmpty(person: Named, show = titlesShown()): string {
    const { given, surname } = shownNameParts(person, '', show);
    return `${given} ${surname}`.trim();
}
