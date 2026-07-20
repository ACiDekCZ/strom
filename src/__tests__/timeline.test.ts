/**
 * Timeline view model (pure). Fixed injected `todayYear`.
 */

import { describe, it, expect } from 'vitest';
import { computeTimelineModel, yearToFraction, axisTicks } from '../timeline.js';
import { StromData, PersonId, PartnershipId, Person, Partnership, Gender, LifeEvent } from '../types.js';

interface POpts {
    birthDate?: string; deathDate?: string; events?: LifeEvent[]; partnerships?: string[]; isPlaceholder?: boolean;
}
function person(id: string, first: string, gender: Gender, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'X', gender, isPlaceholder: o.isPlaceholder ?? false,
        parentIds: [], childIds: [], partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.events ? { events: o.events } : {}),
    };
}
function data(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}
const ids = (d: StromData) => Object.keys(d.persons);

const TODAY_YEAR = 2026;

describe('computeTimelineModel', () => {
    it('orders rows by birth year and rounds the axis to decades', () => {
        const a = person('a', 'Old', 'male', { birthDate: '1883', deathDate: '1947' });
        const b = person('b', 'Young', 'female', { birthDate: '1902', deathDate: '1975' });
        const d = data([b, a]);
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
        expect(model.rows.map(r => r.personId)).toEqual(['a', 'b']);
        expect(model.axis).toEqual({ minYear: 1880, maxYear: 1980 });
    });

    it('omits persons without a birth year and counts them', () => {
        const a = person('a', 'Has', 'male', { birthDate: '1900', deathDate: '1960' });
        const b = person('b', 'None', 'male', {});
        const c = person('c', 'YearOnlyMissing', 'male', { birthDate: 'about' }); // unparseable
        const d = data([a, b, c]);
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
        expect(model.rows).toHaveLength(1);
        expect(model.omittedCount).toBe(2);
    });

    it('runs a living person\'s bar to today', () => {
        const a = person('a', 'Alive', 'female', { birthDate: '1990' });
        const d = data([a]);
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
        expect(model.rows[0]).toMatchObject({ startYear: 1990, endYear: TODAY_YEAR, isLiving: true });
    });

    it('collects life events and wedding dots, sorted by year', () => {
        const ev: LifeEvent = { id: 'e1', type: 'occupation', date: '1925' };
        const a = person('a', 'A', 'male', { birthDate: '1900', deathDate: '1970', events: [ev], partnerships: ['u1'] });
        const b = person('b', 'B', 'female', { birthDate: '1905', deathDate: '1980', partnerships: ['u1'] });
        const u1: Partnership = {
            id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
            childIds: [], status: 'married', startDate: '1923',
        };
        const d = data([a, b], [u1]);
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
        const rowA = model.rows.find(r => r.personId === 'a')!;
        expect(rowA.events.map(e => `${e.type}:${e.year}`)).toEqual(['wedding:1923', 'occupation:1925']);
    });

    it('ignores placeholders', () => {
        const a = person('a', 'Real', 'male', { birthDate: '1900' });
        const ph = person('ph', 'Ghost', 'male', { birthDate: '1900', isPlaceholder: true });
        const d = data([a, ph]);
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR).rows).toHaveLength(1);
    });
});

describe('yearToFraction / axisTicks', () => {
    const axis = { minYear: 1900, maxYear: 2000 };
    it('maps years to a 0..1 fraction, clamped', () => {
        expect(yearToFraction(1900, axis)).toBe(0);
        expect(yearToFraction(1950, axis)).toBeCloseTo(0.5, 6);
        expect(yearToFraction(2000, axis)).toBe(1);
        expect(yearToFraction(1850, axis)).toBe(0);   // clamped low
        expect(yearToFraction(2100, axis)).toBe(1);   // clamped high
    });
    it('returns 0 for a zero-span axis', () => {
        expect(yearToFraction(1900, { minYear: 1900, maxYear: 1900 })).toBe(0);
    });
    it('lists decade ticks inclusive of both ends', () => {
        expect(axisTicks(axis)).toEqual([1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000]);
    });
});

