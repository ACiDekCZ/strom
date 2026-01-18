/**
 * measureSubtrees Unit Tests
 *
 * Tests that measureSubtrees correctly computes widths:
 * - personWidth = always cardWidth (130)
 * - unionWidth = cardWidth*2 + partnerGap for couples (272), cardWidth for single (130)
 * - subtreeWidth = max(unionWidth, childrenTotalWidth)
 * - Width grows with number of children and tree depth
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { buildLayoutModel } from '../pipeline/2-build-model.js';
import { assignGenerations } from '../pipeline/3-assign-generations.js';
import { measureSubtrees } from '../pipeline/4-measure.js';
import { PersonId, PartnershipId, StromData, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import { GraphSelection, MeasuredModel, UnionId } from '../pipeline/types.js';

describe('measureSubtrees', () => {
    let data: StromData;
    let selection: GraphSelection;
    let measured: MeasuredModel;

    // Config values for calculations
    const config = DEFAULT_LAYOUT_CONFIG;
    const cardWidth = config.cardWidth;           // 130
    const partnerGap = config.partnerGap;         // 12
    const horizontalGap = config.horizontalGap;   // 15
    const coupleWidth = cardWidth * 2 + partnerGap;  // 272
    const singleWidth = cardWidth;                   // 130

    // All person IDs from fixture
    const ALL_PERSON_IDS = [
        'parent1', 'parent2',     // union with 1 child (gen -1)
        'parent3', 'parent4',     // union with 3 children (gen -1)
        'c1',                     // only child of parent1+parent2 (focus, gen 0)
        'c2',                     // child of parent3+parent4 (single, gen 0)
        'c3', 'c3p',              // child of parent3+parent4 + partner (gen 0)
        'c4',                     // child of parent3+parent4 (single, gen 0)
        'gc1'                     // grandchild of c3+c3p (gen +1)
    ] as PersonId[];

    const ALL_PARTNERSHIP_IDS = [
        'part_1kid', 'part_3kids', 'part_c3'
    ] as PartnershipId[];

    beforeAll(() => {
        data = loadFixture('t4_measure_widths');

        // Create selection with all persons
        selection = {
            persons: new Set(ALL_PERSON_IDS),
            partnerships: new Set(ALL_PARTNERSHIP_IDS),
            focusPersonId: 'c1' as PersonId,
            maxAncestorGen: 1,
            maxDescendantGen: 2
        };

        const model = buildLayoutModel({ data, selection, focusPersonId: 'c1' as PersonId });
        const genModel = assignGenerations({ model, focusPersonId: 'c1' as PersonId });
        measured = measureSubtrees({ genModel, config });
    });

    // Helper to find union by partnership ID
    function findUnionByPartnership(partnershipId: PartnershipId): UnionId | undefined {
        for (const [unionId, union] of measured.genModel.model.unions) {
            if (union.partnershipId === partnershipId) {
                return unionId;
            }
        }
        return undefined;
    }

    // Helper to find union containing a specific person (as partnerA or partnerB)
    function findUnionContainingPerson(personId: PersonId): UnionId | undefined {
        return measured.genModel.model.personToUnion.get(personId);
    }

    describe('personWidth', () => {
        it('all persons have width equal to cardWidth', () => {
            for (const personId of ALL_PERSON_IDS) {
                const width = measured.personWidth.get(personId);
                expect(width).toBe(cardWidth);
            }
        });

        it('personWidth is always >= cardWidth', () => {
            for (const [personId, width] of measured.personWidth) {
                expect(width).toBeGreaterThanOrEqual(cardWidth);
            }
        });
    });

    describe('unionWidth', () => {
        it('couple union has width = cardWidth*2 + partnerGap', () => {
            // part_1kid is a couple (parent1 + parent2)
            const union1kid = findUnionByPartnership('part_1kid' as PartnershipId);
            expect(union1kid).toBeDefined();
            const width = measured.unionWidth.get(union1kid!);
            expect(width).toBe(coupleWidth); // 272
        });

        it('single-person union has width = cardWidth', () => {
            // c2 is single (no partner)
            const c2UnionId = findUnionContainingPerson('c2' as PersonId);
            expect(c2UnionId).toBeDefined();

            const union = measured.genModel.model.unions.get(c2UnionId!);
            // Verify it's actually a single-person union
            expect(union?.partnerB).toBeNull();

            const width = measured.unionWidth.get(c2UnionId!);
            expect(width).toBe(singleWidth); // 130
        });

        it('unionWidth >= cardWidth for all unions', () => {
            for (const [unionId, width] of measured.unionWidth) {
                expect(width).toBeGreaterThanOrEqual(cardWidth);
            }
        });
    });

    describe('subtreeWidth calculation', () => {
        it('childless union subtreeWidth equals unionWidth', () => {
            // c2 is a single-person union with no children
            const c2UnionId = findUnionContainingPerson('c2' as PersonId);
            expect(c2UnionId).toBeDefined();

            const unionWidth = measured.unionWidth.get(c2UnionId!);
            const subtreeWidth = measured.subtreeWidth.get(c2UnionId!);

            expect(subtreeWidth).toBe(unionWidth);
        });

        it('union with 1 child has subtreeWidth >= child subtreeWidth', () => {
            // part_1kid (parent1+parent2) has 1 child (c1)
            const union1kid = findUnionByPartnership('part_1kid' as PartnershipId);
            const c1UnionId = findUnionContainingPerson('c1' as PersonId);

            expect(union1kid).toBeDefined();
            expect(c1UnionId).toBeDefined();

            const parentSubtree = measured.subtreeWidth.get(union1kid!);
            const childSubtree = measured.subtreeWidth.get(c1UnionId!);

            expect(parentSubtree).toBeGreaterThanOrEqual(childSubtree!);
        });

        it('union with 3 children is wider than union with 1 child', () => {
            const union1kid = findUnionByPartnership('part_1kid' as PartnershipId);
            const union3kids = findUnionByPartnership('part_3kids' as PartnershipId);

            expect(union1kid).toBeDefined();
            expect(union3kids).toBeDefined();

            const width1kid = measured.subtreeWidth.get(union1kid!);
            const width3kids = measured.subtreeWidth.get(union3kids!);

            expect(width3kids).toBeGreaterThan(width1kid!);
        });

        it('subtreeWidth >= sum of child subtree widths plus gaps', () => {
            // part_3kids has 3 child unions: c2 (single), c3+c3p (couple), c4 (single)
            const union3kids = findUnionByPartnership('part_3kids' as PartnershipId);
            expect(union3kids).toBeDefined();

            const c2UnionId = findUnionContainingPerson('c2' as PersonId);
            const c3UnionId = findUnionContainingPerson('c3' as PersonId);
            const c4UnionId = findUnionContainingPerson('c4' as PersonId);

            expect(c2UnionId).toBeDefined();
            expect(c3UnionId).toBeDefined();
            expect(c4UnionId).toBeDefined();

            const c2Subtree = measured.subtreeWidth.get(c2UnionId!)!;
            const c3Subtree = measured.subtreeWidth.get(c3UnionId!)!;
            const c4Subtree = measured.subtreeWidth.get(c4UnionId!)!;

            // 3 children = 2 gaps
            const childrenTotal = c2Subtree + c3Subtree + c4Subtree + 2 * horizontalGap;

            const parentSubtree = measured.subtreeWidth.get(union3kids!);
            expect(parentSubtree).toBeGreaterThanOrEqual(childrenTotal);
        });

        it('subtreeWidth >= unionWidth for all unions', () => {
            for (const [unionId, subtreeWidth] of measured.subtreeWidth) {
                const unionWidth = measured.unionWidth.get(unionId);
                expect(subtreeWidth).toBeGreaterThanOrEqual(unionWidth!);
            }
        });
    });

    describe('gap calculation', () => {
        it('gaps between children are included in calculation', () => {
            // part_3kids has 3 children, so childrenTotalWidth includes 2 gaps
            const union3kids = findUnionByPartnership('part_3kids' as PartnershipId);
            expect(union3kids).toBeDefined();

            const subtreeWidth = measured.subtreeWidth.get(union3kids!)!;

            // Minimum possible subtree with 3 children (all singles, no deeper subtrees):
            // 3 * cardWidth + 2 * horizontalGap = 3*130 + 2*15 = 420
            // But c3+c3p is a couple, so min is: 130 + 272 + 130 + 2*15 = 562
            expect(subtreeWidth).toBeGreaterThanOrEqual(3 * cardWidth + 2 * horizontalGap);
        });

        it('no gaps for single child', () => {
            // part_1kid has 1 child (c1)
            const union1kid = findUnionByPartnership('part_1kid' as PartnershipId);
            expect(union1kid).toBeDefined();

            // With single child, subtreeWidth = max(unionWidth, childSubtreeWidth)
            // No gaps are added for 1 child
            const unionWidth = measured.unionWidth.get(union1kid!)!;
            const c1UnionId = findUnionContainingPerson('c1' as PersonId);
            const c1Subtree = measured.subtreeWidth.get(c1UnionId!)!;

            const subtreeWidth = measured.subtreeWidth.get(union1kid!)!;
            expect(subtreeWidth).toBe(Math.max(unionWidth, c1Subtree));
        });

        it('(n-1) gaps for n children', () => {
            // part_3kids has 3 children
            // Total children width = c2 + c3+c3p + c4 + 2*gap
            const union3kids = findUnionByPartnership('part_3kids' as PartnershipId);
            expect(union3kids).toBeDefined();

            const c2UnionId = findUnionContainingPerson('c2' as PersonId);
            const c3UnionId = findUnionContainingPerson('c3' as PersonId);
            const c4UnionId = findUnionContainingPerson('c4' as PersonId);

            const c2Subtree = measured.subtreeWidth.get(c2UnionId!)!;
            const c3Subtree = measured.subtreeWidth.get(c3UnionId!)!;
            const c4Subtree = measured.subtreeWidth.get(c4UnionId!)!;

            // n = 3 children means n-1 = 2 gaps
            const expectedChildrenWidth = c2Subtree + c3Subtree + c4Subtree + 2 * horizontalGap;

            const union3kidsWidth = measured.unionWidth.get(union3kids!)!;
            const subtreeWidth = measured.subtreeWidth.get(union3kids!)!;

            // subtreeWidth = max(unionWidth, childrenTotalWidth)
            expect(subtreeWidth).toBe(Math.max(union3kidsWidth, expectedChildrenWidth));
        });
    });

    describe('nested subtrees', () => {
        it('grandchild expands parent subtree width', () => {
            // c3+c3p has child gc1
            // c3+c3p subtreeWidth should be >= gc1 subtreeWidth
            const c3UnionId = findUnionContainingPerson('c3' as PersonId);
            const gc1UnionId = findUnionContainingPerson('gc1' as PersonId);

            expect(c3UnionId).toBeDefined();
            expect(gc1UnionId).toBeDefined();

            const c3Subtree = measured.subtreeWidth.get(c3UnionId!)!;
            const gc1Subtree = measured.subtreeWidth.get(gc1UnionId!)!;

            expect(c3Subtree).toBeGreaterThanOrEqual(gc1Subtree);
        });

        it('tree depth affects ancestor width', () => {
            // c3+c3p has a child (gc1), making its subtree potentially wider
            // c2 and c4 have no children

            const c2UnionId = findUnionContainingPerson('c2' as PersonId);
            const c3UnionId = findUnionContainingPerson('c3' as PersonId);
            const c4UnionId = findUnionContainingPerson('c4' as PersonId);

            const c2Subtree = measured.subtreeWidth.get(c2UnionId!)!;
            const c3Subtree = measured.subtreeWidth.get(c3UnionId!)!;
            const c4Subtree = measured.subtreeWidth.get(c4UnionId!)!;

            // c3+c3p is a couple (272) with child gc1 (130)
            // c3 subtree = max(272, 130) = 272
            // c2 is single (130), c4 is single (130)
            expect(c3Subtree).toBeGreaterThan(c2Subtree);
            expect(c3Subtree).toBeGreaterThan(c4Subtree);
        });
    });

    describe('concrete values', () => {
        it('union1kid has expected subtreeWidth (272)', () => {
            // union1kid: couple width = 272, child c1 is single = 130
            // subtreeWidth = max(272, 130) = 272
            const union1kid = findUnionByPartnership('part_1kid' as PartnershipId);
            expect(union1kid).toBeDefined();

            const subtreeWidth = measured.subtreeWidth.get(union1kid!);
            expect(subtreeWidth).toBe(272);
        });

        it('union3kids has expected subtreeWidth (562)', () => {
            // union3kids: couple width = 272
            // children:
            //   c2: single, no children -> subtreeWidth = 130
            //   c3+c3p: couple (272), child gc1 (130) -> subtreeWidth = max(272, 130) = 272
            //   c4: single, no children -> subtreeWidth = 130
            // childrenTotalWidth = 130 + 272 + 130 + 2*15 = 562
            // subtreeWidth = max(272, 562) = 562
            const union3kids = findUnionByPartnership('part_3kids' as PartnershipId);
            expect(union3kids).toBeDefined();

            const subtreeWidth = measured.subtreeWidth.get(union3kids!);
            expect(subtreeWidth).toBe(562);
        });
    });

    describe('determinism', () => {
        it('produces same widths on repeated calls', () => {
            const focusPersonId = 'c1' as PersonId;
            const model = buildLayoutModel({ data, selection, focusPersonId });
            const genModel = assignGenerations({ model, focusPersonId });

            // Call measureSubtrees 5 times
            const results: MeasuredModel[] = [];
            for (let i = 0; i < 5; i++) {
                results.push(measureSubtrees({ genModel, config }));
            }

            // Compare all results to first
            const first = results[0];
            for (let i = 1; i < results.length; i++) {
                const current = results[i];

                // Same personWidth values
                expect(current.personWidth.size).toBe(first.personWidth.size);
                for (const [personId, width] of first.personWidth) {
                    expect(current.personWidth.get(personId)).toBe(width);
                }

                // Same unionWidth values
                expect(current.unionWidth.size).toBe(first.unionWidth.size);
                for (const [unionId, width] of first.unionWidth) {
                    expect(current.unionWidth.get(unionId)).toBe(width);
                }

                // Same subtreeWidth values
                expect(current.subtreeWidth.size).toBe(first.subtreeWidth.size);
                for (const [unionId, width] of first.subtreeWidth) {
                    expect(current.subtreeWidth.get(unionId)).toBe(width);
                }
            }
        });
    });
});
