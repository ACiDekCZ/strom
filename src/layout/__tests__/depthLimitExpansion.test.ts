/**
 * Display expansion respects the descendant depth (T19).
 *
 * Expanded mode inlines all unions of a person. For a person in the deepest
 * shown generation it used to pull in the children of every union too, so
 * someone with two marriages at depth 1 showed generation 2. The expansion
 * now adds the extra partner but not the children beyond the depth, while
 * a parent's other unions still bring the focus's half-siblings.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline } from '../pipeline/index.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Gender, DEFAULT_LAYOUT_CONFIG } from '../../types.js';

function build(): StromData {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const P = (id: string, gender: Gender) => {
        persons[id] = { id: id as PersonId, firstName: id, lastName: '', gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [] } as Person;
    };
    const U = (id: string, a: string, b: string, kids: string[]) => {
        partnerships[id] = { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
            childIds: kids as PersonId[], status: 'married' } as Partnership;
        persons[a].partnerships.push(id as PartnershipId);
        persons[b].partnerships.push(id as PartnershipId);
        for (const k of kids) {
            persons[k].parentIds.push(a as PersonId, b as PersonId);
            persons[a].childIds.push(k as PersonId);
            persons[b].childIds.push(k as PersonId);
        }
    };
    ['GP', 'R', 'S', 'H', 'C', 'D', 'G1', 'G2', 'G3', 'X1'].forEach(x => P(x, 'male'));
    ['GM', 'GM2', 'W', 'W2', 'P1', 'P2', 'DW'].forEach(x => P(x, 'female'));
    U('u0', 'GP', 'GM', ['R', 'S']);
    U('u0b', 'GP', 'GM2', ['H']);          // grandfather's second marriage: R's half-brother
    U('u1', 'R', 'W', ['C', 'D']);
    U('u1b', 'R', 'W2', ['X1']);           // focus's second marriage
    U('u2', 'C', 'P1', ['G1']);
    U('u3', 'C', 'P2', ['G2']);            // C has two marriages at depth 1
    U('u4', 'D', 'DW', ['G3']);
    return { persons, partnerships } as unknown as StromData;
}

function shown(data: StromData, descendantDepth: number, family: boolean, lineageOnly: boolean): Set<string> {
    const r = runLayoutPipeline({
        data, focusPersonId: 'R' as PersonId, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: family ? 1 : 0, descendantDepth,
        includeSpouseAncestors: false, includeParentSiblings: family, includeParentSiblingDescendants: family,
        displayPolicy: { mode: 'expanded', autoExpand: true, expandLineageOnly: !family && lineageOnly } as never,
    });
    return new Set([...r.positions.keys()].map(String));
}

describe('display expansion respects the descendant depth (T19)', () => {
    const data = build();

    for (const family of [false, true]) {
        for (const lineageOnly of [false, true]) {
            const view = `${family ? 'family' : 'descendants'}, lineageOnly=${lineageOnly}`;

            it(`depth 1 shows children and their partners, no grandchildren (${view})`, () => {
                const ids = shown(data, 1, family, lineageOnly);
                for (const id of ['R', 'W', 'W2', 'C', 'D', 'X1', 'P1', 'P2', 'DW']) expect(ids.has(id), id).toBe(true);
                for (const id of ['G1', 'G2', 'G3']) expect(ids.has(id), id).toBe(false);
            });

            it(`depth 2 shows the grandchildren of every union (${view})`, () => {
                const ids = shown(data, 2, family, lineageOnly);
                for (const id of ['G1', 'G2', 'G3']) expect(ids.has(id), id).toBe(true);
            });
        }
    }

    it('depth 0 shows both partners of the focus but none of the children', () => {
        const ids = shown(data, 0, true, false);
        for (const id of ['R', 'W', 'W2']) expect(ids.has(id), id).toBe(true);
        for (const id of ['C', 'D', 'X1', 'G1']) expect(ids.has(id), id).toBe(false);
    });

    it("a parent's other union still brings the focus's half-sibling", () => {
        const ids = shown(data, 1, true, false);
        expect(ids.has('GM2')).toBe(true);
        expect(ids.has('H')).toBe(true);
    });
});
