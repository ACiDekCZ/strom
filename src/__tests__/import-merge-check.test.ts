/**
 * Tree health: two people a GEDCOM import of Strom 3.8.1 or older gave one id
 * (the later replaced the earlier; the one left holds both people's relations).
 */

import { describe, it, expect } from 'vitest';
import { validateTreeData } from '../validation.js';
import { StromData, Person, PersonId, Partnership, PartnershipId } from '../types.js';

const person = (id: string, first: string, gender: 'male' | 'female', birthDate: string): Person => ({
    id: id as PersonId, firstName: first, lastName: 'Novák', gender, birthDate,
    isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
} as unknown as Person);

/** Two families: Jan (1900) with his parents, wife and son; Marie (1950) with her parents and husband. */
function twoFamilies(): StromData {
    const P: Record<string, Person> = {
        jf: person('jf', 'Josef', 'male', '1870'), jm: person('jm', 'Anna', 'female', '1872'),
        jan: person('jan', 'Jan', 'male', '1900'), jw: person('jw', 'Eva', 'female', '1902'), js: person('js', 'Karel', 'male', '1930'),
        mf: person('mf', 'Pavel', 'male', '1920'), mm: person('mm', 'Olga', 'female', '1922'),
        marie: person('marie', 'Marie', 'female', '1950'), mh: person('mh', 'Petr', 'male', '1948'),
    };
    const U: Record<string, Partnership> = {};
    const couple = (id: string, a: string, b: string, kids: string[]) => {
        U[id] = { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' };
        P[a].partnerships.push(id as PartnershipId);
        P[b].partnerships.push(id as PartnershipId);
        for (const k of kids) {
            P[k].parentIds.push(a as PersonId, b as PersonId);
            P[a].childIds.push(k as PersonId);
            P[b].childIds.push(k as PersonId);
        }
    };
    couple('u1', 'jf', 'jm', ['jan']);
    couple('u2', 'jan', 'jw', ['js']);
    couple('u3', 'mf', 'mm', ['marie']);
    couple('u4', 'mh', 'marie', []);
    return { version: 11, persons: P, partnerships: U } as unknown as StromData;
}

/** What a collision left: `later` took `earlier`'s id, its own record kept, every reference to either now one id. */
function collide(data: StromData, earlier: string, later: string): StromData {
    const json = JSON.stringify(data).split(`"${later}"`).join(`"${earlier}"`);
    const out = JSON.parse(json) as StromData;
    const kept = data.persons[later as PersonId];
    const relations = (p: Person) => ({ partnerships: p.partnerships, parentIds: p.parentIds, childIds: p.childIds });
    const a = relations(data.persons[earlier as PersonId]);
    const b = relations(kept);
    out.persons[earlier as PersonId] = {
        ...kept, id: earlier as PersonId,
        partnerships: [...a.partnerships, ...b.partnerships],
        parentIds: [...a.parentIds, ...b.parentIds],
        childIds: [...a.childIds, ...b.childIds],
    } as Person;
    return out;
}

const merges = (data: StromData) => validateTreeData(data).issues.filter(i => i.type === 'importMerge');

describe('two people merged at a GEDCOM import', () => {
    it('a whole tree is clean', () => {
        expect(merges(twoFamilies())).toEqual([]);
    });

    it('both had parents: four parents — reported, with the person and those parents', () => {
        const hits = merges(collide(twoFamilies(), 'jan', 'marie'));
        expect(hits).toHaveLength(1);
        expect(hits[0].severity).toBe('error');
        expect(hits[0].personIds?.[0]).toBe('jan');
        expect(hits[0].personIds).toHaveLength(5);
        expect(hits[0].message).toContain('parents');
    });

    it('one without parents: a partner of the same sex and a child born too early — reported', () => {
        const data = twoFamilies();
        // Marie without parents of her own: only weaker signs are left.
        data.persons['marie' as PersonId].parentIds = [];
        data.partnerships['u3' as PartnershipId].childIds = [];
        data.persons['mf' as PersonId].childIds = [];
        data.persons['mm' as PersonId].childIds = [];
        const hits = merges(collide(data, 'jan', 'marie'));
        expect(hits).toHaveLength(1);
        expect(hits[0].message).toMatch(/partnerSameSex/);
        expect(hits[0].message).toMatch(/childTooEarly/);
    });

    it('one weak sign alone (a same-sex couple, an early child) is not reported', () => {
        const data = twoFamilies();
        data.persons['jw' as PersonId].gender = 'male';
        expect(merges(data)).toEqual([]);
        const early = twoFamilies();
        early.persons['js' as PersonId].birthDate = '1908';
        expect(merges(early)).toEqual([]);
    });

    it('someone among their own parents is reported', () => {
        const data = twoFamilies();
        data.persons['js' as PersonId].parentIds = ['jan', 'js'] as PersonId[];
        expect(merges(data).map(h => h.personIds?.[0])).toContain('js');
    });
});
