/**
 * The married surname the person editor suggests (spec 010, K3.1): a woman
 * with a husband in the tree and no married surname yet is offered his
 * surname, made feminine by the Czech rules where they apply (Novák →
 * Nováková, Svoboda → Svobodová, Brodský → Brodská, Kočí stays). Only ever a
 * suggestion: nothing is filled in until it is used, and one hidden with ×
 * (Person.dismissedMarriedSuggestion) is not offered again.
 *
 * Pure: reads the tree, never changes it. The editor passes its own state (the
 * sex, the surname fields and the spellings as they are being typed).
 */

import { Gender, Person, PersonId, StromData } from './types.js';
import { parseFlexDate } from './dates.js';
import { marriagesInOrder } from './marriage-order.js';
import { czechRulesApply, feminineForm, surnameKey } from './surnames.js';

export interface MarriedSurnameSuggestion {
    /** The suggested married surname ("Nováková"). */
    surname: string;
    /** The husband it comes from. */
    husband: Person;
    /** The person's other spellings already hold it ("Marie Nováková"). */
    inNameVariants: boolean;
}

/** The editor's state the suggestion depends on. */
export interface MarriedSuggestionState {
    gender: Gender;
    /** The birth surname (Person.lastName) as typed. */
    lastName: string;
    /** The married surname field as typed: a filled one wants no suggestion. */
    marriedSurname: string;
    /** The suggestion hidden with × (stored, or hidden in the open editor). */
    dismissed?: string;
    /** Other spellings of the name (Person.nameVariants) as typed. */
    nameVariants: readonly string[];
}

/**
 * The husband a married surname comes from: of the person's marriages (a
 * union that is or was a marriage, the partner a man), the one with the
 * latest wedding date; without any dates the last one in order. A living
 * partnership without a wedding gives no married surname.
 */
export function suggestionHusband(data: StromData, personId: PersonId): Person | null {
    const husbands = marriagesInOrder(data, personId)
        .map(id => data.partnerships[id])
        .filter(u => u && (u.status === 'married' || u.status === 'divorced'))
        .map(u => ({ union: u, partner: data.persons[u.person1Id === personId ? u.person2Id : u.person1Id] }))
        .filter(e => e.partner?.gender === 'male');
    if (husbands.length === 0) return null;
    // marriagesInOrder puts the dated ones first, chronologically.
    const dated = husbands.filter(e => parseFlexDate(e.union.startDate));
    return (dated.length > 0 ? dated[dated.length - 1] : husbands[husbands.length - 1]).partner;
}

/**
 * A wife's form of her husband's surname: the Czech feminine form where the
 * Czech rules apply to the tree (the same gate search uses, czechRulesApply),
 * the surname as it is otherwise (Smith, Müller) and where it is already one
 * for everybody (Kočí, Nováková).
 */
export function wifeSurnameOf(husbandSurname: string, data: StromData): string {
    const surname = husbandSurname.trim();
    if (!surname) return '';
    return (czechRulesApply(data) ? feminineForm(surname) : null) ?? surname;
}

/** Does any of these spellings carry the surname (as a whole, or as a word of a full name)? */
function amongSpellings(surname: string, spellings: readonly string[]): boolean {
    const key = surnameKey(surname);
    return spellings.some(v => surnameKey(v) === key || v.split(/\s+/).some(w => surnameKey(w) === key));
}

/**
 * The married surname to suggest for a person, or null: a woman whose
 * married surname is empty, with a husband whose surname is known; not the
 * suggestion hidden before, and not her own birth surname (a tree that keeps
 * women under their married surname would only be told what it has).
 */
export function suggestMarriedSurname(data: StromData, personId: PersonId, state: MarriedSuggestionState): MarriedSurnameSuggestion | null {
    if (state.gender !== 'female' || state.marriedSurname.trim()) return null;
    const husband = suggestionHusband(data, personId);
    if (!husband || husband.isPlaceholder) return null;
    const surname = wifeSurnameOf(husband.lastName ?? '', data);
    if (!surname) return null;
    const key = surnameKey(surname);
    if (state.dismissed && surnameKey(state.dismissed) === key) return null;
    if (surnameKey(state.lastName) === key) return null;
    return { surname, husband, inNameVariants: amongSpellings(surname, state.nameVariants) };
}
