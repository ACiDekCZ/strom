/**
 * Finding the separate families in one tree (src/components.ts).
 *
 * The rule under test: a component is everyone reachable over parent, child or
 * partner links. Getting that wrong in either direction is bad — miss an edge
 * and the split would tear a family apart; add one and it would refuse to split
 * families that really are separate.
 */

import { describe, it, expect } from 'vitest';
import { findComponents } from '../components.js';
import { StromData, Person, PersonId, PartnershipId, toPersonId, toPartnershipId } from '../types.js';

function person(id: string, firstName: string, lastName: string, birthDate?: string): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        ...(birthDate ? { birthDate } : {}),
    };
}

/** Minimal builder: persons, then links, so each test reads as a family shape. */
function tree(...people: Person[]): StromData {
    const persons: Record<PersonId, Person> = {};
    for (const p of people) persons[p.id] = p;
    return { persons, partnerships: {} };
}

function marry(data: StromData, a: string, b: string, unionId = 'u1'): PartnershipId {
    const id = toPartnershipId(unionId);
    data.partnerships[id] = {
        id, person1Id: toPersonId(a), person2Id: toPersonId(b), childIds: [], status: 'married',
    };
    data.persons[toPersonId(a)].partnerships.push(id);
    data.persons[toPersonId(b)].partnerships.push(id);
    return id;
}

function child(data: StromData, unionId: string, parentA: string, parentB: string, kid: string): void {
    const union = data.partnerships[toPartnershipId(unionId)];
    union.childIds.push(toPersonId(kid));
    data.persons[toPersonId(kid)].parentIds = [toPersonId(parentA), toPersonId(parentB)];
    data.persons[toPersonId(parentA)].childIds.push(toPersonId(kid));
    data.persons[toPersonId(parentB)].childIds.push(toPersonId(kid));
}

describe('findComponents', () => {
    it('sees one family as one family', () => {
        const data = tree(person('a', 'Jan', 'Novak'), person('b', 'Marie', 'Novakova'),
            person('c', 'Petr', 'Novak'));
        marry(data, 'a', 'b');
        child(data, 'u1', 'a', 'b', 'c');

        const found = findComponents(data);
        expect(found).toHaveLength(1);
        expect(found[0].count).toBe(3);
    });

    it('separates families that share nothing', () => {
        const data = tree(person('a', 'Jan', 'Novak'), person('b', 'Marie', 'Novakova'),
            person('x', 'Josef', 'Svoboda'), person('y', 'Anna', 'Svobodova'));
        marry(data, 'a', 'b', 'u1');
        marry(data, 'x', 'y', 'u2');

        const found = findComponents(data);
        expect(found).toHaveLength(2);
        expect(found.map(c => c.count)).toEqual([2, 2]);
        expect(found.map(c => c.surnames[0]).sort()).toEqual(['Novak', 'Svoboda']);
    });

    it('keeps a childless couple together — a marriage is a link', () => {
        // The obvious way to get this wrong is to walk only parent/child edges,
        // which would cut every childless couple in half.
        const data = tree(person('a', 'Jan', 'Novak'), person('b', 'Marie', 'Novakova'));
        marry(data, 'a', 'b');

        const found = findComponents(data);
        expect(found).toHaveLength(1);
        expect(found[0].count).toBe(2);
    });

    it('joins two families through a marriage between them', () => {
        // My family + my wife's family, joined by our marriage: ONE component.
        // Splitting this would mean duplicating the couple, which is why the
        // split only ever offers families that really are separate.
        const data = tree(
            person('dad', 'Josef', 'Novak'), person('mum', 'Anna', 'Novakova'),
            person('me', 'Jan', 'Novak'), person('wife', 'Eva', 'Svobodova'),
            person('her-dad', 'Karel', 'Svoboda'), person('her-mum', 'Jana', 'Svobodova'),
        );
        marry(data, 'dad', 'mum', 'u1');
        child(data, 'u1', 'dad', 'mum', 'me');
        marry(data, 'her-dad', 'her-mum', 'u2');
        child(data, 'u2', 'her-dad', 'her-mum', 'wife');
        marry(data, 'me', 'wife', 'u3');

        expect(findComponents(data)).toHaveLength(1);
    });

    it('finds the person who is linked to nobody', () => {
        const data = tree(person('a', 'Jan', 'Novak'), person('b', 'Marie', 'Novakova'),
            person('lost', 'Kdo', 'Vi'));
        marry(data, 'a', 'b');

        const found = findComponents(data);
        expect(found).toHaveLength(2);
        expect(found[1].count).toBe(1);
        expect(found[1].surnames).toEqual(['Vi']);
    });

    it('describes a family the way someone would recognise it', () => {
        const data = tree(
            person('a', 'Josef', 'Novak', '1812'),
            person('b', 'Marie', 'Novakova', '1820'),
            person('c', 'Petr', 'Novak', '1845'),
        );
        marry(data, 'a', 'b');
        child(data, 'u1', 'a', 'b', 'c');

        const [family] = findComponents(data);
        expect(family.surnames[0]).toBe('Novak');       // the name it goes by
        expect(family.oldest).toEqual({ name: 'Josef Novak', year: 1812 });
    });

    it('puts the big family first and the strays last', () => {
        const data = tree(person('a', 'Jan', 'Novak'), person('b', 'Marie', 'Novakova'),
            person('c', 'Petr', 'Novak'), person('lost', 'Kdo', 'Vi'));
        marry(data, 'a', 'b');
        child(data, 'u1', 'a', 'b', 'c');

        expect(findComponents(data).map(c => c.count)).toEqual([3, 1]);
    });

    it('does not count placeholders as people', () => {
        const data = tree(person('a', 'Jan', 'Novak'), person('b', 'Marie', 'Novakova'));
        data.persons[toPersonId('b')].isPlaceholder = true;
        marry(data, 'a', 'b');

        const [family] = findComponents(data);
        expect(family.personIds).toHaveLength(2);   // the placeholder still travels
        expect(family.count).toBe(1);              // but nobody would call it two people
    });

    it('has nothing to say about an empty tree', () => {
        expect(findComponents({ persons: {}, partnerships: {} })).toEqual([]);
    });

    it('survives a link pointing at somebody who is gone', () => {
        const data = tree(person('a', 'Jan', 'Novak'));
        data.persons[toPersonId('a')].parentIds = [toPersonId('ghost')];
        expect(findComponents(data)).toHaveLength(1);
    });
});
