/**
 * Step 4: Build FamilyBlocks and Measure Widths
 *
 * Builds a FamilyBlock tree from the focus union and computes widths bottom-up:
 * - coupleWidth: cardWidth*2 + partnerGap (or cardWidth for single)
 * - childrenWidth: sum(child.width) + (n-1)*horizontalGap
 * - width: max(coupleWidth, childrenWidth)
 *
 * Also populates legacy width maps for backward compatibility with Steps 7/8.
 */

import { PersonId, LayoutConfig } from '../../types.js';
import {
    MeasureInput,
    FamilyBlockModel,
    BranchModel,
    SiblingFamilyBranch,
    FamilyBlock,
    FamilyBlockId,
    BranchId,
    BlockSide,
    UnionId,
    GenerationalModel,
    LayoutModel,
    toFamilyBlockId,
    toBranchId
} from './types.js';
import { getChildUnions } from './2-build-model.js';

/**
 * Build FamilyBlocks, measure all widths, and compute branch structure.
 * Returns a BranchModel (superset of FamilyBlockModel with branch separation data).
 */
export function measureSubtrees(input: MeasureInput): BranchModel {
    const { genModel, config } = input;
    const { model } = genModel;

    // Find focus person (gen=0)
    const focusPersonId = input.focusPersonId ??
        Array.from(genModel.personGen.entries()).find(([, gen]) => gen === 0)?.[0];

    if (!focusPersonId) {
        return emptyBranchModel(genModel, config);
    }

    const focusUnionId = model.personToUnion.get(focusPersonId);
    if (!focusUnionId) {
        return emptyBranchModel(genModel, config);
    }

    // Build FamilyBlock tree
    const blocks = new Map<FamilyBlockId, FamilyBlock>();
    const unionToBlock = new Map<UnionId, FamilyBlockId>();

    // Build focus block and its descendants
    const focusBlockId = buildBlockRecursive(
        focusUnionId,
        null,
        'BOTH',
        genModel,
        model,
        config,
        blocks,
        unionToBlock
    );

    if (focusBlockId) {
        // Build ancestor blocks
        const focusUnion = model.unions.get(focusUnionId);
        if (focusUnion) {
            // Determine which partner is the focus person (if any)
            // The focus person's parent chain is the "true" focus parents
            const isFocusPersonPartnerA = focusUnion.partnerA === focusPersonId;
            const isFocusPersonPartnerB = focusUnion.partnerB === focusPersonId;

            // PartnerA (husband) ancestors
            buildAncestorBlocks(
                focusUnion.partnerA,
                focusBlockId,
                'HUSBAND',
                genModel,
                model,
                config,
                blocks,
                unionToBlock,
                focusUnionId,
                isFocusPersonPartnerA  // true if this is the focus person's direct ancestor chain
            );

            // PartnerB (wife) ancestors
            if (focusUnion.partnerB) {
                buildAncestorBlocks(
                    focusUnion.partnerB,
                    focusBlockId,
                    'WIFE',
                    genModel,
                    model,
                    config,
                    blocks,
                    unionToBlock,
                    focusUnionId,
                    isFocusPersonPartnerB  // true if this is the focus person's direct ancestor chain
                );
            }
        }
    }

    // Determine root blocks (those with no parent)
    const rootBlockIds: FamilyBlockId[] = [];
    for (const [blockId, block] of blocks) {
        if (block.parentBlockId === null) {
            rootBlockIds.push(blockId);
        }
    }

    // Measure widths bottom-up
    measureBlockWidths(blocks, config);

    // Compute envelopes (after widths are known)
    computeEnvelopes(blocks, genModel.model, config);

    // Populate legacy maps
    const personWidth = new Map<PersonId, number>();
    const unionWidth = new Map<UnionId, number>();
    const subtreeWidth = new Map<UnionId, number>();

    for (const personId of model.persons.keys()) {
        personWidth.set(personId, config.cardWidth);
    }

    for (const [unionId, union] of model.unions) {
        const w = union.partnerB
            ? config.cardWidth * 2 + config.partnerGap
            : config.cardWidth;
        unionWidth.set(unionId, w);
    }

    // For unions WITH blocks, use block.width
    for (const [, block] of blocks) {
        subtreeWidth.set(block.rootUnionId, block.width);
    }

    // For unions WITHOUT blocks, compute subtreeWidth using legacy recursive method
    computeLegacySubtreeWidths(genModel, unionWidth, subtreeWidth, config.horizontalGap);

    // Compute branch structure
    const branchData = computeBranches(blocks, unionToBlock, model);

    return {
        genModel,
        personWidth,
        unionWidth,
        subtreeWidth,
        blocks,
        rootBlockIds,
        unionToBlock,
        ...branchData
    };
}

