/**
 * Step 7: Route Edges (Simple Bus Routing)
 *
 * Creates connection lines (polylines) using bus routing:
 * - Vertical stem from parent union center
 * - Horizontal bus at midpoint between generations
 * - Vertical drops to each child
 *
 * Key simplification: connectorY === branchY always (no staircase).
 * Edge crossings are prevented by Step 6 (no sibling family interleaving).
 *
 * Also creates spouse lines between partners in unions.
 */

import { PersonId, LayoutConfig } from '../../types.js';
import {
    RouteEdgesInput,
    RoutedModel,
    Connection,
    ChildDrop,
    SpouseLine,
    UnionId,
    UnionNode,
    BranchModel
} from './types.js';

/**
 * Route all edges and create connections.
 */
export function routeEdges(input: RouteEdgesInput): RoutedModel {
    const { constrained, config } = input;
    const { placed } = constrained;
    const { measured, unionX, personX } = placed;
    const { genModel } = measured;
    const { model, unionGen, minGen, maxGen } = genModel;

    const connections: Connection[] = [];
    const spouseLines: SpouseLine[] = [];

    // Calculate Y position for each generation
    const rowHeight = config.cardHeight + config.verticalGap;
    const genY = new Map<number, number>();

    for (let gen = minGen; gen <= maxGen; gen++) {
        const row = gen - minGen;
        genY.set(gen, config.padding + row * rowHeight);
    }

    // Build set of secondary chain union IDs (stem from card bottom, not spouse line)
    const secondaryChainUnions = new Set<UnionId>();
    for (const [, chain] of model.partnerChains) {
        const primaryUnionId = model.personToUnion.get(chain.sharedPersonId);
        for (const uid of chain.unionIds) {
            if (uid !== primaryUnionId) {
                secondaryChainUnions.add(uid);
            }
        }
    }

    // Create connections for each union with children
    for (const [unionId, union] of model.unions) {
        if (union.childIds.length === 0) continue;

        const connection = createConnection(
            unionId,
            union,
            model.personToUnion,
            unionGen,
            unionX,
            personX,
            genY,
            config,
            secondaryChainUnions.has(unionId)
        );

        if (connection) {
            connections.push(connection);
        }
    }

    // Create spouse lines
    for (const [unionId, union] of model.unions) {
        if (!union.partnerB) continue;

        const spouseLine = createSpouseLine(
            unionId,
            union,
            personX,
            unionGen,
            genY,
            config
        );

        if (spouseLine) {
            spouseLines.push(spouseLine);
        }
    }

    // Y-offset secondary chain spouse lines (fan-out from shared person)
    const LINE_SPACING = 3;
    for (const [, chain] of model.partnerChains) {
        const primaryUnionId = model.personToUnion.get(chain.sharedPersonId);
        if (!primaryUnionId) continue;

        const sharedPX = personX.get(chain.sharedPersonId);
        if (sharedPX === undefined) continue;
        const sharedCenterX = sharedPX + config.cardWidth / 2;

        // Collect secondary unions sorted by distance from shared person
        const secondaryInfos: { unionId: UnionId; distance: number }[] = [];
        for (const uid of chain.unionIds) {
            if (uid === primaryUnionId) continue;
            const u = model.unions.get(uid);
            if (!u) continue;
            const extraPartner = u.partnerA === chain.sharedPersonId ? u.partnerB : u.partnerA;
            if (!extraPartner) continue;
            const epX = personX.get(extraPartner);
            if (epX === undefined) continue;
            secondaryInfos.push({ unionId: uid, distance: Math.abs(epX + config.cardWidth / 2 - sharedCenterX) });
        }
        secondaryInfos.sort((a, b) => a.distance - b.distance);

        // Apply Y offset: nearest secondary = +LINE_SPACING, next = +2*LINE_SPACING, etc.
        for (let i = 0; i < secondaryInfos.length; i++) {
            const sl = spouseLines.find(s => s.unionId === secondaryInfos[i].unionId);
            if (sl) {
                sl.y += (i + 1) * LINE_SPACING;
            }
        }
    }

    // Resolve bus collisions via lane allocation (branch-aware)
    const branchModel = measured as BranchModel;
    const hasBranches = branchModel.branches && branchModel.branches.size > 0;
    resolveBusCollisions(connections, config, hasBranches ? branchModel : null);

    // NOTE: resolveBusCollisions skips lane offset for connections where
    // offsetting would create a stem-bus crossing (stem at higher lane
    // crossing a bus at lower lane). These connections keep collinear
    // horizontal segments at the same Y, which is acceptable.

    // Resolve elbow clearance violations (nudge drops away from near segments)
    resolveElbowClearance(connections, config);

    return {
        constrained,
        connections,
        spouseLines
    };
}

