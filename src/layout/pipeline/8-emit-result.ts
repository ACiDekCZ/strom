/**
 * Step 8: Emit Layout Result
 *
 * Final step: transforms the routed model into the output LayoutResult.
 * - Computes final Y positions
 * - Normalizes positions (shift so minX = padding)
 * - Adds diagnostics
 */

import { PersonId, Position } from '../../types.js';
import {
    EmitInput,
    LayoutResult,
    LayoutDiagnostics,
    Connection,
    SpouseLine,
    BranchModel
} from './types.js';

/**
 * Emit the final layout result.
 */
export function emitLayoutResult(input: EmitInput): LayoutResult {
    const { routed, config } = input;
    const { constrained, connections, spouseLines } = routed;
    const { placed, iterations } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model, personGen, minGen, maxGen } = genModel;

    // Calculate Y for each generation
    const rowHeight = config.cardHeight + config.verticalGap;
    const genY = new Map<number, number>();

    for (let gen = minGen; gen <= maxGen; gen++) {
        const row = gen - minGen;
        genY.set(gen, config.padding + row * rowHeight);
    }

    // Build positions map
    const positions = new Map<PersonId, Position>();

    for (const personId of model.persons.keys()) {
        const x = personX.get(personId);
        const gen = personGen.get(personId);

        if (x !== undefined && gen !== undefined) {
            const y = genY.get(gen);
            if (y !== undefined) {
                positions.set(personId, { x, y });
            }
        }
    }

    // Normalize positions (shift so minX = padding)
    // Also normalize branch bounds in the BranchModel
    const measuredBranch = measured as BranchModel;
    normalizePositions(positions, connections, spouseLines, config.padding, measuredBranch);

    // Build diagnostics
    const branchCount = measuredBranch.branches?.size ?? 0;

    const diagnostics: LayoutDiagnostics = {
        totalPersons: model.persons.size,
        totalUnions: model.unions.size,
        generationRange: [minGen, maxGen],
        iterations,
        branchCount,
        validationPassed: true,  // Will be updated by validation step
        errors: []
    };

    return {
        positions,
        connections,
        spouseLines,
        diagnostics
    };
}

/**
 * Normalize positions so minimum X = padding.
 * Also normalizes branch bounds in the BranchModel if available.
 */
function normalizePositions(
    positions: Map<PersonId, Position>,
    connections: Connection[],
    spouseLines: SpouseLine[],
    padding: number,
    branchModel?: BranchModel
): void {
    // Find minimum X
    let minX = Infinity;
    for (const pos of positions.values()) {
        minX = Math.min(minX, pos.x);
    }

    if (!isFinite(minX)) return;

    // Calculate shift needed
    const shift = padding - minX;

    if (Math.abs(shift) < 0.1) return;

    // Shift all positions
    for (const [personId, pos] of positions) {
        positions.set(personId, {
            x: pos.x + shift,
            y: pos.y
        });
    }

    // Shift connections
    for (const conn of connections) {
        conn.stemX += shift;
        conn.branchLeftX += shift;
        conn.branchRightX += shift;
        conn.connectorFromX += shift;
        conn.connectorToX += shift;
        for (const drop of conn.drops) {
            drop.x += shift;
        }
    }

    // Shift spouse lines
    for (const line of spouseLines) {
        line.xMin += shift;
        line.xMax += shift;
    }

    // Shift branch bounds
    if (branchModel?.branches) {
        for (const branch of branchModel.branches.values()) {
            branch.minX += shift;
            branch.maxX += shift;
        }
    }
}
