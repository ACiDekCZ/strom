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
});
