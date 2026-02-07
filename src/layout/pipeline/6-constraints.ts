/**
 * Step 6: Apply Constraints (2-Phase Pipeline A/B)
 *
 * Uses a polarity-aware approach with no backtracking:
 * - Phase A: Focus parents + descendants (gen >= -1) — overlap + recentering + SFNI
 * - Phase B: Extended ancestors only (gen <= -2) — FSPC barriers + ASO + compaction
 *
 * Critical invariant: Phase B NEVER touches gen >= -1 (parents of focus + focus + descendants)
 */

import { PersonId, LayoutConfig } from '../../types.js';
import {
    ConstraintsInput,
    ConstrainedModel,
    UnionId,
    UnionNode,
    FamilyBlock,
    FamilyBlockId,
    FamilyBlockModel,
    BranchModel,
    SiblingFamilyBranch,
    LayoutModel,
    GenerationalModel
} from './types.js';

/**
 * Find the "extra partner" in a secondary chain union.
 * In a merged chain, the extra partner is the person NOT in the primary couple.
 */
function findChainExtraPartner(
    union: UnionNode,
    chainInfo: NonNullable<FamilyBlock['chainInfo']>,
    model: LayoutModel
): PersonId | null {
    const primaryUnionId = model.personToUnion.get(chainInfo.chainPersonId);
    const primaryUnion = primaryUnionId ? model.unions.get(primaryUnionId) : null;
    const primaryCoupleIds = new Set<PersonId>();
    primaryCoupleIds.add(chainInfo.chainPersonId);
    if (primaryUnion?.partnerA) primaryCoupleIds.add(primaryUnion.partnerA);
    if (primaryUnion?.partnerB) primaryCoupleIds.add(primaryUnion.partnerB);

    if (!primaryCoupleIds.has(union.partnerA)) return union.partnerA;
    if (union.partnerB && !primaryCoupleIds.has(union.partnerB)) return union.partnerB;
    return null;
}

// ==================== PHASE B INDEPENDENT ANCESTOR TREE ====================

/**
 * AncestorNode - node in independent ancestor tree structure.
 *
 * This is used only during Phase B computation. Each node represents
 * a couple (or single person) in the ancestor tree.
 *
 * Key properties:
 * - Tree is built INDEPENDENTLY for H-side and W-side
 * - Each tree is COMPACT (minimum width)
 * - For each couple: H-ancestors go left, W-ancestors go right
 */
interface AncestorNode {
    /** The husband (left partner) in this couple */
    husbandId: PersonId;
    /** The wife (right partner), or null if single parent */
    wifeId: PersonId | null;
    /** UnionId for this couple (used to update FamilyBlocks) */
    unionId: UnionId;
    /** Generation (negative, e.g., -2 for grandparents) */
    generation: number;
    /** H-side subtree (ancestors of husband) */
    hSubtree: AncestorNode | null;
    /** W-side subtree (ancestors of wife) */
    wSubtree: AncestorNode | null;

    // Layout computed values:
    /** Width of this subtree (computed bottom-up) */
    width: number;
    /** Width of just the couple cards */
    coupleWidth: number;
    /** Center X position (computed top-down) */
    xCenter: number;
}

// ==================== BLOCK CARD EXTENT HELPER ====================

/**
 * Get the visual card extent (left, right) of a block.
 * Handles chain blocks (wider coupleWidth) correctly.
 */
function getBlockCardExtent(
    block: FamilyBlock,
    model: LayoutModel,
    config: LayoutConfig
): { left: number; right: number } {
    if (block.chainInfo) {
        // Chain block: use actual coupleWidth
        return {
            left: block.xCenter - block.coupleWidth / 2,
            right: block.xCenter + block.coupleWidth / 2
        };
    }
    const union = model.unions.get(block.rootUnionId);
    if (union?.partnerB) {
        return {
            left: block.xCenter - config.partnerGap / 2 - config.cardWidth,
            right: block.xCenter + config.partnerGap / 2 + config.cardWidth
        };
    }
    return {
        left: block.xCenter - config.cardWidth / 2,
        right: block.xCenter + config.cardWidth / 2
    };
}

// ==================== LOCKED POSITIONS ====================

/**
 * LockedPositions - snapshot of gen>=-1 positions after Phase A.
 * Used to verify Phase B doesn't modify focus parents (gen -1) or descendant positions (gen >= 0).
 */
interface LockedPositions {
    personX: Map<PersonId, number>;
    unionX: Map<UnionId, number>;
}

/**
 * Capture positions of all gen>=-1 persons and unions.
 * Phase B only operates on gen -2 and beyond, so gen -1 and gen >= 0 are locked.
 */
function captureLockedPositions(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    genModel: GenerationalModel,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): LockedPositions {
    const locked: LockedPositions = {
        personX: new Map(),
        unionX: new Map()
    };

    // Capture union positions from blocks (gen >= -1)
    for (const [_blockId, block] of blocks) {
        const gen = genModel.unionGen.get(block.rootUnionId);
        if (gen !== undefined && gen >= -1) {
            locked.unionX.set(block.rootUnionId, block.xCenter);
        }
    }

    // Capture person positions computed from blocks (gen >= -1)
    for (const [pid, gen] of genModel.personGen) {
        if (gen >= -1) {
            // Find the person's position from their union's block
            const uid = model.personToUnion.get(pid);
            if (uid) {
                const blockId = unionToBlock.get(uid);
                if (blockId) {
                    const block = blocks.get(blockId);
                    if (block) {
                        if (block.chainInfo && block.chainInfo.personPositions.has(pid)) {
                            const centerX = block.chainInfo.personPositions.get(pid)!;
                            locked.personX.set(pid, centerX - config.cardWidth / 2);
                        } else {
                            const union = model.unions.get(uid);
                            if (union) {
                                let personX: number;
                                if (union.partnerB === null) {
                                    personX = block.xCenter - config.cardWidth / 2;
                                } else if (pid === union.partnerA) {
                                    personX = block.xCenter - config.partnerGap / 2 - config.cardWidth;
                                } else {
                                    personX = block.xCenter + config.partnerGap / 2;
                                }
                                locked.personX.set(pid, personX);
                            }
                        }
                    }
                }
            }
        }
    }

    return locked;
}

/**
 * Assert that gen>=-1 positions haven't changed from locked snapshot.
 * Throws error with details if any position moved beyond tolerance.
 */
