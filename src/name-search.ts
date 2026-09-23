/**
 * Searchable name text shared by every person search (toolbar picker,
 * advanced filter). A person is findable under any of their names: the
 * written surname, every other form of it (masculine/feminine pair, spellings
 * the tree groups together) and their own name variants (alias, farm name).
 * All forms are lowercased and diacritics-insensitive.
 */

import { Person, StromData } from './types.js';
import { surnameForms } from './surnames.js';
import { normalizeName } from './merge/matching.js';

/**
 * Lowercase, strip diacritics and punctuation, collapse whitespace (the same
 * folding the merge engine uses, so all searches agree).
 */
export function normalizeSearchText(text: string): string {
    return normalizeName(text);
}

/** Every surname this person is known under, normalized, own surname first. */
export function searchableSurnames(person: Person, data: StromData | null | undefined): string[] {
    const forms = data ? surnameForms(person.lastName ?? '', data) : [person.lastName ?? ''];
    const out: string[] = [];
    for (const f of forms) {
        const n = normalizeSearchText(f);
        if (n && !out.includes(n)) out.push(n);
    }
    return out;
}

/**
 * Alternative names of this person, normalized: other surname forms and the
 * person's own name variants. Excludes the written first/last name.
 */
export function alternateNames(person: Person, data: StromData | null | undefined): string[] {
    const own = normalizeSearchText(person.lastName ?? '');
    const out: string[] = [];
    const add = (n: string): void => {
        if (n && n !== own && !out.includes(n)) out.push(n);
    };
    searchableSurnames(person, data).forEach(add);
    for (const v of person.nameVariants ?? []) add(normalizeSearchText(v));
    return out;
}

/**
 * One normalized string with every name of the person (first, last, other
 * surname forms, name variants), suitable for substring matching.
 */
export function searchableNameText(person: Person, data: StromData | null | undefined): string {
    return [
        normalizeSearchText(person.firstName ?? ''),
        normalizeSearchText(person.lastName ?? ''),
        ...alternateNames(person, data),
    ].filter(Boolean).join(' ');
}

/**
 * Does a (free text) query match this person's names? Every word of the query
 * must appear somewhere in the searchable name text.
 */
export function nameMatchesQuery(person: Person, query: string, data: StromData | null | undefined): boolean {
    const parts = normalizeSearchText(query).split(' ').filter(Boolean);
    if (parts.length === 0) return true;
    const text = searchableNameText(person, data);
    return parts.every(p => text.includes(p));
}

/**
 * Does the surname query match any surname form of this person (or one of the
 * person's own name variants)?
 */
export function surnameMatchesQuery(person: Person, query: string, data: StromData | null | undefined): boolean {
    const q = normalizeSearchText(query);
    if (!q) return true;
    return searchableSurnames(person, data).some(s => s.includes(q))
        || (person.nameVariants ?? []).some(v => normalizeSearchText(v).includes(q));
}
