/**
 * All-Persons Full Pipeline Test
 *
 * Runs the COMPLETE layout pipeline via runLayoutPipeline (the real entry
 * point, including auto-expand partner chains and built-in validation)
 * with EVERY person as focus, in both display modes.
 *
 * Checks: valid positions, no card overlap, no edge crossings,
 * built-in validateLayout diagnostics, and the lines step 7 left out
 * (omittedEdges: listed in the report, never on the focus's line).
 *
 * The "-v3" modes lay every focus out once more with cards of their own
 * heights (custom card "by content": deterministic synthetic heights of
 * 56–294 px per person, partner line at the header) and audit the bands too
 * (helpers/bandAudit.ts): cards top-aligned in bands as tall as their
 * tallest card, buses between the bands, stems from the right card's bottom,
 * and the X placement and bus lanes of the uniform-card layout unchanged.
 *
 * The "-dense" modes run all of it again with the dense spacing
 * (DENSE_LAYOUT_CONFIG: tighter gaps, bus lanes at most one off the gap's
 * middle) and check two more things: the same number of lines left out as
 * the normal spacing, and no bus or connector closer than 13 px to a card's
 * top or bottom edge (helpers/busClearance.ts).
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
import { auditBands, syntheticPersonHeights } from './helpers/bandAudit.js';
import { auditBusClearance } from './helpers/busClearance.js';
import { PersonId, LayoutConfig, StromData, DEFAULT_LAYOUT_CONFIG, DENSE_LAYOUT_CONFIG } from '../../types.js';

const DEFAULT_FIXTURES = [
    'comprehensive',
    'real-large',
    'edge-remarriage-web',
    'edge-pedigree-collapse',
    'edge-deep-tree',
    'edge-wide-family',
    'edge-placeholder-parents',
    'edge-marriage-cascade',
    // Two families married twice into each other: a daughter drawn as the
    // wife in the other branch, half-siblings out of view on both sides.
    'edge-children-elsewhere',
    // The same with the half-sibling through the mother's father: his
    // second wife stands on the inner side of the pedigree.
    'edge-children-elsewhere-father',
    // Persons of unknown sex (U01): the comprehensive tree with every other
    // person unknown (man + unknown, unknown + woman, two unknown in data
    // order), and etalon E with each hub unknown, its partners men and women
    // by turns (the hub's chain sides decided by its partners).
    'edge-unknown-gender',
    'edge-unknown-chains',
    // A parent's childless siblings over the focus's wide family (two
    // marriages, ten children): they stand beside the parent, not beyond
    // the width of the family below.
    'edge-aunts-wide-family',
    // A man with three marriages without wedding dates (T13): the partners
    // stand in the order of the marriages around him.
    'edge-t13-partner-order',
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
    'etalon-half-sisters',
    // Development demo tree (fictional; see scripts/generate-devel-demo.ts).
    'devel-demo',
];
const FIXTURES = (process.env.FIXTURES || DEFAULT_FIXTURES.join(','))
    .split(',')
    .map(f => f.trim())
    .filter(f => existsSync(join(process.cwd(), 'test', `${f}.json`)));
const DEPTH = parseInt(process.env.DEPTH || '5', 10);

const config = DEFAULT_LAYOUT_CONFIG;
/** Dense spacing: the closest a bus or connector may come to a card's top or bottom edge (pill 9 px out + 4 px). */
const DENSE_BUS_CLEARANCE = 13;

interface PersonFailure {
    personId: string;
    name: string;
    mode: string;
    failures: string[];
}

const NORMAL_MODES = [
    { name: 'standard', base: 'standard', heights: false, dense: false, displayPolicy: { mode: 'standard' as const, autoExpand: false } },
    { name: 'expanded', base: 'expanded', heights: false, dense: false, displayPolicy: { mode: 'standard' as const, autoExpand: true } },
    { name: 'standard-v3', base: 'standard', heights: true, dense: false, displayPolicy: { mode: 'standard' as const, autoExpand: false } },
    { name: 'expanded-v3', base: 'expanded', heights: true, dense: false, displayPolicy: { mode: 'standard' as const, autoExpand: true } },
];
const MODES = [...NORMAL_MODES, ...NORMAL_MODES.map(m => ({ ...m, name: `${m.name}-dense`, dense: true }))];

/**
 * The focus, their ancestors and their descendants: lines to them are never
 * left out (step 7 prefers any other line that removes a violation).
 */
function focusLine(data: StromData, focusId: PersonId): Set<PersonId> {
    const line = new Set<PersonId>([focusId]);
    const up: PersonId[] = [focusId];
    while (up.length > 0) {
        for (const pid of data.persons[up.pop()!]?.parentIds ?? []) {
            if (!line.has(pid)) { line.add(pid); up.push(pid); }
        }
    }
    const down: PersonId[] = [focusId];
    const seen = new Set<PersonId>(down);
    while (down.length > 0) {
        for (const cid of data.persons[down.pop()!]?.childIds ?? []) {
            if (!seen.has(cid)) { seen.add(cid); line.add(cid); down.push(cid); }
        }
    }
    return line;
}

