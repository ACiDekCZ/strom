/**
 * Anniversaries and "on this day" — pure, with a fixed injected `today`.
 */

import { describe, it, expect } from 'vitest';
import { upcomingAnniversaries, onThisDay } from '../anniversaries.js';
import { StromData, PersonId, PartnershipId, Person, Partnership, Gender } from '../types.js';

interface POpts {
    birthDate?: string; deathDate?: string; isDeceased?: boolean; partnerships?: string[];
}
function person(id: string, first: string, gender: Gender, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'Test', gender, isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.isDeceased !== undefined ? { isDeceased: o.isDeceased } : {}),
    };
}
function union(id: string, p1: string, p2: string, startDate?: string): Partnership {
    return {
        id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId,
        childIds: [], status: 'married', ...(startDate ? { startDate } : {}),
    };
}
function data(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}

const TODAY = new Date(2026, 5, 15);  // 15 June 2026 (month is 0-based)

describe('upcomingAnniversaries', () => {
    it('includes a living person\'s birthday tomorrow with the age they turn', () => {
        const p = person('a', 'Anna', 'female', { birthDate: '1990-06-16' });
        const res = upcomingAnniversaries(data([p]), TODAY);
        expect(res).toHaveLength(1);
        expect(res[0]).toMatchObject({ type: 'birthday', personIds: ['a'], years: 36, daysUntil: 1 });
    });

    it('includes a living couple\'s wedding anniversary', () => {
        const h = person('h', 'Jan', 'male', { birthDate: '1988-01-01', partnerships: ['u1'] });
        const w = person('w', 'Eva', 'female', { birthDate: '1990-01-01', partnerships: ['u1'] });
        const res = upcomingAnniversaries(data([h, w], [union('u1', 'h', 'w', '2010-06-20')]), TODAY);
        const wedding = res.find(r => r.type === 'wedding');
        expect(wedding).toMatchObject({ years: 16, personIds: ['h', 'w'], daysUntil: 5 });
    });

    it('includes a round birth milestone of a deceased person, not an off-round one', () => {
        const round = person('r', 'Karel', 'male', { birthDate: '1926-06-20', deathDate: '1990' });   // turns 100
        const offRound = person('o', 'Josef', 'male', { birthDate: '1930-06-20', deathDate: '1995' }); // 96, skipped
        const res = upcomingAnniversaries(data([round, offRound]), TODAY);
        const milestones = res.filter(r => r.type === 'birth-milestone');
        expect(milestones).toHaveLength(1);
        expect(milestones[0]).toMatchObject({ personIds: ['r'], years: 100 });
    });

    it('skips year-only flex dates (no month/day)', () => {
        const p = person('a', 'Anna', 'female', { birthDate: '1990' });
        expect(upcomingAnniversaries(data([p]), TODAY)).toHaveLength(0);
    });

    it('sorts by soonest first', () => {
        const soon = person('s', 'Soon', 'male', { birthDate: '2000-06-16' });
        const later = person('l', 'Later', 'male', { birthDate: '2000-07-01' });
        const res = upcomingAnniversaries(data([later, soon]), TODAY);
        expect(res.map(r => r.personIds[0])).toEqual(['s', 'l']);
    });

    it('wraps across the year boundary within the horizon', () => {
        const nye = new Date(2026, 11, 29);  // 29 Dec 2026
        const p = person('a', 'Anna', 'female', { birthDate: '1990-01-05' });
        const res = upcomingAnniversaries(data([p]), nye, 30);
        expect(res).toHaveLength(1);
        expect(res[0].daysUntil).toBe(7);
        expect(res[0].date.getFullYear()).toBe(2027);
    });

    it('respects the horizon (birthday beyond it is excluded)', () => {
        const p = person('a', 'Anna', 'female', { birthDate: '1990-08-01' });  // ~47 days out
        expect(upcomingAnniversaries(data([p]), TODAY, 30)).toHaveLength(0);
    });
});

describe('onThisDay', () => {
    it('returns births/deaths/weddings exactly on today\'s month and day', () => {
        const born = person('b', 'Old', 'male', { birthDate: '1900-06-15', deathDate: '1980-01-01' });
        const other = person('x', 'Nope', 'male', { birthDate: '1900-06-16' });
        const res = onThisDay(data([born, other]), TODAY);
        expect(res).toHaveLength(1);
        expect(res[0]).toMatchObject({ type: 'birth', personIds: ['b'], years: 126 });
    });

    it('returns nothing when no event matches the day', () => {
        const p = person('a', 'Anna', 'female', { birthDate: '1990-01-05' });
        expect(onThisDay(data([p]), TODAY)).toHaveLength(0);
    });
});
