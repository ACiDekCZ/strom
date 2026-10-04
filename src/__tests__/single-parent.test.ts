/**
 * A child with one known parent, both ways it is made ("Add child" gives a
 * "?" stand-in; "Add parent" with one parent, the family wizard and older
 * trees left a parent link without a family): kept one way — a family with
 * a "?" — and working everywhere: filling in the other parent later (one
 * family, never a second), deleting either parent, JSON, GEDCOM and the
 * research (no extra "?", no nameless person), tree health.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { normalizeSingleParents, isPurePlaceholder } from '../single-parent.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { stabilizeIds } from '../research-link.js';
import { validateTreeData } from '../validation.js';
import { StromData, PersonId, TreeId, Gender, Person } from '../types.js';

const TREE = 'single-parent-test' as TreeId;

beforeEach(() => {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
});

const data = (): StromData => DataManager.getData();
const person = (firstName: string, gender: Gender): PersonId => DataManager.createPerson({ firstName, lastName: 'Berg', gender }).id;
const parentsOf = (d: StromData, id: PersonId): string[] => d.persons[id].parentIds.map(p => d.persons[p].isPlaceholder ? '?' : d.persons[p].firstName).sort();
const standIns = (d: StromData): Person[] => Object.values(d.persons).filter(p => p.isPlaceholder);
const unions = (d: StromData) => Object.values(d.partnerships);
const ged = (d: StromData): string => exportToGedcom(d).content;
const fromGed = (text: string): StromData => convertToStrom(parseGedcom(text)).data;

/** "Add child" on one person: the child and a "?" for the other parent (as relation-modal does). */
function addChildAlone(parent: PersonId, first: string): PersonId {
    const child = person(first, 'female');
    DataManager.addParentChild(parent, child);
    const stand = DataManager.createPerson({ firstName: '?', lastName: '', gender: data().persons[parent].gender === 'male' ? 'female' : 'male' }, true).id;
    const u = DataManager.createPartnership(parent, stand)!;
    DataManager.addParentChild(stand, child);
    DataManager.addParentChild(parent, child, u.id);
    return child;
}

/** "Add parent" with one parent (as relation-modal does). */
function addParentAlone(child: PersonId, first: string, gender: Gender): PersonId {
    const parent = person(first, gender);
    DataManager.addParentChild(parent, child);
    DataManager.ensureSingleParentFamilies();
    return parent;
}

/** Each child is in exactly one family with each of its two parents; no "?" stands for nothing. */
function consistent(d: StromData): void {
    for (const p of Object.values(d.persons)) {
        for (const pid of p.parentIds) expect(d.persons[pid]?.childIds).toContain(p.id);
        if (p.parentIds.length === 2) {
            const fams = unions(d).filter(u => u.childIds.includes(p.id));
            expect(fams).toHaveLength(1);
            expect([fams[0].person1Id, fams[0].person2Id].sort()).toEqual([...p.parentIds].sort());
        }
        if (p.isPlaceholder && isPurePlaceholder(d, p.id)) expect(p.partnerships.length + p.childIds.length).toBeGreaterThan(0);
    }
    expect(validateTreeData(d).stats.errors).toBe(0);
}

