/**
 * The godparent who keeps turning up (src/godparents.ts).
 *
 * The rule under test: one appearance is a neighbour, several in one family is a
 * lead. And a lead somebody already knows about — a grandmother at her
 * grandchildren's baptisms — is not a lead, it is noise.
 */

import { describe, it, expect } from 'vitest';
import { recurringParticipants, godparentLeads } from '../godparents.js';
import {
    StromData, Person, PersonId, PartnershipId, EventParticipant,
    toPersonId, toPartnershipId,
} from '../types.js';

function person(id: string, firstName: string, lastName: string): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
    };
}

function baptised(p: Person, participants: Partial<EventParticipant>[]): Person {
    return {
        ...p,
        events: [{
            id: `ev_${p.id}`, type: 'baptism', date: '1880',
            participants: participants.map((x, i) => ({
                id: `pt_${p.id}_${i}`, role: 'godparent' as const, ...x,
            })),
        }],
    };
}

const tree = (...people: Person[]): StromData => ({
    persons: Object.fromEntries(people.map(p => [p.id, p])) as Record<PersonId, Person>,
    partnerships: {},
});

describe('recurringParticipants', () => {
    it('says nothing about a godparent who appears once', () => {
        const data = tree(baptised(person('a', 'Jan', 'Novak'), [{ name: 'Marie Dvořáková' }]));
        expect(recurringParticipants(data)).toEqual([]);
    });

    it('finds the name that keeps coming back, and whose baptisms', () => {
        const data = tree(
            baptised(person('a', 'Jan', 'Novak'), [{ name: 'Marie Dvořáková' }]),
            baptised(person('b', 'Petr', 'Novak'), [{ name: 'Marie Dvořáková' }]),
            baptised(person('c', 'Anna', 'Novakova'), [{ name: 'Marie Dvořáková' }]),
        );
        const [lead] = recurringParticipants(data);
        expect(lead.name).toBe('Marie Dvořáková');
        expect(lead.count).toBe(3);
        expect(lead.subjects.map(s => s.name).sort()).toEqual(['Anna Novakova', 'Jan Novak', 'Petr Novak']);
    });

    it('reads the register’s spelling loosely — it is the same woman', () => {
        const data = tree(
            baptised(person('a', 'Jan', 'Novak'), [{ name: 'Marie Dvořáková' }]),
            baptised(person('b', 'Petr', 'Novak'), [{ name: 'marie dvorakova ' }]),
        );
        expect(recurringParticipants(data)).toHaveLength(1);
        expect(recurringParticipants(data)[0].count).toBe(2);
    });

    it('counts a linked person once, however their name is written', () => {
        const marie = person('m', 'Marie', 'Dvořáková');
        const data = tree(marie,
            baptised(person('a', 'Jan', 'Novak'), [{ personId: marie.id }]),
            baptised(person('b', 'Petr', 'Novak'), [{ personId: marie.id, name: 'M. Dvorakova' }]),
        );
        const found = recurringParticipants(data);
        expect(found).toHaveLength(1);
        expect(found[0].personId).toBe(marie.id);
        expect(found[0].name).toBe('Marie Dvořáková');   // from the person, not the note
    });

    it('does not mix two different godparents together', () => {
        const data = tree(
            baptised(person('a', 'Jan', 'Novak'), [{ name: 'Marie Dvořáková' }, { name: 'Josef Krátký' }]),
            baptised(person('b', 'Petr', 'Novak'), [{ name: 'Marie Dvořáková' }, { name: 'Josef Krátký' }]),
        );
        expect(recurringParticipants(data).map(p => p.name).sort())
            .toEqual(['Josef Krátký', 'Marie Dvořáková']);
    });

    it('counts the same person at their own two events', () => {
        // A witness at a wedding and a godparent at the baptism of the same
        // person is still someone who keeps turning up.
        const jan = person('a', 'Jan', 'Novak');
        jan.events = [
            { id: 'e1', type: 'baptism', participants: [{ id: 'p1', role: 'godparent', name: 'Marie Dvořáková' }] },
            { id: 'e2', type: 'custom', customLabel: 'Svatba', participants: [{ id: 'p2', role: 'witness', name: 'Marie Dvořáková' }] },
        ];
        const [lead] = recurringParticipants(tree(jan));
        expect(lead.count).toBe(2);
        expect(lead.subjects).toHaveLength(1);
    });
});

