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

    it('strips calendar escapes instead of losing the date', () => {
        // "@#DJULIAN@ 3 JUN 1699" parsed to '' — every pre-1752 Julian date
        // silently vanished.
        expect(parseGedcomDate('@#DJULIAN@ 3 JUN 1699')).toBe('1699-06-03');
        expect(parseGedcomDate('@#DGREGORIAN@ 1900')).toBe('1900');
        expect(parseGedcomDate('ABT @#DJULIAN@ 1699')).toBe('~1699');
        expect(parseGedcomDate('BET @#DJULIAN@ 1690 AND @#DJULIAN@ 1699')).toBe('1690..1699');
    });

    it('reads dual years as the year written in the record', () => {
        // "1699/00" is the same moment under old-style/new-style year counting;
        // the flex-date model has no dual form, so the first (as-written) year
        // is kept rather than parsing to ''.
        expect(parseGedcomDate('1699/00')).toBe('1699');
        expect(parseGedcomDate('11 FEB 1699/00')).toBe('1699-02-11');
        expect(parseGedcomDate('FEB 1699/00')).toBe('1699-02');
        expect(parseGedcomDate('@#DJULIAN@ 11 FEB 1699/00')).toBe('1699-02-11');
    });
});
