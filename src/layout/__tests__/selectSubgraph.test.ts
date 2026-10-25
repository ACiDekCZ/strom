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
import { planShownChildrenFolding, runLayoutPipeline } from '../pipeline/index.js';
import { PersonId, PartnershipId, StromData, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
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

describe('a child of several marriages shown in place: the standard mode brings one partner', () => {
    // edge-shown-sibling-marriages (invented): the focus Elsa's mother Nora
    // has a brother Teo out of view, married three times: Mira (1990, no
    // children), Lena (1996, their son Kai) and Zoe (2010, no children),
    // listed in the data as Zoe, Lena, Mira. "▸ siblings" on Nora shows the
    // children of her parents in place; "▸ children" on Teo shows his son.
    const ids = (...xs: string[]) => xs as PersonId[];
    const TEO_PARTNERS = ids('sib_w1', 'sib_w2', 'sib_w3');
    const shown = (expandChildrenOf: PersonId[], autoExpand: boolean) => planShownChildrenFolding({
        data: loadFixture('edge-shown-sibling-marriages'), focusPersonId: 'focus' as PersonId, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 2, descendantDepth: 2,
        includeSpouseAncestors: false, includeParentSiblings: false, includeParentSiblingDescendants: false,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        expandChildrenOf,
    }).result;
    const drawnPartners = (r: { positions: ReadonlyMap<PersonId, unknown> }) => TEO_PARTNERS.filter(id => r.positions.has(id));

    it('no children in view: the partner of the first marriage in the marriage order (not the data order, not the union with children)', () => {
        const r = shown(ids('father', 'mother'), false);
        expect(r.positions.has('sib' as PersonId)).toBe(true);
        expect(drawnPartners(r)).toEqual(ids('sib_w1'));
        expect(r.positions.has('sib_c2' as PersonId)).toBe(false);
    });

    it('the children of the second marriage in view: the partner of that marriage, only', () => {
        const r = shown(ids('father', 'mother', 'sib'), false);
        expect(drawnPartners(r)).toEqual(ids('sib_w2'));
        expect(r.positions.has('sib_c2' as PersonId)).toBe(true);
    });

    it('the selection carries only the partner drawn', () => {
        const data = loadFixture('edge-shown-sibling-marriages');
        for (const [personIds, partner] of [[ids('father', 'mother'), 'sib_w1'], [ids('father', 'mother', 'sib'), 'sib_w2']] as const) {
            const selection = selectSubgraph({
                data, focusPersonId: 'focus' as PersonId, ancestorDepth: 2, descendantDepth: 2,
                includeSpouseAncestors: false, includeParentSiblings: false, includeParentSiblingDescendants: false
            });
            expandChildrenInSelection(data, selection, personIds, false);
            expect(TEO_PARTNERS.filter(id => selection.persons.has(id)), personIds.join('+')).toEqual([partner]);
        }
    });

    it('with every partner drawn: all three, in a chain', () => {
        for (const personIds of [ids('father', 'mother'), ids('father', 'mother', 'sib')]) {
            const r = shown(personIds, true);
            expect(drawnPartners(r), personIds.join('+')).toEqual(TEO_PARTNERS);
        }
    });

    it('comprehensive, the cousin\'s view: the uncle of two marriages with children comes with the first one\'s partner', () => {
        // Father Focus married Mother, then Stepmother (no dates: the data order)
        const r = planShownChildrenFolding({
            data: loadFixture('comprehensive'), focusPersonId: 'cousin_h_1' as PersonId, config: DEFAULT_LAYOUT_CONFIG,
            ancestorDepth: 1, descendantDepth: 1,
            includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
            displayPolicy: { mode: 'standard', autoExpand: false },
            extraDepthFor: ids('uncle_h_1'), expandChildrenOf: ids('gp_h_h', 'gp_h_w'),
        }).result;
        expect(r.positions.has('mother' as PersonId)).toBe(true);
        expect(r.positions.has('stepmother' as PersonId)).toBe(false);
    });
});

describe('"▸ ∞" on a child shown in place in the standard mode: every marriage (round 5 §36)', () => {
    // edge-shown-sibling-marriages (invented): Teo, shown in place by his
    // parents' children, stands with Mira (the first marriage, no children);
    // his "▸ ∞" shows the other marriages: Lena with their son Kai and Zoe.
    const ids = (...xs: string[]) => xs as PersonId[];
    const unions = (...xs: string[]) => xs as PartnershipId[];
    const shown = (showPartnerUnions: PartnershipId[], extra: { expandChildrenOf?: PersonId[] } = {}) => planShownChildrenFolding({
        data: loadFixture('edge-shown-sibling-marriages'), focusPersonId: 'focus' as PersonId, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 2, descendantDepth: 2,
        includeSpouseAncestors: false, includeParentSiblings: false, includeParentSiblingDescendants: false,
        displayPolicy: { mode: 'standard', autoExpand: false },
        expandChildrenOf: ids('father', 'mother'), ...extra,
        ...(showPartnerUnions.length ? { showPartnerUnions } : {}),
    }).result;
    const drawn = (r: { positions: ReadonlyMap<PersonId, unknown> }, ...xs: string[]) => xs.filter(id => r.positions.has(id as PersonId));

    it('the marriage with children: Lena comes with Kai and Mira goes (the partners exchanged), as by "▸ children"', () => {
        const r = shown(unions('u_sib_2'));
        expect(drawn(r, 'sib', 'sib_w1', 'sib_w2', 'sib_w3', 'sib_c2')).toEqual(['sib', 'sib_w2', 'sib_c2']);
        const children = shown([], { expandChildrenOf: ids('father', 'mother', 'sib') });
        for (const id of ids('sib', 'sib_w2', 'sib_c2')) expect(r.positions.get(id), id).toEqual(children.positions.get(id));
    });

    it('every marriage offered: Lena with Kai and Zoe beside in Teo\'s row; Mira goes', () => {
        const r = shown(unions('u_sib_2', 'u_sib_3'));
        expect(drawn(r, 'sib', 'sib_w1', 'sib_w2', 'sib_w3', 'sib_c2')).toEqual(['sib', 'sib_w2', 'sib_w3', 'sib_c2']);
        const y = (id: string) => r.positions.get(id as PersonId)!.y;
        expect(y('sib_w2')).toBe(y('sib'));
        expect(y('sib_w3')).toBe(y('sib'));
        expect(r.diagnostics.validationPassed).toBe(true);
    });

    it('a marriage without children: Zoe comes beside, Mira stays', () => {
        const r = shown(unions('u_sib_3'));
        expect(drawn(r, 'sib', 'sib_w1', 'sib_w2', 'sib_w3', 'sib_c2')).toEqual(['sib', 'sib_w1', 'sib_w3']);
    });

    it('closing gives the view before back, position for position', () => {
        const before = shown([]);
        shown(unions('u_sib_2', 'u_sib_3'));
        expect([...shown([]).positions]).toEqual([...before.positions]);
    });

    it('a union whose persons are both drawn changes nothing', () => {
        const before = shown([]);
        expect([...shown(unions('u_parents', 'u_nora')).positions]).toEqual([...before.positions]);
    });
});

describe('"▸ ∞" on a person in the plain depth: every marriage, one by one (round 6 §46, §42)', () => {
    const unions = (...xs: string[]) => xs as PartnershipId[];
    const layout = (fixture: string, focus: string, depth: number, showPartnerUnions: PartnershipId[] = []) => runLayoutPipeline({
        data: loadFixture(fixture), focusPersonId: focus as PersonId, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand: false },
        ...(showPartnerUnions.length ? { showPartnerUnions } : {}),
    });
    const drawn = (r: { positions: ReadonlyMap<PersonId, unknown> }, ...xs: string[]) => xs.filter(id => r.positions.has(id as PersonId));
    const kept = (before: { positions: ReadonlyMap<PersonId, unknown> }, after: { positions: ReadonlyMap<PersonId, unknown> }) =>
        [...before.positions.keys()].filter(id => !after.positions.has(id));

    it('the father\'s second marriage (comprehensive): the stepmother comes with the half-sibling, the mother stays', () => {
        const before = layout('comprehensive', 'focus', 2);
        expect(drawn(before, 'stepmother', 'halfsibling_1')).toEqual([]);
        const r = layout('comprehensive', 'focus', 2, unions('part_father_2nd'));
        expect(drawn(r, 'father', 'mother', 'stepmother', 'halfsibling_1')).toEqual(['father', 'mother', 'stepmother', 'halfsibling_1']);
        expect(kept(before, r)).toEqual([]);
        expect(r.positions.get('stepmother' as PersonId)!.y).toBe(r.positions.get('father' as PersonId)!.y);
        expect(r.diagnostics.validationPassed).toBe(true);
        // Closing: the input without the union gives the view back, position for position
        expect([...layout('comprehensive', 'focus', 2).positions]).toEqual([...before.positions]);
    });

    it('a partner the selection holds undrawn (the standard mode draws one union per person) comes with the children', () => {
        // Focus a great-grandfather at depth 2: the father stands with the stepmother, the mother is held but not drawn
        const before = layout('comprehensive', 'ggp_h_h', 2);
        expect(drawn(before, 'father', 'stepmother', 'mother')).toEqual(['father', 'stepmother']);
        const r = layout('comprehensive', 'ggp_h_h', 2, unions('part_parents'));
        expect(drawn(r, 'mother', 'sibling_1', 'focus', 'sibling_2')).toEqual(['mother', 'sibling_1', 'focus', 'sibling_2']);
        expect(kept(before, r)).toEqual([]);
    });

    it('one name of several: only that marriage joins the chain, the other partners the selection holds stay undrawn', () => {
        // The hub of four marriages stands with the first; a click on the second partner's name brings only that one
        const before = layout('etalon-multi-partners', 'eE_v4_hub', 2);
        expect(drawn(before, 'eE_v4_p0', 'eE_v4_p1', 'eE_v4_p2', 'eE_v4_p3')).toEqual(['eE_v4_p0']);
        const r = layout('etalon-multi-partners', 'eE_v4_hub', 2, unions('u_eE_v4_hub_eE_v4_p1'));
        expect(drawn(r, 'eE_v4_p0', 'eE_v4_p1', 'eE_v4_p2', 'eE_v4_p3', 'eE_v4_k1')).toEqual(['eE_v4_p0', 'eE_v4_p1', 'eE_v4_k1']);
        const all = layout('etalon-multi-partners', 'eE_v4_hub', 2,
            unions('u_eE_v4_hub_eE_v4_p1', 'u_eE_v4_hub_eE_v4_p2', 'u_eE_v4_hub_eE_v4_p3'));
        expect(drawn(all, 'eE_v4_p0', 'eE_v4_p1', 'eE_v4_p2', 'eE_v4_p3')).toEqual(['eE_v4_p0', 'eE_v4_p1', 'eE_v4_p2', 'eE_v4_p3']);
    });
});
