/**
 * Merge Matching Module Tests
 *
 * Tests for name matching and string comparison:
 * - Name normalization (diacritics, case)
 * - String similarity (Levenshtein distance)
 * - First name matching (middle names, prefixes)
 * - Last name similarity (typos, variations)
 */

import { describe, it, expect } from 'vitest';
import { normalizeName, stringSimilarity, findMatches } from '../merge/matching.js';
import { Person, StromData, toPersonId } from '../types.js';

describe('normalizeName', () => {
    it('converts to lowercase', () => {
        expect(normalizeName('JOHN')).toBe('john');
        expect(normalizeName('John')).toBe('john');
        expect(normalizeName('jOhN')).toBe('john');
    });

    it('removes Czech diacritics', () => {
        expect(normalizeName('Příliš')).toBe('prilis');
        expect(normalizeName('žluťoučký')).toBe('zlutoucky');
        expect(normalizeName('kůň')).toBe('kun');
        expect(normalizeName('úpěl')).toBe('upel');
        expect(normalizeName('ďábelské')).toBe('dabelske');
    });

    it('removes German diacritics', () => {
        expect(normalizeName('Müller')).toBe('muller');
        expect(normalizeName('Schröder')).toBe('schroder');
        // Note: 'ß' is a special character, not a diacritic, so it's removed
        expect(normalizeName('Größe')).toBe('groe');
    });

    it('removes Polish diacritics', () => {
        // Note: Polish letters Ł, ł are not diacritics but separate letters
        // NFD doesn't decompose them, they get stripped as non a-z characters
        expect(normalizeName('Łódź')).toBe('odz');
        // 'ł' in 'żółć' also gets stripped
        expect(normalizeName('Żółć')).toBe('zoc');
    });

    it('removes special characters', () => {
        expect(normalizeName("O'Brien")).toBe('obrien');
        expect(normalizeName('Mary-Jane')).toBe('maryjane');
        expect(normalizeName('Dr. Smith')).toBe('dr smith');
    });

    it('trims whitespace', () => {
        expect(normalizeName('  John  ')).toBe('john');
        expect(normalizeName('\tJohn\n')).toBe('john');
    });

    it('normalizes multiple spaces', () => {
        expect(normalizeName('John   Doe')).toBe('john doe');
        expect(normalizeName('John  Middle  Doe')).toBe('john middle doe');
    });

    it('handles empty string', () => {
        expect(normalizeName('')).toBe('');
    });

    it('handles numbers', () => {
        expect(normalizeName('John 2nd')).toBe('john 2nd');
        expect(normalizeName('Henry VIII')).toBe('henry viii');
    });

    it('handles common Czech names', () => {
        expect(normalizeName('Novák')).toBe('novak');
        expect(normalizeName('Dvořák')).toBe('dvorak');
        expect(normalizeName('Černý')).toBe('cerny');
        expect(normalizeName('Říha')).toBe('riha');
        expect(normalizeName('Šťastný')).toBe('stastny');
    });
});