/**
 * Create a connection from a union to its children.
 * Uses simple bus routing with connectorY === branchY (no staircase).
 */
function createConnection(
    unionId: UnionId,
    union: UnionNode,
    personToUnion: Map<PersonId, UnionId>,
    unionGen: Map<UnionId, number>,
    unionX: Map<UnionId, number>,
    personX: Map<PersonId, number>,
    genY: Map<number, number>,
    config: { cardWidth: number; cardHeight: number; verticalGap: number },
    isSecondaryChain: boolean = false
): Connection | null {
    const parentCenterX = unionX.get(unionId);
    const parentGen = unionGen.get(unionId);

    if (parentCenterX === undefined || parentGen === undefined) {
        return null;
    }

    const parentY = genY.get(parentGen);
    if (parentY === undefined) {
        return null;
    }

    // Get child unions that are at higher generation (descendants)
    const childUnionIds = new Set<UnionId>();
    for (const childId of union.childIds) {
        const childUnionId = personToUnion.get(childId);
        if (childUnionId) {
            const childGen = unionGen.get(childUnionId);
            if (childGen !== undefined && childGen > parentGen) {
                childUnionIds.add(childUnionId);
            }
        }
    }

    if (childUnionIds.size === 0) {
        return null;
    }

    // Stem position (center of parent union, or extra partner center for secondary chains)
    const stemX = parentCenterX;
    // Secondary chain unions: stem from card bottom (like MyHeritage)
    // Standard two-partner unions: stem from spouse line level
    // Single-parent unions: stem from card bottom
    const stemTopY = isSecondaryChain
        ? parentY + config.cardHeight
        : union.partnerB
            ? parentY + config.cardHeight / 2
            : parentY + config.cardHeight;

    // Child Y (next generation down)
    const childGen = parentGen + 1;
    const childY = genY.get(childGen);
    if (childY === undefined) {
        return null;
    }

    // Bus Y is midpoint between parent card bottom and child card top
    const parentBottomY = parentY + config.cardHeight;
    const branchY = (parentBottomY + childY) / 2;

    // Create drops for each child
    const drops: ChildDrop[] = [];

    for (const childId of union.childIds) {
        const childUnionId = personToUnion.get(childId);
        if (!childUnionId || !childUnionIds.has(childUnionId)) continue;

        const childX = personX.get(childId);
        if (childX === undefined) continue;

        const dropX = childX + config.cardWidth / 2;

        drops.push({
            personId: childId,
            x: dropX,
            topY: branchY,
            bottomY: childY
        });
    }

    if (drops.length === 0) {
        return null;
    }

    // Bus extends from leftmost to rightmost child drop
    const branchLeftX = Math.min(...drops.map(d => d.x));
    const branchRightX = Math.max(...drops.map(d => d.x));

    // Connector: horizontal from stem to bus edge (SAME Y as bus!)
    let connectorFromX = stemX;
    let connectorToX = stemX;

    if (stemX < branchLeftX) {
        connectorToX = branchLeftX;
    } else if (stemX > branchRightX) {
        connectorToX = branchRightX;
    }

    return {
        unionId,
        stemX,
        stemTopY,
        stemBottomY: branchY,   // Stem goes directly to bus Y
        branchY,
        branchLeftX,
        branchRightX,
        connectorFromX,
        connectorToX,
        connectorY: branchY,    // SAME as branchY - no staircase
        drops
    };
}

/**
 * Create a spouse line between partners in a union.
 */
function createSpouseLine(
    unionId: UnionId,
    union: UnionNode,
    personX: Map<PersonId, number>,
    unionGen: Map<UnionId, number>,
    genY: Map<number, number>,
    config: { cardWidth: number; cardHeight: number }
): SpouseLine | null {
    if (!union.partnerB) {
        return null;
    }

    const xA = personX.get(union.partnerA);
    const xB = personX.get(union.partnerB);
    const gen = unionGen.get(unionId);

    if (xA === undefined || xB === undefined || gen === undefined) {
        return null;
    }

    const y = genY.get(gen);
    if (y === undefined) {
        return null;
    }

    const lineY = y + config.cardHeight / 2;
    // Use min/max to handle either partner ordering (chain blocks may reverse visual order)
    const leftX = Math.min(xA, xB);
    const rightX = Math.max(xA, xB);
    const xMin = leftX + config.cardWidth;
    const xMax = rightX;

    return {
        unionId,
        person1Id: union.partnerA,
        person2Id: union.partnerB,
        partnershipId: union.partnershipId,
        y: lineY,
        xMin,
        xMax
    };
}

