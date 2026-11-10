/**
 * The milder age rules of the Data quality check (spec 073 §7.6): a mother
 * under 16 or over 45 and a father under 18 or over 60 at a child's birth,
 * a wedding under 16 and a recorded age more than two years off the dates.
 * All are warnings ("to check"); a range of the age crossing the limit at one
 * end is enough, a stricter type of the same pair wins.
 */

import { describe, it, expect } from 'vitest';
import { validateTreeData, qualityFinding, qualityFindingKey, translateValidationType } from '../validation.js';
import type { StromData, Person, Partnership, PersonId, PartnershipId, Gender } from '../types.js';
import { getStringsForLang } from '../strings.js';

interface POpts {
    birthDate?: string; deathDate?: string; gender?: Gender; parentIds?: string[];
    parentRelTypes?: Record<string, 'biological' | 'adoptive' | 'step' | 'foster'>;
    birthAge?: string; deathAge?: string;
}
function person(id: string, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'Brook', gender: o.gender ?? 'male',
        isPlaceholder: false, parentIds: (o.parentIds ?? []) as PersonId[], childIds: [], partnerships: [],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.birthAge ? { birthAge: o.birthAge } : {}),
        ...(o.deathAge ? { deathAge: o.deathAge } : {}),
        ...(o.parentRelTypes ? { parentRelTypes: o.parentRelTypes as Person['parentRelTypes'] } : {}),
    };
}
function union(id: string, p1: string, p2: string, startDate?: string, ages?: Record<string, string>): Partnership {
    return {
        id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId, childIds: [], status: 'married',
        ...(startDate ? { startDate } : {}), ...(ages ? { ages } : {}),
    };
}
function data(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}
const issues = (d: StromData) => validateTreeData(d).issues;
const types = (d: StromData) => issues(d).map(i => i.type);

/** A parent and a child, the parent's sex and both birth dates given. */
function pair(gender: Gender, parentBirth: string, childBirth: string, rel?: 'adoptive'): StromData {
    return data([
        person('par', { gender, birthDate: parentBirth }),
        person('kid', { birthDate: childBirth, parentIds: ['par'], ...(rel ? { parentRelTypes: { par: rel } } : {}) }),
    ]);
}

describe('parent age limits at a child birth', () => {
    it('reports a mother under 16 and over 45, a father under 18 and over 60', () => {
        expect(types(pair('female', '1900-05-01', '1915-06-01'))).toContain('motherTooYoung16');
        expect(types(pair('female', '1900-05-01', '1946-06-01'))).toContain('motherTooOld45');
        expect(types(pair('male', '1900-05-01', '1917-06-01'))).toContain('fatherTooYoung18');
        expect(types(pair('male', '1900-05-01', '1961-06-01'))).toContain('fatherTooOld60');
    });

    it('keeps quiet at the limits themselves', () => {
        const quiet = ['motherTooYoung16', 'motherTooOld45', 'fatherTooYoung18', 'fatherTooOld60'];
        for (const d of [pair('female', '1900-05-01', '1916-05-01'), pair('female', '1900-05-01', '1945-06-01'),
            pair('male', '1900-05-01', '1918-05-01'), pair('male', '1900-05-01', '1960-06-01')]) {
            expect(types(d).filter(t => quiet.includes(t))).toEqual([]);
        }
    });

    it('reports when one end of the age range crosses the limit', () => {
        // Years only: the mother was 15 or 16.
        expect(types(pair('female', '1900', '1916'))).toContain('motherTooYoung16');
        // 45 or 46.
        expect(types(pair('female', '1900', '1946'))).toContain('motherTooOld45');
    });

    it('does not judge a before or after date', () => {
        expect(types(pair('female', '<1900', '1915'))).not.toContain('motherTooYoung16');
        expect(types(pair('male', '1900', '>1961'))).not.toContain('fatherTooOld60');
    });

    it('leaves a pair a stricter type reported to that type', () => {
        const t = types(pair('female', '1900-05-01', '1910-06-01'));
        expect(t).toContain('parentTooYoung');
        expect(t).not.toContain('motherTooYoung16');
        const old = types(pair('male', '1800', '1890'));
        expect(old).toContain('parentTooOld');
        expect(old).not.toContain('fatherTooOld60');
    });

    it('applies only to a biological parent of known sex', () => {
        expect(types(pair('female', '1900-05-01', '1915-06-01', 'adoptive'))).not.toContain('motherTooYoung16');
        const unknown = data([
            person('par', { gender: 'unknown' as Gender, birthDate: '1900-05-01' }),
            person('kid', { birthDate: '1915-06-01', parentIds: ['par'] }),
        ]);
        expect(types(unknown).some(t => /TooYoung1[68]/.test(t))).toBe(false);
    });

    it('is a warning about the parent and the child, with the ages in the detail', () => {
        const issue = issues(pair('female', '1900-05-01', '1915-06-01')).find(i => i.type === 'motherTooYoung16')!;
        expect(issue.severity).toBe('warning');
        expect(issue.personIds).toEqual(['par', 'kid']);
        expect(issue.field).toBe('birth');
        expect(issue.detail).toBe('* 1900-05-01 → * 1915-06-01: 15');
    });
});