/**
 * Recursively build a FamilyBlock for a union and its descendants.
 */
function buildBlockRecursive(
    unionId: UnionId,
    parentBlockId: FamilyBlockId | null,
    side: BlockSide,
    genModel: GenerationalModel,
    model: LayoutModel,
    config: LayoutConfig,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    unionToBlock: Map<UnionId, FamilyBlockId>
): FamilyBlockId | null {
    // Avoid duplicates
    if (unionToBlock.has(unionId)) {
        return unionToBlock.get(unionId)!;
    }

    const union = model.unions.get(unionId);
    if (!union) return null;

    const gen = genModel.unionGen.get(unionId) ?? 0;
    const blockId = toFamilyBlockId(`block_${unionId}`);

    const coupleWidth = union.partnerB
        ? config.cardWidth * 2 + config.partnerGap
        : config.cardWidth;

    const block: FamilyBlock = {
        id: blockId,
        rootUnionId: unionId,
        childBlockIds: [],
        parentBlockId,
        side,
        generation: gen,
        branchId: null,
        width: coupleWidth,
        coupleWidth,
        childrenWidth: 0,
        envelopeWidth: coupleWidth,
        leftExtent: coupleWidth / 2,
        rightExtent: coupleWidth / 2,
        xLeft: 0,
        xRight: 0,
        xCenter: 0,
        husbandAnchorX: 0,
        wifeAnchorX: 0,
        childrenCenterX: 0,
        coupleCenterX: 0
    };

    blocks.set(blockId, block);
    unionToBlock.set(unionId, blockId);

    // Build child blocks for descendants
    const childUnionIds = getChildUnions(unionId, model, genModel);
    for (const childUnionId of childUnionIds) {
        const childBlockId = buildBlockRecursive(
            childUnionId,
            blockId,
            side,
            genModel,
            model,
            config,
            blocks,
            unionToBlock
        );
        if (childBlockId) {
            block.childBlockIds.push(childBlockId);
        }
    }

    return blockId;
}

/**
 * Build ancestor blocks for a person, traversing up the tree.
 * Each ancestor union gets a block with the specified side.
 * The ancestor block's children include ALL children of the ancestor union
 * (including the direct-line child, which is the already-built focus/intermediate block).
 * This ensures siblings are placed contiguously with no interleaving.
 *
 * IMPORTANT: The side attribute determines whether blocks belong to:
 * - 'HUSBAND': Focus person's father's side (paternal)
 * - 'WIFE': Focus person's mother's side (maternal)
 * - 'BOTH': Focus block and its descendants
 *
 * When we reach the focus parents (gen -1, the first ancestor block of the FOCUS PERSON),
 * we assign side='BOTH' to that block. Then when recursing upward:
 * - partnerA's ancestors (father's line) get side='HUSBAND'
 * - partnerB's ancestors (mother's line) get side='WIFE'
 *
 * Note: The spouse's parents (gen -1 but not the focus person's direct parents) do NOT
 * get side='BOTH' - they keep their assigned side ('HUSBAND' or 'WIFE').
 *
 * @param isFocusPersonAncestorChain - true if this chain starts from the focus person
 *        (as opposed to starting from the focus person's spouse)
 */