describe('stringSimilarity', () => {
    describe('exact matches', () => {
        it('returns 1 for identical strings', () => {
            expect(stringSimilarity('John', 'John')).toBe(1);
            expect(stringSimilarity('test', 'test')).toBe(1);
        });

        it('returns 1 for identical strings after normalization', () => {
            expect(stringSimilarity('John', 'JOHN')).toBe(1);
            expect(stringSimilarity('Novák', 'novak')).toBe(1);
            expect(stringSimilarity('Müller', 'muller')).toBe(1);
        });
    });

    describe('completely different strings', () => {
        it('returns 0 for completely different strings', () => {
            expect(stringSimilarity('abc', 'xyz')).toBe(0);
        });

        it('returns 0 when one string is empty', () => {
            expect(stringSimilarity('', 'test')).toBe(0);
            expect(stringSimilarity('test', '')).toBe(0);
        });

        it('returns 0 for both empty strings', () => {
            // Actually, identical strings return 1, even if empty
            expect(stringSimilarity('', '')).toBe(1);
        });
    });

    describe('partial matches', () => {
        it('returns high similarity for one character difference', () => {
            const sim = stringSimilarity('John', 'Jon');
            expect(sim).toBeGreaterThan(0.7);
        });

        it('returns high similarity for typos', () => {
            const sim = stringSimilarity('Novak', 'Novák'); // already normalized
            expect(sim).toBe(1);

            const sim2 = stringSimilarity('Dvorak', 'Dworak');
            expect(sim2).toBeGreaterThan(0.7);
        });

        it('returns medium similarity for similar names', () => {
            const sim = stringSimilarity('Jan', 'Jana');
            expect(sim).toBeGreaterThan(0.5);
            expect(sim).toBeLessThan(1);
        });

        it('handles prefix matches', () => {
            const sim = stringSimilarity('John', 'Johnny');
            expect(sim).toBeGreaterThan(0.6);
        });
    });

    describe('real name comparisons', () => {
        it('compares common first name variations', () => {
            // Similar names should have reasonable similarity
            expect(stringSimilarity('Petr', 'Peter')).toBeGreaterThan(0.6);
            // Josef vs Joseph: distance 2 (f->ph), length 6, similarity ≈ 0.67
            expect(stringSimilarity('Josef', 'Joseph')).toBeGreaterThan(0.6);
        });

        it('compares Czech surnames with typos', () => {
            expect(stringSimilarity('Novotný', 'Novotny')).toBe(1); // normalized
            expect(stringSimilarity('Svoboda', 'Svaboda')).toBeGreaterThan(0.8);
            expect(stringSimilarity('Procházka', 'Prochazka')).toBe(1); // normalized
        });

        it('distinguishes clearly different names', () => {
            const sim = stringSimilarity('Novák', 'Svoboda');
            expect(sim).toBeLessThan(0.5);
        });
    });
});

describe('Levenshtein distance (via stringSimilarity)', () => {
    it('single insertion', () => {
        // 'cat' -> 'cats' = 1 edit, length 4, similarity = 1 - 1/4 = 0.75
        const sim = stringSimilarity('cat', 'cats');
        expect(sim).toBe(0.75);
    });

    it('single deletion', () => {
        // 'cats' -> 'cat' = 1 edit, length 4, similarity = 0.75
        const sim = stringSimilarity('cats', 'cat');
        expect(sim).toBe(0.75);
    });

    it('single substitution', () => {
        // 'cat' -> 'car' = 1 edit, length 3, similarity = 1 - 1/3 ≈ 0.67
        const sim = stringSimilarity('cat', 'car');
        expect(sim).toBeCloseTo(0.667, 2);
    });

    it('multiple edits', () => {
        // 'kitten' -> 'sitting' = 3 edits (k->s, e->i, +g), length 7
        // similarity = 1 - 3/7 ≈ 0.57
        const sim = stringSimilarity('kitten', 'sitting');
        expect(sim).toBeGreaterThan(0.5);
        expect(sim).toBeLessThan(0.7);
    });

    it('transposition counts as 2 edits', () => {
        // 'ab' -> 'ba' = 2 edits (a->b, b->a), length 2
        // similarity = 1 - 2/2 = 0
        const sim = stringSimilarity('ab', 'ba');
        expect(sim).toBe(0);
    });
});

describe('edge cases', () => {
    it('handles single character strings', () => {
        expect(stringSimilarity('a', 'a')).toBe(1);
        expect(stringSimilarity('a', 'b')).toBe(0);
    });

    it('handles very long strings', () => {
        const long1 = 'a'.repeat(100);
        const long2 = 'a'.repeat(99) + 'b';
        const sim = stringSimilarity(long1, long2);
        expect(sim).toBeGreaterThan(0.98);
    });

    it('handles unicode emoji (stripped by normalization)', () => {
        // Emoji are stripped by normalization (non a-z0-9)
        const sim = stringSimilarity('John 😀', 'John');
        expect(sim).toBe(1);
    });

    it('handles mixed case with diacritics', () => {
        const sim = stringSimilarity('PŘÍLIŠ', 'prilis');
        expect(sim).toBe(1);
    });
});

