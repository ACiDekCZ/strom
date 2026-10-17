/**
 * Persons of unknown given name in a merge (spec 010, K1.2): MyHeritage writes
 * a wife known only by her surname as "1 NAME /Nováková/". She has no name to
 * match by, so she is paired through a matched relative — the tree person in
 * the same relation to the matched counterpart, of the same sex and surname,
 * also of unknown given name. Always for review, never confirmed by itself;
 * anything ambiguous stays unmatched.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { createMergeState, findMatches, reanalyzeMatches, updateMatchDecision } from '../merge/matching.js';
import { isEffectivelyConfirmed, AUTO_CONFIRM_SCORE } from '../merge/executor.js';
import { Person, StromData } from '../types.js';

const HEAD = ['0 HEAD', '1 SOUR MYHERITAGE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];

/** Jan Novák, his wife known only as "? Nováková" (no dates, as MyHeritage has her) and their son Karel. */
function family(wife: { surname?: string; sex?: string; birth?: string } = {}): string[] {
    return [
        '0 @I1@ INDI', '1 NAME Jan /Novák/', '2 GIVN Jan', '2 SURN Novák', '1 SEX M',
        '1 BIRT', '2 DATE 3 MAR 1901', '1 FAMS @F1@',
        '0 @I2@ INDI', `1 NAME  /${wife.surname ?? 'Nováková'}/`, `2 SURN ${wife.surname ?? 'Nováková'}`,
        `1 SEX ${wife.sex ?? 'F'}`, ...(wife.birth ? ['1 BIRT', `2 DATE ${wife.birth}`] : []), '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Karel /Novák/', '2 GIVN Karel', '2 SURN Novák', '1 SEX M',
        '1 BIRT', '2 DATE 15 MAY 1933', '1 FAMC @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
    ];
}

/** A second marriage of Jan to another wife known only as "? Nováková". */
const SECOND_WIFE = [
    '0 @I4@ INDI', '1 NAME  /Nováková/', '2 SURN Nováková', '1 SEX F', '1 FAMS @F2@',
    '0 @F2@ FAM', '1 HUSB @I1@', '1 WIFE @I4@',
];

const importGed = (...records: string[][]): StromData =>
    convertToStrom(parseGedcom([...HEAD, ...records.flat(), '0 TRLR'].join('\n'))).data;
const unknownNamed = (data: StromData): Person[] =>
    Object.values(data.persons).filter(p => p.firstName === '?');

describe('a person of unknown given name pairs through a matched relative', () => {
    it('the wife "? Nováková" of a matched Jan Novák is a match for review, never confirmed by itself', () => {
        const existing = importGed(family());
        const incoming = importGed(family());
        const [treeWife] = unknownNamed(existing);
        const [fileWife] = unknownNamed(incoming);

        const state = createMergeState(existing, incoming);
        expect(state.unmatchedIncoming).toEqual([]);
        const match = state.matches.find(m => m.incomingId === fileWife.id)!;
        expect(match).toBeDefined();
        expect(match.existingId).toBe(treeWife.id);
        expect(match.confidence).toBe('medium');
        expect(match.score).toBeLessThan(AUTO_CONFIRM_SCORE);
        expect(match.reasons).toContain('unknown_name_relative');
        expect(isEffectivelyConfirmed(state, match)).toBe(false);

        // Confirming her husband and analysing again does not lift her to confirmed.
        const jan = state.matches.find(m => m.incomingPerson.firstName === 'Jan')!;
        updateMatchDecision(state, jan.incomingId, 'confirm');
        reanalyzeMatches(state);
        const again = state.matches.find(m => m.incomingId === fileWife.id)!;
        expect(again.existingId).toBe(treeWife.id);
        expect(again.confidence).toBe('medium');
        expect(isEffectivelyConfirmed(state, again)).toBe(false);
    });

    it('she pairs through her matched son as well, when her husband is not in the file', () => {
        const existing = importGed(family());
        const incoming = importGed(family());
        // Jan unknown on the incoming side: only Karel can lead to his mother.
        const fileJan = Object.values(incoming.persons).find(p => p.firstName === 'Jan')!;
        fileJan.firstName = 'Bohumil';
        fileJan.birthDate = '1870';
        const match = findMatches(existing, incoming).find(m => m.incomingPerson.firstName === '?')!;
        expect(match.existingId).toBe(unknownNamed(existing)[0].id);
        expect(match.reasons).toEqual(['unknown_name_relative', 'parent_of_matched']);
    });

    it('two such wives in the tree, or two in the file: no match', () => {
        const twoInTree = createMergeState(importGed(family(), SECOND_WIFE), importGed(family()));
        expect(twoInTree.matches.some(m => m.incomingPerson.firstName === '?')).toBe(false);
        expect(twoInTree.unmatchedIncoming.map(id => twoInTree.incomingData.persons[id].firstName)).toEqual(['?']);

        const twoInFile = createMergeState(importGed(family()), importGed(family(), SECOND_WIFE));
        expect(twoInFile.matches.some(m => m.incomingPerson.firstName === '?')).toBe(false);
    });

    it('matching birth dates on both sides keep the match; another surname or sex: no match', () => {
        const dated = findMatches(importGed(family({ birth: '1904' })), importGed(family({ birth: '12 JUN 1904' })))
            .find(m => m.incomingPerson.firstName === '?')!;
        expect(dated.reasons).toContain('unknown_name_relative');
        expect(dated.confidence).toBe('medium');

        for (const wife of [{ surname: 'Dvořáková' }, { sex: 'M' }]) {
            const state = createMergeState(importGed(family()), importGed(family(wife)));
            expect(state.matches.some(m => m.incomingPerson.firstName === '?'), JSON.stringify(wife)).toBe(false);
            expect(state.unmatchedIncoming.map(id => state.incomingData.persons[id].firstName)).toEqual(['?']);
        }
    });

    it('conflicting birth dates: not paired through the relative', () => {
        for (const [tree, file] of [['1904', '1880'], ['2 FEB 1904', '1 JAN 1904']]) {
            const matches = findMatches(importGed(family({ birth: tree })), importGed(family({ birth: file })));
            expect(matches.some(m => m.reasons.includes('unknown_name_relative')), `${tree} / ${file}`).toBe(false);
        }
    });

    it('a relative that is not matched leads nowhere', () => {
        const existing = importGed(family());
        const incoming = importGed(family());
        // Neither Jan nor Karel of the file is in the tree under these names and dates.
        for (const p of Object.values(incoming.persons)) {
            if (p.firstName === 'Jan') { p.firstName = 'Bohumil'; p.birthDate = '1870'; }
            if (p.firstName === 'Karel') { p.firstName = 'Vojtěch'; p.birthDate = '1899'; }
        }
        const state = createMergeState(existing, incoming);
        expect(state.matches.some(m => m.incomingPerson.firstName === '?')).toBe(false);
        expect(state.unmatchedIncoming.map(id => incoming.persons[id].firstName)).toContain('?');
    });
});
