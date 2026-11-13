/**
 * Another program's shared events in GEDCOM (spec 085 §7, 7b): RootsMagic,
 * Legacy and Family Historian write the event once and name the others
 * under it (`2 _SHAR @I@` + `3 ROLE` / `3 _ROLE` / `3 RELA`, `3 NOTE`;
 * Family Historian `2 _SHAN <name>`). A member of the household becomes a
 * copy of a shared event, any other role a participant of the event; a
 * census the file wrote at the family and at the persons is one event, and
 * the import summary says how many were converted. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { isHouseholdShareRole, shareRoleOf } from '../ged-shares.js';
import { strings } from '../strings.js';
import { LifeEvent, Person } from '../types.js';

const head = (program: string) => `0 HEAD
1 SOUR ${program}
2 NAME ${program}
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
`;

const ROOTSMAGIC = head('RootsMagic') + `0 @I1@ INDI
1 NAME Hromuta /Ostrozub/
1 SEX M
1 FAMS @F1@
1 CENS
2 DATE 1900
2 PLAC Medvezin
2 _SHAR @I2@
3 ROLE Household
2 _SHAR @I3@
3 ROLE Head
3 NOTE listed first
2 _SHAR @I4@
3 ROLE Boarder
2 _SHAR @I99@
3 ROLE Household
0 @I2@ INDI
1 NAME Radmila /Ostrozubová/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Mstiboj /Ostrozub/
1 SEX M
1 FAMC @F1@
1 BAPM
2 DATE 1895
2 _SHAR @I4@
3 ROLE Godparent
0 @I4@ INDI
1 NAME Pelhan /Bezruk/
1 SEX M
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1890
2 _SHAR @I4@
3 ROLE Witness
0 TRLR
`;

describe('GEDCOM _SHAR from RootsMagic', () => {
    const result = convertToStrom(parseGedcom(ROOTSMAGIC));
    const { data, stats } = result;
    const p = (first: string): Person => Object.values(data.persons).find(x => x.firstName === first)!;
    const census = (first: string): LifeEvent[] => (p(first).events ?? []).filter(e => e.type === 'census');

    it('gives each member of the household a copy of the census with one share id', () => {
        const [h] = census('Hromuta');
        const [r] = census('Radmila');
        const [m] = census('Mstiboj');
        expect(h.shareId).toBeTruthy();
        expect(r.shareId).toBe(h.shareId);
        expect(m.shareId).toBe(h.shareId);
        expect(census('Radmila')).toHaveLength(1);
        expect([h.date, h.place, r.date, r.place]).toEqual(['1900', 'Medvezin', '1900', 'Medvezin']);
        expect(h.shareRole).toBeUndefined();
        expect(r.shareRole).toBeUndefined();
        expect(m.shareRole).toBe('Head');
    });

    it('makes an unknown role a participant ("other" with the role as its note) and drops a person not in the file', () => {
        const [h] = census('Hromuta');
        expect(census('Pelhan')).toHaveLength(0);
        expect(h.participants).toEqual([expect.objectContaining({ role: 'other', personId: p('Pelhan').id, note: 'Boarder' })]);
        expect(JSON.stringify(data)).not.toContain('I99');
    });

    it('makes a godparent at a baptism and a witness at a wedding participants of them', () => {
        const baptism = p('Mstiboj').events!.find(e => e.type === 'baptism')!;
        expect(baptism.shareId).toBeUndefined();
        expect(baptism.participants).toEqual([expect.objectContaining({ role: 'godparent', personId: p('Pelhan').id })]);
        const union = Object.values(data.partnerships)[0];
        expect(union.participants).toEqual([expect.objectContaining({ role: 'witness', personId: p('Pelhan').id })]);
    });

    it('counts the converted events and their persons, and no _SHAR as a dropped tag', () => {
        expect(stats.sharedConverted).toBe(1);
        expect(stats.sharedConvertedPersons).toBe(3);
        expect(stats.sharedProgram).toBe('RootsMagic');
        expect(stats.droppedTagSummary).not.toContain('_SHAR');
        expect(strings.gedcom.sharedConverted(stats.sharedProgram, stats.sharedConverted, stats.sharedConvertedPersons))
            .toBe('Shared events from RootsMagic: 1 converted (3 people)');
    });
});

describe('GEDCOM _SHAR from Legacy and Family Historian', () => {
    const LEGACY = head('Legacy') + `0 @I1@ INDI
1 NAME Hromuta /Ostrozub/
1 RESI
2 DATE 1905
2 PLAC Lipolesy
2 _SHAR @I2@
3 ROLE Household Member
2 _SHAR @I3@
3 _ROLE Household Member
0 @I2@ INDI
1 NAME Radmila /Ostrozubová/
1 RESI
2 DATE 1905
2 PLAC Lipolesy
2 _SHAR @I1@
3 ROLE Household Member
0 @I3@ INDI
1 NAME Mstiboj /Ostrozub/
0 TRLR
`;

    it('reads "Household Member" as a plain member, and both directions as one shared event', () => {
        const { data, stats } = convertToStrom(parseGedcom(LEGACY));
        const all = Object.values(data.persons).flatMap(x => (x.events ?? []).map(e => ({ who: x.firstName, e })));
        const resi = all.filter(x => x.e.type === 'residence');
        expect(resi.map(x => x.who).sort()).toEqual(['Hromuta', 'Mstiboj', 'Radmila']);
        expect(new Set(resi.map(x => x.e.shareId)).size).toBe(1);
        expect(resi.every(x => x.e.shareId && !x.e.shareRole)).toBe(true);
        expect(stats.sharedConverted).toBe(1);
        expect(stats.sharedConvertedPersons).toBe(3);
        expect(stats.sharedProgram).toBe('Legacy');
    });

    const FAMILY_HISTORIAN = head('FAMILY_HISTORIAN') + `0 @I1@ INDI
1 NAME Hromuta /Ostrozub/
1 FAMS @F1@
1 CENS
2 DATE 1910
2 PLAC Medvezin
1 OCCU Miller
2 _SHAN Dobrovoj Hromutov
3 ROLE Witness
3 NOTE neighbour
0 @I2@ INDI
1 NAME Radmila /Ostrozubová/
1 FAMS @F1@
1 CENS
2 DATE 1910
2 PLAC Medvezin
0 @I3@ INDI
1 NAME Mstiboj /Ostrozub/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CENS
2 DATE 1910
2 PLAC Medvezin
2 _SHAR @I3@
3 RELA Household
0 TRLR
`;

    it('makes the family census with a household _SHAR one shared event, joined with the census at the persons', () => {
        const { data, stats } = convertToStrom(parseGedcom(FAMILY_HISTORIAN));
        const p = (first: string): Person => Object.values(data.persons).find(x => x.firstName === first)!;
        const census = ['Hromuta', 'Radmila', 'Mstiboj'].map(n => (p(n).events ?? []).filter(e => e.type === 'census'));
        expect(census.map(c => c.length)).toEqual([1, 1, 1]);
        expect(new Set(census.map(c => c[0].shareId)).size).toBe(1);
        expect(census[0][0].shareId).toBeTruthy();
        const union = Object.values(data.partnerships)[0];
        expect((union.events ?? []).filter(e => e.type === 'census')).toHaveLength(0);
        expect(stats.sharedConverted).toBe(1);
        expect(stats.sharedConvertedPersons).toBe(3);
    });

    it('makes a _SHAN a participant by name', () => {
        const { data } = convertToStrom(parseGedcom(FAMILY_HISTORIAN));
        const occupation = Object.values(data.persons).find(x => x.firstName === 'Hromuta')!.events!.find(e => e.type === 'occupation')!;
        expect(occupation.participants).toEqual([expect.objectContaining({ role: 'witness', name: 'Dobrovoj Hromutov', note: 'neighbour' })]);
        expect(occupation.shareId).toBeUndefined();
    });

    it('converts nothing in a file with no _SHAR, and a family census and the same at the persons stay as they were', () => {
        const plain = FAMILY_HISTORIAN.replace('2 _SHAR @I3@\n3 RELA Household\n', '');
        const { data, stats } = convertToStrom(parseGedcom(plain));
        expect(stats.sharedConverted).toBe(0);
        expect(Object.values(data.persons).flatMap(x => x.events ?? []).some(e => e.shareId)).toBe(false);
    });
});

describe('_SHAR roles', () => {
    it('tells a member of the household from a participant', () => {
        for (const role of [undefined, '', 'Household', 'Household Member', 'Principal', 'Head', 'Head of Household', '[Household]'])
            expect(isHouseholdShareRole(role)).toBe(true);
        for (const role of ['Witness', 'Godparent', 'Officiant', 'Boarder', 'Informant'])
            expect(isHouseholdShareRole(role)).toBe(false);
        expect(shareRoleOf('Household Member')).toBeUndefined();
        expect(shareRoleOf('Principal')).toBeUndefined();
        expect(shareRoleOf('Head')).toBe('Head');
    });
});

describe('Import summary line', () => {
    it('names the program and the counts', () => {
        expect(strings.gedcom.sharedConverted('Legacy', 2, 5)).toBe('Shared events from Legacy: 2 converted (5 people)');
        expect(strings.gedcom.sharedConverted('Legacy', 1, 1)).toBe('Shared events from Legacy: 1 converted (1 person)');
    });
});
