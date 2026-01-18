/**
 * Layout Validation
 *
 * Checks layout invariants:
 * 1. No card overlap
 * 2. No line crossings
 * 3. All positions within bounds
 * 4. All connections reference existing persons
 */

import { PersonId, Position, LayoutConfig } from '../../types.js';
import { LayoutResult, ValidationResult, Connection } from './types.js';

/**
 * Validate the final layout result.
 */
export function validateLayout(
    result: LayoutResult,
    config: LayoutConfig
): ValidationResult {
    const errors: string[] = [];

    // 1. Check for card overlaps
    const overlapErrors = checkCardOverlaps(result.positions, config);
    errors.push(...overlapErrors);

    // 2. Check that all connections reference existing persons
    const refErrors = checkConnectionReferences(result);
    errors.push(...refErrors);

    // 3. Check for negative positions
    const boundsErrors = checkBounds(result.positions);
    errors.push(...boundsErrors);

    // 4. Check for line segment crossings (basic check)
    const crossingErrors = checkLineCrossings(result.connections);
    errors.push(...crossingErrors);

    return {
        passed: errors.length === 0,
        errors
    };
}

/**
 * Check for overlapping cards.
 */
function checkCardOverlaps(
    positions: Map<PersonId, Position>,
    config: LayoutConfig
): string[] {
    const errors: string[] = [];
    const posArray = Array.from(positions.entries());

    const minGap = config.horizontalGap / 2;

    for (let i = 0; i < posArray.length; i++) {
        for (let j = i + 1; j < posArray.length; j++) {
            const [id1, pos1] = posArray[i];
            const [id2, pos2] = posArray[j];

            if (rectanglesOverlap(pos1, pos2, config.cardWidth, config.cardHeight, minGap)) {
                errors.push(`Card overlap: ${id1} and ${id2}`);
            }
        }
    }

    return errors;
}

/**
 * Check if two rectangles overlap (with gap).
 */
function rectanglesOverlap(
    pos1: Position,
    pos2: Position,
    width: number,
    height: number,
    gap: number
): boolean {
    const w = width + gap;
    const h = height + gap;

    // Check if rectangles don't overlap
    if (pos1.x + w <= pos2.x) return false;  // pos1 is left of pos2
    if (pos2.x + w <= pos1.x) return false;  // pos2 is left of pos1
    if (pos1.y + h <= pos2.y) return false;  // pos1 is above pos2
    if (pos2.y + h <= pos1.y) return false;  // pos2 is above pos1

    return true;  // Rectangles overlap
}

/**
 * Check that all connection references are valid.
 */
function checkConnectionReferences(result: LayoutResult): string[] {
    const errors: string[] = [];
    const { positions, connections, spouseLines } = result;

    for (const conn of connections) {
        for (const drop of conn.drops) {
            if (!positions.has(drop.personId)) {
                errors.push(`Connection drop references missing person: ${drop.personId}`);
            }
        }
    }

    for (const line of spouseLines) {
        if (!positions.has(line.person1Id)) {
            errors.push(`Spouse line references missing person: ${line.person1Id}`);
        }
        if (!positions.has(line.person2Id)) {
            errors.push(`Spouse line references missing person: ${line.person2Id}`);
        }
    }

    return errors;
}

/**
 * Check that all positions are within valid bounds.
 */
function checkBounds(
    positions: Map<PersonId, Position>
): string[] {
    const errors: string[] = [];

    for (const [personId, pos] of positions) {
        if (pos.x < 0) {
            errors.push(`Negative X position for ${personId}: ${pos.x}`);
        }
        if (pos.y < 0) {
            errors.push(`Negative Y position for ${personId}: ${pos.y}`);
        }
        if (!isFinite(pos.x) || !isFinite(pos.y)) {
            errors.push(`Invalid position for ${personId}: (${pos.x}, ${pos.y})`);
        }
    }

    return errors;
}

/**
 * Basic check for line segment crossings.
 * Only checks horizontal bus segments for now.
 */
function checkLineCrossings(connections: Connection[]): string[] {
    const errors: string[] = [];

    // Collect horizontal segments (buses)
    const horizontalSegments: Array<{
        y: number;
        x1: number;
        x2: number;
        unionId: string;
    }> = [];

    for (const conn of connections) {
        horizontalSegments.push({
            y: conn.branchY,
            x1: Math.min(conn.branchLeftX, conn.branchRightX),
            x2: Math.max(conn.branchLeftX, conn.branchRightX),
            unionId: conn.unionId
        });
    }

    // Check for overlapping horizontal segments at same Y
    for (let i = 0; i < horizontalSegments.length; i++) {
        for (let j = i + 1; j < horizontalSegments.length; j++) {
            const seg1 = horizontalSegments[i];
            const seg2 = horizontalSegments[j];

            // Only check segments at same Y (within tolerance)
            if (Math.abs(seg1.y - seg2.y) < 1) {
                // Check for X overlap
                if (seg1.x1 < seg2.x2 && seg2.x1 < seg1.x2) {
                    errors.push(
                        `Bus line overlap at Y=${seg1.y.toFixed(0)}: ` +
                        `${seg1.unionId} and ${seg2.unionId}`
                    );
                }
            }
        }
    }

    return errors;
}

/**
 * Check centering constraint: parents should be centered over children.
 */
export function checkCenteringConstraint(
    result: LayoutResult,
    parentId: PersonId,
    childIds: PersonId[],
    tolerance: number = 1
): string | null {
    const parentPos = result.positions.get(parentId);
    if (!parentPos) return null;

    if (childIds.length === 0) return null;

    const childPositions = childIds
        .map(id => result.positions.get(id))
        .filter((p): p is Position => p !== undefined);

    if (childPositions.length === 0) return null;

    const minChildX = Math.min(...childPositions.map(p => p.x));
    const maxChildX = Math.max(...childPositions.map(p => p.x));
    const childrenCenter = (minChildX + maxChildX) / 2;

    // Parent's center X (assuming card starts at parentPos.x)
    // This is a simplified check - full check would use card width
    const parentCenterX = parentPos.x;

    const violation = Math.abs(parentCenterX - childrenCenter);

    if (violation > tolerance) {
        return `Centering violation for ${parentId}: ${violation.toFixed(1)}px off center`;
    }

    return null;
}
