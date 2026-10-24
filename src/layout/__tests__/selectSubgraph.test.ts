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
import { selectSubgraph, extendAncestorDepth, expandChildrenInSelection } from '../pipeline/1-select-subgraph.js';
import { planShownChildrenFolding } from '../pipeline/index.js';
import { PersonId, StromData, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
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

describe('children shown in place come with their partners', () => {
    // "▸ siblings" of the father at ancestor depth 1 (comprehensive): the
    // grandparents beyond the depth and their children shown in place. The
    // aunt and the uncle come with their partners, as the plain depth draws
    // a relative, never with their children (the cousins come with the
    // uncle's own "▸ children").
    const ids = (...xs: string[]) => xs as PersonId[];
    const shownSiblings = (focus: string, edge: string, autoExpand: boolean) => planShownChildrenFolding({
        data: loadFixture('comprehensive'), focusPersonId: focus as PersonId, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 1, descendantDepth: 1,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        extraDepthFor: ids(edge), expandChildrenOf: ids('gp_h_h', 'gp_h_w'),
    }).result;

    it('the selection holds the aunt\'s and the uncle\'s partners, not the cousins', () => {
        const data = loadFixture('comprehensive');
        const selection = selectSubgraph({
            data, focusPersonId: 'focus' as PersonId, ancestorDepth: 1, descendantDepth: 1,
            includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true
        });
        extendAncestorDepth(data, selection, ids('father'), () => new Set());
        expandChildrenInSelection(data, selection, ids('gp_h_h', 'gp_h_w'));
        for (const id of ids('uncle_h_1', 'aunt_h_1', 'aunt_h_1_spouse', 'uncle_h_1_husband')) expect(selection.persons.has(id), id).toBe(true);
        for (const id of ids('cousin_h_1', 'cousin_h_2', 'cousin_h_3', 'cousin_h_4')) expect(selection.persons.has(id), id).toBe(false);
    });

    it('the layout draws them beside the aunt and the uncle', () => {
        const r = shownSiblings('focus', 'father', false);
        for (const id of ids('uncle_h_1', 'aunt_h_1', 'aunt_h_1_spouse', 'uncle_h_1_husband')) expect(r.positions.has(id), id).toBe(true);
        for (const id of ids('cousin_h_1', 'cousin_h_2', 'cousin_h_3', 'cousin_h_4')) expect(r.positions.has(id), id).toBe(false);
    });

    it('with every partner drawn, an uncle of two marriages stands with both partners', () => {
        // The cousin's view: the father is an uncle, married twice
        const r = shownSiblings('cousin_h_1', 'uncle_h_1', true);
        for (const id of ids('father', 'mother', 'stepmother', 'aunt_h_1', 'uncle_h_1_husband')) expect(r.positions.has(id), id).toBe(true);
        for (const id of ids('focus', 'halfsibling_1', 'cousin_h_4')) expect(r.positions.has(id), id).toBe(false);
    });
});
