/**
 * A child with one known parent survives GEDCOM, whichever way it came.
 *
 * The app keeps it one way: a family of the known parent with a "?" stand-in
 * (src/single-parent.ts). A parent added alone, the one left after the other
 * parent of a couple was deleted, and Strom's older _STROM_NO_COUPLE families
 * all end there. In GEDCOM the stand-in has no record of its own (other
 * programs showed it as a nameless spouse): the family holds the known parent
 * and the children, and reads back as the same "?" family — never a second
 * family, never a nameless person, round after round.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, PersonId, TreeId, Gender, Person } from '../types.js';

const TREE = 'lone-parent-test-tree' as TreeId;

function reset(): void {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as {
        data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
    };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}
beforeEach(reset);

const exportGed = (data: StromData): string => exportToGedcom(data).content;
const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
/** The GEDCOM without the header (its date and time change between runs). */
const body = (ged: string): string => ged.slice(ged.indexOf('0 @SUBM1@'));
const named = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;
const parentNames = (data: StromData, first: string): string[] =>
    named(data, first).parentIds.map(id => data.persons[id].firstName).sort();
const famCount = (ged: string): number => ged.split('\n').filter(l => / FAM$/.test(l)).length;
const standIns = (data: StromData): Person[] => Object.values(data.persons).filter(p => p.isPlaceholder);
/** No record for a stand-in: no nameless person in the file. */
const noNameless = (ged: string): void => { expect(ged).not.toContain('1 NAME //'); expect(ged).not.toMatch(/1 NAME \? \//); };

function person(firstName: string, gender: Gender): PersonId {
    return DataManager.createPerson({ firstName, lastName: 'Novák', gender }).id;
}

describe('GEDCOM: a child with one known parent', () => {
    it('a father added alone: a "?" family that goes out with the father only and comes back the same, round after round', () => {
        const karel = person('Karel', 'male');
        DataManager.addFamily({
            anchorId: karel, father: { firstName: 'Jiří', lastName: 'Novák', gender: 'male' },
            siblings: [], children: [],
        });
        const data = DataManager.getData();
        expect(Object.keys(data.partnerships)).toHaveLength(1);
        expect(standIns(data)).toHaveLength(1);
        expect(parentNames(data, 'Karel')).toEqual(['?', 'Jiří']);

        const first = exportGed(data);
        noNameless(first);
        expect(famCount(first)).toBe(1);
        expect(first).toMatch(/0 @F1@ FAM\n1 HUSB @I\d+@\n1 CHIL @I\d+@\n0 /);
        expect(first).not.toContain('_STROM_NO_COUPLE');

        const back = importGed(first);
        expect(parentNames(back, 'Karel')).toEqual(['?', 'Jiří']);
        expect(Object.keys(back.partnerships)).toHaveLength(1);
        expect(standIns(back)).toHaveLength(1);

        const second = exportGed(back);
        expect(body(second)).toBe(body(first));
        expect(body(exportGed(importGed(second)))).toBe(body(first));
    });

    it('a mother alone (a link without a family) is the WIFE; her children share one family, read back as one "?" family', () => {
        const anna = person('Anna', 'female');
        const petr = person('Petr', 'male');
        const eva = person('Eva', 'female');
        DataManager.addParentChild(anna, petr);
        DataManager.addParentChild(anna, eva);

        const ged = exportGed(DataManager.getData());
        noNameless(ged);
        expect(famCount(ged)).toBe(1);
        expect(ged).toMatch(/0 @F1@ FAM\n1 WIFE @I1@\n1 CHIL @I2@\n1 CHIL @I3@\n0 /);

        const back = importGed(ged);
        expect(parentNames(back, 'Petr')).toEqual(['?', 'Anna']);
        expect(parentNames(back, 'Eva')).toEqual(['?', 'Anna']);
        expect(Object.keys(back.partnerships)).toHaveLength(1);
        expect(standIns(back)).toHaveLength(1);
        expect(body(exportGed(back))).toBe(body(ged));
    });

    it('deleting one parent of a couple: the other one keeps the child in a "?" family, in GEDCOM too', () => {
        const otec = person('Otec', 'male');
        const matka = person('Matka', 'female');
        const syn = person('Syn', 'male');
        const union = DataManager.createPartnership(otec, matka)!;
        DataManager.addParentChild(otec, syn, union.id);
        DataManager.addParentChild(matka, syn, union.id);
        DataManager.deletePerson(otec);

        const data = DataManager.getData();
        expect(Object.keys(data.partnerships)).toHaveLength(1);
        expect(parentNames(data, 'Syn')).toEqual(['?', 'Matka']);

        const ged = exportGed(data);
        noNameless(ged);
        expect(famCount(ged)).toBe(1);
        const back = importGed(ged);
        expect(parentNames(back, 'Syn')).toEqual(['?', 'Matka']);
        expect(body(exportGed(back))).toBe(body(ged));
    });

    it('two parents who are not a couple stay parents, not partners', () => {
        const otec = person('Otec', 'male');
        const matka = person('Matka', 'female');
        const syn = person('Syn', 'male');
        DataManager.addParentChild(otec, syn);
        DataManager.addParentChild(matka, syn);
        const ged = exportGed(DataManager.getData());
        expect(famCount(ged)).toBe(1);
        expect(ged).toMatch(/1 HUSB @I1@\n1 WIFE @I2@\n1 CHIL @I3@\n1 _STROM_NO_COUPLE Y/);
        const back = importGed(ged);
        expect(parentNames(back, 'Syn')).toEqual(['Matka', 'Otec']);
        expect(Object.keys(back.partnerships)).toHaveLength(0);
        expect(body(exportGed(back))).toBe(body(ged));
    });

    it('an adopted child of a lone parent stays adopted', () => {
        const anna = person('Anna', 'female');
        const petr = person('Petr', 'male');
        DataManager.addParentChild(anna, petr);
        const data = DataManager.getData();
        data.persons[petr].parentRelTypes = { [anna]: 'adoptive' };

        const ged = exportGed(data);
        expect(ged).toMatch(/1 FAMC @F1@\n2 PEDI adopted/);
        const back = importGed(ged);
        const p = named(back, 'Petr');
        expect(p.parentRelTypes?.[named(back, 'Anna').id]).toBe('adoptive');
        expect(body(exportGed(back))).toBe(body(ged));
    });

    it('a lone parent beside a couple: each child keeps exactly its own parents', () => {
        const otec = person('Otec', 'male');
        const matka = person('Matka', 'female');
        const spolecny = person('Spolecny', 'male');
        const jenOtcuv = person('JenOtcuv', 'male');
        const union = DataManager.createPartnership(otec, matka)!;
        DataManager.addParentChild(otec, spolecny, union.id);
        DataManager.addParentChild(matka, spolecny, union.id);
        DataManager.addParentChild(otec, jenOtcuv);

        const ged = exportGed(DataManager.getData());
        expect(famCount(ged)).toBe(2);
        const back = importGed(ged);
        expect(parentNames(back, 'Spolecny')).toEqual(['Matka', 'Otec']);
        expect(parentNames(back, 'JenOtcuv')).toEqual(['?', 'Otec']);
        expect(Object.keys(back.partnerships)).toHaveLength(2);
        expect(body(exportGed(back))).toBe(body(ged));
    });

    it('a family from another program with one spouse gets its "?" partner, and goes out again without a record for it', () => {
        const ged = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n'
            + '0 @I1@ INDI\n1 NAME Jiří /Novák/\n1 SEX M\n1 FAMS @F1@\n'
            + '0 @I2@ INDI\n1 NAME Karel /Novák/\n1 SEX M\n1 FAMC @F1@\n'
            + '0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n0 TRLR\n';
        const data = importGed(ged);
        expect(Object.keys(data.partnerships)).toHaveLength(1);
        expect(standIns(data)).toHaveLength(1);
        const out = exportGed(data);
        noNameless(out);
        expect(famCount(out)).toBe(1);
        expect(out.split('\n').filter(l => / INDI$/.test(l))).toHaveLength(2);
        expect(body(exportGed(importGed(out)))).toBe(body(out));
    });

    it('Strom\'s older single-parent family (_STROM_NO_COUPLE, one parent) reads as the "?" family', () => {
        const ged = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n'
            + '0 @I1@ INDI\n1 NAME Ole /Berg/\n1 SEX M\n1 FAMS @F1@\n'
            + '0 @I2@ INDI\n1 NAME Ida /Berg/\n1 SEX F\n1 FAMC @F1@\n'
            + '0 @I3@ INDI\n1 NAME Kari /Berg/\n1 SEX F\n1 FAMC @F1@\n'
            + '0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n1 CHIL @I3@\n1 _STROM_NO_COUPLE Y\n0 TRLR\n';
        const data = importGed(ged);
        expect(Object.keys(data.partnerships)).toHaveLength(1);
        expect(standIns(data)).toHaveLength(1);
        expect(parentNames(data, 'Ida')).toEqual(['?', 'Ole']);
        expect(parentNames(data, 'Kari')).toEqual(['?', 'Ole']);
    });

    it('a "?" with something of its own (a note) is kept as a person', () => {
        const ole = person('Ole', 'male');
        const ida = person('Ida', 'female');
        const stand = DataManager.createPerson({ firstName: '?', lastName: '', gender: 'female' }, true).id;
        const union = DataManager.createPartnership(ole, stand)!;
        DataManager.addParentChild(ole, ida, union.id);
        DataManager.addParentChild(stand, ida, union.id);
        DataManager.getData().persons[stand].notes = 'snad Marie z Voss';
        const ged = exportGed(DataManager.getData());
        expect(ged.split('\n').filter(l => / INDI$/.test(l))).toHaveLength(3);
        expect(ged).toContain('snad Marie z Voss');
    });

    it('a marked family that holds a wedding is a couple after all', () => {
        const ged = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n'
            + '0 @I1@ INDI\n1 NAME Jiří /Novák/\n1 SEX M\n1 FAMS @F1@\n'
            + '0 @I2@ INDI\n1 NAME Anna /Nováková/\n1 SEX F\n1 FAMS @F1@\n'
            + '0 @I3@ INDI\n1 NAME Karel /Novák/\n1 SEX M\n1 FAMC @F1@\n'
            + '0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 CHIL @I3@\n1 MARR\n2 DATE 1900\n1 _STROM_NO_COUPLE Y\n0 TRLR\n';
        const data = importGed(ged);
        expect(Object.keys(data.partnerships)).toHaveLength(1);
        expect(parentNames(data, 'Karel')).toEqual(['Anna', 'Jiří']);
    });
});
