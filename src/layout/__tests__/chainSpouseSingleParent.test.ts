/**
 * A man whose one known parent stands in a "?" family, married to a woman
 * with parents and a second husband (expanded mode: the couple is a partner
 * chain). Re-centring the gen -1 parents over their children used the
 * chain's middle for the man's single parent, so it stood above his wife and
 * her parents were pushed to the other side: the two ancestries swapped and
 * their lines crossed. Each parent block stands over its own child's card.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline } from '../pipeline/index.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { DEFAULT_LAYOUT_CONFIG, Person, PersonId, PartnershipId, StromData } from '../../types.js';
import { normalizeSingleParents } from '../../single-parent.js';

function tree(): StromData {
    const d = { persons: {}, partnerships: {} } as unknown as StromData;
    const person = (id: string, gender: 'male' | 'female'): PersonId => {
        d.persons[id as PersonId] = { id: id as PersonId, firstName: id, lastName: '', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } as Person;
        return id as PersonId;
    };
    const family = (id: string, a: PersonId, b: PersonId, children: PersonId[]): void => {
        d.partnerships[id as PartnershipId] = { id: id as PartnershipId, person1Id: a, person2Id: b, childIds: [...children], status: 'married' };
        d.persons[a].partnerships.push(id as PartnershipId);
        d.persons[b].partnerships.push(id as PartnershipId);
        for (const c of children) {
            d.persons[c].parentIds.push(a, b);
            d.persons[a].childIds.push(c);
            d.persons[b].childIds.push(c);
        }
    };
    const husband = person('husband', 'male'), wife = person('wife', 'female'), son = person('son', 'male');
    const wFather = person('wife_father', 'male'), wMother = person('wife_mother', 'female');
    const parent = person('husband_parent', 'male'), second = person('second_husband', 'male');
    family('u_couple', husband, wife, [son]);
    family('u_wife_parents', wFather, wMother, [wife]);
    family('u_second', wife, second, []);
    d.persons[husband].parentIds.push(parent);
    d.persons[parent].childIds.push(husband);
    normalizeSingleParents(d);
    return d;
}

describe('a single parent beside the parents of a partner in a chain', () => {
    for (const focus of ['husband', 'wife', 'son'] as const) {
        it(`keeps each ancestry on its own side, no line crossing (focus ${focus})`, () => {
            const data = tree();
            const result = runLayoutPipeline({
                data, focusPersonId: focus as PersonId, config: DEFAULT_LAYOUT_CONFIG,
                ancestorDepth: 5, descendantDepth: 5,
                includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
                displayPolicy: { mode: 'standard', autoExpand: true },
            });
            const x = (id: string) => result.positions.get(id as PersonId)!.x;
            expect(x('husband')).toBeLessThan(x('wife'));
            expect(x('husband_parent')).toBeLessThan(x('wife_father'));
            expect(auditGeometry(result, DEFAULT_LAYOUT_CONFIG, data).filter(v => v.type !== 'inherent-crossing')).toEqual([]);
        });
    }
});