// ==================== BUS COLLISION RESOLUTION ====================

/**
 * Resolve bus collisions via lane allocation.
 * When two buses are at the same Y level with overlapping X intervals,
 * offset the colliding bus to a different lane (small vertical offset).
 *
 * Checks ALL buses at the same Y level regardless of branch membership.
 * Branch corridors may not fully contain their buses (e.g., families with
 * widely-spread children), so cross-branch collision detection is needed.
 */
function resolveBusCollisions(
    connections: Connection[],
    config: { verticalGap: number },
    _branchModel: BranchModel | null
): void {
    if (connections.length < 2) return;

    const LANE_OFFSET = Math.min(8, config.verticalGap * 0.1);

    // Group connections by branchY only (check all buses at same Y)
    const byGroup = new Map<string, Connection[]>();
    for (const conn of connections) {
        const key = `${Math.round(conn.branchY)}`;
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key)!.push(conn);
    }

    for (const [, group] of byGroup) {
        if (group.length < 2) continue;

        // Sort by full left extent (including connector) for deterministic sweep
        group.sort((a, b) => Math.min(a.stemX, a.branchLeftX) - Math.min(b.stemX, b.branchLeftX));

        // Track which lane each connection is assigned to
        const lanes: Array<{ conn: Connection; lane: number }> = [
            { conn: group[0], lane: 0 }
        ];

        for (let i = 1; i < group.length; i++) {
            const curr = group[i];
            let assignedLane = 0;
            let collides = true;

            // Full horizontal footprint includes connector (stem to bus edge)
            const currLeft = Math.min(curr.stemX, curr.branchLeftX);
            const currRight = Math.max(curr.stemX, curr.branchRightX);

            // Find the lowest lane where this connection doesn't collide
            while (collides) {
                collides = false;
                for (const prev of lanes) {
                    if (prev.lane !== assignedLane) continue;
                    // Check full footprint overlap (bus + connector)
                    const prevLeft = Math.min(prev.conn.stemX, prev.conn.branchLeftX);
                    const prevRight = Math.max(prev.conn.stemX, prev.conn.branchRightX);
                    if (currLeft <= prevRight && currRight >= prevLeft) {
                        collides = true;
                        assignedLane++;
                        break;
                    }
                }
            }

            // Before applying offset, check if it would create crossings:
            // 1. curr's stem crossing a lane-0 bus
            // 2. A lane-0 drop crossing curr's offset bus
            // Both happen when ancestor connections share children in the same block.
            // Keep both at lane 0 and accept collinear horizontal overlap.
            if (assignedLane > 0) {
                let wouldCross = false;
                for (const prev of lanes) {
                    if (prev.lane !== 0) continue;
                    // Check 1: curr's stem inside prev's bus footprint
                    const prevLeft = Math.min(prev.conn.stemX, prev.conn.branchLeftX);
                    const prevRight = Math.max(prev.conn.stemX, prev.conn.branchRightX);
                    if (curr.stemX > prevLeft && curr.stemX < prevRight) {
                        wouldCross = true;
                        break;
                    }
                    // Check 2: prev's drops inside curr's bus range
                    for (const drop of prev.conn.drops) {
                        if (drop.x > currLeft && drop.x < currRight) {
                            wouldCross = true;
                            break;
                        }
                    }
                    if (wouldCross) break;
                }
                if (wouldCross) {
                    assignedLane = 0;
                }
            }

            lanes.push({ conn: curr, lane: assignedLane });

            if (assignedLane > 0) {
                const offset = assignedLane * LANE_OFFSET;
                curr.branchY += offset;
                curr.connectorY += offset;
                curr.stemBottomY += offset;
                for (const drop of curr.drops) {
                    drop.topY += offset;
                }
            }
        }
    }
}

/**
 * Detect bus collisions at the same Y level.
 * Returns pairs of connections whose buses overlap on X at the same Y.
 */
