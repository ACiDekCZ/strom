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
import { stabilizeIds, contentFingerprint } from '../research-link.js';
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

    it('older trees with a parent link without a family load as that family — one per child (deterministic, once), nothing lost', () => {
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
        // Ida and Kari each with Ole and a "?" of their own: nothing said they share the other parent.
        expect(unions(a)).toHaveLength(2);
        expect(standIns(a)).toHaveLength(2);
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
        it(`${way}: the other parent added later takes the "?" place for that child only — a sibling of the "?" family only when named`, () => {
            const ole = person('Ole', 'male');
            let ida: PersonId;
            if (way === 'Add child ("?")') {
                ida = addChildAlone(ole, 'Ida');
            } else {
                ida = person('Ida', 'female');
                DataManager.addParentChild(ole, ida);
                DataManager.ensureSingleParentFamilies();
            }
            const fam = unions(data())[0];
            const standId = fam.person1Id === ole ? fam.person2Id : fam.person1Id;
            // Two siblings in the same "?" family (as "Add child" with the "?" partner chosen makes them).
            const kari = person('Kari', 'female');
            const nils = person('Nils', 'male');
            for (const c of [kari, nils]) {
                DataManager.addParentChild(ole, c, fam.id);
                DataManager.addParentChild(standId, c, fam.id);
            }
            const marta = person('Marta', 'female');
            expect(DataManager.canAddParentChild(marta, ida)).toBe(true);
            // Marta for Ida, and (ticked) for Kari — not for Nils.
            expect(DataManager.addParentChild(marta, ida, undefined, [kari])).toBe(true);
            expect(parentsOf(data(), ida)).toEqual(['Marta', 'Ole']);
            expect(parentsOf(data(), kari)).toEqual(['Marta', 'Ole']);
            expect(parentsOf(data(), nils)).toEqual(['?', 'Ole']);
            expect(unions(data())).toHaveLength(2);
            expect(standIns(data())).toHaveLength(1);
            consistent(data());
            // Nils's mother later: the same family as Marta's when it is Marta (never a second one), the "?" gone.
            expect(DataManager.addParentChild(marta, nils)).toBe(true);
            expect(unions(data())).toHaveLength(1);
            expect(standIns(data())).toHaveLength(0);
            consistent(data());
        });
    }

    it('a sibling never gets the other parent unasked', () => {
        const ole = person('Ole', 'male');
        const ida = addChildAlone(ole, 'Ida');
        const fam = unions(data())[0];
        const standId = fam.person1Id === ole ? fam.person2Id : fam.person1Id;
        const kari = person('Kari', 'female');
        DataManager.addParentChild(ole, kari, fam.id);
        DataManager.addParentChild(standId, kari, fam.id);
        const marta = person('Marta', 'female');
        DataManager.addParentChild(marta, ida);
        expect(parentsOf(data(), ida)).toEqual(['Marta', 'Ole']);
        expect(parentsOf(data(), kari)).toEqual(['?', 'Ole']);
        consistent(data());
    });

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

    it('C: a tree in step with the research before the conversion is in step after it (the "?" families it made do not count); anything added to them does', () => {
        const old = {
            version: 10, partnerships: {},
            persons: {
                ole: { id: 'ole', firstName: 'Ole', lastName: 'Berg', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: ['ida'] },
                ida: { id: 'ida', firstName: 'Ida', lastName: 'Berg', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: ['ole'], childIds: [] },
            },
        } as unknown as StromData;
        const before = contentFingerprint(old);
        const converted = migrateData(structuredClone(old));
        expect(standIns(converted)).toHaveLength(1);
        expect(contentFingerprint(converted)).toBe(before);
        // A wedding date on that family is a change to send.
        const dated = structuredClone(converted);
        unions(dated)[0].startDate = '1820';
        expect(contentFingerprint(dated)).not.toBe(before);
        // So is the mother named in place of the "?".
        const named = structuredClone(converted);
        const st = standIns(named)[0];
        named.persons[st.id] = { ...st, firstName: 'Marta', isPlaceholder: false };
        expect(contentFingerprint(named)).not.toBe(before);
    });

    it('D: a childless "?" partner is no nameless person in GEDCOM; its family stays (the known spouse alone with the status) and reads back', () => {
        const ole = person('Ole', 'male');
        const stand = DataManager.createPerson({ firstName: '?', lastName: '', gender: 'female' }, true).id;
        const u = DataManager.createPartnership(ole, stand)!;
        // "Married, the spouse unknown": nothing else, still said (N1 of the final round: lost on a hand-over).
        let out = ged(data());
        expect(out).not.toContain('1 NAME //');
        expect(out).toMatch(/0 @F1@ FAM\n1 HUSB @I1@\n1 MARR\n0 /);
        let back = fromGed(out);
        expect(unions(back)).toHaveLength(1);
        expect(unions(back)[0].status).toBe('married');
        expect(standIns(back)).toHaveLength(1);
        // Divorced and separated keep their status too.
        data().partnerships[u.id].status = 'divorced';
        back = fromGed(ged(data()));
        expect(unions(back).map(x => x.status)).toEqual(['divorced']);
        data().partnerships[u.id].status = 'separated';
        back = fromGed(ged(data()));
        expect(unions(back).map(x => x.status)).toEqual(['separated']);
        // With a wedding date: the date too.
        data().partnerships[u.id].status = 'married';
        data().partnerships[u.id].startDate = '1820';
        out = ged(data());
        expect(out).not.toContain('1 NAME //');
        expect(out).toMatch(/0 @F1@ FAM\n1 HUSB @I1@\n1 MARR\n2 DATE 1820/);
        back = fromGed(out);
        expect(unions(back)).toHaveLength(1);
        expect(unions(back)[0].startDate).toBe('1820');
        expect(standIns(back)).toHaveLength(1);
    });
});
