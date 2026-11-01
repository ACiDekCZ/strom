import { describe, it, expect } from 'vitest';
import { houseMatches, kindMarks } from '../map-bubble.js';
import { MapKind } from '../places.js';

describe('kindMarks', () => {
    it('puts the marks in the map order, whatever order the kinds came in', () => {
        expect(kindMarks(new Set<MapKind>(['death', 'birth']))).toBe('* †');
        expect(kindMarks(new Set<MapKind>(['event', 'wedding', 'death', 'birth']))).toBe('* † ⚭ •');
    });

    it('shows only the kinds switched on', () => {
        expect(kindMarks(new Set<MapKind>(['birth', 'wedding']), new Set<MapKind>(['wedding']))).toBe('⚭');
        expect(kindMarks(new Set<MapKind>(['birth']), new Set<MapKind>(['death']))).toBe('');
    });
});

describe('houseMatches', () => {
    it('matches the start of the number or of a street word', () => {
        expect(houseMatches('16', '1')).toBe(true);
        expect(houseMatches('102', '10')).toBe(true);
        expect(houseMatches('čp. 12', '1')).toBe(true);
        expect(houseMatches('Kopřivná 14', '1')).toBe(true);
        expect(houseMatches('Kopřivná 12', 'kop')).toBe(true);
        expect(houseMatches('Kopřivná 12', 'Kopřivná 1')).toBe(true);
    });

    it('ignores case and accents, in NFC and NFD alike', () => {
        expect(houseMatches('Kopřivná 12', 'KOPRIV')).toBe(true);
        expect(houseMatches('Kopřivná 12'.normalize('NFD'), 'kopř')).toBe(true);
    });

    it('does not match inside a number or a word', () => {
        expect(houseMatches('21', '1')).toBe(false);
        expect(houseMatches('Kopřivná 12', 'rivn')).toBe(false);
        expect(houseMatches('4', '16')).toBe(false);
    });

    it('an empty query matches every house', () => {
        expect(houseMatches('4', '')).toBe(true);
        expect(houseMatches('4', '   ')).toBe(true);
    });
});