it('a deceased person without a death date gets a stub, not a bar to today', () => {
    const d = data([person('p1', 'Biagota', 'female', { birthDate: '920' })]);
    const model = computeTimelineModel(d, ['p1'], TODAY_YEAR);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].isLiving).toBe(false);
    expect(model.rows[0].endKnown).toBe(false);
    expect(model.rows[0].endYear).toBe(920); // stub at birth year, no invented span
});

it('an unknown-death bar extends to the last known event (wedding)', () => {
    const a = person('a', 'Boleslav', 'male', { birthDate: '915', partnerships: ['u1'] });
    const b = person('b', 'Biagota', 'female', { birthDate: '920', partnerships: ['u1'] });
    const u1: Partnership = {
        id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
        childIds: [], status: 'married', startDate: '945',
    };
    const d = data([a, b], [u1]);
    const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
    const rowB = model.rows.find(r => r.personId === 'b')!;
    expect(rowB.endKnown).toBe(false);
    expect(rowB.endYear).toBe(945); // wedding is the last trace of her life
});

// ==================== computePersonLifeline (R2) ====================

import { computePersonLifeline } from '../timeline.js';

/** Full person builder covering the fields the lifeline reads. */
function lp(id: string, first: string, gender: Gender, o: {
    birthDate?: string; birthPlace?: string; deathDate?: string; deathPlace?: string;
    events?: LifeEvent[]; partnerships?: string[]; childIds?: string[]; photo?: string; isPlaceholder?: boolean;
} = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'Novák', gender, isPlaceholder: o.isPlaceholder ?? false,
        parentIds: [], childIds: (o.childIds ?? []) as PersonId[], partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.birthPlace ? { birthPlace: o.birthPlace } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.deathPlace ? { deathPlace: o.deathPlace } : {}),
        ...(o.events ? { events: o.events } : {}),
        ...(o.photo ? { photo: o.photo } : {}),
    };
}

describe('computePersonLifeline', () => {
    it('orders birth first, death last, events chronologically between', () => {
        const child = lp('c', 'Josef', 'male', { birthDate: '1905' });
        const p = lp('p', 'Jan', 'male', {
            birthDate: '1880', birthPlace: 'Děčín', deathDate: '1950',
            partnerships: ['u1'], childIds: ['c'],
            events: [{ id: 'e1', type: 'baptism', date: '1880-03-05' } as LifeEvent],
        });
        const spouse = lp('s', 'Marie', 'female', { birthDate: '1884' });
        const u1: Partnership = {
            id: 'u1' as PartnershipId, person1Id: 'p' as PersonId, person2Id: 's' as PersonId,
            childIds: ['c'] as PersonId[], status: 'married', startDate: '1903',
        };
        const d = data([p, spouse, child], [u1]);
        const pts = computePersonLifeline(d, 'p');
        expect(pts.map(x => x.kind)).toEqual(['birth', 'event', 'marriage', 'child', 'death']);
        expect(pts[0].year).toBe(1880);
        expect(pts[pts.length - 1].year).toBe(1950);
        // Marriage names the other partner; child names the child.
        expect(pts.find(x => x.kind === 'marriage')!.relatedName).toBe('Marie Novák');
        expect(pts.find(x => x.kind === 'child')!.relatedName).toBe('Josef Novák');
    });

    it('carries event participants and places', () => {
        const p = lp('p', 'Anna', 'female', {
            birthDate: '1870', deathDate: '1930',
            events: [{ id: 'e1', type: 'baptism', date: '1870', place: 'Praha',
                participants: [{ id: 'g1', role: 'godparent', name: 'Eva Kmotra' }] } as LifeEvent],
        });
        const d = data([p]);
        const pts = computePersonLifeline(d, 'p');
        const ev = pts.find(x => x.kind === 'event')!;
        expect(ev.participants).toEqual(['Eva Kmotra']);
        expect(ev.place).toBe('Praha');
    });

    it('returns empty for placeholders and skips undated points', () => {
        const p = lp('p', 'Ghost', 'male', { isPlaceholder: true });
        expect(computePersonLifeline(data([p]), 'p')).toEqual([]);
        // Only a birth date → a single point (caller hides the section under 2).
        const solo = lp('q', 'Solo', 'male', { birthDate: '1900' });
        expect(computePersonLifeline(data([solo]), 'q')).toHaveLength(1);
    });
});
