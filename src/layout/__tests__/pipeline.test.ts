/**
 * Layout Pipeline Smoke Tests
 *
 * Basic tests to verify the pipeline executes correctly and
 * respects fundamental layout invariants.
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runPipeline } from './helpers/runPipeline.js';
import {
    assertNoNodeOverlap,
    assertNoEdgeCrossings,
    assertNoBusOverlap,
    assertValidPositions
} from './helpers/assertions.js';
import { PersonId } from '../../types.js';

describe('Layout Pipeline', () => {
    describe('simple-family fixture', () => {
        it('runs without errors', () => {
            const data = loadFixture('simple-family');
            const focusId = 'p1' as PersonId;

            const stages = runPipeline(data, focusId);

            expect(stages.result).toBeDefined();
            expect(stages.result.positions.size).toBeGreaterThan(0);
        });

        it('produces valid positions', () => {
            const data = loadFixture('simple-family');
            const focusId = 'p1' as PersonId;

            const { result } = runPipeline(data, focusId);

            assertValidPositions(result.positions);
        });

        it('produces no card overlaps', () => {
            const data = loadFixture('simple-family');
            const focusId = 'p1' as PersonId;

            const { result } = runPipeline(data, focusId);

            assertNoNodeOverlap(result.positions);
        });

        it('produces no edge crossings', () => {
            const data = loadFixture('simple-family');
            const focusId = 'p1' as PersonId;

            const { result } = runPipeline(data, focusId);

            assertNoEdgeCrossings(result.connections);
        });

        it('produces no bus overlaps', () => {
            const data = loadFixture('simple-family');
            const focusId = 'p1' as PersonId;

            const { result } = runPipeline(data, focusId);

            assertNoBusOverlap(result.connections);
        });
    });

    describe('diagnostics', () => {
        it('reports correct person count', () => {
            const data = loadFixture('simple-family');
            const focusId = 'p1' as PersonId;

            const { result } = runPipeline(data, focusId);

            // simple-family has 4 persons: John, Mary, Tom, Lisa
            expect(result.diagnostics.totalPersons).toBe(4);
        });

        it('reports validation status', () => {
            const data = loadFixture('simple-family');
            const focusId = 'p1' as PersonId;

            const { result } = runPipeline(data, focusId);

            expect(typeof result.diagnostics.validationPassed).toBe('boolean');
            expect(Array.isArray(result.diagnostics.errors)).toBe(true);
        });
    });
});
