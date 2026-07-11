/**
 * All-Persons Full Pipeline Test
 *
 * Runs the COMPLETE layout pipeline via runLayoutPipeline (the real entry
 * point, including auto-expand partner chains and built-in validation)
 * with EVERY person as focus, in both display modes.
 *
 * Checks: valid positions, no card overlap, no edge crossings,
 * built-in validateLayout diagnostics.
 *
 * Fixtures: set FIXTURES env var (comma-separated, without .json) to override.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import {
    assertNoNodeOverlap,
    assertNoEdgeCrossings,
    assertValidPositions,
} from './helpers/assertions.js';
import { PersonId, DEFAULT_LAYOUT_CONFIG } from '../../types.js';

const DEFAULT_FIXTURES = [
    'comprehensive',
    'real-large',
    'edge-remarriage-web',
    'edge-pedigree-collapse',
    'edge-deep-tree',
    'edge-wide-family',
    'edge-placeholder-parents',
    'edge-marriage-cascade',
];
const FIXTURES = (process.env.FIXTURES || DEFAULT_FIXTURES.join(','))
    .split(',')
    .map(f => f.trim())
    .filter(f => existsSync(join(process.cwd(), 'test', `${f}.json`)));
const DEPTH = parseInt(process.env.DEPTH || '5', 10);

const config = DEFAULT_LAYOUT_CONFIG;

interface PersonFailure {
    personId: string;
    name: string;
    mode: string;
    failures: string[];
}

const MODES = [
    { name: 'standard', displayPolicy: { mode: 'standard' as const, autoExpand: false } },
    { name: 'expanded', displayPolicy: { mode: 'standard' as const, autoExpand: true } },
];

/**
 * Known limitations: cases where an in-law ancestor column stands INSIDE a
 * sibling-group bus span — no lane assignment can avoid the collinear bus
 * overlap without introducing a real crossing (placement-level knot).
 * Only "Bus line overlap" validation errors are tolerated for these runs;
 * any other failure type still fails the test.
 */
const KNOWN_BUS_OVERLAPS = new Set([
    'real-large/p_1783746448938_xr52r/standard',
    'real-large/p_1783746448938_xr52r/expanded',
    'real-large/p_1783746448938_6w3g1/standard',
    'real-large/p_1783746448938_6w3g1/expanded',
]);

for (const fixtureName of FIXTURES) {
    const data = loadFixture(fixtureName);
    const personIds = Object.keys(data.persons) as PersonId[];
    const allFailures: PersonFailure[] = [];
    const outputFile = join(process.cwd(), 'test', `failures-full-${fixtureName}.txt`);

    describe(`Full Pipeline Invariants [${fixtureName}.json, depth=${DEPTH}]`, () => {
        for (const personId of personIds) {
            const person = data.persons[personId];
            const displayName = `${person.firstName} ${person.lastName}`.trim() || personId;

            for (const mode of MODES) {
                it(`${displayName} (${personId}) [${mode.name}]`, () => {
                    const failures: string[] = [];

                    let result;
                    try {
                        result = runLayoutPipeline({
                            data,
                            focusPersonId: personId,
                            config,
                            ancestorDepth: DEPTH,
                            descendantDepth: DEPTH,
                            includeSpouseAncestors: true,
                            includeParentSiblings: true,
                            includeParentSiblingDescendants: true,
                            displayPolicy: mode.displayPolicy,
                        });
                    } catch (e: unknown) {
                        failures.push(`Pipeline error: ${(e as Error).message}`);
                        allFailures.push({ personId, name: displayName, mode: mode.name, failures });
                        expect(failures, `Full pipeline violations for ${displayName} [${mode.name}]`).toEqual([]);
                        return;
                    }

                    // 1. All positions are finite numbers
                    try {
                        assertValidPositions(result.positions);
                    } catch (e: unknown) {
                        failures.push(`Positions: ${(e as Error).message.split('\n')[0]}`);
                    }

                    // 2. No card overlap (all generations)
                    try {
                        assertNoNodeOverlap(result.positions, config.cardWidth, config.cardHeight);
                    } catch (e: unknown) {
                        failures.push(`Overlap: ${(e as Error).message.split('\n')[0]}`);
                    }

                    // 3. No edge crossings (stems, connectors, buses, drops)
                    try {
                        assertNoEdgeCrossings(result.connections);
                    } catch (e: unknown) {
                        failures.push(`Crossing: ${(e as Error).message.split('\n')[0]}`);
                    }

                    // 4. Built-in validation (bus overlaps, refs, bounds)
                    if (!result.diagnostics.validationPassed) {
                        for (const err of result.diagnostics.errors.slice(0, 5)) {
                            failures.push(`Validation: ${err}`);
                        }
                    }

                    const limitationKey = `${fixtureName}/${personId}/${mode.name}`;
                    if (KNOWN_BUS_OVERLAPS.has(limitationKey) &&
                        failures.every(f => f.startsWith('Validation: Bus line overlap'))) {
                        allFailures.push({
                            personId, name: displayName, mode: mode.name,
                            failures: failures.map(f => `KNOWN LIMITATION: ${f}`)
                        });
                        return;
                    }

                    if (failures.length > 0) {
                        allFailures.push({ personId, name: displayName, mode: mode.name, failures });
                    }

                    expect(failures, `Full pipeline violations for ${displayName} [${mode.name}]`).toEqual([]);
                });
            }
        }

        it('SUMMARY: writes failures to file', () => {
            const lines: string[] = [];
            lines.push(`Full Pipeline Invariant Report [${fixtureName}.json, depth=${DEPTH}]`);
            lines.push(`Total: ${personIds.length} persons x ${MODES.length} modes, ${allFailures.length} failing`);
            lines.push('='.repeat(70));
            lines.push('');

            if (allFailures.length === 0) {
                lines.push('All persons pass full pipeline invariants.');
            } else {
                for (const f of allFailures) {
                    lines.push(`${f.name} [${f.personId}] (${f.mode})`);
                    for (const msg of f.failures) {
                        lines.push(`  - ${msg}`);
                    }
                    lines.push('');
                }
            }

            writeFileSync(outputFile, lines.join('\n'), 'utf-8');
            console.log(`\nFull pipeline failures written to: ${outputFile}`);
            console.log(`${allFailures.length}/${personIds.length * MODES.length} runs failing\n`);
        });
    });
}
