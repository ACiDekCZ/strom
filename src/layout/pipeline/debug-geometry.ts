/**
 * Debug Geometry Computation
 *
 * Computes geometric primitives for the debug overlay visualization.
 */

import { LayoutConfig } from '../../types.js';
import {
    DebugSnapshot,
    DebugGeometry,
    DebugRect,
    DebugSiblingSpan,
    DebugBusLine,
    DebugAnchorPoint,
    DebugGenerationBand,
    DebugBranchEnvelope,
    DebugSiblingFamilyCluster
} from './debug-types.js';
import { BranchModel, FamilyBlockModel, FamilyBlock, FamilyBlockId, UnionId } from './types.js';
import { PersonId } from '../../types.js';

/**
 * Compute all debug geometry for a snapshot.
 */
export function computeDebugGeometry(
    snapshot: DebugSnapshot,
    config: LayoutConfig
): DebugGeometry {
    // Geometry only available from step 5 onwards
    if (snapshot.step < 5 || !snapshot.placed || !snapshot.genModel) {
        return {
            personBoxes: [],
            unionBoxes: [],
            siblingSpans: [],
            busLines: [],
            anchorPoints: [],
            generationBands: [],
            branchEnvelopes: [],
            siblingFamilyClusters: []
        };
    }

    const { placed, genModel } = snapshot;
    const { personX, unionX } = placed;
    const { model, unionGen, minGen, maxGen, personGen } = genModel;

    // Compute normalization shift (same as 8-emit-result.ts normalizePositions)
    // This shifts all X so that minX = padding
    let rawMinX = Infinity;
    for (const x of personX.values()) {
        rawMinX = Math.min(rawMinX, x);
    }
    const normShift = isFinite(rawMinX) ? config.padding - rawMinX : 0;

    // Create normalized personX and unionX maps
    const normalizedPersonX = new Map<PersonId, number>();
    for (const [pid, x] of personX) {
        normalizedPersonX.set(pid, x + normShift);
    }
    const normalizedUnionX = new Map<UnionId, number>();
    for (const [uid, x] of unionX) {
        normalizedUnionX.set(uid, x + normShift);
    }

    // Compute Y for each generation
    const rowHeight = config.cardHeight + config.verticalGap;
    const genY = new Map<number, number>();
    for (let gen = minGen; gen <= maxGen; gen++) {
        const row = gen - minGen;
        genY.set(gen, config.padding + row * rowHeight);
    }

    // Person boxes (use normalized X)
    const personBoxes: DebugRect[] = [];
    for (const [personId, x] of normalizedPersonX) {
        const gen = personGen.get(personId);
        if (gen === undefined) continue;
        const y = genY.get(gen);
        if (y === undefined) continue;

        const person = model.persons.get(personId);
        personBoxes.push({
            id: personId,
            x,
            y,
            width: config.cardWidth,
            height: config.cardHeight,
            label: person ? `${person.firstName} ${person.lastName}`.trim() : personId
        });
    }

    // Union boxes (spanning both partners)
    const unionBoxes: DebugRect[] = [];
    for (const [unionId, union] of model.unions) {
        const gen = unionGen.get(unionId);
        if (gen === undefined) continue;
        const y = genY.get(gen);
        if (y === undefined) continue;

        const xA = normalizedPersonX.get(union.partnerA);
        if (xA === undefined) continue;

        let boxX = xA;
        let boxWidth = config.cardWidth;

        if (union.partnerB) {
            const xB = normalizedPersonX.get(union.partnerB);
            if (xB !== undefined) {
                boxX = Math.min(xA, xB);
                boxWidth = Math.max(xA, xB) + config.cardWidth - boxX;
            }
        }

        unionBoxes.push({
            id: unionId,
            x: boxX - 2,
            y: y - 2,
            width: boxWidth + 4,
            height: config.cardHeight + 4
        });
    }

    // Sibling spans
    const siblingSpans: DebugSiblingSpan[] = [];
    for (const [unionId, union] of model.unions) {
        if (union.childIds.length === 0) continue;

        const gen = unionGen.get(unionId);
        if (gen === undefined) continue;
        const childGen = gen + 1;
        const childY = genY.get(childGen);
        if (childY === undefined) continue;

        let minX = Infinity;
        let maxX = -Infinity;

        for (const childId of union.childIds) {
            const x = normalizedPersonX.get(childId);
            if (x !== undefined) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x + config.cardWidth);
            }
        }

        if (minX < Infinity) {
            siblingSpans.push({
                unionId,
                x1: minX,
                x2: maxX,
                y: childY + config.cardHeight + 5
            });
        }
    }

    // Bus lines (from routed model if available)
    const busLines: DebugBusLine[] = [];
    if (snapshot.routed) {
        for (const conn of snapshot.routed.connections) {
            busLines.push({
                unionId: conn.unionId,
                y: conn.branchY,
                x1: conn.branchLeftX,
                x2: conn.branchRightX
            });
        }
    }

    // Anchor points
    const anchorPoints: DebugAnchorPoint[] = [];

    // Person anchor points (center of each card)
    for (const [personId, x] of normalizedPersonX) {
        const gen = personGen.get(personId);
        if (gen === undefined) continue;
        const y = genY.get(gen);
        if (y === undefined) continue;

        anchorPoints.push({
            id: `p_${personId}`,
            x: x + config.cardWidth / 2,
            y: y + config.cardHeight / 2,
            type: 'person'
        });
    }

    // Union anchor points (center between partners or single person center)
    for (const [unionId, centerX] of normalizedUnionX) {
        const gen = unionGen.get(unionId);
        if (gen === undefined) continue;
        const y = genY.get(gen);
        if (y === undefined) continue;

        anchorPoints.push({
            id: `u_${unionId}`,
            x: centerX,
            y: y + config.cardHeight,
            type: 'union'
        });
    }

    // Bus junction points (where stems meet buses)
    if (snapshot.routed) {
        for (const conn of snapshot.routed.connections) {
            anchorPoints.push({
                id: `bus_${conn.unionId}`,
                x: conn.stemX,
                y: conn.branchY,
                type: 'bus'
            });
        }
    }

    // Generation bands
    const generationBands: DebugGenerationBand[] = [];
    for (let gen = minGen; gen <= maxGen; gen++) {
        const y = genY.get(gen);
        if (y === undefined) continue;

        generationBands.push({
            gen,
            y: y - 10,
            height: config.cardHeight + 20
        });
    }

    // Branch envelopes
    const branchEnvelopes: DebugBranchEnvelope[] = [];
    if (snapshot.measured) {
        const bm = snapshot.measured as BranchModel;
        if (bm.branches && bm.branches.size > 0) {
            // Compute Y extent per branch
            for (const branch of bm.branches.values()) {
                let minBranchY = Infinity;
                let maxBranchY = -Infinity;

                for (const blockId of branch.blockIds) {
                    const block = (snapshot.measured as FamilyBlockModel).blocks.get(blockId);
                    if (!block) continue;
                    const blockY = genY.get(block.generation);
                    if (blockY === undefined) continue;
                    minBranchY = Math.min(minBranchY, blockY);
                    maxBranchY = Math.max(maxBranchY, blockY + config.cardHeight);
                }

                if (!isFinite(minBranchY)) continue;

                // Golden angle HSL rotation for color
                const hue = (branch.siblingIndex * 137.508) % 360;
                const color = `hsla(${hue}, 70%, 50%, 0.15)`;

                const person = model.persons.get(branch.childPersonId);
                const label = person
                    ? `${person.firstName} ${person.lastName} [${branch.siblingIndex}]`
                    : `Branch ${branch.siblingIndex}`;

                branchEnvelopes.push({
                    branchId: branch.id,
                    minX: branch.minX,
                    maxX: branch.maxX,
                    minY: minBranchY - 5,
                    maxY: maxBranchY + 5,
                    label,
                    siblingIndex: branch.siblingIndex,
                    color
                });
            }
        }
    }

    // Sibling family clusters (gen -1 sibling families)
    const siblingFamilyClusters: DebugSiblingFamilyCluster[] = [];
    if (snapshot.constrained && snapshot.measured) {
        const fbm = snapshot.measured as FamilyBlockModel;
        if (fbm.blocks && fbm.unionToBlock) {
            // Find focus person's grandparent union to get sibling families
            const focusPersonId = findFocusPerson(model, personGen);
            if (focusPersonId) {
                const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
                if (focusParentUnionId) {
                    const focusParentUnion = model.unions.get(focusParentUnionId);
                    if (focusParentUnion) {
                        // Process both sides of the family
                        const parents = [focusParentUnion.partnerA];
                        if (focusParentUnion.partnerB) parents.push(focusParentUnion.partnerB);

                        let colorIndex = 0;
                        const seenBlockIds = new Set<FamilyBlockId>();

                        for (const parent of parents) {
                            const grandparentUnionId = model.childToParentUnion.get(parent);
                            if (!grandparentUnionId) continue;
                            const grandparentUnion = model.unions.get(grandparentUnionId);
                            if (!grandparentUnion) continue;

                            // Collect sibling family clusters
                            for (const siblingId of grandparentUnion.childIds) {
                                const sibUnionId = model.personToUnion.get(siblingId);
                                if (!sibUnionId) continue;
                                const blockId = fbm.unionToBlock.get(sibUnionId);
                                if (!blockId) continue;

                                // Deduplicate: don't create multiple clusters for same block
                                if (seenBlockIds.has(blockId)) continue;
                                seenBlockIds.add(blockId);

                                const block = fbm.blocks.get(blockId);
                                if (!block || block.generation !== -1) continue;

                                // Compute cluster extents using actual placed positions
                                const extents = computeClusterExtents(
                                    blockId, fbm.blocks, model, config, genY, normalizedPersonX, normShift
                                );

                                // Use both partner names for label
                                const union = model.unions.get(block.rootUnionId);
                                let label = '?';
                                if (union) {
                                    const p1 = model.persons.get(union.partnerA);
                                    const p2 = union.partnerB ? model.persons.get(union.partnerB) : null;
                                    label = p1?.firstName ?? '?';
                                    if (p2) label += ' & ' + p2.firstName;
                                }

                                const hue = (colorIndex * 137.508) % 360;
                                colorIndex++;

                                siblingFamilyClusters.push({
                                    personId: siblingId,
                                    label,
                                    cardMinX: extents.cardMinX,
                                    cardMaxX: extents.cardMaxX,
                                    blockMinX: extents.blockMinX,
                                    blockMaxX: extents.blockMaxX,
                                    minY: extents.minY,
                                    maxY: extents.maxY,
                                    color: `hsla(${hue}, 70%, 50%, 0.2)`
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    return {
        personBoxes,
        unionBoxes,
        siblingSpans,
        busLines,
        anchorPoints,
        generationBands,
        branchEnvelopes,
        siblingFamilyClusters
    };
}

/**
 * Find the focus person (gen 0 with most connections or first gen 0).
 */
function findFocusPerson(
    model: { persons: Map<PersonId, unknown> },
    personGen: Map<PersonId, number>
): PersonId | null {
    for (const [pid, gen] of personGen) {
        if (gen === 0) return pid;
    }
    return null;
}

/**
 * Compute card and block extents for a family cluster.
 * Uses actual placed positions from personX for accurate card extents.
 */
function computeClusterExtents(
    rootBlockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: { unions: Map<string, { partnerA: PersonId; partnerB: PersonId | null; childIds: PersonId[] }> },
    config: { cardWidth: number; partnerGap: number; cardHeight: number },
    genY: Map<number, number>,
    normalizedPersonX: Map<PersonId, number>,
    normShift: number
): {
    cardMinX: number; cardMaxX: number;
    blockMinX: number; blockMaxX: number;
    minY: number; maxY: number;
} {
    const rootBlock = blocks.get(rootBlockId);
    if (!rootBlock) {
        return { cardMinX: 0, cardMaxX: 0, blockMinX: 0, blockMaxX: 0, minY: 0, maxY: 0 };
    }

    let cardMinX = Infinity, cardMaxX = -Infinity;
    let blockMinX = Infinity, blockMaxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    const stack = [rootBlockId];
    const visited = new Set<FamilyBlockId>();

    while (stack.length > 0) {
        const blockId = stack.pop()!;
        if (visited.has(blockId)) continue;
        visited.add(blockId);

        const block = blocks.get(blockId);
        if (!block) continue;

        // Block extent (from measured model, need to apply normShift)
        blockMinX = Math.min(blockMinX, block.xLeft + normShift);
        blockMaxX = Math.max(blockMaxX, block.xRight + normShift);

        // Card extent - use actual placed positions (already normalized)
        const union = model.unions.get(block.rootUnionId);
        if (union) {
            // Get actual placed positions for partners
            const xA = normalizedPersonX.get(union.partnerA);
            if (xA !== undefined) {
                cardMinX = Math.min(cardMinX, xA);
                cardMaxX = Math.max(cardMaxX, xA + config.cardWidth);
            }
            if (union.partnerB) {
                const xB = normalizedPersonX.get(union.partnerB);
                if (xB !== undefined) {
                    cardMinX = Math.min(cardMinX, xB);
                    cardMaxX = Math.max(cardMaxX, xB + config.cardWidth);
                }
            }
            // Also include children (they may not have their own blocks if they're leaf persons)
            for (const childId of union.childIds) {
                const xChild = normalizedPersonX.get(childId);
                if (xChild !== undefined) {
                    cardMinX = Math.min(cardMinX, xChild);
                    cardMaxX = Math.max(cardMaxX, xChild + config.cardWidth);
                }
            }
        }

        // Y extent
        const y = genY.get(block.generation);
        if (y !== undefined) {
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y + config.cardHeight);
        }

        // Recurse to children
        for (const childId of block.childBlockIds) {
            stack.push(childId);
        }
    }

    return { cardMinX, cardMaxX, blockMinX, blockMaxX, minY, maxY };
}
