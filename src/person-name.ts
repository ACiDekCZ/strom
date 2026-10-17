/**
 * A person's name as it is shown: with the titles of the name (Person.
 * titleBefore / titleAfter — "Ing. Jan Novák ml.") while Settings → "Show
 * titles" is on, the bare name otherwise; and with the surname Settings →
 * "Surname display" picks: the birth surname (lastName), or the married one
 * (Person.marriedSurname) when the person has it — by default with the birth
 * surname as a quiet note after it ("Marie Nováková (roz. Dvořáková)").
 *
 * Only for showing. Search, duplicate and merge matching, initials and the
 * GEDCOM name read firstName / lastName alone: a title says nothing about who
 * someone is ("Ing." must not make two records of one man look different, nor
 * two different men alike).
 *
 * shownName() is the name without the note: the ~100 places that write a name
 * as plain text keep one short name; shownNameFull() adds the note in
 * brackets, nameHtml() as a quiet span.
 */

import { Person, SurnameDisplay } from './types.js';
import { SettingsManager } from './settings.js';
import { strings } from './strings.js';

type Named = Pick<Person, 'firstName' | 'lastName' | 'titleBefore' | 'titleAfter' | 'marriedSurname'> & { isPlaceholder?: boolean };

/** Whether titles are shown with names (the setting; default on). */
export function titlesShown(): boolean {
    return SettingsManager.isShowTitles();
}

/** Which surname names show (the setting; default 'both'). */
export function surnameDisplay(): SurnameDisplay {
    return SettingsManager.getSurnameDisplay();
}

/** The titles to show for a person: none for a placeholder or with the setting off. */
function titlesOf(person: Named, show: boolean): { before: string; after: string } {
    if (!show || person.isPlaceholder) return { before: '', after: '' };
    return { before: person.titleBefore?.trim() ?? '', after: person.titleAfter?.trim() ?? '' };
}

/**
 * The name's shown parts: the given name with the title before it ("Ing.
 * Jan"), the surname with the title after it ("Novák ml.") — the two lines
 * of a card whose name breaks in two — and the birth surname as a note
 * (`birthNote`, '' unless the setting is 'both' and the person has a married
 * surname). The surname is the married one with 'both' / 'married' when the
 * person has it, the birth surname (lastName) otherwise. `emptyGiven` stands
 * in for a missing given name ('?' on a card).
 */
export function shownNameParts(person: Named, emptyGiven = '', show = titlesShown(), display = surnameDisplay()): {
    given: string; surname: string; birthNote: string;
} {
    const { before, after } = titlesOf(person, show);
    const given = person.firstName || emptyGiven;
    const birth = person.lastName ?? '';
    const married = person.isPlaceholder ? '' : person.marriedSurname?.trim() ?? '';
    const useMarried = !!married && display !== 'birth';
    const surname = useMarried ? married : birth;
    return {
        given: [before, given].filter(Boolean).join(' '),
        surname: [surname, after].filter(Boolean).join(' '),
        birthNote: useMarried && display === 'both' && birth.trim() && birth.trim() !== married ? birth.trim() : '',
    };
}

/**
 * The whole name as shown, without the birth-surname note: "Ing. Jan Novák
 * ml.", "Marie Nováková". `emptyGiven` stands in for a missing given name; a
 * name with nothing at all is '?'.
 */
export function shownName(person: Named, emptyGiven = '', show = titlesShown(), display = surnameDisplay()): string {
    const { given, surname } = shownNameParts(person, emptyGiven, show, display);
    return `${given} ${surname}`.trim() || '?';
}

/** The birth-surname note as written after a name: "roz. Dvořáková" ('' for none). */
export function birthNoteText(birthNote: string): string {
    return birthNote ? `${strings.name.birthAbbr} ${birthNote}` : '';
}

/**
 * The whole name with the birth-surname note in brackets: "Marie Nováková
 * (roz. Dvořáková)", "Ing. Marie Nováková ml. (roz. Dvořáková)" — tooltips,
 * screen readers. Without a note it is shownName().
 */
export function shownNameFull(person: Named, emptyGiven = '', show = titlesShown(), display = surnameDisplay()): string {
    const name = shownName(person, emptyGiven, show, display);
    const { birthNote } = shownNameParts(person, emptyGiven, show, display);
    return birthNote ? `${name} (${birthNoteText(birthNote)})` : name;
}

/**
 * The whole name as shown, '' for a person with no name at all — for a place
 * that has a stand-in of its own (a note's name, the person's id).
 */
export function shownNameOrEmpty(person: Named, show = titlesShown(), display = surnameDisplay()): string {
    const { given, surname } = shownNameParts(person, '', show, display);
    return `${given} ${surname}`.trim();
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

export interface NameHtmlOptions {
    /**
     * Where the birth-surname note goes: 'inline' after the name (a whole
     * that wraps as one: "roz." never parts from the surname), 'line' on a
     * line of its own under the name, 'fit' after the name on one row of a
     * dense list (the name stays whole, the note shortens with "…"), 'none'
     * left out.
     */
    note?: 'inline' | 'line' | 'fit' | 'none';
    emptyGiven?: string;
    show?: boolean;
    display?: SurnameDisplay;
}

/**
 * The shown name as HTML (escaped): with a note, the name in
 * `<span class="pn-main">` and "(roz. Dvořáková)" in `<span class="pn-note">`;
 * without one the escaped name alone, exactly what was written before notes
 * existed.
 */
export function nameHtml(person: Named, opts: NameHtmlOptions = {}): string {
    const note = opts.note ?? 'inline';
    const show = opts.show ?? titlesShown();
    const display = opts.display ?? surnameDisplay();
    const name = shownName(person, opts.emptyGiven ?? '', show, display);
    const { birthNote } = shownNameParts(person, opts.emptyGiven ?? '', show, display);
    if (!birthNote || note === 'none') return escapeHtml(name);
    const main = `<span class="pn-main">${escapeHtml(name)}</span>`;
    if (note === 'line') return `${main}<span class="pn-note pn-note--line">${escapeHtml(birthNoteText(birthNote))}</span>`;
    const noteSpan = `<span class="pn-note">(${escapeHtml(birthNoteText(birthNote))})</span>`;
    if (note === 'fit') return `<span class="pn-fit">${main}${noteSpan}</span>`;
    return `${main} ${noteSpan}`;
}

/**
 * A name on one row of a dense list (merge lists, research panels,
 * participants), as HTML: with a birth-surname note, the name whole and the
 * note shortened to fit (nameHtml 'fit'), then `suffix` ("(*1900)");
 * without one exactly `plain` + `suffix`, escaped — the row's text as it was
 * before married surnames.
 */
export function fitNameHtml(person: Named, plain: string, suffix = ''): string {
    const { birthNote } = shownNameParts(person, '', titlesShown(), surnameDisplay());
    const tail = suffix ? ` ${escapeHtml(suffix)}` : '';
    if (!birthNote) return escapeHtml(plain) + tail;
    return nameHtml(person, { note: 'fit' }) + tail;
}
