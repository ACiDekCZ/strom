/**
 * Locked Positions Test
 *
 * Verifies that Phase B doesn't modify gen >= -1 positions established in Phase A.
 * This is a critical invariant: focus parents (gen -1) and descendant positions (gen >= 0) are locked after Phase A.
 * Phase B only operates on gen -2 and beyond (grandparents and up).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PersonId, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import { loadFixture } from './helpers/loadFixture.js';
import { selectSubgraph } from '../pipeline/1-select-subgraph.js';
import { buildLayoutModel } from '../pipeline/2-build-model.js';
import { assignGenerations } from '../pipeline/3-assign-generations.js';
import { measureSubtrees } from '../pipeline/4-measure.js';
import { placeX } from '../pipeline/5-place-x.js';
import { applyConstraints } from '../pipeline/6-constraints.js';
import { ConstrainedModel, GenerationalModel } from '../pipeline/types.js';

const FIXTURE = process.env.FIXTURE || 'comprehensive';
const DEPTH = parseInt(process.env.DEPTH || '5', 10);

const config = DEFAULT_LAYOUT_CONFIG;

// Load test data
const testData = loadFixture(FIXTURE);

/**
 * Capture gen >= -1 positions from a ConstrainedModel.
 * This includes focus parents (gen -1) and all descendants (gen >= 0).
 */
function captureLockedPositions(
    constrained: ConstrainedModel,
    genModel: GenerationalModel
): { personX: Map<PersonId, number>; unionX: Map<string, number> } {
    const { placed } = constrained;
    const { personX, unionX } = placed;

    const captured = {
        personX: new Map<PersonId, number>(),
        unionX: new Map<string, number>()
    };

    // Capture person positions for gen >= -1 (parents + focus + descendants)
    for (const [pid, gen] of genModel.personGen) {
        if (gen >= -1) {
            const x = personX.get(pid);
            if (x !== undefined) {
                captured.personX.set(pid, x);
            }
        }
    }

    // Capture union positions for gen >= -1 (parents + focus + descendants)
    for (const [uid, gen] of genModel.unionGen) {
        if (gen >= -1) {
            const x = unionX.get(uid);
            if (x !== undefined) {
                captured.unionX.set(uid, x);
            }
        }
    }

    return captured;
}

/**
 * Compare two position snapshots and return violations.
 */
function findPositionChanges(
    phaseA: { personX: Map<PersonId, number>; unionX: Map<string, number> },
    final: { personX: Map<PersonId, number>; unionX: Map<string, number> },
    tolerance = 0.5
): string[] {
    const violations: string[] = [];

    // Check person positions
    for (const [pid, oldX] of phaseA.personX) {
        const newX = final.personX.get(pid);
        if (newX !== undefined) {
            const delta = Math.abs(newX - oldX);
            if (delta > tolerance) {
                violations.push(
                    `Person ${pid}: moved from ${oldX.toFixed(1)} to ${newX.toFixed(1)} (Δ=${delta.toFixed(1)})`
                );
            }
        }
    }

    // Check union positions
    for (const [uid, oldX] of phaseA.unionX) {
        const newX = final.unionX.get(uid);
        if (newX !== undefined) {
            const delta = Math.abs(newX - oldX);
            if (delta > tolerance) {
                violations.push(
                    `Union ${uid}: moved from ${oldX.toFixed(1)} to ${newX.toFixed(1)} (Δ=${delta.toFixed(1)})`
                );
            }
        }
    }

    return violations;
}

