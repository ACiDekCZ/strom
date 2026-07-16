/**
 * What the published GEDCOM sample files taught us (src/ged-parser.ts).
 *
 * Every case here was found by feeding the app the specification's own samples
 * — gedcom.org's 555SAMPLE and gedcom.io's GEDCOM 7 test files — rather than
 * files we wrote ourselves. Fixtures are inline: the samples are cut down to the
 * lines that carry the defect, so the test says what it is testing.
 *
 * The lesson these share: the importer was reading its own conventions into the
 * file. It expected persons to be numbered @I1@, it expected one family per
 * child, and it expected a marriage to end at most once.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom, parseName } from '../ged-parser.js';
import { StromData, Person } from '../types.js';

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const statsOf = (ged: string) => convertToStrom(parseGedcom(ged)).stats;

const people = (data: StromData): Person[] => Object.values(data.persons);
const named = (data: StromData, first: string): Person =>
    people(data).find(p => p.firstName === first)!;
const unions = (data: StromData) => Object.values(data.partnerships);

describe('the record type comes from the file, not the shape of the id', () => {
    // An xref is an opaque label. Requiring '@I' meant a GEDCOM numbering its
    // people @P1@ imported as an empty tree, reporting success.
    const withPrefix = (p: string): string => `0 HEAD
1 GEDC
2 VERS 5.5.5
0 @${p}1@ INDI
1 NAME John /Smith/
1 SEX M
1 FAMS @${p}F1@
0 @${p}2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @${p}F1@
0 @${p}F1@ FAM
1 HUSB @${p}1@
1 WIFE @${p}2@
1 MARR
2 DATE 1 APR 1911
0 TRLR`;

    it('reads a tree whose people are numbered @I1@', () => {
        const data = importGed(withPrefix('I'));
        expect(people(data)).toHaveLength(2);
        expect(unions(data)).toHaveLength(1);
    });

    it('reads the same tree when the program numbered them @P1@', () => {
        // The whole file, silently imported as nothing, before this was fixed.
        const data = importGed(withPrefix('P'));
        expect(people(data)).toHaveLength(2);
        expect(unions(data)).toHaveLength(1);
        expect(named(data, 'John').lastName).toBe('Smith');
    });

    it('keeps people whose ids look nothing like ours (gedcom.io xref.ged)', () => {
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
0 @I@ INDI
0 @1@ INDI
0 @_@ INDI
0 @0XFFFFFFFF@ INDI
0 @THEXREFPRODUCTIONDOESNOTHAVEAMAXIMUMLENGTH@ INDI
0 TRLR`);
        expect(people(data)).toHaveLength(6);
    });

    it('keeps a person the file gives no id at all (legal in GEDCOM 7)', () => {
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 7.0
0 INDI
1 NAME Nobody /Pointsatme/
0 TRLR`);
        expect(people(data)).toHaveLength(1);
        expect(named(data, 'Nobody').lastName).toBe('Pointsatme');
    });

    it('still ignores the records that are not people or families', () => {
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 5.5.5
0 @SUB1@ SUBM
1 NAME Some Submitter
0 TRLR`);
        expect(people(data)).toHaveLength(0);
    });
});

describe('a child born to one family and adopted into another (gedcom.org 555SAMPLE)', () => {
    // Joe is the son of Robert and Mary (@F1@) and the adopted son of Robert
    // alone (@F2@). Three defects at once: he ended up with three parents, both
    // birth parents were marked adoptive, and @F2@'s missing wife was invented
    // as a "?" card who became his mother.
    const SAMPLE = `0 HEAD
1 GEDC
2 VERS 5.5.5
0 @I1@ INDI
1 NAME Robert Eugene /Williams/
1 SEX M
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 NAME Mary Ann /Wilson/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Joe /Williams/
1 SEX M
1 FAMC @F1@
1 FAMC @F2@
2 PEDI adopted
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE DEC 1859
0 @F2@ FAM
1 HUSB @I1@
1 CHIL @I3@
0 TRLR`;

    it('gives the child two parents — the model allows no more', () => {
        // DataManager.addParentChild caps parents at two; only this importer
        // ever wrote a third, and the layout drew the child hanging off both
        // families at once by a very long line.
        const joe = named(importGed(SAMPLE), 'Joe');
        expect(joe.parentIds).toHaveLength(2);
    });

    it('hangs the child from the family they were born into', () => {
        const data = importGed(SAMPLE);
        const joe = named(data, 'Joe');
        const parents = joe.parentIds.map(id => data.persons[id].firstName);
        expect(parents.sort()).toEqual(['Mary Ann', 'Robert Eugene']);
    });

    it('does not call the birth parents adoptive because another family said so', () => {
        // PEDI belongs to the FAMC it sits under. One PEDI per person meant the
        // adoption in @F2@ relabelled Joe's birth in @F1@.
        const joe = named(importGed(SAMPLE), 'Joe');
        expect(joe.parentRelTypes ?? {}).toEqual({});
    });

    it('invents no spouse for the family the child does not hang from', () => {
        // @F2@ has a husband and no wife. With Joe belonging to @F1@ there is
        // nobody left in @F2@ to draw, so a "?" card would stand for a person
        // the file never claimed existed.
        const data = importGed(SAMPLE);
        expect(people(data).filter(p => p.isPlaceholder)).toHaveLength(0);
        expect(people(data)).toHaveLength(3);
        expect(unions(data)).toHaveLength(1);
    });

    it('writes the adoption down rather than losing it', () => {
        // The tree can only draw one set of parents, but an adoption is not
        // ours to throw away.
        expect(named(importGed(SAMPLE), 'Joe').notes)
            .toContain('Also recorded as adopted child of Robert Eugene Williams');
        expect(statsOf(SAMPLE).otherFamilyLinks).toBe(1);
    });

    it('still marks a child adopted when that is the only family they have', () => {
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 5.5.5
0 @I1@ INDI
1 NAME Robert /Williams/
1 SEX M
1 FAMS @F2@
0 @I2@ INDI
1 NAME Ann /Williams/
1 SEX F
1 FAMS @F2@
0 @I3@ INDI
1 NAME Joe /Williams/
1 SEX M
1 FAMC @F2@
2 PEDI adopted
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR`);
        const joe = named(data, 'Joe');
        expect(Object.values(joe.parentRelTypes ?? {})).toEqual(['adoptive', 'adoptive']);
    });

    it('marks an adoption by a lone parent too', () => {
        // The single-parent path never set the relationship type at all.
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 5.5.5
0 @I1@ INDI
1 NAME Robert /Williams/
1 SEX M
1 FAMS @F2@
0 @I3@ INDI
1 NAME Joe /Williams/
1 SEX M
1 FAMC @F2@
2 PEDI adopted
0 @F2@ FAM
1 HUSB @I1@
1 CHIL @I3@
0 TRLR`);
        const joe = named(data, 'Joe');
        const robert = named(data, 'Robert');
        expect(joe.parentRelTypes?.[robert.id]).toBe('adoptive');
    });

    it('leaves an ordinary single-parent family its placeholder spouse', () => {
        // The invented partner is how a lone parent's children get drawn; only
        // the family with nothing to draw must go without one.
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 5.5.5
0 @I1@ INDI
1 NAME Robert /Williams/
1 SEX M
1 FAMS @F1@
0 @I3@ INDI
1 NAME Joe /Williams/
1 SEX M
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I3@
0 TRLR`);
        expect(people(data).filter(p => p.isPlaceholder)).toHaveLength(1);
        expect(named(data, 'Joe').parentIds).toHaveLength(2);
    });
});

describe('a couple who married each other twice (gedcom.io remarriage1)', () => {
    // GEDCOM 7 records a remarriage as MARR/DIV/MARR inside ONE family. Asking
    // only "is there a DIV?" called them divorced for ever, and left the
    // marriage starting two years after the divorce that ended it.
    const REMARRIED = `0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME John Q /Public/
1 SEX M
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1 APR 1911
1 DIV
2 DATE 2 MAY 1912
1 MARR
2 DATE 4 JUL 1914
0 TRLR`;

    it('says they are married, because the last thing they did was marry', () => {
        expect(unions(importGed(REMARRIED))[0].status).toBe('married');
    });

    it('dates the union from the first wedding and does not end it', () => {
        const union = unions(importGed(REMARRIED))[0];
        expect(union.startDate).toBe('1911-04-01');
        expect(union.endDate).toBeUndefined();
    });

    it('keeps the divorce in between as a note', () => {
        expect(unions(importGed(REMARRIED))[0].note)
            .toContain('Divorced 1912-05-02, married again 1914-07-04');
    });

    it('still reports a couple who divorced and stayed that way', () => {
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME John Q /Public/
1 SEX M
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1 APR 1911
1 DIV
2 DATE 2 MAY 1912
0 TRLR`);
        expect(unions(data)[0].status).toBe('divorced');
        expect(unions(data)[0].endDate).toBe('1912-05-02');
    });

    it('trusts the order of undated events when there are no dates to compare', () => {
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME John Q /Public/
1 SEX M
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
1 DIV
1 MARR
0 TRLR`);
        expect(unions(data)[0].status).toBe('married');
    });

    it('leaves a bare DIV meaning divorced', () => {
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 5.5.5
0 @I1@ INDI
1 NAME John Q /Public/
1 SEX M
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
1 DIV
0 TRLR`);
        expect(unions(data)[0].status).toBe('divorced');
    });
});

describe('the slashes mark the surname wherever they fall (gedcom.io maximal70-tree1)', () => {
    it('reads a name that ends at the surname', () => {
        expect(parseName('John /Smith/')).toEqual({ firstName: 'John', lastName: 'Smith' });
        expect(parseName('Mary Ann /Wilson/')).toEqual({ firstName: 'Mary Ann', lastName: 'Wilson' });
        expect(parseName('/Smith/')).toEqual({ firstName: '', lastName: 'Smith' });
    });

    it('reads a name with a suffix after the surname', () => {
        // Ordinary in GEDCOM, and it used to miss the slashes altogether.
        expect(parseName('John /Smith/ Jr.')).toEqual({ firstName: 'John', lastName: 'Smith Jr.' });
    });

    it('does not mistake the second given name for the surname', () => {
        // The old fallback split at the first space: "John Paul /Smith/ Jr."
        // produced a Paul Smith Jr. whose first name was John.
        expect(parseName('John Paul /Smith/ Jr.'))
            .toEqual({ firstName: 'John Paul', lastName: 'Smith Jr.' });
    });

    it('survives the sample that exercises every part of a name', () => {
        expect(parseName('Lt. Cmndr. Joseph "John" /de Allen/ jr.'))
            .toEqual({ firstName: 'Lt. Cmndr. Joseph "John"', lastName: 'de Allen jr.' });
    });

    it('still guesses when the file gives no surname markers at all', () => {
        expect(parseName('John')).toEqual({ firstName: 'John', lastName: '' });
        expect(parseName('John Smith')).toEqual({ firstName: 'John', lastName: 'Smith' });
    });
});

describe('pointers to nobody (gedcom.io voidptr)', () => {
    it('ignores @VOID@ instead of making a person out of it', () => {
        // @VOID@ means "there was such a person, but this file does not record
        // them" — a note to the reader, never a link to follow.
        const data = importGed(`0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME John /Smith/
1 FAMS @VOID@
2 NOTE This tests a case where we want to show that Jane Doe was the 2nd wife.
1 FAMS @F1@
1 FAMC @VOID@
2 PEDI ADOPTED
0 @I2@ INDI
1 NAME Jane /Doe/
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @VOID@
0 TRLR`);
        expect(people(data)).toHaveLength(2);
        expect(unions(data)).toHaveLength(1);
        // The PEDI hanging off the void pointer must not reach a real family.
        expect(named(data, 'John').parentRelTypes ?? {}).toEqual({});
    });
});
