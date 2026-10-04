/**
 * Parent links outside any partnership survive GEDCOM.
 *
 * A parent added alone ("Add parents" with the father only), or the one left
 * after the other parent of a couple was deleted, has no partnership — and the
 * exporter wrote families from partnerships only, so the link vanished from
 * every GEDCOM (and from every send to the research). It now goes out as a
 * family of its own marked _STROM_NO_COUPLE and comes back as it was: no
 * partnership, no "?" partner, never a second family on the next export.
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

function person(firstName: string, gender: Gender): PersonId {
    return DataManager.createPerson({ firstName, lastName: 'Novák', gender }).id;
}

describe('GEDCOM: a parent without a partnership', () => {
    it('a father added alone goes out as a family and comes back alone, round after round', () => {
        const karel = person('Karel', 'male');
        DataManager.addFamily({
            anchorId: karel, father: { firstName: 'Jiří', lastName: 'Novák', gender: 'male' },
            siblings: [], children: [],
        });
        const data = DataManager.getData();
        expect(Object.keys(data.partnerships)).toHaveLength(0);

        const first = exportGed(data);
        expect(famCount(first)).toBe(1);
        expect(first).toMatch(/0 @F1@ FAM\n1 HUSB @I\d+@\n1 CHIL @I\d+@\n1 _STROM_NO_COUPLE Y/);

        const back = importGed(first);
        expect(parentNames(back, 'Karel')).toEqual(['Jiří']);
        expect(named(back, 'Jiří').childIds).toEqual([named(back, 'Karel').id]);
        expect(Object.keys(back.partnerships)).toHaveLength(0);
        expect(Object.values(back.persons).some(p => p.isPlaceholder)).toBe(false);

        const second = exportGed(back);
        expect(body(second)).toBe(body(first));
        expect(body(exportGed(importGed(second)))).toBe(body(first));
    });

    it('a mother alone is the WIFE; her children share one family', () => {
        const anna = person('Anna', 'female');
        const petr = person('Petr', 'male');
        const eva = person('Eva', 'female');
        DataManager.addParentChild(anna, petr);
        DataManager.addParentChild(anna, eva);

        const ged = exportGed(DataManager.getData());
        expect(famCount(ged)).toBe(1);
        expect(ged).toMatch(/0 @F1@ FAM\n1 WIFE @I1@\n1 CHIL @I2@\n1 CHIL @I3@\n1 _STROM_NO_COUPLE Y/);

        const back = importGed(ged);
        expect(parentNames(back, 'Petr')).toEqual(['Anna']);
        expect(parentNames(back, 'Eva')).toEqual(['Anna']);
        expect(Object.keys(back.partnerships)).toHaveLength(0);
    });

    it('deleting one parent of a couple keeps the other parent in GEDCOM', () => {
        const otec = person('Otec', 'male');
        const matka = person('Matka', 'female');
        const syn = person('Syn', 'male');
        const union = DataManager.createPartnership(otec, matka)!;
        DataManager.addParentChild(otec, syn, union.id);
        DataManager.addParentChild(matka, syn, union.id);
        DataManager.deletePerson(otec);

        const data = DataManager.getData();
        expect(Object.keys(data.partnerships)).toHaveLength(0);
        expect(parentNames(data, 'Syn')).toEqual(['Matka']);

        const ged = exportGed(data);
        expect(famCount(ged)).toBe(1);
        const back = importGed(ged);
        expect(parentNames(back, 'Syn')).toEqual(['Matka']);
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
        expect(p.parentRelTypes).toEqual({ [named(back, 'Anna').id]: 'adoptive' });
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
        expect(parentNames(back, 'JenOtcuv')).toEqual(['Otec']);
        expect(Object.keys(back.partnerships)).toHaveLength(1);
        expect(body(exportGed(back))).toBe(body(ged));
    });

    it('a family from another program with one spouse still gets its "?" partner', () => {
        const ged = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n'
            + '0 @I1@ INDI\n1 NAME Jiří /Novák/\n1 SEX M\n1 FAMS @F1@\n'
            + '0 @I2@ INDI\n1 NAME Karel /Novák/\n1 SEX M\n1 FAMC @F1@\n'
            + '0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n0 TRLR\n';
        const data = importGed(ged);
        expect(Object.keys(data.partnerships)).toHaveLength(1);
        expect(Object.values(data.persons).filter(p => p.isPlaceholder)).toHaveLength(1);
        // …and the stand-in's couple does not grow a second family on export.
        const out = exportGed(data);
        expect(famCount(out)).toBe(1);
        expect(body(exportGed(importGed(out)))).toBe(body(out));
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
