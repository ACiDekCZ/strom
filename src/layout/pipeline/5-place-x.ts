/**
 * Step 5: Place X Positions (Envelope-Based Tree Geometry)
 *
 * Two phases:
 * Phase A: Place focus block and all descendants top-down.
 *          Children are spaced using envelopeWidth, then centered under parents
 *          using couple-bounds center.
 * Phase B: Place ancestors bottom-up (from focus outward), anchored to specific persons.
 *          Each ancestor block is centered over its children's couple-bounds.
 *
 * Key invariants guaranteed by this step:
 * - No overlap within sibling families (using envelope widths for spacing)
 * - Parent centered over children (using couple-bounds, not block envelopes)
 * - Rigid clusters: once placed, internal structure never splits
 */

import { PersonId, LayoutConfig } from '../../types.js';
import {
    PlaceXInput,
    PlacedModel,
    UnionId,
    UnionNode,
    FamilyBlock,
    FamilyBlockId,
    FamilyBlockModel,
    BranchModel,
    LayoutModel
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

/**
 * Place X positions using envelope-based tree geometry.
 */
export function placeX(input: PlaceXInput): PlacedModel {
    const { measured, config } = input;
    const { genModel } = measured;
    const { model } = genModel;

    const unionX = new Map<UnionId, number>();
    const personX = new Map<PersonId, number>();

    const fbm = measured as FamilyBlockModel;
    if (!fbm.blocks || fbm.blocks.size === 0 || fbm.rootBlockIds.length === 0) {
        return { measured, personX, unionX };
    }

    const blocks = fbm.blocks;

    // Find the focus block (side='BOTH' AND generation=0)
    let focusBlock: FamilyBlock | null = null;
    for (const [, block] of blocks) {
        if (block.side === 'BOTH' && block.generation === 0) {
            focusBlock = block;
            break;
        }
    }

    if (!focusBlock) {
        return { measured, personX, unionX };
    }

    // Track which blocks have been placed
    const placedBlocks = new Set<FamilyBlockId>();

    // Phase A: Place focus block at origin and all descendants top-down
    setBlockPosition(focusBlock, 0, config);
    placedBlocks.add(focusBlock.id);
    placeDescendantsTopDown(focusBlock, blocks, model, fbm.unionToBlock, config, placedBlocks);

    // Phase B: Place ancestors (bottom-up from focus, anchored to person positions)
    const focusUnion = model.unions.get(focusBlock.rootUnionId);
    if (focusUnion) {
        // Place husband-side ancestors (anchored to partnerA card center)
        const husbandParentUnion = model.childToParentUnion.get(focusUnion.partnerA);
        if (husbandParentUnion) {
            placeAncestorChain(
                husbandParentUnion,
                focusBlock.husbandAnchorX,
                focusUnion.partnerA,
                blocks,
                model,
                fbm.unionToBlock,
                config,
                placedBlocks
            );
        }

        // Place wife-side ancestors (anchored to partnerB card center)
        if (focusUnion.partnerB) {
            const wifeParentUnion = model.childToParentUnion.get(focusUnion.partnerB);
            if (wifeParentUnion) {
                placeAncestorChain(
                    wifeParentUnion,
                    focusBlock.wifeAnchorX,
                    focusUnion.partnerB,
                    blocks,
                    model,
                    fbm.unionToBlock,
                    config,
                    placedBlocks
                );
            }
        }
    }

    // Place any remaining unplaced blocks (edge cases)
    placeRemainingBlocks(blocks, model, fbm.unionToBlock, config, placedBlocks);

    // Compute branch bounds from final block positions
    const branchModel = measured as BranchModel;
    if (branchModel.branches && branchModel.branches.size > 0) {
        computeBranchBounds(branchModel, blocks);
    }

    // Extract personX/unionX from final block positions
    extractPositions(blocks, model, config, personX, unionX);

    return { measured, personX, unionX };
}

// ==================== PHASE A: DESCENDANTS (TOP-DOWN) ====================

/**
 * Place all descendants of a block top-down using envelope widths.
 * Children are placed left-to-right using envelopeWidth for spacing,
 * then shifted so parent is centered over children's couple-bounds.
 */
function placeDescendantsTopDown(
    parentBlock: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    placedBlocks: Set<FamilyBlockId>
): void {
    if (parentBlock.childBlockIds.length === 0) return;

    // Chain blocks: place children per-union under each partner's position
    if (parentBlock.chainInfo && parentBlock.chainInfo.unionChildBlockIds.size > 0) {
        placeChainChildrenPerUnion(parentBlock, blocks, model, unionToBlock, config, placedBlocks);
        return;
    }

    // Standard block: center all children under parent
    // Step 1: Compute total width using envelopeWidth for each child
    let totalWidth = 0;
    for (const childId of parentBlock.childBlockIds) {
        const childBlock = blocks.get(childId);
        if (childBlock) {
            totalWidth += childBlock.envelopeWidth;
        }
    }
    totalWidth += (parentBlock.childBlockIds.length - 1) * config.horizontalGap;

    // Step 2: Place children left-to-right, centered under parent
    let x = parentBlock.xCenter - totalWidth / 2;
    for (const childId of parentBlock.childBlockIds) {
        const childBlock = blocks.get(childId);
        if (!childBlock) continue;
        const childCenter = x + childBlock.envelopeWidth / 2;
        setBlockPosition(childBlock, childCenter, config);
        placedBlocks.add(childId);
        x += childBlock.envelopeWidth + config.horizontalGap;
    }

    // Step 3: Compute couple-bounds centering correction
    const correction = computeCenteringCorrection(parentBlock, blocks, model, unionToBlock);
    if (Math.abs(correction) > 0.001) {
        for (const childId of parentBlock.childBlockIds) {
            shiftSubtree(childId, correction, blocks);
        }
    }

    // Step 4: Update childrenCenterX
    updateChildrenCenter(parentBlock, blocks);

    // Step 5: Recurse into each child
    for (const childId of parentBlock.childBlockIds) {
        const childBlock = blocks.get(childId);
        if (childBlock) {
            placeDescendantsTopDown(childBlock, blocks, model, unionToBlock, config, placedBlocks);
        }
    }

    // Step 6: Update parent xLeft/xRight to match actual children extent (bottom-up)
    updateBlockExtentFromChildren(parentBlock, blocks);
}

/**
 * Place children of a chain block per-union.
 * Each union's children are centered under the appropriate anchor:
 * - Primary union children: centered under couple midpoint
 * - Secondary union children: centered under the extra partner
 */
function placeChainChildrenPerUnion(
    parentBlock: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    placedBlocks: Set<FamilyBlockId>
): void {
    if (!parentBlock.chainInfo) return;

    const { chainPersonId, unionChildBlockIds } = parentBlock.chainInfo;
    const primaryUnionId = model.personToUnion.get(chainPersonId);

    // For each union in the chain, place its children centered under the anchor
    for (const [unionId, childBlockIds] of unionChildBlockIds) {
        if (childBlockIds.length === 0) continue;

        // Determine anchor X for this union's children
        let anchorX: number;
        if (unionId === primaryUnionId) {
            // Primary union: children center under couple midpoint
            const union = model.unions.get(unionId);
            if (union && union.partnerB) {
                const aX = parentBlock.chainInfo.personPositions.get(union.partnerA);
                const bX = parentBlock.chainInfo.personPositions.get(union.partnerB);
                anchorX = (aX !== undefined && bX !== undefined) ? (aX + bX) / 2 : parentBlock.xCenter;
            } else {
                anchorX = parentBlock.xCenter;
            }
        } else {
            // Secondary union: children center under extra partner
            const union = model.unions.get(unionId);
            if (!union) continue;
            const extraPartner = findChainExtraPartner(union, parentBlock.chainInfo!, model);
            if (extraPartner) {
                anchorX = parentBlock.chainInfo.personPositions.get(extraPartner) ?? parentBlock.xCenter;
            } else {
                anchorX = parentBlock.xCenter;
            }
        }

        // Place this union's children centered under anchorX
        let groupWidth = 0;
        for (const cbId of childBlockIds) {
            const cb = blocks.get(cbId);
            if (cb) groupWidth += cb.envelopeWidth;
        }
        groupWidth += (childBlockIds.length - 1) * config.horizontalGap;

        let x = anchorX - groupWidth / 2;
        for (const cbId of childBlockIds) {
            const cb = blocks.get(cbId);
            if (!cb) continue;
            const childCenter = x + cb.envelopeWidth / 2;
            setBlockPosition(cb, childCenter, config);
            placedBlocks.add(cbId);
            x += cb.envelopeWidth + config.horizontalGap;
        }
    }

    // Update childrenCenterX
    updateChildrenCenter(parentBlock, blocks);

    // Recurse into each child
    for (const childId of parentBlock.childBlockIds) {
        const childBlock = blocks.get(childId);
        if (childBlock) {
            placeDescendantsTopDown(childBlock, blocks, model, unionToBlock, config, placedBlocks);
        }
    }

    // Update extents
    updateBlockExtentFromChildren(parentBlock, blocks);
}

// ==================== PHASE B: ANCESTORS (ANCHOR-BASED) ====================

/**
 * Place an ancestor chain starting from a parent union, anchored to a specific person.
 *
 * Algorithm:
 * 1. Find the ancestor block for this union
 * 2. Find which child block contains the anchor person (direct-line child)
 * 3. Place sibling blocks around the direct-line child
 * 4. Place each sibling's descendants
 * 5. Center the ancestor block over all children's couple-bounds
 * 6. Recurse UP: place this ancestor's own parents
 */
function placeAncestorChain(
    ancestorUnionId: UnionId,
    anchorX: number,
    anchorPersonId: PersonId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    placedBlocks: Set<FamilyBlockId>
): void {
    const blockId = unionToBlock.get(ancestorUnionId);
    if (!blockId) return;

    const block = blocks.get(blockId);
    if (!block) return;
    if (placedBlocks.has(blockId)) return;

    // Find direct-line child (the child block that contains the anchor person's union)
    // IMPORTANT: The anchor person's union block may NOT be in childBlockIds if it was
    // already claimed by another parent (e.g., FocusCouple is child of BOTH husband's parents
    // and wife's parents, but can only have one parentBlockId).
    const anchorUnionId = model.personToUnion.get(anchorPersonId);
    let directLineChildId: FamilyBlockId | null = null;

    // First priority: check if anchor person's union block exists and is placed
    // (even if not in childBlockIds - it may have been claimed by another parent)
    if (anchorUnionId) {
        const anchorBlockId = unionToBlock.get(anchorUnionId);
        if (anchorBlockId && placedBlocks.has(anchorBlockId)) {
            directLineChildId = anchorBlockId;
        }
    }

    // Second priority: look in childBlockIds
    if (!directLineChildId) {
        for (const childBlockId of block.childBlockIds) {
            if (placedBlocks.has(childBlockId)) {
                // This child is already placed - it's the direct-line
                directLineChildId = childBlockId;
                break;
            }
            // Check if this child block contains the anchor person's union
            const childBlock = blocks.get(childBlockId);
            if (childBlock && anchorUnionId && childBlock.rootUnionId === anchorUnionId) {
                directLineChildId = childBlockId;
                break;
            }
        }
    }

    if (!directLineChildId) {
        // Fallback: find any placed child or use first child
        for (const childBlockId of block.childBlockIds) {
            if (placedBlocks.has(childBlockId)) {
                directLineChildId = childBlockId;
                break;
            }
        }
        if (!directLineChildId && block.childBlockIds.length > 0) {
            directLineChildId = block.childBlockIds[0];
        }
    }

    if (!directLineChildId) {
        // No children - just place the block at anchor
        setBlockPosition(block, anchorX, config);
        placedBlocks.add(blockId);
        return;
    }

    const directLineChild = blocks.get(directLineChildId);
    if (!directLineChild) {
        setBlockPosition(block, anchorX, config);
        placedBlocks.add(blockId);
        return;
    }

    // If direct-line child is not placed yet, place it at anchor
    if (!placedBlocks.has(directLineChildId)) {
        setBlockPosition(directLineChild, anchorX, config);
        placedBlocks.add(directLineChildId);
        placeDescendantsTopDown(directLineChild, blocks, model, unionToBlock, config, placedBlocks);
    }

    // Chain ancestor blocks: use per-union placement for children
    if (block.chainInfo && block.chainInfo.unionChildBlockIds.size > 0) {
        placeAncestorChainBlockChildren(
            block, ancestorUnionId, anchorX, directLineChild,
            blocks, model, unionToBlock, config, placedBlocks
        );
        placedBlocks.add(blockId);
    } else {
        // Determine sibling direction based on anchor person's role in their couple.
        // Ancestor Side Ownership (ASO): siblings of a husband fan LEFT, siblings of a wife fan RIGHT.
        const anchorUnionId2 = model.personToUnion.get(anchorPersonId);
        let sibDir: 'LEFT' | 'RIGHT' | 'NATURAL' = 'NATURAL';
        if (anchorUnionId2) {
            const anchorUnion = model.unions.get(anchorUnionId2);
            if (anchorUnion) {
                if (anchorUnion.partnerA === anchorPersonId) {
                    sibDir = 'LEFT';  // Husband's siblings go left
                } else if (anchorUnion.partnerB === anchorPersonId) {
                    sibDir = 'RIGHT'; // Wife's siblings go right
                }
            }
        }

        // Place sibling blocks around the direct-line child
        placeSiblingsAround(block, directLineChild, blocks, model, unionToBlock, config, placedBlocks, sibDir);

        // Center parent block over all children's couple-bounds
        centerBlockOverChildren(block, blocks, model, unionToBlock, config);
        placedBlocks.add(blockId);
    }

    // Recurse UP: place this block's own ancestor chains
    const union = model.unions.get(block.rootUnionId);
    if (!union) return;

    // PartnerA's parent chain
    const partnerAParent = model.childToParentUnion.get(union.partnerA);
    if (partnerAParent) {
        const parentBlockId = unionToBlock.get(partnerAParent);
        if (parentBlockId && !placedBlocks.has(parentBlockId)) {
            placeAncestorChain(
                partnerAParent,
                block.husbandAnchorX,
                union.partnerA,
                blocks,
                model,
                unionToBlock,
                config,
                placedBlocks
            );
        }
    }

    // PartnerB's parent chain
    if (union.partnerB) {
        const partnerBParent = model.childToParentUnion.get(union.partnerB);
        if (partnerBParent) {
            const parentBlockId = unionToBlock.get(partnerBParent);
            if (parentBlockId && !placedBlocks.has(parentBlockId)) {
                placeAncestorChain(
                    partnerBParent,
                    block.wifeAnchorX,
                    union.partnerB,
                    blocks,
                    model,
                    unionToBlock,
                    config,
                    placedBlocks
                );
            }
        }
    }
}

/**
 * Place children of an ancestor chain block per-union.
 *
 * The direct-line child is already placed at anchorX. We position the chain block
 * so the appropriate union anchor aligns with the direct-line child, then place
 * remaining children centered under their respective extra partners.
 */
function placeAncestorChainBlockChildren(
    block: FamilyBlock,
    ancestorUnionId: UnionId,
    anchorX: number,
    directLineChild: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    placedBlocks: Set<FamilyBlockId>
): void {
    if (!block.chainInfo) return;

    const { unionChildBlockIds } = block.chainInfo;

    // === PASS 1: Place ancestor union's unplaced children as siblings of the direct-line child ===
    const ancestorChildBlockIds = unionChildBlockIds.get(ancestorUnionId) ?? [];
    const unplacedSiblings = ancestorChildBlockIds.filter(id => !placedBlocks.has(id));

    if (unplacedSiblings.length > 0) {
        // Place unplaced siblings to the right of the direct-line child
        let x = directLineChild.xCenter + directLineChild.envelopeWidth / 2 + config.horizontalGap;
        for (const cbId of unplacedSiblings) {
            const cb = blocks.get(cbId);
            if (!cb) continue;
            const childCenter = x + cb.envelopeWidth / 2;
            setBlockPosition(cb, childCenter, config);
            placedBlocks.add(cbId);
            placeDescendantsTopDown(cb, blocks, model, unionToBlock, config, placedBlocks);
            x += cb.envelopeWidth + config.horizontalGap;
        }
    }

    // Compute children center for the ancestor union (ALL children: placed + just-placed)
    let minChildX = Infinity, maxChildX = -Infinity;
    for (const cbId of ancestorChildBlockIds) {
        const cb = blocks.get(cbId);
        if (!cb) continue;
        minChildX = Math.min(minChildX, cb.xCenter - cb.envelopeWidth / 2);
        maxChildX = Math.max(maxChildX, cb.xCenter + cb.envelopeWidth / 2);
    }
    const childrenSpanCenter = minChildX < Infinity ? (minChildX + maxChildX) / 2 : anchorX;

    // === PASS 2: Position chain block so the ancestor union's couple is centered over children ===
    setBlockPosition(block, 0, config);

    // Compute the ancestor union's couple offset at position 0
    let coupleOffset: number;
    const ancestorUnion = model.unions.get(ancestorUnionId);
    if (ancestorUnion) {
        const extraPartner = findChainExtraPartner(ancestorUnion, block.chainInfo, model);
        if (extraPartner) {
            // Secondary union → center extra partner over children
            coupleOffset = block.chainInfo.personPositions.get(extraPartner) ?? 0;
        } else {
            // Primary union → center couple midpoint over children
            if (ancestorUnion.partnerB) {
                const aX = block.chainInfo.personPositions.get(ancestorUnion.partnerA);
                const bX = block.chainInfo.personPositions.get(ancestorUnion.partnerB);
                coupleOffset = (aX !== undefined && bX !== undefined) ? (aX + bX) / 2 : 0;
            } else {
                coupleOffset = 0;
            }
        }
    } else {
        coupleOffset = 0;
    }

    // Position block so couple center aligns with children center
    setBlockPosition(block, childrenSpanCenter - coupleOffset, config);

    // === PASS 3: Place secondary unions' children under their extra partners ===
    for (const [unionId, childBlockIds] of unionChildBlockIds) {
        if (unionId === ancestorUnionId) continue; // already handled

        const unplacedIds = childBlockIds.filter(id => !placedBlocks.has(id));
        if (unplacedIds.length === 0) continue;

        // Get extra partner position for this union
        const su = model.unions.get(unionId);
        if (!su) continue;
        const extraPartner = findChainExtraPartner(su, block.chainInfo, model);
        const uAnchorX = extraPartner
            ? (block.chainInfo.personPositions.get(extraPartner) ?? block.xCenter)
            : block.xCenter;

        // Center children under the extra partner
        let groupWidth = 0;
        for (const cbId of unplacedIds) {
            const cb = blocks.get(cbId);
            if (cb) groupWidth += cb.envelopeWidth;
        }
        groupWidth += (unplacedIds.length - 1) * config.horizontalGap;

        let x = uAnchorX - groupWidth / 2;
        for (const cbId of unplacedIds) {
            const cb = blocks.get(cbId);
            if (!cb) continue;
            const childCenter = x + cb.envelopeWidth / 2;
            setBlockPosition(cb, childCenter, config);
            placedBlocks.add(cbId);
            placeDescendantsTopDown(cb, blocks, model, unionToBlock, config, placedBlocks);
            x += cb.envelopeWidth + config.horizontalGap;
        }
    }

    // Handle any children not in unionChildBlockIds
    for (const childId of block.childBlockIds) {
        if (!placedBlocks.has(childId)) {
            const cb = blocks.get(childId);
            if (cb) {
                setBlockPosition(cb, block.xCenter, config);
                placedBlocks.add(childId);
                placeDescendantsTopDown(cb, blocks, model, unionToBlock, config, placedBlocks);
            }
        }
    }

    // Update children center and extents
    updateChildrenCenter(block, blocks);
    updateBlockExtentFromChildren(block, blocks);
}

/**
 * Place sibling blocks around an already-placed anchor child.
 *
 * siblingDirection controls where siblings are placed:
 * - 'LEFT': ALL siblings go to the LEFT of anchor (for HUSBAND-side ancestors)
 * - 'RIGHT': ALL siblings go to the RIGHT of anchor (for WIFE-side ancestors)
 * - 'NATURAL': siblings placed left/right based on childBlockIds order (default)
 *
 * This ensures Ancestor Side Ownership (ASO): siblings of a partner
 * fan out away from the couple, not across it.
 *
 * NOTE: The anchorChild may NOT be in parentBlock.childBlockIds if it was claimed
 * by another parent block (e.g., FocusCouple is child of both husband's parents and
 * wife's parents, but can only have one parentBlockId). In this case, we still
 * use its position as the anchor for placing siblings.
 */
function placeSiblingsAround(
    parentBlock: FamilyBlock,
    anchorChild: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    placedBlocks: Set<FamilyBlockId>,
    siblingDirection: 'LEFT' | 'RIGHT' | 'NATURAL' = 'NATURAL'
): void {
    const childIds = parentBlock.childBlockIds;
    const anchorIndex = childIds.indexOf(anchorChild.id);

    // If anchor is not in childBlockIds (claimed by another parent), we still need to
    // place the siblings. Use the anchor's position as reference and place siblings
    // according to siblingDirection, but treat them all as being "outside" the anchor.
    if (anchorIndex === -1) {
        // Place all children to the appropriate side of the anchor
        if (siblingDirection === 'LEFT') {
            // All siblings go to the LEFT of anchor
            let leftEdge = anchorChild.xLeft;
            // Place in reverse order so rightmost sibling is closest to anchor
            for (let i = childIds.length - 1; i >= 0; i--) {
                const sibBlock = blocks.get(childIds[i]);
                if (!sibBlock) continue;
                if (placedBlocks.has(childIds[i])) {
                    leftEdge = Math.min(leftEdge, sibBlock.xLeft);
                    continue;
                }
                // Use envelopeWidth to account for descendant subtrees
                const sibCenter = leftEdge - config.horizontalGap - sibBlock.envelopeWidth / 2;
                setBlockPosition(sibBlock, sibCenter, config);
                placedBlocks.add(childIds[i]);
                placeDescendantsTopDown(sibBlock, blocks, model, unionToBlock, config, placedBlocks);
                leftEdge = sibBlock.xLeft;
            }
        } else if (siblingDirection === 'RIGHT') {
            // All siblings go to the RIGHT of anchor
            let rightEdge = anchorChild.xRight;
            // Place in natural order so leftmost sibling is closest to anchor
            for (let i = 0; i < childIds.length; i++) {
                const sibBlock = blocks.get(childIds[i]);
                if (!sibBlock) continue;
                if (placedBlocks.has(childIds[i])) {
                    rightEdge = Math.max(rightEdge, sibBlock.xRight);
                    continue;
                }
                // Use envelopeWidth to account for descendant subtrees
                const sibCenter = rightEdge + config.horizontalGap + sibBlock.envelopeWidth / 2;
                setBlockPosition(sibBlock, sibCenter, config);
                placedBlocks.add(childIds[i]);
                placeDescendantsTopDown(sibBlock, blocks, model, unionToBlock, config, placedBlocks);
                rightEdge = sibBlock.xRight;
            }
        } else {
            // NATURAL: Let placeRemainingBlocks handle this case
            // (original behavior - return early and let fallback handle it)
            return;
        }
        return;
    }

    if (siblingDirection === 'LEFT') {
        // ALL siblings go to the LEFT of anchor, ordered right-to-left
        // Siblings that are naturally to the right come first (closest to anchor),
        // then siblings that are naturally to the left (further from anchor).
        const leftSibs: FamilyBlockId[] = [];
        // First: siblings to the right of anchor (placed closest to anchor on left)
        for (let i = anchorIndex + 1; i < childIds.length; i++) {
            leftSibs.push(childIds[i]);
        }
        // Then: siblings to the left of anchor (placed further left)
        for (let i = anchorIndex - 1; i >= 0; i--) {
            leftSibs.push(childIds[i]);
        }

        let leftEdge = anchorChild.xLeft;
        for (const sibId of leftSibs) {
            const sibBlock = blocks.get(sibId);
            if (!sibBlock) continue;
            if (placedBlocks.has(sibId)) {
                leftEdge = Math.min(leftEdge, sibBlock.xLeft);
                continue;
            }
            const sibCenter = leftEdge - config.horizontalGap - sibBlock.width / 2;
            setBlockPosition(sibBlock, sibCenter, config);
            placedBlocks.add(sibId);
            placeDescendantsTopDown(sibBlock, blocks, model, unionToBlock, config, placedBlocks);
            leftEdge = sibBlock.xLeft;
        }
    } else if (siblingDirection === 'RIGHT') {
        // ALL siblings go to the RIGHT of anchor, ordered left-to-right
        // Siblings that are naturally to the left come first (closest to anchor),
        // then siblings that are naturally to the right (further from anchor).
        const rightSibs: FamilyBlockId[] = [];
        // First: siblings to the left of anchor (placed closest to anchor on right)
        for (let i = anchorIndex - 1; i >= 0; i--) {
            rightSibs.push(childIds[i]);
        }
        // Then: siblings to the right of anchor (placed further right)
        for (let i = anchorIndex + 1; i < childIds.length; i++) {
            rightSibs.push(childIds[i]);
        }

        let rightEdge = anchorChild.xRight;
        for (const sibId of rightSibs) {
            const sibBlock = blocks.get(sibId);
            if (!sibBlock) continue;
            if (placedBlocks.has(sibId)) {
                rightEdge = Math.max(rightEdge, sibBlock.xRight);
                continue;
            }
            const sibCenter = rightEdge + config.horizontalGap + sibBlock.width / 2;
            setBlockPosition(sibBlock, sibCenter, config);
            placedBlocks.add(sibId);
            placeDescendantsTopDown(sibBlock, blocks, model, unionToBlock, config, placedBlocks);
            rightEdge = sibBlock.xRight;
        }
    } else {
        // NATURAL: original behavior — left siblings go left, right siblings go right
        let rightEdge = anchorChild.xRight;
        for (let i = anchorIndex + 1; i < childIds.length; i++) {
            const sibBlock = blocks.get(childIds[i]);
            if (!sibBlock) continue;
            if (placedBlocks.has(childIds[i])) {
                rightEdge = sibBlock.xRight;
                continue;
            }
            const sibCenter = rightEdge + config.horizontalGap + sibBlock.width / 2;
            setBlockPosition(sibBlock, sibCenter, config);
            placedBlocks.add(childIds[i]);
            placeDescendantsTopDown(sibBlock, blocks, model, unionToBlock, config, placedBlocks);
            rightEdge = sibBlock.xRight;
        }

        let leftEdge = anchorChild.xLeft;
        for (let i = anchorIndex - 1; i >= 0; i--) {
            const sibBlock = blocks.get(childIds[i]);
            if (!sibBlock) continue;
            if (placedBlocks.has(childIds[i])) {
                leftEdge = sibBlock.xLeft;
                continue;
            }
            const sibCenter = leftEdge - config.horizontalGap - sibBlock.width / 2;
            setBlockPosition(sibBlock, sibCenter, config);
            placedBlocks.add(childIds[i]);
            placeDescendantsTopDown(sibBlock, blocks, model, unionToBlock, config, placedBlocks);
            leftEdge = sibBlock.xLeft;
        }
    }
}

/**
 * Place an ancestor union from envelope constraints.
 * Exported for potential external use.
 */
export function placeUnionFromEnvelope(
    blockId: FamilyBlockId,
    anchorX: number,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    const block = blocks.get(blockId);
    if (!block) return;

    setBlockPosition(block, anchorX, config);

    // Place descendants if any unplaced children
    const placedBlocks = new Set<FamilyBlockId>();
    placedBlocks.add(blockId);
    placeDescendantsTopDown(block, blocks, model, unionToBlock, config, placedBlocks);
}

// ==================== REMAINING BLOCKS ====================

/**
 * Place any blocks that haven't been placed yet.
 * Handles edge cases where blocks aren't reachable through normal traversal.
 */
function placeRemainingBlocks(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    placedBlocks: Set<FamilyBlockId>
): void {
    let changed = true;
    while (changed) {
        changed = false;

        for (const [blockId, block] of blocks) {
            if (placedBlocks.has(blockId)) continue;

            // Strategy 1: find a placed child to anchor on
            let anchorChild: FamilyBlock | null = null;
            for (const childBlockId of block.childBlockIds) {
                if (placedBlocks.has(childBlockId)) {
                    anchorChild = blocks.get(childBlockId) ?? null;
                    if (anchorChild) break;
                }
            }

            if (anchorChild) {
                placeSiblingsAround(block, anchorChild, blocks, model, unionToBlock, config, placedBlocks);
                centerBlockOverChildren(block, blocks, model, unionToBlock, config);
                placedBlocks.add(blockId);
                changed = true;
                continue;
            }

            // Strategy 2: find anchor via model relationships
            const union = model.unions.get(block.rootUnionId);
            if (!union) continue;

            let anchorX: number | null = null;
            for (const childId of union.childIds) {
                const childUnionId = model.personToUnion.get(childId);
                if (!childUnionId) continue;
                const childBlockId = unionToBlock.get(childUnionId);
                if (!childBlockId) continue;
                if (placedBlocks.has(childBlockId)) {
                    const childBlock = blocks.get(childBlockId);
                    if (childBlock) {
                        anchorX = childBlock.xCenter;
                        break;
                    }
                }
            }

            if (anchorX === null) continue;

            setBlockPosition(block, anchorX, config);
            if (block.childBlockIds.length > 0) {
                placeDescendantsTopDown(block, blocks, model, unionToBlock, config, placedBlocks);
                centerBlockOverChildren(block, blocks, model, unionToBlock, config);
            }
            placedBlocks.add(blockId);
            changed = true;
        }
    }
}

// ==================== HELPERS ====================

/**
 * Set block position with proper anchor computation.
 */
function setBlockPosition(block: FamilyBlock, centerX: number, config: LayoutConfig): void {
    block.xCenter = centerX;
    block.xLeft = centerX - block.width / 2;
    block.xRight = centerX + block.width / 2;
    block.coupleCenterX = centerX;

    if (block.chainInfo) {
        // Chain block: compute X positions with variable slot widths
        // Extra partners with wider subtrees get bigger slots
        const personOrder = block.chainInfo.personOrder;
        const personCount = personOrder.length;
        const startX = centerX - block.coupleWidth / 2;

        let x = startX;
        for (let i = 0; i < personCount; i++) {
            if (i > 0) x += config.partnerGap;
            const slotWidth = block.chainInfo.personSlotWidths.get(personOrder[i]) ?? config.cardWidth;
            const personCenterX = x + slotWidth / 2;
            block.chainInfo.personPositions.set(personOrder[i], personCenterX);
            x += slotWidth;
        }

        // Husband anchor = first person center, wife anchor = last person center
        block.husbandAnchorX = block.chainInfo.personPositions.get(personOrder[0]) ?? centerX;
        block.wifeAnchorX = block.chainInfo.personPositions.get(personOrder[personCount - 1]) ?? centerX;
    } else if (block.coupleWidth > config.cardWidth) {
        block.husbandAnchorX = centerX - config.partnerGap / 2 - config.cardWidth / 2;
        block.wifeAnchorX = centerX + config.partnerGap / 2 + config.cardWidth / 2;
    } else {
        block.husbandAnchorX = centerX;
        block.wifeAnchorX = centerX;
    }
}

/**
 * Shift block and ALL its descendants by deltaX (rigid shift).
 */
function shiftSubtree(
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

/**
 * Update block xLeft/xRight to match actual children extent.
 * Called bottom-up after children are placed to ensure block bounds
 * reflect actual placement, not just measured widths.
 */
function updateBlockExtentFromChildren(
    block: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>
): void {
    if (block.childBlockIds.length === 0) return;

    let actualMinX = Infinity;
    let actualMaxX = -Infinity;

    // Include all children's extent
    for (const childBlockId of block.childBlockIds) {
        const childBlock = blocks.get(childBlockId);
        if (childBlock) {
            actualMinX = Math.min(actualMinX, childBlock.xLeft);
            actualMaxX = Math.max(actualMaxX, childBlock.xRight);
        }
    }

    // Also include parent couple extent
    const parentHalfCouple = block.coupleWidth / 2;
    actualMinX = Math.min(actualMinX, block.xCenter - parentHalfCouple);
    actualMaxX = Math.max(actualMaxX, block.xCenter + parentHalfCouple);

    if (isFinite(actualMinX) && isFinite(actualMaxX)) {
        block.xLeft = actualMinX;
        block.xRight = actualMaxX;
    }
}

/**
 * Compute centering correction so parent center aligns with children's couple-bounds center.
 */
function computeCenteringCorrection(
    parentBlock: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>
): number {
    const union = model.unions.get(parentBlock.rootUnionId);
    if (!union || union.childIds.length === 0) return 0;

    let minX = Infinity;
    let maxX = -Infinity;

    for (const childId of union.childIds) {
        const childUnionId = model.personToUnion.get(childId);
        if (!childUnionId) continue;

        const childBlockId = unionToBlock.get(childUnionId);
        if (!childBlockId) continue;

        const childBlock = blocks.get(childBlockId);
        if (!childBlock) continue;

        const halfWidth = childBlock.coupleWidth / 2;
        minX = Math.min(minX, childBlock.xCenter - halfWidth);
        maxX = Math.max(maxX, childBlock.xCenter + halfWidth);
    }

    if (!isFinite(minX) || !isFinite(maxX)) return 0;

    const childrenCenter = (minX + maxX) / 2;
    return parentBlock.xCenter - childrenCenter;
}

/**
 * Center a block over its children's couple-bounds.
 * Also updates block.xLeft/xRight to match actual children extent.
 */
function centerBlockOverChildren(
    parentBlock: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    const union = model.unions.get(parentBlock.rootUnionId);
    if (!union || union.childIds.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;

    for (const childId of union.childIds) {
        const childUnionId = model.personToUnion.get(childId);
        if (!childUnionId) continue;

        const childBlockId = unionToBlock.get(childUnionId);
        if (!childBlockId) continue;

        const childBlock = blocks.get(childBlockId);
        if (!childBlock) continue;

        const halfWidth = childBlock.coupleWidth / 2;
        minX = Math.min(minX, childBlock.xCenter - halfWidth);
        maxX = Math.max(maxX, childBlock.xCenter + halfWidth);
    }

    if (!isFinite(minX) || !isFinite(maxX)) {
        // Fallback: use block centers
        const firstChild = blocks.get(parentBlock.childBlockIds[0]);
        const lastChild = blocks.get(parentBlock.childBlockIds[parentBlock.childBlockIds.length - 1]);
        if (firstChild && lastChild) {
            setBlockPosition(parentBlock, (firstChild.xCenter + lastChild.xCenter) / 2, config);
        }
        return;
    }

    const childrenCenter = (minX + maxX) / 2;
    setBlockPosition(parentBlock, childrenCenter, config);
    updateChildrenCenter(parentBlock, blocks);

    // Update xLeft/xRight to match actual children extent
    updateBlockExtentFromChildren(parentBlock, blocks);
}

/**
 * Update the childrenCenterX field based on current child positions.
 */
function updateChildrenCenter(
    parentBlock: FamilyBlock,
    blocks: Map<FamilyBlockId, FamilyBlock>
): void {
    if (parentBlock.childBlockIds.length === 0) {
        parentBlock.childrenCenterX = parentBlock.xCenter;
        return;
    }

    const firstChild = blocks.get(parentBlock.childBlockIds[0]);
    const lastChild = blocks.get(parentBlock.childBlockIds[parentBlock.childBlockIds.length - 1]);
    if (firstChild && lastChild) {
        parentBlock.childrenCenterX = (firstChild.xCenter + lastChild.xCenter) / 2;
    } else {
        parentBlock.childrenCenterX = parentBlock.xCenter;
    }
}

// ==================== POSITION EXTRACTION ====================

/**
 * Extract personX and unionX maps from final block positions.
 */
function extractPositions(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig,
    personX: Map<PersonId, number>,
    unionX: Map<UnionId, number>
): void {
    for (const [, block] of blocks) {
        if (block.chainInfo) {
            // Chain block: extract positions for all persons from personPositions
            for (const [pid, centerX] of block.chainInfo.personPositions) {
                personX.set(pid, centerX - config.cardWidth / 2);
            }

            // Set unionX for each chain union:
            // - Primary union: midpoint between partners (standard stem)
            // - Secondary unions: extra partner's center (stem from that partner)
            const primaryUnionId = model.personToUnion.get(block.chainInfo.chainPersonId);
            for (const chainUnionId of block.chainInfo.unionIds) {
                const chainUnion = model.unions.get(chainUnionId);
                if (!chainUnion) continue;

                if (chainUnionId === primaryUnionId) {
                    // Primary union: midpoint between partners
                    const aCenterX = block.chainInfo.personPositions.get(chainUnion.partnerA);
                    const bCenterX = chainUnion.partnerB ? block.chainInfo.personPositions.get(chainUnion.partnerB) : null;
                    if (aCenterX !== undefined && bCenterX !== undefined && bCenterX !== null) {
                        unionX.set(chainUnionId, (aCenterX + bCenterX) / 2);
                    } else if (aCenterX !== undefined) {
                        unionX.set(chainUnionId, aCenterX);
                    }
                } else {
                    // Secondary union: stem from the extra partner's center
                    const extraPartner = findChainExtraPartner(chainUnion, block.chainInfo!, model);
                    if (extraPartner) {
                        const extraCenterX = block.chainInfo.personPositions.get(extraPartner);
                        if (extraCenterX !== undefined) {
                            unionX.set(chainUnionId, extraCenterX);
                        }
                    } else {
                        // Single-parent secondary union (shouldn't happen, fallback)
                        const aCenterX = block.chainInfo.personPositions.get(chainUnion.partnerA);
                        if (aCenterX !== undefined) unionX.set(chainUnionId, aCenterX);
                    }
                }
            }
            continue;
        }

        const union = model.unions.get(block.rootUnionId);
        if (!union) continue;

        const coupleCenter = block.xCenter;
        unionX.set(block.rootUnionId, coupleCenter);

        if (union.partnerB) {
            personX.set(union.partnerA, coupleCenter - config.partnerGap / 2 - config.cardWidth);
            personX.set(union.partnerB, coupleCenter + config.partnerGap / 2);
        } else {
            personX.set(union.partnerA, coupleCenter - config.cardWidth / 2);
        }
    }
}

// ==================== BRANCH BOUNDS ====================

/**
 * Compute branch bounds (minX, maxX) from final block positions.
 * Called after all placement is complete.
 */
function computeBranchBounds(
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