function assertLockedDescendantsUnchanged(
    locked: LockedPositions,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    _genModel: GenerationalModel,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    tolerance = 0.5
): void {
    const violations: string[] = [];

    // Check union positions
    for (const [uid, oldX] of locked.unionX) {
        const blockId = unionToBlock.get(uid);
        if (blockId) {
            const block = blocks.get(blockId);
            if (block) {
                const newX = block.xCenter;
                const delta = Math.abs(newX - oldX);
                if (delta > tolerance) {
                    violations.push(
                        `Union ${uid}: moved from ${oldX.toFixed(1)} to ${newX.toFixed(1)} (Δ=${delta.toFixed(1)})`
                    );
                }
            }
        }
    }

    // Check person positions
    for (const [pid, oldX] of locked.personX) {
        const uid = model.personToUnion.get(pid);
        if (uid) {
            const blockId = unionToBlock.get(uid);
            if (blockId) {
                const block = blocks.get(blockId);
                if (block) {
                    let newX: number | undefined;
                    if (block.chainInfo && block.chainInfo.personPositions.has(pid)) {
                        newX = block.chainInfo.personPositions.get(pid)! - config.cardWidth / 2;
                    } else {
                        const union = model.unions.get(uid);
                        if (union) {
                            if (union.partnerB === null) {
                                newX = block.xCenter - config.cardWidth / 2;
                            } else if (pid === union.partnerA) {
                                newX = block.xCenter - config.partnerGap / 2 - config.cardWidth;
                            } else {
                                newX = block.xCenter + config.partnerGap / 2;
                            }
                        }
                    }
                    if (newX !== undefined) {
                        const delta = Math.abs(newX - oldX);
                        if (delta > tolerance) {
                            violations.push(
                                `Person ${pid}: moved from ${oldX.toFixed(1)} to ${newX.toFixed(1)} (Δ=${delta.toFixed(1)})`
                            );
                        }
                    }
                }
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

// Hard runtime guard for Phase A: ancestor functions must never touch gen >= 0 blocks
// In browser: IS_TEST = false. In Vitest: globalThis.__vitest_worker__ is set.
const IS_TEST = typeof (globalThis as Record<string, unknown>).__vitest_worker__ !== 'undefined';

function guardAncestorOnly(block: FamilyBlock, context: string): boolean {
    if (block.generation >= 0) {
        if (IS_TEST) {
            throw new Error(`PhaseA attempted to shift descendant block "${block.id}" (gen=${block.generation}) in ${context}`);
        }
        return false; // skip in production
    }
    return true; // proceed
}

// ==================== PHASE B: INDEPENDENT COMPACT ANCESTOR TREES ====================

/**
 * Determine husband (left) and wife (right) from a union.
 * Male is husband, female is wife. If same gender, use partnerA as husband.
 */
function determineHusbandWife(
    union: { partnerA: PersonId; partnerB: PersonId | null },
    model: LayoutModel
): { husbandId: PersonId; wifeId: PersonId | null } {
    if (!union.partnerB) {
        return { husbandId: union.partnerA, wifeId: null };
    }

    const personA = model.persons.get(union.partnerA);
    const personB = model.persons.get(union.partnerB);

    // Male is husband (left), female is wife (right)
    if (personA?.gender === 'male' || personB?.gender === 'female') {
        return { husbandId: union.partnerA, wifeId: union.partnerB };
    } else if (personB?.gender === 'male' || personA?.gender === 'female') {
        return { husbandId: union.partnerB, wifeId: union.partnerA };
    }

    // Fallback: partnerA is husband
    return { husbandId: union.partnerA, wifeId: union.partnerB };
}

/**
 * Build independent ancestor tree starting from a person.
 * Tree only includes DIRECT ancestors (no siblings).
 *
 * @param personId - Person to trace ancestors from
 * @param startGen - Generation of the starting person's parents
 * @param model - Layout model
 * @param minGen - Minimum generation to include (stop condition)
 */
function buildAncestorTree(
    personId: PersonId,
    startGen: number,
    model: LayoutModel,
    minGen: number
): AncestorNode | null {
    const parentUnionId = model.childToParentUnion.get(personId);
    if (!parentUnionId) return null;

    const parentUnion = model.unions.get(parentUnionId);
    if (!parentUnion) return null;

    const { husbandId, wifeId } = determineHusbandWife(parentUnion, model);

    // Stop recursion if we've reached the minimum generation
    const gen = startGen;
    const shouldRecurse = gen > minGen;

    return {
        husbandId,
        wifeId,
        unionId: parentUnionId,
        generation: gen,
        // Recursively build subtrees for both partners
        hSubtree: shouldRecurse ? buildAncestorTree(husbandId, gen - 1, model, minGen) : null,
        wSubtree: wifeId && shouldRecurse ? buildAncestorTree(wifeId, gen - 1, model, minGen) : null,
        width: 0,
        coupleWidth: 0,
        xCenter: 0
    };
}

/**
 * Compute widths for ancestor tree (bottom-up).
 * Width = max(coupleWidth, ancestorsWidth)
 *
 * @returns The computed width of the subtree
 */
function computeAncestorTreeWidth(
    node: AncestorNode | null,
    config: LayoutConfig
): number {
    if (!node) return 0;

    // Couple width: 2 cards + gap for couple, 1 card for single
    node.coupleWidth = node.wifeId
        ? config.cardWidth * 2 + config.partnerGap
        : config.cardWidth;

    // Recursively compute subtree widths
    const hWidth = computeAncestorTreeWidth(node.hSubtree, config);
    const wWidth = computeAncestorTreeWidth(node.wSubtree, config);

    // Ancestors width: sum of subtrees + gap between them (if both exist)
    const ancestorsWidth = hWidth + wWidth +
        (hWidth > 0 && wWidth > 0 ? config.horizontalGap : 0);

    // Tree width is the maximum of couple and ancestors
    node.width = Math.max(node.coupleWidth, ancestorsWidth);

    return node.width;
}

/**
 * Place X positions in ancestor tree (top-down).
 *
 * Key rule: For each couple, the ENTIRE subtree must stay on the correct side:
 * - H-subtree: ALL nodes must have their right edge <= husband's CENTER
 * - W-subtree: ALL nodes must have their left edge >= wife's CENTER
 *
 * This is enforced by:
 * 1. Initial placement based on subtree width
 * 2. Post-placement verification and correction if boundary is violated
 *
 * @param node - Current node to place
 * @param centerX - Center X position for this node
 * @param config - Layout config
 */
function placeAncestorTree(
    node: AncestorNode | null,
    centerX: number,
    config: LayoutConfig
): void {
    if (!node) return;

    // Place this couple centered at centerX
    node.xCenter = centerX;

    const hWidth = node.hSubtree?.width ?? 0;
    const wWidth = node.wSubtree?.width ?? 0;

    // Compute partner centers and edges
    const husbandCenterX = node.wifeId
        ? centerX - config.partnerGap / 2 - config.cardWidth / 2
        : centerX;
    const wifeCenterX = node.wifeId
        ? centerX + config.partnerGap / 2 + config.cardWidth / 2
        : centerX;

    // Boundaries are at card EDGES, not centers (saves space)
    // H-subtree can be aligned with husband's right edge
    // W-subtree can be aligned with wife's left edge
    const husbandRightEdge = husbandCenterX + config.cardWidth / 2;
    const wifeLeftEdge = wifeCenterX - config.cardWidth / 2;

    // Place H-subtree: ENTIRE tree must stay LEFT of husband's RIGHT EDGE
    if (node.hSubtree && hWidth > 0) {
        // Initial placement: tree right edge at husband's right edge
        const hTreeCenterX = husbandRightEdge - hWidth / 2;
        placeAncestorTree(node.hSubtree, hTreeCenterX, config);

        // Verify: check if any node in the subtree exceeds the boundary
        const hMaxX = findTreeMaxX(node.hSubtree, config);
        if (hMaxX > husbandRightEdge) {
            // Shift entire subtree left to respect boundary
            const overshoot = hMaxX - husbandRightEdge;
            shiftAncestorTree(node.hSubtree, -overshoot);
        }
    }

    // Place W-subtree: ENTIRE tree must stay RIGHT of wife's LEFT EDGE
    if (node.wSubtree && wWidth > 0) {
        // Initial placement: tree left edge at wife's left edge
        const wTreeCenterX = wifeLeftEdge + wWidth / 2;
        placeAncestorTree(node.wSubtree, wTreeCenterX, config);

        // Verify: check if any node in the subtree exceeds the boundary
        const wMinX = findTreeMinX(node.wSubtree, config);
        if (wMinX < wifeLeftEdge) {
            // Shift entire subtree right to respect boundary
            const undershoot = wifeLeftEdge - wMinX;
            shiftAncestorTree(node.wSubtree, undershoot);
        }
    }
}

/**
 * Resolve overlap between H-tree and W-tree.
 * If they overlap, push them apart symmetrically.
 */
function resolveAncestorTreeOverlap(
    hTree: AncestorNode | null,
    wTree: AncestorNode | null,
    config: LayoutConfig
): void {
    if (!hTree || !wTree) return;

    // Find the rightmost extent of H-tree
    const hMaxX = findTreeMaxX(hTree, config);
    // Find the leftmost extent of W-tree
    const wMinX = findTreeMinX(wTree, config);

    const overlap = hMaxX - wMinX + config.horizontalGap;
    if (overlap > 0) {
        // Push trees apart: H goes left, W goes right
        const shift = overlap / 2;
        shiftAncestorTree(hTree, -shift);
        shiftAncestorTree(wTree, shift);
    }
}

/**
 * Find maximum X extent of an ancestor tree (rightmost edge).
 */
function findTreeMaxX(node: AncestorNode | null, config: LayoutConfig): number {
    if (!node) return -Infinity;

    // This node's right edge
    const nodeRight = node.xCenter + node.coupleWidth / 2;

    // Check subtrees
    const hMax = findTreeMaxX(node.hSubtree, config);
    const wMax = findTreeMaxX(node.wSubtree, config);

    return Math.max(nodeRight, hMax, wMax);
}

/**
 * Find minimum X extent of an ancestor tree (leftmost edge).
 */
function findTreeMinX(node: AncestorNode | null, config: LayoutConfig): number {
    if (!node) return Infinity;

    // This node's left edge
    const nodeLeft = node.xCenter - node.coupleWidth / 2;

    // Check subtrees
    const hMin = findTreeMinX(node.hSubtree, config);
    const wMin = findTreeMinX(node.wSubtree, config);

    return Math.min(nodeLeft, hMin, wMin);
}

/**
 * Shift entire ancestor tree by deltaX.
 */
function shiftAncestorTree(node: AncestorNode | null, deltaX: number): void {
    if (!node) return;
    node.xCenter += deltaX;
    shiftAncestorTree(node.hSubtree, deltaX);
    shiftAncestorTree(node.wSubtree, deltaX);
}

/**
 * Enforce H/W boundaries for ALL couples in the tree.
 *
 * This is called AFTER initial placement to fix any violations that occurred
 * due to recursive placement or shifts. For EVERY couple in the tree:
 * - H-subtree's right edge must be <= husband's RIGHT EDGE (not center)
 * - W-subtree's left edge must be >= wife's LEFT EDGE (not center)
 *
 * Using card edges (not centers) as boundaries saves space by allowing
 * subtrees to be aligned with their parent cards.
 *
 * Returns true if any changes were made.
 */
function enforceAllCoupleBoundaries(
    node: AncestorNode | null,
    config: LayoutConfig
): boolean {
    if (!node) return false;

    let changed = false;

    // Compute partner centers for this couple
    const husbandCenterX = node.wifeId
        ? node.xCenter - config.partnerGap / 2 - config.cardWidth / 2
        : node.xCenter;
    const wifeCenterX = node.wifeId
        ? node.xCenter + config.partnerGap / 2 + config.cardWidth / 2
        : node.xCenter;

    // Boundaries are at card EDGES, not centers (saves space)
    const husbandRightEdge = husbandCenterX + config.cardWidth / 2;
    const wifeLeftEdge = wifeCenterX - config.cardWidth / 2;

    // Check H-subtree: entire tree must stay LEFT of husband's RIGHT EDGE
    if (node.hSubtree) {
        const hMaxX = findTreeMaxX(node.hSubtree, config);
        if (hMaxX > husbandRightEdge + 0.5) { // tolerance
            const overshoot = hMaxX - husbandRightEdge;
            shiftAncestorTree(node.hSubtree, -overshoot);
            changed = true;
        }
    }

    // Check W-subtree: entire tree must stay RIGHT of wife's LEFT EDGE
    if (node.wSubtree) {
        const wMinX = findTreeMinX(node.wSubtree, config);
        if (wMinX < wifeLeftEdge - 0.5) { // tolerance
            const undershoot = wifeLeftEdge - wMinX;
            shiftAncestorTree(node.wSubtree, undershoot);
            changed = true;
        }
    }

    // Recursively enforce for children
    // IMPORTANT: Do this AFTER fixing this level, so children's shifts
    // are relative to the corrected positions
    const hChanged = enforceAllCoupleBoundaries(node.hSubtree, config);
    const wChanged = enforceAllCoupleBoundaries(node.wSubtree, config);

    return changed || hChanged || wChanged;
}

/**
 * Run boundary enforcement until convergence.
 * This handles cases where fixing one couple's boundaries affects another.
 */
function enforceAllBoundariesUntilConvergence(
    tree: AncestorNode | null,
    config: LayoutConfig,
    maxIterations: number = 20
): void {
    if (!tree) return;

    for (let i = 0; i < maxIterations; i++) {
        const changed = enforceAllCoupleBoundaries(tree, config);
        if (!changed) break;
    }
}

/**
 * Transfer computed positions from AncestorNode tree to FamilyBlocks.
 * Updates xCenter, xLeft, xRight, and anchor positions.
 */
function transferAncestorTreeToBlocks(
    node: AncestorNode | null,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    if (!node) return;

    const blockId = unionToBlock.get(node.unionId);
    if (blockId) {
        const block = blocks.get(blockId);
        if (block) {
            // Update block positions from tree node
            const oldCenter = block.xCenter;
            const deltaX = node.xCenter - oldCenter;

            block.xCenter = node.xCenter;
            block.xLeft = node.xCenter - block.width / 2;
            block.xRight = node.xCenter + block.width / 2;
            block.coupleCenterX = node.xCenter;

            // Update anchors
            if (node.wifeId) {
                block.husbandAnchorX = node.xCenter - config.partnerGap / 2 - config.cardWidth / 2;
                block.wifeAnchorX = node.xCenter + config.partnerGap / 2 + config.cardWidth / 2;
            } else {
                block.husbandAnchorX = node.xCenter;
                block.wifeAnchorX = node.xCenter;
            }

            // Update childrenCenterX
            block.childrenCenterX += deltaX;
        }
    }

    // Recurse to subtrees
    transferAncestorTreeToBlocks(node.hSubtree, blocks, unionToBlock, config);
    transferAncestorTreeToBlocks(node.wSubtree, blocks, unionToBlock, config);
}

/**
 * Phase B v2: Build and place independent compact ancestor trees.
 *
 * This is the main Phase B entry point. It:
 * 1. Finds the anchor couple (focus parents at gen -1)
 * 2. Builds independent H-tree and W-tree for their ancestors
 * 3. Computes widths bottom-up
 * 4. Places each tree so it doesn't cross the midpoint between H and W
 * 5. Resolves any remaining overlap between trees
 * 6. Transfers positions to FamilyBlocks
 *
 * Key invariant: H-tree stays LEFT of midpoint, W-tree stays RIGHT of midpoint.
 */
function runPhaseBIndependentTrees(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    genModel: GenerationalModel,
    focusPersonId: PersonId,
    config: LayoutConfig
): void {
    // Step 1: Find anchor couple (parents of focus at gen -1)
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return; // Focus has no parents

    const anchorUnion = model.unions.get(focusParentUnionId);
    if (!anchorUnion) return;

    // Get anchor block to find anchor positions
    const anchorBlockId = unionToBlock.get(focusParentUnionId);
    if (!anchorBlockId) return;

    const anchorBlock = blocks.get(anchorBlockId);
    if (!anchorBlock) return;

    // Determine H/W for anchor couple
    const { husbandId: anchorHusbandId, wifeId: anchorWifeId } =
        determineHusbandWife(anchorUnion, model);

    // Compute key positions (from gen -1 block, which is LOCKED)
    const husbandCenterX = anchorWifeId
        ? anchorBlock.xCenter - config.partnerGap / 2 - config.cardWidth / 2
        : anchorBlock.xCenter;
    const wifeCenterX = anchorWifeId
        ? anchorBlock.xCenter + config.partnerGap / 2 + config.cardWidth / 2
        : anchorBlock.xCenter;
    const midpointX = anchorBlock.xCenter; // Center between H and W

    // Find minimum generation (deepest ancestors)
    const minGen = genModel.minGen;

    // Step 2: Build independent ancestor trees
    const hTree = buildAncestorTree(anchorHusbandId, -2, model, minGen);
    const wTree = anchorWifeId ? buildAncestorTree(anchorWifeId, -2, model, minGen) : null;

    // Step 3: Compute widths (bottom-up)
    const hWidth = computeAncestorTreeWidth(hTree, config);
    const wWidth = computeAncestorTreeWidth(wTree, config);

    // Compute card edges (not centers) - boundaries for tree placement
    const husbandRightEdge = husbandCenterX + config.cardWidth / 2;
    const wifeLeftEdge = wifeCenterX - config.cardWidth / 2;

    // Step 4: Place trees
    // Special case: if only ONE tree exists, center it above its parent
    // (no need to push it to the side to avoid collision with non-existent tree)
    if (hTree && !wTree) {
        // Only H-tree exists: center it above husband
        placeAncestorTree(hTree, husbandCenterX, config);
    } else if (wTree && !hTree) {
        // Only W-tree exists: center it above wife
        placeAncestorTree(wTree, wifeCenterX, config);
    } else {
        // Both trees exist: place them so they don't cross the midpoint
        // H-tree: place so its RIGHT edge is at husband's RIGHT CARD EDGE
        if (hTree) {
            const hTreeCenterX = husbandRightEdge - hWidth / 2;
            placeAncestorTree(hTree, hTreeCenterX, config);
        }

        // W-tree: place so its LEFT edge is at wife's LEFT CARD EDGE
        if (wTree) {
            const wTreeCenterX = wifeLeftEdge + wWidth / 2;
            placeAncestorTree(wTree, wTreeCenterX, config);
        }
    }

    // Step 5: Enforce H/W boundaries for ALL couples in each tree
    // This fixes any violations that occurred during recursive placement
    enforceAllBoundariesUntilConvergence(hTree, config);
    enforceAllBoundariesUntilConvergence(wTree, config);

    // Step 6: Resolve any overlap between trees (shouldn't happen with above placement)
    resolveAncestorTreeOverlap(hTree, wTree, config);

    // Step 7: Transfer positions to FamilyBlocks
    transferAncestorTreeToBlocks(hTree, blocks, unionToBlock, config);
    transferAncestorTreeToBlocks(wTree, blocks, unionToBlock, config);
}

/**
 * Apply constraints: 2-Phase Pipeline (A/B — No Backtracking).
 *
 * Phase A: FOCUS PARENTS + DESCENDANTS (gen >= -1)
 *   - Loop: overlap resolution + recentering
 *   - SFNI: Sibling Family Non-Interleaving
 *   - SFC: Sibling Family Compaction
 *   - Positions locked after this phase (gen >= -1 never changes again)
 *
 * Phase B: EXTENDED ANCESTORS ONLY (gen <= -2, i.e. grandparents and up)
 *   - Cross-tree separation (WIFE blocks only)
 *   - ACIC: Ancestor Clamped Internal Centering
 *   - ASO: Ancestor Side Ownership (per-couple barriers)
 *   - A-COMP: Ancestor compaction toward focus
 *   - FSPC barrier: ancestors must not cross partner center line
 *   - CRITICAL: Phase B NEVER touches gen >= -1 blocks
 *
 * Final: recompute branch bounds + positions
 */
export function applyConstraints(input: ConstraintsInput): ConstrainedModel {
    const { placed, config } = input;
    const { measured } = placed;

    const unionX = new Map(placed.unionX);
    const personX = new Map(placed.personX);

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || fbm.blocks.size === 0) {
        return {
            placed: { measured, personX, unionX },
            iterations: 0,
            finalMaxViolation: 0
        };
    }

    const blocks = fbm.blocks;
    const model = measured.genModel.model;

    const branchModel = measured as BranchModel;
    const hasBranches = branchModel.branches && branchModel.branches.size > 0;

    // === PHASE A: DESCENDANTS FIRST (gen >= 0) ===
    // Stabilize descendant positions before ancestors center over them.

    for (let pass = 0; pass < 10; pass++) {
        const delta = resolveOverlapsDescOnly(blocks, model, config);
        recenterDescendantParents(blocks, model, fbm.unionToBlock, personX, config);
        if (delta < 0.5) break;
    }
    // BCO enforcement: prevent subtree interleaving
    // First pass: resolve BCO without overlap resolution to let BCO converge
    for (let bcoPass = 0; bcoPass < 15; bcoPass++) {
        const shifted = enforceBranchClusterSeparation(blocks, model, fbm.unionToBlock, config);
        recenterDescendantParents(blocks, model, fbm.unionToBlock, personX, config);
        if (!shifted) break;
    }
    // Then resolve any card-level overlaps that BCO might have introduced
    resolveOverlapsDescOnly(blocks, model, config);
    recenterDescendantParents(blocks, model, fbm.unionToBlock, personX, config);
    // One more BCO pass to fix any overlap-resolution side effects
    for (let bcoPass = 0; bcoPass < 5; bcoPass++) {
        const shifted = enforceBranchClusterSeparation(blocks, model, fbm.unionToBlock, config);
        recenterDescendantParents(blocks, model, fbm.unionToBlock, personX, config);
        if (!shifted) break;
    }

    // CSP: Cousin Separation Priority — push cousin branches outside focus sibling span
    if (input.focusPersonId) {
        for (let cspPass = 0; cspPass < 3; cspPass++) {
            const shifted = enforceCousinSeparation(
                blocks, model, fbm.unionToBlock, input.focusPersonId, config
            );
            if (!shifted) break;
            resolveOverlapsDescOnly(blocks, model, config);
            recenterDescendantParents(blocks, model, fbm.unionToBlock, personX, config);
        }
    }

    // BCC: Branch Cluster Compaction — final Phase A step
    // Pulls sibling subtrees leftward to close excessive gaps.
    // Runs AFTER BCO is stable; each pull is guarded against overlap.

    compactBranchClusters(blocks, model, fbm.unionToBlock, config);
    recenterDescendantParents(blocks, model, fbm.unionToBlock, personX, config);

    // Post-BCC safety: fix any residual cross-union overlaps that the per-gen guard missed
    resolveOverlapsDescOnly(blocks, model, config);
    recenterDescendantParents(blocks, model, fbm.unionToBlock, personX, config);

    // BCC pass 2: recenter may have spread blocks apart again, re-compact
    compactBranchClusters(blocks, model, fbm.unionToBlock, config);

    // Final CSP: ensure BCC/recenter didn't reintroduce cousin intrusion.
    // Runs without recenter to prevent parent-centering from pulling CB blocks back.
    if (input.focusPersonId) {
        for (let finalCsp = 0; finalCsp < 3; finalCsp++) {
            const shifted = enforceCousinSeparation(
                blocks, model, fbm.unionToBlock, input.focusPersonId, config
            );
            if (!shifted) break;
            resolveOverlapsDescOnly(blocks, model, config);
        }
    }

    // SBAC: Center sibling family parents (gen=-1 aunts/uncles) over their children (gen=0 cousins)
    // This ensures aunt/uncle couples are properly positioned above their children in Phase A.
    recenterSiblingFamilyParents(blocks, model, fbm.unionToBlock, config);

    // SFNI: Sibling Family Non-Interleaving - ensure gen=-1 siblings don't intrude
    // into each other's family clusters (e.g., aunt shouldn't overlap uncle's children)
    if (input.focusPersonId) {
        enforceSiblingFamilyNonInterleaving(blocks, model, fbm.unionToBlock, input.focusPersonId, config);
    }

    // Compact sibling families: pull gen -1 sibling family clusters together
    // This moves entire families (parent + all descendants) as rigid units
    if (input.focusPersonId) {
        compactSiblingFamilyClusters(blocks, model, fbm.unionToBlock, input.focusPersonId, config);
    }

    // Final recentering pass to fix any centering issues from constraint operations
    recenterDescendantParents(blocks, model, fbm.unionToBlock, personX, config);

    // Capture locked positions for gen>=0 after Phase A is complete
    // This will be used to verify Phase B doesn't modify descendant positions
    const lockedX = captureLockedPositions(
        blocks, measured.genModel, model, fbm.unionToBlock, config
    );

    if (input.stopAfterPhase === 'A') {
        recomputePositions(blocks, model, fbm.unionToBlock, config, unionX, personX);
        return { placed: { measured, personX, unionX }, iterations: 1, finalMaxViolation: 0 };
    }

    // === PHASE B: ANCESTORS (gen <= -2) ===
    // NEW: Build independent compact ancestor trees for H-side and W-side
    // Key principle:
    //   - H-Tree and W-Tree are built INDEPENDENTLY
    //   - Each tree is COMPACT (minimum width)
    //   - For each couple: H-ancestors left, W-ancestors right
    //   - Trees are placed above gen -1 anchor couple
    //   - Any overlap between trees is resolved by pushing apart

    if (input.focusPersonId) {
        runPhaseBIndependentTrees(
            blocks,
            model,
            fbm.unionToBlock,
            measured.genModel,
            input.focusPersonId,
            config
        );

        // The independent tree placement handles DIRECT ancestors.
        // For collateral ancestors (siblings of ancestors, their spouses, etc.)
        // that weren't placed by the independent trees, we need overlap resolution.
        // Use a limited number of passes to avoid disrupting the compact placement.
        for (let pass = 0; pass < 3; pass++) {
            const delta = resolveOverlapsOutward(blocks, model, fbm.unionToBlock, config);
            if (delta < 0.5) break;
        }
    }

    // Verify Phase B didn't modify any descendant (gen>=-1) positions
    // This is a critical invariant - Phase B should only touch gen <= -2
    if (IS_TEST) {
        assertLockedDescendantsUnchanged(
            lockedX, blocks, measured.genModel, model, fbm.unionToBlock, config
        );
    }

    // === FINAL: Recompute ===
    if (hasBranches) {
        recomputeBranchBounds(branchModel, blocks);
    }
    // Pass genModel to preserve gen>=0 children without blocks (e.g. focus person)
    recomputePositions(blocks, model, fbm.unionToBlock, config, unionX, personX, measured.genModel);

    return {
        placed: { measured, personX, unionX },
        iterations: 1,
        finalMaxViolation: 0
    };
}

// ==================== CROSS-TREE SEPARATION ====================

/**
 * Ensure WIFE-side blocks don't overlap with any non-WIFE blocks.
 * Only processes gen < 0 blocks (gen >= 0 are all side='BOTH').
 * Computes the max overlap across ancestor generations and applies a uniform shift.
 */
function enforceCrossTreeSeparation(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    config: LayoutConfig
): number {
    // Group ancestor blocks by generation
    const byGen = new Map<number, FamilyBlock[]>();
    for (const [, block] of blocks) {
        if (block.generation >= -1) continue; // Only gen -2 and beyond (skip gen -1 = parents of focus)
        if (!byGen.has(block.generation)) byGen.set(block.generation, []);
        byGen.get(block.generation)!.push(block);
    }

    // Compute max WIFE-side overlap across ancestor generations
    let wifeShift = 0;
    for (const [, genBlocks] of byGen) {
        let nonWifeRight = -Infinity;
        let wifeLeft = Infinity;
        let hasNonWife = false;
        let hasWife = false;

        for (const block of genBlocks) {
            if (block.side === 'WIFE') {
                wifeLeft = Math.min(wifeLeft, block.xLeft);
                hasWife = true;
            } else {
                nonWifeRight = Math.max(nonWifeRight, block.xRight);
                hasNonWife = true;
            }
        }

        if (hasNonWife && hasWife) {
            const overlap = nonWifeRight + config.horizontalGap - wifeLeft;
            if (overlap > wifeShift) wifeShift = overlap;
        }
    }

    if (wifeShift > 0) {
        for (const [, block] of blocks) {
            // Only shift gen < -1 blocks (grandparents and beyond)
            // Gen -1 (focus parents) are locked after Phase A
            if (block.side === 'WIFE' && block.generation < -1) {
                block.xLeft += wifeShift;
                block.xRight += wifeShift;
                block.xCenter += wifeShift;
                block.coupleCenterX += wifeShift;
                block.husbandAnchorX += wifeShift;
                block.wifeAnchorX += wifeShift;
                block.childrenCenterX += wifeShift;
            }
        }
    }

    return wifeShift;
}


// ==================== DESCENDANT OVERLAP RESOLUTION ====================

/**
 * Resolve overlaps for DESCENDANT generations only (gen >= 0).
 * Standard left-to-right sweep, uses shiftBlockSubtree.
 */
function resolveOverlapsDescOnly(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): number {
    const MAX_ITERATIONS = 30;
    let totalShift = 0;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        let iterShift = 0;

        // Compute block visual extents grouped by generation (gen >= 0 only)
        const byGen = new Map<number, Array<{
            blockId: FamilyBlockId;
            left: number;
            right: number;
        }>>();

        for (const [, block] of blocks) {
            if (block.generation < 0) continue;

            const union = model.unions.get(block.rootUnionId);
            if (!union) continue;

            const ext = getBlockCardExtent(block, model, config);

            if (!byGen.has(block.generation)) byGen.set(block.generation, []);
            byGen.get(block.generation)!.push({ blockId: block.id, left: ext.left, right: ext.right });
        }

        for (const [, genBlocks] of byGen) {
            if (genBlocks.length < 2) continue;

            genBlocks.sort((a, b) => a.left - b.left);
            for (let i = 1; i < genBlocks.length; i++) {
                const overlap = genBlocks[i - 1].right + config.horizontalGap - genBlocks[i].left;
                if (overlap > 0.5) {
                    const shift = overlap + 0.5;
                    shiftBlockSubtree(genBlocks[i].blockId, shift, blocks);
                    genBlocks[i].left += shift;
                    genBlocks[i].right += shift;
                    iterShift += shift;
                }
            }
        }

        totalShift += iterShift;
        if (iterShift < 0.5) break;
    }

    return totalShift;
}

/**
 * Shift a block and all its descendants rigidly.
 */
function shiftBlockSubtree(
    blockId: FamilyBlockId,
    deltaX: number,
    blocks: Map<FamilyBlockId, FamilyBlock>
): void {
    const stack = [blockId];
    const visited = new Set<FamilyBlockId>();

    while (stack.length > 0) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);

        const block = blocks.get(id);
        if (!block) continue;

        block.xLeft += deltaX;
        block.xRight += deltaX;
        block.xCenter += deltaX;
        block.coupleCenterX += deltaX;
        block.husbandAnchorX += deltaX;
        block.wifeAnchorX += deltaX;
        block.childrenCenterX += deltaX;

        // Shift chain person positions
        if (block.chainInfo) {
            for (const [pid, x] of block.chainInfo.personPositions) {
                block.chainInfo.personPositions.set(pid, x + deltaX);
            }
        }

        for (const childId of block.childBlockIds) {
            stack.push(childId);
        }
    }
}


