#!/usr/bin/env npx ts-node
/**
 * Standalone script for testing real family tree data with layout invariants.
 *
 * Usage:
 *   npm run test:real -- ./path/to/family.json
 *   REAL_DATA=./path/to/family.json npm run test:real
 *
 * This script runs layout invariant checks on real data without
 * including the data in the standard test suite.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PersonId, DEFAULT_LAYOUT_CONFIG, FamilyTreeData } from '../src/types.js';
import { selectSubgraph } from '../src/layout/pipeline/1-select-subgraph.js';
import { buildLayoutModel } from '../src/layout/pipeline/2-build-model.js';
import { assignGenerations } from '../src/layout/pipeline/3-assign-generations.js';
import { measureSubtrees } from '../src/layout/pipeline/4-measure.js';
import { placeX } from '../src/layout/pipeline/5-place-x.js';
import { applyConstraints } from '../src/layout/pipeline/6-constraints.js';
import { routeEdges } from '../src/layout/pipeline/7-route-edges.js';
import { emitResult } from '../src/layout/pipeline/8-emit-result.js';

const config = DEFAULT_LAYOUT_CONFIG;

interface InvariantResult {
    personId: string;
    name: string;
    failures: string[];
}

/**
 * Check basic invariants for a single focus person.
 */
function checkInvariants(data: FamilyTreeData, focusPersonId: PersonId): string[] {
    const failures: string[] = [];

    try {
        const selection = selectSubgraph({
            data,
            focusPersonId,
            maxAncestorDepth: 5,
            maxDescendantDepth: 5
        });

        const model = buildLayoutModel({ data, selection, focusPersonId });
        const genModel = assignGenerations({ model, focusPersonId });
        const measured = measureSubtrees({ genModel, config, focusPersonId });
        const placed = placeX({ measured, config });

        const constrained = applyConstraints({
            placed,
            config,
            focusPersonId
        });

        const routed = routeEdges({ constrained, config });
        const result = emitResult({ routed, config });

        // Check 1: Valid positions (no NaN/Infinity)
        for (const [pid, pos] of result.positions) {
            if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
                failures.push(`Invalid position for ${pid}: x=${pos.x}, y=${pos.y}`);
            }
        }

        // Check 2: No card overlap
        const positions = Array.from(result.positions.entries());
        for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
                const [idA, posA] = positions[i];
                const [idB, posB] = positions[j];

                const genA = genModel.personGen.get(idA);
                const genB = genModel.personGen.get(idB);

                // Only check same-generation overlap
                if (genA !== genB) continue;

                const leftA = posA.x;
                const rightA = posA.x + config.cardWidth;
                const leftB = posB.x;
                const rightB = posB.x + config.cardWidth;

                const overlapX = leftA < rightB && leftB < rightA;
                if (overlapX) {
                    failures.push(`Card overlap: ${idA} and ${idB} at gen ${genA}`);
                }
            }
        }

        // Check 3: Validation passed
        if (!result.diagnostics.validationPassed) {
            failures.push('Validation failed in diagnostics');
        }

    } catch (e) {
        failures.push(`Pipeline error: ${(e as Error).message}`);
    }

    return failures;
}

function main() {
    // Get data file path from args or env
    const args = process.argv.slice(2);
    const dataPath = args[0] || process.env.REAL_DATA;

    if (!dataPath) {
        console.error('Usage: npm run test:real -- ./path/to/family.json');
        console.error('   or: REAL_DATA=./path/to/family.json npm run test:real');
        process.exit(1);
    }

    const resolvedPath = path.resolve(dataPath);

    if (!fs.existsSync(resolvedPath)) {
        console.error(`File not found: ${resolvedPath}`);
        process.exit(1);
    }

    console.log(`\nLoading data from: ${resolvedPath}\n`);

    const data: FamilyTreeData = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    const personIds = Object.keys(data.persons) as PersonId[];

    console.log(`Found ${personIds.length} persons, ${Object.keys(data.partnerships).length} partnerships\n`);
    console.log('Running invariant checks...\n');

    const allResults: InvariantResult[] = [];
    let passCount = 0;
    let failCount = 0;

    for (const personId of personIds) {
        const person = data.persons[personId];
        const name = `${person?.firstName ?? '?'} ${person?.lastName ?? '?'}`;
        const failures = checkInvariants(data, personId);

        if (failures.length === 0) {
            passCount++;
            process.stdout.write('.');
        } else {
            failCount++;
            process.stdout.write('F');
            allResults.push({ personId, name, failures });
        }
    }

    console.log('\n');

    // Print summary
    console.log('='.repeat(70));
    console.log(`SUMMARY: ${passCount} passed, ${failCount} failed out of ${personIds.length}`);
    console.log('='.repeat(70));

    if (allResults.length > 0) {
        console.log('\nFailures:\n');
        for (const result of allResults) {
            console.log(`${result.name} [${result.personId}]`);
            for (const failure of result.failures) {
                console.log(`  - ${failure}`);
            }
            console.log('');
        }
    } else {
        console.log('\nAll invariant checks passed!');
    }

    // Exit with appropriate code
    process.exit(failCount > 0 ? 1 : 0);
}

main();
