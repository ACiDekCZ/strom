/**
 * Debug Validation Functions
 *
 * Validates layout invariants at each pipeline step.
 * Reports violations to help debug layout issues.
 */

import { LayoutConfig } from '../../types.js';
import {
    DebugSnapshot,
    DebugValidationResult,
    CenteringError
} from './debug-types.js';
import { UnionId } from './types.js';

/**
 * Compute all validation checks for a snapshot.
 */
export function computeDebugValidation(
    snapshot: DebugSnapshot,
    config: LayoutConfig
): DebugValidationResult {
    // Validation only makes sense from step 5 onwards (after X placement)
    if (snapshot.step < 5 || !snapshot.placed) {
        return {
            boxOverlapCount: 0,
            spanOverlapCount: 0,
            centeringErrors: [],
            edgeCrossingCount: 0,
            allPassed: true
        };
    }

    const boxOverlapCount = checkNoBoxOverlap(snapshot, config);
    const spanOverlapCount = checkNoSpanOverlap(snapshot, config);
    const centeringErrors = checkCenteringErrors(snapshot, config);
    const edgeCrossingCount = snapshot.step >= 7
        ? checkNoEdgeCrossing(snapshot)
        : 0;

    return {
        boxOverlapCount,
        spanOverlapCount,
        centeringErrors,
        edgeCrossingCount,
        allPassed: boxOverlapCount === 0 &&
                   spanOverlapCount === 0 &&
                   centeringErrors.length === 0 &&
                   edgeCrossingCount === 0
    };
}

/**
 * Check for overlapping person cards within each generation band.
 * Returns count of overlapping pairs.
 */
function checkNoBoxOverlap(
    snapshot: DebugSnapshot,
    config: LayoutConfig
): number {
    const { placed, genModel } = snapshot;
    if (!placed || !genModel) return 0;

    const { personX } = placed;
    const { genBands } = genModel;

    let overlapCount = 0;
    const minGap = config.horizontalGap;

    // Check each generation band separately
    for (const [_gen, band] of genBands) {
        const persons = band.persons;
        if (persons.length < 2) continue;

        // Sort by X position
        const sorted = [...persons].sort((a, b) => {
            const xA = personX.get(a) ?? 0;
            const xB = personX.get(b) ?? 0;
            return xA - xB;
        });

        // Check consecutive pairs for overlap
        for (let i = 0; i < sorted.length - 1; i++) {
            const xCurrent = personX.get(sorted[i]) ?? 0;
            const xNext = personX.get(sorted[i + 1]) ?? 0;

            // Right edge of current card + min gap should be <= left edge of next card
            const rightEdge = xCurrent + config.cardWidth + minGap;
            if (rightEdge > xNext) {
                overlapCount++;
            }
        }
    }

    return overlapCount;
}

/**
 * Check for overlapping sibling spans.
 * Sibling spans of different unions should not overlap in the same generation.
 * Returns count of overlapping pairs.
 */
function checkNoSpanOverlap(
    snapshot: DebugSnapshot,
    config: LayoutConfig
): number {
    const { placed, genModel } = snapshot;
    if (!placed || !genModel) return 0;

    const { personX } = placed;
    const { model, unionGen } = genModel;

    let overlapCount = 0;
    const minGap = config.horizontalGap;

    // For each generation, collect sibling spans
    const genSpans = new Map<number, Array<{ unionId: UnionId; x1: number; x2: number }>>();

    for (const [unionId, union] of model.unions) {
        if (union.childIds.length === 0) continue;

        const childGen = unionGen.get(unionId);
        if (childGen === undefined) continue;
        const targetGen = childGen + 1;

        // Calculate span of children
        let minX = Infinity;
        let maxX = -Infinity;

        for (const childId of union.childIds) {
            const x = personX.get(childId);
            if (x !== undefined) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x + config.cardWidth);
            }
        }

        if (minX < Infinity && maxX > -Infinity) {
            if (!genSpans.has(targetGen)) {
                genSpans.set(targetGen, []);
            }
            genSpans.get(targetGen)!.push({ unionId, x1: minX, x2: maxX });
        }
    }

    // Check for overlaps within each generation
    for (const [_gen, spans] of genSpans) {
        if (spans.length < 2) continue;

        // Sort by x1
        spans.sort((a, b) => a.x1 - b.x1);

        // Check consecutive pairs
        for (let i = 0; i < spans.length - 1; i++) {
            const current = spans[i];
            const next = spans[i + 1];

            // Spans overlap if current.x2 + minGap > next.x1
            if (current.x2 + minGap > next.x1) {
                overlapCount++;
            }
        }
    }

    return overlapCount;
}

/**
 * Check that parents are centered above their children.
 * Returns list of centering errors with magnitudes.
 */