export function detectBusCollisions(
    connections: Connection[]
): Array<{ unionId1: UnionId; unionId2: UnionId; y: number; overlapX: [number, number] }> {
    const collisions: Array<{ unionId1: UnionId; unionId2: UnionId; y: number; overlapX: [number, number] }> = [];

    for (let i = 0; i < connections.length; i++) {
        for (let j = i + 1; j < connections.length; j++) {
            const a = connections[i];
            const b = connections[j];

            // Same Y level (within rounding tolerance)
            if (Math.abs(a.branchY - b.branchY) > 1) continue;

            // Check full footprint overlap (bus + connector)
            const aLeft = Math.min(a.stemX, a.branchLeftX);
            const aRight = Math.max(a.stemX, a.branchRightX);
            const bLeft = Math.min(b.stemX, b.branchLeftX);
            const bRight = Math.max(b.stemX, b.branchRightX);

            const overlapLeft = Math.max(aLeft, bLeft);
            const overlapRight = Math.min(aRight, bRight);

            if (overlapLeft < overlapRight) {
                collisions.push({
                    unionId1: a.unionId,
                    unionId2: b.unionId,
                    y: a.branchY,
                    overlapX: [overlapLeft, overlapRight]
                });
            }
        }
    }

    return collisions;
}

// ==================== ELBOW CLEARANCE RESOLUTION ====================

/**
 * An elbow point: where a vertical segment meets a horizontal segment in a connection.
 */
interface ElbowPoint {
    x: number;
    y: number;
    connectionIdx: number;
    type: 'stem-to-bus' | 'bus-to-drop';
}

/**
 * Extract all elbow points from connections.
 * Elbow = any point where a vertical segment meets a horizontal segment:
 * - Stem bottom (stemX, stemBottomY) — stem meets bus/connector
 * - Each drop top (drop.x, drop.topY) — drop meets bus
 */
function extractElbowPoints(connections: Connection[]): ElbowPoint[] {
    const elbows: ElbowPoint[] = [];

    for (let i = 0; i < connections.length; i++) {
        const conn = connections[i];

        // Stem-to-bus elbow (stem bottom meets the bus)
        elbows.push({
            x: conn.stemX,
            y: conn.stemBottomY,
            connectionIdx: i,
            type: 'stem-to-bus'
        });

        // Bus-to-drop elbows (each drop top meets bus)
        for (const drop of conn.drops) {
            elbows.push({
                x: drop.x,
                y: drop.topY,
                connectionIdx: i,
                type: 'bus-to-drop'
            });
        }
    }

    return elbows;
}

/**
 * A clearance violation between an elbow and a near vertical segment.
 */
interface ClearanceViolation {
    elbowIdx: number;
    nearConnectionIdx: number;
    nearSegmentType: 'stem' | 'drop' | 'bus-endpoint';
    distance: number;
    requiredShift: number;
    shiftDirection: number; // +1 or -1
}

/**
 * Detect clearance violations between elbow points and vertical segments
 * of other connections at the same Y range.
 */
function detectClearanceViolations(
    connections: Connection[],
    elbows: ElbowPoint[],
    minClearance: number
): ClearanceViolation[] {
    const violations: ClearanceViolation[] = [];

    for (let ei = 0; ei < elbows.length; ei++) {
        const elbow = elbows[ei];

        for (let ci = 0; ci < connections.length; ci++) {
            if (ci === elbow.connectionIdx) continue;

            const conn = connections[ci];

            // Check stem of other connection
            if (yRangesOverlap(conn.stemTopY, conn.stemBottomY, elbow.y)) {
                const dist = Math.abs(elbow.x - conn.stemX);
                if (dist < minClearance) {
                    violations.push({
                        elbowIdx: ei,
                        nearConnectionIdx: ci,
                        nearSegmentType: 'stem',
                        distance: dist,
                        requiredShift: minClearance - dist,
                        shiftDirection: elbow.x > conn.stemX ? 1 : -1
                    });
                }
            }

            // Check drops of other connection
            for (const drop of conn.drops) {
                if (yRangesOverlap(drop.topY, drop.bottomY, elbow.y)) {
                    const dist = Math.abs(elbow.x - drop.x);
                    if (dist < minClearance) {
                        violations.push({
                            elbowIdx: ei,
                            nearConnectionIdx: ci,
                            nearSegmentType: 'drop',
                            distance: dist,
                            requiredShift: minClearance - dist,
                            shiftDirection: elbow.x > drop.x ? 1 : -1
                        });
                    }
                }
            }

            // Check bus endpoints of other connection at same Y
            if (Math.abs(conn.branchY - elbow.y) < 1) {
                // Left endpoint
                const distLeft = Math.abs(elbow.x - conn.branchLeftX);
                if (distLeft < minClearance && distLeft > 0.5) {
                    violations.push({
                        elbowIdx: ei,
                        nearConnectionIdx: ci,
                        nearSegmentType: 'bus-endpoint',
                        distance: distLeft,
                        requiredShift: minClearance - distLeft,
                        shiftDirection: elbow.x > conn.branchLeftX ? 1 : -1
                    });
                }
                // Right endpoint
                const distRight = Math.abs(elbow.x - conn.branchRightX);
                if (distRight < minClearance && distRight > 0.5) {
                    violations.push({
                        elbowIdx: ei,
                        nearConnectionIdx: ci,
                        nearSegmentType: 'bus-endpoint',
                        distance: distRight,
                        requiredShift: minClearance - distRight,
                        shiftDirection: elbow.x > conn.branchRightX ? 1 : -1
                    });
                }
            }
        }
    }

    return violations;
}