describe('a child with one known parent', () => {
    it('both ways end in one kind of family: the parent and a "?"', () => {
        const ole = person('Ole', 'male');
        const ida = addChildAlone(ole, 'Ida');
        const kari = person('Kari', 'female');
        addParentAlone(kari, 'Nils', 'male');
        for (const id of [ida, kari]) expect(parentsOf(data(), id)).toHaveLength(2);
        expect(parentsOf(data(), ida)).toEqual(['?', 'Ole']);
        expect(parentsOf(data(), kari)).toEqual(['?', 'Nils']);
        expect(unions(data())).toHaveLength(2);
        consistent(data());
    });

    it('older trees with a parent link without a family load as that family (deterministic, once), nothing lost', () => {
        const old = {
            version: 10, partnerships: {},
            persons: {
                ole: { id: 'ole', firstName: 'Ole', lastName: 'Berg', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: ['ida', 'kari'] },
                ida: { id: 'ida', firstName: 'Ida', lastName: 'Berg', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: ['ole'], childIds: [] },
                kari: { id: 'kari', firstName: 'Kari', lastName: 'Berg', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: ['ole'], childIds: [], parentRelTypes: { ole: 'adoptive' } },
            },
        };
        const a = migrateData(structuredClone(old));
        const b = migrateData(structuredClone(old));
        expect(a).toEqual(b);
        expect(unions(a)).toHaveLength(1);
        expect(standIns(a)).toHaveLength(1);
        expect(parentsOf(a, 'ida' as PersonId)).toEqual(['?', 'Ole']);
        expect(a.persons['kari' as PersonId].parentRelTypes).toEqual({ ole: 'adoptive' });
        // Loaded again: nothing more.
        expect(normalizeSingleParents(a)).toBe(false);
        consistent(a);
    });

    it('two parents who are not a couple, and a child whose only parent is a "?", are left as they are', () => {
        const d: StromData = migrateData({
            partnerships: {},
            persons: {
                a: { id: 'a', firstName: 'A', lastName: '', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: ['c'] },
                b: { id: 'b', firstName: 'B', lastName: '', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: ['c'] },
                c: { id: 'c', firstName: 'C', lastName: '', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: ['a', 'b'], childIds: [] },
                q: { id: 'q', firstName: '?', lastName: '', gender: 'male', isPlaceholder: true, partnerships: [], parentIds: [], childIds: ['d'] },
                d: { id: 'd', firstName: 'D', lastName: '', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: ['q'], childIds: [] },
            },
        });
        expect(unions(d)).toHaveLength(0);
        expect(standIns(d)).toHaveLength(1);
    });

    for (const way of ['Add child ("?")', 'Add parent (one parent)'] as const) {
        it(`${way}: the other parent added later takes the "?" place — one family, the "?" gone, every child of it`, () => {
            const ole = person('Ole', 'male');
            let ida: PersonId;
            if (way === 'Add child ("?")') {
                ida = addChildAlone(ole, 'Ida');
            } else {
                ida = person('Ida', 'female');
                DataManager.addParentChild(ole, ida);
                DataManager.ensureSingleParentFamilies();
            }
            const famBefore = unions(data())[0].id;
            // A sibling in the same family.
            const kari = person('Kari', 'female');
            DataManager.addParentChild(ole, kari, famBefore);
            DataManager.addParentChild(data().partnerships[famBefore].person2Id === ole ? data().partnerships[famBefore].person1Id : data().partnerships[famBefore].person2Id, kari, famBefore);
            const marta = person('Marta', 'female');
            expect(DataManager.canAddParentChild(marta, ida)).toBe(true);
            expect(DataManager.addParentChild(marta, ida)).toBe(true);
            expect(parentsOf(data(), ida)).toEqual(['Marta', 'Ole']);
            expect(parentsOf(data(), kari)).toEqual(['Marta', 'Ole']);
            expect(unions(data())).toHaveLength(1);
            expect(standIns(data())).toHaveLength(0);
            consistent(data());
        });
    }

    it('filled in when the two already had a family: the children move into it (never a second family)', () => {
        const ole = person('Ole', 'male');
        const marta = person('Marta', 'female');
        const u = DataManager.createPartnership(ole, marta)!;
        const nils = person('Nils', 'male');
        DataManager.addParentChild(ole, nils, u.id);
        DataManager.addParentChild(marta, nils, u.id);
        const ida = addChildAlone(ole, 'Ida');
        expect(unions(data())).toHaveLength(2);
        DataManager.addParentChild(marta, ida);
        expect(unions(data())).toHaveLength(1);
        expect(unions(data())[0].childIds.sort()).toEqual([ida, nils].sort());
        consistent(data());
    });

    it('deleting the known parent: the "?" goes with the family, the child keeps no stand-in', () => {
        const ole = person('Ole', 'male');
        const ida = addChildAlone(ole, 'Ida');
        DataManager.deletePerson(ole);
        expect(data().persons[ida].parentIds).toEqual([]);
        expect(standIns(data())).toHaveLength(0);
        expect(unions(data())).toHaveLength(0);
        consistent(data());
    });

    it('deleting the "?": the child keeps its known parent, in a "?" family again (nothing lost)', () => {
        const ole = person('Ole', 'male');
        const ida = addChildAlone(ole, 'Ida');
        const stand = standIns(data())[0].id;
        DataManager.deletePerson(stand);
        expect(parentsOf(data(), ida)).toEqual(['?', 'Ole']);
        expect(unions(data())).toHaveLength(1);
        consistent(data());
    });

    it('deleting one parent of a couple: the other keeps the children in a "?" family', () => {
        const ole = person('Ole', 'male');
        const marta = person('Marta', 'female');
        const u = DataManager.createPartnership(ole, marta)!;
        const ida = person('Ida', 'female');
        DataManager.addParentChild(ole, ida, u.id);
        DataManager.addParentChild(marta, ida, u.id);
        DataManager.deletePerson(ole);
        expect(parentsOf(data(), ida)).toEqual(['?', 'Marta']);
        consistent(data());
    });

    it('removing the link to the known parent: the "?" goes too, no empty "?" partner stays', () => {
        const ole = person('Ole', 'male');
        const ida = addChildAlone(ole, 'Ida');
        DataManager.removeParentChild(ole, ida);
        expect(data().persons[ida].parentIds).toEqual([]);
        expect(standIns(data())).toHaveLength(0);
        expect(data().persons[ole].partnerships).toEqual([]);
        consistent(data());
    });

    it('JSON there and back: the same tree', () => {
        const ole = person('Ole', 'male');
        addChildAlone(ole, 'Ida');
        const kari = person('Kari', 'female');
        addParentAlone(kari, 'Nils', 'male');
        const back = migrateData(JSON.parse(JSON.stringify(data())));
        expect(back).toEqual(migrateData(structuredClone(data())));
        expect(standIns(back)).toHaveLength(2);
    });

    it('GEDCOM there and back, both ways: the known parent only, no nameless person, the same families, never doubled', () => {
        const ole = person('Ole', 'male');
        addChildAlone(ole, 'Ida');
        const kari = person('Kari', 'female');
        addParentAlone(kari, 'Anna', 'female');
        const first = ged(data());
        expect(first).not.toContain('1 NAME //');
        expect(first.split('\n').filter(l => / INDI$/.test(l))).toHaveLength(4);
        expect(first.split('\n').filter(l => / FAM$/.test(l))).toHaveLength(2);
        const back = fromGed(first);
        expect(standIns(back)).toHaveLength(2);
        expect(unions(back)).toHaveLength(2);
        consistent(back);
        const again = fromGed(ged(back));
        expect(standIns(again)).toHaveLength(2);
        expect(unions(again)).toHaveLength(2);
    });

    it('the research: what goes has no "?" person; its version read back over the tree has exactly one "?" per family, the ties kept', () => {
        const ole = person('Ole', 'male');
        const ida = addChildAlone(ole, 'Ida');
        const kari = person('Kari', 'female');
        addParentAlone(kari, 'Nils', 'male');
        const sent = ged(data());
        expect(sent).not.toContain('1 NAME //');
        // As the research answers (its numbers on the people), read over the tree (stabilizeIds).
        const version = fromGed(sent);
        const merged = stabilizeIds(version, data());
        expect(standIns(merged)).toHaveLength(2);
        expect(unions(merged)).toHaveLength(2);
        const idaThere = Object.values(merged.persons).find(p => p.firstName === 'Ida')!;
        expect(parentsOf(merged, idaThere.id)).toEqual(['?', 'Ole']);
        expect(merged.persons[ida] ? merged.persons[ida].id : idaThere.id).toBeTruthy();
        consistent(merged);
    });
});