describe('godparentLeads', () => {
    it('drops the grandmother — two hops up is still family', () => {
        const babicka = person('g', 'Anna', 'Novakova');
        const otec = person('f', 'Josef', 'Novak');
        const jan = baptised(person('a', 'Jan', 'Novak'), [{ personId: babicka.id }]);
        const petr = baptised(person('b', 'Petr', 'Novak'), [{ personId: babicka.id }]);
        // A real grandmother, two hops away: babička → otec → each child.
        babicka.childIds = [otec.id];
        otec.parentIds = [babicka.id];
        otec.childIds = [jan.id, petr.id];
        jan.parentIds = [otec.id];
        petr.parentIds = [otec.id];

        const data = tree(babicka, otec, jan, petr);
        expect(recurringParticipants(data)).toHaveLength(1);   // she does recur…
        expect(godparentLeads(data)).toEqual([]);              // …but it is not a lead
    });

    it('drops the uncle — three hops (parent’s sibling) is still family', () => {
        // Uncles and aunts are the most common godparents, and a one-step check
        // never reached them: strýc is child → otec → grandparent → strýc away.
        const grandparent = person('gp', 'Karel', 'Novak');
        const otec = person('f', 'Josef', 'Novak');
        const stryc = person('u', 'Vaclav', 'Novak');
        const petr = baptised(person('a', 'Petr', 'Novak'), [{ personId: stryc.id }]);
        const anna = baptised(person('b', 'Anna', 'Novakova'), [{ personId: stryc.id }]);
        grandparent.childIds = [otec.id, stryc.id];
        otec.parentIds = [grandparent.id];
        stryc.parentIds = [grandparent.id];
        otec.childIds = [petr.id, anna.id];
        petr.parentIds = [otec.id];
        anna.parentIds = [otec.id];

        const data = tree(grandparent, otec, stryc, petr, anna);
        expect(godparentLeads(data)).toEqual([]);   // within the family radius
    });

    it('keeps a linked person who is a stranger to the children', () => {
        // No blood or marriage path within three hops → still worth a look.
        const soused = person('s', 'Marie', 'Dvorakova');
        const data = tree(soused,
            baptised(person('a', 'Jan', 'Novak'), [{ personId: soused.id }]),
            baptised(person('b', 'Petr', 'Novak'), [{ personId: soused.id }]),
        );
        const [lead] = godparentLeads(data);
        expect(lead.personId).toBe(soused.id);
        expect(lead.alreadyRelated).toBe(false);
    });

    it('does not raise a lead from one person’s own two events', () => {
        // A lead has to span at least two different people; a witness at Jan's
        // wedding who is also his baptism godparent recurs but proves nothing.
        const jan = person('a', 'Jan', 'Novak');
        jan.events = [
            { id: 'e1', type: 'baptism', participants: [{ id: 'p1', role: 'godparent', name: 'Marie Dvořáková' }] },
            { id: 'e2', type: 'custom', customLabel: 'Svatba', participants: [{ id: 'p2', role: 'witness', name: 'Marie Dvořáková' }] },
        ];
        const data = tree(jan);
        expect(recurringParticipants(data)[0].count).toBe(2);   // she recurs…
        expect(godparentLeads(data)).toEqual([]);               // …but not a lead
    });

    it('keeps the stranger who keeps turning up — that IS the lead', () => {
        const data = tree(
            baptised(person('a', 'Jan', 'Novak'), [{ name: 'Marie Dvořáková' }]),
            baptised(person('b', 'Petr', 'Novak'), [{ name: 'Marie Dvořáková' }]),
        );
        const [lead] = godparentLeads(data);
        expect(lead.name).toBe('Marie Dvořáková');
        expect(lead.alreadyRelated).toBe(false);
    });

    it('has nothing to say about a tree with no godparents at all', () => {
        expect(godparentLeads(tree(person('a', 'Jan', 'Novak')))).toEqual([]);
        expect(godparentLeads({ persons: {}, partnerships: {} })).toEqual([]);
    });
});
