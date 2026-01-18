/**
 * Debug Types for Layout Pipeline
 *
 * Type definitions for the debug mode that allows step-by-step
 * verification of layout computation.
 */

import { LayoutConfig } from '../../types.js';
import {
    GraphSelection,
    LayoutModel,
    GenerationalModel,
    MeasuredModel,
    PlacedModel,
    ConstrainedModel,
    RoutedModel,
    LayoutResult,
    UnionId
} from './types.js';

// ==================== DEBUG OPTIONS ====================

/** Valid debug steps (1-8) */
export type DebugStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Debug phase for step 6 (constraints) */
export type DebugPhase = 'A' | 'B';

/** Debug options parsed from URL */
export interface DebugOptions {
    enabled: boolean;
    step: DebugStep;
    phase?: DebugPhase;  // Stop after specific phase in step 6
}

/** Step names for display */
export const DEBUG_STEP_NAMES: Record<DebugStep, string> = {
    1: 'Select Subgraph',
    2: 'Build Model',
    3: 'Assign Generations',
    4: 'Measure Subtrees',
    5: 'Place X',
    6: 'Apply Constraints',
    7: 'Route Edges',
    8: 'Emit Result'
};

// ==================== DEBUG SNAPSHOT ====================

/** Centering error for a union */
export interface CenteringError {
    unionId: UnionId;
    parentCenterX: number;
    childrenCenterX: number;
    errorPx: number;
}

/** Validation results for a snapshot */
export interface DebugValidationResult {
    boxOverlapCount: number;
    spanOverlapCount: number;
    centeringErrors: CenteringError[];
    edgeCrossingCount: number;
    allPassed: boolean;
}

/** Rectangle for debug rendering */
export interface DebugRect {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
}

/** Sibling span for debug rendering */
export interface DebugSiblingSpan {
    unionId: UnionId;
    x1: number;
    x2: number;
    y: number;
}

/** Bus line for debug rendering */
export interface DebugBusLine {
    unionId: UnionId;
    y: number;
    x1: number;
    x2: number;
}

/** Anchor point for debug rendering */
export interface DebugAnchorPoint {
    id: string;
    x: number;
    y: number;
    type: 'person' | 'union' | 'bus';
}

/** Generation band for debug rendering */
export interface DebugGenerationBand {
    gen: number;
    y: number;
    height: number;
}

/** Branch envelope for debug rendering */
export interface DebugBranchEnvelope {
    branchId: string;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    label: string;
    siblingIndex: number;
    color: string;
}

/** Sibling family cluster for debug rendering */
export interface DebugSiblingFamilyCluster {
    personId: string;
    label: string;
    // Card extent (actual card positions)
    cardMinX: number;
    cardMaxX: number;
    // Block extent (measured widths)
    blockMinX: number;
    blockMaxX: number;
    minY: number;
    maxY: number;
    color: string;
}

/** Complete geometry for debug overlay */
export interface DebugGeometry {
    personBoxes: DebugRect[];
    unionBoxes: DebugRect[];
    siblingSpans: DebugSiblingSpan[];
    busLines: DebugBusLine[];
    anchorPoints: DebugAnchorPoint[];
    generationBands: DebugGenerationBand[];
    branchEnvelopes: DebugBranchEnvelope[];
    siblingFamilyClusters: DebugSiblingFamilyCluster[];
}

/** Snapshot of pipeline state at a specific step */
export interface DebugSnapshot {
    step: DebugStep;
    stepName: string;
    selection: GraphSelection | null;
    model: LayoutModel | null;
    genModel: GenerationalModel | null;
    measured: MeasuredModel | null;
    placed: PlacedModel | null;
    constrained: ConstrainedModel | null;
    routed: RoutedModel | null;
    result: LayoutResult | null;
    validation: DebugValidationResult | null;
    geometry: DebugGeometry | null;
}

// ==================== DEBUG CONTEXT ====================

/** Global debug context exposed on window */
export interface LayoutDebugContext {
    query: {
        debug: boolean;
        step: number;
    };
    snapshots: DebugSnapshot[];
    result: LayoutResult | null;
}

/** Statistics for the debug panel */
export interface DebugPanelStats {
    personCount: number;
    unionCount: number;
    edgeCount: number;
    generationCount: number;
    constraintIterations: number;
    maxViolation: number;
}

// ==================== PIPELINE WITH DEBUG ====================

/** Result of running pipeline with debug enabled */
export interface DebugPipelineResult {
    result: LayoutResult;
    snapshots: DebugSnapshot[];
}

/** Input for debug geometry computation */
export interface DebugGeometryInput {
    snapshot: DebugSnapshot;
    config: LayoutConfig;
}

/** Input for debug validation computation */
export interface DebugValidationInput {
    snapshot: DebugSnapshot;
    config: LayoutConfig;
}

// ==================== GLOBAL DECLARATION ====================

declare global {
    interface Window {
        __LAYOUT_DEBUG__?: LayoutDebugContext;
    }
}
