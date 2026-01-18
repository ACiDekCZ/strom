/**
 * Layout Pipeline Types
 * Complete type definitions for the 8-step layout pipeline.
 */

import { PersonId, PartnershipId, StromData, LayoutConfig, Position } from '../../types.js';

// ==================== BRANDED TYPES ====================

/** Branded type for Union IDs - atomic layout unit */
export type UnionId = string & { readonly __brand: 'UnionId' };

/** Helper to create a UnionId from string */
export function toUnionId(id: string): UnionId {
    return id as UnionId;
}

// ==================== STEP 1: SELECT SUBGRAPH ====================

/**
 * Input for selectSubgraph step.
 */
export interface SelectSubgraphInput {
    data: StromData;
    focusPersonId: PersonId;
    ancestorDepth: number;           // How many generations up (1 = parents, 2 = grandparents)
    descendantDepth: number;         // How many generations down
    includeSpouseAncestors: boolean; // Include ancestors of focus person's spouse
    includeParentSiblings: boolean;  // Include aunts/uncles (siblings of parents)
    includeParentSiblingDescendants: boolean; // Include cousins
}

/**
 * Output from selectSubgraph step.
 */
export interface GraphSelection {
    persons: Set<PersonId>;
    partnerships: Set<PartnershipId>;
    // For debug/diagnostics:
    focusPersonId: PersonId;
    maxAncestorGen: number;
    maxDescendantGen: number;
}

// ==================== STEP 2: BUILD MODEL ====================

/**
 * Input for buildLayoutModel step.
 */
export interface BuildModelInput {
    data: StromData;
    selection: GraphSelection;
    focusPersonId: PersonId;
}

/**
 * PersonNode - single person in the layout model.
 */
export interface PersonNode {
    id: PersonId;
    firstName: string;
    lastName: string;
    gender: 'male' | 'female';
    birthDate?: string;
}

/**
 * UnionNode - atomic layout unit representing a couple (or single parent).
 * Partners NEVER split - this is the fundamental unit for layout.
 */
export interface UnionNode {
    id: UnionId;
    partnerA: PersonId;              // Always left (male or alphabetically first)
    partnerB: PersonId | null;       // Right partner (may be null for single parent)
    partnershipId: PartnershipId | null;
    childIds: PersonId[];            // Children of this union, sorted by birthDate then id
}

/**
 * ParentChildEdge - edge from parent union to child person.
 */
export interface ParentChildEdge {
    parentUnionId: UnionId;
    childPersonId: PersonId;
}

/**
 * LayoutModel - the graph representation built from StromData.
 * This is the core data structure used by subsequent pipeline steps.
 */
export interface LayoutModel {
    persons: Map<PersonId, PersonNode>;
    unions: Map<UnionId, UnionNode>;
    edges: ParentChildEdge[];
    // Helper maps:
    personToUnion: Map<PersonId, UnionId>;       // Which union contains a person
    childToParentUnion: Map<PersonId, UnionId>;  // Parent union of a child
}

// ==================== STEP 3: ASSIGN GENERATIONS ====================

/**
 * Input for assignGenerations step.
 */
export interface AssignGenInput {
    model: LayoutModel;
    focusPersonId: PersonId;
}

/**
 * GenerationBandInfo - persons and unions at a specific generation.
 */
export interface GenerationBandInfo {
    persons: PersonId[];
    unions: UnionId[];
}

/**
 * GenerationalModel - model with generation assignments.
 */
export interface GenerationalModel {
    model: LayoutModel;
    personGen: Map<PersonId, number>;
    unionGen: Map<UnionId, number>;
    genBands: Map<number, GenerationBandInfo>;
    minGen: number;  // Oldest ancestors (negative)
    maxGen: number;  // Youngest descendants (positive)
}

// ==================== STEP 4: MEASURE SUBTREES ====================

/**
 * Input for measureSubtrees step.
 */
export interface MeasureInput {
    genModel: GenerationalModel;
    config: LayoutConfig;
    focusPersonId?: PersonId;
}

/**
 * MeasuredModel - model with width measurements.
 */
export interface MeasuredModel {
    genModel: GenerationalModel;
    personWidth: Map<PersonId, number>;    // Always cardWidth
    unionWidth: Map<UnionId, number>;      // cardWidth*2 + partnerGap (or cardWidth for single)
    subtreeWidth: Map<UnionId, number>;    // Width of entire subtree under union
}

// ==================== FAMILY BLOCK TYPES ====================

/** Branded type for Branch IDs */
export type BranchId = string & { readonly __brand: 'BranchId' };

/** Helper to create a BranchId from string */
export function toBranchId(id: string): BranchId {
    return id as BranchId;
}

/** Branded type for FamilyBlock IDs */
export type FamilyBlockId = string & { readonly __brand: 'FamilyBlockId' };

/** Helper to create a FamilyBlockId from string */
export function toFamilyBlockId(id: string): FamilyBlockId {
    return id as FamilyBlockId;
}

