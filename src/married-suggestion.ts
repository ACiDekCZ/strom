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

import { Gender, Partnership, Person, PersonId, StromData } from './types.js';
import { marriagesLatestFirst } from './marriage-order.js';
import { feminineForm, feminineFormIn, masculineFormIn, surnameKey } from './surnames.js';

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
 * The spouses of a person's marriages (a union that is or was a marriage),
 * the one a married surname comes from first: the marriages with a wedding
 * date from the latest wedding back, then the undated ones from the last in
 * order (marriagesLatestFirst). One rule for the editor's suggestion and for the
 * married surname read from a file (spec 010, K4.1).
 */
function marriagePartnersLatestFirst(data: StromData, personId: PersonId): { union: Partnership; partner: Person }[] {
    return marriagesLatestFirst(data, personId)
        .map(id => data.partnerships[id])
        .filter(u => u && (u.status === 'married' || u.status === 'divorced'))
        .map(u => ({ union: u, partner: data.persons[u.person1Id === personId ? u.person2Id : u.person1Id] }))
        .filter(e => !!e.partner);
}

/**
 * The husband a married surname comes from: of the person's marriages (a
 * union that is or was a marriage, the partner a man), the one with the
 * latest wedding date; without any dates the last one in order. A living
 * partnership without a wedding gives no married surname.
 */
export function suggestionHusband(data: StromData, personId: PersonId): Person | null {
    return marriagePartnersLatestFirst(data, personId).find(e => e.partner.gender === 'male')?.partner ?? null;
}

/** Is this married surname the spouse's surname, or a wife's form of it (Nováková of Novák, Jaworska of Jaworski)? */
function surnameOfSpouse(married: string, spouseSurname: string, data: StromData): boolean {
    const spouse = spouseSurname.trim();
    if (!married.trim() || !spouse) return false;
    const key = surnameKey(married);
    if (surnameKey(spouse) === key || surnameKey(wifeSurnameOf(spouse, data)) === key) return true;
    // The rules of this tree may not give the wife's form; the name itself still says whose it is.
    const feminine = feminineForm(spouse);
    if (feminine && surnameKey(feminine) === key) return true;
    const masculine = masculineFormIn(married, data);
    return !!masculine && surnameKey(masculine) === surnameKey(spouse);
}

/**
 * Which of a person's married surnames is the one after the last marriage
 * (spec 010, K4.1): the one of the spouse of the latest wedding by date,
 * else of the last marriage in order (the order of marriagePartnersLatestFirst);
 * a surname no spouse of the person carries comes after them. Ties and a
 * person whose surnames match no spouse: the last in the given order (the
 * file's). Returns the index into `surnames` (-1 for an empty list).
 */
export function lastMarriageSurnameIndex(data: StromData, personId: PersonId, surnames: readonly string[]): number {
    const spouses = marriagePartnersLatestFirst(data, personId).map(e => e.partner.lastName ?? '');
    let best = -1;
    let bestRank = Infinity;
    surnames.forEach((surname, i) => {
        const at = spouses.findIndex(s => surnameOfSpouse(surname, s, data));
        const rank = at < 0 ? Infinity : at;
        // In order, so a tie goes to the later one.
        if (best < 0 || rank <= bestRank) { best = i; bestRank = rank; }
    });
    return best;
}

/**
 * A wife's form of her husband's surname: the feminine form where the rules
 * apply (the same gate search uses, genderRulesApply: Novák → Nováková on a
 * Czech tree, Jaworski → Jaworska anywhere),
 * the surname as it is otherwise (Smith, Müller) and where it is already one
 * for everybody (Kočí, Nováková).
 */
export function wifeSurnameOf(husbandSurname: string, data: StromData): string {
    const surname = husbandSurname.trim();
    if (!surname) return '';
    return feminineFormIn(surname, data) ?? surname;
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