function buildAncestorBlocks(
    personId: PersonId,
    _childBlockId: FamilyBlockId,
    side: BlockSide,
    genModel: GenerationalModel,
    model: LayoutModel,
    config: LayoutConfig,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    directLineUnionId: UnionId,
    isFocusPersonAncestorChain: boolean = false
): void {
    const parentUnionId = model.childToParentUnion.get(personId);
    if (!parentUnionId) return;
    if (unionToBlock.has(parentUnionId)) return;

    const parentUnion = model.unions.get(parentUnionId);
    if (!parentUnion) return;

    const gen = genModel.unionGen.get(parentUnionId) ?? 0;
    const blockId = toFamilyBlockId(`block_${parentUnionId}`);

    const coupleWidth = parentUnion.partnerB
        ? config.cardWidth * 2 + config.partnerGap
        : config.cardWidth;

    // Detect if this is the focus parents block:
    // - directLineUnionId is the focus union (gen 0)
    // - this parent union is at gen -1
    // - AND this is the focus person's direct ancestor chain (not spouse's)
    const directLineGen = genModel.unionGen.get(directLineUnionId) ?? 0;
    const isFocusParents = directLineGen === 0 && gen === -1 && isFocusPersonAncestorChain;

    // Focus parents get side='BOTH', all deeper ancestors keep their assigned side
    const blockSide: BlockSide = isFocusParents ? 'BOTH' : side;

    const block: FamilyBlock = {
        id: blockId,
        rootUnionId: parentUnionId,
        childBlockIds: [],
        parentBlockId: null, // Ancestor blocks are roots in the tree
        side: blockSide,
        generation: gen,
        branchId: null,
        width: coupleWidth,
        coupleWidth,
        childrenWidth: 0,
        envelopeWidth: coupleWidth,
        leftExtent: coupleWidth / 2,
        rightExtent: coupleWidth / 2,
        xLeft: 0,
        xRight: 0,
        xCenter: 0,
        husbandAnchorX: 0,
        wifeAnchorX: 0,
        childrenCenterX: 0,
        coupleCenterX: 0
    };

    blocks.set(blockId, block);
    unionToBlock.set(parentUnionId, blockId);

    // Build ALL child blocks (including the direct-line child if not already claimed)
    // This ensures siblings are in the correct contiguous order
    const childUnionIds = getChildUnions(parentUnionId, model, genModel);
    for (const childUnionId of childUnionIds) {
        if (childUnionId === directLineUnionId) {
            // Include the already-built direct-line block as a child,
            // but only if it doesn't already have a parent
            const existingBlockId = unionToBlock.get(directLineUnionId);
            if (existingBlockId) {
                const existingBlock = blocks.get(existingBlockId);
                if (existingBlock && existingBlock.parentBlockId === null) {
                    block.childBlockIds.push(existingBlockId);
                    existingBlock.parentBlockId = blockId;
                }
                // If already claimed by another ancestor, skip
            }
        } else if (!unionToBlock.has(childUnionId)) {
            // For siblings at gen -1 (aunts/uncles), we need to determine which side they belong to:
            // - If we're building from partnerA (father), siblings get 'HUSBAND'
            // - If we're building from partnerB (mother), siblings get 'WIFE'
            // The 'side' parameter already tells us which partner we traced through
            const siblingBlockId = buildBlockRecursive(
                childUnionId,
                blockId,
                side,  // Use the side we were called with (HUSBAND for father's siblings, WIFE for mother's)
                genModel,
                model,
                config,
                blocks,
                unionToBlock
            );
            if (siblingBlockId) {
                block.childBlockIds.push(siblingBlockId);
            }
        } else {
            // Block already exists - include as child only if unclaimed
            const existingBlockId = unionToBlock.get(childUnionId)!;
            const existingBlock = blocks.get(existingBlockId);
            if (existingBlock && existingBlock.parentBlockId === null) {
                block.childBlockIds.push(existingBlockId);
                existingBlock.parentBlockId = blockId;
            }
        }
    }

    // Continue up the tree
    // When recursing from focus parents (side='BOTH'), we need to assign proper sides:
    // - partnerA (father) ancestors → 'HUSBAND'
    // - partnerB (mother) ancestors → 'WIFE'
    // For all other ancestor blocks, keep the inherited side
    // Note: After the focus parents level, isFocusPersonAncestorChain becomes false
    // because we're no longer tracing from the focus person directly.
    const husbandSide: BlockSide = isFocusParents ? 'HUSBAND' : side;
    const wifeSide: BlockSide = isFocusParents ? 'WIFE' : side;

    buildAncestorBlocks(
        parentUnion.partnerA,
        blockId,
        husbandSide,
        genModel,
        model,
        config,
        blocks,
        unionToBlock,
        parentUnionId,
        false  // After first level, no longer the focus person's direct chain
    );

    if (parentUnion.partnerB) {
        buildAncestorBlocks(
            parentUnion.partnerB,
            blockId,
            wifeSide,
            genModel,
            model,
            config,
            blocks,
            unionToBlock,
            parentUnionId,
            false  // After first level, no longer the focus person's direct chain
        );
    }
}

/**
 * Measure block widths bottom-up (leaves first).
 */
