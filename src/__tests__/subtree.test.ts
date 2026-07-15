import { describe, it, expect } from 'vitest';
import { extractSubtree } from '../subtree.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender: 'male',
        isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o,
    };
}

/**
 *   gpa ─┬─ gma          (grandparents)
 *       dad ─┬─ mom      (mom is off-screen initially)
 *          me ─ kid      (me + kid visible)
 */
function sample(): StromData {
    const persons: Record<string, Person> = {};
    for (const id of ['gpa', 'gma', 'dad', 'mom', 'me', 'partner', 'kid']) persons[id] = person(id);
    persons.gma.gender = persons.mom.gender = persons.partner.gender = 'female';
    const P = (a: string, b: string, kids: string[], uid: string) => {
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
        for (const k of kids) { persons[k].parentIds = [a as PersonId, b as PersonId]; persons[a].childIds.push(k as PersonId); persons[b].childIds.push(k as PersonId); }
        return { [uid]: { id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' as const } };
    };
    const partnerships = { ...P('gpa', 'gma', ['dad'], 'u1'), ...P('dad', 'mom', ['me'], 'u2'), ...P('me', 'partner', ['kid'], 'u3') };
    return { persons: persons as StromData['persons'], partnerships };
}

describe('extractSubtree', () => {
    it('keeps exactly the seeds plus glue (missing parent of a kept child)', () => {
        // Visible: dad, me, partner, kid  (mom off-screen but is me's parent)
        const out = extractSubtree(sample(), new Set(['dad', 'me', 'partner', 'kid'] as PersonId[]));
        // mom is glued in because 'me' (a kept child of dad+mom) would else be half-orphaned.
        expect(Object.keys(out.persons).sort()).toEqual(['dad', 'kid', 'me', 'mom', 'partner']);
        // gpa/gma are NOT pulled in (dad's parents were not visible).
        expect(out.persons['dad' as PersonId].parentIds).toEqual([]);
    });

    it('drops relationships and partnerships pointing outside the kept set', () => {
        const out = extractSubtree(sample(), new Set(['me', 'partner', 'kid'] as PersonId[]));
        // me's parents (dad/mom) are gone → me becomes a root.
        expect(out.persons['me' as PersonId].parentIds).toEqual([]);
        // Only the me+partner union survives; u2 (dad+mom) is dropped.
        expect(Object.keys(out.partnerships)).toEqual(['u3']);
        expect(out.persons['me' as PersonId].partnerships).toEqual(['u3' as PartnershipId]);
    });

    it('produces a self-consistent tree (no dangling ids)', () => {
        const out = extractSubtree(sample(), new Set(['gpa', 'gma', 'dad'] as PersonId[]));
        const ids = new Set(Object.keys(out.persons));
        for (const p of Object.values(out.persons)) {
            p.parentIds.forEach(pid => expect(ids.has(pid)).toBe(true));
            p.childIds.forEach(cid => expect(ids.has(cid)).toBe(true));
        }
        for (const u of Object.values(out.partnerships)) {
            expect(ids.has(u.person1Id)).toBe(true);
            expect(ids.has(u.person2Id)).toBe(true);
            u.childIds.forEach(c => expect(ids.has(c)).toBe(true));
        }
    });
});
