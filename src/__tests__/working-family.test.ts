import { describe, it, expect } from 'vitest';
import { sanitizeWorking, researchFamilyRef, researchFamilyPartners, workingWithFamilyPersons } from '../research-link.js';

/**
 * A run of the research about a couple (writing a pair's narrative) names a
 * family, not a person: the app still follows the couple, the husband first.
 * Invented data only.
 */

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH',
    '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 REFN P0001', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0005@ INDI', '1 NAME Marie /Lánská/', '1 REFN P0005', '1 FAMS @F0002@',
    '0 @P0009@ INDI', '1 NAME Bez /Čísla/',
    // The wife written before the husband: the husband still comes first.
    '0 @F0001@ FAM', '1 WIFE @P0002@', '1 HUSB @P0001@', '1 MARR', '2 DATE 1864',
    '0 @F0002@ FAM', '1 WIFE @P0005@',
    '0 @F0003@ FAM', '1 HUSB @P0009@',
    '0 TRLR',
].join('\r\n');

describe('a run about a couple (1105)', () => {
    it('reads the family from its own field or from the person field', () => {
        const [a, b, c, d] = sanitizeWorking([
            { who: 'run-1', person: 'F0054' },
            { who: 'run-2', family: 'F0054' },
            { who: 'run-3', person: 'P0142', family: 'F0054' },
            { who: 'run-4', family: 'X1; drop' },
        ]);
        expect(a).toMatchObject({ family: 'F0054' });
        expect(a.person).toBeUndefined();
        expect(b).toMatchObject({ family: 'F0054' });
        // A person named: that person, the family not needed.
        expect(c).toMatchObject({ person: 'P0142' });
        expect(c.family).toBeUndefined();
        expect(d.family).toBeUndefined();
        expect(researchFamilyRef(' F0001 ')).toBe('F0001');
        expect(researchFamilyRef('P0001')).toBeNull();
    });

    it('the partners of each family, the husband first; a partner without a number left out', () => {
        const map = researchFamilyPartners(GED);
        expect(map.get('F0001')).toEqual(['P0001', 'P0002']);
        expect(map.get('F0002')).toEqual(['P0005']);
        expect(map.has('F0003')).toBe(false);
    });

    it('a row about a couple gets its first partner; a row with a person or an unknown family stays', () => {
        const map = researchFamilyPartners(GED);
        const rows = [{ who: 'a', family: 'F0001' }, { who: 'b', person: 'P0005', family: 'F0001' }, { who: 'c', family: 'F0099' }, { who: 'd' }];
        const out = workingWithFamilyPersons(rows, map);
        expect(out.map(r => r.person)).toEqual(['P0001', 'P0005', undefined, undefined]);
        expect(workingWithFamilyPersons(rows, null)[0].person).toBeUndefined();
    });
});
