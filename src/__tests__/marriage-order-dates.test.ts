/**
 * The marriage order without a wedding date (T50, T13) and the birth order
 * of the names in the siblings' and children's bubbles (T49).
 * Invented families.
 */

import { describe, it, expect } from 'vitest';
import { marriagesInOrder, unionSummaries, compareMarriages, inBirthOrder, siblingGroups, childrenByUnion } from '../marriage-order.js';
import { normalizeDateInput } from '../dates.js';
import { StromData, Person, PersonId, PartnershipId, Partnership } from '../types.js';

const P = (id: string) => id as PersonId;
const U = (id: string) => id as PartnershipId;

function builder() {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const person = (id: string, gender: 'male' | 'female', birthDate?: string) => {
        persons[id] = { id: P(id), firstName: id, lastName: 'Pine', gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...(birthDate ? { birthDate } : {}) };
    };
    const union = (id: string, a: string, b: string, over: Partial<Partnership>, kids: string[] = []) => {
        partnerships[id] = { id: U(id), person1Id: P(a), person2Id: P(b), childIds: kids.map(P), status: 'married', ...over };
        persons[a].partnerships.push(U(id));
        persons[b].partnerships.push(U(id));
        for (const k of kids) {
            persons[k].parentIds.push(P(a), P(b));
            persons[a].childIds.push(P(k));
            persons[b].childIds.push(P(k));
        }
    };
    const data = () => ({ persons, partnerships } as unknown as StromData);
    return { person, union, data, persons, partnerships };
}

describe('the marriage order without a wedding date (T50, T13)', () => {
    it('a divorce bounds the wedding: a union divorced before 2010 comes before a wedding in 2012', () => {
        const b = builder();
        b.person('Paul', 'male', '1960'); b.person('Stella', 'female', '1956'); b.person('Xenia', 'female');
        // Data order: the 2012 wedding first, the earlier union (divorce only) second.
        b.union('u_stella', 'Paul', 'Stella', { startDate: '2012-08-18' });
        b.union('u_xenia', 'Paul', 'Xenia', { status: 'divorced', endDate: '<2010' });
        expect(marriagesInOrder(b.data(), P('Paul'))).toEqual(['u_xenia', 'u_stella']);
        // An exact divorce date too, and the pill numbers follow.
        b.partnerships.u_xenia.endDate = '2011-03-02';
        expect(marriagesInOrder(b.data(), P('Paul'))).toEqual(['u_xenia', 'u_stella']);
        expect(unionSummaries(b.data(), P('Paul')).unions.map(u => [u.partnerId, u.number]))
            .toEqual([['Xenia', 1], ['Stella', 2]]);
    });

    it('a divorce "before 1982" comes before a wedding "about 1982" (and "cca 1982")', () => {
        const b = builder();
        b.person('Tom', 'male'); b.person('Eliza', 'female'); b.person('Judith', 'female');
        b.union('u_judith', 'Tom', 'Judith', { startDate: normalizeDateInput('kolem 1982', 'cs')! });
        b.union('u_eliza', 'Tom', 'Eliza', { status: 'divorced', endDate: normalizeDateInput('před 1982', 'cs')! });
        expect(b.partnerships.u_judith.startDate).toBe('~1982');
        expect(b.partnerships.u_eliza.endDate).toBe('<1982');
        expect(marriagesInOrder(b.data(), P('Tom'))).toEqual(['u_eliza', 'u_judith']);
        b.partnerships.u_judith.startDate = normalizeDateInput('cca 1982', 'cs')!;
        expect(marriagesInOrder(b.data(), P('Tom'))).toEqual(['u_eliza', 'u_judith']);
        // A plain 1982 wedding too; an earlier year stays earlier than the bound.
        b.partnerships.u_judith.startDate = '1982';
        expect(marriagesInOrder(b.data(), P('Tom'))).toEqual(['u_eliza', 'u_judith']);
        b.partnerships.u_judith.startDate = '1981-12-31';
        expect(marriagesInOrder(b.data(), P('Tom'))).toEqual(['u_judith', 'u_eliza']);
    });

    it('a wedding "before 1982" is a bound as well: before a wedding in 1982, after 1981', () => {
        expect(compareMarriages({ startDate: '<1982', index: 1 }, { startDate: '1982', index: 0 })).toBeLessThan(0);
        expect(compareMarriages({ startDate: '<1982', index: 1 }, { startDate: '~1982', index: 0 })).toBeLessThan(0);
        expect(compareMarriages({ startDate: '<1982', index: 0 }, { startDate: '1981', index: 1 })).toBeGreaterThan(0);
        // A wedding "before 1982" and a divorce "before 1982": the data order.
        expect(compareMarriages({ startDate: '<1982', index: 1 }, { endDate: '<1982', index: 0 })).toBeGreaterThan(0);
    });

    it('without a wedding or a divorce: by the birth of the union\'s first child', () => {
        // Three partners, no dates of the unions; the children: Sarah 1999
        // (Dana), Nicole 2010 and Jerome 2011 (Margaret), Matthew 2008
        // (Gabrielle). Data order: Margaret, Dana, Gabrielle.
        const b = builder();
        b.person('George', 'male', '1970');
        b.person('Margaret', 'female'); b.person('Dana', 'female'); b.person('Gabrielle', 'female');
        b.person('Nicole', 'female', '2010-09-03'); b.person('Jerome', 'male', '2011-02-21');
        b.person('Sarah', 'female', '1999-11-07'); b.person('Matthew', 'male', '2008-07-25');
        b.union('u_margaret', 'George', 'Margaret', {}, ['Jerome', 'Nicole']);
        b.union('u_dana', 'George', 'Dana', {}, ['Sarah']);
        b.union('u_gabrielle', 'George', 'Gabrielle', {}, ['Matthew']);
        expect(marriagesInOrder(b.data(), P('George'))).toEqual(['u_dana', 'u_gabrielle', 'u_margaret']);
        // Sarah's birth unknown: Dana's union has no date left and goes last.
        delete b.persons.Sarah.birthDate;
        expect(marriagesInOrder(b.data(), P('George'))).toEqual(['u_gabrielle', 'u_margaret', 'u_dana']);
    });

    it('the earlier of the divorce and the first child bounds it; nothing at all: last, in data order', () => {
        const b = builder();
        b.person('Hugo', 'male');
        for (const w of ['W1', 'W2', 'W3', 'W4']) b.person(w, 'female');
        b.person('k1', 'male', '1990');
        b.union('u1', 'Hugo', 'W1', {});
        b.union('u2', 'Hugo', 'W2', { startDate: '1995' });
        b.union('u3', 'Hugo', 'W3', { status: 'divorced', endDate: '2005' }, ['k1']);
        b.union('u4', 'Hugo', 'W4', {});
        expect(marriagesInOrder(b.data(), P('Hugo'))).toEqual(['u3', 'u2', 'u1', 'u4']);
    });
});

