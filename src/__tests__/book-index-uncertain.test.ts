/**
 * The family book's index of people and surnames with an unreadable place of a transcription (1102), as the tree
 * pages' index: a surname of "[?]" alone stands under No surname (last), one that starts with an unreadable place
 * ("[?]o[?]rálek", "[...]ovec") goes to the group "?" titled Uncertain reading after the letters, never a "["
 * letter; the letters follow the language's alphabet (Czech Ch after H, Polish Ł after L). Invented names.
 */

import { describe, it, expect } from 'vitest';
import { buildFamilyBook } from '../book.js';
import { getStringsForLang } from '../strings.js';
import { StromData, PersonId, PartnershipId, Person, Partnership, Gender } from '../types.js';
import { BookLang } from '../book-options.js';

const ENV = { now: new Date('2026-11-02T12:00:00Z'), dateLabel: '2. 11. 2026' };

function p(id: string, first: string, last: string, gender: Gender, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], birthDate: '1800', deathDate: '1870', ...o,
    } as Person;
}

/** A founder whose wives (and one son's) carry the surnames under test, each wife with a child of the line. */
function tree(wives: string[]): StromData {
    const persons: Person[] = [];
    const unions: Partnership[] = [];
    const founder = p('f', 'Dobromil', 'Zbrojnický', 'male');
    persons.push(founder);
    wives.forEach((last, i) => {
        const w = p(`w${i}`, 'Kunhuta', last, 'female', { partnerships: [`u${i}` as PartnershipId], childIds: [`c${i}` as PersonId] });
        const c = p(`c${i}`, 'Dobromil', 'Zbrojnický', 'male', { birthDate: `${1830 + i}`, parentIds: ['f', `w${i}`] as PersonId[] });
        founder.partnerships.push(`u${i}` as PartnershipId);
        founder.childIds.push(c.id);
        persons.push(w, c);
        unions.push({ id: `u${i}` as PartnershipId, person1Id: 'f' as PersonId, person2Id: w.id, status: 'married', childIds: [c.id] });
    });
    return {
        persons: Object.fromEntries(persons.map(x => [x.id, x])) as StromData['persons'],
        partnerships: Object.fromEntries(unions.map(x => [x.id, x])) as StromData['partnerships'],
    };
}

/** The index's group headings in order, each with the surnames listed under it. */
function indexGroups(data: StromData, lang: BookLang): { letter: string; names: string[] }[] {
    const html = buildFamilyBook(data, { lang, privacy: 'full' }, ENV);
    const index = html.slice(html.indexOf('class="book-index"'));
    const out: { letter: string; names: string[] }[] = [];
    for (const m of index.matchAll(/<div class="book-index-letter">([^<]*)<\/div>|<span class="book-index-name">([^<(,]*)/g)) {
        if (m[1] !== undefined) out.push({ letter: m[1], names: [] });
        else out[out.length - 1]?.names.push(m[2].replace(/&#39;/g, "'").trim());
    }
    return out;
}

const UNCERTAIN = ['[?]o[?]rálek', '[...]ovec', '[?]'];

describe('the family book index and unreadable places of a surname (1102)', () => {
    it('Czech: the letters in the Czech alphabet, then "?" (Uncertain reading), then No surname', () => {
        const cs = getStringsForLang('cs');
        const groups = indexGroups(tree(['Hroznětický', 'Chrudošek', 'Čermáček', 'Cibulínek', 'Ábelovský', ...UNCERTAIN, '']), 'cs');
        expect(groups.map(g => g.letter)).toEqual(['A', 'C', 'Č', 'H', 'Ch', 'Z', cs.familyPages.idxUncertain, cs.book.noSurname]);
        const uncertain = groups.find(g => g.letter === cs.familyPages.idxUncertain)!;
        // Sorted by what is readable: "orálek" before "ovec".
        expect(uncertain.names).toEqual(['[?]o[?]rálek Kunhuta', '[...]ovec Kunhuta']);
        // "[?]" alone is no surname: it stands with the wife who has none.
        expect([...groups[groups.length - 1].names].sort()).toEqual(['Kunhuta', '[?] Kunhuta']);
        expect(groups.some(g => g.letter.startsWith('[') || g.letter === '')).toBe(false);
    });

    it('Polish: Ł after L, Ś after S, then "?" (Niepewny odczyt), then Bez nazwiska', () => {
        const pl = getStringsForLang('pl');
        const groups = indexGroups(tree(['Śmigulski', 'Sowiak', 'Łopatnicki', 'Lisowiak', ...UNCERTAIN, '']), 'pl');
        expect(groups.map(g => g.letter)).toEqual(['L', 'Ł', 'S', 'Ś', 'Z', pl.familyPages.idxUncertain, pl.book.noSurname]);
        expect(groups.find(g => g.letter === pl.familyPages.idxUncertain)!.names).toHaveLength(2);
        expect(groups[groups.length - 1].names).toHaveLength(2);
    });

    it('English: the uncertain group comes after the letters even when it is the only other group', () => {
        const en = getStringsForLang('en');
        const groups = indexGroups(tree(['[?]o[?]rálek']), 'en');
        expect(groups.map(g => g.letter)).toEqual(['Z', en.familyPages.idxUncertain]);
    });
});
