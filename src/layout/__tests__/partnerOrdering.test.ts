/**
 * Partner Ordering Invariant Tests
 *
 * Verifies that in every union, partnerA (left) has a smaller center X
 * than partnerB (right). This ensures deterministic, stable couple placement.
 *
 * Expected: PASS on current layout (basic ordering is handled correctly).
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runPipeline } from './helpers/runPipeline.js';
import { assertPartnerOrdering } from './helpers/assertions.js';
import { PersonId } from '../../types.js';

describe('Partner Ordering Invariant', () => {
    it('simple-family: all couples have A left of B', () => {
        const data = loadFixture('simple-family');
        const { constrained } = runPipeline(data, 'c1' as PersonId, {
            ancestorDepth: 2,
            descendantDepth: 2
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });

    it('two-sibling-families: all couples ordered correctly', () => {
        const data = loadFixture('two-sibling-families-with-children');
        const { constrained } = runPipeline(data, 'c1' as PersonId, {
            ancestorDepth: 2,
            descendantDepth: 2
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });

    it('comprehensive (focus, depth 5): all couples ordered correctly', () => {
        const data = loadFixture('comprehensive');
        const { constrained } = runPipeline(data, 'focus' as PersonId, {
            ancestorDepth: 5,
            descendantDepth: 5
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });

    it('comprehensive (focus, depth 3): all couples ordered correctly', () => {
        const data = loadFixture('comprehensive');
        const { constrained } = runPipeline(data, 'focus' as PersonId, {
            ancestorDepth: 3,
            descendantDepth: 3
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });

    it('comprehensive (sibling_1, depth 5): all couples ordered correctly', () => {
        const data = loadFixture('comprehensive');
        const { constrained } = runPipeline(data, 'sibling_1' as PersonId, {
            ancestorDepth: 5,
            descendantDepth: 5
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });
});