function measureBlockWidths(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    config: LayoutConfig
): void {
    // Sort blocks by generation (highest first = leaves first)
    const sorted = Array.from(blocks.values()).sort((a, b) => b.generation - a.generation);

    for (const block of sorted) {
        if (block.childBlockIds.length === 0) {
            block.childrenWidth = 0;
            block.width = block.coupleWidth;
        } else {
            let totalChildWidth = 0;
            for (const childId of block.childBlockIds) {
                const childBlock = blocks.get(childId);
                if (childBlock) {
                    totalChildWidth += childBlock.width;
                }
            }
            totalChildWidth += (block.childBlockIds.length - 1) * config.horizontalGap;
            block.childrenWidth = totalChildWidth;
            block.width = Math.max(block.coupleWidth, block.childrenWidth);
        }
    }
}

/**
 * Compute subtreeWidth for unions that don't have FamilyBlocks.
 * Uses the legacy recursive bottom-up approach for backward compatibility.
 */
function computeLegacySubtreeWidths(
    genModel: GenerationalModel,
    unionWidth: Map<UnionId, number>,
    subtreeWidth: Map<UnionId, number>,
    horizontalGap: number
): void {
    const { model } = genModel;

    // Process all unions that don't already have a subtreeWidth
    const unprocessed = Array.from(model.unions.keys())
        .filter(uid => !subtreeWidth.has(uid));

    const visited = new Set<UnionId>();

    for (const unionId of unprocessed) {
        computeLegacyWidth(unionId, model, unionWidth, subtreeWidth, horizontalGap, visited);
    }
}

/**
 * Recursively compute subtree width for a single union (legacy approach).
 * Does NOT filter by generation - follows the child→union graph directly.
 */
function computeLegacyWidth(
    unionId: UnionId,
    model: LayoutModel,
    unionWidth: Map<UnionId, number>,
    subtreeWidth: Map<UnionId, number>,
    horizontalGap: number,
    visited: Set<UnionId>
): number {
    if (subtreeWidth.has(unionId)) return subtreeWidth.get(unionId)!;
    if (visited.has(unionId)) return unionWidth.get(unionId) ?? 0;
    visited.add(unionId);

    const union = model.unions.get(unionId);
    if (!union) return 0;

    const ownWidth = unionWidth.get(unionId) ?? 0;
    if (union.childIds.length === 0) {
        subtreeWidth.set(unionId, ownWidth);
        return ownWidth;
    }

    let childrenTotalWidth = 0;
    const childUnionsSeen = new Set<UnionId>();

    for (const childId of union.childIds) {
        const childUnionId = model.personToUnion.get(childId);
        if (!childUnionId || childUnionsSeen.has(childUnionId)) continue;
        childUnionsSeen.add(childUnionId);
        childrenTotalWidth += computeLegacyWidth(childUnionId, model, unionWidth, subtreeWidth, horizontalGap, visited);
    }

    if (childUnionsSeen.size > 1) {
        childrenTotalWidth += (childUnionsSeen.size - 1) * horizontalGap;
    }

    const width = Math.max(ownWidth, childrenTotalWidth);
    subtreeWidth.set(unionId, width);
    return width;
}

/**
 * Create an empty BranchModel when no focus person is found.
 */
function emptyBranchModel(genModel: GenerationalModel, config: LayoutConfig): BranchModel {
    const personWidth = new Map<PersonId, number>();
    const unionWidth = new Map<UnionId, number>();
    const subtreeWidth = new Map<UnionId, number>();

    for (const personId of genModel.model.persons.keys()) {
        personWidth.set(personId, config.cardWidth);
    }
    for (const [unionId, union] of genModel.model.unions) {
        const w = union.partnerB
            ? config.cardWidth * 2 + config.partnerGap
            : config.cardWidth;
        unionWidth.set(unionId, w);
        subtreeWidth.set(unionId, w);
    }

    return {
        genModel,
        personWidth,
        unionWidth,
        subtreeWidth,
        blocks: new Map(),
        rootBlockIds: [],
        unionToBlock: new Map(),
        branches: new Map(),
        blockToBranch: new Map(),
        unionToBranch: new Map(),
        topLevelBranchIds: [],
        parentUnionToBranches: new Map()
    };
}

/**
 * Compute envelope widths for all blocks.
 * Envelopes account for the total horizontal space needed by a block
 * INCLUDING all ancestors above it.
 *
 * Processing order: deepest ancestors first (most negative generation),
 * then toward focus. This ensures parent envelopes are known before children.
 */