describe('wedding under 16', () => {
    it('reports an age under 16 at the wedding, not 16', () => {
        const d = (wed: string) => data([person('a', { birthDate: '1900-05-01' }), person('b', { gender: 'female' })],
            [union('u', 'a', 'b', wed)]);
        expect(types(d('1915-06-01'))).toContain('marriageUnder16');
        expect(types(d('1916-06-01'))).not.toContain('marriageUnder16');
        // Years only: 15 or 16.
        expect(types(data([person('a', { birthDate: '1900' }), person('b')], [union('u', 'a', 'b', '1916')])))
            .toContain('marriageUnder16');
    });

    it('leaves a wedding under 14 to childMarriage', () => {
        const t = types(data([person('a', { birthDate: '1900-05-01' }), person('b')], [union('u', 'a', 'b', '1912-06-01')]));
        expect(t).toContain('childMarriage');
        expect(t).not.toContain('marriageUnder16');
    });

    it('names the union, the wedding field and its year (a separate finding per wedding)', () => {
        const issue = issues(data([person('a', { birthDate: '1900-05-01' }), person('b')], [union('u', 'a', 'b', '1915-06-01')]))
            .find(i => i.type === 'marriageUnder16')!;
        expect(issue.severity).toBe('warning');
        expect(issue.partnershipIds).toEqual(['u']);
        expect(issue.field).toBe('wedding');
        expect(qualityFinding(issue)).toEqual({ kind: 'marriageUnder16', persons: ['a'], subject: '1915' });
    });
});

describe('recorded age', () => {
    it('reports an age at the wedding off by more than two years', () => {
        const d = (age: string) => data([person('a', { birthDate: '1900-05-01' }), person('b', { gender: 'female' })],
            [union('u', 'a', 'b', '1925-06-01', { a: age })]);
        expect(types(d('22'))).toContain('recordedAgeMismatch');
        expect(types(d('23'))).not.toContain('recordedAgeMismatch');
        expect(types(d('28'))).toContain('recordedAgeMismatch');
        // A word or an age with a qualifier is not compared.
        expect(types(d('infant'))).not.toContain('recordedAgeMismatch');
        expect(types(d('~20'))).not.toContain('recordedAgeMismatch');
    });

    it('reports an age at the death and at the birth, each with its field', () => {
        const dead = issues(data([person('a', { birthDate: '1900-05-01', deathDate: '1960-06-01', deathAge: '50' })]))
            .find(i => i.type === 'recordedAgeMismatch')!;
        expect(dead.field).toBe('death');
        expect(dead.detail).toBe('† 1960-06-01: 50 ≠ 60');
        const born = issues(data([person('a', { birthDate: '1900-05-01', birthAge: '5' })]))
            .find(i => i.type === 'recordedAgeMismatch')!;
        expect(born.field).toBe('birth');
        expect(types(data([person('a', { birthDate: '1900-05-01', birthAge: '3 weeks' })]))).not.toContain('recordedAgeMismatch');
    });

    it('keeps a finding per fact: the wedding and the death of one person are two keys', () => {
        const d = data([person('a', { birthDate: '1900-05-01', deathDate: '1960-06-01', deathAge: '50' }), person('b')],
            [union('u', 'a', 'b', '1925-06-01', { a: '40' })]);
        const keys = issues(d).filter(i => i.type === 'recordedAgeMismatch').map(i => qualityFindingKey(qualityFinding(i)));
        expect(keys).toHaveLength(2);
        expect(new Set(keys).size).toBe(2);
        expect(keys).toContain(JSON.stringify(['recordedAgeMismatch', ['a'], 'wedding 1925']));
        expect(keys).toContain(JSON.stringify(['recordedAgeMismatch', ['a'], 'death']));
    });
});

describe('the old findings keep their keys', () => {
    it('childMarriage and parentTooYoung are keyed as before', () => {
        const d = data([person('a', { birthDate: '1900-05-01' }), person('b')], [union('u', 'a', 'b', '1912-06-01')]);
        const child = issues(d).find(i => i.type === 'childMarriage')!;
        expect(qualityFindingKey(qualityFinding(child))).toBe(JSON.stringify(['childMarriage', ['a'], '']));
        const young = issues(pair('female', '1900-05-01', '1910-06-01')).find(i => i.type === 'parentTooYoung')!;
        expect(qualityFindingKey(qualityFinding(young))).toBe(JSON.stringify(['parentTooYoung', ['kid', 'par'], '']));
    });
});

describe('texts of the new types', () => {
    const NEW = ['motherTooYoung16', 'motherTooOld45', 'fatherTooYoung18', 'fatherTooOld60', 'marriageUnder16', 'recordedAgeMismatch'];
    it('every new type has a title in cs, en, de and pl', () => {
        for (const type of NEW) {
            const key = `val${type[0].toUpperCase()}${type.slice(1)}`;
            for (const code of ['en', 'cs', 'de', 'pl'] as const) {
                const lang = getStringsForLang(code).treeManager as unknown as Record<string, unknown>;
                expect(typeof lang[key], `${type}`).toBe('string');
                expect((lang[key] as string).length).toBeGreaterThan(5);
            }
            expect(translateValidationType(type)).not.toBe(type);
        }
    });
});