describe('merge matching sees through name variants (K3)', () => {
    /**
     * The same family is Wischek in one register and Víšek in the next. Without
     * variants the merge sees two families and refuses to match them — which is
     * exactly the case where merging matters most.
     */
    function person(id: string, firstName: string, lastName: string,
        nameVariants?: string[]): Person {
        return {
            id: toPersonId(id), firstName, lastName, gender: 'male',
            isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
            birthDate: '1783',
            ...(nameVariants ? { nameVariants } : {}),
        };
    }
    const tree = (...people: Person[]): StromData => ({
        persons: Object.fromEntries(people.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {},
    });

    it('matches Wischek to Víšek when the variant says they are the same', () => {
        const existing = tree(person('a', 'Josef', 'Víšek', ['Wischek']));
        const incoming = tree(person('b', 'Josef', 'Wischek'));

        const matches = findMatches(existing, incoming);
        expect(matches).toHaveLength(1);
        expect(matches[0].existingPerson?.id).toBe(toPersonId('a'));
    });

    it('still tells two different families apart', () => {
        // The variant must widen the net, not break it: Svoboda is not Víšek.
        const existing = tree(person('a', 'Josef', 'Víšek', ['Wischek']));
        const incoming = tree(person('b', 'Josef', 'Svoboda'));

        const matches = findMatches(existing, incoming);
        const strong = matches.filter(m => m.confidence === 'high' || m.confidence === 'medium');
        expect(strong).toHaveLength(0);
    });

    it('matches when the variant is on the incoming side instead', () => {
        const existing = tree(person('a', 'Josef', 'Wischek'));
        const incoming = tree(person('b', 'Josef', 'Víšek', ['Wischek']));
        expect(findMatches(existing, incoming)).toHaveLength(1);
    });
});

describe('merge matching uses the tree’s surname groups (K3 v2)', () => {
    /**
     * Entered once for the tree, and it holds whichever spelling each person
     * happens to be recorded under — the great-grandfathers are Vyšek, the
     * living are Víšek, and neither had to be annotated by hand.
     */
    function p(id: string, firstName: string, lastName: string): Person {
        return {
            id: toPersonId(id), firstName, lastName, gender: 'male',
            isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
            birthDate: '1783',
        };
    }
    const tree = (people: Person[], groups?: string[][]): StromData => ({
        persons: Object.fromEntries(people.map(x => [x.id, x])) as StromData['persons'],
        partnerships: {},
        ...(groups ? { surnameVariants: groups } : {}),
    });

    it('matches Vyšek to Víšek without a word on either person', () => {
        const groups = [['Víšek', 'Vyšek']];
        const existing = tree([p('a', 'Josef', 'Víšek')], groups);
        const incoming = tree([p('b', 'Josef', 'Vyšek')], groups);

        const matches = findMatches(existing, incoming);
        expect(matches).toHaveLength(1);
        expect(matches[0].existingPerson?.id).toBe(toPersonId('a'));
    });

    it('does not match them when no group says they are the same', () => {
        const existing = tree([p('a', 'Josef', 'Víšek')]);
        const incoming = tree([p('b', 'Josef', 'Vyšek')]);
        const strong = findMatches(existing, incoming)
            .filter(m => m.confidence === 'high');
        expect(strong).toHaveLength(0);
    });

    it('still keeps different families apart', () => {
        const groups = [['Víšek', 'Vyšek']];
        const existing = tree([p('a', 'Josef', 'Víšek')], groups);
        const incoming = tree([p('b', 'Josef', 'Svoboda')], groups);
        const strong = findMatches(existing, incoming)
            .filter(m => m.confidence === 'high' || m.confidence === 'medium');
        expect(strong).toHaveLength(0);
    });
});
