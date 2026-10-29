/**
 * A person's name as it is shown: with the titles of the name (Person.
 * titleBefore / titleAfter — "Ing. Jan Novák ml.") while Settings → "Show
 * titles" is on, the bare name otherwise; and with the surname Settings →
 * "Surname display" picks: the birth surname (lastName), or the married one
 * (Person.marriedSurname) when the person has it — by default with the birth
 * surname as a quiet note after it ("Marie Nováková (roz. Dvořáková)").
 * A person can go by the birth surname although she has a married one
 * (Person.primaryName 'birth', e.g. back to it after a divorce): then she
 * shows the birth surname, and the person's detail says "(dříve Zástěrová)".
 * This file is the single place of that rule:
 *
 *   setting  primaryName      surname   note
 *   birth    any              birth     none
 *   both     none / married   married   "(roz. birth)"
 *   both     birth            birth     "(dříve married)"
 *   married  none / married   married   none
 *   married  birth            birth     "(dříve married)"
 *
 * Without a married surname primaryName means nothing; with the married
 * surname equal to the birth one there is no note. "roz." and "dříve" never
 * come together; cards never show "dříve" (only the detail asks for it).
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

type Named = Pick<Person, 'firstName' | 'lastName' | 'titleBefore' | 'titleAfter' | 'marriedSurname' | 'primaryName'> & { isPlaceholder?: boolean };

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
 * Whether a person's shown surname is the birth one although she has a
 * married surname: the setting is 'birth', or the person goes by the birth
 * surname (Person.primaryName 'birth'). False without a married surname (or
 * for a placeholder) — nothing is hidden then.
 */
export function shownSurnameIsBirth(person: Named, display = surnameDisplay()): boolean {
    const married = person.isPlaceholder ? '' : person.marriedSurname?.trim() ?? '';
    return !!married && (display === 'birth' || person.primaryName === 'birth');
}

/**
 * The name's shown parts: the given name with the title before it ("Ing.
 * Jan"), the surname with the title after it ("Novák ml.") — the two lines
 * of a card whose name breaks in two — and two notes, never both set: the
 * birth surname (`birthNote`, '' unless the setting is 'both' and the married
 * surname is shown) and the married surname the person no longer goes by
 * (`formerNote`, '' unless Person.primaryName is 'birth' and the setting is
 * not 'birth'). The surname is the married one with 'both' / 'married' when
 * the person has it and does not go by the birth one, the birth surname
 * (lastName) otherwise. `emptyGiven` stands in for a missing given name
 * ('?' on a card).
 */
export function shownNameParts(person: Named, emptyGiven = '', show = titlesShown(), display = surnameDisplay()): {
    given: string; surname: string; birthNote: string; formerNote: string;
} {
    const { before, after } = titlesOf(person, show);
    const given = person.firstName || emptyGiven;
    const birth = person.lastName ?? '';
    const married = person.isPlaceholder ? '' : person.marriedSurname?.trim() ?? '';
    const useMarried = !!married && display !== 'birth' && person.primaryName !== 'birth';
    const surname = useMarried ? married : birth;
    return {
        given: [before, given].filter(Boolean).join(' '),
        surname: [surname, after].filter(Boolean).join(' '),
        birthNote: useMarried && display === 'both' && birth.trim() && birth.trim() !== married ? birth.trim() : '',
        formerNote: !!married && person.primaryName === 'birth' && display !== 'birth' && married !== birth.trim() ? married : '',
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

/** The former-surname note as written after a name: "dříve Zástěrová" ('' for none). */
export function formerNoteText(formerNote: string): string {
    return formerNote ? `${strings.name.formerAbbr} ${formerNote}` : '';
}

/** The note after a name as text — "roz. Dvořáková" or "dříve Zástěrová" — '' for none. */
function noteText(parts: { birthNote: string; formerNote: string }, former: boolean): string {
    if (parts.birthNote) return birthNoteText(parts.birthNote);
    return former ? formerNoteText(parts.formerNote) : '';
}

/**
 * The whole name with its note in brackets: "Marie Nováková (roz.
 * Dvořáková)", "Ing. Marie Nováková ml. (roz. Dvořáková)", "Jana Lhotová
 * (dříve Zástěrová)" — tooltips, screen readers. Without a note it is
 * shownName().
 */
export function shownNameFull(person: Named, emptyGiven = '', show = titlesShown(), display = surnameDisplay()): string {
    const name = shownName(person, emptyGiven, show, display);
    const note = noteText(shownNameParts(person, emptyGiven, show, display), true);
    return note ? `${name} (${note})` : name;
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
    /**
     * Also the married surname the person no longer goes by, "(dříve
     * Zástěrová)" (Person.primaryName 'birth') — the person's detail only
     * (relationships panel, card menu, bottom sheet, editor header); cards
     * and lists leave it out. Default false.
     */
    former?: boolean;
    emptyGiven?: string;
    show?: boolean;
    display?: SurnameDisplay;
}

/**
 * The shown name as HTML (escaped): with a note, the name in
 * `<span class="pn-main">` and "(roz. Dvořáková)" in `<span class="pn-note">`
 * — with `former`, "(dříve Zástěrová)" likewise, its span also carrying
 * `pn-note--former` (a hook for tests, no style of its own); without one the
 * escaped name alone, exactly what was written before notes existed.
 */
export function nameHtml(person: Named, opts: NameHtmlOptions = {}): string {
    const note = opts.note ?? 'inline';
    const show = opts.show ?? titlesShown();
    const display = opts.display ?? surnameDisplay();
    const name = shownName(person, opts.emptyGiven ?? '', show, display);
    const parts = shownNameParts(person, opts.emptyGiven ?? '', show, display);
    const text = noteText(parts, !!opts.former);
    if (!text || note === 'none') return escapeHtml(name);
    const cls = parts.birthNote ? 'pn-note' : 'pn-note pn-note--former';
    const main = `<span class="pn-main">${escapeHtml(name)}</span>`;
    if (note === 'line') return `${main}<span class="${cls} pn-note--line">${escapeHtml(text)}</span>`;
    const noteSpan = `<span class="${cls}">(${escapeHtml(text)})</span>`;
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