function checkCenteringErrors(
    snapshot: DebugSnapshot,
    config: LayoutConfig
): CenteringError[] {
    const { placed, genModel } = snapshot;
    if (!placed || !genModel) return [];

    const { personX, unionX } = placed;
    const { model } = genModel;

    const errors: CenteringError[] = [];
    const tolerance = 1.0; // 1px tolerance

    for (const [unionId, union] of model.unions) {
        if (union.childIds.length === 0) continue;

        // Get parent union center
        const parentCenterX = unionX.get(unionId);
        if (parentCenterX === undefined) continue;

        // Calculate children span center
        let minChildX = Infinity;
        let maxChildX = -Infinity;

        for (const childId of union.childIds) {
            const x = personX.get(childId);
            if (x !== undefined) {
                minChildX = Math.min(minChildX, x);
                maxChildX = Math.max(maxChildX, x + config.cardWidth);
            }
        }

        if (minChildX >= Infinity) continue;

        const childrenCenterX = (minChildX + maxChildX) / 2;
        const errorPx = Math.abs(parentCenterX - childrenCenterX);

        if (errorPx > tolerance) {
            errors.push({
                unionId,
                parentCenterX,
                childrenCenterX,
                errorPx
            });
        }
    }

    // Sort by error magnitude (largest first)
    errors.sort((a, b) => b.errorPx - a.errorPx);

    return errors;
}

/**
 * Check for edge crossings in routed connections.
 * Returns count of crossing pairs.
 */
function checkNoEdgeCrossing(snapshot: DebugSnapshot): number {
    const { routed } = snapshot;
    if (!routed) return 0;

    const { connections } = routed;
    if (connections.length < 2) return 0;

    let crossingCount = 0;

    // Collect all line segments
    interface Segment {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    }

    const segments: Segment[] = [];

    for (const conn of connections) {
        // Stem segment
        segments.push({
            x1: conn.stemX,
            y1: conn.stemTopY,
            x2: conn.stemX,
            y2: conn.branchY
        });

        // Branch segment
        segments.push({
            x1: conn.branchLeftX,
            y1: conn.branchY,
            x2: conn.branchRightX,
            y2: conn.branchY
        });

        // Drop segments
        for (const drop of conn.drops) {
            segments.push({
                x1: drop.x,
                y1: conn.branchY,
                x2: drop.x,
                y2: drop.bottomY
            });
        }
    }

    // Check all segment pairs for intersection
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            if (segmentsIntersect(segments[i], segments[j])) {
                crossingCount++;
            }
        }
    }

    return crossingCount;
}

/**
 * Check if two line segments intersect (excluding shared endpoints).
 */
function segmentsIntersect(
    s1: { x1: number; y1: number; x2: number; y2: number },
    s2: { x1: number; y1: number; x2: number; y2: number }
): boolean {
    // Check if segments share an endpoint (allowed - not a crossing)
    if (pointsEqual(s1.x1, s1.y1, s2.x1, s2.y1) ||
        pointsEqual(s1.x1, s1.y1, s2.x2, s2.y2) ||
        pointsEqual(s1.x2, s1.y2, s2.x1, s2.y1) ||
        pointsEqual(s1.x2, s1.y2, s2.x2, s2.y2)) {
        return false;
    }

    // Use cross product to check for intersection
    const d1 = direction(s2.x1, s2.y1, s2.x2, s2.y2, s1.x1, s1.y1);
    const d2 = direction(s2.x1, s2.y1, s2.x2, s2.y2, s1.x2, s1.y2);
    const d3 = direction(s1.x1, s1.y1, s1.x2, s1.y2, s2.x1, s2.y1);
    const d4 = direction(s1.x1, s1.y1, s1.x2, s1.y2, s2.x2, s2.y2);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }

    // Check collinear cases
    if (d1 === 0 && onSegment(s2.x1, s2.y1, s2.x2, s2.y2, s1.x1, s1.y1)) return true;
    if (d2 === 0 && onSegment(s2.x1, s2.y1, s2.x2, s2.y2, s1.x2, s1.y2)) return true;
    if (d3 === 0 && onSegment(s1.x1, s1.y1, s1.x2, s1.y2, s2.x1, s2.y1)) return true;
    if (d4 === 0 && onSegment(s1.x1, s1.y1, s1.x2, s1.y2, s2.x2, s2.y2)) return true;

    return false;
}

function pointsEqual(x1: number, y1: number, x2: number, y2: number): boolean {
    const epsilon = 0.01;
    return Math.abs(x1 - x2) < epsilon && Math.abs(y1 - y2) < epsilon;
}

function direction(
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number
): number {
    return (x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1);
}

function onSegment(
    x1: number, y1: number,
    x2: number, y2: number,
    px: number, py: number
): boolean {
    return px >= Math.min(x1, x2) && px <= Math.max(x1, x2) &&
           py >= Math.min(y1, y2) && py <= Math.max(y1, y2);
}
