/**
 * Family statistics (pure computations). Uses small synthetic fixtures with
 * known dates/generations so the numbers can be asserted exactly.
 */

import { describe, it, expect } from 'vitest';
import { computeFamilyStats } from '../stats.js';
import { StromData, PersonId, PartnershipId, Person, Partnership, Gender } from '../types.js';

interface POpts {
    birthDate?: string; deathDate?: string;
    parentIds?: string[]; childIds?: string[]; partnerships?: string[];
    isPlaceholder?: boolean;
}
function p(id: string, first: string, last: string, gender: Gender, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender,
        isPlaceholder: o.isPlaceholder ?? false,
        parentIds: (o.parentIds ?? []) as PersonId[],
        childIds: (o.childIds ?? []) as PersonId[],
        partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
    };
}
function union(id: string, p1: string, p2: string, kids: string[], extra: Partial<Partnership> = {}): Partnership {
    return {
        id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId,
        childIds: kids as PersonId[], status: 'married', ...extra,
    };
}
function data(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(x => [x.id, x])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(x => [x.id, x])) as StromData['partnerships'],
    };
}

describe('computeFamilyStats — lifespan by generation', () => {
    it('averages ages within each generation and reports N', () => {
        // Gen 0: grandparents (lived 80 and 70 → avg 75). Gen 1: parent (lived 60).
        const gp1 = p('gp1', 'A', 'X', 'male', { birthDate: '1900', deathDate: '1980', childIds: ['par'] });
        const gp2 = p('gp2', 'B', 'X', 'female', { birthDate: '1900', deathDate: '1970', partnerships: ['u1'] });
        const par = p('par', 'C', 'X', 'male', { birthDate: '1930', deathDate: '1990', parentIds: ['gp1'] });
        const d = data([gp1, gp2, par]);
        const stats = computeFamilyStats(d);

        const gen0 = stats.lifespanByGen.find(g => g.generation === 0)!;
        expect(gen0.n).toBe(2);
        expect(gen0.avgYears).toBe(75);
        const gen1 = stats.lifespanByGen.find(g => g.generation === 1)!;
        expect(gen1.n).toBe(1);
        expect(gen1.avgYears).toBe(60);

        // Longest-lived person is the 80-year-old.
        expect(stats.oldest).toEqual({ name: 'A X', years: 80 });
    });

    it('skips persons missing a birth or death date', () => {
        const a = p('a', 'A', 'X', 'male', { birthDate: '1900', deathDate: '1980' });
        const b = p('b', 'B', 'X', 'male', { birthDate: '1900' });           // no death
        const c = p('c', 'C', 'X', 'male', { deathDate: '1980' });           // no birth
        const stats = computeFamilyStats(data([a, b, c]));
        const gen0 = stats.lifespanByGen.find(g => g.generation === 0)!;
        expect(gen0.n).toBe(1);
    });
});

describe('computeFamilyStats — top names (diacritics preserved)', () => {
    it('counts by exact first name and orders by frequency then alphabetically', () => {
        const persons = [
            p('1', 'František', 'A', 'male'),
            p('2', 'František', 'B', 'male'),
            p('3', 'Josef', 'C', 'male'),
            p('4', 'Anna', 'D', 'female'),
            p('5', 'Anna', 'E', 'female'),
            p('6', 'Božena', 'F', 'female'),
        ];
        const stats = computeFamilyStats(data(persons));
        expect(stats.topMaleNames[0]).toEqual({ name: 'František', count: 2 });
        expect(stats.topMaleNames[1]).toEqual({ name: 'Josef', count: 1 });
        expect(stats.topFemaleNames[0]).toEqual({ name: 'Anna', count: 2 });
        expect(stats.topFemaleNames.map(n => n.name)).toContain('Božena');
    });

    it('ignores placeholders and blank names', () => {
        const persons = [
            p('1', 'Jan', 'A', 'male'),
            p('2', '', 'B', 'male'),
            p('3', 'Ghost', 'C', 'male', { isPlaceholder: true }),
        ];
        const stats = computeFamilyStats(data(persons));
        expect(stats.topMaleNames).toEqual([{ name: 'Jan', count: 1 }]);
    });
});

