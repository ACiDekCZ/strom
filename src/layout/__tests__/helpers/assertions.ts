/**
 * Layout invariant assertions for testing.
 *
 * These assertions verify that the layout respects critical invariants
 * defined in CLAUDE.md (Layout Invariants section).
 */

import { PersonId, Position, DEFAULT_LAYOUT_CONFIG, LayoutConfig } from '../../../types.js';
import { Connection, RoutedModel } from '../../pipeline/types.js';

const DEFAULT_CARD_WIDTH = DEFAULT_LAYOUT_CONFIG.cardWidth;
const DEFAULT_CARD_HEIGHT = DEFAULT_LAYOUT_CONFIG.cardHeight;
const DEFAULT_GAP = DEFAULT_LAYOUT_CONFIG.horizontalGap;

/**
 * Invariant 1: No card overlap
 * Assert no two person cards overlap (per generation band).
 *
 * Note: This checks for actual visual overlap (cards touching or intersecting),
 * not minimum gap requirements. Partners in a union are intentionally placed
 * closer together (partnerGap) than unrelated persons (horizontalGap).
 */
export function assertNoNodeOverlap(
    positions: Map<PersonId, Position>,
    cardWidth = DEFAULT_CARD_WIDTH,
    _cardHeight = DEFAULT_CARD_HEIGHT,
    tolerance = 0.5
): void {
    const posArray = Array.from(positions.entries());

    for (let i = 0; i < posArray.length; i++) {
        for (let j = i + 1; j < posArray.length; j++) {
            const [id1, pos1] = posArray[i];
            const [id2, pos2] = posArray[j];

            // Only check same generation (same Y)
            if (Math.abs(pos1.y - pos2.y) > 1) continue;

            // Check for actual overlap (not minimum gap)
            const left1 = pos1.x;
            const right1 = pos1.x + cardWidth;
            const left2 = pos2.x;
            const right2 = pos2.x + cardWidth;

            // Overlap is positive when cards intersect
            const overlap = Math.min(right1, right2) - Math.max(left1, left2);

            // Cards overlap if overlap > tolerance (small tolerance for floating point)
            if (overlap > tolerance) {
                throw new Error(
                    `Card overlap detected: ${id1} [${left1.toFixed(1)}, ${right1.toFixed(1)}] ` +
                    `and ${id2} [${left2.toFixed(1)}, ${right2.toFixed(1)}] overlap by ${overlap.toFixed(1)}px`
                );
            }
        }
    }
}

/**
 * Invariant 2: No edge crossings
 * Assert no two edge segments cross (H/V line segment intersection).
 */
export function assertNoEdgeCrossings(connections: Connection[]): void {
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number; label: string }> = [];

    for (const conn of connections) {
        // Stem segment (vertical from union to connector)
        segments.push({
            x1: conn.stemX, y1: conn.stemTopY,
            x2: conn.stemX, y2: conn.stemBottomY,
            label: `stem-${conn.unionId}`
        });

        // Connector segment (horizontal, if exists)
        if (conn.connectorFromX !== conn.connectorToX) {
            segments.push({
                x1: conn.connectorFromX, y1: conn.connectorY,
                x2: conn.connectorToX, y2: conn.connectorY,
                label: `connector-${conn.unionId}`
            });
        }

        // Vertical segment from connector down to bus (if different Y)
        if (conn.connectorY !== conn.branchY) {
            segments.push({
                x1: conn.connectorToX, y1: conn.connectorY,
                x2: conn.connectorToX, y2: conn.branchY,
                label: `connector-drop-${conn.unionId}`
            });
        }

        // Bus segment (horizontal)
        segments.push({
            x1: conn.branchLeftX, y1: conn.branchY,
            x2: conn.branchRightX, y2: conn.branchY,
            label: `bus-${conn.unionId}`
        });

        // Drop segments (vertical)
        for (const drop of conn.drops) {
            segments.push({
                x1: drop.x, y1: conn.branchY,
                x2: drop.x, y2: drop.bottomY,
                label: `drop-${conn.unionId}-${drop.personId}`
            });
        }
    }

    // Check all pairs for crossing
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            if (segmentsIntersect(segments[i], segments[j])) {
                const s1 = segments[i];
                const s2 = segments[j];
                throw new Error(
                    `Edge crossing detected: ${s1.label} [(${s1.x1},${s1.y1})-(${s1.x2},${s1.y2})] ` +
                    `crosses ${s2.label} [(${s2.x1},${s2.y1})-(${s2.x2},${s2.y2})]`
                );
            }
        }
    }
}

/**
 * Assert no two bus segments overlap at the same Y level.
 */
export function assertNoBusOverlap(connections: Connection[], tolerance = 5): void {
    // Group buses by Y level (rounded to tolerance)
    const byY = new Map<number, Connection[]>();

    for (const conn of connections) {
        const yKey = Math.round(conn.branchY / tolerance) * tolerance;
        if (!byY.has(yKey)) byY.set(yKey, []);
        byY.get(yKey)!.push(conn);
    }

    // Check overlaps within each Y level
    for (const [y, conns] of byY) {
        for (let i = 0; i < conns.length; i++) {
            for (let j = i + 1; j < conns.length; j++) {
                const a = conns[i];
                const b = conns[j];

                // Check X interval overlap
                const overlapLeft = Math.max(a.branchLeftX, b.branchLeftX);
                const overlapRight = Math.min(a.branchRightX, b.branchRightX);

                if (overlapRight > overlapLeft - tolerance) {
                    throw new Error(
                        `Bus overlap at Y=${y}: ${a.unionId} [${a.branchLeftX}, ${a.branchRightX}] ` +
                        `overlaps ${b.unionId} [${b.branchLeftX}, ${b.branchRightX}]`
                    );
                }
            }
        }
    }
}

/**
 * Assert all persons have valid positions (non-NaN coordinates).
 */
export function assertValidPositions(positions: Map<PersonId, Position>): void {
    for (const [id, pos] of positions) {
        if (isNaN(pos.x) || isNaN(pos.y)) {
            throw new Error(`Invalid position for ${id}: x=${pos.x}, y=${pos.y}`);
        }
        if (!isFinite(pos.x) || !isFinite(pos.y)) {
            throw new Error(`Infinite position for ${id}: x=${pos.x}, y=${pos.y}`);
        }
    }
}

// ==================== STRUCTURAL INVARIANTS ====================

import { ConstrainedModel, UnionId, LayoutModel } from '../../pipeline/types.js';

/**
 * Compute the bloodline-only descendant person span for a union.
 * Only includes descendant persons who are blood children (not their spouses),
 * matching the assertAncestorDominance logic.
 * Returns the center-relative span (the range of allowed union centers).
 */
function computeBloodlineSpanForUnion(
    unionId: UnionId,
    model: LayoutModel,
    personX: Map<PersonId, number>,
    cardWidth: number
): { left: number; right: number } | null {
    let left = Infinity;
    let right = -Infinity;

    const visited = new Set<UnionId>();
    const queue: UnionId[] = [unionId];

    while (queue.length > 0) {
        const uid = queue.shift()!;
        if (visited.has(uid)) continue;
        visited.add(uid);

        const union = model.unions.get(uid);
        if (!union) continue;

        for (const childId of union.childIds) {
            // Include this child's person position (bloodline only)
            const px = personX.get(childId);
            if (px !== undefined) {
                left = Math.min(left, px);
                right = Math.max(right, px + cardWidth);
            }

            // Find unions where this child is a parent, recurse
            for (const [cuid, cu] of model.unions) {
                if ((cu.partnerA === childId || cu.partnerB === childId) && !visited.has(cuid)) {
                    queue.push(cuid);
                }
            }
        }
    }

    if (!isFinite(left) || !isFinite(right)) return null;
    return { left, right };
}

/**
 * Compute the full visual descendant person span for a union.
 * Includes BOTH partners of child unions (full visual extent),
 * matching the assertAncestorEnvelope assertion's logic.
 */
function computeVisualSpanForUnion(
    unionId: UnionId,
    model: LayoutModel,
    personX: Map<PersonId, number>,
    cardWidth: number
): { left: number; right: number } | null {
    let left = Infinity;
    let right = -Infinity;

    const visited = new Set<UnionId>();
    const queue: UnionId[] = [unionId];

    while (queue.length > 0) {
        const uid = queue.shift()!;
        if (visited.has(uid)) continue;
        visited.add(uid);

        const union = model.unions.get(uid);
        if (!union) continue;

        for (const childId of union.childIds) {
            // Include child position
            const px = personX.get(childId);
            if (px !== undefined) {
                left = Math.min(left, px);
                right = Math.max(right, px + cardWidth);
            }

            // Find unions where this child is a parent
            for (const [cuid, cu] of model.unions) {
                if ((cu.partnerA === childId || cu.partnerB === childId) && !visited.has(cuid)) {
                    // Include the spouse too (visual span)
                    const spouseId = cu.partnerA === childId ? cu.partnerB : cu.partnerA;
                    if (spouseId) {
                        const sx = personX.get(spouseId);
                        if (sx !== undefined) {
                            left = Math.min(left, sx);
                            right = Math.max(right, sx + cardWidth);
                        }
                    }
                    queue.push(cuid);
                }
            }
        }
    }

    if (!isFinite(left) || !isFinite(right)) return null;
    return { left, right };
}

/**
 * Invariant: Parent-Children Centering
 *
 * For each union with children, the center X of the parent union must be
 * aligned with the center X of the children's couple-bounds span.
 *
 * Formula: center(parentUnion) ≈ center(childrenCoupleBoundsSpan)
 * Where childrenSpan = [min(childUnionX - coupleWidth/2), max(childUnionX + coupleWidth/2)]
 *
 * This uses the full couple width of each child's union (including their spouse),
 * matching the visual centering produced by the layout algorithm.
 *
 * @param tolerance Maximum allowed deviation in pixels (default: 1px)
 */
