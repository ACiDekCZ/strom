/**
 * GEDCOM date conversion preserves precision and qualifiers (flex dates).
 */

import { describe, it, expect } from 'vitest';
import { parseGedcomDate } from '../ged-parser.js';

describe('parseGedcomDate (flex dates)', () => {
    it('preserves precision instead of fabricating month/day', () => {
        expect(parseGedcomDate('1900')).toBe('1900');
        expect(parseGedcomDate('JUN 1900')).toBe('1900-06');
        expect(parseGedcomDate('3 JUN 1900')).toBe('1900-06-03');
    });

    it('maps qualifiers to flex-date prefixes', () => {
        expect(parseGedcomDate('ABT 1900')).toBe('~1900');
        expect(parseGedcomDate('ABOUT 1900')).toBe('~1900');
        expect(parseGedcomDate('EST 1900')).toBe('~1900');
        expect(parseGedcomDate('BEF 1900')).toBe('<1900');
        expect(parseGedcomDate('BEFORE JUN 1900')).toBe('<1900-06');
        expect(parseGedcomDate('AFT 3 JUN 1900')).toBe('>1900-06-03');
    });

    it('handles empty and garbage input', () => {
        expect(parseGedcomDate('')).toBe('');
        expect(parseGedcomDate('UNKNOWN')).toBe('');
    });
});