function computeEnvelopes(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): void {
    // Find the focus block (side='BOTH' AND generation=0)
    let focusBlock: FamilyBlock | null = null;
    const ancestorBlocks: FamilyBlock[] = [];

    for (const [, block] of blocks) {
        if (block.side === 'BOTH' && block.generation === 0) {
            focusBlock = block;
        } else if (block.generation < 0) {
            ancestorBlocks.push(block);
        }
    }

    // Sort ancestor blocks: most negative generation first (deepest ancestors processed first)
    ancestorBlocks.sort((a, b) => a.generation - b.generation);

    // For ALL non-focus, non-ancestor blocks: envelopeWidth = width
    // This includes descendants of focus (side='BOTH', gen>0) and sibling blocks (side!='BOTH', gen>=0)
    for (const [, block] of blocks) {
        if (block === focusBlock) continue;
        if (block.generation < 0) continue;
        block.envelopeWidth = block.width;
        block.leftExtent = block.width / 2;
        block.rightExtent = block.width / 2;
    }

    // Process ancestor blocks from deepest to shallowest
    for (const block of ancestorBlocks) {
        block.envelopeWidth = computeSubtreeEnvelope(block.id, blocks, model, config);
        block.leftExtent = block.envelopeWidth / 2;
        block.rightExtent = block.envelopeWidth / 2;
    }

    // Compute focus block envelope
    if (focusBlock) {
        let husbandEnvelope = 0;
        let wifeEnvelope = 0;

        // Find the root ancestor blocks for husband and wife sides
        for (const [, block] of blocks) {
            if (block.generation < 0 && block.parentBlockId === null) {
                if (block.side === 'HUSBAND') {
                    husbandEnvelope = Math.max(husbandEnvelope, block.envelopeWidth);
                } else if (block.side === 'WIFE') {
                    wifeEnvelope = Math.max(wifeEnvelope, block.envelopeWidth);
                }
            }
        }

        // Also check via direct parent union lookup
        const focusUnion = model.unions.get(focusBlock.rootUnionId);
        if (focusUnion) {
            const husbandParent = model.childToParentUnion.get(focusUnion.partnerA);
            if (husbandParent) {
                for (const [, b] of blocks) {
                    if (b.rootUnionId === husbandParent) {
                        husbandEnvelope = Math.max(husbandEnvelope, b.envelopeWidth);
                        break;
                    }
                }
            }
            if (focusUnion.partnerB) {
                const wifeParent = model.childToParentUnion.get(focusUnion.partnerB);
                if (wifeParent) {
                    for (const [, b] of blocks) {
                        if (b.rootUnionId === wifeParent) {
                            wifeEnvelope = Math.max(wifeEnvelope, b.envelopeWidth);
                            break;
                        }
                    }
                }
            }
        }

        const ancestorTotal = husbandEnvelope > 0 && wifeEnvelope > 0
            ? husbandEnvelope + wifeEnvelope + config.horizontalGap
            : husbandEnvelope + wifeEnvelope;

        focusBlock.envelopeWidth = Math.max(focusBlock.width, ancestorTotal);
        focusBlock.leftExtent = focusBlock.envelopeWidth / 2;
        focusBlock.rightExtent = focusBlock.envelopeWidth / 2;
    }
}

// ==================== BRANCH COMPUTATION ====================

/**
 * Compute branch structure for sibling family separation.
 *
 * Algorithm:
 * 1. Find focus block (side='BOTH', generation=0)
 * 2. If focus has 2+ childBlockIds, each child defines a top-level branch
 * 3. Recursively: if a block has 2+ childBlockIds, create sub-branches
 * 4. Single-child blocks stay in parent's branch (no sub-branch)
 * 5. Ancestor blocks (gen < 0) have branchId = null
 */
