/**
 * "Link to…" (spec 102 §4): the people a file is already theirs — a place in
 * the tree or the research's assignment — are shown linked (ticked, fixed,
 * named above the list), never "Nobody yet" beside the sentence "already
 * linked". Invented data.
 */

import { describe, it, expect } from 'vitest';
import { attachFixedPeople, attachResearchAssign } from '../ui/material-attach-ui.js';
import { Attachment, Person, PersonId } from '../types.js';
import { MaterialItem } from '../materials.js';

const person = (id: string, refn?: string, init: Partial<Person> = {}): Person =>
    ({ id: id as PersonId, firstName: id, lastName: 'Novák', gender: 'male', refn, parentIds: [], childIds: [], partnerships: [], ...init }) as Person;

const JAN = person('jan', 'P0001');
const MARIE = person('marie', 'P0002');
const JOSEF = person('josef');
const PEOPLE = [JAN, MARIE, JOSEF];

const research = (key: string, persons: string[]): MaterialItem =>
    ({ key: `m:${key}`, title: key, name: `${key}.jpg`, persons, viaBatch: [], origin: 'research' }) as unknown as MaterialItem;

function tree(key: string, places: Attachment['places'], persons: string[] = [], removed = false): { item: MaterialItem; rec: Attachment } {
    const rec = { id: key, name: `${key}.jpg`, mimeType: 'image/jpeg', dataUrl: 'data:', sizeBytes: 1, places, ...(removed ? { removed: { at: '2026-01-01' } } : {}) } as unknown as Attachment;
    return { item: { key: `a:${key}`, title: key, name: `${key}.jpg`, persons, viaBatch: [], attachment: rec, origin: 'tree' } as unknown as MaterialItem, rec };
}

describe('attachFixedPeople', () => {
    it("a research's file assigned to the person (outside the tree): they are linked already", () => {
        // Before the fix: a file outside the tree had nobody fixed, and "Nobody yet" stood beside "already linked".
        expect(attachFixedPeople([research('svatba', ['P0001', 'P0002'])], PEOPLE, () => undefined)).toEqual([JAN.id, MARIE.id]);
    });

    it("a tree file at the person: linked; a place at their event only is not the person's own", () => {
        const a = tree('dopis', [{ personId: JOSEF.id }, { personId: JAN.id, fact: 'birth' }]);
        expect(attachFixedPeople([a.item], PEOPLE, () => a.rec)).toEqual([JOSEF.id]);
    });

    it('several files: only the people all of them have', () => {
        const a = tree('a', [{ personId: JAN.id }, { personId: JOSEF.id }]);
        const b = research('b', ['P0001']);
        const recs = new Map<MaterialItem, Attachment | undefined>([[a.item, a.rec], [b, undefined]]);
        expect(attachFixedPeople([a.item, b], PEOPLE, i => recs.get(i))).toEqual([JAN.id]);
    });

    it('a file taken out of the tree is nobody\'s; nobody: empty', () => {
        const a = tree('pryc', [{ personId: JAN.id }], [], true);
        expect(attachFixedPeople([a.item], PEOPLE, () => a.rec)).toEqual([]);
        expect(attachFixedPeople([research('nikdo', [])], PEOPLE, () => undefined)).toEqual([]);
    });
});

describe('attachResearchAssign (spec 147 K3)', () => {
    const refn = (id: PersonId) => PEOPLE.find(p => p.id === id)?.refn ?? null;
    const both = (key: string, persons: string[], treePersons?: string[]): MaterialItem =>
        ({ key: `m:${key}`, title: key, name: `${key}.jpg`, persons, ...(treePersons ? { treePersons } : {}), viaBatch: [], origin: 'both',
            file: { id: key, name: `${key}.jpg`, sha: 'a'.repeat(64), persons } }) as unknown as MaterialItem;

    it('a file the research keeps: the person linked in the tree is assigned in the research too', () => {
        // Before the fix: "Link to…" wrote only the tree; the research's list kept the file "Without a person".
        expect(attachResearchAssign([both('I0001', [])], [{ personId: JAN.id }], refn)).toEqual({ files: ['I0001'], add: ['P0001'] });
    });

    it('a person the research has already, a person without a REFN, an event or a source: nothing to write', () => {
        expect(attachResearchAssign([both('I0001', ['P0001'])], [{ personId: JAN.id }], refn)).toBeNull();
        expect(attachResearchAssign([both('I0001', [])], [{ personId: JOSEF.id }], refn)).toBeNull();
        expect(attachResearchAssign([both('I0001', [])], [{ sourceId: 's1' }], refn)).toBeNull();
    });

    it('a person only in the tree\'s places counts as not yet in the research; files only in the tree are left out', () => {
        expect(attachResearchAssign([both('I0001', ['P0001'], ['P0001']), tree('dopis', []).item], [{ personId: JAN.id }, { personId: MARIE.id }], refn))
            .toEqual({ files: ['I0001'], add: ['P0001', 'P0002'] });
    });
});
