/**
 * Avatar monogram tests: the two-letter initials must skip nobiliary particles
 * ("of", "von", "van der"…) and roman-numeral suffixes ("IV", "VII"…).
 */

import { describe, it, expect } from 'vitest';
import { personInitials } from '../initials.js';

describe('personInitials', () => {
    it('skips the "of" particle in the surname', () => {
        expect(personInitials('Mary', 'of Guise')).toBe('MG');
        expect(personInitials('Catherine', 'of Aragon')).toBe('CA');
        expect(personInitials('Elizabeth', 'of York')).toBe('EY');
    });

    it('skips both a roman numeral and a particle', () => {
        expect(personInitials('James IV', 'of Scotland')).toBe('JS');
    });

    it('keeps names without particles correct', () => {
        expect(personInitials('Henry VII', 'Tudor')).toBe('HT');
        expect(personInitials('Margaret', 'Tudor')).toBe('MT');
        expect(personInitials('Anne', 'Boleyn')).toBe('AB');
    });

    it('handles other international particles', () => {
        expect(personInitials('Ludwig', 'van Beethoven')).toBe('LB');
        expect(personInitials('Leonardo', 'da Vinci')).toBe('LV');
        expect(personInitials('Charles', 'de Gaulle')).toBe('CG');
        expect(personInitials('Johann', 'von der Berg')).toBe('JB');
    });

    it('never drops a legitimately capitalized surname word', () => {
        // "De" capitalized is a real surname start, not a particle.
        expect(personInitials('Robert', 'De Niro')).toBe('RD');
    });

    it('returns a single letter for a one-word name', () => {
        expect(personInitials('Madonna', '')).toBe('M');
        expect(personInitials('', 'Cher')).toBe('C');
    });

    it('returns empty for empty / undefined names', () => {
        expect(personInitials('', '')).toBe('');
        expect(personInitials(undefined, undefined)).toBe('');
    });

    it('skips a word that does not start with a letter, never a later letter inside it (U02)', () => {
        // A transcriber's "[?]" for an unreadable letter: no "[" and no "a" as an initial.
        expect(personInitials('František', '[?]an[?]rlík')).toBe('F');
        expect(personInitials('?', 'Novák')).toBe('N');
        expect(personInitials('[?]', 'Novák')).toBe('N');
        expect(personInitials('Jan', '(…)ová')).toBe('J');
        expect(personInitials('3.', 'Jan')).toBe('J');
        expect(personInitials('3. Jan', '')).toBe('J');
    });

    it('nothing but marks gives no initials (the avatar shows "?") (U02)', () => {
        expect(personInitials('…', '')).toBe('');
        expect(personInitials('?', '')).toBe('');
        expect(personInitials('?', '?')).toBe('');
        expect(personInitials('[?]', '…')).toBe('');
    });

    it('opening quotes and brackets before a name are passed over (U02)', () => {
        expect(personInitials('(Jan)', 'Novák')).toBe('JN');
        expect(personInitials('„Pepa“', 'Novák')).toBe('PN');
        expect(personInitials('"Pepa"', 'Novák')).toBe('PN');
        expect(personInitials('«Jean»', 'Dupont')).toBe('JD');
    });

    it('a letter keeps its combining marks (U02)', () => {
        // "Č" written as C + combining caron.
        expect(personInitials('C\u030Cenek', 'S\u030Ctěpán')).toBe('C\u030CS\u030C');
        expect(personInitials('Čeněk', 'Šťastný')).toBe('ČŠ');
    });
});
