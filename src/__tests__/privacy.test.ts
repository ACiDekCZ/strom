/**
 * Living-person privacy filter tests.
 */

import { describe, it, expect } from 'vitest';
import { applyLivingPrivacy, isLivingPerson } from '../privacy.js';
import { strings } from '../strings.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

const NOW = 2026;
const LIVING_LABEL = strings.privacy.livingPerson;

/** Access persons by plain string key (ids are branded PersonId). */
function P(data: StromData): Record<string, Person> {
    return data.persons as Record<string, Person>;
}

function person(id: string, over: Partial<Person> = {}): Person {
    return {
        id: id as PersonId,
        firstName: 'Jan',
        lastName: 'Novák',
        gender: 'male',
        isPlaceholder: false,
        partnerships: [],
        parentIds: [],
        childIds: [],
        ...over,
    };
}

function tree(...persons: Person[]): StromData {
    const map: StromData['persons'] = {};
    for (const p of persons) map[p.id] = p;
    return { persons: map, partnerships: {} as Record<PartnershipId, never> };
}

describe('isLivingPerson', () => {
    it('treats a death date as deceased', () => {
        expect(isLivingPerson(person('a', { deathDate: '1990' }), NOW)).toBe(false);
    });
    it('treats birth over 110 years ago (no death) as deceased', () => {
        expect(isLivingPerson(person('a', { birthDate: '1900' }), NOW)).toBe(false);
    });
    it('treats a recent birth as living', () => {
        expect(isLivingPerson(person('a', { birthDate: '1990' }), NOW)).toBe(true);
    });
    it('treats no dates as living (unknown, be safe)', () => {
        expect(isLivingPerson(person('a'), NOW)).toBe(true);
    });
    it('isDeceased:true overrides a recent birth', () => {
        expect(isLivingPerson(person('a', { birthDate: '1990', isDeceased: true }), NOW)).toBe(false);
    });
    it('isDeceased:false overrides an old birth', () => {
        expect(isLivingPerson(person('a', { birthDate: '1850', isDeceased: false }), NOW)).toBe(true);
    });
    it('respects flex-date qualifiers via yearOf', () => {
        expect(isLivingPerson(person('a', { birthDate: '~1990' }), NOW)).toBe(true);
        expect(isLivingPerson(person('a', { birthDate: '<1900' }), NOW)).toBe(false);
    });
});

describe('applyLivingPrivacy', () => {
    const living = person('living', {
        firstName: 'Jan', lastName: 'Novák', birthDate: '1990-05-01',
        birthPlace: 'Praha', notes: 'secret',
    });
    const deceased = person('dead', {
        firstName: 'Old', lastName: 'Ancestor', birthDate: '1900', deathDate: '1970',
        birthPlace: 'Brno', notes: 'history',
    });

    it('full mode is a deep copy that changes nothing', () => {
        const data = tree(living, deceased);
        const out = applyLivingPrivacy(data, 'full', NOW);
        expect(out).toEqual(data);
        expect(out).not.toBe(data);
        expect(P(out)['living']).not.toBe(P(data)['living']);
    });

    it('never mutates the original', () => {
        const data = tree(structuredClone(living));
        applyLivingPrivacy(data, 'anonymous', NOW);
        expect(P(data)['living'].firstName).toBe('Jan');
        expect(P(data)['living'].notes).toBe('secret');
    });

    it('initials mode reduces names, keeps birth year only, drops places/notes', () => {
        const out = applyLivingPrivacy(tree(living), 'initials', NOW);
        const p = P(out)['living'];
        expect(p.firstName).toBe('J.');
        expect(p.lastName).toBe('N.');
        expect(p.birthDate).toBe('1990');
        expect(p.birthPlace).toBeUndefined();
        expect(p.notes).toBeUndefined();
        expect(p.gender).toBe('male');
    });

    it('anonymous mode hides the name entirely but keeps gender', () => {
        const out = applyLivingPrivacy(tree(living), 'anonymous', NOW);
        const p = P(out)['living'];
        expect(p.firstName).toBe(LIVING_LABEL);
        expect(p.lastName).toBe('');
        expect(p.birthDate).toBeUndefined();
        expect(p.gender).toBe('male');
    });

    it('minimal mode keeps the surname', () => {
        const out = applyLivingPrivacy(tree(living), 'minimal', NOW);
        const p = P(out)['living'];
        expect(p.lastName).toBe('Novák');
        expect(p.firstName).toBe(LIVING_LABEL);
        expect(p.birthDate).toBeUndefined();
    });

    it('leaves deceased persons untouched', () => {
        const out = applyLivingPrivacy(tree(deceased), 'anonymous', NOW);
        expect(P(out)['dead']).toEqual(deceased);
    });

    it('leaves placeholders untouched', () => {
        const ph = person('ph', { firstName: '?', lastName: '', isPlaceholder: true });
        const out = applyLivingPrivacy(tree(ph), 'anonymous', NOW);
        expect(P(out)['ph'].firstName).toBe('?');
    });

    it('preserves structure (ids, relationships) in every mode', () => {
        const parent = person('parent', { childIds: ['child' as PersonId] });
        const child = person('child', { parentIds: ['parent' as PersonId], birthDate: '2010' });
        for (const mode of ['initials', 'anonymous', 'minimal'] as const) {
            const out = applyLivingPrivacy(tree(parent, child), mode, NOW);
            expect(Object.keys(out.persons).sort()).toEqual(['child', 'parent']);
            expect(P(out)['parent'].childIds).toEqual(['child']);
            expect(P(out)['child'].parentIds).toEqual(['parent']);
        }
    });
});
