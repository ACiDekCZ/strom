/**
 * Cross-tree "Also in" matching (T22): a namesake sister in another tree is
 * not offered as the same person; a real match says what it was found by.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findCrossTreeMatches, invalidateCache, matchReasonsText } from '../cross-tree.js';
import { quickMatch } from '../merge/matching.js';
import { setLanguage } from '../strings.js';
import { Person, PersonId, PartnershipId, StromData, TreeId } from '../types.js';

function person(id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName, lastName, gender,
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        ...extra
    } as Person;
}

/** A tree of one person and, optionally, her parents Jan and Marie Lipa. */
function tree(prefix: string, subject: Partial<Person>, parents: { father?: string; mother?: string } | null): StromData {
    const persons: Record<string, Person> = {};
    const partnerships: StromData['partnerships'] = {};
    const subjectId = `${prefix}-b` as PersonId;
    const s = person(subjectId, 'Anežka', 'Lipová', 'female', subject);
    persons[subjectId] = s;
    if (parents) {
        const f = person(`${prefix}-f`, parents.father ?? 'Jan', 'Lipa', 'male', { birthDate: '1850' });
        const m = person(`${prefix}-m`, parents.mother ?? 'Marie', 'Lipová', 'female', { birthDate: '1855' });
        const uid = `${prefix}-u` as PartnershipId;
        f.partnerships = [uid];
        m.partnerships = [uid];
        f.childIds = [subjectId];
        m.childIds = [subjectId];
        s.parentIds = [f.id, m.id];
        partnerships[uid] = { id: uid, person1Id: f.id, person2Id: m.id, childIds: [subjectId], status: 'married' } as never;
        persons[f.id] = f;
        persons[m.id] = m;
    }
    return { persons, partnerships } as StromData;
}

function matchesOf(a: StromData, b: StromData) {
    const trees = new Map<TreeId, { name: string; data: StromData }>([
        ['ta' as TreeId, { name: 'Tree A', data: a }],
        ['tb' as TreeId, { name: 'Tree B', data: b }],
    ]);
    const subject = Object.values(a.persons).find(p => p.firstName === 'Anežka')!;
    return findCrossTreeMatches('ta' as TreeId, subject, trees);
}

describe('cross-tree matching (T22)', () => {
    beforeEach(() => { invalidateCache(); setLanguage('en'); });
    afterEach(() => setLanguage('en'));

    it('two namesakes born a year apart with nothing else in common are no match', () => {
        const m = matchesOf(tree('a', { birthDate: '1885' }, null), tree('b', { birthDate: '1884' }, null));
        expect(m).toHaveLength(0);
    });

    it('a name and a death year alone are no match', () => {
        const m = matchesOf(tree('a', { deathDate: '1950' }, null), tree('b', { deathDate: '1950' }, null));
        expect(m).toHaveLength(0);
    });

    it('sisters of one name whose full birth dates differ are no match, even with the same parents', () => {
        const m = matchesOf(
            tree('a', { birthDate: '1885-03-12' }, {}),
            tree('b', { birthDate: '1884-06-02' }, {}));
        expect(m).toHaveLength(0);
        // The same year does not help when the days disagree.
        const sameYear = matchesOf(
            tree('a', { birthDate: '1885-03-12' }, {}),
            tree('b', { birthDate: '1885-11-20' }, {}));
        expect(sameYear).toHaveLength(0);
    });

    it('birth years far apart rule the match out', () => {
        expect(matchesOf(tree('a', { birthDate: '1885' }, {}), tree('b', { birthDate: '1910' }, {}))).toHaveLength(0);
    });

    it('the same full birth date is a match found by name and birth', () => {
        const m = matchesOf(tree('a', { birthDate: '1885-03-12' }, null), tree('b', { birthDate: '1885-03-12' }, null));
        expect(m).toHaveLength(1);
        expect(m[0].reasons).toEqual(['name', 'birth']);
        expect(matchReasonsText(m[0])).toBe('Matched by: name, birth');
    });

    it('the same birth year and the same parents is a match found by name, birth and parents', () => {
        const m = matchesOf(tree('a', { birthDate: '1885' }, {}), tree('b', { birthDate: '1885-03-12' }, {}));
        expect(m).toHaveLength(1);
        expect(m[0].reasons).toEqual(['name', 'birth', 'parents']);
        expect(matchReasonsText(m[0])).toBe('Matched by: name, birth, parents');
        setLanguage('cs');
        expect(matchReasonsText(m[0])).toBe('Shoda: jméno, narození, rodiče');
        setLanguage('de');
        expect(matchReasonsText(m[0])).toBe('Übereinstimmung: Name, Geburt, Eltern');
    });

    it('parents count by name, not by id, and only when their names agree', () => {
        // Same ids on both sides, but different parents: no parent bonus.
        const other = matchesOf(tree('x', { birthDate: '1885' }, {}), tree('x', { birthDate: '1884' }, { father: 'Václav', mother: 'Anna' }));
        expect(other).toHaveLength(0);
        // A year apart is rescued by both parents of the same names.
        const same = matchesOf(tree('a', { birthDate: '1885' }, {}), tree('b', { birthDate: '1884' }, {}));
        expect(same).toHaveLength(1);
        expect(same[0].reasons).toEqual(['name', 'parents']);
    });

    it('a matching partner adds to the score and the reasons', () => {
        const a = tree('a', {}, null);
        const b = tree('b', {}, null);
        for (const [d, prefix] of [[a, 'a'], [b, 'b']] as const) {
            const uid = `${prefix}-pu` as PartnershipId;
            const husband = person(`${prefix}-h`, 'Karel', 'Novák', 'male', { partnerships: [uid] });
            d.persons[husband.id] = husband;
            d.persons[`${prefix}-b` as PersonId].partnerships = [uid];
            d.partnerships[uid] = { id: uid, person1Id: husband.id, person2Id: `${prefix}-b`, childIds: [], status: 'married' } as never;
        }
        const r = quickMatch(a.persons['a-b' as PersonId], b.persons['b-b' as PersonId], a, b);
        expect(r.reasons).toEqual(['name', 'partner']);
        expect(r.score).toBeGreaterThanOrEqual(50);
    });
});
