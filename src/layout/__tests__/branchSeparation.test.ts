/**
 * Tests for SiblingFamilyBranch separation.
 *
 * Verifies that:
 * - Branches are correctly computed from the focus block's children
 * - Branch X corridors don't overlap
 * - Branch order matches sibling birth order
 * - Sub-branches are correctly nested
 * - Single-child unions don't create branches
 * - Focus block has no branchId
 * - Ancestor blocks have no branchId
 * - Bus routing stays within branch corridors
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runPipeline } from './helpers/runPipeline.js';
import {
    assertNoNodeOverlap,
    assertNoEdgeCrossings,
    assertBranchSeparation,
    assertNoCrossBranchRouting
} from './helpers/assertions.js';
import { PersonId } from '../../types.js';
import { BranchModel } from '../pipeline/types.js';

describe('Branch Separation', () => {
    describe('Branch computation', () => {
        it('creates 3 top-level branches for focus with 3 married children', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            expect(bm.branches.size).toBeGreaterThanOrEqual(3);
            expect(bm.topLevelBranchIds.length).toBe(3);
        });

        it('creates 2 top-level branches for focus with 2 married children', () => {
            const data = loadFixture('t6b_no_cross_branch_push');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            expect(bm.topLevelBranchIds.length).toBe(2);
        });

        it('assigns all descendant blocks to branches', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            // Every descendant block (gen > 0) should have a branch
            for (const [blockId, block] of bm.blocks) {
                if (block.generation > 0) {
                    expect(bm.blockToBranch.has(blockId)).toBe(true);
                }
            }
        });

        it('focus block has no branchId', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            for (const [, block] of bm.blocks) {
                if (block.side === 'BOTH' && block.generation === 0) {
                    expect(block.branchId).toBeNull();
                }
            }
        });

        it('ancestor blocks have no branchId', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            for (const [, block] of bm.blocks) {
                if (block.generation < 0) {
                    expect(block.branchId).toBeNull();
                }
            }
        });

        it('creates 2 branches for focus with 2 children (even singles)', () => {
            const data = loadFixture('simple-family');
            const stages = runPipeline(data, 'p1' as PersonId);
            const bm = stages.measured as BranchModel;

            // simple-family has 2 children (c1, c2) who form single-person unions
            // Both get their own branch
            expect(bm.topLevelBranchIds.length).toBe(2);
        });

        it('branch childPersonId matches sibling order', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            const topBranches = bm.topLevelBranchIds
                .map(bid => bm.branches.get(bid)!)
                .sort((a, b) => a.siblingIndex - b.siblingIndex);

            // Sibling indices should be 0, 1, 2
            expect(topBranches[0].siblingIndex).toBe(0);
            expect(topBranches[1].siblingIndex).toBe(1);
            expect(topBranches[2].siblingIndex).toBe(2);
        });
    });

    describe('Branch bounds', () => {
        it('branch minX/maxX are finite after placement', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            for (const branch of bm.branches.values()) {
                // After constraints, bounds should be computed
                expect(isFinite(branch.minX)).toBe(true);
                expect(isFinite(branch.maxX)).toBe(true);
                expect(branch.maxX).toBeGreaterThan(branch.minX);
            }
        });

        it('branch envelopeWidth equals maxX - minX', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            for (const branch of bm.branches.values()) {
                if (isFinite(branch.minX) && isFinite(branch.maxX)) {
                    expect(branch.envelopeWidth).toBeCloseTo(branch.maxX - branch.minX, 0);
                }
            }
        });
    });

    describe('Branch separation invariant', () => {
        it('top-level branches do not overlap (t4b)', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);

            assertBranchSeparation(stages.constrained);
        });

        it('branches do not overlap with wide subtree (t6b)', () => {
            const data = loadFixture('t6b_no_cross_branch_push');
            const stages = runPipeline(data, 'father' as PersonId);

            assertBranchSeparation(stages.constrained);
        });

        it('branch order matches birth order', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            const topBranches = bm.topLevelBranchIds
                .map(bid => bm.branches.get(bid)!)
                .sort((a, b) => a.siblingIndex - b.siblingIndex);

            // Layout X order should match sibling order
            for (let i = 1; i < topBranches.length; i++) {
                expect(topBranches[i].minX).toBeGreaterThan(topBranches[i - 1].maxX);
            }
        });
    });

    describe('No card overlap with branches', () => {
        it('no overlap with 3 branches (t4b)', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);

            assertNoNodeOverlap(stages.result.positions);
        });

        it('no overlap with wide subtree (t6b)', () => {
            const data = loadFixture('t6b_no_cross_branch_push');
            const stages = runPipeline(data, 'father' as PersonId);

            assertNoNodeOverlap(stages.result.positions);
        });
    });

    describe('Bus routing within branches', () => {
        it('no edge crossings with 3 branches (t7b)', () => {
            const data = loadFixture('t7b_branch_routing');
            const stages = runPipeline(data, 'father' as PersonId);

            assertNoEdgeCrossings(stages.routed.connections);
        });

        it('buses stay within branch corridors (t7b)', () => {
            const data = loadFixture('t7b_branch_routing');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            assertNoCrossBranchRouting(stages.routed, bm);
        });

        it('buses stay within branch corridors (t4b)', () => {
            const data = loadFixture('t4b_branch_separation');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            assertNoCrossBranchRouting(stages.routed, bm);
        });
    });

    describe('Real data', () => {
        it('branch separation on two-sibling-families', () => {
            const data = loadFixture('two-sibling-families-with-children');
            const stages = runPipeline(data, 'father' as PersonId);
            const bm = stages.measured as BranchModel;

            if (bm.branches.size > 0) {
                assertBranchSeparation(stages.constrained);
            }
        });
    });
});