function computeBranches(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    _unionToBlock: Map<UnionId, FamilyBlockId>,
    model: LayoutModel
): {
    branches: Map<BranchId, SiblingFamilyBranch>;
    blockToBranch: Map<FamilyBlockId, BranchId>;
    unionToBranch: Map<UnionId, BranchId>;
    topLevelBranchIds: BranchId[];
    parentUnionToBranches: Map<UnionId, BranchId[]>;
} {
    const branches = new Map<BranchId, SiblingFamilyBranch>();
    const blockToBranch = new Map<FamilyBlockId, BranchId>();
    const unionToBranch = new Map<UnionId, BranchId>();
    const topLevelBranchIds: BranchId[] = [];
    const parentUnionToBranches = new Map<UnionId, BranchId[]>();

    // Find focus block
    let focusBlock: FamilyBlock | null = null;
    for (const [, block] of blocks) {
        if (block.side === 'BOTH' && block.generation === 0) {
            focusBlock = block;
            break;
        }
    }

    if (!focusBlock || focusBlock.childBlockIds.length < 2) {
        // No branches needed: 0 or 1 children = no separation
        return { branches, blockToBranch, unionToBranch, topLevelBranchIds, parentUnionToBranches };
    }

    // Create top-level branches for each child of the focus block
    const focusUnionId = focusBlock.rootUnionId;
    const branchIds: BranchId[] = [];

    for (let i = 0; i < focusBlock.childBlockIds.length; i++) {
        const childBlockId = focusBlock.childBlockIds[i];
        const childBlock = blocks.get(childBlockId);
        if (!childBlock) continue;

        // Find the person who defines this branch
        const childUnion = model.unions.get(childBlock.rootUnionId);
        if (!childUnion) continue;

        // Determine childPersonId: find which of the union's persons is a child of focusUnion
        const focusUnion = model.unions.get(focusUnionId);
        let childPersonId: PersonId | null = null;
        if (focusUnion) {
            for (const cid of focusUnion.childIds) {
                if (cid === childUnion.partnerA || cid === childUnion.partnerB) {
                    childPersonId = cid;
                    break;
                }
            }
        }
        if (!childPersonId) {
            childPersonId = childUnion.partnerA;
        }

        const branchId = toBranchId(`branch_${focusUnionId}_${i}`);

        const branch: SiblingFamilyBranch = {
            id: branchId,
            parentUnionId: focusUnionId,
            rootBlockId: childBlockId,
            childPersonId,
            siblingIndex: i,
            blockIds: new Set(),
            unionIds: new Set(),
            minX: 0,
            maxX: 0,
            envelopeWidth: 0,
            childBranchIds: [],
            parentBranchId: null,
            generation: childBlock.generation
        };

        branches.set(branchId, branch);
        branchIds.push(branchId);

        // Recursively collect all blocks in this branch
        collectBranchBlocks(childBlockId, branchId, branch, blocks, model, branches, blockToBranch, unionToBranch, parentUnionToBranches);
    }

    topLevelBranchIds.push(...branchIds);
    parentUnionToBranches.set(focusUnionId, [...branchIds]);

    return { branches, blockToBranch, unionToBranch, topLevelBranchIds, parentUnionToBranches };
}

/**
 * Recursively collect all blocks belonging to a branch.
 * If a block has 2+ children, creates sub-branches.
 * If a block has 1 child, the child remains in the same branch.
 */