// ==================== SUBTREE EXTENT ====================

/**
 * Compute the full X extent of a block's subtree (block itself + all descendants).
 * Returns the bounding interval [minX, maxX] covering all blocks in the subtree.
 */
function subtreeExtent(
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

        minX = Math.min(minX, child.xLeft);
        maxX = Math.max(maxX, child.xRight);

        for (const grandchildId of child.childBlockIds) {
            stack.push(grandchildId);
        }
    }

    return { minX, maxX };
}

/**
 * Compute X extent of a block's subtree, stopping at BOTH blocks.
 * Used by enforcePolarity and SFCO to compute the correct extent of
 * H/W side subtrees without including the focus/descendant blocks.
 */
function subtreeExtentSideOnly(
    blockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    ancestorOnly: boolean = false
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

        // When ancestorOnly, skip gen>=0 blocks
        if (ancestorOnly && child.generation >= 0) continue;

        minX = Math.min(minX, child.xLeft);
        maxX = Math.max(maxX, child.xRight);

        for (const grandchildId of child.childBlockIds) {
            stack.push(grandchildId);
        }
    }

    return { minX, maxX };
}

// ==================== BRANCH CLUSTER ORDER (BCO) ====================

/**
 * Compute the full X extent of a block's subtree using couple card positions.
 * Unlike subtreeExtent which uses block.xLeft/xRight (measurement-time width),
 * this uses the actual couple card extent based on xCenter and partner configuration.
 * This gives the true visual extent of the subtree.
 */
function subtreeCardExtent(
    blockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): { minX: number; maxX: number } {
    const block = blocks.get(blockId);
    if (!block) return { minX: 0, maxX: 0 };

    const rootExt = getBlockCardExtent(block, model, config);
    let minX = rootExt.left;
    let maxX = rootExt.right;

    const stack = [...block.childBlockIds];
    const visited = new Set<FamilyBlockId>([blockId]);

    while (stack.length > 0) {
        const childId = stack.pop()!;
        if (visited.has(childId)) continue;
        visited.add(childId);

        const child = blocks.get(childId);
        if (!child) continue;

        const childExt = getBlockCardExtent(child, model, config);
        const childLeft = childExt.left;
        const childRight = childExt.right;

        minX = Math.min(minX, childLeft);
        maxX = Math.max(maxX, childRight);

        for (const grandchildId of child.childBlockIds) {
            stack.push(grandchildId);
        }
    }

    return { minX, maxX };
}

/**
 * Collect sibling block entries with their subtree card extents.
 * For a given union, finds children who have their own blocks at gen >= 0,
 * and computes the full subtree card extent for each.
 */
function collectSiblingExtents(
    union: { childIds: PersonId[] },
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    config: LayoutConfig
): Array<{ personId: PersonId; blockId: FamilyBlockId; xCenter: number; extent: { minX: number; maxX: number } }> {
    const result: Array<{ personId: PersonId; blockId: FamilyBlockId; xCenter: number; extent: { minX: number; maxX: number } }> = [];
    for (const childId of union.childIds) {
        const childUnionId = model.personToUnion.get(childId);
        if (!childUnionId) continue;
        const blockId = unionToBlock.get(childUnionId);
        if (!blockId) continue;
        const block = blocks.get(blockId);
        if (!block || block.generation < 0) continue;

        const extent = subtreeCardExtent(blockId, blocks, model, config);
        result.push({ personId: childId, blockId, xCenter: block.xCenter, extent });
    }
    return result;
}

/**
 * Enforce branch cluster separation: for each gen>=0 union with 2+ children
 * that have their own blocks, ensure subtree extents don't overlap.
 * Sweeps left-to-right and pushes overlapping subtrees rightward.
 */
function enforceBranchClusterSeparation(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): boolean {
    let anyShift = false;

    for (const [, union] of model.unions) {
        if (union.childIds.length < 2) continue;

        const siblings = collectSiblingExtents(union, model, unionToBlock, blocks, config);
        if (siblings.length < 2) continue;

        // Sort left-to-right
        siblings.sort((a, b) => a.xCenter - b.xCenter);

        // Check ALL pairs (i, j) where i < j: push right if subtree overlap
        for (let i = 0; i < siblings.length - 1; i++) {
            for (let j = i + 1; j < siblings.length; j++) {
                const overlap = siblings[i].extent.maxX + config.horizontalGap - siblings[j].extent.minX;
                if (overlap > 0.5) {
                    const shift = overlap + 0.5;
                    shiftBlockSubtree(siblings[j].blockId, shift, blocks);
                    siblings[j].extent.minX += shift;
                    siblings[j].extent.maxX += shift;
                    siblings[j].xCenter += shift;
                    anyShift = true;
                }
            }
        }
    }
    return anyShift;
}

/**
 * Compact branch clusters: pull sibling subtrees leftward to close excessive gaps.
 *
 * Key differences from the old compactBranchClustersLeft:
 * - Processes unions bottom-up (deepest gen first) so child subtrees compact before parents
 * - Each pull is guarded: checks per-generation card overlap against ALL blocks (not just siblings)
 * - Single sweep (final step, no iteration needed)
 */
function compactBranchClusters(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    // Collect all unions that have 2+ gen>=0 children with blocks
    // Note: We don't compact gen -1 siblings here - their spacing is determined
    // by SFNI (Sibling Family Non-Interleaving) which ensures family clusters don't overlap.
    const candidates: Array<{ unionId: UnionId; gen: number }> = [];
    for (const [unionId, union] of model.unions) {
        if (union.childIds.length < 2) continue;
        let childGen = -1;
        for (const childId of union.childIds) {
            const cuid = model.personToUnion.get(childId);
            if (!cuid) continue;
            const bid = unionToBlock.get(cuid);
            if (!bid) continue;
            const b = blocks.get(bid);
            if (b && b.generation >= 0) { childGen = b.generation; break; }
        }
        if (childGen >= 0) candidates.push({ unionId, gen: childGen });
    }

    // Sort bottom-up: deepest generation first
    candidates.sort((a, b) => b.gen - a.gen);

    for (const { unionId } of candidates) {
        const union = model.unions.get(unionId);
        if (!union) continue;

        const siblings = collectSiblingExtents(union, model, unionToBlock, blocks, config);
        if (siblings.length < 2) continue;
        siblings.sort((a, b) => a.xCenter - b.xCenter);

        // Left-compaction sweep: pull each cluster toward its left neighbor
        for (let i = 1; i < siblings.length; i++) {
            // Find the minimum gap to ANY left sibling (not just adjacent)
            let minGap = Infinity;
            for (let k = 0; k < i; k++) {
                const gap = siblings[i].extent.minX - siblings[k].extent.maxX;
                if (gap < minGap) minGap = gap;
            }
            const excess = minGap - config.horizontalGap;
            if (excess <= 0.5) continue; // already tight

            // Compute the max safe pull: check per-generation card overlap against ALL blocks
            const safePull = computeSafePull(siblings[i].blockId, excess, blocks, model, config);
            if (safePull <= 0.5) continue;

            const delta = -safePull;
            shiftBlockSubtree(siblings[i].blockId, delta, blocks);

            // Update local extent for subsequent checks
            siblings[i].extent = subtreeCardExtent(siblings[i].blockId, blocks, model, config);
            siblings[i].xCenter += delta;
        }
    }
}

/**
 * Compute the maximum safe leftward pull for a subtree.
 * For each block in the subtree, checks card positions at that generation
 * against ALL other blocks at the same generation (not just siblings).
 * Returns the min safe pull across all blocks in the subtree.
 */
function computeSafePull(
    blockId: FamilyBlockId,
    maxPull: number,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): number {
    // Collect all blocks in the subtree being pulled
    const subtreeBlockIds: FamilyBlockId[] = [];
    const stack = [blockId];
    const visited = new Set<FamilyBlockId>();
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        subtreeBlockIds.push(id);
        const block = blocks.get(id);
        if (block) {
            for (const childId of block.childBlockIds) {
                stack.push(childId);
            }
        }
    }

    let safePull = maxPull;

    // For each block in the subtree, find the closest non-subtree block
    // to its left at the same generation
    for (const subId of subtreeBlockIds) {
        const subBlock = blocks.get(subId);
        if (!subBlock || subBlock.generation < 0) continue;

        // Compute current card left edge of this subtree block
        const subExt = getBlockCardExtent(subBlock, model, config);
        const subLeft = subExt.left;

        // Find closest non-subtree block to the left at same generation
        for (const [otherId, otherBlock] of blocks) {
            if (visited.has(otherId)) continue; // skip subtree blocks
            if (otherBlock.generation !== subBlock.generation) continue;
            if (otherBlock.generation < 0) continue;

            const otherExt = getBlockCardExtent(otherBlock, model, config);
            const otherRight = otherExt.right;

            // Only consider blocks to the left
            if (otherRight > subLeft) continue;

            // How much can we pull left before overlapping with this block?
            const availableGap = subLeft - otherRight - config.horizontalGap;
            if (availableGap < safePull) {
                safePull = availableGap;
            }
        }
    }

    return Math.max(0, safePull);
}

// ==================== COUSIN SEPARATION PRIORITY (CSP) ====================

/**
 * CSP: Cousin Separation Priority.
 * Pushes Cousin Branch (CB) blocks outside the Focus Sibling (FS) span.
 *
 * FS = gen=0 blocks for children of focus's parent union
 * CB = all other gen=0 blocks (children of uncle/aunt unions)
 *
 * Returns true if any block was shifted.
 */
function enforceCousinSeparation(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    focusPersonId: PersonId,
    config: LayoutConfig
): boolean {
    // 1. Find focus's parent union
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return false;
    const focusParentUnion = model.unions.get(focusParentUnionId);
    if (!focusParentUnion) return false;

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

    // Chain blocks: include ALL gen=0 children from ALL unions in the chain.
    // Half-siblings from the same chain are part of the focus family, not cousins.
    const focusParentBlockId = unionToBlock.get(focusParentUnionId);
    if (focusParentBlockId) {
        const focusParentBlock = blocks.get(focusParentBlockId);
        if (focusParentBlock?.chainInfo) {
            for (const childId of focusParentBlock.childBlockIds) {
                const childBlock = blocks.get(childId);
                if (childBlock && childBlock.generation === 0) {
                    fsBlockIds.add(childId);
                }
            }
        }
    }

    if (fsBlockIds.size === 0) return false;

    // 3. Compute FS span (combined subtreeCardExtent of all FS blocks)
    let fsMinX = Infinity, fsMaxX = -Infinity;
    for (const blockId of fsBlockIds) {
        const ext = subtreeCardExtent(blockId, blocks, model, config);
        fsMinX = Math.min(fsMinX, ext.minX);
        fsMaxX = Math.max(fsMaxX, ext.maxX);
    }
    if (!isFinite(fsMinX)) return false;

    // 4. Collect CB blocks (gen=0, NOT in FS)
    const cbBlocks: Array<{
        blockId: FamilyBlockId;
        extent: { minX: number; maxX: number };
        xCenter: number;
    }> = [];
    for (const [blockId, block] of blocks) {
        if (block.generation !== 0) continue;
        if (fsBlockIds.has(blockId)) continue;
        const ext = subtreeCardExtent(blockId, blocks, model, config);
        cbBlocks.push({ blockId, extent: ext, xCenter: block.xCenter });
    }
    if (cbBlocks.length === 0) return false;

    // 5. Group CB blocks by parentBlockId (siblings must move together)
    const siblingFamilies = new Map<FamilyBlockId | null, typeof cbBlocks>();
    for (const cb of cbBlocks) {
        const block = blocks.get(cb.blockId);
        const parentId = block?.parentBlockId ?? null;
        if (!siblingFamilies.has(parentId)) {
            siblingFamilies.set(parentId, []);
        }
        siblingFamilies.get(parentId)!.push(cb);
    }

    // 6. Partition intruding sibling families into left-push and right-push groups
    // Decision is based on the FAMILY'S combined extent center, not individual blocks
    const leftGroup: typeof cbBlocks = [];
    const rightGroup: typeof cbBlocks = [];

    for (const [parentId, family] of siblingFamilies) {
        // Compute combined extent of the sibling family
        let famMinX = Infinity, famMaxX = -Infinity;
        for (const cb of family) {
            famMinX = Math.min(famMinX, cb.extent.minX);
            famMaxX = Math.max(famMaxX, cb.extent.maxX);
        }

        // Check if family intrudes into FS span
        const intrudesFS = famMaxX > fsMinX - config.horizontalGap + 0.5
                        && famMinX < fsMaxX + config.horizontalGap - 0.5;
        if (!intrudesFS) continue;

        // Decide direction based on family center
        const famCenter = (famMinX + famMaxX) / 2;
        const fsCenter = (fsMinX + fsMaxX) / 2;

        if (famCenter < fsCenter) {
            // Family is more to the left -> push left
            for (const cb of family) {
                leftGroup.push(cb);
            }
        } else {
            // Family is more to the right -> push right
            for (const cb of family) {
                rightGroup.push(cb);
            }
        }
    }

    // Sort groups by xCenter for deterministic processing
    leftGroup.sort((a, b) => a.xCenter - b.xCenter);
    rightGroup.sort((a, b) => a.xCenter - b.xCenter);

    let anyShift = false;

    // 7. Push LEFT group: shift all left-side CBs by the same amount so the
    // rightmost one clears the FS left boundary. This maintains relative spacing.
    if (leftGroup.length > 0) {
        // Find the rightmost intruder's maxX
        let maxRightEdge = -Infinity;
        for (const cb of leftGroup) {
            maxRightEdge = Math.max(maxRightEdge, cb.extent.maxX);
        }
        const target = fsMinX - config.horizontalGap;
        const shift = target - maxRightEdge; // negative
        if (shift < -0.5) {
            // Also shift any non-intruding CB blocks that are to the LEFT of the leftGroup
            // (they might be in the way after the shift)
            const leftBoundary = Math.min(...leftGroup.map(cb => cb.extent.minX));
            for (const cb of cbBlocks) {
                if (leftGroup.includes(cb)) {
                    shiftBlockSubtree(cb.blockId, shift, blocks);
                    cb.extent.minX += shift;
                    cb.extent.maxX += shift;
                    cb.xCenter += shift;
                } else if (cb.xCenter < leftBoundary) {
                    // CB to the left: also shift to maintain spacing
                    shiftBlockSubtree(cb.blockId, shift, blocks);
                    cb.extent.minX += shift;
                    cb.extent.maxX += shift;
                    cb.xCenter += shift;
                }
            }
            anyShift = true;
        }
    }

    // 8. Push RIGHT group: shift all right-side CBs so the leftmost one clears FS right boundary.
    if (rightGroup.length > 0) {
        let minLeftEdge = Infinity;
        for (const cb of rightGroup) {
            minLeftEdge = Math.min(minLeftEdge, cb.extent.minX);
        }
        const target = fsMaxX + config.horizontalGap;
        const shift = target - minLeftEdge; // positive
        if (shift > 0.5) {
            const rightBoundary = Math.max(...rightGroup.map(cb => cb.extent.maxX));
            for (const cb of cbBlocks) {
                if (rightGroup.includes(cb)) {
                    shiftBlockSubtree(cb.blockId, shift, blocks);
                    cb.extent.minX += shift;
                    cb.extent.maxX += shift;
                    cb.xCenter += shift;
                } else if (cb.xCenter > rightBoundary) {
                    // CB to the right: also shift to maintain spacing
                    shiftBlockSubtree(cb.blockId, shift, blocks);
                    cb.extent.minX += shift;
                    cb.extent.maxX += shift;
                    cb.xCenter += shift;
                }
            }
            anyShift = true;
        }
    }

    return anyShift;
}

