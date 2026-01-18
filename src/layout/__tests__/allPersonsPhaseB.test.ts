/**
 * Phase B Invariants Test - All Persons
 *
 * Tests Phase B (Ancestor Layout) invariants for every person in the fixture.
 * Phase B places ancestors (gen <= -2) while respecting locked positions (gen >= -1).
 *
 * Phase B Invariants:
 * - LOCKED: gen >= -1 positions unchanged from Phase A
 * - NCO-ANC: No ancestor overlap (gen <= -2)
 * - FSPC: H/W trees don't cross Father+Mother axis (trees non-crossing)
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
import {
    assertNoNodeOverlap,
    assertFSPC_AncestorExtentBarrier
} from './helpers/assertions.js';
import { ConstrainedModel, GenerationalModel } from '../pipeline/types.js';

const FIXTURE = process.env.FIXTURE || 'comprehensive';
const DEPTH = parseInt(process.env.DEPTH || '5', 10);

const config = DEFAULT_LAYOUT_CONFIG;

// Load test data
const testData = loadFixture(FIXTURE);

/**
 * Capture gen >= -1 positions from a ConstrainedModel.
 * These are LOCKED during Phase B (parents + focus + descendants).
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

    for (const [pid, gen] of genModel.personGen) {
        if (gen >= -1) {
            const x = personX.get(pid);
            if (x !== undefined) {
                captured.personX.set(pid, x);
            }
        }
    }

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
 * Compare positions and return violations.
 */
function findPositionChanges(
    phaseA: { personX: Map<PersonId, number>; unionX: Map<string, number> },
    phaseB: { personX: Map<PersonId, number>; unionX: Map<string, number> },
    tolerance = 0.5
): string[] {
    const violations: string[] = [];

    for (const [pid, oldX] of phaseA.personX) {
        const newX = phaseB.personX.get(pid);
        if (newX !== undefined) {
            const delta = Math.abs(newX - oldX);
            if (delta > tolerance) {
                violations.push(`Person ${pid}: Δ=${delta.toFixed(1)}`);
            }
        }
    }

    for (const [uid, oldX] of phaseA.unionX) {
        const newX = phaseB.unionX.get(uid);
        if (newX !== undefined) {
            const delta = Math.abs(newX - oldX);
            if (delta > tolerance) {
                violations.push(`Union ${uid}: Δ=${delta.toFixed(1)}`);
            }
        }
    }

    return violations;
}

/**
 * Run pipeline through Phase B and collect all invariant violations.
 */
function checkPhaseBInvariants(focusPersonId: PersonId): string[] {
    const failures: string[] = [];

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

        // Run Phase A only
        const phaseAResult = applyConstraints({
            placed,
            config,
            focusPersonId,
            maxIterations: 20,
            tolerance: 0.5,
            stopAfterPhase: 'A'
        });
        const phaseAPositions = captureLockedPositions(phaseAResult, genModel);

        // Run Phase A + B
        const phaseBResult = applyConstraints({
            placed,
            config,
            focusPersonId,
            maxIterations: 20,
            tolerance: 0.5,
            stopAfterPhase: 'B'
        });
        const phaseBPositions = captureLockedPositions(phaseBResult, genModel);

        // Build positions map for assertions
        const positions = new Map<PersonId, { x: number; y: number }>();
        const rowHeight = config.cardHeight + config.verticalGap;
        for (const [pid, x] of phaseBResult.placed.personX) {
            const gen = genModel.personGen.get(pid) ?? 0;
            const y = config.padding + (gen - genModel.minGen) * rowHeight;
            positions.set(pid, { x, y });
        }

        // 1. LOCKED POSITIONS - Phase B must not change gen >= -1 (parents + focus + descendants)
        const lockedViolations = findPositionChanges(phaseAPositions, phaseBPositions);
        if (lockedViolations.length > 0) {
            failures.push(`LOCKED: ${lockedViolations.length} position(s) changed`);
        }

        // 2. NO ANCESTOR OVERLAP (gen <= -2, grandparents and above)
        try {
            const ancestorPositions = new Map<PersonId, { x: number; y: number }>();
            for (const [pid, pos] of positions) {
                const gen = genModel.personGen.get(pid);
                if (gen !== undefined && gen <= -2) {
                    ancestorPositions.set(pid, pos);
                }
            }
            if (ancestorPositions.size > 0) {
                assertNoNodeOverlap(ancestorPositions);
            }
        } catch (e) {
            failures.push(`NCO-ANC: ${(e as Error).message.split('\n')[0]}`);
        }

        // 3. FSPC - Focus Spouse Parent Containment
        try {
            assertFSPC_AncestorExtentBarrier(phaseBResult, focusPersonId);
        } catch (e) {
            failures.push(`FSPC: ${(e as Error).message.split('\n')[0]}`);
        }

        // Note: CAP, ASO, A-COMP-I removed - not applicable for Phase B
        // Trees non-crossing is verified by FSPC test

    } catch (e) {
        failures.push(`PIPELINE: ${(e as Error).message.split('\n')[0]}`);
    }

    return failures;
}

describe(`Phase B Invariants [${FIXTURE}.json, depth=${DEPTH}]`, () => {
    const allPersonIds = Object.keys(testData.persons) as PersonId[];

    for (const focusPersonId of allPersonIds) {
        const person = testData.persons[focusPersonId];
        const displayName = `${person?.firstName ?? '?'} ${person?.lastName ?? '?'}`;

        it(`${displayName} (${focusPersonId})`, () => {
            const failures = checkPhaseBInvariants(focusPersonId);

            if (failures.length > 0) {
                expect(failures, `Phase B violations for ${displayName}`).toEqual([]);
            }
        });
    }

    it('SUMMARY: writes failures to file', () => {
        let totalPersons = 0;
        let failingPersons = 0;
        const allFailures: { personId: string; name: string; failures: string[] }[] = [];

        for (const focusPersonId of allPersonIds) {
            totalPersons++;
            const failures = checkPhaseBInvariants(focusPersonId);

            if (failures.length > 0) {
                failingPersons++;
                const person = testData.persons[focusPersonId];
                allFailures.push({
                    personId: focusPersonId,
                    name: `${person?.firstName ?? '?'} ${person?.lastName ?? '?'}`,
                    failures
                });
            }
        }

        // Write summary to file
        const summaryPath = path.join(process.cwd(), 'test', 'failures-phaseB.txt');
        const lines = [
            `Phase B Invariant Report [${FIXTURE}.json, depth=${DEPTH}]`,
            `Date: ${new Date().toISOString()}`,
            `Total: ${totalPersons} persons, ${failingPersons} failing`,
            `======================================================================`,
            ''
        ];

        for (const f of allFailures) {
            lines.push(`${f.name} [${f.personId}]`);
            for (const failure of f.failures) {
                lines.push(`  - ${failure}`);
            }
            lines.push('');
        }

        fs.writeFileSync(summaryPath, lines.join('\n'));
        console.log(`\nPhase B failures written to: ${summaryPath}`);
        console.log(`${failingPersons}/${totalPersons} persons failing\n`);

        expect(true).toBe(true);
    });
});
