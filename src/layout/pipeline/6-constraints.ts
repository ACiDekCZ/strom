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
    GenerationalModel,
    InnerSiblingRun
} from './types.js';

/**
 * Find the "extra partner" in a secondary chain union.
 * In a merged chain, the extra partner is the person NOT in the primary couple.
 */
export function findChainExtraPartner(
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

    const aOutside = !primaryCoupleIds.has(union.partnerA);
    const bOutside = union.partnerB !== null && !primaryCoupleIds.has(union.partnerB);

    if (aOutside && !bOutside) return union.partnerA;
    if (bOutside && !aOutside) return union.partnerB;
    if (aOutside && bOutside && union.partnerB) {
        // Transitive chain link: BOTH partners are outside the primary couple.
        // The stem belongs to the person FARTHER out in the chain order — the
        // closer one already carries the stem of the previous link (two links
        // stemming from the same card would merge into one vertical line).
        const order = chainInfo.personOrder;
        const primaryIdxs: number[] = [];
        for (let i = 0; i < order.length; i++) {
            if (primaryCoupleIds.has(order[i])) primaryIdxs.push(i);
        }
        const distance = (pid: PersonId): number => {
            const i = order.indexOf(pid);
            if (i < 0 || primaryIdxs.length === 0) return 0;
            let best = Infinity;
            for (const pi of primaryIdxs) best = Math.min(best, Math.abs(i - pi));
            return best;
        };
        return distance(union.partnerB) > distance(union.partnerA)
            ? union.partnerB
            : union.partnerA;
    }
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
    /**
     * Siblings of the husband shown beside him (children of his parents'
     * union, e.g. an ancestor's children shown in place), outermost first.
     * They stand in this couple's row LEFT of the husband; extLeft is the
     * room they take including the gap to the couple.
     */
    runLeft: FamilyBlockId[];
    extLeft: number;
    /** Siblings of the wife shown beside her, RIGHT of the couple. */
    runRight: FamilyBlockId[];
    extRight: number;
    /**
     * How far the runs reach in the couple's own row (the farthest sibling's
     * outer card edge). extLeft/extRight also count the rows below, where a
     * sibling's children may reach farther; the parents centre over the
     * children in this row.
     */
    rowExtLeft: number;
    rowExtRight: number;
    /**
     * Run members whose children are drawn in the parents' row (gen -1),
     * which Phase A has locked: they stand over their children where they
     * can (placeSiblingRuns), the rest of the run packed around them.
     */
    pinned: Set<FamilyBlockId>;
    /**
     * The husband's siblings stand right of the wife instead (runRight): he
     * is a man on the female side of his child and the wife has no parents
     * in view, so the row reads husband, wife, his siblings (InnerSiblingRun).
     */
    husbandBeyondWife: boolean;
    /** Mirror: the wife's siblings stand left of the husband (runLeft). */
    wifeBeyondHusband: boolean;
}

// ==================== BLOCK CARD EXTENT HELPER ====================

/**
 * Get the visual card extent (left, right) of a block.
 * Handles chain blocks (wider coupleWidth) correctly.
 */
