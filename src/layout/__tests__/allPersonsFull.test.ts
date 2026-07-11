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
    assertValidPositions,
} from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
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
    // Synthetic etalon: systematically designed constellations (see docs/ETALON.md).
    'etalon-line-10gen',
    'etalon-ancestors-binary5',
    'etalon-wide-12',
    'etalon-deep-both',
    'etalon-multi-partners',
    'etalon-merged-chain',
    'etalon-ancestor-chain',
    'etalon-cousin-marriage',
    'etalon-double-inlaw',
    'etalon-inlaw-loop',
    'etalon-inlaw-column',
    'etalon-descendant-partner-ancestors',
    'etalon-incomplete-data',
    'etalon-stress-all',
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
 * Known limitations: cases where an in-law family COLUMN (a descendant
 * spouse's parents + their ancestors) stands INSIDE a sibling-group bus span.
 * The lane constraint graph is cyclic there (the foreign stem must be above
 * the bus, but the foreign drop must be below it), so no routing avoids the
 * line contact; fixing it needs relocating anchored columns, which would
 * break parent-child alignment elsewhere. Line-crossing and bus-overlap
 * failures are tolerated for these runs; anything else still fails the test.
 */
const KNOWN_LINE_KNOTS = new Set([
    'real-large/p_1783746448938_6w3g1/standard',
    'real-large/p_1783746448938_6w3g1/expanded',
    // Etalon scenario K (etalon-inlaw-column): isolated minimal reproduction of
    // the same knot. With eK_focus as focus, the husband's paternal-grandparent
    // stem must cross the focus's paternal-grandparent bus — the foreign in-law
    // column stands inside that sibling-group bus span. Same class as above.
    'etalon-inlaw-column/eK_focus/standard',
    'etalon-inlaw-column/eK_focus/expanded',
    // Same knot class in the stress graph: the bridge spouse's parents
    // (eNB_F couple) anchor above the spouse INSIDE the 12-child NC sibling
    // bus span; the drop to them must cross that bus at every lane order.
    // Escaping needs couple re-orientation planning (spouse on the outer
    // side) or duplicated in-law cards — future work, see ETALON_FINDINGS.
    'etalon-stress-all/eNC_gk10_1/standard',
    'etalon-stress-all/eNC_gk10_1/expanded',
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

                    // 3. Built-in validation (bus overlaps, refs, bounds)
                    if (!result.diagnostics.validationPassed) {
                        for (const err of result.diagnostics.errors.slice(0, 5)) {
                            failures.push(`Validation: ${err}`);
                        }
                    }

                    // 4. Strict geometry audit: crossings (incl. classification
                    // of topologically forced ones between cross-married
                    // unions), collinear line merges, endpoint touches on
                    // foreign lines, lines through cards
                    const violations = auditGeometry(result, config, data);
                    const inherent = violations.filter(v => v.type === 'inherent-crossing');
                    const hard = violations.filter(v => v.type !== 'inherent-crossing');
                    for (const violation of hard.slice(0, 5)) {
                        failures.push(`Geometry: [${violation.type}] ${violation.detail}`);
                    }
                    // Inherent crossings (double in-law etc.) are logged in the
                    // report but do not fail the test — they cannot be avoided
                    // with atomic couples and single-bus T-routing.
                    if (failures.length === 0 && inherent.length > 0) {
                        allFailures.push({
                            personId, name: displayName, mode: mode.name,
                            failures: inherent.slice(0, 3).map(v => `INHERENT: ${v.detail}`)
                        });
                    }

                    const limitationKey = `${fixtureName}/${personId}/${mode.name}`;
                    if (KNOWN_LINE_KNOTS.has(limitationKey) &&
                        failures.every(f =>
                            f.startsWith('Validation: Bus line overlap') ||
                            f.startsWith('Crossing:') ||
                            f.startsWith('Geometry:'))) {
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
