/**
 * All-Persons Phase A Test
 *
 * Runs Phase A (descendants only, gen>=0) invariant checks with EVERY person as focus.
 * Checks: no overlap (gen>=0 only), parent-children centering.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { runPipeline } from './helpers/runPipeline.js';
import {
    assertNoNodeOverlap,
    assertParentChildrenCentering,
    assertBranchClusterOrder,
    assertNoExcessiveBranchGaps,
    assertCousinSeparation,
    assertSiblingBranchAnchorConsistency,
    assertSiblingFamilyNonInterleaving,
} from './helpers/assertions.js';
import { PersonId, Position } from '../../types.js';

const FIXTURE = process.env.FIXTURE || 'comprehensive';
const DEPTH = parseInt(process.env.DEPTH || '5', 10);

interface PersonFailure {
    personId: string;
    name: string;
    failures: string[];
}

const OUTPUT_FILE = join(process.cwd(), 'test', 'failures-phaseA.txt');

describe(`Phase A Invariants [${FIXTURE}.json, depth=${DEPTH}]`, () => {
    const data = loadFixture(FIXTURE);
    const personIds = Object.keys(data.persons) as PersonId[];
    const allFailures: PersonFailure[] = [];

    for (const personId of personIds) {
        const person = data.persons[personId];
        const displayName = `${person.firstName} ${person.lastName}`.trim() || personId;

        it(`${displayName} (${personId})`, () => {
            const failures: string[] = [];

            let stages;
            try {
                stages = runPipeline(data, personId, {
                    ancestorDepth: DEPTH,
                    descendantDepth: DEPTH,
                    stopAfterPhase: 'A'
                });
            } catch (e: unknown) {
                failures.push(`Pipeline error: ${(e as Error).message}`);
                allFailures.push({ personId, name: displayName, failures });
                return;
            }

            // Filter positions to gen>=0 only
            const { genModel } = stages.constrained.placed.measured;
            const descPositions = new Map<PersonId, Position>();
            for (const [pid, pos] of stages.result.positions) {
                const gen = genModel.personGen.get(pid);
                if (gen !== undefined && gen >= 0) {
                    descPositions.set(pid, pos);
                }
            }

            // 1. No card overlap (gen>=0 only)
            try {
                assertNoNodeOverlap(descPositions);
            } catch (e: unknown) {
                failures.push(`Overlap: ${(e as Error).message.split('\n')[0]}`);
            }

            // 2. Parent-children centering (tolerance 10px)
            try {
                assertParentChildrenCentering(stages.constrained, 10);
            } catch (e: unknown) {
                failures.push(`Centering(10px): ${(e as Error).message.split('\n')[0]}`);
            }

            // 3. Branch cluster order (no subtree interleaving)
            try {
                assertBranchClusterOrder(stages.constrained);
            } catch (e: unknown) {
                failures.push(`BCO: ${(e as Error).message.split('\n').slice(0, 3).join(' | ')}`);
            }

            // 4. No excessive branch gaps (BCC compacted where possible)
            // After BCC improvements, gaps should be at most 3× horizontalGap (45px).
            try {
                assertNoExcessiveBranchGaps(stages.constrained, 3);
            } catch (e: unknown) {
                failures.push(`Gaps: ${(e as Error).message.split('\n')[0]}`);
            }

            // 5. Cousin separation (no CB inside FS span)
            try {
                assertCousinSeparation(stages.constrained, personId);
            } catch (e: unknown) {
                failures.push(`CSP: ${(e as Error).message.split('\n')[0]}`);
            }

            // 6. SBAC - Sibling Branch Anchor Consistency (aunts/uncles centered over children)
            try {
                assertSiblingBranchAnchorConsistency(stages.constrained, personId);
            } catch (e: unknown) {
                failures.push(`SBAC: ${(e as Error).message.split('\n')[0]}`);
            }

            // 7. SFNI - Sibling Family Non-Interleaving (no cluster overlaps at gen -1)
            try {
                assertSiblingFamilyNonInterleaving(stages.constrained, personId);
            } catch (e: unknown) {
                failures.push(`SFNI: ${(e as Error).message.split('\n')[0]}`);
            }

            if (failures.length > 0) {
                allFailures.push({ personId, name: displayName, failures });
            }

            expect(failures, `Phase A violations for ${displayName}`).toEqual([]);
        });
    }

    it('SUMMARY: writes failures to file', () => {
        const lines: string[] = [];
        lines.push(`Phase A Invariant Report [${FIXTURE}.json, depth=${DEPTH}]`);
        lines.push(`Date: ${new Date().toISOString()}`);
        lines.push(`Total: ${personIds.length} persons, ${allFailures.length} failing`);
        lines.push('='.repeat(70));
        lines.push('');

        if (allFailures.length === 0) {
            lines.push('All persons pass Phase A invariants.');
        } else {
            for (const f of allFailures) {
                lines.push(`${f.name} [${f.personId}]`);
                for (const msg of f.failures) {
                    lines.push(`  - ${msg}`);
                }
                lines.push('');
            }
        }

        writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');
        console.log(`\nPhase A failures written to: ${OUTPUT_FILE}`);
        console.log(`${allFailures.length}/${personIds.length} persons failing\n`);
    });
});