/**
 * Check if a Y value falls within a vertical segment's Y range.
 */
function yRangesOverlap(segTopY: number, segBottomY: number, elbowY: number): boolean {
    const minY = Math.min(segTopY, segBottomY);
    const maxY = Math.max(segTopY, segBottomY);
    return elbowY >= minY - 1 && elbowY <= maxY + 1;
}

/**
 * Resolve elbow clearance violations by nudging drop X positions.
 * Only drops are nudged (not stems, which are tied to card centers).
 * Max nudge is capped at minEdgeClearance px to avoid excessive drift.
 */
function resolveElbowClearance(
    connections: Connection[],
    config: LayoutConfig
): void {
    const MAX_ITERATIONS = 5;
    const minClearance = config.minEdgeClearance;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const elbows = extractElbowPoints(connections);
        const violations = detectClearanceViolations(connections, elbows, minClearance);

        if (violations.length === 0) break;

        let anyNudged = false;

        for (const violation of violations) {
            const elbow = elbows[violation.elbowIdx];

            // Only nudge drops (bus-to-drop elbows), not stems
            if (elbow.type !== 'bus-to-drop') continue;

            const conn = connections[elbow.connectionIdx];

            // Find the drop that matches this elbow
            const drop = conn.drops.find(d =>
                Math.abs(d.x - elbow.x) < 0.5 && Math.abs(d.topY - elbow.y) < 0.5
            );
            if (!drop) continue;

            // Cap nudge at minEdgeClearance
            const nudge = Math.min(violation.requiredShift, minClearance) * violation.shiftDirection;
            drop.x += nudge;

            // Update bus extents if the drop moved beyond current range
            conn.branchLeftX = Math.min(...conn.drops.map(d => d.x));
            conn.branchRightX = Math.max(...conn.drops.map(d => d.x));

            // Update connector if stem is outside bus range
            if (conn.stemX < conn.branchLeftX) {
                conn.connectorToX = conn.branchLeftX;
            } else if (conn.stemX > conn.branchRightX) {
                conn.connectorToX = conn.branchRightX;
            } else {
                conn.connectorToX = conn.stemX;
            }

            anyNudged = true;
        }

        if (!anyNudged) break;
    }
}

// ==================== STAIRCASE EDGE DETECTION ====================

/**
 * Staircase violation information.
 */
export interface StaircaseViolation {
    unionId: UnionId;
    horizontalSegmentCount: number;
    description: string;
}

/**
 * Detect staircase edges in the connections.
 * A staircase edge has connectorY !== branchY.
 */
export function detectStaircaseEdges(connections: Connection[]): StaircaseViolation[] {
    const violations: StaircaseViolation[] = [];

    for (const conn of connections) {
        const yLevels = new Set<number>();
        yLevels.add(Math.round(conn.branchY));

        const hasConnector = Math.abs(conn.connectorFromX - conn.connectorToX) > 0.5;
        if (hasConnector) {
            yLevels.add(Math.round(conn.connectorY));
        }

        if (yLevels.size > 1) {
            violations.push({
                unionId: conn.unionId,
                horizontalSegmentCount: yLevels.size,
                description: `Connection from union ${conn.unionId} has ${yLevels.size} horizontal segments at different Y levels. ` +
                    `connectorY=${conn.connectorY.toFixed(1)}, branchY=${conn.branchY.toFixed(1)}`
            });
        }
    }

    return violations;
}

/**
 * Check if any connections have staircase patterns.
 */
export function validateNoStaircaseEdges(connections: Connection[]): boolean {
    const violations = detectStaircaseEdges(connections);
    return violations.length === 0;
}