describe('computeFamilyStats — children per couple and births by month', () => {
    it('averages children per couple by generation', () => {
        const a = p('a', 'A', 'X', 'male', { partnerships: ['u1'], childIds: ['k1', 'k2'] });
        const b = p('b', 'B', 'Y', 'female', { partnerships: ['u1'] });
        const k1 = p('k1', 'K1', 'X', 'male', { parentIds: ['a'] });
        const k2 = p('k2', 'K2', 'X', 'female', { parentIds: ['a'] });
        const stats = computeFamilyStats(data([a, b, k1, k2], [union('u1', 'a', 'b', ['k1', 'k2'])]));
        const gen0 = stats.childrenByGen.find(g => g.generation === 0)!;
        expect(gen0).toEqual({ generation: 0, avgChildren: 2, n: 1 });
    });

    it('buckets births by month only for dated persons', () => {
        const persons = [
            p('1', 'A', 'X', 'male', { birthDate: '1900-03-15' }),
            p('2', 'B', 'X', 'male', { birthDate: '1901-03-02' }),
            p('3', 'C', 'X', 'male', { birthDate: '1902-12' }),
            p('4', 'D', 'X', 'male', { birthDate: '1903' }),          // year only → skipped
            p('5', 'E', 'X', 'male', {}),                            // no date → skipped
        ];
        const stats = computeFamilyStats(data(persons));
        expect(stats.birthsByMonthN).toBe(3);
        expect(stats.birthsByMonth[2].count).toBe(2);   // March
        expect(stats.birthsByMonth[11].count).toBe(1);  // December
        expect(stats.birthsByMonth).toHaveLength(12);
    });
});

describe('computeFamilyStats — longest marriage and empty states', () => {
    it('picks the longest documented marriage', () => {
        const a = p('a', 'A', 'X', 'male', { partnerships: ['u1'] });
        const b = p('b', 'B', 'Y', 'female', { partnerships: ['u1'] });
        const c = p('c', 'C', 'X', 'male', { partnerships: ['u2'] });
        const dd = p('d', 'D', 'Z', 'female', { partnerships: ['u2'] });
        const u1 = union('u1', 'a', 'b', [], { startDate: '1920', endDate: '1965' }); // 45
        const u2 = union('u2', 'c', 'd', [], { startDate: '1950', endDate: '1960' }); // 10
        const stats = computeFamilyStats(data([a, b, c, dd], [u1, u2]));
        expect(stats.longestMarriage).toEqual({ names: 'A X & B Y', years: 45 });
    });

    it('returns empty results for an empty tree', () => {
        const stats = computeFamilyStats(data([]));
        expect(stats.topMaleNames).toEqual([]);
        expect(stats.lifespanByGen).toEqual([]);
        expect(stats.childrenByGen).toEqual([]);
        expect(stats.birthsByMonthN).toBe(0);
        expect(stats.oldest).toBeNull();
        expect(stats.longestMarriage).toBeNull();
    });
});

// ==================== computeCompleteness (R4) ====================

import { computeCompleteness } from '../stats.js';

describe('computeCompleteness', () => {
    it('counts real persons carrying each fact and ignores placeholders', () => {
        const full: Person = {
            id: 'a' as PersonId, firstName: 'Jan', lastName: 'N', gender: 'male', isPlaceholder: false,
            parentIds: [], childIds: [], partnerships: [],
            birthDate: '1880', birthPlace: 'Děčín', deathDate: '1950', photo: 'data:image/png;base64,xx',
        };
        const partial: Person = {
            id: 'b' as PersonId, firstName: 'Eva', lastName: 'N', gender: 'female', isPlaceholder: false,
            parentIds: [], childIds: [], partnerships: [], birthDate: '1884',
        };
        const ghost: Person = {
            id: 'c' as PersonId, firstName: '', lastName: '', gender: 'male', isPlaceholder: true,
            parentIds: [], childIds: [], partnerships: [], birthDate: '1800', birthPlace: 'X', photo: 'data:x',
        };
        const d: StromData = {
            persons: { a: full, b: partial, c: ghost } as StromData['persons'],
            partnerships: {} as StromData['partnerships'],
        };
        const r = computeCompleteness(d);
        expect(r.total).toBe(2);            // placeholder excluded
        expect(r.withBirthDate).toBe(2);
        expect(r.withBirthPlace).toBe(1);
        expect(r.withDeathDate).toBe(1);
        expect(r.withPhoto).toBe(1);
    });

    it('is all zero for an empty tree', () => {
        const d: StromData = { persons: {} as StromData['persons'], partnerships: {} as StromData['partnerships'] };
        expect(computeCompleteness(d)).toEqual({ total: 0, withBirthDate: 0, withBirthPlace: 0, withDeathDate: 0, withPhoto: 0 });
    });
});
