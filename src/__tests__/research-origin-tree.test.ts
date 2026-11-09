import { describe, expect, it } from 'vitest';
import { convertToStrom, parseGedcom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { cardStatus, factReliability, reliabilityOptionsOf, treeOriginWords, userTreeOrigin } from '../reliability.js';
import type { Person, StromData } from '../types.js';

/**
 * `_STROM_ORIGIN tree` (research 1.30.0+, answer to "Dotazy 3"): a value taken from the user's own Strom tree.
 * The shape is the research's own `/tree.ged` (13f50ae0) for a research that holds only the family tree it took
 * in: every value `tree`, a lead cited by the family tree's source.
 */
const gedWith = (origin: string, sexOrigin = origin): string => `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.30.0
2 NAME Strom Research
1 _STROM_ASOF 2026-11-09T10:58:07Z
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @P0001@ INDI
1 NAME Zbyhněv /Lučinov/
2 _STROM_ORIGIN ${origin}
1 SEX M
1 _STROM_SEX_ORIGIN ${sexOrigin}
1 REFN P0001
2 TYPE strom-research
1 BIRT
2 _STROM_EID E0001
3 _TXT 440dc563414cfcee
2 DATE 12 MAR 1931
2 PLAC Horní Brodek
2 SOUR @S0001@
3 QUAY 0
3 DATA
4 TEXT I1 BIRT
2 _STROM_STATUS lead
2 _STROM_ORIGIN ${origin}
1 FAMS @F0001@
0 @P0002@ INDI
1 NAME Hostimila /Lučinová/
2 _STROM_ORIGIN ${origin}
1 SEX F
1 _STROM_SEX_ORIGIN ${sexOrigin}
1 REFN P0002
2 TYPE strom-research
1 BIRT
2 _STROM_EID E0003
2 DATE 3 JUN 1934
2 SOUR @S0001@
3 QUAY 0
2 _STROM_STATUS lead
2 _STROM_ORIGIN ${origin}
1 FAMS @F0001@
0 @F0001@ FAM
1 HUSB @P0001@
1 WIFE @P0002@
0 @S0001@ SOUR
1 TITL Rodokmen rodokmen.ged
1 REFN S0001
0 TRLR
`;

const load = (ged: string): StromData => convertToStrom(parseGedcom(ged), {}).data;
const marks = (data: StromData, live: boolean): (string | undefined)[] => {
    const opts = { ...reliabilityOptionsOf(data, live, true), treeHasSources: true };
    return Object.values(data.persons).map(p => cardStatus(data, p as Person, opts)?.cls);
};
const birthStep = (data: StromData, live: boolean) => {
    const p = Object.values(data.persons).find(x => x.firstName === 'Zbyhněv') as Person;
    return factReliability(data, p, 'birth', reliabilityOptionsOf(data, live, true))?.step;
};

describe('the research\'s origin `tree` (1109 N1, N2)', () => {
    it('is read from the GEDCOM under facts, names and the sex', () => {
        const data = load(gedWith('tree'));
        const p = Object.values(data.persons).find(x => x.firstName === 'Zbyhněv') as Person;
        expect(p.researchOrigins).toMatchObject({ name: { kind: 'tree' }, sex: { kind: 'tree' }, birth: { kind: 'tree' } });
    });

    it('a tree taken only from the user\'s family tree carries the origin (the bridge is not needed)', () => {
        const data = load(gedWith('tree'));
        expect(treeOriginWords(data)).toEqual({ carries: true, tree: true });
        expect(reliabilityOptionsOf(data, false, true)).toMatchObject({ researchTree: true, originFeature: true, treeOriginWord: true });
    });

    it('the card mark is the family tree\'s (○○) with the bridge and without it, never ✓', () => {
        const data = load(gedWith('tree'));
        expect(marks(data, false)).toEqual(['cs-import', 'cs-import']);
        expect(marks(data, true)).toEqual(marks(data, false));
        expect(birthStep(data, false)).toBe('import');
    });

    it('`tree` is marked the same as an older research\'s `user` without an earlier value (decision A)', () => {
        const older = load(gedWith('user'));
        expect(treeOriginWords(older)).toEqual({ carries: true, tree: false });
        expect(marks(older, false)).toEqual(marks(load(gedWith('tree')), false));
        expect(marks(older, true)).toEqual(['cs-import', 'cs-import']);
    });

    it('once the research writes `tree`, its `user` is a person\'s change (✓) even without an earlier value', () => {
        // The values are the person's (an edit, a revert, a value added); the sex stayed the family tree's.
        const data = load(gedWith('user', 'tree'));
        expect(treeOriginWords(data).tree).toBe(true);
        expect(birthStep(data, false)).toBe('human');
        expect(birthStep(data, true)).toBe('human');
        expect(marks(data, false)).toEqual(marks(data, true));
    });

    it('userTreeOrigin: `tree` always, `user` without an earlier value only for an older research', () => {
        expect(userTreeOrigin({ kind: 'tree' })).toBe(true);
        expect(userTreeOrigin({ kind: 'tree' }, true)).toBe(true);
        expect(userTreeOrigin({ kind: 'user' })).toBe(true);
        expect(userTreeOrigin({ kind: 'user' }, true)).toBe(false);
        expect(userTreeOrigin({ kind: 'user', was: { value: '1900' } })).toBe(false);
        expect(userTreeOrigin({ kind: 'research' })).toBe(false);
    });

    it('stays `tree` in Strom\'s own GEDCOM with the origins', () => {
        const data = load(gedWith('tree'));
        const ged = exportToGedcom(data, 'Lučinov', { origins: true }).content;
        expect(ged).toContain('2 _STROM_ORIGIN tree');
        expect(ged).toContain('1 _STROM_SEX_ORIGIN tree');
        expect(marks(load(ged), false)).toEqual(marks(data, false));
    });
});