describe(`Locked Positions Invariant [${FIXTURE}.json, depth=${DEPTH}]`, () => {
    // Get all person IDs from test data
    const allPersonIds = Object.keys(testData.persons) as PersonId[];

    // Test a sample of persons (every 3rd person for reasonable speed)
    const samplePersonIds = allPersonIds.filter((_, i) => i % 3 === 0);

    describe('Phase B must not modify gen >= -1 positions', () => {
        for (const focusPersonId of samplePersonIds) {
            const person = testData.persons[focusPersonId];
            const displayName = `${person?.firstName ?? '?'} ${person?.lastName ?? '?'}`;

            it(`${displayName} (${focusPersonId})`, () => {
                // Build selection
                const selection = selectSubgraph({
                    data: testData,
                    focusPersonId,
                    ancestorDepth: DEPTH,
                    descendantDepth: DEPTH,
                    includeSpouseAncestors: false,
                    includeParentSiblings: false,
                    includeParentSiblingDescendants: false
                });

                // Build model through Phase A
                const model = buildLayoutModel({ data: testData, selection, focusPersonId });
                const genModel = assignGenerations({ model, focusPersonId });
                const measured = measureSubtrees({ genModel, config, focusPersonId });
                const placed = placeX({ measured, config });

                // Run constraints with Phase A only
                const phaseAResult = applyConstraints({
                    placed,
                    config,
                    focusPersonId,
                    maxIterations: 20,
                    tolerance: 0.5,
                    stopAfterPhase: 'A'
                });

                // Capture gen >= -1 positions after Phase A (parents + focus + descendants)
                const phaseAPositions = captureLockedPositions(phaseAResult, genModel);

                // Run full constraints (Phase A + B)
                const fullResult = applyConstraints({
                    placed,
                    config,
                    focusPersonId,
                    maxIterations: 20,
                    tolerance: 0.5
                    // No stopAfterPhase = run all phases
                });

                // Capture final positions
                const finalPositions = captureLockedPositions(fullResult, genModel);

                // Compare positions
                const violations = findPositionChanges(phaseAPositions, finalPositions);

                // Assert no changes
                expect(violations, `Phase B modified gen >= -1 positions`).toEqual([]);
            });
        }
    });

    it('SUMMARY: logs statistics', () => {
        let totalPersons = 0;
        let failingPersons = 0;
        const failures: { personId: string; name: string; violationCount: number }[] = [];

        for (const focusPersonId of allPersonIds) {
            totalPersons++;

            try {
                const selection = selectSubgraph({
                    data: testData,
                    focusPersonId,
                    ancestorDepth: DEPTH,
                    descendantDepth: DEPTH,
                    includeSpouseAncestors: false,
                    includeParentSiblings: false,
                    includeParentSiblingDescendants: false
                });

                const model = buildLayoutModel({ data: testData, selection, focusPersonId });
                const genModel = assignGenerations({ model, focusPersonId });
                const measured = measureSubtrees({ genModel, config, focusPersonId });
                const placed = placeX({ measured, config });

                const phaseAResult = applyConstraints({
                    placed,
                    config,
                    focusPersonId,
                    maxIterations: 20,
                    tolerance: 0.5,
                    stopAfterPhase: 'A'
                });

                const phaseAPositions = captureLockedPositions(phaseAResult, genModel);

                const fullResult = applyConstraints({
                    placed,
                    config,
                    focusPersonId,
                    maxIterations: 20,
                    tolerance: 0.5
                });

                const finalPositions = captureLockedPositions(fullResult, genModel);
                const violations = findPositionChanges(phaseAPositions, finalPositions);

                if (violations.length > 0) {
                    failingPersons++;
                    const person = testData.persons[focusPersonId];
                    failures.push({
                        personId: focusPersonId,
                        name: `${person?.firstName ?? '?'} ${person?.lastName ?? '?'}`,
                        violationCount: violations.length
                    });
                }
            } catch (_e) {
                // Skip errors in pipeline (some edge cases)
            }
        }

        // Write summary to file
        const summaryPath = path.join(process.cwd(), 'test', 'failures-lockedPositions.txt');
        const lines = [
            `Locked Positions Invariant Report [${FIXTURE}.json, depth=${DEPTH}]`,
            `Date: ${new Date().toISOString()}`,
            `Total: ${totalPersons} persons, ${failingPersons} failing`,
            `Note: Phase B must not modify gen >= -1 (parents + focus + descendants)`,
            `======================================================================`,
            ''
        ];

        for (const f of failures) {
            lines.push(`${f.name} [${f.personId}]`);
            lines.push(`  - ${f.violationCount} position(s) changed by Phase B`);
            lines.push('');
        }

        fs.writeFileSync(summaryPath, lines.join('\n'));
        console.log(`\nLocked positions failures written to: ${summaryPath}`);
        console.log(`${failingPersons}/${totalPersons} persons failing\n`);

        // This test always passes - it's just for reporting
        expect(true).toBe(true);
    });
});