// ==================== SIBLING FAMILY CLUSTER ORDER (SIDE-ONLY) ====================

/**
 * Enforce sibling family cluster ordering with side-only extents.
 * For each union with 2+ children who have their own unions (gen >= 0 only),
 * the subtree X intervals (using subtreeExtentSideOnly) must be ordered
 * left-to-right and non-overlapping.
 *
 * Skips unions whose block has generation < 0.
 * Uses shiftBlockSubtree for shifts (safe: all gen >= 0 blocks are BOTH).
 */
function enforceSiblingFamilyClusterOrderSideOnly(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    const MAX_PASSES = 10;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        let anyShift = false;

        for (const [, union] of model.unions) {
            if (union.childIds.length < 2) continue;

            // Build list of sibling entries: block + subtree extent (sideOnly)
            // Children are filtered to gen>=0 below
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

                // Skip if this child's block is in ancestor generation
                if (block.generation < 0) continue;

                const extent = subtreeExtentSideOnly(blockId, blocks);
                siblings.push({
                    personId: childId,
                    blockId,
                    xCenter: block.xCenter,
                    extent
                });
            }

            if (siblings.length < 2) continue;

            // Sort by xCenter (deterministic sibling order)
            siblings.sort((a, b) => a.xCenter - b.xCenter);

            // Check ALL pairs (i, j) where i < j
            for (let i = 0; i < siblings.length - 1; i++) {
                for (let j = i + 1; j < siblings.length; j++) {
                    const prev = siblings[i];
                    const curr = siblings[j];

                    const overlap = prev.extent.maxX + config.horizontalGap - curr.extent.minX;
                    if (overlap > 0.5) {
                        const shift = overlap + 0.5;
                        shiftBlockSubtree(curr.blockId, shift, blocks);
                        curr.extent.minX += shift;
                        curr.extent.maxX += shift;
                        curr.xCenter += shift;
                        anyShift = true;
                    }
                }
            }
        }

        if (!anyShift) break;
    }
}

/**
 * Detect if sibling families interleave on X axis.
 * Returns details about which parent blocks have interleaving children.
 */
export function detectInterleaving(
    parentBlockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>
): { interleaved: boolean; details: string[] } {
    const details: string[] = [];
    const block = blocks.get(parentBlockId);
    if (!block || block.childBlockIds.length < 2) {
        return { interleaved: false, details };
    }

    const childExtents: Array<{
        blockId: FamilyBlockId;
        minX: number;
        maxX: number;
    }> = [];

    for (const childId of block.childBlockIds) {
        const extent = subtreeExtent(childId, blocks);
        childExtents.push({ blockId: childId, ...extent });
    }

    childExtents.sort((a, b) => a.minX - b.minX);

    for (let i = 1; i < childExtents.length; i++) {
        const prev = childExtents[i - 1];
        const curr = childExtents[i];

        if (curr.minX < prev.maxX) {
            details.push(
                `Block ${curr.blockId} [${curr.minX.toFixed(1)}, ${curr.maxX.toFixed(1)}] ` +
                `overlaps with ${prev.blockId} [${prev.minX.toFixed(1)}, ${prev.maxX.toFixed(1)}]`
            );
        }
    }

    return { interleaved: details.length > 0, details };
}

// ==================== BRANCH SEPARATION ====================

/**
 * Enforce branch separation: for each parent union with 2+ branches,
 * sweep left-to-right and shift entire branches to maintain horizontalGap.
 */
function _enforceBranchSeparation(
    branchModel: BranchModel,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    config: LayoutConfig
): void {
    for (const [, branchIds] of branchModel.parentUnionToBranches) {
        if (branchIds.length < 2) continue;

        const sortedBranches = branchIds
            .map(bid => branchModel.branches.get(bid))
            .filter((b): b is SiblingFamilyBranch => b !== undefined)
            .sort((a, b) => a.siblingIndex - b.siblingIndex);

        for (let i = 1; i < sortedBranches.length; i++) {
            const prev = sortedBranches[i - 1];
            const curr = sortedBranches[i];

            const overlap = prev.maxX + config.horizontalGap - curr.minX;
            if (overlap > 0.5) {
                const shift = overlap + 0.5;
                shiftBranch(curr, shift, branchModel, blocks);
            }
        }
    }
}

/**
 * Shift an entire branch (all blocks + sub-branches) by deltaX.
 */
function shiftBranch(
    branch: SiblingFamilyBranch,
    deltaX: number,
    branchModel: BranchModel,
    blocks: Map<FamilyBlockId, FamilyBlock>
): void {
    for (const blockId of branch.blockIds) {
        const block = blocks.get(blockId);
        if (!block) continue;
        block.xLeft += deltaX;
        block.xRight += deltaX;
        block.xCenter += deltaX;
        block.coupleCenterX += deltaX;
        block.husbandAnchorX += deltaX;
        block.wifeAnchorX += deltaX;
        block.childrenCenterX += deltaX;

        // Shift chain person positions
        if (block.chainInfo) {
            for (const [pid, x] of block.chainInfo.personPositions) {
                block.chainInfo.personPositions.set(pid, x + deltaX);
            }
        }
    }

    branch.minX += deltaX;
    branch.maxX += deltaX;

    for (const childBranchId of branch.childBranchIds) {
        const childBranch = branchModel.branches.get(childBranchId);
        if (childBranch) {
            childBranch.minX += deltaX;
            childBranch.maxX += deltaX;
        }
    }
}

/**
 * Recompute branch bounds from current block positions.
 */
function recomputeBranchBounds(
    branchModel: BranchModel,
    blocks: Map<FamilyBlockId, FamilyBlock>
): void {
    for (const branch of branchModel.branches.values()) {
        let minX = Infinity;
        let maxX = -Infinity;

        for (const blockId of branch.blockIds) {
            const block = blocks.get(blockId);
            if (!block) continue;
            minX = Math.min(minX, block.xLeft);
            maxX = Math.max(maxX, block.xRight);
        }

        if (isFinite(minX) && isFinite(maxX)) {
            branch.minX = minX;
            branch.maxX = maxX;
            branch.envelopeWidth = maxX - minX;
        }
    }
}

// ==================== PHASE B: OUTWARD ANCESTOR POSITIONING ====================

/**
 * Get all ancestor generations sorted from closest to focus (-1) to deepest.
 */
function getAncestorGenerations(blocks: Map<FamilyBlockId, FamilyBlock>): number[] {
    const gens = new Set<number>();
    for (const [, block] of blocks) {
        if (block.generation < 0) {
            gens.add(block.generation);
        }
    }
    return [...gens].sort((a, b) => b - a); // -1, -2, -3, ... (closest first)
}

/**
 * Get all blocks at a specific generation.
 */
function getBlocksAtGeneration(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    gen: number
): FamilyBlock[] {
    const result: FamilyBlock[] = [];
    for (const [, block] of blocks) {
        if (block.generation === gen) {
            result.push(block);
        }
    }
    return result;
}

/**
 * Find the focus block (gen 0, side BOTH).
 */
function findFocusBlock(blocks: Map<FamilyBlockId, FamilyBlock>): FamilyBlock | null {
    for (const [, block] of blocks) {
        if (block.generation === 0 && block.side === 'BOTH') {
            return block;
        }
    }
    return null;
}

/**
 * Compute the center of a block's children that are on the same side.
 * For ancestor blocks, this finds children with matching side OR BOTH (focus block).
 */
function computeSameSideChildrenCenter(
    block: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>
): number {
    const sameChildren: FamilyBlock[] = [];
    for (const childId of block.childBlockIds) {
        const child = blocks.get(childId);
        if (!child) continue;
        // Include child if same side OR if child is BOTH (focus block)
        if (child.side === block.side || child.side === 'BOTH') {
            sameChildren.push(child);
        }
    }

    if (sameChildren.length === 0) {
        return block.xCenter; // No children, keep current position
    }

    // Compute center of children's couple bounds
    let minX = Infinity, maxX = -Infinity;
    for (const child of sameChildren) {
        const left = child.xCenter - child.coupleWidth / 2;
        const right = child.xCenter + child.coupleWidth / 2;
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, right);
    }

    return (minX + maxX) / 2;
}

/**
 * Position ancestors outward with barrier-clamped centering.
 *
 * For each generation from -1 to deepest:
 *   - H-side: center over H-side children, clamp maxX <= husbandBarrier
 *   - W-side: center over W-side children, clamp minX >= wifeBarrier
 *
 * This replaces centerAncestorsInternally with barrier-first logic.
 */
function positionAncestorsOutward(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    husbandBarrier: number,
    wifeBarrier: number,
    _config: LayoutConfig
): void {
    const ancestorGens = getAncestorGenerations(blocks);

    for (const gen of ancestorGens) {
        const genBlocks = getBlocksAtGeneration(blocks, gen);

        for (const block of genBlocks) {
            if (block.side === 'BOTH') continue; // Skip focus block

            // Compute ideal center over same-side children
            const childrenCenter = computeSameSideChildrenCenter(block, blocks);

            // Clamp to barrier BEFORE setting position
            let targetCenter = childrenCenter;
            const coupleHalfWidth = block.coupleWidth / 2;

            if (block.side === 'HUSBAND') {
                const maxAllowedRight = husbandBarrier;
                if (targetCenter + coupleHalfWidth > maxAllowedRight) {
                    targetCenter = maxAllowedRight - coupleHalfWidth;
                }
            } else if (block.side === 'WIFE') {
                const minAllowedLeft = wifeBarrier;
                if (targetCenter - coupleHalfWidth < minAllowedLeft) {
                    targetCenter = minAllowedLeft + coupleHalfWidth;
                }
            }

            // Shift block (NOT subtree - ancestors shift individually)
            const delta = targetCenter - block.xCenter;
            if (Math.abs(delta) > 0.5) {
                shiftBlock(block, delta);
            }
        }
    }
}

/**
 * Resolve overlaps between ancestor blocks with outward-only push.
 * H-side blocks push LEFT, W-side blocks push RIGHT.
 * Handles within-side overlaps and cross-side overlaps.
 */
function resolveAncestorOverlapsOutward(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): number {
    let totalShift = 0;
    const ancestorGens = getAncestorGenerations(blocks);

    for (const gen of ancestorGens) {
        const genBlocks = getBlocksAtGeneration(blocks, gen);
        if (genBlocks.length < 2) continue;

        // Build sorted entries for ALL blocks in this generation
        const entries: Array<{
            block: FamilyBlock;
            left: number;
            right: number;
        }> = [];

        for (const block of genBlocks) {
            const extent = getBlockCardExtent(block, model, config);
            entries.push({ block, left: extent.left, right: extent.right });
        }

        // Sort by left position
        entries.sort((a, b) => a.left - b.left);

        // Resolve overlaps with outward-only push
        for (let i = 1; i < entries.length; i++) {
            const overlap = entries[i - 1].right + config.horizontalGap - entries[i].left;
            if (overlap <= 0.5) continue;

            const rightBlock = entries[i].block;
            const leftBlock = entries[i - 1].block;

            // Determine push direction based on sides
            if (rightBlock.side === 'WIFE') {
                // W-side: push RIGHT (outward)
                const shift = overlap + 0.5;
                shiftBlock(rightBlock, shift);
                entries[i].left += shift;
                entries[i].right += shift;
                totalShift += overlap;
            } else if (leftBlock.side === 'HUSBAND') {
                // H-side: push LEFT (outward)
                const shift = overlap + 0.5;
                shiftBlock(leftBlock, -shift);
                entries[i - 1].left -= shift;
                entries[i - 1].right -= shift;
                totalShift += overlap;
            } else if (leftBlock.side === 'WIFE' && rightBlock.side === 'HUSBAND') {
                // Unusual case: W left of H - push both outward (split)
                const halfShift = (overlap + 0.5) / 2;
                shiftBlock(leftBlock, -halfShift);
                entries[i - 1].left -= halfShift;
                entries[i - 1].right -= halfShift;
                shiftBlock(rightBlock, halfShift);
                entries[i].left += halfShift;
                entries[i].right += halfShift;
                totalShift += overlap;
            } else {
                // Remaining cases: (WIFE,BOTH), (BOTH,HUSBAND), (BOTH,BOTH)
                if (rightBlock.side === 'HUSBAND') {
                    // Right is HUSBAND: push left block further LEFT
                    const shift = overlap + 0.5;
                    shiftBlock(leftBlock, -shift);
                    entries[i - 1].left -= shift;
                    entries[i - 1].right -= shift;
                    totalShift += overlap;
                } else {
                    // Default: push right block further RIGHT
                    const shift = overlap + 0.5;
                    shiftBlock(rightBlock, shift);
                    entries[i].left += shift;
                    entries[i].right += shift;
                    totalShift += overlap;
                }
            }
        }
    }

    return totalShift;
}

/**
 * Enforce CAP (Couple Ancestor Polarity) for ALL ancestor couples.
 *
 * For EACH ancestor couple (gen < 0):
 * - Collect H-side (husband's parent union) ancestor subtree
 * - Collect W-side (wife's parent union) ancestor subtree
 * - Ensure H-side maxX < W-side minX (with gap)
 *
 * If violated, shift the W-side subtree to the right.
 */