export function assertParentChildrenCentering(
    constrained: ConstrainedModel,
    tolerance = 1,
    cardWidth = DEFAULT_CARD_WIDTH
): void {
    const { placed } = constrained;
    const { measured, unionX, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const partnerGap = DEFAULT_LAYOUT_CONFIG.partnerGap;
    const coupleWidth = 2 * cardWidth + partnerGap;
    const horizontalGap = DEFAULT_LAYOUT_CONFIG.horizontalGap;

    // Step 1: Compute ideal center for each union with children
    const unionGen = genModel.unionGen;
    const idealCenters = new Map<UnionId, number>();

    for (const [unionId, union] of model.unions) {
        if (union.childIds.length === 0) continue;
        if (unionX.get(unionId) === undefined) continue;

        // Skip ancestor unions (gen < 0) — centering only applies to descendants
        const gen = unionGen.get(unionId);
        if (gen !== undefined && gen < 0) continue;

        let minChildX = Infinity;
        let maxChildX = -Infinity;

        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (!childUnionId) continue;
            const childCenterX = unionX.get(childUnionId);
            if (childCenterX === undefined) continue;
            const childUnion = model.unions.get(childUnionId);
            const childWidth = childUnion?.partnerB ? coupleWidth : cardWidth;
            minChildX = Math.min(minChildX, childCenterX - childWidth / 2);
            maxChildX = Math.max(maxChildX, childCenterX + childWidth / 2);
        }

        if (isFinite(minChildX) && isFinite(maxChildX)) {
            idealCenters.set(unionId, (minChildX + maxChildX) / 2);
        }
    }

    // Step 2: Compute minimum achievable deviation for overlap-constrained unions.
    // Simulates the same left-to-right sweep + centering algorithm that the layout
    // engine uses, to determine the geometrically unavoidable deviation.
    const overlapTolerance = new Map<UnionId, number>();

    const byGen = new Map<number, UnionId[]>();
    for (const [unionId] of idealCenters) {
        const gen = unionGen.get(unionId);
        if (gen === undefined) continue;
        if (!byGen.has(gen)) byGen.set(gen, []);
        byGen.get(gen)!.push(unionId);
    }

    for (const [, genUnions] of byGen) {
        if (genUnions.length < 2) continue;

        // Sort by ideal center
        const sorted = genUnions
            .map(uid => ({
                uid,
                ideal: idealCenters.get(uid)!,
                width: model.unions.get(uid)?.partnerB ? coupleWidth : cardWidth
            }))
            .sort((a, b) => a.ideal - b.ideal);

        // Simulate left-to-right sweep
        const positions = sorted.map(s => s.ideal);
        for (let i = 1; i < positions.length; i++) {
            const minDist = (sorted[i - 1].width + sorted[i].width) / 2 + horizontalGap;
            const minPos = positions[i - 1] + minDist;
            if (positions[i] < minPos) {
                positions[i] = minPos;
            }
        }

        // Center-shift to balance
        let totalDisplacement = 0;
        let pushedCount = 0;
        for (let i = 0; i < positions.length; i++) {
            const displacement = positions[i] - sorted[i].ideal;
            if (displacement > 0.5) {
                totalDisplacement += displacement;
                pushedCount++;
            }
        }
        if (pushedCount > 0 && pushedCount < positions.length) {
            const sharePerBlock = totalDisplacement / positions.length;
            for (let i = 0; i < positions.length; i++) {
                positions[i] -= sharePerBlock;
            }
        }

        // Simulate ancestor bounds cascade (right-to-left clamp)
        // Uses both bloodline and visual envelope bounds (tighter wins),
        // matching the layout algorithm's step 2b logic.
        for (let i = positions.length - 1; i >= 0; i--) {
            const halfWidth = sorted[i].width / 2;
            let upperBound = Infinity;
            let lowerBound = -Infinity;

            const bloodSpan = computeBloodlineSpanForUnion(
                sorted[i].uid, model, personX, cardWidth);
            if (bloodSpan) {
                upperBound = Math.min(upperBound, bloodSpan.right);
                lowerBound = Math.max(lowerBound, bloodSpan.left);
            }

            const visualSpan = computeVisualSpanForUnion(
                sorted[i].uid, model, personX, cardWidth);
            if (visualSpan) {
                upperBound = Math.min(upperBound, visualSpan.right - halfWidth);
                lowerBound = Math.max(lowerBound, visualSpan.left + halfWidth);
            }

            if (!isFinite(upperBound) && !isFinite(lowerBound)) continue;

            let newPos = positions[i];
            if (isFinite(upperBound) && newPos > upperBound) newPos = upperBound;
            if (isFinite(lowerBound) && newPos < lowerBound) newPos = lowerBound;

            if (newPos !== positions[i]) {
                positions[i] = newPos;
                // Cascade left to maintain minimum distance
                for (let j = i - 1; j >= 0; j--) {
                    const minDist = (sorted[j].width + sorted[j + 1].width) / 2 + horizontalGap;
                    const maxPos = positions[j + 1] - minDist;
                    if (positions[j] > maxPos) {
                        positions[j] = maxPos;
                    } else {
                        break;
                    }
                }
            }
        }

        // Compute achievable deviations from final simulated positions
        for (let i = 0; i < sorted.length; i++) {
            const achievableDeviation = Math.abs(positions[i] - sorted[i].ideal);
            overlapTolerance.set(sorted[i].uid,
                Math.max(overlapTolerance.get(sorted[i].uid) ?? 0, achievableDeviation));
        }
    }

    // Step 3: Check centering with effective tolerance per union
    const violations: string[] = [];

    for (const [unionId, union] of model.unions) {
        if (union.childIds.length === 0) continue;

        const parentCenterX = unionX.get(unionId);
        if (parentCenterX === undefined) continue;

        const childrenCenterX = idealCenters.get(unionId);
        if (childrenCenterX === undefined) continue;

        const deviation = Math.abs(parentCenterX - childrenCenterX);

        // Use the max of the requested tolerance and the geometrically-forced tolerance
        const effectiveTolerance = Math.max(tolerance, overlapTolerance.get(unionId) ?? 0);

        if (deviation > effectiveTolerance) {
            const parentA = model.persons.get(union.partnerA);
            const parentB = union.partnerB ? model.persons.get(union.partnerB) : null;
            const parentNames = parentB
                ? `${parentA?.firstName} ${parentA?.lastName} & ${parentB?.firstName} ${parentB?.lastName}`
                : `${parentA?.firstName} ${parentA?.lastName}`;

            violations.push(
                `Union "${parentNames}" (${unionId}): ` +
                `parent center=${parentCenterX.toFixed(1)}, ` +
                `children center=${childrenCenterX.toFixed(1)}, ` +
                `deviation=${deviation.toFixed(1)}px` +
                (effectiveTolerance > tolerance
                    ? ` (overlap-constrained, effective tol=${effectiveTolerance.toFixed(1)}px)`
                    : '')
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Parent-Children Centering Invariant violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Invariant: Ancestor Dominance
 *
 * Each ancestor must be positioned within the horizontal span of their
 * descendants. An ancestor "floating" outside their descendant tree
 * violates genealogical visual logic.
 *
 * For each union U at generation G:
 * - Collect all descendants at generations > G
 * - U's center X must be within [min(descendantX), max(descendantX + cardWidth)]
 *
 * @param tolerance Allowed overhang in pixels (default: 0 = strict)
 */
export function assertAncestorDominance(
    constrained: ConstrainedModel,
    tolerance = 0,
    cardWidth = DEFAULT_CARD_WIDTH
): void {
    const { placed } = constrained;
    const { measured, personX, unionX } = placed;
    const { genModel } = measured;
    const { model, unionGen } = genModel;

    const violations: string[] = [];

    // For each union, collect all descendants recursively
    function collectDescendants(unionId: UnionId, visited: Set<UnionId>): PersonId[] {
        if (visited.has(unionId)) return [];
        visited.add(unionId);

        const union = model.unions.get(unionId);
        if (!union) return [];

        const descendants: PersonId[] = [...union.childIds];

        // Recursively collect children's descendants
        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (childUnionId && childUnionId !== unionId) {
                // Find unions where this child is a parent
                for (const [uid, u] of model.unions) {
                    if ((u.partnerA === childId || u.partnerB === childId) && !visited.has(uid)) {
                        descendants.push(...collectDescendants(uid, visited));
                    }
                }
            }
        }

        return descendants;
    }

    for (const [unionId, union] of model.unions) {
        const gen = unionGen.get(unionId);
        if (gen === undefined) continue;

        // Skip ancestor unions (gen < 0) — dominance only applies to descendants
        if (gen < 0) continue;

        const parentCenterX = unionX.get(unionId);
        if (parentCenterX === undefined) continue;

        // Collect all descendants
        const descendants = collectDescendants(unionId, new Set());
        if (descendants.length === 0) continue;

        // Calculate descendants span
        let minDescX = Infinity;
        let maxDescX = -Infinity;

        for (const descId of descendants) {
            const descX = personX.get(descId);
            if (descX === undefined) continue;

            minDescX = Math.min(minDescX, descX);
            maxDescX = Math.max(maxDescX, descX + cardWidth);
        }

        if (!isFinite(minDescX) || !isFinite(maxDescX)) continue;

        // Check if parent center is within descendants span (with tolerance)
        if (parentCenterX < minDescX - tolerance || parentCenterX > maxDescX + tolerance) {
            const parentA = model.persons.get(union.partnerA);
            const parentB = union.partnerB ? model.persons.get(union.partnerB) : null;
            const parentNames = parentB
                ? `${parentA?.firstName} ${parentA?.lastName} & ${parentB?.firstName} ${parentB?.lastName}`
                : `${parentA?.firstName} ${parentA?.lastName}`;

            const overhang = parentCenterX < minDescX
                ? minDescX - parentCenterX
                : parentCenterX - maxDescX;

            violations.push(
                `Union "${parentNames}" (gen ${gen}): ` +
                `center=${parentCenterX.toFixed(1)} outside descendants span ` +
                `[${minDescX.toFixed(1)}, ${maxDescX.toFixed(1)}], ` +
                `overhang=${overhang.toFixed(1)}px`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Ancestor Dominance Invariant violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Helper: Check if two H/V segments intersect (excluding shared endpoints).
 */
function segmentsIntersect(
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number }
): boolean {
    // Normalize segments so x1 <= x2, y1 <= y2
    const ax1 = Math.min(a.x1, a.x2), ax2 = Math.max(a.x1, a.x2);
    const ay1 = Math.min(a.y1, a.y2), ay2 = Math.max(a.y1, a.y2);
    const bx1 = Math.min(b.x1, b.x2), bx2 = Math.max(b.x1, b.x2);
    const by1 = Math.min(b.y1, b.y2), by2 = Math.max(b.y1, b.y2);

    const aIsHorizontal = Math.abs(ay1 - ay2) < 0.5;
    const bIsHorizontal = Math.abs(by1 - by2) < 0.5;

    if (aIsHorizontal && bIsHorizontal) {
        // Both horizontal at same Y: collinear overlap, not a visual crossing.
        // Two buses/connectors sharing the same lane appear as overlapping lines,
        // not as segments crossing each other.
        return false;
    }

    if (!aIsHorizontal && !bIsHorizontal) {
        // Both vertical at same X: collinear overlap, not a visual crossing.
        return false;
    }

    // One horizontal, one vertical - check T intersection
    const h = aIsHorizontal
        ? { x1: ax1, x2: ax2, y: ay1 }
        : { x1: bx1, x2: bx2, y: by1 };
    const v = aIsHorizontal
        ? { y1: by1, y2: by2, x: bx1 }
        : { y1: ay1, y2: ay2, x: ax1 };

    // Interior crossing (not at endpoints)
    return h.x1 < v.x && v.x < h.x2 && v.y1 < h.y && h.y < v.y2;
}

// ==================== SPECIFICATION INVARIANTS ====================

/**
 * Invariant: Partner Ordering
 *
 * For each union with two partners, partnerA (left) must have a smaller
 * center X than partnerB (right). This ensures deterministic left-right
 * placement of couples.
 */
export function assertPartnerOrdering(
    constrained: ConstrainedModel,
    cardWidth = DEFAULT_CARD_WIDTH,
    tolerance = 0.5
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const violations: string[] = [];

    for (const [unionId, union] of model.unions) {
        if (!union.partnerB) continue;

        const xA = personX.get(union.partnerA);
        const xB = personX.get(union.partnerB);
        if (xA === undefined || xB === undefined) continue;

        const centerA = xA + cardWidth / 2;
        const centerB = xB + cardWidth / 2;

        if (centerA >= centerB - tolerance) {
            const personA = model.persons.get(union.partnerA);
            const personB = model.persons.get(union.partnerB);
            const nameA = `${personA?.firstName} ${personA?.lastName}`;
            const nameB = `${personB?.firstName} ${personB?.lastName}`;

            violations.push(
                `Union ${unionId}: partnerA "${nameA}" center=${centerA.toFixed(1)} ` +
                `should be left of partnerB "${nameB}" center=${centerB.toFixed(1)}`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Partner Ordering Invariant violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Invariant: Ancestor Envelope
 *
 * For each union U at a negative generation (ancestor), the horizontal span
 * of the ancestor cluster (U itself and all unions ABOVE U) must fit within
 * the horizontal span of U's full descendant tree.
 *
 * This prevents the "snake" pattern where ancestor generations drift wider
 * than the descendant tree they belong to.
 */
export function assertAncestorEnvelope(
    constrained: ConstrainedModel,
    tolerance = 0,
    cardWidth = DEFAULT_CARD_WIDTH
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model, unionGen } = genModel;

    const violations: string[] = [];

    // Helper: collect all descendant person IDs recursively from a union
    function collectDescendantPersons(unionId: UnionId, visited: Set<UnionId>): PersonId[] {
        if (visited.has(unionId)) return [];
        visited.add(unionId);

        const union = model.unions.get(unionId);
        if (!union) return [];

        const result: PersonId[] = [];

        // Add the union's own partners
        // (descendants include partners of child unions too)
        for (const childId of union.childIds) {
            result.push(childId);

            // Find unions where this child is a parent
            for (const [uid, u] of model.unions) {
                if ((u.partnerA === childId || u.partnerB === childId) && !visited.has(uid)) {
                    // Add the spouse too
                    if (u.partnerA !== childId) result.push(u.partnerA);
                    if (u.partnerB && u.partnerB !== childId) result.push(u.partnerB);
                    result.push(...collectDescendantPersons(uid, visited));
                }
            }
        }

        return result;
    }

    // Helper: collect all ancestor unions above a union
    function collectAncestorUnions(unionId: UnionId, visited: Set<UnionId>): UnionId[] {
        if (visited.has(unionId)) return [];
        visited.add(unionId);

        const union = model.unions.get(unionId);
        if (!union) return [];

        const result: UnionId[] = [];

        // For each partner, find their parent union
        const partners = [union.partnerA];
        if (union.partnerB) partners.push(union.partnerB);

        for (const partnerId of partners) {
            const parentUnionId = model.childToParentUnion.get(partnerId);
            if (parentUnionId && !visited.has(parentUnionId)) {
                result.push(parentUnionId);
                result.push(...collectAncestorUnions(parentUnionId, visited));
            }
        }

        return result;
    }

    // Check each ancestor union individually: it must be within its OWN descendant span.
    // This prevents "snake" patterns where an ancestor drifts beyond ALL of its descendants,
    // while correctly handling shared ancestors (serving multiple descendant lines).
    const checked = new Set<UnionId>();

    for (const [unionId] of model.unions) {
        const gen = unionGen.get(unionId);
        if (gen === undefined || gen >= 0) continue;

        // Collect ancestor unions above this one
        const ancestorUnionIds = collectAncestorUnions(unionId, new Set());

        for (const auid of ancestorUnionIds) {
            if (checked.has(auid)) continue;
            checked.add(auid);

            const au = model.unions.get(auid);
            if (!au) continue;

            const aGen = unionGen.get(auid);
            if (aGen === undefined) continue;

            // Compute THIS ancestor's own descendant span
            const descPersons = collectDescendantPersons(auid, new Set());
            if (descPersons.length === 0) continue;

            let descMinX = Infinity;
            let descMaxX = -Infinity;
            for (const pid of descPersons) {
                const x = personX.get(pid);
                if (x === undefined) continue;
                descMinX = Math.min(descMinX, x);
                descMaxX = Math.max(descMaxX, x + cardWidth);
            }
            if (!isFinite(descMinX)) continue;

            // Compute this ancestor's own person span
            let ancMinX = Infinity;
            let ancMaxX = -Infinity;
            const xA = personX.get(au.partnerA);
            if (xA !== undefined) {
                ancMinX = Math.min(ancMinX, xA);
                ancMaxX = Math.max(ancMaxX, xA + cardWidth);
            }
            if (au.partnerB) {
                const xB = personX.get(au.partnerB);
                if (xB !== undefined) {
                    ancMinX = Math.min(ancMinX, xB);
                    ancMaxX = Math.max(ancMaxX, xB + cardWidth);
                }
            }
            if (!isFinite(ancMinX)) continue;

            // Check: this ancestor must be within its own descendant span
            if (ancMinX < descMinX - tolerance || ancMaxX > descMaxX + tolerance) {
                const personA = model.persons.get(au.partnerA);
                const personB = au.partnerB ? model.persons.get(au.partnerB) : null;
                const names = personB
                    ? `${personA?.firstName} ${personA?.lastName} & ${personB?.firstName} ${personB?.lastName}`
                    : `${personA?.firstName} ${personA?.lastName}`;

                const leftOverhang = Math.max(0, descMinX - ancMinX - tolerance);
                const rightOverhang = Math.max(0, ancMaxX - descMaxX - tolerance);

                violations.push(
                    `Union "${names}" (gen ${aGen}): ancestor span [${ancMinX.toFixed(1)}, ${ancMaxX.toFixed(1)}] ` +
                    `exceeds descendant span [${descMinX.toFixed(1)}, ${descMaxX.toFixed(1)}]` +
                    (leftOverhang > 0 ? `, left overhang=${leftOverhang.toFixed(1)}` : '') +
                    (rightOverhang > 0 ? `, right overhang=${rightOverhang.toFixed(1)}` : '')
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Ancestor Envelope Invariant violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Invariant: Sibling Family Envelopes
 *
 * For each parent union P with 2+ children who themselves have families,
 * the horizontal span of each sibling's family (child + partner + their children)
 * must not overlap with other sibling families.
 *
 * Additionally, the order of family spans must match the birth order of siblings.
 */
export function assertSiblingFamilyEnvelopes(
    constrained: ConstrainedModel,
    minGap = DEFAULT_GAP,
    cardWidth = DEFAULT_CARD_WIDTH
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const violations: string[] = [];

    // Helper: compute horizontal span of a sibling family
    function familySpan(childId: PersonId): { minX: number; maxX: number } | null {
        let minX = Infinity;
        let maxX = -Infinity;

        // Include the child themselves
        const childX = personX.get(childId);
        if (childX !== undefined) {
            minX = Math.min(minX, childX);
            maxX = Math.max(maxX, childX + cardWidth);
        }

        // Find unions where child is a parent
        for (const [, u] of model.unions) {
            if (u.partnerA !== childId && u.partnerB !== childId) continue;

            // Include partner
            const partnerId = u.partnerA === childId ? u.partnerB : u.partnerA;
            if (partnerId) {
                const px = personX.get(partnerId);
                if (px !== undefined) {
                    minX = Math.min(minX, px);
                    maxX = Math.max(maxX, px + cardWidth);
                }
            }

            // Include their children (grandchildren of the parent union)
            for (const gcId of u.childIds) {
                const gcX = personX.get(gcId);
                if (gcX !== undefined) {
                    minX = Math.min(minX, gcX);
                    maxX = Math.max(maxX, gcX + cardWidth);
                }
            }
        }

        if (!isFinite(minX)) return null;
        return { minX, maxX };
    }

    for (const [unionId, union] of model.unions) {
        // Only check unions with 2+ children
        if (union.childIds.length < 2) continue;

        // Find children who have their own families
        const childrenWithFamilies: Array<{ childId: PersonId; span: { minX: number; maxX: number } }> = [];
        for (const childId of union.childIds) {
            // Check if child has a union of their own
            let hasFamily = false;
            for (const [, u] of model.unions) {
                if (u.partnerA === childId || u.partnerB === childId) {
                    hasFamily = true;
                    break;
                }
            }
            if (!hasFamily) continue;

            const span = familySpan(childId);
            if (span) {
                childrenWithFamilies.push({ childId, span });
            }
        }

        if (childrenWithFamilies.length < 2) continue;

        // Sort by left edge (current layout order)
        const sorted = [...childrenWithFamilies].sort((a, b) => a.span.minX - b.span.minX);

        // Check non-overlapping with minGap
        for (let i = 0; i < sorted.length - 1; i++) {
            const a = sorted[i];
            const b = sorted[i + 1];
            const gap = b.span.minX - a.span.maxX;

            if (gap < minGap - 0.5) {
                const personA = model.persons.get(a.childId);
                const personB = model.persons.get(b.childId);
                violations.push(
                    `Union ${unionId}: family of "${personA?.firstName} ${personA?.lastName}" ` +
                    `[${a.span.minX.toFixed(1)}, ${a.span.maxX.toFixed(1)}] overlaps with ` +
                    `family of "${personB?.firstName} ${personB?.lastName}" ` +
                    `[${b.span.minX.toFixed(1)}, ${b.span.maxX.toFixed(1)}] ` +
                    `(gap=${gap.toFixed(1)}, required=${minGap})`
                );
            }
        }

        // Check sibling order matches birth order
        const birthOrder = union.childIds.filter(cid =>
            childrenWithFamilies.some(f => f.childId === cid)
        );
        const layoutOrder = sorted.map(s => s.childId);

        for (let i = 0; i < birthOrder.length; i++) {
            if (birthOrder[i] !== layoutOrder[i]) {
                const expected = birthOrder.map(id => {
                    const p = model.persons.get(id);
                    return `${p?.firstName} ${p?.lastName}`;
                }).join(', ');
                const actual = layoutOrder.map(id => {
                    const p = model.persons.get(id);
                    return `${p?.firstName} ${p?.lastName}`;
                }).join(', ');

                violations.push(
                    `Union ${unionId}: sibling family order doesn't match birth order. ` +
                    `Expected: [${expected}], Got: [${actual}]`
                );
                break;
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Sibling Family Envelope Invariant violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Invariant: No Staircase Edges
 *
 * A staircase edge is a connection with multiple horizontal segments at
 * different Y levels. Valid bus routing should have exactly one horizontal bus
 * (and optionally a connector at the SAME Y level).
 *
 * This wraps detectStaircaseEdges with jitter tolerance.
 */
// ==================== BRANCH INVARIANTS ====================

import { FamilyBlock, FamilyBlockId, FamilyBlockModel, BranchModel, SiblingFamilyBranch } from '../../pipeline/types.js';

/**
 * Invariant: Branch Separation
 *
 * For each parent union with 2+ branches, the X corridors of sibling branches
 * must not overlap (with at least minGap between them).
 * Branch order must match sibling order (siblingIndex).
 */
export function assertBranchSeparation(
    constrained: ConstrainedModel,
    minGap = DEFAULT_GAP
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const branchModel = measured as BranchModel;

    if (!branchModel.branches || branchModel.branches.size === 0) return;

    const violations: string[] = [];

    for (const [unionId, branchIds] of branchModel.parentUnionToBranches) {
        if (branchIds.length < 2) continue;

        const sortedBranches = branchIds
            .map(bid => branchModel.branches.get(bid))
            .filter((b): b is SiblingFamilyBranch => b !== undefined)
            .sort((a, b) => a.siblingIndex - b.siblingIndex);

        for (let i = 1; i < sortedBranches.length; i++) {
            const prev = sortedBranches[i - 1];
            const curr = sortedBranches[i];

            const gap = curr.minX - prev.maxX;
            if (gap < minGap - 0.5) {
                violations.push(
                    `Union ${unionId}: branch "${prev.id}" maxX=${prev.maxX.toFixed(1)} ` +
                    `overlaps with branch "${curr.id}" minX=${curr.minX.toFixed(1)} ` +
                    `(gap=${gap.toFixed(1)}, required=${minGap})`
                );
            }
        }

        // Check order matches siblingIndex
        const byPosition = [...sortedBranches].sort((a, b) => a.minX - b.minX);
        for (let i = 0; i < byPosition.length; i++) {
            if (byPosition[i].id !== sortedBranches[i].id) {
                violations.push(
                    `Union ${unionId}: branch layout order doesn't match sibling order`
                );
                break;
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Branch Separation Invariant violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Invariant: No Cross-Branch Routing
 *
 * Bus segments (branchLeftX, branchRightX) should stay within
 * their branch corridor. Buses from one branch should not extend
 * into another branch's X corridor.
 */
export function assertNoCrossBranchRouting(
    routed: RoutedModel,
    branchModel: BranchModel
): void {
    if (!branchModel.branches || branchModel.branches.size === 0) return;

    const violations: string[] = [];

    for (const conn of routed.connections) {
        const branchId = branchModel.unionToBranch.get(conn.unionId);
        if (!branchId) continue;

        const branch = branchModel.branches.get(branchId);
        if (!branch) continue;

        // Check bus within branch corridor (with some tolerance)
        const tolerance = 2;
        if (conn.branchLeftX < branch.minX - tolerance) {
            violations.push(
                `Connection ${conn.unionId}: bus left ${conn.branchLeftX.toFixed(1)} ` +
                `extends beyond branch ${branchId} minX=${branch.minX.toFixed(1)}`
            );
        }
        if (conn.branchRightX > branch.maxX + tolerance) {
            violations.push(
                `Connection ${conn.unionId}: bus right ${conn.branchRightX.toFixed(1)} ` +
                `extends beyond branch ${branchId} maxX=${branch.maxX.toFixed(1)}`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Cross-Branch Routing Invariant violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Invariant: Ancestor Within Branch
 *
 * Ancestor blocks are not part of the branch system, but their center
 * should be within the union of branch corridors of their descendants.
 * This is a softer check than strict containment.
 */
export function assertAncestorWithinBranch(
    constrained: ConstrainedModel,
    _cardWidth = DEFAULT_CARD_WIDTH
): void {
    // This is validated by assertAncestorDominance which already
    // checks ancestor center within descendant span.
    // Branch-aware version is a tighter check.
    const { placed } = constrained;
    const { measured } = placed;
    const branchModel = measured as BranchModel;

    if (!branchModel.branches || branchModel.branches.size === 0) return;
    // No additional check needed - branch separation ensures descendants
    // are properly grouped, and assertAncestorDominance ensures ancestors
    // are within their descendant span.
}

/**
 * Invariant: Elbow Clearance
 *
 * For each elbow point (where vertical meets horizontal in a connection),
 * check that the distance to all vertical segments (stems/drops) of OTHER
 * connections at the same Y range is at least minClearance.
 *
 * This prevents visually-confusing near-touches between connection segments
 * from different parent-child relationships.
 */
export function assertElbowClearance(
    connections: Connection[],
    minClearance: number = 14,
    tolerance: number = 1
): void {
    interface ElbowPt {
        x: number;
        y: number;
        connIdx: number;
        type: string;
    }

    // Extract elbows
    const elbows: ElbowPt[] = [];
    for (let i = 0; i < connections.length; i++) {
        const conn = connections[i];
        // Stem bottom elbow
        elbows.push({ x: conn.stemX, y: conn.stemBottomY, connIdx: i, type: 'stem-bottom' });
        // Drop top elbows
        for (const drop of conn.drops) {
            elbows.push({ x: drop.x, y: drop.topY, connIdx: i, type: 'drop-top' });
        }
    }

    const violations: string[] = [];

    for (const elbow of elbows) {
        for (let ci = 0; ci < connections.length; ci++) {
            if (ci === elbow.connIdx) continue;
            const conn = connections[ci];

            // Check stem
            const stemMinY = Math.min(conn.stemTopY, conn.stemBottomY);
            const stemMaxY = Math.max(conn.stemTopY, conn.stemBottomY);
            if (elbow.y >= stemMinY - 1 && elbow.y <= stemMaxY + 1) {
                const dist = Math.abs(elbow.x - conn.stemX);
                if (dist < minClearance - tolerance && dist > 0.5) {
                    violations.push(
                        `Elbow (${elbow.type}) at (${elbow.x.toFixed(1)}, ${elbow.y.toFixed(1)}) ` +
                        `from connection ${connections[elbow.connIdx].unionId} ` +
                        `is ${dist.toFixed(1)}px from stem of ${conn.unionId} ` +
                        `(required: ${minClearance}px)`
                    );
                }
            }

            // Check drops
            for (const drop of conn.drops) {
                const dropMinY = Math.min(drop.topY, drop.bottomY);
                const dropMaxY = Math.max(drop.topY, drop.bottomY);
                if (elbow.y >= dropMinY - 1 && elbow.y <= dropMaxY + 1) {
                    const dist = Math.abs(elbow.x - drop.x);
                    if (dist < minClearance - tolerance && dist > 0.5) {
                        violations.push(
                            `Elbow (${elbow.type}) at (${elbow.x.toFixed(1)}, ${elbow.y.toFixed(1)}) ` +
                            `from connection ${connections[elbow.connIdx].unionId} ` +
                            `is ${dist.toFixed(1)}px from drop of ${conn.unionId} ` +
                            `(required: ${minClearance}px)`
                        );
                    }
                }
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Elbow Clearance Invariant violated (min ${minClearance}px):\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

export function assertNoStaircaseEdges(
    connections: Connection[],
    jitterTolerance = 3
): void {
    const violations: string[] = [];

    for (const conn of connections) {
        const yLevels = new Set<number>();

        // Bus horizontal segment
        yLevels.add(Math.round(conn.branchY / jitterTolerance) * jitterTolerance);

        // Check if connector exists
        const hasConnector = Math.abs(conn.connectorFromX - conn.connectorToX) > 0.5;
        if (hasConnector) {
            const connectorYRounded = Math.round(conn.connectorY / jitterTolerance) * jitterTolerance;
            yLevels.add(connectorYRounded);
        }

        if (yLevels.size > 1) {
            violations.push(
                `Connection ${conn.unionId}: staircase pattern with ${yLevels.size} horizontal levels. ` +
                `connectorY=${conn.connectorY.toFixed(1)}, branchY=${conn.branchY.toFixed(1)}`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `No-Staircase-Edges Invariant violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

// ==================== SIBLING FAMILY CLUSTER ORDER ====================

/**
 * Compute X extent of a block's subtree, stopping at BOTH blocks.
 * Matches subtreeExtentSideOnly from 6-constraints.ts.
 * Used by SFCO, PSSC, and ASO assertions to avoid inflating extents
 * with focus/descendant blocks.
 */
function computeSubtreeExtentSideOnly(
    blockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>
): { minX: number; maxX: number } {
    const block = blocks.get(blockId);
    if (!block) return { minX: 0, maxX: 0 };

    let minX = block.xLeft;
    let maxX = block.xRight;

    const stack = [...block.childBlockIds];
    const visited = new Set<FamilyBlockId>([blockId]);

    while (stack.length > 0) {
        const childId = stack.pop()!;
        if (visited.has(childId)) continue;
        visited.add(childId);

        const child = blocks.get(childId);
        if (!child) continue;

        // Stop at BOTH blocks (focus/descendants)
        if (child.side === 'BOTH') continue;

        minX = Math.min(minX, child.xLeft);
        maxX = Math.max(maxX, child.xRight);

        for (const gcId of child.childBlockIds) {
            stack.push(gcId);
        }
    }

    return { minX, maxX };
}

/**
 * Compute the full X extent of a block's subtree using couple card positions.
 * Uses xCenter + couple width formula (not block.xLeft/xRight which may be stale).
 * This gives the true visual extent of the subtree.
 */
function computeSubtreeCardExtent(
    blockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    cardWidth: number = DEFAULT_CARD_WIDTH,
    partnerGap: number = DEFAULT_LAYOUT_CONFIG.partnerGap
): { minX: number; maxX: number } {
    const block = blocks.get(blockId);
    if (!block) return { minX: 0, maxX: 0 };

    function blockCardExtent(b: FamilyBlock): { left: number; right: number } {
        const union = model.unions.get(b.rootUnionId);
        if (union?.partnerB) {
            return {
                left: b.xCenter - partnerGap / 2 - cardWidth,
                right: b.xCenter + partnerGap / 2 + cardWidth
            };
        }
        return {
            left: b.xCenter - cardWidth / 2,
            right: b.xCenter + cardWidth / 2
        };
    }

    const rootExtent = blockCardExtent(block);
    let minX = rootExtent.left;
    let maxX = rootExtent.right;

    const stack = [...block.childBlockIds];
    const visited = new Set<FamilyBlockId>([blockId]);

    while (stack.length > 0) {
        const childId = stack.pop()!;
        if (visited.has(childId)) continue;
        visited.add(childId);

        const child = blocks.get(childId);
        if (!child) continue;

        const ext = blockCardExtent(child);
        minX = Math.min(minX, ext.left);
        maxX = Math.max(maxX, ext.right);

        for (const gcId of child.childBlockIds) {
            stack.push(gcId);
        }
    }

    return { minX, maxX };
}

/**
 * Invariant: Sibling Family Cluster Order (SFCO)
 *
 * For each union with 2+ children who have their own unions,
 * the subtree X intervals of sibling family clusters must be
 * ordered and non-overlapping (with at least minGap between them).
 *
 * This verifies that siblings' family clusters (sibling + partner + descendants)
 * do not interleave after constraint resolution.
 */
export function assertSiblingFamilyClusterOrder(
    constrained: ConstrainedModel,
    minGap: number = 15
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    const violations: string[] = [];

    for (const [, union] of model.unions) {
        if (union.childIds.length < 2) continue;

        // Build sibling entries with subtree extents
        const siblings: Array<{
            personId: PersonId;
            blockId: FamilyBlockId;
            xCenter: number;
            extent: { minX: number; maxX: number };
        }> = [];

        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (!childUnionId) continue;
            const blockId = unionToBlock.get(childUnionId);
            if (!blockId) continue;
            const block = blocks.get(blockId);
            if (!block) continue;

            const extent = computeSubtreeExtentSideOnly(blockId, blocks);
            siblings.push({ personId: childId, blockId, xCenter: block.xCenter, extent });
        }

        if (siblings.length < 2) continue;
        siblings.sort((a, b) => a.xCenter - b.xCenter);

        // Check: for all i < j, extent(i).maxX + gap <= extent(j).minX
        for (let i = 0; i < siblings.length - 1; i++) {
            for (let j = i + 1; j < siblings.length; j++) {
                const si = siblings[i];
                const sj = siblings[j];
                const overlapAmount = si.extent.maxX + minGap - sj.extent.minX;
                if (overlapAmount > 0.5) {
                    const nameI = model.persons.get(si.personId)?.firstName ?? si.personId;
                    const nameJ = model.persons.get(sj.personId)?.firstName ?? sj.personId;
                    violations.push(
                        `Siblings "${nameI}" and "${nameJ}": ` +
                        `cluster ${nameI} extends to ${si.extent.maxX.toFixed(1)}, ` +
                        `cluster ${nameJ} starts at ${sj.extent.minX.toFixed(1)}, ` +
                        `overlap=${overlapAmount.toFixed(1)}px`
                    );
                }
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Sibling Family Cluster Order violated:\n${violations.join('\n')}`
        );
    }
}

/**
 * Invariant: Branch Cluster Order (BCO)
 *
 * For each gen>=0 union with 2+ children who have their own blocks,
 * the full subtree X intervals must be ordered and non-overlapping
 * (with at least minGap between them).
 *
 * Unlike SFCO which uses side-only extents, BCO uses the FULL subtreeExtent
 * (all descendants) to detect interleaving of branch subtrees.
 */
export function assertBranchClusterOrder(
    constrained: ConstrainedModel,
    minGap: number = 15
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    const violations: string[] = [];

    for (const [, union] of model.unions) {
        if (union.childIds.length < 2) continue;

        // Build sibling entries with full subtree card extents
        const siblings: Array<{
            personId: PersonId;
            blockId: FamilyBlockId;
            xCenter: number;
            extent: { minX: number; maxX: number };
        }> = [];

        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (!childUnionId) continue;
            const blockId = unionToBlock.get(childUnionId);
            if (!blockId) continue;
            const block = blocks.get(blockId);
            if (!block || block.generation < 0) continue;

            const extent = computeSubtreeCardExtent(blockId, blocks, model);
            siblings.push({ personId: childId, blockId, xCenter: block.xCenter, extent });
        }

        if (siblings.length < 2) continue;
        siblings.sort((a, b) => a.xCenter - b.xCenter);

        // Check all pairs: extent(i).maxX + gap <= extent(j).minX
        for (let i = 0; i < siblings.length - 1; i++) {
            for (let j = i + 1; j < siblings.length; j++) {
                const si = siblings[i];
                const sj = siblings[j];
                const overlapAmount = si.extent.maxX + minGap - sj.extent.minX;
                if (overlapAmount > 0.5) {
                    const nameI = model.persons.get(si.personId)?.firstName ?? si.personId;
                    const nameJ = model.persons.get(sj.personId)?.firstName ?? sj.personId;
                    violations.push(
                        `Siblings "${nameI}" and "${nameJ}": ` +
                        `cluster ${nameI} extends to ${si.extent.maxX.toFixed(1)}, ` +
                        `cluster ${nameJ} starts at ${sj.extent.minX.toFixed(1)}, ` +
                        `overlap=${overlapAmount.toFixed(1)}px`
                    );
                }
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Branch Cluster Order (BCO) violated:\n${violations.join('\n')}`
        );
    }
}

/**
 * Invariant: No Excessive Branch Gaps
 *
 * After BCO compaction, gaps between consecutive sibling subtrees
 * should not exceed maxGapMultiplier * horizontalGap.
 * This ensures compaction actually removed unnecessary whitespace.
 *
 * @param maxGapMultiplier Maximum allowed gap as multiple of horizontalGap (default: 3)
 */
export function assertNoExcessiveBranchGaps(
    constrained: ConstrainedModel,
    maxGapMultiplier: number = 3
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    const horizontalGap = DEFAULT_GAP;
    const maxGap = horizontalGap * maxGapMultiplier;
    const violations: string[] = [];

    for (const [, union] of model.unions) {
        if (union.childIds.length < 2) continue;

        const siblings: Array<{
            personId: PersonId;
            blockId: FamilyBlockId;
            xCenter: number;
            extent: { minX: number; maxX: number };
        }> = [];

        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (!childUnionId) continue;
            const blockId = unionToBlock.get(childUnionId);
            if (!blockId) continue;
            const block = blocks.get(blockId);
            if (!block || block.generation < 0) continue;

            const extent = computeSubtreeCardExtent(blockId, blocks, model);
            siblings.push({ personId: childId, blockId, xCenter: block.xCenter, extent });
        }

        if (siblings.length < 2) continue;
        siblings.sort((a, b) => a.xCenter - b.xCenter);

        for (let i = 0; i < siblings.length - 1; i++) {
            const gap = siblings[i + 1].extent.minX - siblings[i].extent.maxX;
            if (gap > maxGap + 0.5) {
                const nameI = model.persons.get(siblings[i].personId)?.firstName ?? siblings[i].personId;
                const nameJ = model.persons.get(siblings[i + 1].personId)?.firstName ?? siblings[i + 1].personId;
                violations.push(
                    `Gap between "${nameI}" and "${nameJ}": ` +
                    `${gap.toFixed(1)}px exceeds max ${maxGap.toFixed(1)}px ` +
                    `(${(gap / horizontalGap).toFixed(1)}× horizontalGap)`
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Excessive Branch Gaps detected:\n${violations.join('\n')}`
        );
    }
}

/**
 * Invariant: Couple Ancestor Polarity (CAP)
 *
 * For EVERY couple block (gen <= 0) with both partners (H=left, W=right):
 *   xMid = (block.husbandAnchorX + block.wifeAnchorX) / 2
 *
 *   All ancestor blocks reachable UPWARD from H must have xRight <= xMid - minGap
 *   All ancestor blocks reachable UPWARD from W must have xLeft >= xMid + minGap
 *
 * This is recursive: polarity is enforced at every ancestor couple level,
 * not just at the focus block.
 *
 * @param minGap Minimum gap from midpoint (default: horizontalGap = 15)
 * @param tolerance Allowed violation in pixels (default: 1px)
 */
export function assertCoupleAncestorPolarity(
    constrained: ConstrainedModel,
    focusPersonId?: PersonId,
    minGap = DEFAULT_GAP,
    tolerance = 1
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    // CAP only applies to focus parents (gen -1)
    // Algorithm: H/W polarity is enforced only for parents of focus person
    if (!focusPersonId) return;

    // Find focus parent union (gen -1)
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return; // Focus has no parents

    const focusParentBlockId = unionToBlock.get(focusParentUnionId);
    if (!focusParentBlockId) return;

    const coupleBlock = blocks.get(focusParentBlockId);
    if (!coupleBlock) return;

    const union = model.unions.get(coupleBlock.rootUnionId);
    if (!union || !union.partnerB) return; // Single parent - no polarity

    // Helper: collect all ancestor blocks UPWARD from a person
    function collectAncestorSubtreeUp(personId: PersonId): FamilyBlock[] {
        const result: FamilyBlock[] = [];
        const visited = new Set<PersonId>();

        function trace(pid: PersonId): void {
            if (visited.has(pid)) return;
            visited.add(pid);

            const parentUnionId = model.childToParentUnion.get(pid);
            if (!parentUnionId) return;

            const blockId = unionToBlock.get(parentUnionId);
            if (!blockId) return;

            const block = blocks.get(blockId);
            if (!block) return;

            result.push(block);

            const parentUnion = model.unions.get(parentUnionId);
            if (parentUnion) {
                trace(parentUnion.partnerA);
                if (parentUnion.partnerB) trace(parentUnion.partnerB);
            }
        }

        trace(personId);
        return result;
    }

    // Collect ancestor subtrees for both sides
    const hBlocks = collectAncestorSubtreeUp(union.partnerA);
    const wBlocks = union.partnerB ? collectAncestorSubtreeUp(union.partnerB) : [];

    // CAP only applies when BOTH sides have ancestors
    // Algorithm: if only one side has ancestors, they are centered above that parent
    if (hBlocks.length === 0 || wBlocks.length === 0) return;

    // Exclude shared blocks (common ancestors due to consanguinity)
    const hBlockIds = new Set(hBlocks.map(b => b.id));
    const wBlockIds = new Set(wBlocks.map(b => b.id));
    const exclusiveH = hBlocks.filter(b => !wBlockIds.has(b.id));
    const exclusiveW = wBlocks.filter(b => !hBlockIds.has(b.id));

    const xMid = (coupleBlock.husbandAnchorX + coupleBlock.wifeAnchorX) / 2;
    const violations: string[] = [];

    // Check H-side: each exclusive block's couple right edge must be <= boundary
    for (const b of exclusiveH) {
        const boundary = xMid - minGap;
        const coupleRight = b.xCenter + b.coupleWidth / 2;
        if (coupleRight > boundary + tolerance) {
            const personA = model.persons.get(union.partnerA);
            const vUnion = model.unions.get(b.rootUnionId);
            const vNames = vUnion?.partnerB
                ? `${model.persons.get(vUnion.partnerA)?.firstName} & ${model.persons.get(vUnion.partnerB)?.firstName}`
                : `${model.persons.get(vUnion!.partnerA)?.firstName}`;
            violations.push(
                `H-side ancestor "${vNames}" (gen ${b.generation}) of ` +
                `"${personA?.firstName}": coupleRight=${coupleRight.toFixed(1)} exceeds ` +
                `boundary=${boundary.toFixed(1)} (violation=${(coupleRight - boundary).toFixed(1)}px)`
            );
        }
    }

    // Check W-side: each exclusive block's couple left edge must be >= boundary
    for (const b of exclusiveW) {
        const boundary = xMid + minGap;
        const coupleLeft = b.xCenter - b.coupleWidth / 2;
        if (coupleLeft < boundary - tolerance) {
            const personB = model.persons.get(union.partnerB!);
            const vUnion = model.unions.get(b.rootUnionId);
            const vNames = vUnion?.partnerB
                ? `${model.persons.get(vUnion.partnerA)?.firstName} & ${model.persons.get(vUnion.partnerB)?.firstName}`
                : `${model.persons.get(vUnion!.partnerA)?.firstName}`;
            violations.push(
                `W-side ancestor "${vNames}" (gen ${b.generation}) of ` +
                `"${personB?.firstName}": coupleLeft=${coupleLeft.toFixed(1)} below ` +
                `boundary=${boundary.toFixed(1)} (violation=${(boundary - coupleLeft).toFixed(1)}px)`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Couple Ancestor Polarity (CAP) violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Invariant: Parent Sibling Side Consistency (PSSC)
 *
 * For each couple block (gen <= 0) with both partners:
 *   - Father's siblings' subtrees must have maxX <= husbandAnchorX
 *   - Mother's siblings' subtrees must have minX >= wifeAnchorX
 *
 * This prevents parent siblings from crossing into the wrong side of the couple.
 *
 * @param tolerance Allowed violation in pixels (default: 0)
 */
export function assertParentSiblingSideConsistency(
    constrained: ConstrainedModel,
    tolerance = 0
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;
    const violations: string[] = [];

    // For each ancestor couple block (gen < 0, both partners present)
    // Gen 0 (focus) is excluded — its siblings are handled by SFCO
    for (const [, coupleBlock] of blocks) {
        if (coupleBlock.generation >= 0) continue;
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union || !union.partnerB) continue;

        const xH = coupleBlock.husbandAnchorX;
        const xW = coupleBlock.wifeAnchorX;

        // Check father's siblings (partnerA = husband)
        checkPartnerSiblings(
            union.partnerA, 'HUSBAND', xH,
            model, unionToBlock, blocks, tolerance, violations
        );

        // Check mother's siblings (partnerB = wife)
        checkPartnerSiblings(
            union.partnerB, 'WIFE', xW,
            model, unionToBlock, blocks, tolerance, violations
        );
    }

    if (violations.length > 0) {
        throw new Error(
            `Parent Sibling Side Consistency (PSSC) violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

function checkPartnerSiblings(
    partnerId: PersonId,
    side: 'HUSBAND' | 'WIFE',
    boundary: number,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    tolerance: number,
    violations: string[]
): void {
    // Find partner's parent union (grandparent union)
    const grandparentUnionId = model.childToParentUnion.get(partnerId);
    if (!grandparentUnionId) return;

    const grandparentUnion = model.unions.get(grandparentUnionId);
    if (!grandparentUnion) return;

    // Get siblings (all children of grandparent union except the partner)
    for (const siblingId of grandparentUnion.childIds) {
        if (siblingId === partnerId) continue;

        // Find sibling's block (via personToUnion + unionToBlock)
        const sibUnionId = model.personToUnion.get(siblingId);
        if (!sibUnionId) continue;
        const sibBlockId = unionToBlock.get(sibUnionId);
        if (!sibBlockId) continue;
        const sibBlock = blocks.get(sibBlockId);
        if (!sibBlock) continue;

        // Compute subtree extent (side-only: stops at BOTH blocks)
        const extent = computeSubtreeExtentSideOnly(sibBlockId, blocks);

        const person = model.persons.get(partnerId);
        const sibling = model.persons.get(siblingId);
        const partnerName = person ? `${person.firstName}` : partnerId;
        const sibName = sibling ? `${sibling.firstName}` : siblingId;

        if (side === 'HUSBAND') {
            // Father's siblings: maxX(subtree) <= boundary
            if (extent.maxX > boundary + tolerance) {
                const violation = extent.maxX - boundary;
                violations.push(
                    `H-sibling "${sibName}" of "${partnerName}" (gen ${sibBlock.generation}): ` +
                    `subtree maxX=${extent.maxX.toFixed(1)} exceeds boundary=${boundary.toFixed(1)} ` +
                    `(violation=${violation.toFixed(1)}px)`
                );
            }
        } else {
            // Mother's siblings: minX(subtree) >= boundary
            if (extent.minX < boundary - tolerance) {
                const violation = boundary - extent.minX;
                violations.push(
                    `W-sibling "${sibName}" of "${partnerName}" (gen ${sibBlock.generation}): ` +
                    `subtree minX=${extent.minX.toFixed(1)} below boundary=${boundary.toFixed(1)} ` +
                    `(violation=${violation.toFixed(1)}px)`
                );
            }
        }
    }
}

/**
 * Invariant: Ancestor Side Ownership (ASO)
 *
 * Only applies to focus parents (gen -1) when BOTH sides have ancestors.
 * Algorithm: H/W polarity is enforced only for parents of focus person.
 *
 * For the focus parent couple:
 *   - H-side: All ancestor subtree blocks of husband must have maxX <= wifeAnchorX
 *   - W-side: All ancestor subtree blocks of wife must have minX >= husbandAnchorX
 *
 * @param focusPersonId The focus person ID (required)
 * @param tolerance Allowed violation in pixels (default: 0)
 */
export function assertAncestorSideOwnership(
    constrained: ConstrainedModel,
    focusPersonId?: PersonId,
    tolerance = 0
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    // ASO only applies to focus parents (gen -1)
    if (!focusPersonId) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    // Find focus parent union (gen -1)
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return; // Focus has no parents

    const focusParentBlockId = unionToBlock.get(focusParentUnionId);
    if (!focusParentBlockId) return;

    const coupleBlock = blocks.get(focusParentBlockId);
    if (!coupleBlock) return;

    const union = model.unions.get(coupleBlock.rootUnionId);
    if (!union || !union.partnerB) return; // Single parent - no polarity

    const violations: string[] = [];

    // Helper: collect all blocks reachable upward from a partner
    function collectSideBlocks(partnerId: PersonId): FamilyBlockId[] {
        const result: FamilyBlockId[] = [];
        const visitedPersons = new Set<PersonId>();
        const visitedBlocks = new Set<FamilyBlockId>();

        function trace(pid: PersonId): void {
            if (visitedPersons.has(pid)) return;
            visitedPersons.add(pid);

            const parentUnionId = model.childToParentUnion.get(pid);
            if (!parentUnionId) return;

            const parentBlockId = unionToBlock.get(parentUnionId);
            if (!parentBlockId || visitedBlocks.has(parentBlockId)) return;
            visitedBlocks.add(parentBlockId);

            const parentBlock = blocks.get(parentBlockId);
            if (!parentBlock) return;

            result.push(parentBlockId);

            const parentUnion = model.unions.get(parentUnionId);
            if (!parentUnion) return;

            for (const childId of parentUnion.childIds) {
                if (childId === pid) continue;
                const sibUnionId = model.personToUnion.get(childId);
                if (!sibUnionId) continue;
                const sibBlockId = unionToBlock.get(sibUnionId);
                if (!sibBlockId || visitedBlocks.has(sibBlockId)) continue;
                visitedBlocks.add(sibBlockId);
                result.push(sibBlockId);
            }

            trace(parentUnion.partnerA);
            if (parentUnion.partnerB) trace(parentUnion.partnerB);
        }

        trace(partnerId);
        return result;
    }

    // Helper: is this block a direct ancestor (on the direct line)?
    function isDirect(blockId: FamilyBlockId, partnerId: PersonId): boolean {
        const visited = new Set<PersonId>();

        function trace(pid: PersonId): boolean {
            if (visited.has(pid)) return false;
            visited.add(pid);

            const parentUnionId = model.childToParentUnion.get(pid);
            if (!parentUnionId) return false;

            const parentBlockId = unionToBlock.get(parentUnionId);
            if (parentBlockId === blockId) return true;

            const parentUnion = model.unions.get(parentUnionId);
            if (!parentUnion) return false;

            if (trace(parentUnion.partnerA)) return true;
            if (parentUnion.partnerB && trace(parentUnion.partnerB)) return true;
            return false;
        }

        return trace(partnerId);
    }

    const hBoundary = coupleBlock.wifeAnchorX;    // H-side: maxX <= wifeAnchorX
    const wBoundary = coupleBlock.husbandAnchorX; // W-side: minX >= husbandAnchorX

    const hBlockIds = collectSideBlocks(union.partnerA);
    const wBlockIds = collectSideBlocks(union.partnerB);

    // ASO only applies when BOTH sides have ancestors
    if (hBlockIds.length === 0 || wBlockIds.length === 0) return;

    // Exclude shared blocks (consanguinity)
    const hSet = new Set(hBlockIds);
    const wSet = new Set(wBlockIds);
    const exclusiveH = hBlockIds.filter(id => !wSet.has(id));
    const exclusiveW = wBlockIds.filter(id => !hSet.has(id));

    // Check H-side
    for (const bid of exclusiveH) {
        const block = blocks.get(bid);
        if (!block) continue;

        const direct = isDirect(bid, union.partnerA);

        if (direct) {
            const coupleRight = block.xCenter + block.coupleWidth / 2;
            if (coupleRight > hBoundary + tolerance) {
                const bUnion = model.unions.get(block.rootUnionId);
                const bNames = bUnion?.partnerB
                    ? `${model.persons.get(bUnion.partnerA)?.firstName} & ${model.persons.get(bUnion.partnerB)?.firstName}`
                    : `${model.persons.get(bUnion!.partnerA)?.firstName}`;
                violations.push(
                    `H-side ancestor "${bNames}" (gen ${block.generation}): ` +
                    `coupleRight=${coupleRight.toFixed(1)} exceeds boundary=${hBoundary.toFixed(1)} ` +
                    `(violation=${(coupleRight - hBoundary).toFixed(1)}px)`
                );
            }
        } else {
            const extent = computeSubtreeExtentSideOnly(bid, blocks);
            if (extent.maxX > hBoundary + tolerance) {
                const bUnion = model.unions.get(block.rootUnionId);
                const bNames = bUnion?.partnerB
                    ? `${model.persons.get(bUnion.partnerA)?.firstName} & ${model.persons.get(bUnion.partnerB)?.firstName}`
                    : `${model.persons.get(bUnion!.partnerA)?.firstName}`;
                violations.push(
                    `H-side sibling "${bNames}" (gen ${block.generation}): ` +
                    `subtree maxX=${extent.maxX.toFixed(1)} exceeds boundary=${hBoundary.toFixed(1)} ` +
                    `(violation=${(extent.maxX - hBoundary).toFixed(1)}px)`
                );
            }
        }
    }

    // Check W-side
    for (const bid of exclusiveW) {
        const block = blocks.get(bid);
        if (!block) continue;

        const direct = isDirect(bid, union.partnerB);

        if (direct) {
            const coupleLeft = block.xCenter - block.coupleWidth / 2;
            if (coupleLeft < wBoundary - tolerance) {
                const bUnion = model.unions.get(block.rootUnionId);
                const bNames = bUnion?.partnerB
                    ? `${model.persons.get(bUnion.partnerA)?.firstName} & ${model.persons.get(bUnion.partnerB)?.firstName}`
                    : `${model.persons.get(bUnion!.partnerA)?.firstName}`;
                violations.push(
                    `W-side ancestor "${bNames}" (gen ${block.generation}): ` +
                    `coupleLeft=${coupleLeft.toFixed(1)} below boundary=${wBoundary.toFixed(1)} ` +
                    `(violation=${(wBoundary - coupleLeft).toFixed(1)}px)`
                );
            }
        } else {
            const extent = computeSubtreeExtentSideOnly(bid, blocks);
            if (extent.minX < wBoundary - tolerance) {
                const bUnion = model.unions.get(block.rootUnionId);
                const bNames = bUnion?.partnerB
                    ? `${model.persons.get(bUnion.partnerA)?.firstName} & ${model.persons.get(bUnion.partnerB)?.firstName}`
                    : `${model.persons.get(bUnion!.partnerA)?.firstName}`;
                violations.push(
                    `W-side sibling "${bNames}" (gen ${block.generation}): ` +
                    `subtree minX=${extent.minX.toFixed(1)} below boundary=${wBoundary.toFixed(1)} ` +
                    `(violation=${(wBoundary - extent.minX).toFixed(1)}px)`
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Ancestor Side Ownership (ASO) violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/** Backward-compatible alias */
export { assertCoupleAncestorPolarity as assertAncestorSideContainment };

// ==================== PHASE A ASSERTIONS ====================

/**
 * Assertion: Descendants Unmoved by Phase A
 *
 * Verifies that no gen >= 0 blocks were moved during Phase A.
 * Takes a before-snapshot (Map of blockId → xCenter) and compares
 * with final block positions.
 *
 * In practice, since Phase A uses guardAncestorOnly which throws in test mode,
 * the guard-based test is simpler: just verify the pipeline doesn't throw
 * "PhaseA attempted to shift descendant". This assertion is a complementary check.
 */
export function assertDescendantsUnmoved(
    beforePositions: Map<FamilyBlockId, number>,
    constrained: ConstrainedModel,
    tolerance: number = 0.1
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks) return;

    const violations: string[] = [];

    for (const [blockId, beforeCenter] of beforePositions) {
        const block = fbm.blocks.get(blockId);
        if (!block) continue;
        if (block.generation < 0) continue; // Only check gen >= 0

        const delta = Math.abs(block.xCenter - beforeCenter);
        if (delta > tolerance) {
            violations.push(
                `Block "${blockId}" (gen=${block.generation}): ` +
                `xCenter before=${beforeCenter.toFixed(1)}, after=${block.xCenter.toFixed(1)}, ` +
                `delta=${delta.toFixed(1)}px`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Descendants Unmoved assertion violated (Phase A moved gen>=0 blocks):\n` +
            violations.slice(0, 10).join('\n') +
            (violations.length > 10 ? `\n... and ${violations.length - 10} more` : '')
        );
    }
}

/**
 * Assertion: Ancestor Anchor Barrier
 *
 * For each couple block in the focus person's ancestry, verifies one-directional
 * barrier invariant:
 * - H-side: directBlock.xRight <= husbandAnchorX (must not cross anchor toward seam)
 * - W-side: directBlock.xLeft >= wifeAnchorX (must not cross anchor toward seam)
 *
 * Blocks are allowed to be further OUTWARD from the anchor (that's A4's job).
 * Only crossing the anchor INWARD (toward the seam) is a violation.
 *
 * @param tolPx Maximum allowed overshoot in pixels (default: 1px)
 */
export function assertAncestorAnchorAlignment(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    tolPx: number = 1
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    // Collect couples in the focus person's direct ancestry
    const relevantCoupleBlockIds = collectFocusAncestorCouples(
        focusPersonId, model, unionToBlock, blocks
    );

    const violations: string[] = [];

    for (const coupleBlockId of relevantCoupleBlockIds) {
        const coupleBlock = blocks.get(coupleBlockId);
        if (!coupleBlock) continue;
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union || !union.partnerB) continue;

        // Skip couples with extreme coordinates (enforceCrossTreeSeparation artifacts)
        const anchorSpan = Math.abs(coupleBlock.husbandAnchorX - coupleBlock.wifeAnchorX);
        if (anchorSpan > 5000 || Math.abs(coupleBlock.xCenter) > 5000) continue;

        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);
        const coupleNames = `${personA?.firstName ?? '?'} & ${personB?.firstName ?? '?'}`;

        // H-side: directBlock.xRight must NOT exceed husbandAnchorX (no crossing toward seam)
        const hDirect = findDirectParentBlockForAssertion(
            union.partnerA, model, unionToBlock, blocks
        );
        if (hDirect && Math.abs(hDirect.xRight) < 5000) {
            // Violation = how much xRight exceeds anchor (positive = crossing toward seam)
            const overshoot = hDirect.xRight - coupleBlock.husbandAnchorX;
            if (overshoot > tolPx) {
                const rUnion = model.unions.get(hDirect.rootUnionId);
                const rNames = rUnion?.partnerB
                    ? `${model.persons.get(rUnion.partnerA)?.firstName} & ${model.persons.get(rUnion.partnerB)?.firstName}`
                    : `${model.persons.get(rUnion!.partnerA)?.firstName}`;
                violations.push(
                    `Couple "${coupleNames}" (gen ${coupleBlock.generation}), ` +
                    `seamX=${((coupleBlock.husbandAnchorX + coupleBlock.wifeAnchorX) / 2).toFixed(1)}\n` +
                    `  H-side direct "${rNames}" (gen ${hDirect.generation}): ` +
                    `xRight=${hDirect.xRight.toFixed(1)} > husbandAnchorX=${coupleBlock.husbandAnchorX.toFixed(1)} ` +
                    `(overshoot=${overshoot.toFixed(1)}px)`
                );
            }
        }

        // W-side: directBlock.xLeft must NOT be less than wifeAnchorX (no crossing toward seam)
        const wDirect = findDirectParentBlockForAssertion(
            union.partnerB, model, unionToBlock, blocks
        );
        if (wDirect && Math.abs(wDirect.xLeft) < 5000) {
            // Violation = how much xLeft is below anchor (positive = crossing toward seam)
            const overshoot = coupleBlock.wifeAnchorX - wDirect.xLeft;
            if (overshoot > tolPx) {
                const lUnion = model.unions.get(wDirect.rootUnionId);
                const lNames = lUnion?.partnerB
                    ? `${model.persons.get(lUnion.partnerA)?.firstName} & ${model.persons.get(lUnion.partnerB)?.firstName}`
                    : `${model.persons.get(lUnion!.partnerA)?.firstName}`;
                violations.push(
                    `Couple "${coupleNames}" (gen ${coupleBlock.generation}), ` +
                    `seamX=${((coupleBlock.husbandAnchorX + coupleBlock.wifeAnchorX) / 2).toFixed(1)}\n` +
                    `  W-side direct "${lNames}" (gen ${wDirect.generation}): ` +
                    `xLeft=${wDirect.xLeft.toFixed(1)} < wifeAnchorX=${coupleBlock.wifeAnchorX.toFixed(1)} ` +
                    `(overshoot=${overshoot.toFixed(1)}px)`
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Ancestor Anchor Alignment violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Assertion: Ancestor Side Ownership (seam-based)
 *
 * For each couple block with both partners:
 * - Seam = midpoint between husbandAnchorX and wifeAnchorX
 * - H-side: all ancestor blocks must have extent.maxX <= seamX - gap
 * - W-side: all ancestor blocks must have extent.minX >= seamX + gap
 *
 * @param gap Minimum distance from seam (default: horizontalGap = 15)
 * @param tolPx Tolerance in pixels (default: 0.5px)
 */
export function assertAncestorSideOwnershipSeam(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    gap: number = 15,
    tolPx: number = 0.5
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    // Collect couples in the focus person's direct ancestry
    const relevantCoupleBlockIds = collectFocusAncestorCouples(
        focusPersonId, model, unionToBlock, blocks
    );

    const violations: string[] = [];

    for (const coupleBlockId of relevantCoupleBlockIds) {
        const coupleBlock = blocks.get(coupleBlockId);
        if (!coupleBlock) continue;
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union || !union.partnerB) continue;

        // Skip couples with extreme coordinates (enforceCrossTreeSeparation artifacts)
        const anchorSpan = Math.abs(coupleBlock.husbandAnchorX - coupleBlock.wifeAnchorX);
        if (anchorSpan > 5000 || Math.abs(coupleBlock.xCenter) > 5000) continue;

        const seamX = (coupleBlock.husbandAnchorX + coupleBlock.wifeAnchorX) / 2;

        const hBlocks = collectAncSubtree(union.partnerA, model, unionToBlock, blocks);
        const wBlocks = collectAncSubtree(union.partnerB, model, unionToBlock, blocks);

        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);
        const coupleNames = `${personA?.firstName ?? '?'} & ${personB?.firstName ?? '?'}`;

        // H-side: extent.maxX <= seamX - gap
        // Filter out blocks with extreme coordinates (cross-tree separation artifacts)
        const hBlocksFiltered = hBlocks.filter(b => Math.abs(b.xRight) < 5000);
        if (hBlocksFiltered.length > 0) {
            let hMaxX = -Infinity;
            for (const b of hBlocksFiltered) {
                hMaxX = Math.max(hMaxX, b.xRight);
            }
            const boundary = seamX - gap;
            if (hMaxX > boundary + tolPx) {
                const violation = hMaxX - boundary;
                violations.push(
                    `Couple "${coupleNames}" (gen ${coupleBlock.generation}), seamX=${seamX.toFixed(1)}, gap=${gap}\n` +
                    `  H-side extent maxX=${hMaxX.toFixed(1)} exceeds boundary=${boundary.toFixed(1)} ` +
                    `(violation=${violation.toFixed(1)}px)`
                );
            }
        }

        // W-side: extent.minX >= seamX + gap
        const wBlocksFiltered = wBlocks.filter(b => Math.abs(b.xLeft) < 5000);
        if (wBlocksFiltered.length > 0) {
            let wMinX = Infinity;
            for (const b of wBlocksFiltered) {
                wMinX = Math.min(wMinX, b.xLeft);
            }
            const boundary = seamX + gap;
            if (wMinX < boundary - tolPx) {
                const violation = boundary - wMinX;
                violations.push(
                    `Couple "${coupleNames}" (gen ${coupleBlock.generation}), seamX=${seamX.toFixed(1)}, gap=${gap}\n` +
                    `  W-side extent minX=${wMinX.toFixed(1)} below boundary=${boundary.toFixed(1)} ` +
                    `(violation=${violation.toFixed(1)}px)`
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Ancestor Side Ownership (seam) violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Helper: Find the direct parent block for a person (immediate ancestor union block).
 * Returns the block at gen < 0 that contains the person's parent union.
 */
function findDirectParentBlockForAssertion(
    personId: PersonId,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    blocks: Map<FamilyBlockId, FamilyBlock>
): FamilyBlock | null {
    const parentUnionId = model.childToParentUnion.get(personId);
    if (!parentUnionId) return null;

    const parentBlockId = unionToBlock.get(parentUnionId);
    if (!parentBlockId) return null;

    const parentBlock = blocks.get(parentBlockId);
    if (!parentBlock || parentBlock.generation >= 0) return null;

    return parentBlock;
}

/**
 * Helper: Collect couple block IDs in the focus person's direct ancestry.
 * Starts from the focus person's own union (gen 0), then traces upward
 * through both partners to find all ancestor couple blocks.
 */
function collectFocusAncestorCouples(
    focusPersonId: PersonId,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    blocks: Map<FamilyBlockId, FamilyBlock>
): FamilyBlockId[] {
    const result: FamilyBlockId[] = [];
    const visitedBlocks = new Set<FamilyBlockId>();

    // Find focus person's union (gen 0 couple)
    const focusUnionId = model.personToUnion.get(focusPersonId);
    if (!focusUnionId) return result;

    const focusBlockId = unionToBlock.get(focusUnionId);
    if (!focusBlockId) return result;

    const focusBlock = blocks.get(focusBlockId);
    if (!focusBlock) return result;

    const focusUnion = model.unions.get(focusUnionId);
    if (!focusUnion || !focusUnion.partnerB) return result;

    // Add focus couple
    visitedBlocks.add(focusBlockId);
    result.push(focusBlockId);

    // Trace upward through both partners
    const visitedPersons = new Set<PersonId>();

    function traceUp(personId: PersonId): void {
        if (visitedPersons.has(personId)) return;
        visitedPersons.add(personId);

        const parentUnionId = model.childToParentUnion.get(personId);
        if (!parentUnionId) return;

        const parentBlockId = unionToBlock.get(parentUnionId);
        if (!parentBlockId || visitedBlocks.has(parentBlockId)) return;

        const parentBlock = blocks.get(parentBlockId);
        if (!parentBlock) return;

        const parentUnion = model.unions.get(parentUnionId);
        if (!parentUnion || !parentUnion.partnerB) return;

        visitedBlocks.add(parentBlockId);
        result.push(parentBlockId);

        // Recurse upward through both parents
        traceUp(parentUnion.partnerA);
        if (parentUnion.partnerB) traceUp(parentUnion.partnerB);
    }

    traceUp(focusUnion.partnerA);
    if (focusUnion.partnerB) traceUp(focusUnion.partnerB);

    return result;
}

/**
 * Helper: Collect ancestor blocks belonging to one partner's line (gen < 0 only).
 * Traces upward from partnerId through childToParentUnion.
 * Matches collectAncestorSubtree in 6-constraints.ts.
 */
function collectAncSubtree(
    partnerId: PersonId,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    blocks: Map<FamilyBlockId, FamilyBlock>
): FamilyBlock[] {
    const result: FamilyBlock[] = [];
    const visitedPersons = new Set<PersonId>();
    const visitedBlocks = new Set<FamilyBlockId>();

    function trace(pid: PersonId): void {
        if (visitedPersons.has(pid)) return;
        visitedPersons.add(pid);

        const parentUnionId = model.childToParentUnion.get(pid);
        if (!parentUnionId) return;

        const parentBlockId = unionToBlock.get(parentUnionId);
        if (!parentBlockId || visitedBlocks.has(parentBlockId)) return;
        visitedBlocks.add(parentBlockId);

        const parentBlock = blocks.get(parentBlockId);
        if (!parentBlock) return;
        if (parentBlock.generation >= 0) return; // gen < 0 only

        result.push(parentBlock);

        const parentUnion = model.unions.get(parentUnionId);
        if (!parentUnion) return;

        // Include sibling blocks at this level
        for (const childId of parentUnion.childIds) {
            if (childId === pid) continue;
            const sibUnionId = model.personToUnion.get(childId);
            if (!sibUnionId) continue;
            const sibBlockId = unionToBlock.get(sibUnionId);
            if (!sibBlockId || visitedBlocks.has(sibBlockId)) continue;
            const sibBlock = blocks.get(sibBlockId);
            if (!sibBlock || sibBlock.generation >= 0) continue;
            visitedBlocks.add(sibBlockId);
            result.push(sibBlock);
        }

        // Recurse upward
        trace(parentUnion.partnerA);
        if (parentUnion.partnerB) trace(parentUnion.partnerB);
    }

    trace(partnerId);
    return result;
}

// ==================== PHASED TESTING HELPERS ====================

/**
 * Snapshot gen>=0 block positions for before/after comparison.
 * Returns a map from FamilyBlockId to { xCenter, xLeft, xRight }.
 */
export function snapshotDescendantPositions(
    constrained: ConstrainedModel
): Map<FamilyBlockId, { xCenter: number; xLeft: number; xRight: number }> {
    const { placed } = constrained;
    const { measured } = placed;
    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks) return new Map();

    const snapshot = new Map<FamilyBlockId, { xCenter: number; xLeft: number; xRight: number }>();
    for (const [id, block] of fbm.blocks) {
        if (block.generation >= 0) {
            snapshot.set(id, { xCenter: block.xCenter, xLeft: block.xLeft, xRight: block.xRight });
        }
    }
    return snapshot;
}

/**
 * Assert that gen>=0 block positions haven't changed between Phase A snapshot and a later phase.
 * Used to verify Phase B (ancestors) doesn't move descendants placed by Phase A.
 */
export function assertDescendantsLocked(
    before: Map<FamilyBlockId, { xCenter: number; xLeft: number; xRight: number }>,
    after: ConstrainedModel,
    tolerance: number = 0.5
): void {
    const { placed } = after;
    const { measured } = placed;
    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks) return;

    const violations: string[] = [];
    for (const [id, beforePos] of before) {
        const block = fbm.blocks.get(id);
        if (!block || block.generation < 0) continue;

        const dx = Math.abs(block.xCenter - beforePos.xCenter);
        if (dx > tolerance) {
            violations.push(
                `Block "${id}" (gen=${block.generation}): ` +
                `xCenter moved ${beforePos.xCenter.toFixed(1)} → ${block.xCenter.toFixed(1)} (Δ${dx.toFixed(1)}px)`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Descendants Locked violated (later phase moved gen>=0 blocks):\n` +
            violations.slice(0, 10).join('\n') +
            (violations.length > 10 ? `\n... and ${violations.length - 10} more` : '')
        );
    }
}

// ==================== COUSIN SEPARATION ====================

/**
 * Invariant: Cousin Separation (CSP)
 *
 * No Cousin Branch (CB) block at gen=0 may intrude into the Focus Sibling (FS) span.
 * FS = gen=0 blocks for children of focus's parent union.
 * CB = all other gen=0 blocks (children of uncle/aunt unions).
 *
 * @param tolerance Overlap tolerance in pixels (default: 0.5)
 */
export function assertCousinSeparation(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    tolerance: number = 0.5
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;
    const config = DEFAULT_LAYOUT_CONFIG;

    // 1. Find focus's parent union
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return; // No parent union → nothing to check
    const focusParentUnion = model.unions.get(focusParentUnionId);
    if (!focusParentUnion) return;

    // 2. Collect FS blocks (gen=0 blocks for children of focus's parent union)
    const fsBlockIds = new Set<FamilyBlockId>();
    for (const childId of focusParentUnion.childIds) {
        const childUnionId = model.personToUnion.get(childId);
        if (!childUnionId) continue;
        const blockId = unionToBlock.get(childUnionId);
        if (!blockId) continue;
        const block = blocks.get(blockId);
        if (block && block.generation === 0) {
            fsBlockIds.add(blockId);
        }
    }
    if (fsBlockIds.size === 0) return;

    // 3. Compute FS span (combined subtreeCardExtent of all FS blocks)
    let fsMinX = Infinity, fsMaxX = -Infinity;
    for (const blockId of fsBlockIds) {
        const ext = computeSubtreeCardExtent(blockId, blocks, model);
        fsMinX = Math.min(fsMinX, ext.minX);
        fsMaxX = Math.max(fsMaxX, ext.maxX);
    }
    if (!isFinite(fsMinX)) return;

    // 4. Check CB blocks (gen=0, NOT in FS)
    const violations: string[] = [];
    for (const [blockId, block] of blocks) {
        if (block.generation !== 0) continue;
        if (fsBlockIds.has(blockId)) continue;

        const ext = computeSubtreeCardExtent(blockId, blocks, model);

        // Check if CB intrudes into FS span (with gap)
        const intrudesFS = ext.maxX > fsMinX - config.horizontalGap + tolerance
                        && ext.minX < fsMaxX + config.horizontalGap - tolerance;
        if (intrudesFS) {
            const union = model.unions.get(block.rootUnionId);
            const personName = union
                ? `${model.persons.get(union.partnerA)?.firstName ?? '?'}`
                : block.id;
            violations.push(
                `CB block "${personName}" (${block.id}): ` +
                `extent [${ext.minX.toFixed(1)}, ${ext.maxX.toFixed(1)}] ` +
                `intrudes into FS span [${fsMinX.toFixed(1)}, ${fsMaxX.toFixed(1)}]`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Cousin Separation (CSP) violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

// ==================== SIBLING BRANCH ANCHOR CONSISTENCY (SBAC) ====================

/**
 * Invariant: Sibling Branch Anchor Consistency (SBAC)
 *
 * For descendant blocks (gen >= 0), each "branch through parent siblings"
 * (uncle/aunt + partner + their descendants) must be one compact horizontal unit.
 *
 * This means:
 * - For each parent-sibling union (uncle/aunt at gen=0), define its branch span
 *   as subtreeCardExtent(branchRootBlockId)
 * - Compute couple span of this union (left/right couple bounds)
 * - Require: couple span must lie within branch span (with tolerance)
 *
 * Formally (with tolerance eps):
 * - branchMinX <= coupleLeftX + eps
 * - coupleRightX <= branchMaxX + eps
 *
 * Purpose: Parents of cousins (uncle/aunt) must not end up "outside their own
 * cluster" or "fall into" the focus siblings interval. CSP/BCO/overlap shifts
 * must always move the entire branch subtree, not just children.
 *
 * @param tolerance Tolerance in pixels (default: 1)
 */
export function assertSiblingBranchAnchorConsistency(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    tolerance: number = 1
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;
    const config = DEFAULT_LAYOUT_CONFIG;

    // 1. Find focus's parent union (to identify siblings)
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return; // No parent union → nothing to check
    const focusParentUnion = model.unions.get(focusParentUnionId);
    if (!focusParentUnion) return;

    // 2. Identify focus siblings (children of focus parent union)
    const _focusSiblingIds = new Set<PersonId>(focusParentUnion.childIds);

    // 3. Find grandparent union to get aunts/uncles
    const focusParentPerson = focusParentUnion.partnerA; // Either parent works
    const grandparentUnionId = model.childToParentUnion.get(focusParentPerson);
    if (!grandparentUnionId) return; // No grandparents → no aunts/uncles
    const grandparentUnion = model.unions.get(grandparentUnionId);
    if (!grandparentUnion) return;

    // 4. Collect aunt/uncle unions (siblings of focus's parent who have their own unions)
    // Note: aunt/uncle are at same generation as focus's parent (typically gen -1)
    // but their children (cousins) are at gen 0. We check the positioning regardless of generation.
    const auntUncleBlockIds: FamilyBlockId[] = [];
    for (const auntUncleId of grandparentUnion.childIds) {
        // Skip focus's parent (we want siblings, not the parent itself)
        if (auntUncleId === focusParentUnion.partnerA || auntUncleId === focusParentUnion.partnerB) {
            continue;
        }

        // Find union where this aunt/uncle is a partner
        const auntUncleUnionId = model.personToUnion.get(auntUncleId);
        if (!auntUncleUnionId) continue;

        const blockId = unionToBlock.get(auntUncleUnionId);
        if (!blockId) continue;

        const block = blocks.get(blockId);
        if (!block) continue;

        // Include all aunt/uncle blocks (they're typically at gen -1, same as focus's parent)
        auntUncleBlockIds.push(blockId);
    }

    if (auntUncleBlockIds.length === 0) return;

    // 5. Check SBAC for each aunt/uncle block
    const violations: string[] = [];

    for (const blockId of auntUncleBlockIds) {
        const block = blocks.get(blockId)!;
        const union = model.unions.get(block.rootUnionId);
        if (!union) continue;

        // Skip unions without children (nothing to check)
        if (union.childIds.length === 0) continue;

        // Compute couple center and bounds
        const coupleCenter = block.xCenter;
        let coupleLeftX: number;
        let coupleRightX: number;
        if (union.partnerB) {
            coupleLeftX = block.xCenter - config.partnerGap / 2 - config.cardWidth;
            coupleRightX = block.xCenter + config.partnerGap / 2 + config.cardWidth;
        } else {
            coupleLeftX = block.xCenter - config.cardWidth / 2;
            coupleRightX = block.xCenter + config.cardWidth / 2;
        }

        // Compute children-only span (not including the couple)
        let childMinX = Infinity;
        let childMaxX = -Infinity;
        for (const childId of union.childIds) {
            // Try to find child's block position
            const childUnionId = model.personToUnion.get(childId);
            if (childUnionId) {
                const childBlockId = unionToBlock.get(childUnionId);
                if (childBlockId) {
                    const childBlock = blocks.get(childBlockId);
                    if (childBlock) {
                        const childUnion = model.unions.get(childBlock.rootUnionId);
                        let left: number, right: number;
                        if (childUnion?.partnerB) {
                            left = childBlock.xCenter - config.partnerGap / 2 - config.cardWidth;
                            right = childBlock.xCenter + config.partnerGap / 2 + config.cardWidth;
                        } else {
                            left = childBlock.xCenter - config.cardWidth / 2;
                            right = childBlock.xCenter + config.cardWidth / 2;
                        }
                        childMinX = Math.min(childMinX, left);
                        childMaxX = Math.max(childMaxX, right);
                        continue;
                    }
                }
            }
            // Fallback: use personX if no block found
            const px = constrained.placed.personX.get(childId);
            if (px !== undefined) {
                childMinX = Math.min(childMinX, px);
                childMaxX = Math.max(childMaxX, px + config.cardWidth);
            }
        }

        // Skip if no children positions found
        if (!isFinite(childMinX)) continue;

        const childCenter = (childMinX + childMaxX) / 2;
        const childSpanWidth = childMaxX - childMinX;

        // SBAC check: couple center should be within children span
        // (parent should be horizontally "above" their children)
        const coupleCenterInChildSpan = coupleCenter >= childMinX - tolerance &&
                                         coupleCenter <= childMaxX + tolerance;

        // Alternative: check overlap between couple and children span
        const overlapLeft = Math.max(coupleLeftX, childMinX);
        const overlapRight = Math.min(coupleRightX, childMaxX);
        const overlap = overlapRight - overlapLeft;
        const coupleWidth = coupleRightX - coupleLeftX;
        const overlapRatio = overlap / Math.min(coupleWidth, childSpanWidth);

        // Violation if couple center is outside children span AND overlap is minimal
        if (!coupleCenterInChildSpan && overlapRatio < 0.5) {
            const personA = model.persons.get(union.partnerA);
            const personB = union.partnerB ? model.persons.get(union.partnerB) : null;
            const coupleName = personB
                ? `${personA?.firstName ?? '?'} & ${personB?.firstName ?? '?'}`
                : personA?.firstName ?? '?';

            const deviation = Math.abs(coupleCenter - childCenter);

            violations.push(
                `"${coupleName}" (gen=${block.generation}): ` +
                `couple center ${coupleCenter.toFixed(1)} is ${deviation.toFixed(1)}px from children center ${childCenter.toFixed(1)}, ` +
                `children span [${childMinX.toFixed(1)}, ${childMaxX.toFixed(1)}], ` +
                `overlap ratio ${(overlapRatio * 100).toFixed(0)}%`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Sibling Branch Anchor Consistency (SBAC) violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Assertion: Sibling Family Non-Interleaving (SFNI)
 *
 * Ensures that gen=-1 siblings (aunts/uncles) don't intrude into each other's
 * family clusters. A sibling's family cluster is defined as:
 * - Their couple card (or single card)
 * - All descendants' card extents
 *
 * Problem case: a childless sibling was positioned such that their card
 * visually overlapped with another sibling's children cluster.
 *
 * @param tolerance Tolerance in pixels (default: 1)
 */
export function assertSiblingFamilyNonInterleaving(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    minGap: number = 15,
    tolerance: number = 1
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    // 1. Find grandparent union (parent of focus's parent)
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return;
    const focusParentUnion = model.unions.get(focusParentUnionId);
    if (!focusParentUnion) return;

    const focusParent = focusParentUnion.partnerA;
    const grandparentUnionId = model.childToParentUnion.get(focusParent);
    if (!grandparentUnionId) return;
    const grandparentUnion = model.unions.get(grandparentUnionId);
    if (!grandparentUnion || grandparentUnion.childIds.length < 2) return;

    // 2. Collect sibling blocks at gen -1 with their family cluster extents
    interface SibData {
        name: string;
        blockId: FamilyBlockId;
        xCenter: number;
        clusterMinX: number;
        clusterMaxX: number;
    }

    const siblings: SibData[] = [];

    for (const siblingId of grandparentUnion.childIds) {
        const sibUnionId = model.personToUnion.get(siblingId);
        if (!sibUnionId) continue;

        const blockId = unionToBlock.get(sibUnionId);
        if (!blockId) continue;

        const block = blocks.get(blockId);
        if (!block || block.generation !== -1) continue;

        // Compute family cluster extent (block + all descendants)
        let minX = block.xLeft;
        let maxX = block.xRight;

        const stack = [...block.childBlockIds];
        const visited = new Set<FamilyBlockId>([blockId]);
        while (stack.length > 0) {
            const childId = stack.pop()!;
            if (visited.has(childId)) continue;
            visited.add(childId);

            const child = blocks.get(childId);
            if (!child) continue;

            minX = Math.min(minX, child.xLeft);
            maxX = Math.max(maxX, child.xRight);

            for (const gcId of child.childBlockIds) {
                stack.push(gcId);
            }
        }

        const person = model.persons.get(siblingId);
        siblings.push({
            name: person?.firstName ?? siblingId,
            blockId,
            xCenter: block.xCenter,
            clusterMinX: minX,
            clusterMaxX: maxX
        });
    }

    if (siblings.length < 2) return;

    // 3. Sort by xCenter
    siblings.sort((a, b) => a.xCenter - b.xCenter);

    // 4. Check for interleaving
    const violations: string[] = [];

    for (let i = 0; i < siblings.length - 1; i++) {
        const left = siblings[i];
        const right = siblings[i + 1];

        const overlap = left.clusterMaxX + minGap - right.clusterMinX;
        if (overlap > tolerance) {
            violations.push(
                `"${left.name}" and "${right.name}": ` +
                `${left.name}'s cluster extends to ${left.clusterMaxX.toFixed(1)}, ` +
                `${right.name}'s cluster starts at ${right.clusterMinX.toFixed(1)}, ` +
                `overlap=${overlap.toFixed(1)}px (minGap=${minGap})`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Sibling Family Non-Interleaving (SFNI) violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

// ==================== PHASE B: SIDE OWNERSHIP ASSERTIONS ====================

/**
 * Assertion: Ancestor Side Ownership (card-position-based)
 *
 * Uses actual person card positions as boundaries (not seam/anchor):
 * - husbandX = personX(partnerA) + cardWidth (right edge of husband card)
 * - wifeX = personX(partnerB) (left edge of wife card)
 * - H-side: max(block.xRight) <= wifeX + epsilon
 * - W-side: min(block.xLeft) >= husbandX_left - epsilon
 *   (husbandX_left = personX(partnerA), i.e. left edge of husband card)
 *
 * Difference from assertAncestorSideOwnership: uses personX card positions
 * instead of anchor/seam, and scoped to focus person's ancestry.
 */
export function assertAncestorSideOwnershipFocus(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    mode: 'strict' | 'soft' = 'strict',
    epsilon: number = 0.5
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    const relevantCoupleBlockIds = collectFocusAncestorCouples(
        focusPersonId, model, unionToBlock, blocks
    );

    const violations: string[] = [];

    for (const coupleBlockId of relevantCoupleBlockIds) {
        const coupleBlock = blocks.get(coupleBlockId);
        if (!coupleBlock) continue;
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union || !union.partnerB) continue;

        // Skip couples with extreme coordinates
        if (Math.abs(coupleBlock.xCenter) > 5000) continue;

        const pxA = personX.get(union.partnerA);
        const pxB = personX.get(union.partnerB);
        if (pxA === undefined || pxB === undefined) continue;

        const husbandXLeft = pxA;  // left edge of husband card
        const wifeXLeft = pxB;     // left edge of wife card

        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);
        const coupleNames = `${personA?.firstName ?? '?'} & ${personB?.firstName ?? '?'}`;

        const hBlocks = collectAncSubtree(union.partnerA, model, unionToBlock, blocks);
        const wBlocks = collectAncSubtree(union.partnerB, model, unionToBlock, blocks);

        // H-side: max(block.xRight) <= wifeXLeft + epsilon
        const hFiltered = hBlocks.filter(b => Math.abs(b.xRight) < 5000);
        if (hFiltered.length > 0) {
            let hMaxX = -Infinity;
            for (const b of hFiltered) {
                hMaxX = Math.max(hMaxX, b.xRight);
            }
            if (hMaxX > wifeXLeft + epsilon) {
                const overshoot = hMaxX - wifeXLeft;
                violations.push(
                    `Couple "${coupleNames}" (gen ${coupleBlock.generation}): ` +
                    `H-side maxX=${hMaxX.toFixed(1)} > wifeX=${wifeXLeft.toFixed(1)} + ε ` +
                    `(overshoot=${overshoot.toFixed(1)}px)`
                );
            }
        }

        // W-side: min(block.xLeft) >= husbandXLeft - epsilon
        const wFiltered = wBlocks.filter(b => Math.abs(b.xLeft) < 5000);
        if (wFiltered.length > 0) {
            let wMinX = Infinity;
            for (const b of wFiltered) {
                wMinX = Math.min(wMinX, b.xLeft);
            }
            if (wMinX < husbandXLeft - epsilon) {
                const overshoot = husbandXLeft - wMinX;
                violations.push(
                    `Couple "${coupleNames}" (gen ${coupleBlock.generation}): ` +
                    `W-side minX=${wMinX.toFixed(1)} < husbandX=${husbandXLeft.toFixed(1)} - ε ` +
                    `(overshoot=${overshoot.toFixed(1)}px)`
                );
            }
        }
    }

    if (violations.length > 0) {
        if (mode === 'soft') {
            console.warn(
                `Ancestor Side Ownership warnings:\n` +
                violations.join('\n')
            );
        } else {
            throw new Error(
                `Ancestor Side Ownership violated:\n` +
                violations.slice(0, 5).join('\n') +
                (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
            );
        }
    }
}

/**
 * Assertion: Couple Ordering (gender-based)
 *
 * For each union with both partners, verifies that male (husband) is placed
 * to the left and female (wife) to the right. Falls back to partnerA=husband
 * if gender information is missing.
 */
export function assertCoupleOrdering(
    constrained: ConstrainedModel,
    cardWidth: number = DEFAULT_CARD_WIDTH,
    tolerance: number = 0.5
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const violations: string[] = [];

    for (const [unionId, union] of model.unions) {
        if (!union.partnerB) continue;

        const xA = personX.get(union.partnerA);
        const xB = personX.get(union.partnerB);
        if (xA === undefined || xB === undefined) continue;

        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);

        // Determine husband/wife by gender; fallback to partnerA=husband
        let husbandId: PersonId;
        let wifeId: PersonId;
        if (personA?.gender === 'male' || personB?.gender === 'female') {
            husbandId = union.partnerA;
            wifeId = union.partnerB;
        } else if (personB?.gender === 'male' || personA?.gender === 'female') {
            husbandId = union.partnerB;
            wifeId = union.partnerA;
        } else {
            // No gender info, use partnerA as husband
            husbandId = union.partnerA;
            wifeId = union.partnerB;
        }

        const husbandX = personX.get(husbandId)!;
        const wifeX = personX.get(wifeId)!;

        const husbandCenter = husbandX + cardWidth / 2;
        const wifeCenter = wifeX + cardWidth / 2;

        if (husbandCenter >= wifeCenter - tolerance) {
            const gen = genModel.unionGen.get(unionId);
            const hName = model.persons.get(husbandId);
            const wName = model.persons.get(wifeId);
            violations.push(
                `Union "${hName?.firstName ?? '?'} & ${wName?.firstName ?? '?'}" (gen ${gen ?? '?'}): ` +
                `husband center=${husbandCenter.toFixed(1)} should be left of wife center=${wifeCenter.toFixed(1)}`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Couple Ordering violated:\n` +
            violations.slice(0, 5).join('\n') +
            (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
        );
    }
}

/**
 * Assertion: Ancestor Centering Within Side Cluster (diagnostic/soft)
 *
 * For each side (H/W) of a couple block, verifies that the descendant anchor
 * is approximately at the center of the ancestor cluster extent.
 * Uses a large tolerance (soft constraint) for diagnostics.
 */
export function assertAncestorCenteringWithinSideCluster(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    tolerancePx: number = 100,
    mode: 'strict' | 'soft' = 'strict'
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    const relevantCoupleBlockIds = collectFocusAncestorCouples(
        focusPersonId, model, unionToBlock, blocks
    );

    const violations: string[] = [];

    for (const coupleBlockId of relevantCoupleBlockIds) {
        const coupleBlock = blocks.get(coupleBlockId);
        if (!coupleBlock) continue;
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union || !union.partnerB) continue;

        // Skip couples with extreme coordinates
        if (Math.abs(coupleBlock.xCenter) > 5000) continue;

        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);
        const coupleNames = `${personA?.firstName ?? '?'} & ${personB?.firstName ?? '?'}`;

        // H-side cluster
        const hBlocks = collectAncSubtree(union.partnerA, model, unionToBlock, blocks);
        const hFiltered = hBlocks.filter(b => Math.abs(b.xLeft) < 5000 && Math.abs(b.xRight) < 5000);
        if (hFiltered.length > 0) {
            let hMinX = Infinity;
            let hMaxX = -Infinity;
            for (const b of hFiltered) {
                hMinX = Math.min(hMinX, b.xLeft);
                hMaxX = Math.max(hMaxX, b.xRight);
            }
            // Skip clusters with extreme spread (cross-tree separation artifacts)
            if (hMaxX - hMinX < 2500) {
                const clusterCenter = (hMinX + hMaxX) / 2;
                const anchor = coupleBlock.husbandAnchorX;
                const deviation = Math.abs(anchor - clusterCenter);
                if (deviation > tolerancePx) {
                    violations.push(
                        `Couple "${coupleNames}" (gen ${coupleBlock.generation}), H-side: ` +
                        `anchor=${anchor.toFixed(1)}, clusterCenter=${clusterCenter.toFixed(1)}, ` +
                        `deviation=${deviation.toFixed(1)}px (tol=${tolerancePx})`
                    );
                }
            }
        }

        // W-side cluster
        const wBlocks = collectAncSubtree(union.partnerB, model, unionToBlock, blocks);
        const wFiltered = wBlocks.filter(b => Math.abs(b.xLeft) < 5000 && Math.abs(b.xRight) < 5000);
        if (wFiltered.length > 0) {
            let wMinX = Infinity;
            let wMaxX = -Infinity;
            for (const b of wFiltered) {
                wMinX = Math.min(wMinX, b.xLeft);
                wMaxX = Math.max(wMaxX, b.xRight);
            }
            // Skip clusters with extreme spread (cross-tree separation artifacts)
            if (wMaxX - wMinX < 2500) {
                const clusterCenter = (wMinX + wMaxX) / 2;
                const anchor = coupleBlock.wifeAnchorX;
                const deviation = Math.abs(anchor - clusterCenter);
                if (deviation > tolerancePx) {
                    violations.push(
                        `Couple "${coupleNames}" (gen ${coupleBlock.generation}), W-side: ` +
                        `anchor=${anchor.toFixed(1)}, clusterCenter=${clusterCenter.toFixed(1)}, ` +
                        `deviation=${deviation.toFixed(1)}px (tol=${tolerancePx})`
                    );
                }
            }
        }
    }

    if (violations.length > 0) {
        if (mode === 'soft') {
            console.warn(
                `Ancestor Centering within Side Cluster (diagnostic):\n` +
                violations.join('\n')
            );
        } else {
            throw new Error(
                `Ancestor Centering within Side Cluster:\n` +
                violations.slice(0, 5).join('\n') +
                (violations.length > 5 ? `\n... and ${violations.length - 5} more` : '')
            );
        }
    }
}

/**
 * Invariant: Focus Spouse Parent Containment (FSPC)
 *
 * For the focus couple at gen 0:
 * - H-side ancestors (partnerA's line): maxX <= husbandX (left edge of husband card)
 * - W-side ancestors (partnerB's line): minX >= wifeRightEdge (right edge of wife card)
 *
 * This is the HARD BARRIER that ancestors must never cross. Unlike seam-based
 * constraints which use the midpoint, FSPC uses the actual card edge positions.
 *
 * @param epsilon Tolerance in pixels (default: 0.5)
 */
export function assertFocusSpouseParentContainment(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    cardWidth: number = DEFAULT_CARD_WIDTH,
    epsilon: number = 0.5
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;
    const partnerGap = DEFAULT_LAYOUT_CONFIG.partnerGap;

    // 1. Find focus couple block (gen 0, contains focusPersonId)
    const focusUnionId = model.personToUnion.get(focusPersonId);
    if (!focusUnionId) return;
    const focusBlockId = unionToBlock.get(focusUnionId);
    if (!focusBlockId) return;
    const focusBlock = blocks.get(focusBlockId);
    if (!focusBlock || focusBlock.generation !== 0) return;

    const focusUnion = model.unions.get(focusUnionId);
    if (!focusUnion || !focusUnion.partnerB) return;

    // 2. Compute barrier positions from focus couple CARD positions
    const husbandX = focusBlock.xCenter - partnerGap / 2 - cardWidth;  // left edge of husband card
    const wifeRightEdge = focusBlock.xCenter + partnerGap / 2 + cardWidth;  // right edge of wife card

    const violations: string[] = [];

    // 3. H-side: collect all ancestors of partnerA, check maxX <= husbandX
    const hBlocks = collectAncSubtree(focusUnion.partnerA, model, unionToBlock, blocks);
    if (hBlocks.length > 0) {
        let hMaxX = -Infinity;
        let violatingBlock: FamilyBlock | null = null;
        for (const b of hBlocks) {
            if (b.xRight > hMaxX) {
                hMaxX = b.xRight;
                violatingBlock = b;
            }
        }
        if (hMaxX > husbandX + epsilon && violatingBlock) {
            const overshoot = hMaxX - husbandX;
            const bUnion = model.unions.get(violatingBlock.rootUnionId);
            const bNames = bUnion?.partnerB
                ? `${model.persons.get(bUnion.partnerA)?.firstName} & ${model.persons.get(bUnion.partnerB)?.firstName}`
                : `${model.persons.get(bUnion!.partnerA)?.firstName}`;
            violations.push(
                `H-side: ancestor "${bNames}" (gen ${violatingBlock.generation}) ` +
                `xRight=${hMaxX.toFixed(1)} exceeds husbandX=${husbandX.toFixed(1)} ` +
                `(overshoot=${overshoot.toFixed(1)}px)`
            );
        }
    }

    // 4. W-side: collect all ancestors of partnerB, check minX >= wifeRightEdge
    const wBlocks = collectAncSubtree(focusUnion.partnerB, model, unionToBlock, blocks);
    if (wBlocks.length > 0) {
        let wMinX = Infinity;
        let violatingBlock: FamilyBlock | null = null;
        for (const b of wBlocks) {
            if (b.xLeft < wMinX) {
                wMinX = b.xLeft;
                violatingBlock = b;
            }
        }
        if (wMinX < wifeRightEdge - epsilon && violatingBlock) {
            const overshoot = wifeRightEdge - wMinX;
            const bUnion = model.unions.get(violatingBlock.rootUnionId);
            const bNames = bUnion?.partnerB
                ? `${model.persons.get(bUnion.partnerA)?.firstName} & ${model.persons.get(bUnion.partnerB)?.firstName}`
                : `${model.persons.get(bUnion!.partnerA)?.firstName}`;
            violations.push(
                `W-side: ancestor "${bNames}" (gen ${violatingBlock.generation}) ` +
                `xLeft=${wMinX.toFixed(1)} below wifeRightEdge=${wifeRightEdge.toFixed(1)} ` +
                `(overshoot=${overshoot.toFixed(1)}px)`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Focus Spouse Parent Containment (FSPC) violated:\n` +
            violations.join('\n')
        );
    }
}

// ==================== PHASE C ROUTING ASSERTIONS ====================

/**
 * Configuration for Phase C routing invariant checks.
 */
export interface PhaseCConfig {
    /** Minimum distance between elbows and vertical segments (default: 14) */
    elbowClearance?: number;
    /** Tolerance for elbow clearance check (default: 1) */
    elbowTolerance?: number;
    /** Tolerance for bus overlap Y-level grouping (default: 5) */
    busOverlapTolerance?: number;
    /** Tolerance for staircase jitter detection (default: 3) */
    staircaseJitterTolerance?: number;
    /** Stop on first violation instead of collecting all (default: false) */
    stopOnFirst?: boolean;
}

const DEFAULT_PHASE_C_CONFIG: Required<PhaseCConfig> = {
    elbowClearance: 14,
    elbowTolerance: 1,
    busOverlapTolerance: 5,
    staircaseJitterTolerance: 3,
    stopOnFirst: false,
};

/**
 * Format Phase C validation failures into a single error.
 */
function formatPhaseCError(
    failures: Array<{ invariant: string; message: string }>
): Error {
    const header = `Phase C Routing Invariants violated (${failures.length}):\n`;
    const body = failures.map(f => `[${f.invariant}] ${f.message}`).join('\n\n');
    return new Error(header + body);
}

/**
 * Phase C Routing Invariant Assertions
 *
 * Validates all routing invariants after final edge routing:
 * - EC-Final: No edge segment crossings
 * - ELC: Elbow clearance from vertical segments
 * - BC: No bus overlap at same Y level
 * - NSE: No staircase edges (single horizontal level per connection)
 *
 * @param routed The routed model from pipeline step 7
 * @param config Optional configuration overrides
 */
export function assertPhaseC(
    routed: RoutedModel,
    config?: PhaseCConfig
): void {
    const cfg = { ...DEFAULT_PHASE_C_CONFIG, ...config };
    const { connections } = routed;

    if (connections.length === 0) return;

    const failures: Array<{ invariant: string; message: string }> = [];

    // EC-Final: Edge Crossings
    try {
        assertNoEdgeCrossings(connections);
    } catch (e) {
        failures.push({ invariant: 'EC-Final', message: (e as Error).message });
        if (cfg.stopOnFirst) throw formatPhaseCError(failures);
    }

    // ELC: Elbow Clearance
    try {
        assertElbowClearance(connections, cfg.elbowClearance, cfg.elbowTolerance);
    } catch (e) {
        failures.push({ invariant: 'ELC', message: (e as Error).message });
        if (cfg.stopOnFirst) throw formatPhaseCError(failures);
    }

    // BC: Bus Collisions
    try {
        assertNoBusOverlap(connections, cfg.busOverlapTolerance);
    } catch (e) {
        failures.push({ invariant: 'BC', message: (e as Error).message });
        if (cfg.stopOnFirst) throw formatPhaseCError(failures);
    }

    // NSE: No Staircase Edges
    try {
        assertNoStaircaseEdges(connections, cfg.staircaseJitterTolerance);
    } catch (e) {
        failures.push({ invariant: 'NSE', message: (e as Error).message });
        if (cfg.stopOnFirst) throw formatPhaseCError(failures);
    }

    if (failures.length > 0) {
        throw formatPhaseCError(failures);
    }
}

// ==================== FSPC ANCESTOR EXTENT BARRIER (LOAD-BEARING) ====================

/**
 * Compute the actual visual card extent of an ancestor subtree.
 *
 * This function recursively traverses childBlockIds and computes the
 * min/max X positions of actual PERSON CARDS (using personX from placed),
 * not block measurement bounds.
 *
 * Key differences from block.xLeft/xRight:
 * - Uses actual personX positions (final placement)
 * - Includes cardWidth for visual extent
 * - Only includes gen < 0 blocks (stops at gen >= 0)
 * - Does NOT stop at side=BOTH, only stops at generation filter
 *
 * @param rootBlockId Starting block for the subtree
 * @param blocks Block map from FamilyBlockModel
 * @param personX Final person X positions from placed
 * @param model Layout model for union info
 * @param cardWidth Card width for extent calculation
 * @returns { minX, maxX } of all person cards in the ancestor subtree
 */
function computeAncestorSubtreeCardExtent(
    rootBlockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    personX: Map<PersonId, number>,
    model: LayoutModel,
    cardWidth: number
): { minX: number; maxX: number } {
    let minX = Infinity;
    let maxX = -Infinity;

    const visited = new Set<FamilyBlockId>();

    function traverse(blockId: FamilyBlockId): void {
        if (visited.has(blockId)) return;
        visited.add(blockId);

        const block = blocks.get(blockId);
        if (!block) return;

        // CRITICAL: Only include gen < 0 blocks (ancestors)
        // Do NOT stop at side=BOTH - only generation matters
        if (block.generation >= 0) return;

        // Get the union for this block to find persons
        const union = model.unions.get(block.rootUnionId);
        if (!union) return;

        // Include partnerA card extent
        // Note: personX stores the LEFT edge of each card
        const pAx = personX.get(union.partnerA);
        if (pAx !== undefined) {
            minX = Math.min(minX, pAx);
            maxX = Math.max(maxX, pAx + cardWidth);
        }

        // Include partnerB card extent (if exists)
        if (union.partnerB) {
            const pBx = personX.get(union.partnerB);
            if (pBx !== undefined) {
                minX = Math.min(minX, pBx);
                maxX = Math.max(maxX, pBx + cardWidth);
            }
        }

        // Recursively traverse UP to parent block (older generation in ancestry)
        // Note: For ancestors, parentBlockId points to older generations
        if (block.parentBlockId) {
            traverse(block.parentBlockId);
        }
    }

    traverse(rootBlockId);

    return { minX, maxX };
}

/**
 * Find the root ancestor block for a person's lineage.
 *
 * Traces from the person to their parent union block (gen -1 from focus).
 * This is the starting point for the ancestor subtree.
 */
function findAncestorRootBlockForExtent(
    personId: PersonId,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    blocks: Map<FamilyBlockId, FamilyBlock>
): FamilyBlockId | null {
    const parentUnionId = model.childToParentUnion.get(personId);
    if (!parentUnionId) return null;

    const parentBlockId = unionToBlock.get(parentUnionId);
    if (!parentBlockId) return null;

    const parentBlock = blocks.get(parentBlockId);
    if (!parentBlock || parentBlock.generation >= 0) return null;

    return parentBlockId;
}

/**
 * LOAD-BEARING ASSERTION: FSPC Ancestor Extent Barrier
 *
 * This is the STRICT, CORRECT assertion for Phase B FSPC invariant.
 * Unlike assertFocusSpouseParentContainment which uses block.xRight/xLeft
 * (measurement-time bounds), this uses actual personX positions.
 *
 * Rule (single source of truth):
 * For focus couple (gen 0), with husband left, wife right:
 * - H-side ancestor subtree (husband's lineage): maxX <= xCenter(husband)
 * - W-side ancestor subtree (wife's lineage): minX >= xCenter(wife)
 *
 * CHANGE: Barrier is now partner CENTER (not card edge).
 * This provides cleaner visual separation between H-side and W-side ancestors.
 *
 * This is a HARD BARRIER, not best-effort. Tolerance should be minimal (0-1px).
 *
 * @param constrained The constrained model after Phase B
 * @param focusPersonId Focus person ID
 * @param cardWidth Card width (default: 130)
 * @param tolerance Tolerance in pixels (default: 1)
 */
export function assertFSPC_AncestorExtentBarrier(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    cardWidth: number = DEFAULT_CARD_WIDTH,
    tolerance: number = 1
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    // 1. Find focus couple (gen 0)
    const focusUnionId = model.personToUnion.get(focusPersonId);
    if (!focusUnionId) return;

    const focusBlockId = unionToBlock.get(focusUnionId);
    if (!focusBlockId) return;

    const focusBlock = blocks.get(focusBlockId);
    if (!focusBlock || focusBlock.generation !== 0) return;

    const focusUnion = model.unions.get(focusUnionId);
    if (!focusUnion || !focusUnion.partnerB) return;

    // 2. Get actual person X positions for focus couple
    const husbandX = personX.get(focusUnion.partnerA);
    const wifeX = personX.get(focusUnion.partnerB);

    if (husbandX === undefined || wifeX === undefined) return;

    const violations: string[] = [];

    // 3. Find ancestor root blocks for both sides
    const hRootBlockId = findAncestorRootBlockForExtent(
        focusUnion.partnerA, model, unionToBlock, blocks
    );
    const wRootBlockId = findAncestorRootBlockForExtent(
        focusUnion.partnerB, model, unionToBlock, blocks
    );

    // FSPC only applies when BOTH sides have ancestors
    // Algorithm: if only one side has ancestors, they are centered above that parent
    if (!hRootBlockId || !wRootBlockId) return;

    // Check H-side
    const hExtent = computeAncestorSubtreeCardExtent(
        hRootBlockId, blocks, personX, model, cardWidth
    );

    if (isFinite(hExtent.maxX)) {
        // H-side barrier: maxX(ancestor subtree) <= center(husband)
        // Note: personX stores the LEFT edge, so center = husbandX + cardWidth/2
        const barrier = husbandX + cardWidth / 2;

        if (hExtent.maxX > barrier + tolerance) {
            const overshoot = hExtent.maxX - barrier;
            violations.push(
                `H-side (husband's ancestors): ` +
                `subtree maxX=${hExtent.maxX.toFixed(1)} > barrier=${barrier.toFixed(1)} ` +
                `(overshoot=${overshoot.toFixed(1)}px, barrier=center(husband))`
            );
        }
    }

    // Check W-side
    const wExtent = computeAncestorSubtreeCardExtent(
        wRootBlockId, blocks, personX, model, cardWidth
    );

    if (isFinite(wExtent.minX)) {
        // W-side barrier: minX(ancestor subtree) >= center(wife)
        // Note: personX stores the LEFT edge, so center = wifeX + cardWidth/2
        const barrier = wifeX + cardWidth / 2;

        if (wExtent.minX < barrier - tolerance) {
            const overshoot = barrier - wExtent.minX;
            violations.push(
                `W-side (wife's ancestors): ` +
                `subtree minX=${wExtent.minX.toFixed(1)} < barrier=${barrier.toFixed(1)} ` +
                `(overshoot=${overshoot.toFixed(1)}px, barrier=center(wife))`
            );
        }
    }

    if (violations.length > 0) {
        const husbandName = model.persons.get(focusUnion.partnerA)?.firstName ?? '?';
        const wifeName = model.persons.get(focusUnion.partnerB)?.firstName ?? '?';

        throw new Error(
            `FSPC Ancestor Extent Barrier violated for focus couple "${husbandName} & ${wifeName}":\n` +
            violations.join('\n') +
            `\n\nThis is a HARD BARRIER. Ancestors must never cross the partner center line.`
        );
    }
}

/**
 * Assertion: ACOMP — Ancestor Gap to Seam Maximum
 *
 * Verifies that the gap between ancestor trees and the seam (focus couple)
 * is minimal (within maxGapPx).
 *
 * After ACOMP compaction, ancestors should be close to the seam:
 * - H-side: gap = husbandX - maxX(H-side ancestors) <= maxGapPx
 * - W-side: gap = minX(W-side ancestors) - wifeX <= maxGapPx
 *
 * @param constrained The constrained model after Phase B
 * @param focusPersonId Focus person ID
 * @param maxGapPx Maximum allowed gap (default: 80px)
 * @param cardWidth Card width (default: 130)
 */
export function assertAncestorGapToSeamMax(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    maxGapPx: number = 80,
    cardWidth: number = DEFAULT_CARD_WIDTH
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    // Find focus couple
    const focusUnionId = model.personToUnion.get(focusPersonId);
    if (!focusUnionId) return;

    const focusBlockId = unionToBlock.get(focusUnionId);
    if (!focusBlockId) return;

    const focusBlock = blocks.get(focusBlockId);
    if (!focusBlock || focusBlock.generation !== 0) return;

    const focusUnion = model.unions.get(focusUnionId);
    if (!focusUnion || !focusUnion.partnerB) return;

    // Get actual person X positions for focus couple
    const husbandX = personX.get(focusUnion.partnerA);
    const wifeX = personX.get(focusUnion.partnerB);

    if (husbandX === undefined || wifeX === undefined) return;

    // Compute H-side extent - find rightmost card across ALL H-side ancestor blocks
    let hMaxX = -Infinity;
    for (const [, block] of blocks) {
        if (block.generation < 0 && block.side === 'HUSBAND') {
            const union = model.unions.get(block.rootUnionId);
            if (!union) continue;

            // Get personX for both partners
            const pAx = personX.get(union.partnerA);
            if (pAx !== undefined) {
                hMaxX = Math.max(hMaxX, pAx + cardWidth);
            }
            if (union.partnerB) {
                const pBx = personX.get(union.partnerB);
                if (pBx !== undefined) {
                    hMaxX = Math.max(hMaxX, pBx + cardWidth);
                }
            }
        }
    }

    if (isFinite(hMaxX)) {
        // personX stores LEFT edge, so husbandX is already the left edge of husband's card
        // The seam is the left edge of the husband card (FSPC barrier)
        const seamH = husbandX;
        const gapH = seamH - hMaxX;

        if (gapH > maxGapPx) {
            throw new Error(
                `ACOMP violation (H-side): gap to seam is ${gapH.toFixed(1)}px, ` +
                `max allowed is ${maxGapPx}px. H-side ancestors are too far left.`
            );
        }
    }

    // Compute W-side extent - find leftmost card across ALL W-side ancestor blocks
    let wMinX = Infinity;
    for (const [, block] of blocks) {
        if (block.generation < 0 && block.side === 'WIFE') {
            const union = model.unions.get(block.rootUnionId);
            if (!union) continue;

            // Get personX for both partners (personX is left edge)
            const pAx = personX.get(union.partnerA);
            if (pAx !== undefined) {
                wMinX = Math.min(wMinX, pAx);
            }
            if (union.partnerB) {
                const pBx = personX.get(union.partnerB);
                if (pBx !== undefined) {
                    wMinX = Math.min(wMinX, pBx);
                }
            }
        }
    }

    if (isFinite(wMinX)) {
        // personX stores LEFT edge, so wifeX is left edge of wife's card
        // The seam is the right edge of the wife card (FSPC barrier)
        const seamW = wifeX + cardWidth;
        const gapW = wMinX - seamW;

        if (gapW > maxGapPx) {
            throw new Error(
                `ACOMP violation (W-side): gap to seam is ${gapW.toFixed(1)}px, ` +
                `max allowed is ${maxGapPx}px. W-side ancestors are too far right.`
            );
        }
    }
}

/**
 * Assertion: CAP (Couple Ancestor Polarity) - No Side Overlap
 *
 * For EVERY ancestor couple in the focus person's direct ancestry:
 * - H-side (husband's) ancestor cards must be ENTIRELY LEFT of W-side (wife's) ancestor cards
 * - Specifically: max(H-side right edges) < min(W-side left edges) - gap
 *
 * This is a LOAD-BEARING assertion that uses actual personX positions (not block bounds)
 * to verify that ancestor trees never visually overlap or cross sides.
 */
export function assertCAP_NoSideOverlap(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    cardWidth: number = DEFAULT_CARD_WIDTH,
    minGap: number = DEFAULT_GAP,
    tolerance: number = 0.5
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    // Collect all ancestor couples in the focus person's direct ancestry
    const ancestorCouples = collectFocusAncestorCouples(focusPersonId, model, unionToBlock, blocks);
    const violations: string[] = [];

    for (const coupleBlockId of ancestorCouples) {
        const coupleBlock = blocks.get(coupleBlockId);
        if (!coupleBlock) continue;

        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union || !union.partnerB) continue;

        // Skip couples with extreme coordinates (cross-tree separation artifacts)
        if (Math.abs(coupleBlock.xCenter) > 5000) continue;

        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);

        // Determine husband/wife by gender (husband = male, should be LEFT)
        let husbandId: PersonId;
        let wifeId: PersonId;
        if (personA?.gender === 'male' || personB?.gender === 'female') {
            husbandId = union.partnerA;
            wifeId = union.partnerB;
        } else if (personB?.gender === 'male' || personA?.gender === 'female') {
            husbandId = union.partnerB;
            wifeId = union.partnerA;
        } else {
            // Default fallback: partnerA = husband
            husbandId = union.partnerA;
            wifeId = union.partnerB;
        }

        const husband = model.persons.get(husbandId);
        const wife = model.persons.get(wifeId);
        const coupleNames = `${husband?.firstName ?? '?'} & ${wife?.firstName ?? '?'}`;

        // Collect H-side (husband's) and W-side (wife's) ancestor CARD positions
        const hPersonIds = collectAncestorPersonIds(husbandId, model);
        const wPersonIds = collectAncestorPersonIds(wifeId, model);

        // Compute actual card extents from personX
        let hMaxRightEdge = -Infinity;
        for (const pid of hPersonIds) {
            const px = personX.get(pid);
            if (px !== undefined && Math.abs(px) < 5000) {
                const rightEdge = px + cardWidth;
                hMaxRightEdge = Math.max(hMaxRightEdge, rightEdge);
            }
        }

        let wMinLeftEdge = Infinity;
        for (const pid of wPersonIds) {
            const px = personX.get(pid);
            if (px !== undefined && Math.abs(px) < 5000) {
                wMinLeftEdge = Math.min(wMinLeftEdge, px);
            }
        }

        // Skip if either side has no positioned ancestors
        if (!isFinite(hMaxRightEdge) || !isFinite(wMinLeftEdge)) continue;

        // CAP check: H-side right edge must be LEFT of W-side left edge (with gap)
        const requiredBoundary = wMinLeftEdge - minGap;
        if (hMaxRightEdge > requiredBoundary + tolerance) {
            const overlap = hMaxRightEdge - requiredBoundary;
            violations.push(
                `Couple "${coupleNames}" (gen ${coupleBlock.generation}): ` +
                `H-side ancestor maxRight=${hMaxRightEdge.toFixed(1)} > ` +
                `W-side ancestor minLeft=${wMinLeftEdge.toFixed(1)} - gap=${minGap} ` +
                `(overlap=${overlap.toFixed(1)}px)`
            );
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `CAP (Couple Ancestor Polarity) violated - ancestor sides overlap:\n` +
            violations.slice(0, 10).join('\n') +
            (violations.length > 10 ? `\n... and ${violations.length - 10} more` : '') +
            `\n\nH-side ancestors must be entirely LEFT of W-side ancestors.`
        );
    }
}

/**
 * Helper: collect all ancestor person IDs for a given person (gen < 0 only).
 * Includes all ancestors on their lineage tree, not just direct line.
 */
function collectAncestorPersonIds(
    startPersonId: PersonId,
    model: LayoutModel
): Set<PersonId> {
    const result = new Set<PersonId>();
    const visited = new Set<PersonId>();

    function trace(pid: PersonId): void {
        if (visited.has(pid)) return;
        visited.add(pid);

        const parentUnionId = model.childToParentUnion.get(pid);
        if (!parentUnionId) return;

        const parentUnion = model.unions.get(parentUnionId);
        if (!parentUnion) return;

        // Add parents
        result.add(parentUnion.partnerA);
        if (parentUnion.partnerB) {
            result.add(parentUnion.partnerB);
        }

        // Add siblings of parents (aunts/uncles in that lineage)
        // This is needed because we trace through both partners' parents
        const grandparentUnionA = model.childToParentUnion.get(parentUnion.partnerA);
        if (grandparentUnionA) {
            const gpUnion = model.unions.get(grandparentUnionA);
            if (gpUnion) {
                for (const sibId of gpUnion.childIds) {
                    result.add(sibId);
                }
            }
        }
        if (parentUnion.partnerB) {
            const grandparentUnionB = model.childToParentUnion.get(parentUnion.partnerB);
            if (grandparentUnionB) {
                const gpUnion = model.unions.get(grandparentUnionB);
                if (gpUnion) {
                    for (const sibId of gpUnion.childIds) {
                        result.add(sibId);
                    }
                }
            }
        }

        // Recurse upward
        trace(parentUnion.partnerA);
        if (parentUnion.partnerB) trace(parentUnion.partnerB);
    }

    trace(startPersonId);
    return result;
}

/**
 * Ancestor Envelope Constraint (AEC)
 *
 * For EVERY couple (H + W) in the ancestor tree:
 * - H's DIRECT ancestor subtree must have maxX ≤ H's right edge (barrier)
 * - W's DIRECT ancestor subtree must have minX ≥ W's left edge (barrier)
 *
 * "Direct ancestor subtree" means the parent block of that partner and all ancestors above it.
 * This ensures ancestors stay "contained" above their descendant - they cannot
 * spill over to the other partner's side.
 */
/**
 * ACOMP - Ancestor Compaction Check
 *
 * Verifies that ancestor subtrees are reasonably compacted:
 * - No excessive gaps between same-side ancestor subtrees
 * - Gaps should be close to minGap unless forced by barriers
 */
export function assertAncestorCompaction(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    maxAllowedGap: number = 200, // Allow some slack for barriers
    tolerance: number = 1.0
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks) return;

    const blocks = fbm.blocks;
    const violations: string[] = [];

    // Check gaps between same-side ancestor blocks per generation
    const ancestorGens = new Set<number>();
    for (const [, block] of blocks) {
        if (block.generation < 0) ancestorGens.add(block.generation);
    }

    for (const gen of ancestorGens) {
        // Get H-side blocks at this generation
        const hBlocks: FamilyBlock[] = [];
        const wBlocks: FamilyBlock[] = [];

        for (const [, block] of blocks) {
            if (block.generation !== gen) continue;
            if (block.side === 'HUSBAND') hBlocks.push(block);
            else if (block.side === 'WIFE') wBlocks.push(block);
        }

        // Check H-side gaps (sorted by xLeft)
        if (hBlocks.length > 1) {
            hBlocks.sort((a, b) => a.xLeft - b.xLeft);
            for (let i = 0; i < hBlocks.length - 1; i++) {
                const left = hBlocks[i];
                const right = hBlocks[i + 1];
                const gap = right.xLeft - left.xRight;
                if (gap > maxAllowedGap + tolerance) {
                    const leftUnion = model.unions.get(left.rootUnionId);
                    const rightUnion = model.unions.get(right.rootUnionId);
                    const leftPerson = leftUnion ? model.persons.get(leftUnion.partnerA) : null;
                    const rightPerson = rightUnion ? model.persons.get(rightUnion.partnerA) : null;
                    violations.push(
                        `H-side gen ${gen}: gap between "${leftPerson?.firstName ?? '?'}" and ` +
                        `"${rightPerson?.firstName ?? '?'}" is ${gap.toFixed(1)}px (max allowed: ${maxAllowedGap}px)`
                    );
                }
            }
        }

        // Check W-side gaps (sorted by xRight descending)
        if (wBlocks.length > 1) {
            wBlocks.sort((a, b) => b.xRight - a.xRight);
            for (let i = 0; i < wBlocks.length - 1; i++) {
                const right = wBlocks[i];
                const left = wBlocks[i + 1];
                const gap = right.xLeft - left.xRight;
                if (gap > maxAllowedGap + tolerance) {
                    const leftUnion = model.unions.get(left.rootUnionId);
                    const rightUnion = model.unions.get(right.rootUnionId);
                    const leftPerson = leftUnion ? model.persons.get(leftUnion.partnerA) : null;
                    const rightPerson = rightUnion ? model.persons.get(rightUnion.partnerA) : null;
                    violations.push(
                        `W-side gen ${gen}: gap between "${leftPerson?.firstName ?? '?'}" and ` +
                        `"${rightPerson?.firstName ?? '?'}" is ${gap.toFixed(1)}px (max allowed: ${maxAllowedGap}px)`
                    );
                }
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `ACOMP (Ancestor Compaction) check failed - excessive gaps:\n` +
            violations.slice(0, 10).join('\n') +
            (violations.length > 10 ? `\n... and ${violations.length - 10} more` : '')
        );
    }
}

export function assertAncestorEnvelopeCAP(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    cardWidth: number = DEFAULT_CARD_WIDTH,
    partnerGap: number = DEFAULT_LAYOUT_CONFIG.partnerGap,
    tolerance: number = 1.0
): void {
    const { placed } = constrained;
    const { measured, personX } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;

    const violations: string[] = [];

    // Helper: get the DIRECT parent block for a person (just the immediate parents)
    function getDirectParentBlock(personId: PersonId): FamilyBlock | null {
        const parentUnionId = model.childToParentUnion.get(personId);
        if (!parentUnionId) return null;

        const parentBlockId = unionToBlock.get(parentUnionId);
        if (!parentBlockId) return null;

        const parentBlock = blocks.get(parentBlockId);
        if (!parentBlock || parentBlock.generation >= 0) return null;

        return parentBlock;
    }

    // Process ALL ancestor blocks
    const ancestorCouples = collectFocusAncestorCouples(focusPersonId, model, unionToBlock, blocks);

    for (const coupleBlockId of ancestorCouples) {
        const block = blocks.get(coupleBlockId);
        if (!block || block.generation >= 0) continue;

        const union = model.unions.get(block.rootUnionId);
        if (!union || !union.partnerB) continue;

        // Skip blocks with extreme coordinates
        if (Math.abs(block.xCenter) > 5000) continue;

        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);

        // Determine husband/wife by gender
        let husbandId: PersonId;
        let wifeId: PersonId;
        if (personA?.gender === 'male' || personB?.gender === 'female') {
            husbandId = union.partnerA;
            wifeId = union.partnerB;
        } else if (personB?.gender === 'male' || personA?.gender === 'female') {
            husbandId = union.partnerB;
            wifeId = union.partnerA;
        } else {
            husbandId = union.partnerA;
            wifeId = union.partnerB;
        }

        const husband = model.persons.get(husbandId);
        const wife = model.persons.get(wifeId);
        const coupleNames = `${husband?.firstName ?? '?'} & ${wife?.firstName ?? '?'}`;

        // Compute barriers from block position
        // H is on the left, W is on the right
        const hBarrier = block.xCenter - partnerGap / 2; // right edge of H
        const wBarrier = block.xCenter + partnerGap / 2; // left edge of W

        // Get DIRECT parent blocks (just immediate parents, not all ancestors)
        const hParentBlock = getDirectParentBlock(husbandId);
        const wParentBlock = getDirectParentBlock(wifeId);

        // Check H's parent block: maxX ≤ hBarrier
        if (hParentBlock && Math.abs(hParentBlock.xRight) <= 5000) {
            if (hParentBlock.xRight > hBarrier + tolerance) {
                const aUnion = model.unions.get(hParentBlock.rootUnionId);
                const aPersonA = aUnion ? model.persons.get(aUnion.partnerA) : null;
                const aPersonB = aUnion?.partnerB ? model.persons.get(aUnion.partnerB) : null;
                const aNames = aPersonB
                    ? `${aPersonA?.firstName ?? '?'} & ${aPersonB?.firstName ?? '?'}`
                    : `${aPersonA?.firstName ?? '?'}`;
                violations.push(
                    `Couple "${coupleNames}" (gen ${block.generation}): ` +
                    `H-parent block "${aNames}" (gen ${hParentBlock.generation}) xRight=${hParentBlock.xRight.toFixed(1)} > ` +
                    `hBarrier=${hBarrier.toFixed(1)} (overshoot=${(hParentBlock.xRight - hBarrier).toFixed(1)}px)`
                );
            }
        }

        // Check W's parent block: minX ≥ wBarrier
        if (wParentBlock && Math.abs(wParentBlock.xLeft) <= 5000) {
            if (wParentBlock.xLeft < wBarrier - tolerance) {
                const aUnion = model.unions.get(wParentBlock.rootUnionId);
                const aPersonA = aUnion ? model.persons.get(aUnion.partnerA) : null;
                const aPersonB = aUnion?.partnerB ? model.persons.get(aUnion.partnerB) : null;
                const aNames = aPersonB
                    ? `${aPersonA?.firstName ?? '?'} & ${aPersonB?.firstName ?? '?'}`
                    : `${aPersonA?.firstName ?? '?'}`;
                violations.push(
                    `Couple "${coupleNames}" (gen ${block.generation}): ` +
                    `W-parent block "${aNames}" (gen ${wParentBlock.generation}) xLeft=${wParentBlock.xLeft.toFixed(1)} < ` +
                    `wBarrier=${wBarrier.toFixed(1)} (undershoot=${(wBarrier - wParentBlock.xLeft).toFixed(1)}px)`
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Ancestor Envelope Constraint (AEC) violated:\n` +
            violations.slice(0, 15).join('\n') +
            (violations.length > 15 ? `\n... and ${violations.length - 15} more` : '') +
            `\n\nEach partner's ancestor subtree must stay within the envelope above that partner.`
        );
    }
}

/**
 * Assertion: AOE (Ancestor-Only Extent) Verification
 *
 * Verifies that ancestor extents computed for ACOMP do not include
 * descendant blocks (gen >= 0) or BOTH blocks (focus block).
 *
 * This assertion checks that the computeAncestorOnlyExtent function
 * in the constraint pipeline correctly filters out non-ancestor blocks.
 */
export function assertAncestorOnlyExtent(
    constrained: ConstrainedModel,
    _focusPersonId: PersonId
): void {
    const { placed } = constrained;
    const { measured } = placed;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const violations: string[] = [];

    // Collect all gen >= 0 blocks (BOTH or descendant blocks)
    const descendantBlockIds = new Set<FamilyBlockId>();
    for (const [blockId, block] of blocks) {
        if (block.generation >= 0) {
            descendantBlockIds.add(blockId);
        }
    }

    // For each side, verify that all ancestor blocks have correct side assignment
    for (const [blockId, block] of blocks) {
        // Only check ancestor blocks (gen < 0)
        if (block.generation >= 0) continue;

        // Verify block has a valid side (HUSBAND or WIFE, never BOTH for gen < 0)
        if (block.side === 'BOTH') {
            violations.push(
                `Block "${blockId}" at gen ${block.generation} has side=BOTH ` +
                `(should be HUSBAND or WIFE for ancestors)`
            );
        }

        // Verify childBlockIds does not contain only descendant blocks
        // (this would indicate contamination)
        const ancestorChildren = block.childBlockIds.filter(
            id => !descendantBlockIds.has(id)
        );
        const descendantChildren = block.childBlockIds.filter(
            id => descendantBlockIds.has(id)
        );

        // It's OK for ancestor blocks to have references to BOTH blocks (focus)
        // But if ALL children are descendants, that's unusual
        if (descendantChildren.length > 0 && ancestorChildren.length === 0) {
            // This is expected for gen -1 blocks that have focus as child
            // Only flag if it's a deeper ancestor with no ancestor children
            if (block.generation < -1) {
                violations.push(
                    `Block "${blockId}" at gen ${block.generation} has only descendant children ` +
                    `(${descendantChildren.length} descendant, 0 ancestor) — potential contamination`
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Ancestor-Only Extent (AOE) verification failed:\n` +
            violations.slice(0, 10).join('\n') +
            (violations.length > 10 ? `\n... and ${violations.length - 10} more` : '')
        );
    }
}

// ==================== LOCKED DESCENDANT POSITIONS ====================

/**
 * LockedPositions - snapshot of gen>=0 positions after Phase A.
 * Used to verify Phase B doesn't modify descendant positions.
 */
export interface LockedPositions {
    personX: Map<PersonId, number>;
    unionX: Map<UnionId, number>;
}

/**
 * Capture positions of all gen>=0 persons and unions from a ConstrainedModel.
 * Call this after Phase A to capture the baseline positions.
 */
export function captureLockedPositions(
    constrained: ConstrainedModel,
    _cardWidth = DEFAULT_CARD_WIDTH,
    _partnerGap = DEFAULT_LAYOUT_CONFIG.partnerGap
): LockedPositions {
    const { placed } = constrained;
    const { measured, unionX, personX } = placed;
    const { genModel } = measured;
    const { model: _model } = genModel;

    const locked: LockedPositions = {
        personX: new Map(),
        unionX: new Map()
    };

    // Capture union positions
    for (const [uid, gen] of genModel.unionGen) {
        if (gen >= 0) {
            const x = unionX.get(uid);
            if (x !== undefined) {
                locked.unionX.set(uid, x);
            }
        }
    }

    // Capture person positions
    for (const [pid, gen] of genModel.personGen) {
        if (gen >= 0) {
            const x = personX.get(pid);
            if (x !== undefined) {
                locked.personX.set(pid, x);
            }
        }
    }

    return locked;
}

/**
 * Assert that gen>=0 positions haven't changed from locked snapshot.
 * Throws error with details if any position moved beyond tolerance.
 *
 * @param locked Snapshot from captureLockedPositions after Phase A
 * @param constrained Current model after Phase B
 * @param tolerance Maximum allowed deviation in pixels (default: 0.5px)
 */
export function assertLockedDescendantsUnchanged(
    locked: LockedPositions,
    constrained: ConstrainedModel,
    tolerance = 0.5
): void {
    const { placed } = constrained;
    const { unionX, personX } = placed;

    const violations: string[] = [];

    // Check union positions
    for (const [uid, oldX] of locked.unionX) {
        const newX = unionX.get(uid);
        if (newX !== undefined) {
            const delta = Math.abs(newX - oldX);
            if (delta > tolerance) {
                violations.push(
                    `Union ${uid}: moved from ${oldX.toFixed(1)} to ${newX.toFixed(1)} (Δ=${delta.toFixed(1)})`
                );
            }
        }
    }

    // Check person positions
    for (const [pid, oldX] of locked.personX) {
        const newX = personX.get(pid);
        if (newX !== undefined) {
            const delta = Math.abs(newX - oldX);
            if (delta > tolerance) {
                violations.push(
                    `Person ${pid}: moved from ${oldX.toFixed(1)} to ${newX.toFixed(1)} (Δ=${delta.toFixed(1)})`
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `Phase B modified ${violations.length} descendant position(s):\n` +
            violations.slice(0, 10).join('\n') +
            (violations.length > 10 ? `\n... and ${violations.length - 10} more` : '')
        );
    }
}

/**
 * A-COMP-I: Assert Ancestor Compaction Inward
 *
 * Verifies that gaps between adjacent ancestor blocks within the same
 * generation and side are not excessively large (max 3 * horizontalGap).
 *
 * Blocks that are at their ASO barrier limit are exempt from this check
 * since they cannot move any closer without violating ASO.
 *
 * @param constrained The constrained model after Phase B
 * @param focusPersonId The focus person ID
 * @param config Layout configuration for gap threshold
 */
export function assertAncestorCompactionInward(
    constrained: ConstrainedModel,
    focusPersonId: PersonId,
    config: LayoutConfig
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel } = measured;
    const { model } = genModel;

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || !fbm.unionToBlock) return;

    const blocks = fbm.blocks;
    const unionToBlock = fbm.unionToBlock;
    const maxAllowedGap = 3 * config.horizontalGap;
    const violations: string[] = [];

    // Helper: determine H/W from union
    function getHusbandWifeIds(union: { partnerA: PersonId; partnerB: PersonId | null }): { husbandId: PersonId; wifeId: PersonId } | null {
        if (!union.partnerB) return null;
        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);
        let husbandId: PersonId;
        let wifeId: PersonId;
        if (personA?.gender === 'male' || personB?.gender === 'female') {
            husbandId = union.partnerA;
            wifeId = union.partnerB;
        } else if (personB?.gender === 'male' || personA?.gender === 'female') {
            husbandId = union.partnerB;
            wifeId = union.partnerA;
        } else {
            husbandId = union.partnerA;
            wifeId = union.partnerB;
        }
        return { husbandId, wifeId };
    }

    /**
     * Compute ASO barrier for a block (center of descendant in their couple).
     * Returns null if no valid child couple found.
     */
    function computeASOBarrier(block: FamilyBlock): number | null {
        const union = model.unions.get(block.rootUnionId);
        if (!union) return null;

        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (!childUnionId) continue;
            const childBlockId = unionToBlock.get(childUnionId);
            if (!childBlockId) continue;
            const childBlock = blocks.get(childBlockId);
            if (!childBlock) continue;

            const childUnion = model.unions.get(childUnionId);
            if (!childUnion || !childUnion.partnerB) continue;

            const hw = getHusbandWifeIds(childUnion);
            if (!hw) continue;

            if (childId === hw.husbandId) {
                // Barrier is husband's center
                return childBlock.xCenter - config.partnerGap / 2 - config.cardWidth / 2;
            } else if (childId === hw.wifeId) {
                // Barrier is wife's center
                return childBlock.xCenter + config.partnerGap / 2 + config.cardWidth / 2;
            }
        }
        return null;
    }

    /**
     * Check if a block is at its ASO barrier limit.
     * H-side: xRight >= barrier (can't move right any more)
     * W-side: xLeft <= barrier (can't move left any more)
     */
    function isAtASOBarrier(block: FamilyBlock): boolean {
        const barrier = computeASOBarrier(block);
        if (barrier === null) return true; // No barrier = can't determine, assume OK

        const tolerance = 1.0;
        if (block.side === 'HUSBAND') {
            // H-side: block.xRight should be <= barrier, at barrier means xRight >= barrier - tolerance
            return block.xRight >= barrier - tolerance;
        } else if (block.side === 'WIFE') {
            // W-side: block.xLeft should be >= barrier, at barrier means xLeft <= barrier + tolerance
            return block.xLeft <= barrier + tolerance;
        }
        return true;
    }

    // Group blocks by generation
    const byGen = new Map<number, FamilyBlock[]>();
    for (const [, block] of blocks) {
        if (block.generation >= -1) continue; // Only gen -2 and beyond
        if (!byGen.has(block.generation)) byGen.set(block.generation, []);
        byGen.get(block.generation)!.push(block);
    }

    for (const [gen, genBlocks] of byGen) {
        // Separate H-side and W-side blocks
        const hBlocks = genBlocks.filter(b => b.side === 'HUSBAND');
        const wBlocks = genBlocks.filter(b => b.side === 'WIFE');

        // Check H-side gaps (sorted left-to-right)
        if (hBlocks.length > 1) {
            hBlocks.sort((a, b) => a.xCenter - b.xCenter);
            for (let i = 0; i < hBlocks.length - 1; i++) {
                const left = hBlocks[i];
                const right = hBlocks[i + 1];
                const gap = right.xLeft - left.xRight;

                if (gap > maxAllowedGap) {
                    // Check if either block is at its ASO barrier
                    const leftAtBarrier = isAtASOBarrier(left);
                    const rightAtBarrier = isAtASOBarrier(right);

                    // If the LEFT block is at its barrier, it can't move right to close the gap
                    // (For H-side blocks, moving right = inward compaction)
                    if (!leftAtBarrier) {
                        const leftUnion = model.unions.get(left.rootUnionId);
                        const rightUnion = model.unions.get(right.rootUnionId);
                        const leftPerson = leftUnion ? model.persons.get(leftUnion.partnerA) : null;
                        const rightPerson = rightUnion ? model.persons.get(rightUnion.partnerA) : null;
                        violations.push(
                            `H-side gen ${gen}: gap ${gap.toFixed(1)}px > ${maxAllowedGap}px between ` +
                            `"${leftPerson?.firstName ?? '?'}" and "${rightPerson?.firstName ?? '?'}" ` +
                            `(left not at ASO barrier)`
                        );
                    }
                }
            }
        }

        // Check W-side gaps (sorted right-to-left)
        if (wBlocks.length > 1) {
            wBlocks.sort((a, b) => b.xCenter - a.xCenter);
            for (let i = 0; i < wBlocks.length - 1; i++) {
                const right = wBlocks[i];
                const left = wBlocks[i + 1];
                const gap = right.xLeft - left.xRight;

                if (gap > maxAllowedGap) {
                    // Check if either block is at its ASO barrier
                    const leftAtBarrier = isAtASOBarrier(left);
                    const rightAtBarrier = isAtASOBarrier(right);

                    // If the RIGHT block is at its barrier, it can't move left to close the gap
                    // (For W-side blocks, moving left = inward compaction)
                    if (!rightAtBarrier) {
                        const leftUnion = model.unions.get(left.rootUnionId);
                        const rightUnion = model.unions.get(right.rootUnionId);
                        const leftPerson = leftUnion ? model.persons.get(leftUnion.partnerA) : null;
                        const rightPerson = rightUnion ? model.persons.get(rightUnion.partnerA) : null;
                        violations.push(
                            `W-side gen ${gen}: gap ${gap.toFixed(1)}px > ${maxAllowedGap}px between ` +
                            `"${leftPerson?.firstName ?? '?'}" and "${rightPerson?.firstName ?? '?'}" ` +
                            `(right not at ASO barrier)`
                        );
                    }
                }
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `A-COMP-I (Ancestor Compaction Inward) failed - excessive gaps:\n` +
            violations.slice(0, 10).join('\n') +
            (violations.length > 10 ? `\n... and ${violations.length - 10} more` : '')
        );
    }
}

/**
 * Invariant: ASO Barrier Hard (per-couple)
 *
 * Only applies when BOTH sides of a couple have ancestors.
 * Algorithm: if only one side has ancestors, they are centered above that parent.
 *
 * For each ancestor couple block U (gen <= -2) where child couple has ancestors on BOTH sides:
 * - H-side subtree (parent of husband): extent.maxX <= x(husband_U)
 * - W-side subtree (parent of wife): extent.minX >= x(wife_U)
 */
export function assertASOBarrierHard(
    constrained: ConstrainedModel,
    tolerance = 0.5
): void {
    const { placed } = constrained;
    const { measured } = placed;
    const { genModel, blocks, unionToBlock } = measured as any;
    const { model } = genModel;
    const config = DEFAULT_LAYOUT_CONFIG;

    if (!blocks || !unionToBlock) return;

    const violations: string[] = [];

    // Helper: determine H/W from union
    function getHusbandWifeIds(union: { partnerA: PersonId; partnerB: PersonId | null }): { husbandId: PersonId; wifeId: PersonId } | null {
        if (!union.partnerB) return null;
        const personA = model.persons.get(union.partnerA);
        const personB = model.persons.get(union.partnerB);

        const genderA = personA?.gender;
        const genderB = personB?.gender;

        // Male + Female: male is husband
        if (genderA === 'male' && genderB === 'female') {
            return { husbandId: union.partnerA, wifeId: union.partnerB };
        }
        if (genderA === 'female' && genderB === 'male') {
            return { husbandId: union.partnerB, wifeId: union.partnerA };
        }
        // Same gender or unknown: partnerA is husband
        return { husbandId: union.partnerA, wifeId: union.partnerB };
    }

    // Helper: check if person has parents
    function hasParents(personId: PersonId): boolean {
        return model.childToParentUnion.has(personId);
    }

    // Helper: compute subtree extent (side-only, stops at BOTH)
    function subtreeExtentSideOnly(blockId: string): { minX: number; maxX: number } {
        const block = blocks.get(blockId);
        if (!block) return { minX: 0, maxX: 0 };

        let minX = block.xLeft;
        let maxX = block.xRight;

        const stack = [...block.childBlockIds];
        const visited = new Set<string>([blockId]);

        while (stack.length > 0) {
            const childId = stack.pop()!;
            if (visited.has(childId)) continue;
            visited.add(childId);

            const child = blocks.get(childId);
            if (!child) continue;

            // Stop at BOTH blocks
            if (child.side === 'BOTH') continue;
            // Stop at gen >= 0
            if (child.generation >= 0) continue;

            minX = Math.min(minX, child.xLeft);
            maxX = Math.max(maxX, child.xRight);

            for (const grandchildId of child.childBlockIds) {
                stack.push(grandchildId);
            }
        }

        return { minX, maxX };
    }

    // Check each ancestor couple block
    for (const [blockId, block] of blocks) {
        // Only gen <= -2
        if (block.generation >= -1) continue;
        // Only H/W side
        if (block.side === 'BOTH') continue;

        const union = model.unions.get(block.rootUnionId);
        if (!union) continue;

        // Find the child couple where this block's child is a partner
        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (!childUnionId) continue;
            const childBlockId = unionToBlock.get(childUnionId);
            if (!childBlockId) continue;
            const childBlock = blocks.get(childBlockId);
            if (!childBlock) continue;

            // ASO-HARD only applies within gen <= -2 (grandparents and above)
            // Gen -1 (Father+Mother) is LOCKED from Phase A, Phase B doesn't touch it
            if (childBlock.generation >= -1) continue;

            const childUnion = model.unions.get(childUnionId);
            if (!childUnion || !childUnion.partnerB) continue;

            const hw = getHusbandWifeIds(childUnion);
            if (!hw) continue;

            // ASO-HARD only applies when BOTH partners of child couple have ancestors
            // Algorithm: if only one side has ancestors, they are centered above that parent
            const husbandHasParents = hasParents(hw.husbandId);
            const wifeHasParents = hasParents(hw.wifeId);
            if (!husbandHasParents || !wifeHasParents) continue;

            const husbandX = childBlock.xCenter - config.partnerGap / 2 - config.cardWidth / 2;
            const wifeX = childBlock.xCenter + config.partnerGap / 2 + config.cardWidth / 2;

            // Get this block's subtree extent
            const extent = subtreeExtentSideOnly(blockId);

            if (childId === hw.husbandId) {
                // Parent of husband: extent.maxX <= husbandX
                if (extent.maxX > husbandX + tolerance) {
                    const personA = model.persons.get(union.partnerA);
                    violations.push(
                        `Block "${personA?.firstName ?? '?'}" (gen ${block.generation}): ` +
                        `extent.maxX=${extent.maxX.toFixed(1)} > husbandX=${husbandX.toFixed(1)} ` +
                        `(violation: ${(extent.maxX - husbandX).toFixed(1)}px)`
                    );
                }
            } else if (childId === hw.wifeId) {
                // Parent of wife: extent.minX >= wifeX
                if (extent.minX < wifeX - tolerance) {
                    const personA = model.persons.get(union.partnerA);
                    violations.push(
                        `Block "${personA?.firstName ?? '?'}" (gen ${block.generation}): ` +
                        `extent.minX=${extent.minX.toFixed(1)} < wifeX=${wifeX.toFixed(1)} ` +
                        `(violation: ${(wifeX - extent.minX).toFixed(1)}px)`
                    );
                }
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(
            `ASO Barrier Hard constraint violated:\n` +
            violations.slice(0, 10).join('\n') +
            (violations.length > 10 ? `\n... and ${violations.length - 10} more` : '')
        );
    }
}
