import { describe, it, expect } from 'vitest';
import { sameGivenName } from '../given-names.js';

describe('sameGivenName', () => {
    it('takes the Latin, German and Czech register forms of a name as one name', () => {
        expect(sameGivenName('Wenceslaus', 'Václav')).toBe(true);
        expect(sameGivenName('Wenzel', 'Wenceslaus')).toBe(true);
        expect(sameGivenName('Catharina', 'Kateřina')).toBe(true);
        expect(sameGivenName('Katharina', 'Catharina')).toBe(true);
        expect(sameGivenName('Joannes', 'Jan')).toBe(true);
        expect(sameGivenName('Johann', 'Jan')).toBe(true);
        expect(sameGivenName('Matthäus', 'Matouš')).toBe(true);
    });

    it('compares without accents and case, several names word by word', () => {
        expect(sameGivenName('KATEŘINA', 'katerina')).toBe(true);
        expect(sameGivenName('Joannes Nepomucenus', 'Jan Nepomucenus')).toBe(true);
        expect(sameGivenName('Joannes Nepomucenus', 'Jan')).toBe(false);
    });

    it('keeps different names different', () => {
        expect(sameGivenName('Václav', 'Vojtěch')).toBe(false);
        expect(sameGivenName('Matěj', 'Matouš')).toBe(false);
        expect(sameGivenName('Marie', 'Magdalena')).toBe(false);
        expect(sameGivenName('Jan', 'Johana')).toBe(false);
    });
});