function enforceCAPForAllCouples(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    // CAP = Couple Ancestor Polarity with ENVELOPE constraint (RECURSIVE)
    // For EVERY couple (H + W) in ancestor tree:
    //   - maxX(ancestorSubtree(H)) ≤ xH (right edge of H card)
    //   - minX(ancestorSubtree(W)) ≥ xW (left edge of W card)
    // When violated, shift the ENTIRE subtree (not individual blocks)

    // Helper: compute extent of a subtree
    function computeSubtreeExtent(subtree: FamilyBlock[]): { minX: number; maxX: number } {
        let minX = Infinity;
        let maxX = -Infinity;
        for (const b of subtree) {
            if (Math.abs(b.xLeft) > 5000 || Math.abs(b.xRight) > 5000) continue;
            minX = Math.min(minX, b.xLeft);
            maxX = Math.max(maxX, b.xRight);
        }
        return { minX, maxX };
    }

    // Helper: shift entire subtree by delta
    function shiftSubtree(subtree: FamilyBlock[], delta: number): void {
        for (const b of subtree) {
            shiftBlock(b, delta);
        }
    }

    // Helper: get H/W ids from union
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

    // Collect ALL couples to process (focus + all ancestors)
    const couplesToProcess: FamilyBlock[] = [];

    // Add focus block
    const focusBlock = findFocusBlock(blocks);
    if (focusBlock) couplesToProcess.push(focusBlock);

    // Add all ancestor blocks
    for (const [, block] of blocks) {
        if (block.generation < 0 && block.side !== 'BOTH') {
            couplesToProcess.push(block);
        }
    }

    // Sort by generation: process from DEEPEST (-N) to CLOSEST (-1, then 0)
    // This ensures inner constraints are satisfied first
    couplesToProcess.sort((a, b) => a.generation - b.generation);

    // Multiple passes to propagate changes
    for (let pass = 0; pass < 15; pass++) {
        let anyShift = false;

        for (const block of couplesToProcess) {
            const union = model.unions.get(block.rootUnionId);
            if (!union) continue;

            const hw = getHusbandWifeIds(union);
            if (!hw) continue;
            const { husbandId, wifeId } = hw;

            // Compute barriers from block position
            // xH = right edge of H card in couple
            // xW = left edge of W card in couple
            const xH = block.xCenter - config.partnerGap / 2;
            const xW = block.xCenter + config.partnerGap / 2;

            // Get ancestor subtrees
            const hSubtree = collectAncestorSubtreeBlocks(husbandId, model, unionToBlock, blocks);
            const wSubtree = collectAncestorSubtreeBlocks(wifeId, model, unionToBlock, blocks);

            // Check H subtree: maxX ≤ xH
            if (hSubtree.length > 0) {
                const hExtent = computeSubtreeExtent(hSubtree);
                if (isFinite(hExtent.maxX)) {
                    const overshoot = hExtent.maxX - xH;
                    if (overshoot > 0.5) {
                        // Shift ENTIRE H subtree left
                        shiftSubtree(hSubtree, -overshoot);
                        anyShift = true;
                    }
                }
            }

            // Check W subtree: minX ≥ xW
            if (wSubtree.length > 0) {
                const wExtent = computeSubtreeExtent(wSubtree);
                if (isFinite(wExtent.minX)) {
                    const undershoot = xW - wExtent.minX;
                    if (undershoot > 0.5) {
                        // Shift ENTIRE W subtree right
                        shiftSubtree(wSubtree, undershoot);
                        anyShift = true;
                    }
                }
            }
        }

        if (!anyShift) break; // Converged
    }
}

/**
 * Collect all ancestor blocks for a person's parent lineage.
 * Returns blocks in the ancestor tree (gen < 0 only).
 */
function collectAncestorSubtreeBlocks(
    personId: PersonId,
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

        // Recurse upward through both parents
        trace(parentUnion.partnerA);
        if (parentUnion.partnerB) trace(parentUnion.partnerB);
    }

    trace(personId);
    return result;
}

/**
 * Enforce FSPC barrier as hard constraint.
 * FSPC = Focus Spouse Parent Containment
 *
 * Barrier is now partner CENTER (not card edge):
 * - H-side ancestors: block.xRight <= husbandCenterX
 * - W-side ancestors: block.xLeft >= wifeCenterX
 *
 * Uses block.xRight/xLeft (measurement-time bounds) for checking.
 */
function enforceFSPCBarrier(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    _model: LayoutModel,
    husbandCenterX: number,
    wifeCenterX: number,
    _config: LayoutConfig
): void {
    for (const [, block] of blocks) {
        if (block.generation >= -1) continue; // Only gen -2 and beyond (skip gen -1)

        if (block.side === 'HUSBAND') {
            // H-side: right edge must not exceed husband's center
            const overshoot = block.xRight - husbandCenterX;
            if (overshoot > 0.5) {
                shiftBlock(block, -overshoot);
            }
        } else if (block.side === 'WIFE') {
            // W-side: left edge must not be less than wife's center
            const undershoot = wifeCenterX - block.xLeft;
            if (undershoot > 0.5) {
                shiftBlock(block, undershoot);
            }
        }
    }
}

/**
 * Enforce FSPC barrier AND resolve overlaps within each side.
 * This ensures:
 * 1. All H-side blocks have their right edge <= husbandCenterX
 * 2. All W-side blocks have their left edge >= wifeCenterX
 * 3. No overlaps exist within each side
 *
 * The approach: process each side separately, push blocks to respect barrier,
 * then resolve any overlaps by pushing further outward.
 */
function enforceFSPCWithOverlapResolution(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    husbandCenterX: number,
    wifeCenterX: number,
    config: LayoutConfig
): void {
    // Separate ancestors by side
    const hBlocks: FamilyBlock[] = [];
    const wBlocks: FamilyBlock[] = [];

    for (const [, block] of blocks) {
        if (block.generation >= -1) continue; // Only gen -2 and beyond (skip gen -1)
        if (block.side === 'HUSBAND') hBlocks.push(block);
        else if (block.side === 'WIFE') wBlocks.push(block);
    }

    // Helper to get visual extent
    const getExtent = (block: FamilyBlock) => getBlockCardExtent(block, model, config);

    // === H-side: enforce barrier (right edge <= husbandCenterX) ===
    // Then resolve overlaps by pushing LEFT (outward)
    for (const block of hBlocks) {
        const ext = getExtent(block);
        const overshoot = ext.right - husbandCenterX;
        if (overshoot > 0.5) {
            shiftBlock(block, -overshoot);
        }
    }

    // Sort H-side by right edge DESC (rightmost first) and resolve overlaps pushing LEFT
    hBlocks.sort((a, b) => getExtent(b).right - getExtent(a).right);
    for (let i = 0; i < hBlocks.length - 1; i++) {
        const rightBlock = hBlocks[i];
        const leftBlock = hBlocks[i + 1];
        const rightExt = getExtent(rightBlock);
        const leftExt = getExtent(leftBlock);
        const overlap = leftExt.right + config.horizontalGap - rightExt.left;
        if (overlap > 0.5) {
            // Push leftBlock further LEFT
            shiftBlock(leftBlock, -overlap);
        }
    }

    // === W-side: enforce barrier (left edge >= wifeCenterX) ===
    // Then resolve overlaps by pushing RIGHT (outward)
    for (const block of wBlocks) {
        const ext = getExtent(block);
        const undershoot = wifeCenterX - ext.left;
        if (undershoot > 0.5) {
            shiftBlock(block, undershoot);
        }
    }

    // Sort W-side by left edge ASC (leftmost first) and resolve overlaps pushing RIGHT
    wBlocks.sort((a, b) => getExtent(a).left - getExtent(b).left);
    for (let i = 0; i < wBlocks.length - 1; i++) {
        const leftBlock = wBlocks[i];
        const rightBlock = wBlocks[i + 1];
        const leftExt = getExtent(leftBlock);
        const rightExt = getExtent(rightBlock);
        const overlap = leftExt.right + config.horizontalGap - rightExt.left;
        if (overlap > 0.5) {
            // Push rightBlock further RIGHT
            shiftBlock(rightBlock, overlap);
        }
    }
}

// ==================== NEW PHASE B FUNCTIONS ====================

/**
 * ACIC: Ancestor Clamped Internal Centering
 *
 * Centers each ancestor block over its children's extent, but CLAMPED to
 * respect FSPC barriers. This prevents centering from pushing ancestors
 * across the barrier, avoiding needless FSPC enforcement iterations.
 *
 * For each ancestor block:
 *   targetX = center(children_extent)
 *   H-side: clampedX = min(targetX, husbandCenterX - blockHalfWidth)
 *   W-side: clampedX = max(targetX, wifeCenterX + blockHalfWidth)
 */
function centerAncestorsWithClamping(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    husbandCenterX: number,
    wifeCenterX: number,
    _config: LayoutConfig
): void {
    const ancestorBlocks: FamilyBlock[] = [];
    for (const [, block] of blocks) {
        if (block.generation < -1) ancestorBlocks.push(block); // Only gen -2 and beyond (skip gen -1)
    }

    // Sort deepest first (most negative generation first)
    ancestorBlocks.sort((a, b) => a.generation - b.generation);

    for (const block of ancestorBlocks) {
        const union = model.unions.get(block.rootUnionId);
        if (!union || union.childIds.length === 0) continue;

        // Compute extent of child blocks ON THE SAME SIDE
        let minX = Infinity;
        let maxX = -Infinity;

        for (const childPersonId of union.childIds) {
            const childUnionId = model.personToUnion.get(childPersonId);
            if (!childUnionId) continue;
            const childBlockId = unionToBlock.get(childUnionId);
            if (!childBlockId) continue;
            const childBlock = blocks.get(childBlockId);
            if (!childBlock) continue;

            // Only include children on the SAME SIDE
            const sameLineage =
                childBlock.side === block.side ||
                childBlock.side === 'BOTH' ||
                block.side === 'BOTH';

            if (!sameLineage) continue;

            // For gen -1 blocks, include gen 0 children
            // For deeper ancestors, only consider gen < 0 children
            if (block.generation === -1) {
                minX = Math.min(minX, childBlock.xLeft);
                maxX = Math.max(maxX, childBlock.xRight);
            } else {
                if (childBlock.generation >= 0) continue;
                minX = Math.min(minX, childBlock.xLeft);
                maxX = Math.max(maxX, childBlock.xRight);
            }
        }

        if (!isFinite(minX)) continue;

        const targetCenter = (minX + maxX) / 2;
        const blockHalfWidth = (block.xRight - block.xLeft) / 2;

        // CLAMP to barrier BEFORE applying shift
        let clampedCenter = targetCenter;
        if (block.side === 'HUSBAND') {
            // H-side: block.xRight <= husbandCenterX
            // So block.xCenter <= husbandCenterX - blockHalfWidth
            const maxAllowedCenter = husbandCenterX - blockHalfWidth;
            clampedCenter = Math.min(targetCenter, maxAllowedCenter);
        } else if (block.side === 'WIFE') {
            // W-side: block.xLeft >= wifeCenterX
            // So block.xCenter >= wifeCenterX + blockHalfWidth
            const minAllowedCenter = wifeCenterX + blockHalfWidth;
            clampedCenter = Math.max(targetCenter, minAllowedCenter);
        }

        const delta = clampedCenter - block.xCenter;
        if (Math.abs(delta) > 0.5) {
            shiftBlock(block, delta);
        }
    }
}

/**
 * ASO: Ancestor Side Ownership (per-couple recursive)
 *
 * For EACH ancestor couple (gen < 0):
 *   maxX(ancestors(H)) <= xCenter(H in couple)
 *   minX(ancestors(W)) >= xCenter(W in couple)
 *
 * This ensures ancestor subtrees don't cross the "seam" of their parent couple.
 */
function enforceAncestorSideOwnership(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    // Helper: get H/W ids from union
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

    // Collect all ancestor couples to process (gen -1 and beyond)
    // Gen -1 couples (focus parents) need ASO to separate their H/W ancestor subtrees
    const ancestorCouples: FamilyBlock[] = [];
    for (const [, block] of blocks) {
        if (block.generation >= 0) continue; // Only gen < 0 (ancestors)
        const union = model.unions.get(block.rootUnionId);
        if (!union || !union.partnerB) continue;
        ancestorCouples.push(block);
    }

    // Sort by generation: process from DEEPEST (-N) to CLOSEST (-2)
    ancestorCouples.sort((a, b) => a.generation - b.generation);

    for (const coupleBlock of ancestorCouples) {
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union) continue;

        const hw = getHusbandWifeIds(union);
        if (!hw) continue;
        const { husbandId, wifeId } = hw;

        // Compute barriers from couple position
        // xH = center of H card in couple
        // xW = center of W card in couple
        const xH = coupleBlock.xCenter - config.partnerGap / 2 - config.cardWidth / 2;
        const xW = coupleBlock.xCenter + config.partnerGap / 2 + config.cardWidth / 2;

        // Collect ENTIRE ancestor subtree for each side
        // This ensures that when we shift, the entire branch moves together
        function collectAncestorSubtree(personId: PersonId): FamilyBlock[] {
            const result: FamilyBlock[] = [];
            const visited = new Set<string>();
            const stack: PersonId[] = [personId];

            while (stack.length > 0) {
                const pid = stack.pop()!;
                const parentUnionId = model.childToParentUnion.get(pid);
                if (!parentUnionId) continue;

                const parentBlockId = unionToBlock.get(parentUnionId);
                if (!parentBlockId || visited.has(parentBlockId)) continue;
                visited.add(parentBlockId);

                const parentBlock = blocks.get(parentBlockId);
                if (!parentBlock) continue;

                // Must be at a deeper generation (more negative) than the couple
                if (parentBlock.generation >= coupleBlock.generation) continue;

                result.push(parentBlock);

                // Continue up the tree through both partners
                const parentUnion = model.unions.get(parentUnionId);
                if (parentUnion) {
                    stack.push(parentUnion.partnerA);
                    if (parentUnion.partnerB) stack.push(parentUnion.partnerB);
                }
            }

            return result;
        }

        const hSubtree = collectAncestorSubtree(husbandId);
        const wSubtree = collectAncestorSubtree(wifeId);

        // Check H subtree: maxX ≤ xH
        if (hSubtree.length > 0) {
            let hMaxX = -Infinity;
            for (const b of hSubtree) {
                if (Math.abs(b.xRight) < 5000) {
                    hMaxX = Math.max(hMaxX, b.xRight);
                }
            }
            if (isFinite(hMaxX)) {
                const overshoot = hMaxX - xH;
                if (overshoot > 0.5) {
                    // Shift H subtree left
                    for (const b of hSubtree) {
                        if (!guardAncestorOnly(b, 'ASO-H')) continue;
                        shiftBlock(b, -overshoot);
                    }
                }
            }
        }

        // Check W subtree: minX ≥ xW
        if (wSubtree.length > 0) {
            let wMinX = Infinity;
            for (const b of wSubtree) {
                if (Math.abs(b.xLeft) < 5000) {
                    wMinX = Math.min(wMinX, b.xLeft);
                }
            }
            if (isFinite(wMinX)) {
                const undershoot = xW - wMinX;
                if (undershoot > 0.5) {
                    // Shift ENTIRE W subtree right
                    for (const b of wSubtree) {
                        if (!guardAncestorOnly(b, 'ASO-W')) continue;
                        shiftBlock(b, undershoot);
                    }
                }
            }
        }
    }
}

/**
 * A-COMP: Ancestor Inward Compaction (v2 - Clean Implementation)
 *
 * Pulls ancestor blocks toward focus to close gaps, while respecting:
 * 1. Per-couple ASO barriers (husband's ancestors <= husband center, wife's ancestors >= wife center)
 * 2. Neighbor collision (minGap spacing)
 *
 * SCOPE:
 * - Only gen <= -2 (grandparents and up)
 * - Only side ∈ {HUSBAND, WIFE} (never BOTH)
 * - Uses shiftBlock() only (never shiftBlockSubtree)
 *
 * ALGORITHM:
 * - Process by generation from -2 to minGen
 * - H-side: sort left-to-right, push RIGHT toward focus
 * - W-side: sort right-to-left, push LEFT toward focus
 * - Use subtreeExtentSideOnly for barrier/collision checks
 *
 * MONOTONIC: Only reduces gaps, never creates overlaps or crosses barriers.
 */