for (const fixtureName of FIXTURES) {
    const data = loadFixture(fixtureName);
    const personIds = Object.keys(data.persons) as PersonId[];
    const allFailures: PersonFailure[] = [];
    // Lines step 7 left out, per run (the report lists them)
    const allOmitted: Array<{ personId: string; name: string; mode: string; edges: string[] }> = [];
    const outputFile = join(process.cwd(), 'test', `failures-full-${fixtureName}.txt`);
    // Cards of their own heights, the partner line at the header (as the custom card)
    const v3Config: LayoutConfig = { ...config, spouseLineY: 25, personHeights: syntheticPersonHeights(personIds) };
    const denseV3Config: LayoutConfig = { ...DENSE_LAYOUT_CONFIG, spouseLineY: 25, personHeights: v3Config.personHeights };

    describe(`Full Pipeline Invariants [${fixtureName}.json, depth=${DEPTH}]`, () => {
        for (const personId of personIds) {
            const person = data.persons[personId];
            const displayName = `${person.firstName} ${person.lastName}`.trim() || personId;

            for (const mode of MODES) {
                it(`${displayName} (${personId}) [${mode.name}]`, () => {
                    const failures: string[] = [];
                    const uniformConfig = mode.dense ? DENSE_LAYOUT_CONFIG : config;
                    const modeConfig = mode.heights ? (mode.dense ? denseV3Config : v3Config) : uniformConfig;
                    const run = (cfg: LayoutConfig) => runLayoutPipeline({
                        data,
                        focusPersonId: personId,
                        config: cfg,
                        ancestorDepth: DEPTH,
                        descendantDepth: DEPTH,
                        includeSpouseAncestors: true,
                        includeParentSiblings: true,
                        includeParentSiblingDescendants: true,
                        displayPolicy: mode.displayPolicy,
                    });

                    let result;
                    try {
                        result = run(modeConfig);
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
                        assertNoNodeOverlap(result.positions, modeConfig.cardWidth, modeConfig.cardHeight);
                    } catch (e: unknown) {
                        failures.push(`Overlap: ${(e as Error).message.split('\n')[0]}`);
                    }

                    // 3. Built-in validation (bus overlaps, refs, bounds)
                    if (!result.diagnostics.validationPassed) {
                        for (const err of result.diagnostics.errors.slice(0, 5)) {
                            failures.push(`Validation: ${err}`);
                        }
                    }

                    // 4. Strict geometry audit: crossings, collinear line
                    // merges, endpoint touches on foreign lines, lines through
                    // cards. Nothing is tolerated: a knot no placement avoids
                    // is left out by step 7 (4b) and shown as card links.
                    for (const violation of auditGeometry(result, modeConfig).slice(0, 5)) {
                        failures.push(`Geometry: [${violation.type}] ${violation.detail}`);
                    }

                    // 4b. Lines left out (step 7): their cards are there, and
                    // none is a line of the focus's own line
                    if (result.omittedEdges?.length) {
                        allOmitted.push({
                            personId, name: displayName, mode: mode.name,
                            edges: result.omittedEdges.map(e => `${e.unionId} -> ${e.childId}`)
                        });
                        const line = focusLine(data, personId);
                        for (const edge of result.omittedEdges) {
                            if (line.has(edge.childId)) failures.push(`Omitted line on the focus line: ${edge.unionId} -> ${edge.childId}`);
                        }
                    }

                    // 5. Cards of their own heights: bands, stems, drops, and
                    // the uniform layout's X placement and bus lanes
                    if (mode.heights) {
                        for (const v of auditBands(result, modeConfig, run(uniformConfig)).slice(0, 5)) {
                            failures.push(`Bands: ${v}`);
                        }
                    }

                    // 6. Dense spacing: as many lines left out as with the
                    // normal spacing, and every bus clear of the cards' edges
                    if (mode.dense) {
                        const normal = run(mode.heights ? v3Config : config);
                        const count = (r: typeof result) => r.omittedEdges?.length ?? 0;
                        if (count(result) !== count(normal)) {
                            failures.push(`Dense: ${count(result)} lines left out, normal spacing ${count(normal)}`);
                        }
                        for (const v of auditBusClearance(result, modeConfig, DENSE_BUS_CLEARANCE).slice(0, 5)) {
                            failures.push(`Dense: ${v}`);
                        }
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

            lines.push('');
            lines.push(`Omitted lines (step 7): ${allOmitted.length} runs, ${allOmitted.reduce((n, o) => n + o.edges.length, 0)} lines`);
            for (const o of allOmitted) {
                lines.push(`  ${o.name} [${o.personId}] (${o.mode}): ${o.edges.length} — ${o.edges.join(', ')}`);
            }

            writeFileSync(outputFile, lines.join('\n'), 'utf-8');
            console.log(`\nFull pipeline failures written to: ${outputFile}`);
            console.log(`${allFailures.length}/${personIds.length * MODES.length} runs failing\n`);
        });
    });
}