describe('names in the bubbles by birth (T49)', () => {
    function family() {
        const b = builder();
        b.person('Father', 'male', '1740'); b.person('Mother', 'female', '1745'); b.person('Second', 'female', '1750');
        // The data order of the children is not their birth order (as GEDCOM files often have it).
        b.person('Anne', 'female', '1778'); b.person('Kate', 'female', '1782'); b.person('John', 'male', '1776');
        b.person('Vince', 'male', '1789'); b.person('George', 'male', '~1786'); b.person('Mary', 'female', '1780-05');
        b.person('Nobody', 'female'); b.person('Magda', 'female', '1774');
        b.person('Half2', 'male', '1797'); b.person('Half1', 'female', '<1795');
        b.union('u_main', 'Father', 'Mother', { startDate: '1772' },
            ['John', 'Vince', 'Nobody', 'George', 'Kate', 'Mary', 'Anne', 'Magda']);
        b.union('u_second', 'Father', 'Second', { startDate: '1794' }, ['Half2', 'Half1']);
        return b.data();
    }

    it('inBirthOrder: year, month and day where known; "about" as the year; no date last, stably', () => {
        const data = family();
        const persons = data.persons as Record<string, Person>;
        persons.Mary.birthDate = '1780';
        persons.Kate.birthDate = '1780-05-02';
        persons.Anne.birthDate = '~1780';
        expect(inBirthOrder(data, [P('Nobody'), P('Kate'), P('Mary'), P('Anne'), P('Magda')]))
            .toEqual(['Magda', 'Mary', 'Anne', 'Kate', 'Nobody']);
        persons.John.birthDate = undefined;
        expect(inBirthOrder(data, [P('John'), P('Nobody'), P('Magda')])).toEqual(['Magda', 'John', 'Nobody']);
    });

    it('the siblings\' bubble lists each group by birth', () => {
        const data = family();
        const ids = ['John', 'Vince', 'Nobody', 'George', 'Kate', 'Mary', 'Anne', 'Magda', 'Half2', 'Half1'].map(P);
        expect(siblingGroups(data, P('Kate'), ids.filter(id => id !== 'Kate'))).toEqual([
            { full: true, parentId: null, partnerId: null,
                ids: ['Magda', 'John', 'Anne', 'Mary', 'George', 'Vince', 'Nobody'] },
            { full: false, parentId: 'Father', partnerId: 'Second', ids: ['Half1', 'Half2'] },
        ]);
    });

    it('the children\'s bubble lists each marriage\'s children by birth', () => {
        const data = family();
        const ids = ['Half2', 'John', 'Vince', 'Nobody', 'George', 'Kate', 'Half1', 'Mary', 'Anne', 'Magda'].map(P);
        expect(childrenByUnion(data, P('Father'), ids).map(g => g.ids)).toEqual([
            ['Magda', 'John', 'Anne', 'Mary', 'Kate', 'George', 'Vince', 'Nobody'],
            ['Half1', 'Half2'],
        ]);
    });
});