function compactAncestorsInward(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): number {
    const minGap = config.horizontalGap;
    let totalShift = 0;

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
     * Get per-couple ASO barrier for a block.
     * Returns { husbandX, wifeX } - the centers of husband and wife in the CHILD couple.
     * This block's subtree must respect: maxX <= husbandX (if parent of H) or minX >= wifeX (if parent of W).
     */
    function getPerCoupleBarrier(block: FamilyBlock): { husbandX: number; wifeX: number; isParentOfHusband: boolean } | null {
        const union = model.unions.get(block.rootUnionId);
        if (!union) return null;

        // Find children of this union and their couples
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

            const husbandX = childBlock.xCenter - config.partnerGap / 2 - config.cardWidth / 2;
            const wifeX = childBlock.xCenter + config.partnerGap / 2 + config.cardWidth / 2;

            if (childId === hw.husbandId) {
                return { husbandX, wifeX, isParentOfHusband: true };
            } else if (childId === hw.wifeId) {
                return { husbandX, wifeX, isParentOfHusband: false };
            }
        }
        return null;
    }

    /**
     * Get the child block (next generation down) for an ancestor block.
     * Used for compaction toward descendants when no same-gen neighbor exists.
     */
    function getChildBlock(block: FamilyBlock): FamilyBlock | null {
        const union = model.unions.get(block.rootUnionId);
        if (!union) return null;

        // Find the first child that has a block
        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (!childUnionId) continue;
            const childBlockId = unionToBlock.get(childUnionId);
            if (!childBlockId) continue;
            const childBlock = blocks.get(childBlockId);
            if (childBlock) return childBlock;
        }
        return null;
    }

    // Group ancestor blocks by generation (only gen <= -2, only H/W side)
    const byGen = new Map<number, FamilyBlock[]>();
    for (const [, block] of blocks) {
        // GUARD: Only gen <= -2
        if (block.generation >= -1) continue;
        // GUARD: Only H/W side (never BOTH)
        if (block.side === 'BOTH') continue;

        if (!byGen.has(block.generation)) byGen.set(block.generation, []);
        byGen.get(block.generation)!.push(block);
    }

    // Process each generation from CLOSEST to DEEPEST (-2 to -N)
    const gens = Array.from(byGen.keys()).sort((a, b) => b - a);

    for (const gen of gens) {
        const genBlocks = byGen.get(gen)!;

        // Separate by block.side
        const hBlocks = genBlocks.filter(b => b.side === 'HUSBAND');
        const wBlocks = genBlocks.filter(b => b.side === 'WIFE');

        // === H-SIDE: sort left-to-right, push RIGHT toward focus ===
        hBlocks.sort((a, b) => a.xCenter - b.xCenter);

        for (let i = 0; i < hBlocks.length; i++) {
            const block = hBlocks[i];

            // Double-check guards
            if (block.generation >= -1) continue;
            if (block.side !== 'HUSBAND') continue;

            // Get subtree extent (side-only, ancestor-only)
            const extent = subtreeExtentSideOnly(block.id, blocks, true);

            // Get per-couple barrier
            const barrier = getPerCoupleBarrier(block);

            // Compute constraints (null = no constraint)
            // NOTE: We IGNORE ASO barrier here - let ASO pass fix violations after A-COMP
            // This allows A-COMP to actually pull blocks inward
            let dxCollision: number | null = null;
            let dxChild: number | null = null;

            // Collision with neighbor to the right (inner block)
            if (i < hBlocks.length - 1) {
                const neighbor = hBlocks[i + 1];
                const neighborExtent = subtreeExtentSideOnly(neighbor.id, blocks, true);
                dxCollision = Math.max(0, neighborExtent.minX - minGap - extent.maxX);
            }

            // Compact toward child block
            // This allows closing gaps between generations
            const childBlock = getChildBlock(block);
            if (childBlock) {
                // For H-side: can move right until block's center is under child's center
                const targetX = childBlock.xCenter;
                dxChild = Math.max(0, targetX - block.xCenter);
            }

            // Compute dx: use the most restrictive constraint
            let dx: number;
            const constraints = [dxCollision, dxChild].filter(c => c !== null) as number[];
            if (constraints.length > 0) {
                dx = Math.min(...constraints);
            } else {
                dx = 0; // No constraints at all
            }

            if (dx > 0.5) {
                shiftBlock(block, dx);
                totalShift += dx;
            }
        }

        // === W-SIDE: sort right-to-left, push LEFT toward focus ===
        wBlocks.sort((a, b) => b.xCenter - a.xCenter);

        for (let i = 0; i < wBlocks.length; i++) {
            const block = wBlocks[i];

            // Double-check guards
            if (block.generation >= -1) continue;
            if (block.side !== 'WIFE') continue;

            // Get subtree extent (side-only, ancestor-only)
            const extent = subtreeExtentSideOnly(block.id, blocks, true);

            // Compute constraints (null = no constraint, values are negative for leftward movement)
            // NOTE: We IGNORE ASO barrier here - let ASO pass fix violations after A-COMP
            let dxCollision: number | null = null;
            let dxChild: number | null = null;

            // Collision with neighbor to the left (inner block)
            if (i < wBlocks.length - 1) {
                const neighbor = wBlocks[i + 1];
                const neighborExtent = subtreeExtentSideOnly(neighbor.id, blocks, true);
                dxCollision = Math.min(0, neighborExtent.maxX + minGap - extent.minX);
            }

            // Compact toward child block
            // This allows closing gaps between generations
            const childBlock = getChildBlock(block);
            if (childBlock) {
                // For W-side: can move left until block's center is under child's center
                const targetX = childBlock.xCenter;
                dxChild = Math.min(0, targetX - block.xCenter);
            }

            // Compute dx: use the most restrictive constraint (max of negatives = less negative)
            let dx: number;
            const constraints = [dxCollision, dxChild].filter(c => c !== null) as number[];
            if (constraints.length > 0) {
                dx = Math.max(...constraints);
            } else {
                dx = 0; // No constraints at all
            }

            if (dx < -0.5) {
                shiftBlock(block, dx);
                totalShift += Math.abs(dx);
            }
        }
    }

    return totalShift;
}

/**
 * ASO with FSPC respect: Ancestor Side Ownership constrained by Focus barriers.
 *
 * For EACH ancestor couple (gen <= -2):
 *   - Ancestors of husband: maxX <= husband's center in that couple
 *   - Ancestors of wife: minX >= wife's center in that couple
 *
 * BUT the shift is CLAMPED to not violate FSPC:
 *   - H-side blocks: xRight <= focusHusbandCenter
 *   - W-side blocks: xLeft >= focusWifeCenter
 *
 * This means ASO may not be fully satisfied if it would violate FSPC.
 */
function enforceAncestorSideOwnershipWithFSPC(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    focusHusbandCenterX: number,
    focusWifeCenterX: number
): void {
    // Helper: get H/W ids from union
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

    // Collect all ancestor couples (gen <= -2)
    const ancestorCouples: FamilyBlock[] = [];
    for (const [, block] of blocks) {
        if (block.generation >= -1) continue;
        const union = model.unions.get(block.rootUnionId);
        if (!union || !union.partnerB) continue;
        ancestorCouples.push(block);
    }

    // Sort: process from DEEPEST to CLOSEST
    ancestorCouples.sort((a, b) => a.generation - b.generation);

    for (const coupleBlock of ancestorCouples) {
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union) continue;

        const hw = getHusbandWifeIds(union);
        if (!hw) continue;
        const { husbandId, wifeId } = hw;

        // Compute couple's partner centers
        const xH = coupleBlock.xCenter - config.partnerGap / 2 - config.cardWidth / 2;
        const xW = coupleBlock.xCenter + config.partnerGap / 2 + config.cardWidth / 2;

        // Get ancestor subtrees
        const hSubtree = collectAncestorSubtreeBlocks(husbandId, model, unionToBlock, blocks);
        const wSubtree = collectAncestorSubtreeBlocks(wifeId, model, unionToBlock, blocks);

        // Enforce H subtree: maxX <= xH
        if (hSubtree.length > 0) {
            let hMaxX = -Infinity;
            for (const b of hSubtree) {
                if (Math.abs(b.xRight) < 5000) {
                    hMaxX = Math.max(hMaxX, b.xRight);
                }
            }
            if (isFinite(hMaxX)) {
                const overshoot = hMaxX - xH;
                if (overshoot > 0.5) {
                    // Compute safe shift (respect FSPC for H-side blocks)
                    let safeShift = -overshoot;
                    // H-side blocks can only shift LEFT, which is always safe for FSPC
                    for (const b of hSubtree) {
                        if (!guardAncestorOnly(b, 'ASO-H-FSPC')) continue;
                        shiftBlock(b, safeShift);
                    }
                }
            }
        }

        // Enforce W subtree: minX >= xW (but respect FSPC!)
        if (wSubtree.length > 0) {
            let wMinX = Infinity;
            for (const b of wSubtree) {
                if (Math.abs(b.xLeft) < 5000) {
                    wMinX = Math.min(wMinX, b.xLeft);
                }
            }
            if (isFinite(wMinX)) {
                const undershoot = xW - wMinX;
                if (undershoot > 0.5) {
                    // W subtree needs to shift RIGHT, but must not violate FSPC
                    // For H-side blocks: after shift, xRight must <= focusHusbandCenterX
                    // For W-side blocks: no FSPC constraint on rightward movement

                    for (const b of wSubtree) {
                        if (!guardAncestorOnly(b, 'ASO-W-FSPC')) continue;

                        let safeShift = undershoot;

                        // If this block is on H-side of FOCUS, limit shift to not exceed FSPC
                        if (b.side === 'HUSBAND') {
                            const currentRight = b.xRight;
                            const maxAllowedRight = focusHusbandCenterX;
                            const maxShift = maxAllowedRight - currentRight;
                            if (maxShift < safeShift) {
                                safeShift = Math.max(0, maxShift);
                            }
                        }

                        if (safeShift > 0.5) {
                            shiftBlock(b, safeShift);
                        }
                    }
                }
            }
        }
    }
}

/**
 * A-COMP: Ancestor Side Compaction
 *
 * After FSPC/ASO enforcement, pull ancestor blocks toward focus to close gaps.
 * - H-side: sort by xCenter DESC, pull RIGHT toward husbandCenterX
 * - W-side: sort by xCenter ASC, pull LEFT toward wifeCenterX
 *
 * Guards against overlap with neighbors and respects barriers.
 */
function compactAncestorSides(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    husbandCenterX: number,
    wifeCenterX: number,
    config: LayoutConfig
): void {
    // Separate ancestors by side (gen -2 and beyond, skip gen -1)
    const hBlocks: FamilyBlock[] = [];
    const wBlocks: FamilyBlock[] = [];

    for (const [, block] of blocks) {
        if (block.generation >= -1) continue; // Only gen -2 and beyond (skip gen -1)
        if (block.side === 'HUSBAND') hBlocks.push(block);
        else if (block.side === 'WIFE') wBlocks.push(block);
    }

    // Helper to get visual extent
    const getExtent = (block: FamilyBlock) => getBlockCardExtent(block, model, config);

    // === H-side: sort by xCenter DESC, pull RIGHT toward focus ===
    hBlocks.sort((a, b) => b.xCenter - a.xCenter);

    for (let i = 0; i < hBlocks.length; i++) {
        const block = hBlocks[i];
        const ext = getExtent(block);

        // Max position: right edge <= husbandCenterX
        const maxRight = husbandCenterX;
        let targetRight = maxRight;

        // Check for neighbor to the right (closer to focus)
        for (let j = 0; j < i; j++) {
            const neighbor = hBlocks[j];
            const neighborExt = getExtent(neighbor);
            // Leave gap to neighbor
            const neighborBarrier = neighborExt.left - config.horizontalGap;
            targetRight = Math.min(targetRight, neighborBarrier);
        }

        // Compute safe pull (pull right = positive delta)
        const currentRight = ext.right;
        const safePull = targetRight - currentRight;

        if (safePull > 0.5) {
            shiftBlock(block, safePull);
        }
    }

    // === W-side: sort by xCenter ASC, pull LEFT toward focus ===
    wBlocks.sort((a, b) => a.xCenter - b.xCenter);

    for (let i = 0; i < wBlocks.length; i++) {
        const block = wBlocks[i];
        const ext = getExtent(block);

        // Min position: left edge >= wifeCenterX
        const minLeft = wifeCenterX;
        let targetLeft = minLeft;

        // Check for neighbor to the left (closer to focus)
        for (let j = 0; j < i; j++) {
            const neighbor = wBlocks[j];
            const neighborExt = getExtent(neighbor);
            // Leave gap to neighbor
            const neighborBarrier = neighborExt.right + config.horizontalGap;
            targetLeft = Math.max(targetLeft, neighborBarrier);
        }

        // Compute safe pull (pull left = negative delta)
        const currentLeft = ext.left;
        const safePull = currentLeft - targetLeft;

        if (safePull > 0.5) {
            shiftBlock(block, -safePull);
        }
    }
}

// ==================== LEGACY PHASE B FUNCTIONS (kept for compatibility) ====================

/**
 * @deprecated Use centerAncestorsWithClamping instead
 * A1: Center each ancestor block over the extent of its child blocks (gen < 0 only).
 */
function centerAncestorsInternally(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    _config: LayoutConfig
): void {
    const ancestorBlocks: FamilyBlock[] = [];
    for (const [, block] of blocks) {
        if (block.generation < -1) ancestorBlocks.push(block); // Only gen -2 and beyond (skip gen -1)
    }

    // Sort deepest first (most negative generation first)
    ancestorBlocks.sort((a, b) => a.generation - b.generation);

    for (const block of ancestorBlocks) {
        const union = model.unions.get(block.rootUnionId);
        if (!union || union.childIds.length === 0) continue;

        // Compute extent of child blocks ON THE SAME SIDE (same lineage)
        // This creates a compact vertical layout like MyHeritage
        let minX = Infinity;
        let maxX = -Infinity;

        for (const childPersonId of union.childIds) {
            const childUnionId = model.personToUnion.get(childPersonId);
            if (!childUnionId) continue;
            const childBlockId = unionToBlock.get(childUnionId);
            if (!childBlockId) continue;
            const childBlock = blocks.get(childBlockId);
            if (!childBlock) continue;

            // Only include children on the SAME SIDE as this block
            // BOTH (focus) is included for both H and W sides
            const sameLineage =
                childBlock.side === block.side ||
                childBlock.side === 'BOTH' ||
                block.side === 'BOTH';

            if (!sameLineage) continue;

            // For gen -1 blocks, include gen 0 children (descendants)
            // For deeper ancestors (gen < -1), only consider gen < 0 children
            if (block.generation === -1) {
                // Include all same-side children (gen 0 and gen < 0)
                minX = Math.min(minX, childBlock.xLeft);
                maxX = Math.max(maxX, childBlock.xRight);
            } else {
                // Only include same-side ancestor children (gen < 0)
                if (childBlock.generation >= 0) continue;
                minX = Math.min(minX, childBlock.xLeft);
                maxX = Math.max(maxX, childBlock.xRight);
            }
        }

        if (!isFinite(minX)) continue;

        const targetCenter = (minX + maxX) / 2;
        const delta = targetCenter - block.xCenter;
        if (Math.abs(delta) > 0.5) {
            shiftBlock(block, delta);
        }
    }
}

/**
 * FSPC: Focus Spouse Parent Containment (hard barrier).
 *
 * Enforces that ancestors stay on their correct side of the focus couple:
 * - H-side ancestors (partnerA's line): maxX <= husbandX (left edge of husband card)
 * - W-side ancestors (partnerB's line): minX >= wifeRightEdge (right edge of wife card)
 *
 * The barrier is defined by the FOCUS COUPLE at gen 0, not by each ancestor couple.
 * This prevents ancestors from crossing over the focus couple.
 */
function enforceFocusParentContainment(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    focusPersonId: PersonId,
    config: LayoutConfig
): void {
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
    // husbandX = left edge of husband card
    // wifeRightEdge = right edge of wife card
    const focusExt = getBlockCardExtent(focusBlock, model, config);
    const husbandX = focusExt.left;
    const wifeRightEdge = focusExt.right;

    // 3. H-side: collect all ancestors of partnerA, push LEFT if maxX > husbandX
    const hBlocks = collectAncestorSubtree(focusUnion.partnerA, model, unionToBlock, blocks);
    if (hBlocks.length > 0) {
        let hMaxX = -Infinity;
        for (const b of hBlocks) hMaxX = Math.max(hMaxX, b.xRight);
        if (hMaxX > husbandX + 0.5) {
            const dx = husbandX - hMaxX;  // negative (push left)
            shiftAncestorSubtree(hBlocks, dx);
        }
    }

    // 4. W-side: collect all ancestors of partnerB, push RIGHT if minX < wifeRightEdge
    const wBlocks = collectAncestorSubtree(focusUnion.partnerB, model, unionToBlock, blocks);
    if (wBlocks.length > 0) {
        let wMinX = Infinity;
        for (const b of wBlocks) wMinX = Math.min(wMinX, b.xLeft);
        if (wMinX < wifeRightEdge - 0.5) {
            const dx = wifeRightEdge - wMinX;  // positive (push right)
            shiftAncestorSubtree(wBlocks, dx);
        }
    }
}

/**
 * A2: Anchor barrier for side clusters (one-directional clamp).
 *
 * For each couple block with ancestors on both sides, enforces:
 * - H-side: directBlock.xRight <= husbandAnchorX (must not cross anchor toward seam)
 * - W-side: directBlock.xLeft >= wifeAnchorX (must not cross anchor toward seam)
 *
 * If a block is already on the correct side of its anchor, A2 does nothing.
 * If it crosses the anchor (extends toward the seam), A2 clamps it back.
 *
 * This is a one-directional barrier — it never pulls blocks TOWARD the anchor.
 * All horizontal expansion of ancestor clusters comes from A4 (overlap resolution)
 * and A1 (internal centering).
 *
 * NOTE: This function is now deprecated in favor of enforceFocusParentContainment,
 * which uses the focus couple card positions as the hard barrier.
 */