/** Which side of the focus this block belongs to */
export type BlockSide = 'HUSBAND' | 'WIFE' | 'BOTH';

/**
 * FamilyBlock - atomic layout unit representing a union and its subtree.
 * Blocks form a tree structure rooted at the focus union.
 * All positions within a block are rigid - the block moves as a whole.
 */
export interface FamilyBlock {
    id: FamilyBlockId;
    rootUnionId: UnionId;
    childBlockIds: FamilyBlockId[];
    parentBlockId: FamilyBlockId | null;
    side: BlockSide;
    generation: number;
    branchId: BranchId | null;  // null for focus block and ancestor blocks

    // Measurements (computed bottom-up)
    width: number;            // max(coupleWidth, childrenWidth)
    coupleWidth: number;      // cardWidth*2+partnerGap or cardWidth for single
    childrenWidth: number;    // sum(child.width) + gaps

    // Envelope measurements (computed bottom-up after width measurement)
    envelopeWidth: number;    // Total width needed for block + all ancestors above it
    leftExtent: number;       // Distance from xCenter to left edge of envelope
    rightExtent: number;      // Distance from xCenter to right edge of envelope

    // Positions (set during placement, modified during constraints)
    xLeft: number;
    xRight: number;
    xCenter: number;

    // Anchors (for routing)
    husbandAnchorX: number;   // Center X of partnerA card
    wifeAnchorX: number;      // Center X of partnerB card (or =husband if single)
    childrenCenterX: number;  // Center of children span
    coupleCenterX: number;    // Midpoint of couple (stem point)
}

/**
 * FamilyBlockModel - extends MeasuredModel with FamilyBlock structure.
 * Provides both block-based layout data and legacy width maps for backward compatibility.
 */
export interface FamilyBlockModel extends MeasuredModel {
    blocks: Map<FamilyBlockId, FamilyBlock>;
    rootBlockIds: FamilyBlockId[];
    unionToBlock: Map<UnionId, FamilyBlockId>;
}

// ==================== SIBLING FAMILY BRANCH ====================

/**
 * SiblingFamilyBranch - represents one child's family subtree as an exclusive X corridor.
 * Each branch owns a contiguous X interval that must not be violated by other branches.
 */
export interface SiblingFamilyBranch {
    id: BranchId;
    parentUnionId: UnionId;        // Parent union whose children define branches
    rootBlockId: FamilyBlockId;    // Block of the child that roots this branch
    childPersonId: PersonId;       // Person defining this branch
    siblingIndex: number;          // Order by birthDate then ID (0-based)
    blockIds: Set<FamilyBlockId>;  // All blocks in this branch (recursively)
    unionIds: Set<UnionId>;        // All unions in this branch
    minX: number;                  // Left boundary of corridor
    maxX: number;                  // Right boundary of corridor
    envelopeWidth: number;         // Total width needed by this branch
    childBranchIds: BranchId[];    // Sub-branches (recursive)
    parentBranchId: BranchId | null; // null for top-level
    generation: number;            // Generation of root block
}

/**
 * BranchModel - extends FamilyBlockModel with branch separation data.
 * Provides corridor information for sibling family separation.
 */
export interface BranchModel extends FamilyBlockModel {
    branches: Map<BranchId, SiblingFamilyBranch>;
    blockToBranch: Map<FamilyBlockId, BranchId>;
    unionToBranch: Map<UnionId, BranchId>;
    topLevelBranchIds: BranchId[];
    parentUnionToBranches: Map<UnionId, BranchId[]>;
}

// ==================== STEP 5: PLACE X ====================

/**
 * Input for placeX step.
 */
export interface PlaceXInput {
    measured: MeasuredModel;
    config: LayoutConfig;
}

/**
 * PlacedModel - model with X positions assigned.
 */
export interface PlacedModel {
    measured: MeasuredModel;
    personX: Map<PersonId, number>;     // X position (left edge) of person card
    unionX: Map<UnionId, number>;       // Center X of union
}

// ==================== STEP 6: APPLY CONSTRAINTS ====================

/**
 * Input for applyConstraints step.
 */
export interface ConstraintsInput {
    placed: PlacedModel;
    config: LayoutConfig;
    maxIterations: number;   // Default 20
    tolerance: number;       // Default 0.5px
    stopAfterPhase?: 'A' | 'B';
    focusPersonId?: PersonId;
}

/**
 * ConstrainedModel - model after constraint solving.
 */
export interface ConstrainedModel {
    placed: PlacedModel;     // With updated X positions
    iterations: number;
    finalMaxViolation: number;
}

// ==================== STEP 7: ROUTE EDGES ====================

/**
 * Input for routeEdges step.
 */
export interface RouteEdgesInput {
    constrained: ConstrainedModel;
    config: LayoutConfig;
}

/**
 * ChildDrop - vertical line from bus to a child.
 */
