/**
 * Descendants view "lineage only" expansion (DisplayPolicy.expandLineageOnly):
 * partners of descendants keep their card, but their OTHER unions and those
 * unions' children (step-relatives) are excluded unless whole families are
 * requested.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline, collectBloodDescendants } from '../pipeline/index.js';
import { StromData, Person, PersonId, PartnershipId, Gender, DEFAULT_LAYOUT_CONFIG } from '../../types.js';

function person(id: string, gender: Gender, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [],
        ...o,
    };
}

/**
 * grandpa ─┬─ grandma
 *          son ─┬─ wife ─┬─ exHusband
 *             child   stepChild
 */
function buildData(): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, g] of [['grandpa', 'male'], ['grandma', 'female'], ['son', 'male'],
        ['wife', 'female'], ['exHusband', 'male'], ['child', 'male'], ['stepChild', 'female']] as const) {
        persons[id] = person(id, g);
    }
    const partnerships: StromData['partnerships'] = {} as StromData['partnerships'];
    const union = (id: string, a: string, b: string, children: string[]) => {
        (partnerships as Record<string, unknown>)[id] = {
            id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
            childIds: children as PersonId[], status: 'married',
        };
        persons[a].partnerships.push(id as PartnershipId);
        persons[b].partnerships.push(id as PartnershipId);
        for (const c of children) {
            persons[c].parentIds = [a as PersonId, b as PersonId];
            persons[a].childIds.push(c as PersonId);
            persons[b].childIds.push(c as PersonId);
        }
    };
    union('u1', 'grandpa', 'grandma', ['son']);
    union('u2', 'son', 'wife', ['child']);
    union('u3', 'exHusband', 'wife', ['stepChild']);
    return { persons: persons as StromData['persons'], partnerships };
}

function run(expandLineageOnly: boolean) {
    return runLayoutPipeline({
        data: buildData(),
        focusPersonId: 'grandpa' as PersonId,
        config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 0,
        descendantDepth: 10,
        includeSpouseAncestors: false,
        includeParentSiblings: false,
        includeParentSiblingDescendants: false,
        displayPolicy: { mode: 'expanded', autoExpand: true, expandLineageOnly },
    });
}

describe('collectBloodDescendants', () => {
    it('returns focus + blood descendants only', () => {
        const blood = collectBloodDescendants(buildData(), 'grandpa' as PersonId);
        expect([...blood].sort()).toEqual(['child', 'grandpa', 'son']);
    });
});

describe('descendants view lineage-only expansion', () => {
    it('excludes the partner\'s other union and step-children', () => {
        const result = run(true);
        const shown = new Set(result.positions.keys());
        expect(shown.has('son' as PersonId)).toBe(true);
        expect(shown.has('wife' as PersonId)).toBe(true);      // partner of a descendant stays
        expect(shown.has('child' as PersonId)).toBe(true);
        expect(shown.has('stepChild' as PersonId)).toBe(false); // not grandpa's blood
        expect(shown.has('exHusband' as PersonId)).toBe(false); // partner's other partner
    });

    it('whole-families mode still shows them', () => {
        const result = run(false);
        const shown = new Set(result.positions.keys());
        expect(shown.has('stepChild' as PersonId)).toBe(true);
        expect(shown.has('exHusband' as PersonId)).toBe(true);
    });
});