function collectBranchBlocks(
    blockId: FamilyBlockId,
    branchId: BranchId,
    branch: SiblingFamilyBranch,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    branches: Map<BranchId, SiblingFamilyBranch>,
    blockToBranch: Map<FamilyBlockId, BranchId>,
    unionToBranch: Map<UnionId, BranchId>,
    parentUnionToBranches: Map<UnionId, BranchId[]>
): void {
    const block = blocks.get(blockId);
    if (!block) return;

    // Skip ancestor blocks
    if (block.generation < 0) return;

    // Assign this block to the branch
    branch.blockIds.add(blockId);
    branch.unionIds.add(block.rootUnionId);
    block.branchId = branchId;
    blockToBranch.set(blockId, branchId);
    unionToBranch.set(block.rootUnionId, branchId);

    // Process children
    if (block.childBlockIds.length === 0) {
        // Leaf block — nothing more to do
        return;
    }

    if (block.childBlockIds.length === 1) {
        // Single child — stays in the same branch (no sub-branch)
        collectBranchBlocks(
            block.childBlockIds[0], branchId, branch,
            blocks, model, branches, blockToBranch, unionToBranch, parentUnionToBranches
        );
        return;
    }

    // 2+ children — create sub-branches
    const parentUnionId = block.rootUnionId;
    const subBranchIds: BranchId[] = [];

    for (let i = 0; i < block.childBlockIds.length; i++) {
        const childBlockId = block.childBlockIds[i];
        const childBlock = blocks.get(childBlockId);
        if (!childBlock) continue;

        // Find the person who defines this sub-branch
        const childUnion = model.unions.get(childBlock.rootUnionId);
        if (!childUnion) continue;

        const parentUnion = model.unions.get(parentUnionId);
        let childPersonId: PersonId | null = null;
        if (parentUnion) {
            for (const cid of parentUnion.childIds) {
                if (cid === childUnion.partnerA || cid === childUnion.partnerB) {
                    childPersonId = cid;
                    break;
                }
            }
        }
        if (!childPersonId) {
            childPersonId = childUnion.partnerA;
        }

        const subBranchId = toBranchId(`branch_${parentUnionId}_${i}`);

        const subBranch: SiblingFamilyBranch = {
            id: subBranchId,
            parentUnionId,
            rootBlockId: childBlockId,
            childPersonId,
            siblingIndex: i,
            blockIds: new Set(),
            unionIds: new Set(),
            minX: 0,
            maxX: 0,
            envelopeWidth: 0,
            childBranchIds: [],
            parentBranchId: branchId,
            generation: childBlock.generation
        };

        branches.set(subBranchId, subBranch);
        subBranchIds.push(subBranchId);

        // Sub-branch blocks are ALSO part of the parent branch
        collectBranchBlocks(
            childBlockId, subBranchId, subBranch,
            blocks, model, branches, blockToBranch, unionToBranch, parentUnionToBranches
        );

        // Add sub-branch blocks to parent branch too
        for (const bid of subBranch.blockIds) {
            branch.blockIds.add(bid);
        }
        for (const uid of subBranch.unionIds) {
            branch.unionIds.add(uid);
        }
    }

    branch.childBranchIds.push(...subBranchIds);
    parentUnionToBranches.set(parentUnionId, [...subBranchIds]);
}

/**
 * Compute the envelope width for a single block.
 * The envelope is the total horizontal space needed for this block
 * plus all ancestors above it (the ancestor chain of its union's partners).
 */
export function computeSubtreeEnvelope(
    blockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): number {
    const block = blocks.get(blockId);
    if (!block) return 0;

    const union = model.unions.get(block.rootUnionId);
    if (!union) return block.width;

    // Find parent blocks for each partner
    let parentAEnvelope = 0;
    let parentBEnvelope = 0;

    const parentAUnionId = model.childToParentUnion.get(union.partnerA);
    if (parentAUnionId) {
        for (const [, b] of blocks) {
            if (b.rootUnionId === parentAUnionId) {
                parentAEnvelope = b.envelopeWidth;
                break;
            }
        }
    }

    if (union.partnerB) {
        const parentBUnionId = model.childToParentUnion.get(union.partnerB);
        if (parentBUnionId) {
            for (const [, b] of blocks) {
                if (b.rootUnionId === parentBUnionId) {
                    parentBEnvelope = b.envelopeWidth;
                    break;
                }
            }
        }
    }

    // Total parent contribution
    let parentContribution = 0;
    if (parentAEnvelope > 0 && parentBEnvelope > 0) {
        parentContribution = parentAEnvelope + parentBEnvelope + config.horizontalGap;
    } else {
        parentContribution = parentAEnvelope + parentBEnvelope;
    }

    return Math.max(block.width, parentContribution);
}

/**
 * Determine the left/right partner assignment for a union.
 * Partners are already ordered in the UnionNode (partnerA = left, partnerB = right).
 */
export function assignPartnerSides(
    unionId: UnionId,
    model: LayoutModel
): { leftPartnerId: PersonId; rightPartnerId: PersonId | null } {
    const union = model.unions.get(unionId);
    if (!union) {
        throw new Error(`Union ${unionId} not found`);
    }
    return {
        leftPartnerId: union.partnerA,
        rightPartnerId: union.partnerB
    };
}

/**
 * Get total width needed for layout.
 */
export function getTotalWidth(measured: FamilyBlockModel): number {
    if (measured.rootBlockIds.length > 0) {
        const rootBlock = measured.blocks.get(measured.rootBlockIds[0]);
        if (rootBlock) return rootBlock.width;
    }

    // Fallback: sum of all root subtree widths
    let maxWidth = 0;
    for (const [unionId, gen] of measured.genModel.unionGen) {
        if (gen === measured.genModel.minGen) {
            const width = measured.subtreeWidth.get(unionId) ?? 0;
            maxWidth = Math.max(maxWidth, width);
        }
    }
    return maxWidth;
}