function _anchorAlignSideClusters(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    _config: LayoutConfig
): void {
    const coupleBlocks = findAncestorCoupleBlocks(blocks, model);
    // Process bottom-up (deepest couples first)
    coupleBlocks.sort((a, b) => a.generation - b.generation);

    for (const coupleBlock of coupleBlocks) {
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union || !union.partnerB) continue;

        const hBlocks = collectAncestorSubtree(union.partnerA, model, unionToBlock, blocks);
        const wBlocks = collectAncestorSubtree(union.partnerB, model, unionToBlock, blocks);

        if (hBlocks.length === 0 && wBlocks.length === 0) continue;

        // A2 for H-side: clamp if directBlock.xRight > husbandAnchorX
        // (block extends past anchor toward seam — push LEFT to boundary)
        if (hBlocks.length > 0) {
            const directBlock = findDirectParentBlock(union.partnerA, model, unionToBlock, blocks);
            if (directBlock && directBlock.xRight > coupleBlock.husbandAnchorX + 0.5) {
                const dx = coupleBlock.husbandAnchorX - directBlock.xRight; // negative (push left)
                shiftAncestorSubtree(hBlocks, dx);
            }
        }

        // A2 for W-side: clamp if directBlock.xLeft < wifeAnchorX
        // (block extends past anchor toward seam — push RIGHT to boundary)
        if (wBlocks.length > 0) {
            const directBlock = findDirectParentBlock(union.partnerB, model, unionToBlock, blocks);
            if (directBlock && directBlock.xLeft < coupleBlock.wifeAnchorX - 0.5) {
                const dx = coupleBlock.wifeAnchorX - directBlock.xLeft; // positive (push right)
                shiftAncestorSubtree(wBlocks, dx);
            }
        }
    }
}

/**
 * Find the direct parent block for a person (immediate ancestor union block).
 * Returns the block at gen < 0 that directly contains the person's parent union.
 */
function findDirectParentBlock(
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
 * A3: Clamp side clusters to seam.
 * Ensure H-side stays left of seam and W-side stays right of seam.
 */
function _clampSideClustersToSeam(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    const coupleBlocks = findAncestorCoupleBlocks(blocks, model);
    // Process deepest first, so higher-level (gen 0) couples have final say
    coupleBlocks.sort((a, b) => a.generation - b.generation);

    for (const coupleBlock of coupleBlocks) {
        const union = model.unions.get(coupleBlock.rootUnionId);
        if (!union || !union.partnerB) continue;

        const seamX = (coupleBlock.husbandAnchorX + coupleBlock.wifeAnchorX) / 2;
        const gap = config.horizontalGap;

        const hBlocks = collectAncestorSubtree(union.partnerA, model, unionToBlock, blocks);
        const wBlocks = collectAncestorSubtree(union.partnerB, model, unionToBlock, blocks);

        // H-side must stay LEFT of seam: extent.maxX <= seamX - gap
        if (hBlocks.length > 0) {
            let hMaxX = -Infinity;
            for (const b of hBlocks) {
                hMaxX = Math.max(hMaxX, b.xRight);
            }
            if (hMaxX > seamX - gap) {
                const dx = (seamX - gap) - hMaxX;
                shiftAncestorSubtree(hBlocks, dx);
            }
        }

        // W-side must stay RIGHT of seam: extent.minX >= seamX + gap
        if (wBlocks.length > 0) {
            let wMinX = Infinity;
            for (const b of wBlocks) {
                wMinX = Math.min(wMinX, b.xLeft);
            }
            if (wMinX < seamX + gap) {
                const dx = (seamX + gap) - wMinX;
                shiftAncestorSubtree(wBlocks, dx);
            }
        }
    }
}

/**
 * A4: Resolve overlaps between ancestor blocks outward-only.
 * H-side blocks push LEFT, W-side blocks push RIGHT.
 * Monotonic convergence guaranteed.
 */
function resolveOverlapsOutward(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    _unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): number {
    let totalShift = 0;

    // Group ancestor blocks by generation (gen -2 and beyond, skip gen -1)
    const byGen = new Map<number, FamilyBlock[]>();
    for (const [, block] of blocks) {
        if (block.generation >= -1) continue; // Only gen -2 and beyond (skip gen -1)
        if (!byGen.has(block.generation)) byGen.set(block.generation, []);
        byGen.get(block.generation)!.push(block);
    }

    for (const [, genBlocks] of byGen) {
        if (genBlocks.length < 2) continue;

        // Compute visual extents for overlap detection
        const entries: Array<{
            block: FamilyBlock;
            left: number;
            right: number;
        }> = [];

        for (const block of genBlocks) {
            const union = model.unions.get(block.rootUnionId);
            if (!union) continue;

            const ext = getBlockCardExtent(block, model, config);
            entries.push({ block, left: ext.left, right: ext.right });
        }

        entries.sort((a, b) => a.left - b.left);

        for (let i = 1; i < entries.length; i++) {
            const overlap = entries[i - 1].right + config.horizontalGap - entries[i].left;
            if (overlap <= 0.5) continue;

            const rightBlock = entries[i].block;
            const leftBlock = entries[i - 1].block;

            // Determine push direction based on sides
            if (rightBlock.side === 'WIFE') {
                // W-side: push RIGHT (outward)
                const shift = overlap + 0.5;
                shiftBlock(rightBlock, shift);
                entries[i].left += shift;
                entries[i].right += shift;
                totalShift += overlap;
            } else if (leftBlock.side === 'HUSBAND') {
                // H-side: push LEFT (outward)
                const shift = overlap + 0.5;
                shiftBlock(leftBlock, -shift);
                entries[i - 1].left -= shift;
                entries[i - 1].right -= shift;
                totalShift += overlap;
            } else if (leftBlock.side === 'WIFE' && rightBlock.side === 'HUSBAND') {
                // Unusual case: push both outward (split)
                const halfShift = (overlap + 0.5) / 2;
                shiftBlock(leftBlock, -halfShift);
                entries[i - 1].left -= halfShift;
                entries[i - 1].right -= halfShift;
                shiftBlock(rightBlock, halfShift);
                entries[i].left += halfShift;
                entries[i].right += halfShift;
                totalShift += overlap;
            } else {
                // Remaining cases: (WIFE,BOTH), (BOTH,HUSBAND), (BOTH,BOTH)
                if (rightBlock.side === 'HUSBAND') {
                    // Right is HUSBAND: push left block further LEFT
                    const shift = overlap + 0.5;
                    shiftBlock(leftBlock, -shift);
                    entries[i - 1].left -= shift;
                    entries[i - 1].right -= shift;
                    totalShift += overlap;
                } else {
                    // Default: push right block further RIGHT
                    const shift = overlap + 0.5;
                    shiftBlock(rightBlock, shift);
                    entries[i].left += shift;
                    entries[i].right += shift;
                    totalShift += overlap;
                }
            }
        }
    }

    return totalShift;
}

/**
 * Find all couple blocks at gen <= 0 that have both partners.
 */
function findAncestorCoupleBlocks(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel
): FamilyBlock[] {
    const result: FamilyBlock[] = [];
    for (const [, block] of blocks) {
        if (block.generation > 0) continue;
        const union = model.unions.get(block.rootUnionId);
        if (!union || !union.partnerB) continue;
        result.push(block);
    }
    return result;
}

/**
 * Collect all ancestor blocks belonging to one partner's line (gen < 0 only).
 * Traces upward from partnerId through childToParentUnion.
 * Includes sibling blocks at each level.
 */
function collectAncestorSubtree(
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
        // HARD GUARD: skip gen >= 0 blocks
        if (parentBlock.generation >= 0) return;

        result.push(parentBlock);

        const parentUnion = model.unions.get(parentUnionId);
        if (!parentUnion) return;

        // Include sibling blocks (siblings of the partner at this level)
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

        // Recurse upward through both parents of the parentUnion
        trace(parentUnion.partnerA);
        if (parentUnion.partnerB) trace(parentUnion.partnerB);
    }

    trace(partnerId);
    return result;
}

/**
 * Rigid shift of a list of ancestor blocks.
 * Guard: skips any block with generation >= 0 (throws in test mode).
 */
function shiftAncestorSubtree(blockList: FamilyBlock[], dx: number): void {
    for (const block of blockList) {
        if (!guardAncestorOnly(block, 'shiftAncestorSubtree')) continue;
        shiftBlock(block, dx);
    }
}

/**
 * Shift a single block rigidly (does not shift children or parents).
 */
function shiftBlock(block: FamilyBlock, deltaX: number): void {
    block.xLeft += deltaX;
    block.xRight += deltaX;
    block.xCenter += deltaX;
    block.coupleCenterX += deltaX;
    block.husbandAnchorX += deltaX;
    block.wifeAnchorX += deltaX;
    block.childrenCenterX += deltaX;

    // Shift chain person positions
    if (block.chainInfo) {
        for (const [pid, x] of block.chainInfo.personPositions) {
            block.chainInfo.personPositions.set(pid, x + deltaX);
        }
    }
}


// ==================== DESCENDANT PARENT RE-CENTERING ====================

/**
 * Re-center all descendant parent blocks (gen >= 0) over their children.
 * Processing order: bottom-up from deepest to gen 0.
 */
function recenterDescendantParents(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    personX: Map<PersonId, number>,
    config: LayoutConfig
): void {
    let maxGen = 0;
    for (const [, block] of blocks) {
        maxGen = Math.max(maxGen, block.generation);
    }

    for (let gen = maxGen - 1; gen >= 0; gen--) {
        for (const [, block] of blocks) {
            if (block.generation !== gen) continue;

            // Chain blocks: children are placed per-union under each partner
            // by step 5's placeChainChildrenPerUnion. Don't re-center globally.
            if (block.chainInfo) continue;

            const allChildIds: PersonId[] = [];
            const union = model.unions.get(block.rootUnionId);
            if (!union || union.childIds.length === 0) continue;
            allChildIds.push(...union.childIds);

            if (allChildIds.length === 0) continue;

            let minChildX = Infinity;
            let maxChildX = -Infinity;

            for (const childId of allChildIds) {
                // Try to get child's position from their block first
                const childUnionId = model.personToUnion.get(childId);
                if (childUnionId) {
                    const childBlockId = unionToBlock.get(childUnionId);
                    if (childBlockId) {
                        const childBlock = blocks.get(childBlockId);
                        if (childBlock) {
                            const childUnion = model.unions.get(childUnionId);
                            if (childUnion) {
                                const childWidth = childBlock.chainInfo
                                    ? childBlock.coupleWidth
                                    : childUnion.partnerB
                                        ? 2 * config.cardWidth + config.partnerGap
                                        : config.cardWidth;
                                minChildX = Math.min(minChildX, childBlock.xCenter - childWidth / 2);
                                maxChildX = Math.max(maxChildX, childBlock.xCenter + childWidth / 2);
                                continue;
                            }
                        }
                    }
                }
                // Fallback: use personX for children without blocks
                const cx = personX.get(childId);
                if (cx !== undefined) {
                    minChildX = Math.min(minChildX, cx);
                    maxChildX = Math.max(maxChildX, cx + config.cardWidth);
                }
            }

            if (!isFinite(minChildX)) continue;

            const childrenCenter = (minChildX + maxChildX) / 2;
            const delta = childrenCenter - block.xCenter;
            if (Math.abs(delta) > 0.5) {
                shiftBlock(block, delta);
            }
        }
    }
}

/**
 * Re-center sibling family parent blocks (gen = -1) over their children (gen = 0).
 * This handles aunt/uncle blocks that have cousins as children.
 * Called at the end of Phase A to ensure sibling family parents are properly centered.
 */
function recenterSiblingFamilyParents(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    for (const [, block] of blocks) {
        // Only process gen = -1 blocks (aunt/uncle level)
        if (block.generation !== -1) continue;

        // Chain blocks: children are placed per-union under each partner
        // by step 5's placeAncestorChainBlockChildren. Don't re-center globally.
        if (block.chainInfo) continue;

        const union = model.unions.get(block.rootUnionId);
        if (!union || union.childIds.length === 0) continue;

        // Check if any children are at gen = 0 (cousins)
        let hasGen0Children = false;
        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (childUnionId) {
                const childBlockId = unionToBlock.get(childUnionId);
                if (childBlockId) {
                    const childBlock = blocks.get(childBlockId);
                    if (childBlock && childBlock.generation === 0) {
                        hasGen0Children = true;
                        break;
                    }
                }
            }
        }

        if (!hasGen0Children) continue;

        // Compute children's center (using couple-bounds for accurate centering)
        let minChildX = Infinity;
        let maxChildX = -Infinity;

        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (childUnionId) {
                const childBlockId = unionToBlock.get(childUnionId);
                if (childBlockId) {
                    const childBlock = blocks.get(childBlockId);
                    if (childBlock) {
                        const childUnion = model.unions.get(childUnionId);
                        if (childUnion) {
                            const childWidth = childUnion.partnerB
                                ? 2 * config.cardWidth + config.partnerGap
                                : config.cardWidth;
                            minChildX = Math.min(minChildX, childBlock.xCenter - childWidth / 2);
                            maxChildX = Math.max(maxChildX, childBlock.xCenter + childWidth / 2);
                        }
                    }
                }
            }
        }

        if (!isFinite(minChildX)) continue;

        const childrenCenter = (minChildX + maxChildX) / 2;
        const delta = childrenCenter - block.xCenter;
        if (Math.abs(delta) > 0.5) {
            shiftBlock(block, delta);
        }
    }
}

/**
 * Enforce sibling family non-interleaving for gen=-1 blocks.
 * Ensures that siblings (aunts/uncles) without children don't intrude
 * into the family cluster space of siblings WITH children.
 *
 * This handles the case where a childless sibling visually overlaps
 * with another sibling's children cluster.
 */
function enforceSiblingFamilyNonInterleaving(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    focusPersonId: PersonId,
    config: LayoutConfig
): void {
    // Find the focus parent union
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return;

    const focusParentUnion = model.unions.get(focusParentUnionId);
    if (!focusParentUnion) return;

    // Process siblings of BOTH parents (father and mother)
    // This ensures siblings on both sides don't interleave with the parent
    const parentsToCheck = [focusParentUnion.partnerA];
    if (focusParentUnion.partnerB) {
        parentsToCheck.push(focusParentUnion.partnerB);
    }

    for (const parentId of parentsToCheck) {
        const grandparentUnionId = model.childToParentUnion.get(parentId);
        if (!grandparentUnionId) continue;

        const grandparentUnion = model.unions.get(grandparentUnionId);
        if (!grandparentUnion || grandparentUnion.childIds.length < 2) continue;

        enforceSiblingNonInterleavingForParent(
            grandparentUnion.childIds, blocks, model, unionToBlock, config
        );
    }
}

/**
 * Enforce non-interleaving for siblings from a single grandparent union.
 */
function enforceSiblingNonInterleavingForParent(
    siblingPersonIds: PersonId[],
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    if (siblingPersonIds.length < 2) return;

    // Collect sibling blocks at gen -1 with their family cluster extents
    interface SiblingData {
        personId: PersonId;
        blockId: FamilyBlockId;
        block: FamilyBlock;
        xCenter: number;
        clusterMinX: number;
        clusterMaxX: number;
        hasChildren: boolean;
    }

    const siblings: SiblingData[] = [];

    for (const siblingId of siblingPersonIds) {
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

        const sibUnion = model.unions.get(sibUnionId);
        const hasChildren = sibUnion ? sibUnion.childIds.length > 0 : false;

        siblings.push({
            personId: siblingId,
            blockId,
            block,
            xCenter: block.xCenter,
            clusterMinX: minX,
            clusterMaxX: maxX,
            hasChildren
        });
    }

    if (siblings.length < 2) return;

    // Sort by xCenter
    siblings.sort((a, b) => a.xCenter - b.xCenter);

    // Check for overlaps and shift childless siblings away from siblings with children
    const minGap = config.horizontalGap;

    for (let pass = 0; pass < 5; pass++) {
        let shifted = false;

        for (let i = 0; i < siblings.length - 1; i++) {
            const left = siblings[i];
            const right = siblings[i + 1];

            // Check if left's cluster overlaps with right's cluster
            const overlap = left.clusterMaxX + minGap - right.clusterMinX;
            if (overlap <= 0.5) continue;

            // Decide which one to shift:
            // - If left has no children and right has children: shift left to the LEFT
            // - Otherwise: shift right sibling (and all subsequent siblings) to the RIGHT
            //
            // Key insight: when shifting right, we must also shift all siblings further right
            // to avoid cascade conflicts (e.g., Josef between Růžena and Antonín)

            if (!left.hasChildren && right.hasChildren) {
                // Shift left sibling (and all preceding childless siblings) to the left
                const delta = -overlap;
                shiftBlockSubtree(left.blockId, delta, blocks);
                left.xCenter += delta;
                left.clusterMinX += delta;
                left.clusterMaxX += delta;
                shifted = true;
            } else {
                // Shift right sibling and all subsequent siblings to the right
                const delta = overlap;
                for (let j = i + 1; j < siblings.length; j++) {
                    const sib = siblings[j];
                    shiftBlockSubtree(sib.blockId, delta, blocks);
                    sib.xCenter += delta;
                    sib.clusterMinX += delta;
                    sib.clusterMaxX += delta;
                }
                shifted = true;
            }
        }

        if (!shifted) break;
    }
}