export function getBlockCardExtent(
    block: FamilyBlock,
    model: LayoutModel,
    config: LayoutConfig
): { left: number; right: number } {
    if (block.chainInfo) {
        // A chain knows where each of its cards sits, and that is the only
        // honest answer here. Deriving the extent from coupleWidth got it wrong
        // twice over: the row is not centred on xCenter (xCenter stays on the
        // primary couple while appendage spouses hang off one side), and
        // coupleWidth also reserves room for an extra partner's CHILDREN, who
        // stand a generation BELOW and take no width in this row. The reserved
        // slot then read as a card sticking out sideways, so a caller resolving
        // overlaps saw a collision that was not there and shoved the whole
        // chain out of its place — a deep ancestor's second wife ended up a
        // full card across her great-granddaughter's side of the couple.
        const centres = [...block.chainInfo.personPositions.values()];
        if (centres.length > 0) {
            return {
                left: Math.min(...centres) - config.cardWidth / 2,
                right: Math.max(...centres) + config.cardWidth / 2
            };
        }
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
        xCenter: 0,
        runLeft: [],
        extLeft: 0,
        rowExtLeft: 0,
        rowExtRight: 0,
        runRight: [],
        extRight: 0,
        pinned: new Set(),
        husbandBeyondWife: false,
        wifeBeyondHusband: false
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
    config: LayoutConfig,
    blocks?: Map<FamilyBlockId, FamilyBlock>,
    unionToBlock?: Map<UnionId, FamilyBlockId>
): number {
    if (!node) return 0;

    // Couple width: 2 cards + gap for couple, 1 card for single.
    // A chain block (couple + appendage extra spouses) is wider — but its
    // measured coupleWidth also reserves slots for the children of the union
    // we entered the chain THROUGH (computeChainCoupleWidth serves descendant
    // chains, where children hang beneath). Here those children are the next
    // Phase-B generation, already counted by the tree recursion — taking the
    // block value verbatim double-counts them and drags the whole tree
    // sideways (devel-demo: Josef's 3-card chain claimed 3356px and exiled
    // Bohumil+Josefína ~1000px left of Karel). Use the chain's card row plus
    // slot growth for OTHER unions' children only, which do hang below.
    const blockId = unionToBlock?.get(node.unionId);
    const block = blockId ? blocks?.get(blockId) : undefined;
    if (block?.chainInfo) {
        const persons = block.chainInfo.personOrder.length;
        let chainW = persons * config.cardWidth + (persons - 1) * config.partnerGap;
        for (const [uid, kidIds] of block.chainInfo.unionChildBlockIds) {
            if (uid === node.unionId) continue;
            let kidsW = 0;
            for (const kid of kidIds) {
                const kb = blocks?.get(kid);
                if (kb) kidsW += kb.width;
            }
            if (kidIds.length > 1) kidsW += (kidIds.length - 1) * config.horizontalGap;
            // The extra partner's slot grows from one card to their subtree.
            chainW += Math.max(0, kidsW - config.cardWidth);
        }
        node.coupleWidth = chainW;
    } else {
        node.coupleWidth = node.wifeId
            ? config.cardWidth * 2 + config.partnerGap
            : config.cardWidth;
    }

    // Recursively compute subtree widths
    const hWidth = computeAncestorTreeWidth(node.hSubtree, config, blocks, unionToBlock);
    const wWidth = computeAncestorTreeWidth(node.wSubtree, config, blocks, unionToBlock);

    // Ancestors width: sum of subtrees + gap between them (if both exist)
    const ancestorsWidth = hWidth + wWidth +
        (hWidth > 0 && wWidth > 0 ? config.horizontalGap : 0);

    // Tree width is the maximum of couple (with the siblings beside it) and ancestors
    node.width = Math.max(node.coupleWidth + node.extLeft + node.extRight, ancestorsWidth);

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

    // Parents stand above all their children in view: the person and the
    // siblings shown beside them (attachSiblingRuns) — beyond the partner
    // when the siblings stand there, the line then running over the
    // partner's card (the farthest sibling's centre is about the run's
    // width past the partner's centre)
    const husbandRunShift = node.husbandBeyondWife
        ? (wifeCenterX + node.rowExtRight - husbandCenterX) / 2
        : node.wifeId || node.rowExtRight === 0 ? -node.rowExtLeft / 2 : node.rowExtRight / 2;
    const wifeRunShift = node.wifeBeyondHusband
        ? (husbandCenterX - node.rowExtLeft - wifeCenterX) / 2
        : node.wifeId ? node.rowExtRight / 2 : 0;

    // Place H-subtree: it must stay LEFT of husband's RIGHT EDGE — but only
    // while there is a W-subtree on the other side to keep clear of
    if (node.hSubtree && hWidth > 0) {
        placeSubtreeAgainstBoundary(
            node.hSubtree, husbandCenterX + husbandRunShift,
            wWidth > 0 ? husbandRightEdge : null, 'LEFT', config);
    }

    // Place W-subtree: mirror of the above
    if (node.wSubtree && wWidth > 0) {
        placeSubtreeAgainstBoundary(
            node.wSubtree, wifeCenterX + wifeRunShift,
            hWidth > 0 ? wifeLeftEdge : null, 'RIGHT', config);
    }

    // The two boundaries above leave the branches exactly partnerGap apart —
    // the width of the couple's own card gap. Every later pass that keeps
    // blocks in a row apart asks for horizontalGap instead, finds the pair
    // short by the difference, and pays it by shoving one branch sideways out
    // of the place this function just chose for it. Settle it here, splitting
    // the shortfall so the pair stays centred on the couple.
    if (node.hSubtree && node.wSubtree && hWidth > 0 && wWidth > 0) {
        resolveAncestorTreeOverlap(node.hSubtree, node.wSubtree, config);
    }
}

/**
 * Place one ancestor subtree above the person it belongs to, then pull it back
 * to its side of the couple — but only as far as the boundary actually demands.
 *
 * The subtree used to be placed by its own bounding box: right edge flush with
 * the husband's card edge (mirrored for the wife). That satisfies the side
 * boundary, but it moves the subtree ROOT — the person's own parents — by half
 * the width of everything above them. Every generation repeats the shift and it
 * accumulates downward, so on a deep tree the parent couple ended up thousands
 * of pixels away from the child it belongs to, with an empty band in between
 * (measured on a 10-generation line: 2537px between a father and his son).
 *
 * Starting from the child's own X keeps the couple where invariant 6 wants it —
 * above its child — and the corrective shift still guarantees the side
 * boundary, so nothing crosses the couple midline. Wide branches still slide
 * outward, just by the overshoot instead of by their full half-width.
 *
 * boundaryX of null means there is nothing on the other side to keep clear of:
 * the couple's other partner has no ancestors in view, so the lone branch is
 * free to stand above the partner it belongs to. Clamping it there anyway used
 * to cost another 1030px of empty band on the line measured above, buying
 * nothing — the side rule exists to separate two branches, and there is only
 * one. Neighbouring anchors are kept apart by separateTreeClusters.
 */
function placeSubtreeAgainstBoundary(
    subtree: AncestorNode,
    anchorCenterX: number,
    boundaryX: number | null,
    side: 'LEFT' | 'RIGHT',
    config: LayoutConfig
): void {
    placeAncestorTree(subtree, anchorCenterX, config);
    if (boundaryX === null) return;

    if (side === 'LEFT') {
        const maxX = findTreeMaxX(subtree, config);
        if (isFinite(maxX) && maxX > boundaryX) {
            shiftAncestorTree(subtree, boundaryX - maxX);
        }
    } else {
        const minX = findTreeMinX(subtree, config);
        if (isFinite(minX) && minX < boundaryX) {
            shiftAncestorTree(subtree, boundaryX - minX);
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

    // This node's right edge (the wife's siblings beside her included)
    const nodeRight = node.xCenter + node.coupleWidth / 2 + node.extRight;

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

    // This node's left edge (the husband's siblings beside him included)
    const nodeLeft = node.xCenter - node.coupleWidth / 2 - node.extLeft;

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

    // The side rule separates the two branches from each other. With only one
    // branch present there is nothing to separate, and clamping it to the card
    // edge just pushes it away from the person it belongs to — see
    // placeSubtreeAgainstBoundary.
    const bothSides = !!node.hSubtree && !!node.wSubtree;

    // Check H-subtree: entire tree must stay LEFT of husband's RIGHT EDGE
    if (node.hSubtree && bothSides) {
        const hMaxX = findTreeMaxX(node.hSubtree, config);
        if (hMaxX > husbandRightEdge + 0.5) { // tolerance
            const overshoot = hMaxX - husbandRightEdge;
            shiftAncestorTree(node.hSubtree, -overshoot);
            changed = true;
        }
    }

    // Check W-subtree: entire tree must stay RIGHT of wife's LEFT EDGE
    if (node.wSubtree && bothSides) {
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
 * The X of a chain block that stands where the ancestor tree put the node.
 *
 * The block's own centre, as a rule. When the children of another of the
 * chain's unions are in view, that partner's slot can grow wider than the
 * chain's cards, and the block's centre then falls beyond its last card: the
 * cards, the couple over the child among them, stood wholly off the place the
 * tree chose for them. Then the middle of the card row stands there instead.
 */
function chainCardRowCenter(block: FamilyBlock, enteredUnionId: UnionId, config: LayoutConfig): number {
    const chain = block.chainInfo;
    if (!chain) return block.xCenter;
    let otherKids = false;
    for (const [unionId, kids] of chain.unionChildBlockIds) {
        if (unionId !== enteredUnionId && kids.length > 0) otherKids = true;
    }
    if (!otherKids) return block.xCenter;
    const xs = [...chain.personPositions.values()];
    if (xs.length === 0) return block.xCenter;
    const left = Math.min(...xs) - config.cardWidth / 2;
    const right = Math.max(...xs) + config.cardWidth / 2;
    if (block.xCenter >= left && block.xCenter <= right) return block.xCenter;
    return (left + right) / 2;
}

/**
 * Transfer computed positions from AncestorNode tree to FamilyBlocks.
 * Updates xCenter, xLeft, xRight, and anchor positions.
 */
function transferAncestorTreeToBlocks(
    node: AncestorNode | null,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    claimed?: Set<FamilyBlockId>,
    transferred?: Set<FamilyBlockId>
): void {
    if (!node) return;

    const blockId = unionToBlock.get(node.unionId);
    if (blockId && claimed?.has(blockId)) {
        // Already positioned by an earlier (higher-priority) tree — shared
        // ancestors in a pedigree collapse belong to the first tree that
        // reached them.
        transferAncestorTreeToBlocks(node.hSubtree, blocks, unionToBlock, config, claimed, transferred);
        transferAncestorTreeToBlocks(node.wSubtree, blocks, unionToBlock, config, claimed, transferred);
        return;
    }
    if (blockId) {
        const block = blocks.get(blockId);
        if (block) {
            claimed?.add(blockId);
            transferred?.add(blockId);
            if (block.chainInfo) {
                // Chain block: rigid shift keeps the internal chain geometry
                // (per-person card positions, slot centers) intact
                shiftBlock(block, node.xCenter - chainCardRowCenter(block, node.unionId, config));
            } else {
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
    }

    // Recurse to subtrees
    transferAncestorTreeToBlocks(node.hSubtree, blocks, unionToBlock, config, claimed, transferred);
    transferAncestorTreeToBlocks(node.wSubtree, blocks, unionToBlock, config, claimed, transferred);
}

/**
 * Siblings of an ancestor shown in place (an ancestor's children shown with
 * the card's children tab): they stand in the ancestor's row next to them,
 * the husband's on his outer (left) side and the wife's on hers (right) — a
 * lone ancestor's on the side of the tree they belong to. Each node of the
 * compact tree reserves that room (extLeft/extRight), so the tree is laid out
 * around the siblings instead of the siblings being pushed in afterwards
 * wherever there happens to be space, a row away from their parents.
 *
 * A sibling takes part only when its block hangs under the parents' block in
 * the same row, is not a tree node itself and has no block in the locked rows
 * (gen >= -1) below it; anything else stays to the generic overlap passes.
 *
 * Inner side: the husband's siblings on his left face the rest of the
 * pedigree when his child is a wife (the node is the wife's parents —
 * childSide 'W'), the wife's on her right when the child is a husband. When
 * the partner has no parents in view (and the couple is no partner chain),
 * the siblings stand beyond the partner instead — husband, wife, his
 * siblings (mirrored for the wife) — and the parents' line runs over the
 * partner's card; their room then lies on the tree's outer side. Every such
 * case is reported in `inner` (InnerSiblingRun), the blocked ones too.
 */
function attachSiblingRuns(
    node: AncestorNode | null,
    outward: 'LEFT' | 'RIGHT',
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    config: LayoutConfig,
    taken: Set<FamilyBlockId>,
    childSide: 'H' | 'W' | null,
    inner: InnerSiblingRun[]
): void {
    if (!node) return;
    const runOf = (parents: AncestorNode | null, personId: PersonId): FamilyBlockId[][] => {
        if (!parents) return [];
        const parentBlockId = unionToBlock.get(parents.unionId);
        const parentBlock = parentBlockId ? blocks.get(parentBlockId) : undefined;
        if (!parentBlock) return [];
        const ownBlockId = model.personToUnion.has(personId)
            ? unionToBlock.get(model.personToUnion.get(personId)!)
            : undefined;
        // Children of the parents' other unions (a chain) stand further out
        // than the person's full siblings, the nearer union's nearer: each
        // union's children stay together under their own line
        const chain = parentBlock.chainInfo;
        const stemX = (unionId: UnionId): number => {
            const union = model.unions.get(unionId);
            const extra = union && chain ? findChainExtraPartner(union, chain, model) : null;
            return extra ? chain!.personPositions.get(extra) ?? 0 : 0;
        };
        const ownStemX = chain ? stemX(parents.unionId) : 0;
        const groups = new Map<UnionId, FamilyBlockId[]>();
        for (const id of parentBlock.childBlockIds) {
            if (id === ownBlockId || taken.has(id)) continue;
            const block = blocks.get(id);
            if (!block || block.parentBlockId !== parentBlock.id || block.generation !== node.generation) continue;
            const subtree = collectBlockSubtree(id, blocks);
            // A sibling in the grandparents' row whose children are drawn in
            // the parents' row stands in the run too, over its children
            const pinned = node.generation === -2 && subtree.length > 1
                && subtree.every(b => b.id === id || b.generation >= -1);
            if (subtree.some(b => (!pinned && b.generation >= -1) || (b.id !== id && taken.has(b.id)))) continue;
            if (pinned) node.pinned.add(id);
            const union = model.unions.get(block.rootUnionId);
            const parentUnionId = [union?.partnerA, union?.partnerB]
                .map(pid => pid ? model.childToParentUnion.get(pid) : undefined)
                .find(uid => uid !== undefined && (uid === parents.unionId || !!chain?.unionIds.includes(uid)))
                ?? parents.unionId;
            if (!groups.has(parentUnionId)) groups.set(parentUnionId, []);
            groups.get(parentUnionId)!.push(id);
        }
        const ordered = [...groups.entries()].sort((a, b) =>
            (a[0] === parents.unionId ? -1 : Math.abs(stemX(a[0]) - ownStemX))
            - (b[0] === parents.unionId ? -1 : Math.abs(stemX(b[0]) - ownStemX)));
        for (const [, ids] of ordered) for (const id of ids) for (const b of collectBlockSubtree(id, blocks)) taken.add(b.id);
        return ordered.map(([, ids]) => ids);
    };
    // Innermost group beside the couple: a left run lists the outermost first
    const leftRun = (groups: FamilyBlockId[][]): FamilyBlockId[] => [...groups].reverse().flat();
    const rightRun = (groups: FamilyBlockId[][]): FamilyBlockId[] => groups.flat();

    const husbandRun = runOf(node.hSubtree, node.husbandId);
    const husbandSide = node.wifeId ? 'LEFT' : outward;
    const wifeRun = node.wifeId ? runOf(node.wSubtree, node.wifeId) : [];
    // The siblings would face the rest of the pedigree: beyond the partner
    // when the partner has no parents in view
    const ownBlockId = unionToBlock.get(node.unionId);
    const simpleCouple = !!node.wifeId && !(ownBlockId && blocks.get(ownBlockId)?.chainInfo);
    const innerPerson = !simpleCouple ? null
        : childSide === 'W' && husbandRun.length > 0 ? node.husbandId
        : childSide === 'H' && wifeRun.length > 0 ? node.wifeId
        : null;
    if (innerPerson && node.wifeId) {
        const partnerId = innerPerson === node.husbandId ? node.wifeId : node.husbandId;
        const besidePartner = !model.childToParentUnion.has(partnerId);
        inner.push({ personId: innerPerson, partnerId, besidePartner });
        if (besidePartner && innerPerson === node.husbandId) node.husbandBeyondWife = true;
        if (besidePartner && innerPerson === node.wifeId) node.wifeBeyondHusband = true;
    }
    if (node.husbandBeyondWife) {
        // The wife has no parents in view, so no siblings of her own
        node.runRight = rightRun(husbandRun);
    } else if (node.wifeBeyondHusband) {
        node.runLeft = leftRun(wifeRun);
    } else if (husbandSide === 'LEFT') {
        node.runLeft = leftRun(husbandRun);
        node.runRight = rightRun(wifeRun);
    } else {
        node.runRight = rightRun(husbandRun);
    }
    // Room for the pinned siblings beside the couple; where they stand over
    // their children is known only once the tree is placed
    const nearest = new Map([...node.pinned].map(id => [id, 0]));
    const packedLeft = packSiblingRun([...node.runLeft].reverse(), 'LEFT', node.generation, blocks, model, config, nearest);
    const packedRight = packSiblingRun(node.runRight, 'RIGHT', node.generation, blocks, model, config, nearest);
    node.extLeft = packedLeft.reach;
    node.extRight = packedRight.reach;
    node.rowExtLeft = packedLeft.rowReach;
    node.rowExtRight = packedRight.rowReach;

    const parentsSide = node.wifeId ? 'H' : null;
    attachSiblingRuns(node.hSubtree, outward, model, unionToBlock, blocks, config, taken, parentsSide, inner);
    attachSiblingRuns(node.wSubtree, outward, model, unionToBlock, blocks, config, taken, 'W', inner);
}

/** A block and every block below it (its children's blocks, recursively). */
function collectBlockSubtree(blockId: FamilyBlockId, blocks: Map<FamilyBlockId, FamilyBlock>): FamilyBlock[] {
    const out: FamilyBlock[] = [];
    const seen = new Set<FamilyBlockId>();
    const stack = [blockId];
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const block = blocks.get(id);
        if (!block) continue;
        out.push(block);
        stack.push(...block.childBlockIds);
    }
    return out;
}

/**
 * The cards of a block that are drawn: a chain leaves out a "?" stand-in
 * partner the diagram does not draw (placeholders.ts), whose slot only keeps
 * the room for the children below. A sibling packed by the cards then stands
 * beside the parent's own card, not a card's width away from it.
 */
function drawnCardExtent(
    block: FamilyBlock,
    model: LayoutModel,
    config: LayoutConfig
): { left: number; right: number } {
    const hidden = model.hiddenPersonIds;
    const chain = block.chainInfo;
    if (!chain || !hidden || !chain.personOrder.some(p => hidden.has(p))) return getBlockCardExtent(block, model, config);
    const centres = [...chain.personPositions].filter(([p]) => !hidden.has(p)).map(([, x]) => x);
    if (centres.length === 0) return getBlockCardExtent(block, model, config);
    return {
        left: Math.min(...centres) - config.cardWidth / 2,
        right: Math.max(...centres) + config.cardWidth / 2
    };
}

/**
 * Pack a sibling run row by row (attachSiblingRuns / placeSiblingRuns).
 *
 * Each sibling's block and everything below it moves as one piece, in
 * sibling order from the couple outward, only as far out as its cards need
 * to clear the cards already placed in the same rows (the couple's own cards
 * and the siblings nearer to it) by horizontalGap. Packing whole block widths
 * instead left a childless sibling standing a whole children row away from
 * the sibling before it, which pushed the run, and the parents centred above
 * it, far from their neighbours. No card of the run comes nearer to the
 * couple than the couple's own outer card edge, in any row, so the rows
 * below keep the room the run always had.
 *
 * A pinned member (`want`: its children are locked in the parents' row)
 * asks for the offset at which it stands over them. It stands there unless
 * the members nearer the couple already reach past it; the free members fill
 * the room before it in their order as long as they fit, the rest go beyond.
 * Its children do not move, so only its own row counts.
 *
 * `run` is innermost first. Returns each block's distance from the couple's
 * card edge (to the block's inner edge, xLeft on the right, xRight on the
 * left), the run's reach over all its rows and its reach in the couple's row.
 */
function packSiblingRun(
    run: FamilyBlockId[],
    outward: 'LEFT' | 'RIGHT',
    rowGeneration: number,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig,
    want: Map<FamilyBlockId, number> = new Map()
): { offsets: Map<FamilyBlockId, number>; reach: number; rowReach: number } {
    const offsets = new Map<FamilyBlockId, number>();
    const frontier = new Map<number, number>();
    // The cards of a block and everything below it it moves with, per row,
    // as distances outward from the block's inner edge
    const rowsOf = (id: FamilyBlockId, block: FamilyBlock): Map<number, { near: number; far: number }> => {
        const inner = outward === 'RIGHT' ? block.xLeft : block.xRight;
        const rows = new Map<number, { near: number; far: number }>();
        for (const b of collectBlockSubtree(id, blocks)) {
            if (b.generation >= -1) continue;
            const cards = drawnCardExtent(b, model, config);
            const near = outward === 'RIGHT' ? cards.left - inner : inner - cards.right;
            const far = outward === 'RIGHT' ? cards.right - inner : inner - cards.left;
            const row = rows.get(b.generation);
            rows.set(b.generation, row
                ? { near: Math.min(row.near, near), far: Math.max(row.far, far) }
                : { near, far });
        }
        if (rows.size === 0) rows.set(block.generation, { near: 0, far: block.width });
        return rows;
    };
    const firstFree = (rows: Map<number, { near: number; far: number }>): number => {
        let offset = -Infinity;
        for (const [gen, row] of rows) offset = Math.max(offset, (frontier.get(gen) ?? 0) + config.horizontalGap - row.near);
        return offset;
    };
    const put = (id: FamilyBlockId, rows: Map<number, { near: number; far: number }>, offset: number): void => {
        offsets.set(id, offset);
        for (const [gen, row] of rows) frontier.set(gen, Math.max(frontier.get(gen) ?? 0, offset + row.far));
    };
    const pins = run
        .filter(id => want.has(id) && blocks.has(id))
        .map(id => ({ id, rows: rowsOf(id, blocks.get(id)!), at: want.get(id)! }))
        .sort((a, b) => a.at - b.at);
    for (const id of run) {
        const block = blocks.get(id);
        if (!block || want.has(id)) continue;
        const rows = rowsOf(id, block);
        // A pinned member whose place this one would reach goes first
        while (pins.length > 0) {
            const offset = firstFree(rows);
            const pin = pins[0];
            const clash = [...rows].some(([gen, row]) => {
                const pinRow = pin.rows.get(gen);
                return !!pinRow && offset + row.far + config.horizontalGap > pin.at + pinRow.near;
            });
            if (!clash) break;
            put(pin.id, pin.rows, Math.max(pin.at, firstFree(pin.rows)));
            pins.shift();
        }
        put(id, rows, firstFree(rows));
    }
    for (const pin of pins) put(pin.id, pin.rows, Math.max(pin.at, firstFree(pin.rows)));
    const reach = frontier.size > 0 ? Math.max(0, ...frontier.values()) : 0;
    return { offsets, reach, rowReach: frontier.get(rowGeneration) ?? 0 };
}

/** A person's card center as the blocks have it now (undefined: not laid out). */
function personCenterInBlocks(
    personId: PersonId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): number | undefined {
    const unionId = model.personToUnion.get(personId);
    const blockId = unionId ? unionToBlock.get(unionId) : undefined;
    const block = blockId ? blocks.get(blockId) : undefined;
    if (!block) return undefined;
    if (block.chainInfo) return block.chainInfo.personPositions.get(personId);
    const union = model.unions.get(block.rootUnionId);
    if (!union) return undefined;
    if (!union.partnerB) return union.partnerA === personId ? block.xCenter : undefined;
    const [leftId, rightId] = union.swapped ? [union.partnerB, union.partnerA] : [union.partnerA, union.partnerB];
    const offset = config.partnerGap / 2 + config.cardWidth / 2;
    return personId === leftId ? block.xCenter - offset : personId === rightId ? block.xCenter + offset : undefined;
}

/**
 * An ancestor's other partner in a partner chain stands next to the partner,
 * not across the room the chain kept for the couple's children.
 *
 * A chain block sizes the primary couple's area for the couple's children
 * and stops an extra partner who has children at the inner edge of their own
 * slot (measure/placement: the stem must stay above the children). In the
 * ancestor rows that area is empty: Phase B lays the couple's children out
 * as a sibling run around the direct-line child, wherever the tree needs
 * them, so the extra partner stood one or more card widths away from the
 * partner with nothing in between, and their stem away from their own
 * children (ancestors' children shown in place, PipelineInput.expandChildrenOf).
 *
 * Each extra partner moves toward the partner, from the couple outward, up to
 * the card beside them; one with children drawn stops where the stem reaches
 * the nearest child's center (never moving away from the children), and never
 * farther from their own parents' line than before. Only the ancestor rows
 * (gen <= -2) move: Phase B owns them; the cards stay inside the chain's own
 * stretch of the row, so no other card is in the way.
 */
function gatherAncestorChainPartners(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    const half = config.cardWidth / 2;
    for (const [, block] of blocks) {
        const chain = block.chainInfo;
        if (!chain || block.generation > -2) continue;
        const order = chain.personOrder;
        const primary = chain.primaryCouple ?? [];
        const first = order.findIndex(p => primary.includes(p));
        if (first < 0) continue;
        let last = first;
        while (last + 1 < order.length && primary.includes(order[last + 1])) last++;
        const positions = chain.personPositions;

        // The drawn children of the unions each extra partner stems
        const childCenters = new Map<PersonId, number[]>();
        for (const unionId of chain.unionIds) {
            const union = model.unions.get(unionId);
            if (!union) continue;
            const extra = findChainExtraPartner(union, chain, model);
            if (!extra) continue;
            const list = childCenters.get(extra) ?? [];
            for (const childId of union.childIds) {
                const x = personCenterInBlocks(childId, blocks, model, unionToBlock, config);
                if (x !== undefined) list.push(x);
            }
            childCenters.set(extra, list);
        }
        // Where the person's parents' line comes down (undefined: no parents in view)
        const parentsX = (pid: PersonId): number | undefined => {
            const unionId = model.childToParentUnion.get(pid);
            const union = unionId ? model.unions.get(unionId) : undefined;
            if (!union || !unionToBlock.has(unionId!)) return undefined;
            const xs = [union.partnerA, union.partnerB]
                .map(p => p ? personCenterInBlocks(p, blocks, model, unionToBlock, config) : undefined)
                .filter((x): x is number => x !== undefined);
            return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
        };

        let edge = (positions.get(order[first]) ?? 0) - half;
        for (let i = first - 1; i >= 0; i--) {
            const pid = order[i];
            const current = positions.get(pid);
            if (current === undefined) continue;
            const beside = edge - config.partnerGap - half;
            const kids = childCenters.get(pid) ?? [];
            const target = kids.length > 0 ? Math.min(beside, Math.max(current, Math.max(...kids))) : beside;
            let next = Math.max(current, target);
            // Never farther from the person's own parents than now
            const up = parentsX(pid);
            if (up !== undefined) next = Math.max(current, Math.min(next, up + Math.abs(current - up)));
            positions.set(pid, next);
            edge = next - half;
        }
        edge = (positions.get(order[last]) ?? 0) + half;
        for (let i = last + 1; i < order.length; i++) {
            const pid = order[i];
            const current = positions.get(pid);
            if (current === undefined) continue;
            const beside = edge + config.partnerGap + half;
            const kids = childCenters.get(pid) ?? [];
            const target = kids.length > 0 ? Math.max(beside, Math.min(current, Math.min(...kids))) : beside;
            let next = Math.min(current, target);
            const up = parentsX(pid);
            if (up !== undefined) next = Math.min(current, Math.max(next, up - Math.abs(current - up)));
            positions.set(pid, next);
            edge = next + half;
        }
        block.husbandAnchorX = positions.get(order[0]) ?? block.husbandAnchorX;
        block.wifeAnchorX = positions.get(order[order.length - 1]) ?? block.wifeAnchorX;
    }
}

/**
 * The children of a "?" stand-in's family stand under the known parent.
 *
 * A chain keeps a slot for a stand-in partner the diagram does not draw
 * (placeholders.ts), and the family's children stand centred under the
 * couple the slot makes — half a card out from the known parent, whose card
 * the line actually comes from, and that far from the children of the
 * parent's next family. In the ancestor rows (gen <= -2, Phase B owns them
 * and everything below them there) the children move toward the known
 * parent's card, at most until they stand under it, and only as far as the
 * nearest other card in each of their rows leaves room.
 */
function tuckStandInChildren(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): void {
    const hidden = model.hiddenPersonIds;
    if (!hidden) return;
    for (const [, block] of blocks) {
        const chain = block.chainInfo;
        if (!chain || block.generation > -3) continue;
        for (const [unionId, kidIds] of chain.unionChildBlockIds) {
            const union = model.unions.get(unionId);
            if (!union?.partnerB || kidIds.length === 0) continue;
            const standIn = hidden.has(union.partnerA) ? union.partnerA : hidden.has(union.partnerB) ? union.partnerB : undefined;
            if (!standIn) continue;
            const known = standIn === union.partnerA ? union.partnerB : union.partnerA;
            const standInX = chain.personPositions.get(standIn);
            const knownX = chain.personPositions.get(known);
            if (standInX === undefined || knownX === undefined) continue;
            const moving = kidIds.flatMap(id => collectBlockSubtree(id, blocks));
            if (moving.some(b => b.generation >= -1)) continue;
            const movingIds = new Set(moving.map(b => b.id));
            const kidRow = moving.filter(b => kidIds.includes(b.id)).map(b => drawnCardExtent(b, model, config));
            const kidCenter = (Math.min(...kidRow.map(e => e.left)) + Math.max(...kidRow.map(e => e.right))) / 2;
            const dir = knownX > standInX ? 1 : -1;
            let shift = (knownX - kidCenter) * dir;
            if (shift <= 0.5) continue;
            // Room before the nearest other card in each row the children take
            const rows = new Map<number, { left: number; right: number }>();
            for (const b of moving) {
                const e = drawnCardExtent(b, model, config);
                const row = rows.get(b.generation);
                rows.set(b.generation, row ? { left: Math.min(row.left, e.left), right: Math.max(row.right, e.right) } : e);
            }
            for (const [, other] of blocks) {
                if (movingIds.has(other.id)) continue;
                const row = rows.get(other.generation);
                if (!row) continue;
                const e = drawnCardExtent(other, model, config);
                const room = dir > 0 ? e.left - row.right : row.left - e.right;
                if (room >= -0.5) shift = Math.min(shift, room - config.horizontalGap);
            }
            if (shift <= 0.5) continue;
            for (const b of moving) shiftBlock(b, shift * dir);
        }
    }
}

/**
 * Put each node's sibling runs (attachSiblingRuns) into the room the tree kept
 * beside the couple, in sibling order, each with its own blocks below it.
 */
function placeSiblingRuns(
    node: AncestorNode | null,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig,
    claimed?: Set<FamilyBlockId>,
    transferred?: Set<FamilyBlockId>
): void {
    if (!node) return;
    const ownBlockId = unionToBlock.get(node.unionId);
    const ownBlock = ownBlockId ? blocks.get(ownBlockId) : undefined;
    const cards = ownBlock
        ? getBlockCardExtent(ownBlock, model, config)
        : { left: node.xCenter - node.coupleWidth / 2, right: node.xCenter + node.coupleWidth / 2 };
    const moveTo = (id: FamilyBlockId, left: number): void => {
        const block = blocks.get(id);
        if (!block) return;
        const delta = left - block.xLeft;
        for (const b of collectBlockSubtree(id, blocks)) {
            // A pinned sibling's children stay where Phase A locked them
            if (b.generation >= -1) continue;
            if (!guardAncestorOnly(b, 'placeSiblingRuns')) continue;
            shiftBlock(b, delta);
            claimed?.add(b.id);
            transferred?.add(b.id);
        }
    };
    // Where each pinned sibling stands over its children: the couple's cards
    // centred over the children's cards, as an offset from the couple
    const wantOf = (outward: 'LEFT' | 'RIGHT'): Map<FamilyBlockId, number> => {
        const want = new Map<FamilyBlockId, number>();
        for (const id of node.pinned) {
            const block = blocks.get(id);
            if (!block) continue;
            const kids = block.childBlockIds
                .map(c => blocks.get(c))
                .filter((b): b is FamilyBlock => !!b)
                .map(b => getBlockCardExtent(b, model, config));
            if (kids.length === 0) continue;
            const own = getBlockCardExtent(block, model, config);
            const delta = (Math.min(...kids.map(k => k.left)) + Math.max(...kids.map(k => k.right))) / 2
                - (own.left + own.right) / 2;
            want.set(id, outward === 'RIGHT' ? block.xLeft + delta - cards.right : cards.left - (block.xRight + delta));
        }
        return want;
    };
    const left = packSiblingRun([...node.runLeft].reverse(), 'LEFT', node.generation, blocks, model, config, wantOf('LEFT'));
    for (const [id, offset] of left.offsets) {
        const block = blocks.get(id);
        if (block) moveTo(id, cards.left - offset - block.width);
    }
    const right = packSiblingRun(node.runRight, 'RIGHT', node.generation, blocks, model, config, wantOf('RIGHT'));
    for (const [id, offset] of right.offsets) moveTo(id, cards.right + offset);
    placeSiblingRuns(node.hSubtree, blocks, model, unionToBlock, config, claimed, transferred);
    placeSiblingRuns(node.wSubtree, blocks, model, unionToBlock, config, claimed, transferred);
}

/**
 * Prune tree nodes whose blocks were already positioned by an earlier tree
 * (shared ancestors in a pedigree collapse belong to the first tree).
 */
/** Collect the block ids of every union in an ancestor tree into `out`. */
function collectTreeBlockIds(
    node: AncestorNode | null,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    out: Set<FamilyBlockId>
): void {
    if (!node) return;
    const blockId = unionToBlock.get(node.unionId);
    if (blockId) out.add(blockId);
    collectTreeBlockIds(node.hSubtree, unionToBlock, out);
    collectTreeBlockIds(node.wSubtree, unionToBlock, out);
}

function pruneClaimedTreeNodes(
    node: AncestorNode | null,
    claimed: Set<FamilyBlockId>,
    unionToBlock: Map<UnionId, FamilyBlockId>
): AncestorNode | null {
    if (!node) return null;
    const blockId = unionToBlock.get(node.unionId);
    if (blockId && claimed.has(blockId)) return null;
    node.hSubtree = pruneClaimedTreeNodes(node.hSubtree, claimed, unionToBlock);
    node.wSubtree = pruneClaimedTreeNodes(node.wSubtree, claimed, unionToBlock);
    return node;
}

/**
 * Rigidly separate placed ancestor-tree clusters. Overlaps (per generation
 * band, card extents) are resolved by shifting the LOWER-priority cluster
 * away from the higher-priority one; each cluster moves as a whole so its
 * internal tree geometry stays intact.
 */
interface TreeCluster {
    blockIds: Set<FamilyBlockId>;
    anchorX: number;
    priority: number;
    /** Cumulative shift applied during separation (0 = still on anchor). */
    totalShift: number;
}

function separateTreeClusters(
    clusters: TreeCluster[],
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): void {
    if (clusters.length < 2) return;

    const clusterExtents = (c: TreeCluster): Map<number, { left: number; right: number }> => {
        const map = new Map<number, { left: number; right: number }>();
        for (const id of c.blockIds) {
            const block = blocks.get(id);
            if (!block) continue;
            const ext = getBlockCardExtent(block, model, config);
            const row = map.get(block.generation);
            if (row) {
                row.left = Math.min(row.left, ext.left);
                row.right = Math.max(row.right, ext.right);
            } else {
                map.set(block.generation, { left: ext.left, right: ext.right });
            }
        }
        return map;
    };

    // Deterministic two-sided sweep around the focus cluster (priority 0):
    // clusters keep their anchor left-to-right ORDER; the focus cluster does
    // not move; clusters left of it are pushed only further LEFT, clusters
    // right of it only further RIGHT. This displaces each cluster minimally
    // while never dragging one across another (a pairwise loop could walk a
    // cluster across the whole layout, far away from its anchor).
    const ordered = [...clusters].sort((a, b) => a.anchorX - b.anchorX);
    let focusIdx = ordered.findIndex(c => c.priority === 0);
    if (focusIdx < 0) focusIdx = 0;

    type Frontier = Map<number, { left: number; right: number }>;
    const mergeFrontier = (frontier: Frontier, ext: Map<number, { left: number; right: number }>): void => {
        for (const [gen, e] of ext) {
            const row = frontier.get(gen);
            if (row) {
                row.left = Math.min(row.left, e.left);
                row.right = Math.max(row.right, e.right);
            } else {
                frontier.set(gen, { ...e });
            }
        }
    };

    const shiftCluster = (c: TreeCluster, delta: number): void => {
        if (Math.abs(delta) < 0.5) return;
        for (const id of c.blockIds) {
            const block = blocks.get(id);
            if (block) shiftBlock(block, delta);
        }
        c.totalShift += delta;
    };

    // Rightward sweep from the focus cluster
    const rightFrontier: Frontier = new Map();
    mergeFrontier(rightFrontier, clusterExtents(ordered[focusIdx]));
    for (let i = focusIdx + 1; i < ordered.length; i++) {
        const ext = clusterExtents(ordered[i]);
        let shift = 0;
        for (const [gen, e] of ext) {
            const row = rightFrontier.get(gen);
            if (!row) continue;
            shift = Math.max(shift, row.right + config.horizontalGap - e.left);
        }
        shiftCluster(ordered[i], shift);
        mergeFrontier(rightFrontier, clusterExtents(ordered[i]));
    }

    // Leftward sweep from the focus cluster
    const leftFrontier: Frontier = new Map();
    mergeFrontier(leftFrontier, clusterExtents(ordered[focusIdx]));
    for (let i = focusIdx - 1; i >= 0; i--) {
        const ext = clusterExtents(ordered[i]);
        let shift = 0;
        for (const [gen, e] of ext) {
            const row = leftFrontier.get(gen);
            if (!row) continue;
            shift = Math.min(shift, row.left - config.horizontalGap - e.right);
        }
        shiftCluster(ordered[i], shift);
        mergeFrontier(leftFrontier, clusterExtents(ordered[i]));
    }
}

/**
 * Phase B v2: Build and place independent compact ancestor trees.
 *
 * This is the main Phase B entry point. For EVERY gen -1 anchor couple
 * (focus parents first, then the spouse's parents and any other parent
 * couples left-to-right) it:
 * 1. Builds independent H-tree and W-tree for the couple's ancestors
 * 2. Computes widths bottom-up
 * 3. Places each tree so it doesn't cross the couple midpoint
 * 4. Resolves overlap between the couple's own two trees
 * 5. Transfers positions to FamilyBlocks (shared ancestors stay with the
 *    first tree that claimed them)
 * Finally, whole tree clusters of different anchors are rigidly separated.
 *
 * Key invariant: within a couple, H-tree stays LEFT of the midpoint and
 * W-tree RIGHT of it; between couples, clusters never overlap.
 */
function runPhaseBIndependentTrees(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    genModel: GenerationalModel,
    focusPersonId: PersonId,
    config: LayoutConfig
): void {
    // Anchor couples: every gen -1 block roots an ancestor tree pair.
    // Focus parents get priority 0, the rest follow left-to-right.
    const anchorBlocks: FamilyBlock[] = [];
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    const focusParentBlockId = focusParentUnionId ? unionToBlock.get(focusParentUnionId) : undefined;
    const focusParentBlock = focusParentBlockId ? blocks.get(focusParentBlockId) : undefined;
    if (focusParentBlock) anchorBlocks.push(focusParentBlock);

    const otherAnchors: FamilyBlock[] = [];
    for (const [, block] of blocks) {
        if (block.generation !== -1) continue;
        if (block === focusParentBlock) continue;
        otherAnchors.push(block);
    }
    otherAnchors.sort((a, b) => a.xCenter - b.xCenter);
    anchorBlocks.push(...otherAnchors);
    if (anchorBlocks.length === 0) return;

    // Find minimum generation (deepest ancestors)
    const minGen = genModel.minGen;

    // V-fan context: when BOTH partners of the focus couple have ancestors,
    // each partner's entire ancestry must stay on that partner's side of the
    // couple midline. sideOf() tells which side a parent union belongs to.
    let focusSideFan: {
        midlineX: number;
        sideOf: (parentUnion: UnionNode) => 'LEFT' | 'RIGHT' | null;
    } | null = null;
    const focusUnionId = model.personToUnion.get(focusPersonId);
    const focusUnion = focusUnionId ? model.unions.get(focusUnionId) : undefined;
    const focusBlockId = focusUnionId ? unionToBlock.get(focusUnionId) : undefined;
    const focusBlock = focusBlockId ? blocks.get(focusBlockId) : undefined;
    if (focusUnion && focusUnion.partnerB && focusBlock && !focusBlock.chainInfo) {
        const aParentUnion = model.childToParentUnion.get(focusUnion.partnerA);
        const bParentUnion = model.childToParentUnion.get(focusUnion.partnerB);
        if (aParentUnion && bParentUnion && aParentUnion !== bParentUnion) {
            // partnerA renders left, partnerB right (visual swap only changes
            // card X, and the swap decision itself follows parent positions)
            const leftPartner = focusUnion.swapped ? focusUnion.partnerB : focusUnion.partnerA;
            const leftParentUnion = model.childToParentUnion.get(leftPartner);
            focusSideFan = {
                midlineX: focusBlock.xCenter,
                sideOf: (parentUnion: UnionNode): 'LEFT' | 'RIGHT' | null => {
                    if (parentUnion.id === aParentUnion || parentUnion.id === bParentUnion) {
                        return parentUnion.id === leftParentUnion ? 'LEFT' : 'RIGHT';
                    }
                    return null;
                }
            };
        }
    }

    const claimed = new Set<FamilyBlockId>();
    const clusters: TreeCluster[] = [];

    for (let priority = 0; priority < anchorBlocks.length; priority++) {
        const anchorBlock = anchorBlocks[priority];
        const anchorUnion = model.unions.get(anchorBlock.rootUnionId);
        if (!anchorUnion) continue;

        // Determine H/W for anchor couple
        const { husbandId: anchorHusbandId, wifeId: anchorWifeId } =
            determineHusbandWife(anchorUnion, model);

        // Compute key positions (from gen -1 block, which is LOCKED).
        // Chain anchors know each person's actual position.
        const chainPos = (pid: PersonId | null): number | undefined =>
            pid && anchorBlock.chainInfo ? anchorBlock.chainInfo.personPositions.get(pid) : undefined;
        const husbandCenterX = chainPos(anchorHusbandId) ?? (anchorWifeId
            ? anchorBlock.xCenter - config.partnerGap / 2 - config.cardWidth / 2
            : anchorBlock.xCenter);
        const wifeCenterX = chainPos(anchorWifeId) ?? (anchorWifeId
            ? anchorBlock.xCenter + config.partnerGap / 2 + config.cardWidth / 2
            : anchorBlock.xCenter);

        // Build independent ancestor trees, pruning nodes already claimed
        // by a higher-priority anchor's tree
        const hTree = pruneClaimedTreeNodes(
            buildAncestorTree(anchorHusbandId, -2, model, minGen), claimed, unionToBlock);
        // A cousin marriage shares ancestors WITHIN one anchor: the same union
        // sits in both partners' trees, so the wife's tree must also prune
        // everything the husband's tree already carries. Claims are only
        // recorded at transfer time, which is too late — without this the
        // shared (possibly chain-wide) union inflates the wife-tree width and
        // its edge-aligned placement shoves her direct parents far right of
        // her own card (devel-demo: Alois+Růžena landed ~1600px from Vlasta).
        const hClaims = new Set(claimed);
        collectTreeBlockIds(hTree, unionToBlock, hClaims);
        const wTree = anchorWifeId
            ? pruneClaimedTreeNodes(
                buildAncestorTree(anchorWifeId, -2, model, minGen), hClaims, unionToBlock)
            : null;
        if (!hTree && !wTree) continue;

        // Siblings of ancestors shown beside them get their room in the tree
        const taken = new Set(hClaims);
        collectTreeBlockIds(wTree, unionToBlock, taken);
        const inner: InnerSiblingRun[] = [];
        attachSiblingRuns(hTree, 'LEFT', model, unionToBlock, blocks, config, taken, anchorWifeId ? 'H' : null, inner);
        attachSiblingRuns(wTree, 'RIGHT', model, unionToBlock, blocks, config, taken, 'W', inner);
        if (inner.length > 0) (model.innerSiblingRuns ??= []).push(...inner);

        // Compute widths (bottom-up)
        const hWidth = computeAncestorTreeWidth(hTree, config, blocks, unionToBlock);
        const wWidth = computeAncestorTreeWidth(wTree, config, blocks, unionToBlock);

        // Compute card edges (not centers) - boundaries for tree placement
        const husbandRightEdge = husbandCenterX + config.cardWidth / 2;
        const wifeLeftEdge = wifeCenterX - config.cardWidth / 2;

        // Place trees
        // Special case: if only ONE tree exists, center it above its parent
        if (hTree && !wTree) {
            placeAncestorTree(hTree, husbandCenterX, config);
        } else if (wTree && !hTree) {
            placeAncestorTree(wTree, wifeCenterX, config);
        } else {
            // Both trees exist: place them above their own partner and pull
            // each back only as far as the couple midline demands
            if (hTree) {
                placeSubtreeAgainstBoundary(hTree, husbandCenterX, husbandRightEdge, 'LEFT', config);
            }
            if (wTree) {
                placeSubtreeAgainstBoundary(wTree, wifeCenterX, wifeLeftEdge, 'RIGHT', config);
            }
        }

        const dbg = (globalThis as unknown as { __PHB_DEBUG?: boolean }).__PHB_DEBUG;
        const stamp = (label: string): void => {
            if (!dbg) return;
            console.log(`[PHB:${label}] anchor=${anchorBlock.id} hW=${hWidth.toFixed(0)} wW=${wWidth.toFixed(0)}`
                + ` h=[${findTreeMinX(hTree, config).toFixed(0)},${findTreeMaxX(hTree, config).toFixed(0)}]`
                + ` w=[${findTreeMinX(wTree, config).toFixed(0)},${findTreeMaxX(wTree, config).toFixed(0)}]`
                + ` wCenter=${wTree ? wTree.xCenter.toFixed(0) : '-'}`);
        };
        stamp('placed');
        if (dbg) {
            const dump = (n: AncestorNode | null, side: string, depth: number): void => {
                if (!n) return;
                console.log(`[PHB:tree] ${'  '.repeat(depth)}${side} union=${n.unionId} coupleW=${n.coupleWidth.toFixed(0)} width=${n.width.toFixed(0)} x=${n.xCenter.toFixed(0)}`);
                dump(n.hSubtree, 'h', depth + 1);
                dump(n.wSubtree, 'w', depth + 1);
            };
            dump(hTree, 'H', 0);
            dump(wTree, 'W', 0);
        }

        // Enforce H/W boundaries for ALL couples in each tree
        enforceAllBoundariesUntilConvergence(hTree, config);
        enforceAllBoundariesUntilConvergence(wTree, config);
        stamp('bounds');

        // Resolve any overlap between the couple's own two trees
        resolveAncestorTreeOverlap(hTree, wTree, config);
        stamp('overlap');

        // V-fan side ownership above the focus couple: the ENTIRE ancestry of
        // each focus-couple partner stays on that partner's side of the couple
        // midline (paternal branch left, maternal branch right — classic
        // pedigree reading). Without this, the anchor couple's wife-tree is
        // packed tight against her card and sprawls over the other partner's
        // zone. Applied only when BOTH partners have ancestors — a lone tree
        // stays centered, which is more compact.
        if (focusSideFan) {
            const side = focusSideFan.sideOf(anchorUnion);
            if (side === 'LEFT') {
                const pairMax = Math.max(findTreeMaxX(hTree, config), findTreeMaxX(wTree, config));
                const limit = focusSideFan.midlineX - config.horizontalGap / 2;
                if (isFinite(pairMax) && pairMax > limit) {
                    shiftAncestorTree(hTree, limit - pairMax);
                    shiftAncestorTree(wTree, limit - pairMax);
                }
            } else if (side === 'RIGHT') {
                const pairMin = Math.min(findTreeMinX(hTree, config), findTreeMinX(wTree, config));
                const limit = focusSideFan.midlineX + config.horizontalGap / 2;
                if (isFinite(pairMin) && pairMin < limit) {
                    shiftAncestorTree(hTree, limit - pairMin);
                    shiftAncestorTree(wTree, limit - pairMin);
                }
            }
        }

        // Transfer positions to FamilyBlocks
        const transferred = new Set<FamilyBlockId>();
        transferAncestorTreeToBlocks(hTree, blocks, unionToBlock, config, claimed, transferred);
        transferAncestorTreeToBlocks(wTree, blocks, unionToBlock, config, claimed, transferred);
        placeSiblingRuns(hTree, blocks, model, unionToBlock, config, claimed, transferred);
        placeSiblingRuns(wTree, blocks, model, unionToBlock, config, claimed, transferred);

        if ((globalThis as unknown as { __PHB_DEBUG?: boolean }).__PHB_DEBUG) {
            console.log(`[PHB] anchor=${anchorBlock.id} x=${anchorBlock.xCenter.toFixed(0)} hTree=${!!hTree} wTree=${!!wTree} transferred=${transferred.size}`);
        }
        if (transferred.size > 0) {
            clusters.push({ blockIds: transferred, anchorX: anchorBlock.xCenter, priority, totalShift: 0 });
        }
    }

    // Rigidly separate tree clusters of different anchors
    separateTreeClusters(clusters, blocks, model, config);
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

    {
        const trapIds = (globalThis as unknown as { __TRAP_BLOCKS?: string[] }).__TRAP_BLOCKS;
        if (trapIds) {
            for (const tid of trapIds) {
                const blk = blocks.get(tid as FamilyBlockId);
                if (!blk) continue;
                let val = blk.xCenter;
                Object.defineProperty(blk, 'xCenter', {
                    get() { return val; },
                    set(v: number) {
                        if (Math.abs(v - val) > 0.5) {
                            console.log(`[TRAP] ${tid} xCenter ${val.toFixed(1)} -> ${v.toFixed(1)}\n` +
                                new Error().stack?.split('\n').slice(2, 6).join('\n'));
                        }
                        val = v;
                    },
                    configurable: true,
                });
            }
        }
    }

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

    // Pull childless sibling cards out from behind foreign columns (e.g.
    // spouse siblings placed beyond an in-law ancestor stack) so their bus
    // doesn't have to span across foreign stems.
    compactLeafSiblingGroups(blocks, model, fbm.unionToBlock, config);

    // Same idea for whole sibling SUBTREES split from their group by a
    // foreign column, when a free slot exists next to the group core.
    relocateSplitSiblingSubtrees(blocks, model, fbm.unionToBlock, config);

    // Resolve card overlaps between gen -1 parent couples (focus parents vs
    // spouse parents). These fall outside both the descendant sweep (gen >= 0)
    // and Phase B (gen <= -2). The non-focus-parent block moves away, together
    // with its ancestor stack, without touching gen >= 0 positions.
    if (input.focusPersonId) {
        resolveParentCoupleOverlaps(blocks, model, fbm.unionToBlock, input.focusPersonId, config);
    }

    // Children of an ancestor's sibling drawn in the parents' row move up to
    // the focus family, so the sibling can stand over them in its run
    if (input.focusPersonId) {
        pullAncestorSiblingChildren(blocks, model, fbm.unionToBlock, input.focusPersonId, new Set(input.expandChildrenOf ?? []), config);
    }

    // Capture locked positions for gen>=0 after Phase A is complete
    // This will be used to verify Phase B doesn't modify descendant positions
    const lockedX = captureLockedPositions(
        blocks, measured.genModel, model, fbm.unionToBlock, config
    );

    if (input.stopAfterPhase === 'A') {
        applyDiamondPartnerSwaps(blocks, model, fbm.unionToBlock);
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
        // Passes stop once nothing moves; ancestors' children shown in place
        // (PipelineInput.expandChildrenOf) can need more than a few.
        for (let pass = 0; pass < 20; pass++) {
            const delta = resolveOverlapsOutward(blocks, model, fbm.unionToBlock, config);
            if (delta < 0.5) break;
        }

        gatherAncestorChainPartners(blocks, model, fbm.unionToBlock, config);
        tuckStandInChildren(blocks, model, config);
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
    applyDiamondPartnerSwaps(blocks, model, fbm.unionToBlock);
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
 * Pull childless sibling blocks next to their sibling-group core when a
 * FOREIGN card column stands between them.
 *
 * Typical case: focus spouse's siblings get placed beyond the focus block's
 * descendants envelope, and an in-law ancestor column (parents of a
 * descendant's spouse) ends up between them and the rest of the group. The
 * parents' bus must then span across the foreign column — its stem pierces
 * the bus. Childless sibling cards can instead sit in free row space right
 * next to the group core, keeping the bus span clear of foreign columns.
 */
function compactLeafSiblingGroups(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    // Card extents of every block per generation (for free-space checks)
    const extentsByGen = new Map<number, Array<{ blockId: FamilyBlockId; left: number; right: number }>>();
    for (const [, b] of blocks) {
        const ext = getBlockCardExtent(b, model, config);
        if (!extentsByGen.has(b.generation)) extentsByGen.set(b.generation, []);
        extentsByGen.get(b.generation)!.push({ blockId: b.id, left: ext.left, right: ext.right });
    }

    for (const [uid, union] of model.unions) {
        if (union.childIds.length < 2) continue;
        const parentBlockId = unionToBlock.get(uid);
        const parentBlock = parentBlockId ? blocks.get(parentBlockId) : undefined;
        if (!parentBlock || parentBlock.chainInfo) continue;

        // Partition children: relocatable leaves vs core (everything else)
        interface LeafInfo { block: FamilyBlock; left: number; right: number }
        const leaves: LeafInfo[] = [];
        let coreLeft = Infinity;
        let coreRight = -Infinity;
        const siblingBlockIds = new Set<FamilyBlockId>();

        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            const childBlockId = childUnionId ? unionToBlock.get(childUnionId) : undefined;
            const childBlock = childBlockId ? blocks.get(childBlockId) : undefined;
            if (!childBlock) continue;
            if (siblingBlockIds.has(childBlock.id)) continue;
            siblingBlockIds.add(childBlock.id);
            const ext = getBlockCardExtent(childBlock, model, config);
            const childUnion = model.unions.get(childBlock.rootUnionId);
            const isLeaf = childBlock.parentBlockId === parentBlock.id &&
                childBlock.childBlockIds.length === 0 &&
                !childBlock.chainInfo &&
                (childUnion?.childIds.length ?? 0) === 0;
            if (isLeaf) {
                leaves.push({ block: childBlock, left: ext.left, right: ext.right });
            } else {
                coreLeft = Math.min(coreLeft, ext.left);
                coreRight = Math.max(coreRight, ext.right);
            }
        }
        if (leaves.length === 0 || !isFinite(coreLeft)) continue;

        const gen = leaves[0].block.generation;
        const rowExtents = extentsByGen.get(gen) ?? [];
        const gap = config.horizontalGap;

        // Process leaves nearest to the core first
        leaves.sort((a, b) => {
            const da = a.left > coreRight ? a.left - coreRight : coreLeft - a.right;
            const db = b.left > coreRight ? b.left - coreRight : coreLeft - b.right;
            return da - db;
        });

        for (const leaf of leaves) {
            const onRight = leaf.left >= coreRight;
            // Is a foreign card column standing between the leaf and the core?
            let hasForeignBetween = false;
            for (const ext of rowExtents) {
                if (ext.blockId === leaf.block.id || siblingBlockIds.has(ext.blockId)) continue;
                const inBetween = onRight
                    ? ext.right > coreRight && ext.left < leaf.left
                    : ext.left < coreLeft && ext.right > leaf.right;
                if (inBetween) { hasForeignBetween = true; break; }
            }
            if (!hasForeignBetween) continue;

            const width = leaf.right - leaf.left;

            // Try the slot on the leaf's own side of the core first; if that
            // is occupied, the OTHER side of the core is just as good — the
            // point is contiguity of the sibling group, not which side.
            const candidates = onRight
                ? [coreRight + gap, coreLeft - gap - width]
                : [coreLeft - gap - width, coreRight + gap];

            for (const targetLeft of candidates) {
                const targetRight = targetLeft + width;

                // Target slot must be free of ALL other cards in the row
                let free = true;
                for (const ext of rowExtents) {
                    if (ext.blockId === leaf.block.id) continue;
                    if (targetLeft < ext.right + gap && targetRight > ext.left - gap) {
                        free = false;
                        break;
                    }
                }
                if (!free) continue;

                const delta = targetLeft - leaf.left;
                shiftBlock(leaf.block, delta);
                // Update bookkeeping
                const rowEntry = rowExtents.find(e => e.blockId === leaf.block.id);
                if (rowEntry) { rowEntry.left += delta; rowEntry.right += delta; }
                coreLeft = Math.min(coreLeft, targetLeft);
                coreRight = Math.max(coreRight, targetRight);
                break;
            }
        }
    }
}

/**
 * Card extents of a block's whole subtree, per generation.
 */
function subtreeCardExtentsByGen(
    rootBlockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    config: LayoutConfig
): { extents: Map<number, { left: number; right: number }>; ids: Set<FamilyBlockId> } {
    const extents = new Map<number, { left: number; right: number }>();
    const ids = new Set<FamilyBlockId>();
    const stack = [rootBlockId];
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (ids.has(id)) continue;
        ids.add(id);
        const block = blocks.get(id);
        if (!block) continue;
        const ext = getBlockCardExtent(block, model, config);
        const row = extents.get(block.generation);
        if (row) {
            row.left = Math.min(row.left, ext.left);
            row.right = Math.max(row.right, ext.right);
        } else {
            extents.set(block.generation, { left: ext.left, right: ext.right });
        }
        for (const childId of block.childBlockIds) stack.push(childId);
    }
    return { extents, ids };
}

/**
 * Relocate whole sibling SUBTREES that ended up beyond a foreign column
 * (e.g. an uncle's family pushed past the in-law ancestor complex). The
 * subtree is moved next to the sibling-group core — same side first, then
 * the opposite side — but only when every generation row it occupies has
 * free space at the target. Runs after compactLeafSiblingGroups; leaf
 * blocks are already handled there.
 */
function relocateSplitSiblingSubtrees(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    config: LayoutConfig
): void {
    const gap = config.horizontalGap;

    // All block card extents grouped per generation
    const rowsByGen = new Map<number, Array<{ blockId: FamilyBlockId; left: number; right: number }>>();
    for (const [, b] of blocks) {
        const ext = getBlockCardExtent(b, model, config);
        if (!rowsByGen.has(b.generation)) rowsByGen.set(b.generation, []);
        rowsByGen.get(b.generation)!.push({ blockId: b.id, left: ext.left, right: ext.right });
    }

    for (const [uid, union] of model.unions) {
        if (union.childIds.length < 2) continue;
        const parentBlockId = unionToBlock.get(uid);
        const parentBlock = parentBlockId ? blocks.get(parentBlockId) : undefined;
        if (!parentBlock || parentBlock.chainInfo) continue;

        // Sibling child blocks with their card extents
        const siblingBlocks: FamilyBlock[] = [];
        const seen = new Set<FamilyBlockId>();
        for (const childId of union.childIds) {
            const childUnionId = model.personToUnion.get(childId);
            const childBlockId = childUnionId ? unionToBlock.get(childUnionId) : undefined;
            const childBlock = childBlockId ? blocks.get(childBlockId) : undefined;
            if (!childBlock || seen.has(childBlock.id)) continue;
            seen.add(childBlock.id);
            siblingBlocks.push(childBlock);
        }
        if (siblingBlocks.length < 2) continue;

        // Core = the sibling block whose subtree contains other siblings'
        // parent (the direct line), or simply the widest-anchored one: use
        // the block that is NOT relocatable (claimed elsewhere / has the
        // focus subtree). Relocation candidates: siblings owned by this
        // parent block.
        for (const cand of siblingBlocks) {
            if (cand.parentBlockId !== parentBlock.id) continue;

            // Tethered candidate: its union has a child hosted in a block
            // OUTSIDE its own subtree (e.g. the child couple was claimed by
            // the in-law side). Relocating it would tear the parent away
            // from that child — sibling contiguity never outranks the
            // parent-child bond.
            const candUnion = model.unions.get(cand.rootUnionId);
            if (candUnion && candUnion.childIds.length > 0) {
                const candSubIds = subtreeCardExtentsByGen(cand.id, blocks, model, config).ids;
                let tethered = false;
                for (const childId of candUnion.childIds) {
                    const childUnionId = model.personToUnion.get(childId);
                    const childBlockId = childUnionId ? unionToBlock.get(childUnionId) : undefined;
                    if (childBlockId && !candSubIds.has(childBlockId)) {
                        tethered = true;
                        break;
                    }
                }
                if (tethered) continue;
            }

            const coreExts = siblingBlocks
                .filter(s => s.id !== cand.id)
                .map(s => getBlockCardExtent(s, model, config));
            if (coreExts.length === 0) continue;
            const coreLeft = Math.min(...coreExts.map(e => e.left));
            const coreRight = Math.max(...coreExts.map(e => e.right));

            const candExt = getBlockCardExtent(cand, model, config);
            const onRight = candExt.left >= coreRight;
            const onLeft = candExt.right <= coreLeft;
            if (!onRight && !onLeft) continue;

            // Foreign column between candidate and core?
            const row = rowsByGen.get(cand.generation) ?? [];
            const siblingIds = new Set(siblingBlocks.map(s => s.id));
            let hasForeignBetween = false;
            for (const ext of row) {
                if (siblingIds.has(ext.blockId)) continue;
                const inBetween = onRight
                    ? ext.right > coreRight && ext.left < candExt.left
                    : ext.left < coreLeft && ext.right > candExt.right;
                if (inBetween) { hasForeignBetween = true; break; }
            }
            if (!hasForeignBetween) continue;

            const { extents: subExts, ids: subIds } = subtreeCardExtentsByGen(cand.id, blocks, model, config);
            let subMinX = Infinity, subMaxX = -Infinity;
            for (const [, e] of subExts) {
                subMinX = Math.min(subMinX, e.left);
                subMaxX = Math.max(subMaxX, e.right);
            }
            if (!isFinite(subMinX)) continue;

            // Try same side of the core first, then the opposite side
            const deltas = onRight
                ? [coreRight + gap - subMinX, coreLeft - gap - subMaxX]
                : [coreLeft - gap - subMaxX, coreRight + gap - subMinX];

            for (const delta of deltas) {
                if (Math.abs(delta) < 1) break;
                let feasible = true;
                for (const [gen, e] of subExts) {
                    const targetL = e.left + delta;
                    const targetR = e.right + delta;
                    for (const ext of rowsByGen.get(gen) ?? []) {
                        if (subIds.has(ext.blockId)) continue;
                        if (targetL < ext.right + gap && targetR > ext.left - gap) {
                            feasible = false;
                            break;
                        }
                    }
                    if (!feasible) break;
                }
                if (!feasible) continue;

                if ((globalThis as unknown as { __RELOC_DEBUG?: boolean }).__RELOC_DEBUG) {
                    console.log(`[RELOC] cand=${cand.id} core=[${coreLeft.toFixed(0)},${coreRight.toFixed(0)}] candExt=[${candExt.left.toFixed(0)},${candExt.right.toFixed(0)}] sub=[${subMinX.toFixed(0)},${subMaxX.toFixed(0)}] delta=${delta.toFixed(1)}`);
                }
                shiftBlockSubtree(cand.id, delta, blocks);
                // Update row bookkeeping for all moved blocks
                for (const [gen, list] of rowsByGen) {
                    void gen;
                    for (const entry of list) {
                        if (subIds.has(entry.blockId)) {
                            entry.left += delta;
                            entry.right += delta;
                        }
                    }
                }
                break;
            }
        }
    }
}

/**
 * Children of a grandparent's sibling (or of a grandparent's other marriage)
 * drawn in the parents' row (gen -1, ancestors' children shown in place):
 * step 5 leaves them wherever their parent's block stood when the ancestors
 * were placed, often several card widths beyond the focus family, and Phase A
 * locks them there. Phase B then stands the parent over them in its sibling
 * run (placeSiblingRuns, pinned members), so the whole run followed them out
 * and left the row empty in between.
 *
 * Each such group of children (with everything drawn below them) moves
 * toward the focus parents as one piece, as far as the nearest card in any
 * of its rows allows (horizontalGap), never past a card and never across the
 * focus parents. Groups nearer the focus parents move first.
 */
function pullAncestorSiblingChildren(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    focusPersonId: PersonId,
    shown: ReadonlySet<PersonId>,
    config: LayoutConfig
): void {
    const anchorUnionId = model.childToParentUnion.get(focusPersonId);
    const anchorBlock = anchorUnionId ? blocks.get(unionToBlock.get(anchorUnionId) ?? ('' as FamilyBlockId)) : undefined;
    if (!anchorBlock) return;
    const anchorX = anchorBlock.xCenter;

    // The focus and their ancestors
    const line = new Set<PersonId>([focusPersonId]);
    const todo: PersonId[] = [focusPersonId];
    while (todo.length > 0) {
        const unionId = model.childToParentUnion.get(todo.pop()!);
        const union = unionId ? model.unions.get(unionId) : undefined;
        for (const p of [union?.partnerA, union?.partnerB]) {
            if (p && !line.has(p)) { line.add(p); todo.push(p); }
        }
    }
    const onLine = (block: FamilyBlock): boolean => {
        if (block.chainInfo) return block.chainInfo.personOrder.some(p => line.has(p));
        const union = model.unions.get(block.rootUnionId);
        return !!union && [union.partnerA, union.partnerB].some(p => !!p && line.has(p));
    };

    // Child-block sets to pull: the children of a grandparent's sibling, and
    // (when a grandparent's children are shown) the children of the
    // grandparent's other marriages, i.e. the half-siblings of a parent
    const sets: FamilyBlockId[][] = [];
    for (const [, parent] of blocks) {
        if (parent.generation !== -2 || parent.childBlockIds.length === 0) continue;
        if (!onLine(parent)) {
            const grand = parent.parentBlockId ? blocks.get(parent.parentBlockId) : undefined;
            if (grand && onLine(grand)) sets.push(parent.childBlockIds);
            continue;
        }
        const chain = parent.chainInfo;
        if (!chain || !chain.personOrder.some(p => line.has(p) && shown.has(p))) continue;
        for (const unionId of chain.unionIds) {
            const union = model.unions.get(unionId);
            if (!union || union.childIds.some(c => line.has(c))) continue;
            const childIds = chain.unionChildBlockIds.get(unionId) ?? [];
            if (childIds.length > 0) sets.push(childIds);
        }
    }

    const groups: Array<{ ids: Set<FamilyBlockId>; rows: Map<number, { left: number; right: number }>; toLeft: boolean; distance: number }> = [];
    for (const childBlockIds of sets) {
        const ids = new Set<FamilyBlockId>();
        for (const childId of childBlockIds) for (const b of collectBlockSubtree(childId, blocks)) ids.add(b.id);
        const rows = new Map<number, { left: number; right: number }>();
        let below = true;
        for (const id of ids) {
            const b = blocks.get(id)!;
            if (b.generation < -1) { below = false; break; }
            const cards = getBlockCardExtent(b, model, config);
            const row = rows.get(b.generation);
            rows.set(b.generation, row
                ? { left: Math.min(row.left, cards.left), right: Math.max(row.right, cards.right) }
                : { left: cards.left, right: cards.right });
        }
        if (!below || rows.size === 0) continue;
        const left = Math.min(...[...rows.values()].map(r => r.left));
        const right = Math.max(...[...rows.values()].map(r => r.right));
        if (left > anchorX) groups.push({ ids, rows, toLeft: true, distance: left - anchorX });
        else if (right < anchorX) groups.push({ ids, rows, toLeft: false, distance: anchorX - right });
    }
    groups.sort((a, b) => a.distance - b.distance);

    for (const group of groups) {
        let room = Infinity;
        for (const [, other] of blocks) {
            if (group.ids.has(other.id)) continue;
            const row = group.rows.get(other.generation);
            if (!row) continue;
            const cards = getBlockCardExtent(other, model, config);
            if (group.toLeft && cards.right <= row.left + 0.5) room = Math.min(room, row.left - cards.right - config.horizontalGap);
            if (!group.toLeft && cards.left >= row.right - 0.5) room = Math.min(room, cards.left - row.right - config.horizontalGap);
        }
        if (!isFinite(room) || room < 0.5) continue;
        const delta = group.toLeft ? -room : room;
        for (const id of group.ids) shiftBlock(blocks.get(id)!, delta);
    }
}

/**
 * Resolve card overlaps between gen -1 blocks (parent couples of the focus
 * generation). The focus-parent block is the anchor and never moves; any
 * overlapping other gen -1 block (typically the spouse's parents) is shifted
 * away from it, together with its ancestor component (gen <= -2 stack above
 * it), while gen >= 0 blocks stay untouched.
 */
function resolveParentCoupleOverlaps(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>,
    focusPersonId: PersonId,
    config: LayoutConfig
): void {
    const focusParentUnionId = model.childToParentUnion.get(focusPersonId);
    const focusParentBlockId = focusParentUnionId
        ? unionToBlock.get(focusParentUnionId)
        : undefined;

    const genMinus1: Array<{ block: FamilyBlock; left: number; right: number }> = [];
    for (const [, block] of blocks) {
        if (block.generation !== -1) continue;
        const ext = getBlockCardExtent(block, model, config);
        genMinus1.push({ block, left: ext.left, right: ext.right });
    }
    if (genMinus1.length < 2) return;

    genMinus1.sort((a, b) => a.left - b.left);
    const before = new Map<FamilyBlockId, number>();
    for (const [id, b] of blocks) before.set(id, b.xCenter);

    for (let pass = 0; pass < 5; pass++) {
        let shifted = false;
        for (let i = 1; i < genMinus1.length; i++) {
            const prev = genMinus1[i - 1];
            const curr = genMinus1[i];
            const overlap = prev.right + config.horizontalGap - curr.left;
            if (overlap <= 0.5) continue;

            // Never move the focus-parent block; move the other one away from it
            let target = curr;
            let other = prev;
            let delta = overlap;
            if (curr.block.id === focusParentBlockId) {
                target = prev;
                other = curr;
                delta = -overlap;
            }

            const component = collectAncestorComponent(target.block.id, blocks, model, other.block.id);
            if (other.block.id === focusParentBlockId) {
                // Clear the focus parents with the whole component at once: its
                // gen -1 cards can stand on both sides of the couple (children
                // of an ancestor's sibling placed under their parents), and
                // pushing one card at a time only moves another one into it.
                let compLeft = Infinity, compRight = -Infinity;
                for (const id of component) {
                    const b = blocks.get(id);
                    if (!b || b.generation !== -1) continue;
                    const ext = getBlockCardExtent(b, model, config);
                    compLeft = Math.min(compLeft, ext.left);
                    compRight = Math.max(compRight, ext.right);
                }
                if (isFinite(compLeft) && compLeft < other.right + config.horizontalGap && compRight > other.left - config.horizontalGap) {
                    delta = delta < 0
                        ? Math.min(delta, other.left - config.horizontalGap - compRight)
                        : Math.max(delta, other.right + config.horizontalGap - compLeft);
                }
            }
            for (const id of component) {
                const b = blocks.get(id);
                if (b) shiftBlock(b, delta);
            }
            for (const entry of genMinus1) {
                if (component.has(entry.block.id)) { entry.left += delta; entry.right += delta; }
            }
            shifted = true;
        }
        genMinus1.sort((a, b) => a.left - b.left);
        if (!shifted) break;
    }

    // The pairwise passes can fail to settle: a component whose cards stand on
    // both sides of another block (children of an ancestor's other marriage
    // shown around an aunt) is pushed back and forth, and the aunt's
    // component can reach the focus parents through their common parents.
    // Then start over from the positions before the passes and sweep outward.
    const stillOverlapping = genMinus1.some((e, i) => i > 0 && genMinus1[i - 1].right + config.horizontalGap - e.left > 0.5);
    if (!stillOverlapping || !focusParentBlockId || !blocks.has(focusParentBlockId)) return;
    for (const [id, b] of blocks) {
        const x = before.get(id);
        if (x !== undefined && Math.abs(b.xCenter - x) > 0.01) shiftBlock(b, x - b.xCenter);
    }
    sweepParentRowOutward(blocks, model, focusParentBlockId, config);
}

/**
 * Clear the parents' row (gen -1) around the focus parents, which stay put:
 * every other block moves with its ancestor component (never including the
 * focus parents, collectAncestorComponent with them forbidden), components
 * that share a block move as one. The focus parents' siblings go first, each
 * on its own side, then the other components, nearest first, each to the
 * side that needs the shorter move; a component moves outward just past the
 * cards already settled on that side, or not at all when it is clear. The
 * siblings stay together next to the couple (invariant 5) and every move
 * goes one way, so the sweep always ends without overlaps.
 */
function sweepParentRowOutward(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    anchorId: FamilyBlockId,
    config: LayoutConfig
): void {
    const anchor = blocks.get(anchorId)!;
    const anchorExt = getBlockCardExtent(anchor, model, config);
    const anchorUnion = model.unions.get(anchor.rootUnionId);
    const anchorParentUnions = new Set<UnionId>();
    for (const pid of [anchorUnion?.partnerA, anchorUnion?.partnerB]) {
        const up = pid ? model.childToParentUnion.get(pid) : undefined;
        if (up) anchorParentUnions.add(up);
    }
    const persons = (b: FamilyBlock): PersonId[] => {
        if (b.chainInfo) return b.chainInfo.personOrder;
        const u = model.unions.get(b.rootUnionId);
        return u ? [u.partnerA, u.partnerB].filter((p): p is PersonId => !!p) : [];
    };

    // Components, merged where they share a block
    const units: Array<{ ids: Set<FamilyBlockId>; sibling: boolean; key: string }> = [];
    const unitOf = new Map<FamilyBlockId, number>();
    const ordered = [...blocks.values()].filter(b => b.generation === -1 && b.id !== anchorId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const b of ordered) {
        const comp = collectAncestorComponent(b.id, blocks, model, anchorId);
        comp.add(b.id);
        const hit = [...new Set([...comp].map(id => unitOf.get(id)).filter((i): i is number => i !== undefined))];
        let target: number;
        if (hit.length === 0) {
            target = units.length;
            units.push({ ids: new Set(), sibling: false, key: b.id });
        } else {
            target = Math.min(...hit);
            for (const i of hit) {
                if (i === target) continue;
                for (const id of units[i].ids) { units[target].ids.add(id); unitOf.set(id, target); }
                units[i].ids.clear();
            }
        }
        for (const id of comp) { units[target].ids.add(id); unitOf.set(id, target); }
        if (persons(b).some(p => anchorParentUnions.has(model.childToParentUnion.get(p) ?? ('' as UnionId)))) {
            units[target].sibling = true;
        }
    }
    for (const unit of units) {
        if (unit.ids.has(anchorId)) unit.ids.clear();
    }

    const rowExtent = (ids: Set<FamilyBlockId>) => {
        let left = Infinity, right = -Infinity;
        for (const id of ids) {
            const b = blocks.get(id);
            if (!b || b.generation !== -1) continue;
            const ext = getBlockCardExtent(b, model, config);
            left = Math.min(left, ext.left);
            right = Math.max(right, ext.right);
        }
        return { left, right };
    };
    const live = units.filter(u => u.ids.size > 0).map(u => ({ ...u, ext: rowExtent(u.ids) }))
        .filter(u => isFinite(u.ext.left));
    const distance = (e: { left: number; right: number }) =>
        Math.max(0, anchorExt.left - e.right, e.left - anchorExt.right);
    live.sort((a, b) => (a.sibling === b.sibling ? 0 : a.sibling ? -1 : 1)
        || distance(a.ext) - distance(b.ext)
        || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const gap = config.horizontalGap;
    let leftFrontier = anchorExt.left, rightFrontier = anchorExt.right;
    const anchorCenter = (anchorExt.left + anchorExt.right) / 2;
    for (const unit of live) {
        const { left, right } = rowExtent(unit.ids);
        const toLeft = Math.min(0, leftFrontier - gap - right);
        const toRight = Math.max(0, rightFrontier + gap - left);
        const leftSide = unit.sibling
            ? (left + right) / 2 < anchorCenter
            : -toLeft < toRight || (-toLeft === toRight && (left + right) / 2 < anchorCenter);
        const delta = leftSide ? toLeft : toRight;
        if (Math.abs(delta) > 0.01) {
            for (const id of unit.ids) shiftBlock(blocks.get(id)!, delta);
        }
        if (leftSide) leftFrontier = Math.min(leftFrontier, left + delta);
        else rightFrontier = Math.max(rightFrontier, right + delta);
    }
}

/**
 * The ancestor component of a block: the block itself, all
 * blocks reachable upward via parentBlockId, and their subtrees — but never
 * any block at gen >= 0 (descendant positions are locked by Phase A). It
 * moves as one when the block is pushed out of an overlap.
 *
 * `forbiddenBlockId` (the block this one is being pushed away from) must not
 * be dragged along. In a pedigree collapse the two couples share an ancestor
 * higher up — walking into the shared ancestor's subtree would capture the
 * other couple and move both together. The upward walk stops before any
 * ancestor whose subtree contains the forbidden block; the shared ancestors
 * stay put and Phase B re-places them.
 *
 * A block hangs under ONE parent block (parentBlockId), but a couple has two
 * sets of parents: the forbidden couple can be the child of an ancestor's
 * union through the other partner (the focus's mother is a daughter of the
 * block walked into, while the parents' block hangs under the father's
 * parents). That ancestor's subtree does not contain the forbidden block, yet
 * moving it would move the forbidden couple's siblings into the couple, so
 * the walk stops there too.
 */
function collectAncestorComponent(
    blockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    forbiddenBlockId?: FamilyBlockId
): Set<FamilyBlockId> {
    const component = new Set<FamilyBlockId>();
    const forbiddenBlock = forbiddenBlockId ? blocks.get(forbiddenBlockId) : undefined;
    const forbiddenUnion = forbiddenBlock ? model.unions.get(forbiddenBlock.rootUnionId) : undefined;
    const forbiddenParentUnions = new Set<UnionId>();
    for (const pid of [forbiddenUnion?.partnerA, forbiddenUnion?.partnerB]) {
        const up = pid ? model.childToParentUnion.get(pid) : undefined;
        if (up) forbiddenParentUnions.add(up);
    }
    const parentOfForbidden = (ids: Set<FamilyBlockId>) => [...ids].some(id => {
        const b = blocks.get(id);
        return !!b && (forbiddenParentUnions.has(b.rootUnionId) || (b.chainInfo?.unionIds ?? []).some(u => forbiddenParentUnions.has(u)));
    });

    // Walk UP via parentBlockId, collecting each ancestor's subtree
    let currentId: FamilyBlockId | null = blockId;
    while (currentId && !component.has(currentId)) {
        const block = blocks.get(currentId);
        if (!block || block.generation >= 0) break;

        const levelSubtree = new Set<FamilyBlockId>();
        collectSubtreeAboveGen0(currentId, blocks, levelSubtree);
        if (forbiddenBlockId && (levelSubtree.has(forbiddenBlockId) || parentOfForbidden(levelSubtree))) break;

        for (const id of levelSubtree) component.add(id);
        currentId = block.parentBlockId;
    }
    return component;
}

/**
 * Collect a block and its descendants into `out`, pruning at gen >= 0.
 */
function collectSubtreeAboveGen0(
    blockId: FamilyBlockId,
    blocks: Map<FamilyBlockId, FamilyBlock>,
    out: Set<FamilyBlockId>
): void {
    const stack = [blockId];
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (out.has(id)) continue;
        const block = blocks.get(id);
        if (!block || block.generation >= 0) continue;
        out.add(id);
        for (const childId of block.childBlockIds) {
            stack.push(childId);
        }
    }
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
            for (const [pid, x] of block.chainInfo.personSlotCenters) {
                block.chainInfo.personSlotCenters.set(pid, x + deltaX);
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

    // Children of one chain block share a row across ALL the chain's unions.
    // Sweeping each union separately can push one union's children into a
    // sibling union's group without moving that group along (half-siblings
    // then interleave), so a chain's unions are separated as ONE merged set.
    const chainUnionIds = new Set<UnionId>();
    const siblingSets: Array<ReturnType<typeof collectSiblingExtents>> = [];
    for (const [, block] of blocks) {
        if (!block.chainInfo || block.chainInfo.unionIds.length < 2) continue;
        const merged: ReturnType<typeof collectSiblingExtents> = [];
        for (const uid of block.chainInfo.unionIds) {
            chainUnionIds.add(uid);
            const u = model.unions.get(uid);
            if (!u) continue;
            merged.push(...collectSiblingExtents(u, model, unionToBlock, blocks, config));
        }
        if (merged.length >= 2) siblingSets.push(merged);
    }
    for (const [unionId, union] of model.unions) {
        if (chainUnionIds.has(unionId)) continue;
        if (union.childIds.length < 2) continue;
        const set = collectSiblingExtents(union, model, unionToBlock, blocks, config);
        if (set.length >= 2) siblingSets.push(set);
    }

    for (const siblings of siblingSets) {
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
    if ((globalThis as unknown as { __CSP_DEBUG?: boolean }).__CSP_DEBUG) {
        console.log(`[CSP] FS=${[...fsBlockIds].join(',')} span=[${fsMinX.toFixed(0)},${fsMaxX.toFixed(0)}]`);
    }

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
            for (const [pid, x] of block.chainInfo.personSlotCenters) {
                block.chainInfo.personSlotCenters.set(pid, x + deltaX);
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

            const ext = drawnCardExtent(block, model, config);
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
        for (const [pid, x] of block.chainInfo.personSlotCenters) {
            block.chainInfo.personSlotCenters.set(pid, x + deltaX);
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
                            // Pedigree collapse: the child's block may be claimed
                            // by ANOTHER parent block (e.g. cousins married). Only
                            // one parent may center over it — otherwise both
                            // parents converge to the same X and overlap.
                            if (childBlock.parentBlockId !== null &&
                                childBlock.parentBlockId !== block.id) {
                                continue;
                            }
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
                        // Pedigree collapse: a child living in a block CLAIMED
                        // by another parent block must not pull this parent —
                        // centering both parents over the same shared couple
                        // block would stack them onto each other.
                        if (childBlock.parentBlockId !== null &&
                            childBlock.parentBlockId !== block.id) {
                            continue;
                        }
                        // A child in a partner chain: its own card (the
                        // chain's middle may stand under another partner).
                        const chainX = childBlock.chainInfo?.personPositions.get(childId);
                        if (chainX !== undefined) {
                            minChildX = Math.min(minChildX, chainX - config.cardWidth / 2);
                            maxChildX = Math.max(maxChildX, chainX + config.cardWidth / 2);
                            continue;
                        }
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
/**
 * Detect pedigree-collapse couples whose partners sit on the wrong side of
 * their respective parents and mark them for visual order swap.
 *
 * When BOTH partners of a couple have parent unions in the layout, the lines
 * from the two parent couples down to the partners inevitably cross if each
 * partner is on the far side from their own parents. Rendering each partner
 * under their own parents (swapping the couple's visual order if needed)
 * removes the crossing entirely.
 */
function applyDiamondPartnerSwaps(
    blocks: Map<FamilyBlockId, FamilyBlock>,
    model: LayoutModel,
    unionToBlock: Map<UnionId, FamilyBlockId>
): void {
    for (const [, union] of model.unions) {
        union.swapped = false;
        if (!union.partnerB) continue;

        const blockId = unionToBlock.get(union.id);
        const block = blockId ? blocks.get(blockId) : undefined;
        // Chain blocks manage per-person positions themselves
        if (!block || block.chainInfo) continue;

        const aParentUnion = model.childToParentUnion.get(union.partnerA);
        const bParentUnion = model.childToParentUnion.get(union.partnerB);
        if (!aParentUnion || !bParentUnion || aParentUnion === bParentUnion) continue;

        const aParentBlockId = unionToBlock.get(aParentUnion);
        const bParentBlockId = unionToBlock.get(bParentUnion);
        if (!aParentBlockId || !bParentBlockId) continue;

        const aParentBlock = blocks.get(aParentBlockId);
        const bParentBlock = blocks.get(bParentBlockId);
        if (!aParentBlock || !bParentBlock) continue;

        // Anchor of each parent connection = its stem X (couple center)
        if (aParentBlock.coupleCenterX > bParentBlock.coupleCenterX + 0.5) {
            union.swapped = true;
        }
    }
}

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
                const [leftId, rightId] = union.swapped
                    ? [union.partnerB, union.partnerA]
                    : [union.partnerA, union.partnerB];
                personX.set(leftId, coupleCenter - config.partnerGap / 2 - config.cardWidth);
                personX.set(rightId, coupleCenter + config.partnerGap / 2);
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
