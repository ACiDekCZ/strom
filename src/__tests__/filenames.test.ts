/**
 * Download file names. The bug this locks down: a tree called "Rodina Víšek"
 * exported as "v-ek.json" — the accented letters were stripped instead of
 * transliterated, which mangles most non-English tree names.
 */

import { describe, it, expect } from 'vitest';
import { asciiSlug, safeFileName } from '../filenames.js';

describe('asciiSlug', () => {
    it('transliterates diacritics instead of dropping the letters', () => {
        expect(asciiSlug('Rodina Víšek')).toBe('rodina-visek');
        expect(asciiSlug('Müller & Söhne')).toBe('muller-sohne');
        expect(asciiSlug('Šťastný Ďáblík')).toBe('stastny-dablik');
    });

    it('folds letters NFD cannot decompose', () => {
        expect(asciiSlug('Straße')).toBe('strasse');
        expect(asciiSlug('Łódź')).toBe('lodz');
        expect(asciiSlug('Ærø')).toBe('aero');
    });

    it('keeps the result usable as a file name', () => {
        expect(asciiSlug('  Rodina / Novák: 2. větev  ')).toBe('rodina-novak-2-vetev');
        expect(asciiSlug('***')).toBe('');
    });

    it('returns empty for scripts with no ASCII equivalent', () => {
        expect(asciiSlug('Семья')).toBe('');
        expect(asciiSlug('家系図')).toBe('');
    });
});

describe('safeFileName', () => {
    it('falls back when nothing survives', () => {
        expect(safeFileName('Семья', 'family-tree')).toBe('family-tree');
        expect(safeFileName('', 'family-tree')).toBe('family-tree');
        expect(safeFileName(undefined, 'strom')).toBe('strom');
    });

    it('passes a usable name through', () => {
        expect(safeFileName('Rodina Víšek', 'family-tree')).toBe('rodina-visek');
    });
});
