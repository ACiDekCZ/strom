/**
 * "Not this person" goes through GEDCOM (B-N5): a godparent or a witness
 * recorded by name keeps the persons the user said they are not
 * (EventParticipant.linkRejected) as `3 _STROM_NOT_LINK @Ix@` under the
 * participant, and a tree read from that file offers no link to them again.
 * A person left out of the export is not named. Invented data.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { nameLinkLeads, rejectedNameLinks } from '../participant-match.js';
import type { Person, PersonId, StromData } from '../types.js';

/**
 * Bořivoj's baptism of 1896 names the godfather "Hostivít Jeřabinka" by name;
 * the tree has two of that name alive then (born 1850 and 1870). The wedding
 * of 1894 names the witness "Hostivít Jeřabinka" too.
 */
const GED = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Bořivoj /Křemenáček/', '1 SEX M', '1 BIRT', '2 DATE 2 APR 1896', '1 FAMC @F1@',
    '1 BAPM', '2 DATE 3 APR 1896', '2 PLAC Horní Bludovec', '2 _WITN Hostivít Jeřabinka', '3 RELA Godparent',
    '0 @I2@ INDI', '1 NAME Hostivít /Jeřabinka/', '1 SEX M', '1 BIRT', '2 DATE 1850',
    '0 @I3@ INDI', '1 NAME Hostivít /Jeřabinka/', '1 SEX M', '1 BIRT', '2 DATE 1870',
    '0 @I5@ INDI', '1 NAME Drahobyl /Křemenáček/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 FAMS @F1@',
    '0 @I6@ INDI', '1 NAME Vratislavka /Ořechovská/', '1 SEX F', '1 BIRT', '2 DATE 1870', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I5@', '1 WIFE @I6@', '1 CHIL @I1@',
    '1 MARR', '2 DATE 1894', '2 _WITN Hostivít Jeřabinka', '3 RELA Witness',
    '0 TRLR',
].join('\n');

const load = (text: string): StromData => convertToStrom(parseGedcom(text)).data;
const hostivit = (d: StromData, year: string): PersonId =>
    Object.values(d.persons).find((p: Person) => p.firstName === 'Hostivít' && p.birthDate === year)!.id;
const godfather = (d: StromData) => Object.values(d.persons).find(p => p.firstName === 'Bořivoj')!
    .events!.find(e => e.type === 'baptism')!.participants![0];
const witness = (d: StromData) => Object.values(d.partnerships)[0].participants![0];
/** The candidates offered per participant, by year of birth. */
const offered = (d: StromData): number[][] => nameLinkLeads(d).map(l => l.candidates.map(c => c.birthYear ?? 0));

describe('"Not this person" in GEDCOM (B-N5)', () => {
    it('export and import into an empty tree: the rejection stays, the offer does not come back', () => {
        const d = load(GED);
        expect(offered(d)).toEqual([[1850, 1870], [1850, 1870]]);
        godfather(d).linkRejected = [hostivit(d, '1850'), hostivit(d, '1870')];
        witness(d).linkRejected = [hostivit(d, '1870')];
        expect(offered(d)).toEqual([[1850]]);

        const out = exportToGedcom(d, 'Křemenáček', {}).content;
        expect(out.match(/^3 _STROM_NOT_LINK @[^@]+@$/gm)).toHaveLength(3);
        const again = load(out);
        expect(offered(again)).toEqual([[1850]]);
        expect(rejectedNameLinks(again)).toBe(2);
        expect(godfather(again).linkRejected!.sort()).toEqual([hostivit(again, '1850'), hostivit(again, '1870')].sort());
        expect(witness(again).linkRejected).toEqual([hostivit(again, '1870')]);
        expect(godfather(again).name).toBe('Hostivít Jeřabinka');
        expect(godfather(again).role).toBe('godparent');
    });

    it('a rejected person left out of the export is not named; a linked participant writes none', () => {
        const d = load(GED);
        const out1870 = hostivit(d, '1870');
        godfather(d).linkRejected = [hostivit(d, '1850'), out1870];
        delete d.persons[out1870];
        const out = exportToGedcom(d, 'Křemenáček', {}).content;
        expect(out.match(/^3 _STROM_NOT_LINK /gm)).toHaveLength(1);
        const d2 = load(GED);
        const g = godfather(d2);
        g.personId = hostivit(d2, '1850');
        g.linkRejected = [hostivit(d2, '1870')];
        expect(exportToGedcom(d2, 'Křemenáček', {}).content).not.toContain('_STROM_NOT_LINK');
    });
});