export interface ChildDrop {
    personId: PersonId;
    x: number;
    topY: number;       // = busY
    bottomY: number;    // Top of child card
}

/**
 * Connection - polyline connecting a union to its children.
 * Uses bus routing: stem → connector → horizontal branch → vertical drops.
 *
 * The bus (branch) covers ONLY the range of children drops.
 * If stemX is outside bus range, a horizontal connector joins them.
 * Connectors may be on different Y lanes to avoid overlapping.
 */
export interface Connection {
    unionId: UnionId;
    stemX: number;           // X center of union (where stem comes down)
    stemTopY: number;        // Bottom of union cards
    stemBottomY: number;     // = connectorY (where stem meets connector)
    branchY: number;         // Horizontal line Y (bus over children)
    branchLeftX: number;     // Left extent of branch (min of drops)
    branchRightX: number;    // Right extent of branch (max of drops)
    // Horizontal connector from stem to bus (if stemX outside bus range)
    connectorFromX: number;  // = stemX
    connectorToX: number;    // = nearest bus edge, or stemX if within range
    connectorY: number;      // Y of connector (may differ from branchY for lane allocation)
    drops: ChildDrop[];      // Vertical drops to children
}

/**
 * SpouseLine - horizontal line connecting partners in a union.
 */
export interface SpouseLine {
    unionId: UnionId;
    person1Id: PersonId;
    person2Id: PersonId;
    partnershipId: PartnershipId | null;
    y: number;               // Center Y of cards
    xMin: number;            // Right edge of left card
    xMax: number;            // Left edge of right card
}

/**
 * RoutedModel - model with connection routing complete.
 */
export interface RoutedModel {
    constrained: ConstrainedModel;
    connections: Connection[];
    spouseLines: SpouseLine[];
}

// ==================== STEP 8: EMIT RESULT ====================

/**
 * Input for emitLayoutResult step.
 */
export interface EmitInput {
    routed: RoutedModel;
    config: LayoutConfig;
}

/**
 * LayoutDiagnostics - debug info from layout computation.
 */
export interface LayoutDiagnostics {
    totalPersons: number;
    totalUnions: number;
    generationRange: [number, number];
    iterations: number;
    branchCount?: number;
    validationPassed: boolean;
    errors: string[];
    // Debug phase info
    phasesRun?: ('A' | 'B' | 'C')[];  // Which phases were executed
    routedEdges?: boolean;            // Whether edge routing was performed
}

/**
 * LayoutResult - final output of the layout pipeline.
 */
export interface LayoutResult {
    positions: Map<PersonId, Position>;
    connections: Connection[];
    spouseLines: SpouseLine[];
    diagnostics: LayoutDiagnostics;
}

// ==================== PIPELINE ORCHESTRATION ====================

/**
 * Full pipeline input combining all configuration.
 */
export interface PipelineInput {
    data: StromData;
    focusPersonId: PersonId;
    config: LayoutConfig;
    // Selection policy:
    ancestorDepth: number;
    descendantDepth: number;
    includeSpouseAncestors: boolean;
    includeParentSiblings: boolean;
    includeParentSiblingDescendants: boolean;
    // Constraint solver:
    maxIterations?: number;
    tolerance?: number;
}

// ==================== ANCESTOR CLUSTER ====================

/**
 * AncestorCluster - represents a rigid block of ancestors that must move together.
 *
 * For any union U in a negative generation (ancestors), the AncestorCluster(U)
 * is the set of all unions and persons in the ancestor branch above U.
 *
 * Key invariant: relative X positions within a cluster MUST NOT change.
 * The cluster can only be shifted as a whole by a single deltaX.
 */
export interface AncestorCluster {
    /** Union from which the cluster originates (closest to focus) */
    rootUnionId: UnionId;
    /** All unions in this cluster (parents, grandparents, etc.) */
    unionIds: Set<UnionId>;
    /** All persons in this cluster */
    personIds: Set<PersonId>;
}

// ==================== VALIDATION ====================

/**
 * ValidationResult for checking layout invariants.
 */
export interface ValidationResult {
    passed: boolean;
    errors: string[];
}

// ==================== LEGACY COMPATIBILITY ====================

/**
 * SelectionPolicy - legacy interface for backwards compatibility.
 * Maps to SelectSubgraphInput fields.
 */
export interface SelectionPolicy {
    ancestorDepth: number;
    descendantDepth: number;
    includeAuntsUncles: boolean;
    includeCousins: boolean;
}

/**
 * LayoutEngine - legacy interface for backwards compatibility.
 */
export interface LayoutEngine {
    layout(request: LayoutRequest): LayoutResult;
}

/**
 * LayoutRequest - legacy interface for backwards compatibility.
 */
export interface LayoutRequest {
    data: StromData;
    focusPersonId: PersonId;
    policy: SelectionPolicy;
    config: LayoutConfig;
}
