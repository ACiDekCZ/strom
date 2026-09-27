/**
 * "Where evidence is missing" (tree health): who has no source, whose birth
 * has none, and where a line stops. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { computeEvidenceGaps } from '../stats.js';
import { StromData, Person, PersonId, PartnershipId, toPersonId, toPartnershipId } from '../types.js';

const id = (s: string): PersonId => toPersonId(s);

function person(pid: string, extra: Partial<Person> = {}): Person {
    return {
        id: id(pid), firstName: pid, lastName: 'Novák', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}

/**
 *   grandpa ⚭ grandma          (no parents: the line ends here)
 *        |
 *      father ⚭ mother         (mother married in: no parents, husband has them)
 *           |
 *          son                 (focus)
 *   stranger                   (no parents, no children, not an ancestor)
 */
function tree(): StromData {
    const u1 = toPartnershipId('u1');
    const u2 = toPartnershipId('u2');
    const persons: Record<PersonId, Person> = {
        [id('grandpa')]: person('grandpa', { partnerships: [u1], childIds: [id('father')], birthDate: '1850' }),
        [id('grandma')]: person('grandma', { gender: 'female', partnerships: [u1], childIds: [id('father')] }),
        [id('father')]: person('father', { partnerships: [u2], parentIds: [id('grandpa'), id('grandma')], childIds: [id('son')], sourceIds: ['s1'], birthDate: '1880' }),
        [id('mother')]: person('mother', { gender: 'female', partnerships: [u2], childIds: [id('son')],
            events: [{ id: 'e1', type: 'baptism', date: '1882', sourceIds: ['s1'] }] }),
        [id('son')]: person('son', { parentIds: [id('father'), id('mother')], birthPlace: 'Kolín' }),
        [id('stranger')]: person('stranger'),
        [id('unknown')]: person('unknown', { isPlaceholder: true }),
    };
    const partnerships: Record<PartnershipId, StromData['partnerships'][PartnershipId]> = {
        [u1]: { id: u1, person1Id: id('grandpa'), person2Id: id('grandma'), childIds: [id('father')], status: 'married', sourceIds: ['s2'] },
        [u2]: { id: u2, person1Id: id('father'), person2Id: id('mother'), childIds: [id('son')], status: 'married' },
    };
    return { persons, partnerships, sources: { s1: { id: 's1', title: 'Register' }, s2: { id: 's2', title: 'Marriage' } } };
}

describe('computeEvidenceGaps', () => {
    it('counts people without any source (a marriage citation counts)', () => {
        const g = computeEvidenceGaps(tree(), id('son'));
        expect(g.total).toBe(6);
        // grandpa and grandma are cited on their marriage only: they have a source.
        expect(g.noSource.sort()).toEqual(['son', 'stranger']);
    });

    it('counts births without a source (person or baptism citation covers it)', () => {
        const g = computeEvidenceGaps(tree(), id('son'));
        // grandpa: born 1850, cited only on the marriage; son: birth place, nothing cited.
        expect(g.birthNoSource.sort()).toEqual(['grandpa', 'son']);
    });

    it('line ends: ancestors without parents, not the one who married in', () => {
        const g = computeEvidenceGaps(tree(), id('son'));
        // mother is the focus's ancestor: her line ends too.
        expect(g.lineEnds.sort()).toEqual(['grandma', 'grandpa', 'mother']);
        // Seen from elsewhere, the married-in mother is not a line end.
        // Alone, without children, the focus ends no line.
        expect(computeEvidenceGaps(tree(), id('stranger')).lineEnds.sort()).toEqual(['grandma', 'grandpa']);
        expect(computeEvidenceGaps(tree(), null).lineEnds.sort()).toEqual(['grandma', 'grandpa']);
    });
});
