/**
 * selectSubgraph Unit Tests
 *
 * Tests that selectSubgraph correctly selects persons based on:
 * - Focus person and partner
 * - Ancestors up to specified depth
 * - Descendants down to specified depth
 * - Parent siblings (aunts/uncles) and their families
 * - Excludes grandparent siblings
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { selectSubgraph } from '../pipeline/1-select-subgraph.js';
import { PersonId, StromData } from '../../types.js';
import { GraphSelection } from '../pipeline/types.js';

describe('selectSubgraph', () => {
    let data: StromData;
    let selectionFull: GraphSelection;

    beforeAll(() => {
        data = loadFixture('t1_select_subgraph_basic');

        // Run selection with up:2, down:2, all options enabled
        selectionFull = selectSubgraph({
            data,
            focusPersonId: 'f' as PersonId,
            ancestorDepth: 2,
            descendantDepth: 2,
            includeSpouseAncestors: false,
            includeParentSiblings: true,
            includeParentSiblingDescendants: true
        });
    });

    describe('basic selection with up:2, down:2', () => {
        it('includes focus person and partner', () => {
            expect(selectionFull.persons.has('f' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('p' as PersonId)).toBe(true);
        });

        it('includes parents (M, D)', () => {
            expect(selectionFull.persons.has('m' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('d' as PersonId)).toBe(true);
        });

        it('includes grandparents (GM1, GD1, GM2, GD2)', () => {
            expect(selectionFull.persons.has('gm1' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('gd1' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('gm2' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('gd2' as PersonId)).toBe(true);
        });

        it('includes parent siblings (M1, D1) when includeParentSiblings=true', () => {
            expect(selectionFull.persons.has('m1' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('d1' as PersonId)).toBe(true);
        });

        it('includes parent sibling partners (M1P, D1P)', () => {
            expect(selectionFull.persons.has('m1p' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('d1p' as PersonId)).toBe(true);
        });

        it('includes cousins (M1C1, M1C2, D1C1) when includeParentSiblingDescendants=true', () => {
            expect(selectionFull.persons.has('m1c1' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('m1c2' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('d1c1' as PersonId)).toBe(true);
        });

        it('includes children (C1, C2, C3)', () => {
            expect(selectionFull.persons.has('c1' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('c2' as PersonId)).toBe(true);
            expect(selectionFull.persons.has('c3' as PersonId)).toBe(true);
        });

        it('includes grandchildren (GC1)', () => {
            expect(selectionFull.persons.has('gc1' as PersonId)).toBe(true);
        });

        it('includes focus siblings (S1)', () => {
            expect(selectionFull.persons.has('s1' as PersonId)).toBe(true);
        });
    });

    describe('negative tests - exclusions', () => {
        it('excludes grandparent siblings', () => {
            // gm1s is sibling of gm1 (grandparent) - should NOT be selected
            expect(selectionFull.persons.has('gm1s' as PersonId)).toBe(false);
        });

        it('excludes great-great-grandparents when ancestorDepth=2', () => {
            // ggm1, ggd1 are parents of gm1 (3 generations up) - should NOT be selected
            expect(selectionFull.persons.has('ggm1' as PersonId)).toBe(false);
            expect(selectionFull.persons.has('ggd1' as PersonId)).toBe(false);
        });

        it('excludes parent siblings when includeParentSiblings=false', () => {
            const selectionNoAunts = selectSubgraph({
                data,
                focusPersonId: 'f' as PersonId,
                ancestorDepth: 2,
                descendantDepth: 2,
                includeSpouseAncestors: false,
                includeParentSiblings: false,
                includeParentSiblingDescendants: false
            });

            expect(selectionNoAunts.persons.has('m1' as PersonId)).toBe(false);
            expect(selectionNoAunts.persons.has('d1' as PersonId)).toBe(false);
            expect(selectionNoAunts.persons.has('m1p' as PersonId)).toBe(false);
            expect(selectionNoAunts.persons.has('d1p' as PersonId)).toBe(false);
        });

        it('excludes cousins when includeParentSiblingDescendants=false', () => {
            const selectionNoCousins = selectSubgraph({
                data,
                focusPersonId: 'f' as PersonId,
                ancestorDepth: 2,
                descendantDepth: 2,
                includeSpouseAncestors: false,
                includeParentSiblings: true,
                includeParentSiblingDescendants: false
            });

            // Aunts/uncles should be included
            expect(selectionNoCousins.persons.has('m1' as PersonId)).toBe(true);
            expect(selectionNoCousins.persons.has('d1' as PersonId)).toBe(true);

            // But cousins should NOT be included
            expect(selectionNoCousins.persons.has('m1c1' as PersonId)).toBe(false);
            expect(selectionNoCousins.persons.has('m1c2' as PersonId)).toBe(false);
            expect(selectionNoCousins.persons.has('d1c1' as PersonId)).toBe(false);
        });
    });

    describe('data integrity', () => {
        it('has no duplicate person IDs', () => {
            const personArray = Array.from(selectionFull.persons);
            const uniquePersons = new Set(personArray);
            expect(personArray.length).toBe(uniquePersons.size);
        });

        it('all partnerships reference existing persons', () => {
            for (const partnershipId of selectionFull.partnerships) {
                const partnership = data.partnerships[partnershipId];
                expect(partnership).toBeDefined();

                // Both partners should be in selection
                expect(selectionFull.persons.has(partnership.person1Id)).toBe(true);
                expect(selectionFull.persons.has(partnership.person2Id)).toBe(true);
            }
        });

        it('returns correct depth metrics', () => {
            // With ancestorDepth=2, we should reach grandparents (depth 2)
            expect(selectionFull.maxAncestorGen).toBe(2);

            // With descendantDepth=2, we should reach grandchildren (depth 2)
            expect(selectionFull.maxDescendantGen).toBe(2);
        });
    });

    describe('edge cases', () => {
        it('handles ancestorDepth=1 (only parents)', () => {
            const selectionParentsOnly = selectSubgraph({
                data,
                focusPersonId: 'f' as PersonId,
                ancestorDepth: 1,
                descendantDepth: 0,
                includeSpouseAncestors: false,
                includeParentSiblings: false,
                includeParentSiblingDescendants: false
            });

            // Parents should be included
            expect(selectionParentsOnly.persons.has('m' as PersonId)).toBe(true);
            expect(selectionParentsOnly.persons.has('d' as PersonId)).toBe(true);

            // Grandparents should NOT be included
            expect(selectionParentsOnly.persons.has('gm1' as PersonId)).toBe(false);
            expect(selectionParentsOnly.persons.has('gd1' as PersonId)).toBe(false);
        });

        it('handles descendantDepth=1 (only children, no grandchildren)', () => {
            const selectionChildrenOnly = selectSubgraph({
                data,
                focusPersonId: 'f' as PersonId,
                ancestorDepth: 0,
                descendantDepth: 1,
                includeSpouseAncestors: false,
                includeParentSiblings: false,
                includeParentSiblingDescendants: false
            });

            // Children should be included
            expect(selectionChildrenOnly.persons.has('c1' as PersonId)).toBe(true);
            expect(selectionChildrenOnly.persons.has('c2' as PersonId)).toBe(true);
            expect(selectionChildrenOnly.persons.has('c3' as PersonId)).toBe(true);

            // Grandchildren should NOT be included
            expect(selectionChildrenOnly.persons.has('gc1' as PersonId)).toBe(false);
        });

        it('handles zero depths (focus only)', () => {
            const selectionFocusOnly = selectSubgraph({
                data,
                focusPersonId: 'f' as PersonId,
                ancestorDepth: 0,
                descendantDepth: 0,
                includeSpouseAncestors: false,
                includeParentSiblings: false,
                includeParentSiblingDescendants: false
            });

            // Focus and partner should be included
            expect(selectionFocusOnly.persons.has('f' as PersonId)).toBe(true);
            expect(selectionFocusOnly.persons.has('p' as PersonId)).toBe(true);

            // Siblings should still be included (siblings of focus are always included)
            expect(selectionFocusOnly.persons.has('s1' as PersonId)).toBe(true);

            // Parents should NOT be included
            expect(selectionFocusOnly.persons.has('m' as PersonId)).toBe(false);
            expect(selectionFocusOnly.persons.has('d' as PersonId)).toBe(false);

            // Children should NOT be included
            expect(selectionFocusOnly.persons.has('c1' as PersonId)).toBe(false);
        });
    });

    describe('determinism', () => {
        it('produces same result on repeated calls', () => {
            const selection1 = selectSubgraph({
                data,
                focusPersonId: 'f' as PersonId,
                ancestorDepth: 2,
                descendantDepth: 2,
                includeSpouseAncestors: false,
                includeParentSiblings: true,
                includeParentSiblingDescendants: true
            });

            const selection2 = selectSubgraph({
                data,
                focusPersonId: 'f' as PersonId,
                ancestorDepth: 2,
                descendantDepth: 2,
                includeSpouseAncestors: false,
                includeParentSiblings: true,
                includeParentSiblingDescendants: true
            });

            // Same persons
            expect(selection1.persons.size).toBe(selection2.persons.size);
            for (const personId of selection1.persons) {
                expect(selection2.persons.has(personId)).toBe(true);
            }

            // Same partnerships
            expect(selection1.partnerships.size).toBe(selection2.partnerships.size);
            for (const partnershipId of selection1.partnerships) {
                expect(selection2.partnerships.has(partnershipId)).toBe(true);
            }

            // Same metrics
            expect(selection1.maxAncestorGen).toBe(selection2.maxAncestorGen);
            expect(selection1.maxDescendantGen).toBe(selection2.maxDescendantGen);
        });
    });
});
