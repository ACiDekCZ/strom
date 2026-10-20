/**
 * The tree suggestion of a read entry: defaults per person, what is already
 * in the tree, what a person set to "No" unticks, what a linked person gains,
 * the counts on the button, and the choices kept for a second reading.
 */

import { describe, it, expect } from 'vitest';
import { STROM_DATA_VERSION, StromData, Person, PersonId, Partnership, PartnershipId } from '../types.js';
import type { ReadEntry, ReadPerson } from '../research-read.js';
import {
    initialPropose, proposeItems, proposeCounts, linkAdditions, carryPropose, readGender, eventPrincipals,
    personVariants, variantsText, entrySource,
} from '../read-propose.js';

function person(id: string, first: string, last: string, gender: Person['gender'], extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra };
}

/** Václav Novák (*1812) married to Anna Dvořáková; the research knows Václav as P0001. */
function tree(): StromData {
    const v = person('v', 'Václav', 'Novák', 'male', { birthDate: '1812', refn: 'P0001', partnerships: ['u1' as PartnershipId] });
    const a = person('a', 'Anna', 'Dvořáková', 'female', { partnerships: ['u1' as PartnershipId] });
    const u = { id: 'u1', person1Id: 'v', person2Id: 'a', childIds: [], status: 'married' } as unknown as Partnership;
    return { version: STROM_DATA_VERSION, persons: { v, a }, partnerships: { u1: u } } as unknown as StromData;
}

function rp(ref: string, role: ReadPerson['role'], given: string, surname: string, extra: Partial<ReadPerson> = {}): ReadPerson {
    return { ref, role, roleText: '', given, surname, written: `${given} ${surname}`, sex: '', age: '', occupation: '', residence: '', uncertain: [], region: null, match: [], ...extra };
}

function baptism(): ReadEntry {
    return {
        id: 'e1', page: 1, region: [0.1, 0.1, 0.8, 0.2], transcript: 'Joannes[?] Nowak', variants: [{ at: 'Joannes[?]', other: 'Josephus' }],
        translation: '', glossary: [],
        persons: [
            rp('p1', 'child', 'Jan', 'Novák', { written: 'Joannes Nowak', uncertain: ['given'] }),
            rp('p2', 'father', 'Václav', 'Novák', { match: [{ person: 'P0001', why: 'name, place', score: 0.9 }], occupation: 'domkář', residence: 'Lhota č. 12' }),
            rp('p3', 'mother', 'Anna', 'Dvořáková'),
            rp('p4', 'godparent', 'Jan', 'Král'),
        ],
        events: [
            { type: 'BAPM', date: { text: '3. 4. 1846', gedcom: '3 APR 1846' }, place: { text: 'Lhota', known: '' }, persons: [{ ref: 'p1', role: 'principal' }, { ref: 'p4', role: 'godparent' }], region: null },
        ],
        relations: [
            { type: 'parent', parent: 'p2', child: 'p1' },
            { type: 'parent', parent: 'p3', child: 'p1' },
            { type: 'spouse', a: 'p2', b: 'p3' },
            { type: 'parent', parent: 'p4', child: 'p1' },
        ],
    };
}

