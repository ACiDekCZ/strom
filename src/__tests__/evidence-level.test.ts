/**
 * The three evidence levels a card shows (none / partial / full) and whether
 * a tree has any source at all. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { evidenceLevel, personEvidence, treeHasAnySource } from '../evidence-level.js';
import { StromData, Person, PersonId, PartnershipId, toPersonId, toPartnershipId } from '../types.js';

function person(pid: string, extra: Partial<Person> = {}): Person {
    return {
        id: toPersonId(pid), firstName: pid, lastName: 'Dvořák', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}

function data(persons: Person[], unions: StromData['partnerships'][PartnershipId][] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as Record<PersonId, Person>,
        partnerships: Object.fromEntries(unions.map(u => [u.id, u])) as StromData['partnerships'],
    } as StromData;
}

const level = (p: Person, extra: Person[] = [], unions: StromData['partnerships'][PartnershipId][] = []) =>
    evidenceLevel(p, data([p, ...extra], unions));

describe('evidence level', () => {
    it('none: nothing cited', () => {
        expect(level(person('a', { birthDate: '1870' }))).toBe('none');
    });

    it('partial: only the marriage is cited', () => {
        const u = { id: toPartnershipId('u1'), person1Id: toPersonId('a'), person2Id: toPersonId('b'), childIds: [], sourceIds: ['s1'] };
        const a = person('a', { partnerships: [u.id], birthDate: '1870' });
        expect(level(a, [person('b', { partnerships: [u.id] })], [u as never])).toBe('partial');
    });

    it('partial: an occupation is cited, the birth is not', () => {
        expect(level(person('a', { birthDate: '1870', events: [{ id: 'e', type: 'occupation', sourceIds: ['s1'] }] }))).toBe('partial');
    });

    it('full: a cited baptism without any birth field', () => {
        expect(level(person('a', { events: [{ id: 'e', type: 'baptism', date: '1871', sourceIds: ['s1'] }] }))).toBe('full');
    });

    it('full needs the death cited only when there is a death', () => {
        const baptised = { id: 'e', type: 'baptism' as const, sourceIds: ['s1'] };
        expect(level(person('a', { events: [baptised], deathDate: '1930' }))).toBe('partial');
        expect(level(person('a', { events: [baptised, { id: 'b', type: 'burial', sourceIds: ['s2'] }], deathDate: '1930' }))).toBe('full');
        expect(level(person('a', { events: [baptised, { id: 'b', type: 'burial' }] }))).toBe('partial');
    });

    it('a source on the person counts for birth and death (the BIRT / DEAT citations land there)', () => {
        const ev = personEvidence(person('a', { sourceIds: ['s1', 's2'], birthDate: '1865', deathDate: '1930', events: [{ id: 'e', type: 'occupation', sourceIds: ['s2', 's3'] }] }), data([]));
        expect(ev).toMatchObject({ level: 'full', sources: 3, birthCited: true, hasDeath: true, deathCited: true });
    });

    it('no birth in the data: a source on the person documents no birth (partial)', () => {
        const ev = personEvidence(person('a', { sourceIds: ['s1'] }), data([]));
        expect(ev).toMatchObject({ level: 'partial', sources: 1, hasBirth: false, birthCited: false });
        // A birth place is a birth too.
        expect(level(person('b', { sourceIds: ['s1'], birthPlace: 'Chlumy' }))).toBe('full');
    });

    it('a placeholder has no level', () => {
        expect(level(person('a', { isPlaceholder: true, sourceIds: ['s1'] }))).toBeNull();
    });

    it('treeHasAnySource: person, event or union citations; placeholders do not count', () => {
        expect(treeHasAnySource(data([person('a'), person('p', { isPlaceholder: true, sourceIds: ['s1'] })]))).toBe(false);
        expect(treeHasAnySource(data([person('a', { events: [{ id: 'e', type: 'burial', sourceIds: ['s1'] }] })]))).toBe(true);
        const u = { id: toPartnershipId('u1'), person1Id: toPersonId('a'), person2Id: toPersonId('b'), childIds: [], sourceIds: ['s1'] };
        expect(treeHasAnySource(data([person('a'), person('b')], [u as never]))).toBe(true);
    });
});
