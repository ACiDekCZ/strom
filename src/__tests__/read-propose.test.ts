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
    personVariants, variantsText, entrySource, proposeUnchosen,
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

describe('family the research gives as "other", and persons found through relatives', () => {
    const READ = 'D20261019153012-a1b2';
    const birth = (ref: string, gedcom: string): ReadEntry['events'][number] =>
        ({ type: 'BIRT', date: { text: gedcom, gedcom }, place: null, persons: [{ ref, role: 'principal' }], region: null });
    const spouses = (data: StromData, id: string, a: string, b: string, children: string[] = []): void => {
        data.partnerships[id as PartnershipId] = { id, person1Id: a, person2Id: b, childIds: children, status: 'married' } as unknown as Partnership;
        data.persons[a as PersonId].partnerships.push(id as PartnershipId);
        data.persons[b as PersonId].partnerships.push(id as PartnershipId);
        for (const c of children) {
            data.persons[c as PersonId].parentIds.push(a as PersonId, b as PersonId);
            data.persons[a as PersonId].childIds.push(c as PersonId);
            data.persons[b as PersonId].childIds.push(c as PersonId);
        }
    };
    const withPersons = (...list: Person[]): StromData => {
        const data = { version: STROM_DATA_VERSION, persons: {}, partnerships: {} } as unknown as StromData;
        for (const p of list) data.persons[p.id] = p;
        return data;
    };

    it('a grandparent given as "other" with the research\'s match links; one without a match is new, not left out', () => {
        const data = tree();
        data.persons['g' as PersonId] = person('g', 'Matěj', 'Novák', 'male', { refn: 'P0007' });
        const entry: ReadEntry = {
            ...baptism(),
            persons: [...baptism().persons,
                rp('p5', 'other', 'Matěj', 'Novák', { roleText: 'father\'s father', match: [{ person: 'P0007', why: 'name', score: 0.9 }] }),
                rp('p6', 'other', 'Ludmila', '', { roleText: 'father\'s mother' })],
            relations: [...baptism().relations, { type: 'parent', parent: 'p5', child: 'p2' }, { type: 'parent', parent: 'p6', child: 'p2' }],
        };
        const s = initialPropose(READ, entry, data);
        expect(s.persons.p5).toMatchObject({ choice: 'link', target: 'g' });
        expect(s.persons.p5.candidate?.byResearch).toBe(true);
        expect(s.persons.p6).toMatchObject({ choice: 'new', target: '' });
        expect(s.persons.p4.choice).toBe('skip');
    });

    it('a godparent without relations: the research\'s match links it; the app\'s guess alone keeps No, carried for Link', () => {
        const data = tree();
        data.persons['k' as PersonId] = person('k', 'Jan', 'Král', 'male', { refn: 'P0009', birthDate: '1801' });
        const byResearch: ReadEntry = {
            ...baptism(),
            persons: baptism().persons.map(p => p.ref === 'p4' ? { ...p, match: [{ person: 'P0009', why: 'name', score: 0.8 }] } : p),
        };
        expect(initialPropose(READ, byResearch, data).persons.p4).toMatchObject({ choice: 'link', target: 'k' });
        const byApp: ReadEntry = { ...baptism(), events: [...baptism().events, birth('p4', '1801')] };
        const s = initialPropose(READ, byApp, data);
        expect(s.persons.p4).toMatchObject({ choice: 'skip', target: '' });
        expect(s.persons.p4.candidate?.id).toBe('k');
    });

    it('three research matches of a grandfather: the one that is the linked mother\'s parent; equal and unrelated: none', () => {
        const build = (related: boolean): StromData => {
            const data = withPersons(
                person('f', 'Karel', 'Šimek', 'male', { refn: 'P0300' }),
                person('m', 'Johanna', 'Rybářová', 'female', { marriedSurname: 'Šimková' }),
                person('r1', 'Vojtěch', 'Rybář', 'male', { refn: 'P0301' }),
                person('r2', 'Vojtěch', 'Rybář', 'male', { refn: 'P0302' }),
                person('r3', 'Vojtěch', 'Rybář', 'male', { refn: 'P0303' }),
                person('gm', 'Marie', 'Rybářová', 'female'),
            );
            spouses(data, 'u1', 'f', 'm');
            spouses(data, 'u2', 'r2', 'gm', related ? ['m'] : []);
            return data;
        };
        const three = ['P0301', 'P0302', 'P0303'].map(person => ({ person, why: 'name', score: 0.8 }));
        const entry: ReadEntry = {
            id: 'e1', page: 1, region: null, transcript: '', variants: [], translation: '', glossary: [],
            persons: [
                rp('p1', 'child', 'Petr', 'Šimek'),
                rp('p2', 'father', 'Karel', 'Šimek', { match: [{ person: 'P0300', why: 'name', score: 0.9 }] }),
                rp('p3', 'mother', 'Johana', 'Šimková'),
                rp('p4', 'other', 'Vojtěch', 'Rybář', { roleText: 'mother\'s father', match: three }),
                rp('p5', 'other', 'Marie', '', { roleText: 'mother\'s mother' }),
            ],
            events: [],
            relations: [
                { type: 'parent', parent: 'p2', child: 'p1' }, { type: 'parent', parent: 'p3', child: 'p1' }, { type: 'spouse', a: 'p2', b: 'p3' },
                { type: 'parent', parent: 'p4', child: 'p3' }, { type: 'parent', parent: 'p5', child: 'p3' },
            ],
        };
        const s = initialPropose(READ, entry, build(true));
        const targets = Object.fromEntries(Object.values(s.persons).map(p => [p.ref, `${p.choice}:${p.target}`]));
        expect(targets).toEqual({ p1: 'new:', p2: 'link:f', p3: 'link:m', p4: 'link:r2', p5: 'link:gm' });
        expect(s.persons.p4.candidate?.byResearch).toBe(true);
        // None of the three is her parent and the scores are equal: the user's choice.
        expect(initialPropose(READ, entry, build(false)).persons.p4).toMatchObject({ choice: 'new', target: '', candidate: null });
        // One strictly best score decides when the relations do not.
        const best: ReadEntry = { ...entry, persons: entry.persons.map(p => p.ref === 'p4' ? { ...p, match: three.map((m, i) => i === 2 ? { ...m, score: 0.9 } : m) } : p) };
        expect(initialPropose(READ, best, build(false)).persons.p4).toMatchObject({ choice: 'link', target: 'r3' });
    });

    it('a mother read without a surname: the linked father\'s wife born on the read day', () => {
        const v = person('v', 'Václav', 'Novák', 'male', { refn: 'P0001' });
        const w = person('w', 'Leontýna Amálie', 'Šrámková', 'female', { birthDate: '1817-09-21' });
        const other = person('o', 'Málinka', 'Vrbická', 'female', { birthDate: '1817' });
        const data = withPersons(v, w, other);
        spouses(data, 'u1', 'v', 'w');
        const entry: ReadEntry = {
            ...baptism(),
            persons: [rp('p1', 'child', 'Jan', 'Novák'), baptism().persons[1], rp('p3', 'mother', 'Málinka', '')],
            events: [birth('p3', '21 SEP 1817')],
        };
        const s = initialPropose(READ, entry, data);
        expect(s.persons.p3).toMatchObject({ choice: 'link', target: 'w' });
        expect(s.persons.p3.candidate?.reasons).toEqual(expect.arrayContaining(['birth', 'partner']));
    });

    it('two relatives that fit equally: no candidate, the choice is the user\'s', () => {
        const v = person('v', 'Václav', 'Novák', 'male', { refn: 'P0001' });
        const a = person('a', 'Anna', 'Dvořáková', 'female');
        const data = withPersons(v, a, person('j1', 'Jan', 'Novák', 'male'), person('j2', 'Jan', 'Novák', 'male'));
        spouses(data, 'u1', 'v', 'a', ['j1', 'j2']);
        const entry: ReadEntry = { ...baptism(), persons: baptism().persons.slice(0, 2).map(p => p.ref === 'p1' ? { ...p, surname: '' } : p), events: [] };
        const s = initialPropose(READ, entry, data);
        expect(s.persons.p2.target).toBe('v');
        expect(s.persons.p1).toMatchObject({ choice: 'new', candidate: null });
    });

    it('a child and a mother in other name forms: the father\'s child born that day, then that child\'s mother', () => {
        const father = person('f', 'Bořivoj', 'Krumpholc', 'male', { refn: 'P0100' });
        const child = person('c', 'Bořivoj', 'Krumpholz', 'male', { birthDate: '1931-11-17', nameVariants: ['Ctibor Krumpholz', 'Bořivoj Krumphólc'] });
        const mother = person('m', 'Hermína Leontýna', 'Štěpánková', 'female', { birthDate: '1898-02-14', marriedSurname: 'Krumpholc' });
        const data = withPersons(father, child, mother);
        spouses(data, 'u1', 'f', 'm', ['c']);
        const entry: ReadEntry = {
            id: 'e1', page: 1, region: null, transcript: '', variants: [], translation: '', glossary: [],
            persons: [
                rp('p1', 'child', 'Ctibor Bořivoj', 'Krumpholc'),
                rp('p2', 'father', 'Bořivoj', 'Krumpholc', { match: [{ person: 'P0100', why: 'name', score: 0.9 }] }),
                rp('p3', 'mother', 'Hermina Leontýna', 'Krumpholc'),
            ],
            events: [birth('p1', '17 NOV 1931')],
            relations: [{ type: 'parent', parent: 'p2', child: 'p1' }, { type: 'parent', parent: 'p3', child: 'p1' }],
        };
        const s = initialPropose(READ, entry, data);
        expect(s.persons.p2).toMatchObject({ choice: 'link', target: 'f' });
        expect(s.persons.p1).toMatchObject({ choice: 'link', target: 'c' });
        expect(s.persons.p1.candidate?.reasons).toEqual(expect.arrayContaining(['name', 'birth', 'parents']));
        expect(s.persons.p3).toMatchObject({ choice: 'link', target: 'm' });
        expect(s.persons.p3.candidate?.reasons).toEqual(expect.arrayContaining(['name', 'child']));
    });

    it('a family of seven read mostly by given names: the research\'s two grandfathers lead to everyone', () => {
        const gf1 = person('gf1', 'Jakub', 'Hořejší', 'male', { refn: 'P0201' });
        const gm1 = person('gm1', 'Lidmila', 'Hořejší', 'female');
        const gf2 = person('gf2', 'Matěj', 'Kolář', 'male', { refn: 'P0202' });
        const gm2 = person('gm2', 'Katarina', 'Kolářová', 'female');
        const father = person('t2', 'Tomáš', 'Hořejší', 'male', { birthDate: '1860-02-04' });
        const mother = person('t5', 'Rosalia', 'Kolářová', 'female', { birthDate: '1863-09-09' });
        const child = person('t1', 'Marta', 'Hořejší', 'female', { birthDate: '1890-03-12' });
        const data = withPersons(gf1, gm1, gf2, gm2, father, mother, child);
        spouses(data, 'u1', 'gf1', 'gm1', ['t2']);
        spouses(data, 'u2', 'gf2', 'gm2', ['t5']);
        spouses(data, 'u3', 't2', 't5', ['t1']);
        const entry: ReadEntry = {
            id: 'e1', page: 1, region: null, transcript: '', variants: [], translation: '', glossary: [],
            persons: [
                rp('p1', 'child', 'Marta', ''),
                rp('p2', 'father', 'Tomáš', ''),
                rp('p3', 'other', 'Jakub', 'Hořejší', { roleText: 'father\'s father', match: [{ person: 'P0201', why: 'name', score: 0.9 }] }),
                rp('p4', 'other', 'Ludmila', '', { roleText: 'father\'s mother' }),
                rp('p5', 'mother', 'Rozálie', ''),
                rp('p6', 'other', 'Matěj', 'Kolář', { roleText: 'mother\'s father', match: [{ person: 'P0202', why: 'name', score: 0.9 }] }),
                rp('p7', 'other', 'Kateřina', '', { roleText: 'mother\'s mother' }),
            ],
            events: [birth('p1', '12 MAR 1890'), birth('p2', '4 FEB 1860'), birth('p5', '9 SEP 1863')],
            relations: [
                { type: 'parent', parent: 'p2', child: 'p1' }, { type: 'parent', parent: 'p5', child: 'p1' }, { type: 'spouse', a: 'p2', b: 'p5' },
                { type: 'parent', parent: 'p3', child: 'p2' }, { type: 'parent', parent: 'p4', child: 'p2' },
                { type: 'parent', parent: 'p6', child: 'p5' }, { type: 'parent', parent: 'p7', child: 'p5' },
            ],
        };
        const s = initialPropose(READ, entry, data);
        const targets = Object.fromEntries(Object.values(s.persons).map(p => [p.ref, `${p.choice}:${p.target}`]));
        expect(targets).toEqual({
            p1: 'link:t1', p2: 'link:t2', p3: 'link:gf1', p4: 'link:gm1', p5: 'link:t5', p6: 'link:gf2', p7: 'link:gm2',
        });
    });

    it('the father\'s child of the read name who died before the read child was born or baptised: not that child', () => {
        const build = (death: string): StromData => {
            const data = withPersons(person('v', 'Václav', 'Novák', 'male', { refn: 'P0001' }), person('a', 'Anna', 'Dvořáková', 'female'),
                person('j', 'Jan', 'Novák', 'male', { deathDate: death }));
            spouses(data, 'u1', 'v', 'a', ['j']);
            return data;
        };
        const entry: ReadEntry = { ...baptism(), persons: baptism().persons.slice(0, 2), events: [birth('p1', '10 MAR 1846')], relations: [{ type: 'parent', parent: 'p2', child: 'p1' }] };
        const s = initialPropose(READ, entry, build('1844-05-01'));
        expect(s.persons.p2.target).toBe('v');
        expect(s.persons.p1).toMatchObject({ choice: 'new', target: '', candidate: null });
        // The baptism's date counts as well; a death year alone before it rules out too.
        const baptised: ReadEntry = { ...entry, events: baptism().events };
        expect(initialPropose(READ, baptised, build('1845')).persons.p1).toMatchObject({ choice: 'new', candidate: null });
        // A death after the birth, or one the dates cannot place before it: still the child.
        expect(initialPropose(READ, entry, build('1846-07-01')).persons.p1).toMatchObject({ choice: 'link', target: 'j' });
        expect(initialPropose(READ, entry, build('1846')).persons.p1).toMatchObject({ choice: 'link', target: 'j' });
    });

    it('a child read without a given name: the father\'s only child by the surname alone is offered on Link, not linked', () => {
        const data = withPersons(person('v', 'Václav', 'Novák', 'male', { refn: 'P0001' }), person('a', 'Anna', 'Dvořáková', 'female'),
            person('j', 'Jan', 'Novák', 'male', { birthDate: '1846-03-10' }));
        spouses(data, 'u1', 'v', 'a', ['j']);
        const entry: ReadEntry = { ...baptism(), persons: [rp('p1', 'child', '', 'Novák'), baptism().persons[1]], events: [], relations: [{ type: 'parent', parent: 'p2', child: 'p1' }] };
        const s = initialPropose(READ, entry, data);
        expect(s.persons.p2.target).toBe('v');
        expect(s.persons.p1).toMatchObject({ choice: 'new', target: '', candidate: { id: 'j', tentative: true } });
        // The given name or the birth day as well: linked.
        const named: ReadEntry = { ...entry, persons: [rp('p1', 'child', 'Jan', 'Novák'), baptism().persons[1]] };
        expect(initialPropose(READ, named, data).persons.p1).toMatchObject({ choice: 'link', target: 'j' });
        const dated: ReadEntry = { ...entry, events: [birth('p1', '10 MAR 1846')] };
        expect(initialPropose(READ, dated, data).persons.p1).toMatchObject({ choice: 'link', target: 'j' });
    });

    it('a person read by the given name only: the one tree person of that name born the same day', () => {
        const data = withPersons(person('x', 'Barbora', 'Kubátová', 'female', { birthDate: '1873-04-19' }), person('y', 'Barbora', 'Malá', 'female', { birthDate: '1873' }));
        const entry: ReadEntry = { ...baptism(), persons: [rp('p1', 'child', 'Barbora', '')], events: [birth('p1', '19 APR 1873')], relations: [] };
        expect(initialPropose(READ, entry, data).persons.p1).toMatchObject({ choice: 'link', target: 'x' });
        const undated: ReadEntry = { ...entry, events: [] };
        expect(initialPropose(READ, undated, data).persons.p1).toMatchObject({ choice: 'new', target: '' });
    });

    it('Link with nobody chosen: its events and relationships off, not counted, listed until chosen or set to New', () => {
        const data = tree();
        const s = initialPropose(READ, baptism(), data);
        expect(proposeUnchosen(s, data)).toEqual([]);
        s.persons.p1.choice = 'link';
        expect(proposeUnchosen(s, data)).toEqual(['p1']);
        const items = proposeItems(baptism(), s, data);
        for (const key of ['ev:0', 'rel:0', 'rel:1']) {
            expect(items.find(i => i.key === key)).toMatchObject({ unchosen: true, checked: false, enabled: false });
        }
        // Only Václav's occupation and residence.
        expect(proposeCounts(baptism(), s, data)).toEqual({ n: 0, m: 2 });
        s.persons.p1.choice = 'new';
        expect(proposeUnchosen(s, data)).toEqual([]);
        expect(proposeCounts(baptism(), s, data)).toEqual({ n: 1, m: 5 });
        // A tree person deleted since: no target again, not a link to nobody.
        s.persons.p1 = { ...s.persons.p1, choice: 'link', target: 'gone' as PersonId };
        expect(proposeUnchosen(s, data)).toEqual(['p1']);
        expect(carryPropose(s, READ, baptism(), data).persons.p1).toMatchObject({ choice: 'link', target: '' });
    });
});