describe('the suggestion of a read entry', () => {
    it('defaults: the research match links, a likely match links, no candidate is new, a godparent is not written', () => {
        const s = initialPropose('D20261019153012-a1b2', baptism(), tree());
        expect(s.persons.p2).toMatchObject({ choice: 'link', target: 'v' });
        expect(s.persons.p2.candidate?.byResearch).toBe(true);
        // Anna by name and by her husband (the spouse relation) above the threshold.
        expect(s.persons.p3).toMatchObject({ choice: 'link', target: 'a' });
        expect(s.persons.p3.candidate?.reasons).toContain('partner');
        expect(s.persons.p1).toMatchObject({ choice: 'new', target: '' });
        expect(s.persons.p4.choice).toBe('skip');
    });

    it('a relationship already in the tree is unticked; one of a person set to No unticks itself', () => {
        const data = tree();
        const s = initialPropose('D20261019153012-a1b2', baptism(), data);
        const items = proposeItems(baptism(), s, data);
        const by = (k: string) => items.find(i => i.key === k)!;
        expect(by('rel:2')).toMatchObject({ inTree: true, checked: false, enabled: false });
        expect(by('rel:0')).toMatchObject({ inTree: false, checked: true });
        expect(by('rel:3')).toMatchObject({ skipped: true, checked: false, enabled: false });
        expect(by('ev:0')).toMatchObject({ refs: ['p1'], checked: true });
        s.persons.p1.choice = 'skip';
        const after = proposeItems(baptism(), s, data);
        expect(after.find(i => i.key === 'ev:0')!.checked).toBe(false);
        expect(after.find(i => i.key === 'rel:0')!.skipped).toBe(true);
    });

    it('the counts: new persons, and ticked events, relationships and a linked person’s additions', () => {
        const data = tree();
        const s = initialPropose('D20261019153012-a1b2', baptism(), data);
        // 1 new (Jan); facts: baptism + 2 parent relations + Václav's occupation and residence.
        expect(proposeCounts(baptism(), s, data)).toEqual({ n: 1, m: 5 });
        s.ticks['rel:1'] = false;
        expect(proposeCounts(baptism(), s, data)).toEqual({ n: 1, m: 4 });
    });

    it('a linked person: only what is new, a differing value said and kept as another form', () => {
        const v = tree().persons['v' as PersonId];
        expect(linkAdditions(rp('x', 'father', 'Václav', 'Novák', { occupation: 'domkář' }), v).adds).toEqual([{ kind: 'occupation', value: 'domkář' }]);
        const other = linkAdditions(rp('x', 'father', 'Wenzel', 'Novák', { sex: 'M' }), v);
        expect(other.diffs).toEqual([{ what: 'given', tree: 'Václav', entry: 'Wenzel' }]);
        expect(other.adds).toEqual([{ kind: 'variant', value: 'Wenzel Novák' }]);
        // Already a known form, the occupation already there: nothing.
        const known = { ...v, nameVariants: ['Wenzel Novák'], events: [{ id: 'o', type: 'occupation' as const, note: 'Domkář' }] };
        expect(linkAdditions(rp('x', 'father', 'Wenzel', 'Novák', { occupation: 'domkář' }), known).adds).toEqual([]);
    });

    it('a birth date the tree has otherwise is not overwritten', () => {
        const data = tree();
        const entry: ReadEntry = { ...baptism(), events: [{ type: 'BIRT', date: { text: '1813', gedcom: '1813' }, place: null, persons: [{ ref: 'p2', role: 'principal' }], region: null }] };
        const s = initialPropose('D20261019153012-a1b2', entry, data);
        const ev = proposeItems(entry, s, data).find(i => i.key === 'ev:0')!;
        expect(ev.differs).toEqual({ what: 'birth', tree: '1812', entry: '1813' });
        expect(ev.checked).toBe(false);
    });

    it('a second reading keeps the choices and the names typed', () => {
        const data = tree();
        const s = initialPropose('D20261019153012-a1b2', baptism(), data);
        s.persons.p3.choice = 'new';
        s.persons.p1.given = 'Josef';
        s.persons.p1.edited.given = true;
        s.ticks['rel:0'] = false;
        const again = carryPropose(s, 'D20261019153012-a1b2', { ...baptism(), persons: baptism().persons.map(p => p.ref === 'p1' ? { ...p, surname: 'Nowak' } : p) }, data);
        expect(again.persons.p3.choice).toBe('new');
        expect(again.persons.p1.given).toBe('Josef');
        expect(again.persons.p1.surname).toBe('Nowak');
        expect(again.ticks['rel:0']).toBe(false);
    });

    it('helpers: sex by role, an event’s persons by role, the readers’ variants of a person', () => {
        expect(readGender({ sex: '', role: 'mother' })).toBe('female');
        expect(readGender({ sex: 'M', role: 'mother' })).toBe('male');
        expect(readGender({ sex: '', role: 'child' })).toBe('unknown');
        const e = baptism();
        expect(eventPrincipals(e, { type: 'BAPM', persons: [] })).toEqual(['p1']);
        expect(eventPrincipals({ persons: [rp('g', 'groom', 'A', 'B'), rp('b', 'bride', 'C', 'D')] }, { type: 'MARR', persons: [] })).toEqual(['g', 'b']);
        const v = personVariants(e.persons[0], e.variants);
        expect(variantsText(v)).toBe('Joannes / Josephus');
        expect(personVariants(e.persons[1], e.variants)).toEqual([]);
    });
});

describe('the same entry suggested again', () => {
    const READ = 'D20261019153012-a1b2';
    /** Two Jan Nováks; the one written from this very entry before cites its source. */
    function written(): StromData {
        const data = tree();
        data.persons['j1' as PersonId] = person('j1', 'Jan', 'Novák', 'male', { birthDate: '1846' });
        data.persons['j2' as PersonId] = person('j2', 'Jan', 'Novák', 'male', { birthDate: '1846', sourceIds: ['s9'] });
        data.sources = { s9: { id: 's9', title: 'Křest, Lhota 1846', reading: READ, readingEntry: 'e1' } };
        return data;
    }

    it('the source of that entry is found by the reading and the entry', () => {
        const data = written();
        expect(entrySource(data, READ, 'e1')?.id).toBe('s9');
        expect(entrySource(data, READ, 'e2')).toBeNull();
        expect(entrySource(data, 'D20261019153012-ffff', 'e1')).toBeNull();
    });

    it('the person written from it before is the candidate (no second person)', () => {
        const s = initialPropose(READ, baptism(), written());
        expect(s.persons.p1).toMatchObject({ choice: 'link', target: 'j2' });
    });

    it('another reading of the same document: the two equal Jans stay the user\'s choice', () => {
        const s = initialPropose('D20261019153012-ffff', baptism(), written());
        expect(s.persons.p1.choice).toBe('new');
    });
});