/**
 * Compact sibling family clusters: pull gen -1 sibling families together.
 * Moves entire family clusters (gen -1 parent + all descendants) as rigid units.
 * This closes gaps between cousin groups from different sibling families.
 */
function compactSiblingFamilyClusters(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    focusPersonId: PersonId,
    config: LayoutConfig
): void {
    // Minimum gap between sibling family clusters (larger than horizontalGap for visual separation)
    const SFC_MIN_GAP = config.horizontalGap * 2;  // 30px default

    // Find the focus parent union
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    if (!focusParentUnionId) return;

    const focusParentUnion = model.unions.get(focusParentUnionId);
    if (!focusParentUnion) return;

    // Compute FS (Focus Sibling) span - same as CSP does
    // FS = gen=0 blocks for children of focus's parent union
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

    // Chain blocks: include ALL gen=0 children from ALL unions in the chain.
    const focusParentBlockId2 = unionToBlock.get(focusParentUnionId);
    if (focusParentBlockId2) {
        const focusParentBlock2 = blocks.get(focusParentBlockId2);
        if (focusParentBlock2?.chainInfo) {
            for (const childId of focusParentBlock2.childBlockIds) {
                const childBlock = blocks.get(childId);
                if (childBlock && childBlock.generation === 0) {
                    fsBlockIds.add(childId);
                }
            }
        }
    }

    // Compute FS span (combined subtreeCardExtent of all FS blocks)
    let fsMinX = Infinity, fsMaxX = -Infinity;
    for (const blockId of fsBlockIds) {
        const ext = subtreeCardExtent(blockId, blocks, model, config);
        fsMinX = Math.min(fsMinX, ext.minX);
        fsMaxX = Math.max(fsMaxX, ext.maxX);
    }

    // Process BOTH sides of the family (paternal and maternal grandparents)
    const parentsToProcess: PersonId[] = [focusParentUnion.partnerA];
    if (focusParentUnion.partnerB) {
        parentsToProcess.push(focusParentUnion.partnerB);
    }

    for (const focusParent of parentsToProcess) {
        const grandparentUnionId = model.childToParentUnion.get(focusParent);
        if (!grandparentUnionId) continue;

        const grandparentUnion = model.unions.get(grandparentUnionId);
        if (!grandparentUnion || grandparentUnion.childIds.length < 2) continue;

        // Pass the FS span so we can respect CSP constraint
        compactOneSideOfFamily(blocks, model, unionToBlock, grandparentUnion, config, focusParent, fsMinX, fsMaxX);
    }
}

/**
 * Compact sibling families from one grandparent.
 * @param focusParent The focus person's parent on this side - we skip compacting toward their cluster
 * @param fsMinX Left edge of Focus Sibling span (cousins must not intrude)
 * @param fsMaxX Right edge of Focus Sibling span (cousins must not intrude)
 */
function compactOneSideOfFamily(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    grandparentUnion: { childIds: PersonId[] },
    config: LayoutConfig,
    focusParent: PersonId,
    fsMinX: number,
    fsMaxX: number
): void {
    const DEBUG = false /* DEBUG_SFC */;
    // Minimum gap between sibling family clusters (larger than horizontalGap for visual separation)
    const SFC_MIN_GAP = config.horizontalGap * 2;  // 30px default

    if (DEBUG) {
        const childNames = grandparentUnion.childIds.map(id => model.persons.get(id)?.firstName).join(', ');
        console.log(`\n=== SFC: Processing siblings: ${childNames} ===`);
    }

    // Collect sibling family clusters with their extents
    interface ClusterData {
        personId: PersonId;
        blockId: FamilyBlockId;
        clusterMinX: number;
        clusterMaxX: number;
    }

    const clusters: ClusterData[] = [];

    for (const siblingId of grandparentUnion.childIds) {
        const sibUnionId = model.personToUnion.get(siblingId);
        if (!sibUnionId) continue;

        const blockId = unionToBlock.get(sibUnionId);
        if (!blockId) continue;

        const block = blocks.get(blockId);
        if (!block || block.generation !== -1) continue;

        // Compute cluster extent using block.xLeft/xRight (same as SFNI)
        // This ensures consistency with SFNI invariant checking
        let minX = block.xLeft;
        let maxX = block.xRight;

        const stack = [...block.childBlockIds];
        const visited = new Set<FamilyBlockId>([blockId]);
        while (stack.length > 0) {
            const id = stack.pop()!;
            if (visited.has(id)) continue;
            visited.add(id);

            const b = blocks.get(id);
            if (!b) continue;

            minX = Math.min(minX, b.xLeft);
            maxX = Math.max(maxX, b.xRight);

            for (const childId of b.childBlockIds) {
                stack.push(childId);
            }
        }

        clusters.push({ personId: siblingId, blockId, clusterMinX: minX, clusterMaxX: maxX });

        if (DEBUG) {
            const person = model.persons.get(siblingId);
            console.log(`  ${person?.firstName}: cluster=[${minX.toFixed(0)}, ${maxX.toFixed(0)}]`);
        }
    }

    if (DEBUG) {
        console.log(`  Found ${clusters.length} clusters`);
    }

    if (clusters.length < 2) return;

    // Sort by cluster position (leftmost first)
    clusters.sort((a, b) => a.clusterMinX - b.clusterMinX);

    // Pull each cluster toward its left neighbor
    for (let i = 1; i < clusters.length; i++) {
        const left = clusters[i - 1];
        const right = clusters[i];

        // Skip pulling if the right cluster is the focus parent's cluster.
        // The focus parent's cluster contains the focus person's subtree,
        // and pulling it toward other clusters could cause CSP violations.
        if (right.personId === focusParent) {
            if (DEBUG) {
                const rightPerson = model.persons.get(right.personId);
                console.log(`  Skipping pull of ${rightPerson?.firstName} (focus parent cluster)`);
            }
            continue;
        }

        const gap = right.clusterMinX - left.clusterMaxX;
        const excess = gap - SFC_MIN_GAP;  // Use larger gap for visual separation

        if (DEBUG) {
            const leftPerson = model.persons.get(left.personId);
            const rightPerson = model.persons.get(right.personId);
            console.log(`  ${leftPerson?.firstName} -> ${rightPerson?.firstName}: gap=${gap.toFixed(0)}, excess=${excess.toFixed(0)}`);
        }

        if (excess <= 1) continue; // Already tight

        // Compute safe pull: check against ALL blocks (not just siblings)
        // to avoid colliding with clusters from the other side of the family
        // Uses block.xLeft/xRight for consistency with SFNI
        let safePull = excess;

        // Collect all blocks in the right cluster's subtree
        const subtreeIds = new Set<FamilyBlockId>();
        const stk = [right.blockId];
        while (stk.length > 0) {
            const id = stk.pop()!;
            if (subtreeIds.has(id)) continue;
            subtreeIds.add(id);
            const b = blocks.get(id);
            if (b) {
                for (const cid of b.childBlockIds) stk.push(cid);
            }
        }

        // For each block in subtree, check gap to nearest non-subtree block at same gen
        // Use CARD positions (not block extents) to prevent actual card overlap
        for (const subId of subtreeIds) {
            const subBlock = blocks.get(subId);
            if (!subBlock) continue;

            // Card left edge
            const subCardExt = getBlockCardExtent(subBlock, model, config);
            const subCardLeft = subCardExt.left;

            // Find nearest non-subtree block to the left at same generation
            for (const [otherId, otherBlock] of blocks) {
                if (subtreeIds.has(otherId)) continue;
                if (otherBlock.generation !== subBlock.generation) continue;

                // Card right edge
                const otherCardExt = getBlockCardExtent(otherBlock, model, config);
                const otherCardRight = otherCardExt.right;

                if (otherCardRight > subCardLeft) continue; // Not to the left

                const availableGap = subCardLeft - otherCardRight - config.horizontalGap;
                if (availableGap < safePull) {
                    safePull = availableGap;
                }
            }
        }

        // CSP constraint: gen=0 blocks (cousins) in the pulled cluster must not intrude into FS span
        // Check each gen=0 block and limit safePull if needed
        // NOTE: We're pulling LEFT (decreasing X), so check the LEFT edge of cousin blocks
        // (the left edge is what could intrude into FS span from the right)
        if (isFinite(fsMinX) && isFinite(fsMaxX)) {
            for (const subId of subtreeIds) {
                const subBlock = blocks.get(subId);
                if (!subBlock || subBlock.generation !== 0) continue;

                // This is a cousin block - compute its card extent
                const cspExt = getBlockCardExtent(subBlock, model, config);
                const subCardLeft = cspExt.left;

                // After pulling LEFT by safePull, new left edge would be: subCardLeft - safePull
                // This must not intrude into FS span (must stay >= fsMaxX + horizontalGap)
                const newLeftEdge = subCardLeft - safePull;
                const minAllowedLeftEdge = fsMaxX + config.horizontalGap;

                if (newLeftEdge < minAllowedLeftEdge) {
                    // Limit safePull to not intrude into FS span
                    const maxAllowedPull = subCardLeft - minAllowedLeftEdge;
                    if (maxAllowedPull < safePull) {
                        if (DEBUG) {
                            const cousinUnion = model.unions.get(subBlock.rootUnionId);
                            const cousinName = cousinUnion ? model.persons.get(cousinUnion.partnerA)?.firstName : '?';
                            console.log(`    CSP limit: ${cousinName} left edge would intrude FS, reducing safePull from ${safePull.toFixed(0)} to ${maxAllowedPull.toFixed(0)}`);
                        }
                        safePull = maxAllowedPull;
                    }
                }
            }
        }

        if (DEBUG) {
            const rightPerson = model.persons.get(right.personId);
            console.log(`    final safePull for ${rightPerson?.firstName}: ${safePull.toFixed(0)}`);
        }

        if (safePull <= 1) continue;

        // Pull the right cluster leftward
        const delta = -safePull;
        shiftBlockSubtree(right.blockId, delta, blocks);

        // Update cluster extents for subsequent iterations
        right.clusterMinX += delta;
        right.clusterMaxX += delta;
    }
}

// ==================== POSITION RECOMPUTATION ====================

/**
 * Recompute personX and unionX maps from final block positions.
 *
 * @param genModel Optional - if provided, gen>=0 children without blocks are NOT shifted
 *                 (preserves locked positions from Phase A)
 */
function recomputePositions(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    unionX: Map<UnionId, number>,
    personX: Map<PersonId, number>,
    genModel?: GenerationalModel
): void {
    for (const [, block] of blocks) {
        const union = model.unions.get(block.rootUnionId);
        if (!union) continue;

        const coupleCenter = block.xCenter;

        if (block.chainInfo) {
            // Chain block: extract positions from personPositions
            for (const [pid, centerX] of block.chainInfo.personPositions) {
                personX.set(pid, centerX - config.cardWidth / 2);
            }
            // Set unionX for each chain union:
            // - Primary union: midpoint between partners
            // - Secondary unions: extra partner's center (stem from that partner)
            const primaryUnionId = model.personToUnion.get(block.chainInfo.chainPersonId);
            for (const chainUnionId of block.chainInfo.unionIds) {
                const chainUnion = model.unions.get(chainUnionId);
                if (!chainUnion) continue;

                if (chainUnionId === primaryUnionId) {
                    const aCenterX = block.chainInfo.personPositions.get(chainUnion.partnerA);
                    const bCenterX = chainUnion.partnerB ? block.chainInfo.personPositions.get(chainUnion.partnerB) : null;
                    if (aCenterX !== undefined && bCenterX !== undefined && bCenterX !== null) {
                        unionX.set(chainUnionId, (aCenterX + bCenterX) / 2);
                    } else if (aCenterX !== undefined) {
                        unionX.set(chainUnionId, aCenterX);
                    }
                } else {
                    // Secondary: stem from extra partner's center
                    const extraPartner = findChainExtraPartner(chainUnion, block.chainInfo!, model);
                    if (extraPartner) {
                        const extraCenterX = block.chainInfo.personPositions.get(extraPartner);
                        if (extraCenterX !== undefined) {
                            unionX.set(chainUnionId, extraCenterX);
                        }
                    }
                }
            }
        } else {
            unionX.set(block.rootUnionId, coupleCenter);

            if (union.partnerB) {
                personX.set(union.partnerA, coupleCenter - config.partnerGap / 2 - config.cardWidth);
                personX.set(union.partnerB, coupleCenter + config.partnerGap / 2);
            } else {
                personX.set(union.partnerA, coupleCenter - config.cardWidth / 2);
            }
        }

        // Shift children without their own blocks to match the block's movement
        // BUT: skip gen>=0 children if genModel is provided (Phase B preservation)
        if (union.childIds.length > 0) {
            let childMinX = Infinity;
            let childMaxX = -Infinity;
            const childrenWithoutBlocks: Array<{ id: PersonId; x: number }> = [];

            for (const childId of union.childIds) {
                const childUnionId = model.personToUnion.get(childId);
                const hasOwnBlock = childUnionId && unionToBlock.has(childUnionId);
                const cx = personX.get(childId);
                if (cx !== undefined) {
                    childMinX = Math.min(childMinX, cx);
                    childMaxX = Math.max(childMaxX, cx + config.cardWidth);
                    if (!hasOwnBlock) {
                        // Skip gen>=0 children when genModel is provided (Phase B)
                        const childGen = genModel?.personGen.get(childId);
                        if (genModel && childGen !== undefined && childGen >= 0) {
                            continue; // Don't shift gen>=0 children - they're locked
                        }
                        childrenWithoutBlocks.push({ id: childId, x: cx });
                    }
                }
            }

            if (childrenWithoutBlocks.length > 0 && isFinite(childMinX)) {
                const currentChildrenCenter = (childMinX + childMaxX) / 2;
                const targetChildrenCenter = block.childrenCenterX;
                const deltaX = targetChildrenCenter - currentChildrenCenter;

                if (Math.abs(deltaX) > 0.1) {
                    for (const { id, x } of childrenWithoutBlocks) {
                        personX.set(id, x + deltaX);
                    }
                }
            }
        }
    }
}

// ==================== VALIDATION HELPERS ====================

/**
 * Validate that subtrees don't interleave (sibling families are isolated).
 */
export function validateSubtreeIsolation(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    _personX: Map<PersonId, number>,
    config: LayoutConfig
): { passed: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const [, block] of blocks) {
        const union = model.unions.get(block.rootUnionId);
        if (!union || union.childIds.length < 2) continue;

        const childBlocks: Array<{ id: FamilyBlockId; left: number; right: number }> = [];
        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            if (!childUnionId) continue;
            for (const [, b] of blocks) {
                if (b.rootUnionId === childUnionId) {
                    childBlocks.push({ id: b.id, left: b.xLeft, right: b.xRight });
                    break;
                }
            }
        }

        childBlocks.sort((a, b) => a.left - b.left);

        for (let i = 1; i < childBlocks.length; i++) {
            if (childBlocks[i].left < childBlocks[i - 1].right + config.horizontalGap - 0.5) {
                violations.push(
                    `Block ${childBlocks[i].id} overlaps with ${childBlocks[i - 1].id}`
                );
            }
        }
    }

    return { passed: violations.length === 0, violations };
}

/**
 * Validate that ancestor blocks fit within their descendant envelopes.
 */
export function validateAncestorEnvelope(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    personX: Map<PersonId, number>,
    config: LayoutConfig
): { passed: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const [, block] of blocks) {
        if (block.generation >= 0) continue;

        let minDescX = Infinity;
        let maxDescX = -Infinity;

        const visited = new Set<UnionId>();
        const queue: UnionId[] = [block.rootUnionId];

        while (queue.length > 0) {
            const uid = queue.shift()!;
            if (visited.has(uid)) continue;
            visited.add(uid);

            const union = model.unions.get(uid);
            if (!union) continue;

            for (const childId of union.childIds) {
                const px = personX.get(childId);
                if (px !== undefined) {
                    minDescX = Math.min(minDescX, px);
                    maxDescX = Math.max(maxDescX, px + config.cardWidth);
                }

                const childUnionId = model.personToUnion.get(childId);
                if (childUnionId && !visited.has(childUnionId)) {
                    queue.push(childUnionId);
                }
            }
        }

        if (!isFinite(minDescX)) continue;

        const ancestorLeft = block.xCenter - block.coupleWidth / 2;
        const ancestorRight = block.xCenter + block.coupleWidth / 2;

        if (ancestorLeft < minDescX - config.cardWidth || ancestorRight > maxDescX + config.cardWidth) {
            violations.push(
                `Ancestor block ${block.id} at [${ancestorLeft.toFixed(1)}, ${ancestorRight.toFixed(1)}] ` +
                `exceeds descendant span [${minDescX.toFixed(1)}, ${maxDescX.toFixed(1)}]`
            );
        }
    }

    return { passed: violations.length === 0, violations };
}
