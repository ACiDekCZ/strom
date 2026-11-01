import { describe, it, expect } from 'vitest';
import { parseDeepLink, findDeepLinkPerson, deepLinkTreeMatches, stripDeepLinkParams } from '../deep-link';
import type { Person, PersonId } from '../types';

const RID = '8766d005-3a27-4dc9-a3c5-a62d70726cf5';

function person(id: string, refn?: string): Person {
    return {
        id: id as PersonId, firstName: 'Bořivoj', lastName: 'Lhoták', gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        ...(refn !== undefined ? { refn } : {}),
    };
}

const persons: Record<string, Person> = {
    p_1_a: person('p_1_a', 'P0012'),
    p_2_b: person('p_2_b', ' P0013 '),
    p_3_c: person('p_3_c'),
    p_4_d: person('p_4_d', 'custom-ref'),
};

const q = (s: string) => new URLSearchParams(s);

describe('parseDeepLink', () => {
    it('reads a person link (research id or app id)', () => {
        expect(parseDeepLink(q(`tree=lhotakovi&research=${RID}&person=P0012`))).toEqual({ kind: 'person', ref: 'P0012' });
        expect(parseDeepLink(q('person=%20p_1_a%20'))).toEqual({ kind: 'person', ref: 'p_1_a' });
    });

    it('reads "Waiting for you" (any case)', () => {
        expect(parseDeepLink(q(`tree=x&research=${RID}&show=waiting`))).toEqual({ kind: 'waiting' });
        expect(parseDeepLink(q('show=Waiting'))).toEqual({ kind: 'waiting' });
    });

    it('a person wins over show', () => {
        expect(parseDeepLink(q('show=waiting&person=P1'))).toEqual({ kind: 'person', ref: 'P1' });
    });

    it('nothing beyond the tree: null (the plain ?tree= / ?research= links)', () => {
        expect(parseDeepLink(q('tree=lhotakovi'))).toBeNull();
        expect(parseDeepLink(q(`tree=lhotakovi&research=${RID}`))).toBeNull();
        expect(parseDeepLink(q('show=overview'))).toBeNull();
        expect(parseDeepLink(q('person=%20%20'))).toBeNull();
        expect(parseDeepLink(q(''))).toBeNull();
    });
});

describe('findDeepLinkPerson', () => {
    it('finds by the research id (REFN), trimmed', () => {
        expect(findDeepLinkPerson(persons, 'P0012')).toBe('p_1_a');
        expect(findDeepLinkPerson(persons, 'P0013')).toBe('p_2_b');
    });

    it('a research id nobody carries: null (never an app id of that shape)', () => {
        expect(findDeepLinkPerson(persons, 'P9999')).toBeNull();
        expect(findDeepLinkPerson({ P0001: person('P0001') }, 'P0001')).toBeNull();
    });

    it('finds by the app id', () => {
        expect(findDeepLinkPerson(persons, 'p_3_c')).toBe('p_3_c');
    });

    it('unknown, odd or inherited keys: null', () => {
        expect(findDeepLinkPerson(persons, 'p_9_z')).toBeNull();
        expect(findDeepLinkPerson(persons, 'custom-ref')).toBeNull();
        expect(findDeepLinkPerson(persons, '__proto__')).toBeNull();
        expect(findDeepLinkPerson(persons, 'toString')).toBeNull();
        expect(findDeepLinkPerson(persons, '<script>')).toBeNull();
    });
});

describe('deepLinkTreeMatches', () => {
    const research = { id: 'tree_1', researchId: RID };
    const plain = { id: 'tree_2', researchId: null };

    it('with research=: only a tree of that research', () => {
        expect(deepLinkTreeMatches(q(`tree=x&research=${RID.toUpperCase()}`), research, research)).toBe(true);
        expect(deepLinkTreeMatches(q(`tree=x&research=${RID}`), plain, plain)).toBe(false);
        expect(deepLinkTreeMatches(q(`research=${RID}`), { id: 'tree_3', researchId: '00000000-0000-4000-8000-000000000000' }, null)).toBe(false);
    });

    it('with tree= alone: the tree that slug picked', () => {
        expect(deepLinkTreeMatches(q('tree=x'), plain, plain)).toBe(true);
        expect(deepLinkTreeMatches(q('tree=unknown'), plain, null)).toBe(false);
        expect(deepLinkTreeMatches(q('tree=x'), plain, research)).toBe(false);
    });

    it('a research= of another shape falls back to tree=', () => {
        expect(deepLinkTreeMatches(q('tree=x&research=not-a-uuid'), plain, plain)).toBe(true);
    });

    it('neither: the tree that opened; no tree: false', () => {
        expect(deepLinkTreeMatches(q('person=P1'), plain, null)).toBe(true);
        expect(deepLinkTreeMatches(q('person=P1'), null, null)).toBe(false);
    });
});

describe('stripDeepLinkParams', () => {
    it('drops person and show, keeps the rest', () => {
        const url = new URL(`https://stromapp.info/run/?tree=x&research=${RID}&person=P1&show=waiting&search=Lhot`);
        expect(stripDeepLinkParams(url)).toBe(true);
        expect([...url.searchParams.keys()]).toEqual(['tree', 'research', 'search']);
    });

    it('nothing to drop: false, the address unchanged', () => {
        const url = new URL('https://stromapp.info/run/?tree=x');
        expect(stripDeepLinkParams(url)).toBe(false);
        expect(url.search).toBe('?tree=x');
    });
});
