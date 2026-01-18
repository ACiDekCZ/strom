/**
 * Layout Pipeline - Main Orchestrator
 *
 * Combines all 8 pipeline steps into a single layout computation.
 *
 * Pipeline:
 * 1. selectSubgraph()     → GraphSelection
 * 2. buildLayoutModel()   → LayoutModel
 * 3. assignGenerations()  → GenerationalModel
 * 4. measureSubtrees()    → MeasuredModel
 * 5. placeX()             → PlacedModel
 * 6. applyConstraints()   → ConstrainedModel
 * 7. routeEdges()         → RoutedModel
 * 8. emitLayoutResult()   → LayoutResult
 */

// Re-export types
export * from './types.js';
export * from './debug-types.js';

// Re-export individual steps
export { selectSubgraph } from './1-select-subgraph.js';
export { buildLayoutModel, getChildUnions } from './2-build-model.js';
export { assignGenerations, validateGenerations } from './3-assign-generations.js';
export { measureSubtrees, getTotalWidth } from './4-measure.js';
export { placeX } from './5-place-x.js';
export { applyConstraints } from './6-constraints.js';
export { routeEdges, detectStaircaseEdges, validateNoStaircaseEdges, type StaircaseViolation } from './7-route-edges.js';
export { emitLayoutResult } from './8-emit-result.js';
export { validateLayout } from './validation.js';
export { computeDebugValidation } from './debug-validation.js';
export { computeDebugGeometry } from './debug-geometry.js';

import {
    PipelineInput,
    LayoutResult,
    LayoutRequest,
    LayoutEngine
} from './types.js';

import {
    DebugOptions,
    DebugStep,
    DebugSnapshot,
    DebugPipelineResult,
    DEBUG_STEP_NAMES
} from './debug-types.js';

import { selectSubgraph } from './1-select-subgraph.js';
import { buildLayoutModel } from './2-build-model.js';
import { assignGenerations } from './3-assign-generations.js';
import { measureSubtrees } from './4-measure.js';
import { placeX } from './5-place-x.js';
import { applyConstraints } from './6-constraints.js';
import { routeEdges } from './7-route-edges.js';
import { emitLayoutResult } from './8-emit-result.js';
import { validateLayout } from './validation.js';
import { computeDebugValidation } from './debug-validation.js';
import { computeDebugGeometry } from './debug-geometry.js';

/**
 * Run the complete layout pipeline.
 */
export function runLayoutPipeline(input: PipelineInput): LayoutResult {
    const {
        data,
        focusPersonId,
        config,
        ancestorDepth,
        descendantDepth,
        includeSpouseAncestors,
        includeParentSiblings,
        includeParentSiblingDescendants,
        maxIterations = 20,
        tolerance = 0.5
    } = input;

    // Step 1: Select subgraph
    const selection = selectSubgraph({
        data,
        focusPersonId,
        ancestorDepth,
        descendantDepth,
        includeSpouseAncestors,
        includeParentSiblings,
        includeParentSiblingDescendants
    });

    // Early return if no persons selected
    if (selection.persons.size === 0) {
        return emptyResult();
    }

    // Step 2: Build layout model
    const model = buildLayoutModel({
        data,
        selection,
        focusPersonId
    });

    // Step 3: Assign generations
    const genModel = assignGenerations({
        model,
        focusPersonId
    });

    // Step 4: Measure subtrees (builds FamilyBlocks)
    const measured = measureSubtrees({
        genModel,
        config,
        focusPersonId
    });

    // Step 5: Place X positions (block-based)
    const placed = placeX({
        measured,
        config
    });

    // Step 6: Apply constraints
    const constrained = applyConstraints({
        placed,
        config,
        maxIterations,
        tolerance,
        focusPersonId
    });

    // Step 7: Route edges
    const routed = routeEdges({
        constrained,
        config
    });

    // Step 8: Emit result
    const result = emitLayoutResult({
        routed,
        config
    });

    // Validate and update diagnostics
    const validation = validateLayout(result, config);
    result.diagnostics.validationPassed = validation.passed;
    result.diagnostics.errors = validation.errors;

    return result;
}

/**
 * Compute which phases were run based on stopAfterPhase.
 */
function computePhasesRun(stopAfterPhase?: 'A' | 'B'): ('A' | 'B')[] {
    if (!stopAfterPhase) return ['A', 'B'];
    if (stopAfterPhase === 'A') return ['A'];
    return ['A', 'B'];
}

/**
 * Create an empty layout result.
 */
function emptyResult(): LayoutResult {
    return {
        positions: new Map(),
        connections: [],
        spouseLines: [],
        diagnostics: {
            totalPersons: 0,
            totalUnions: 0,
            generationRange: [0, 0],
            iterations: 0,
            validationPassed: true,
            errors: []
        }
    };
}

/**
 * Run the layout pipeline with debug snapshots at each step.
 * Stops at the specified target step.
 */
export function runLayoutPipelineWithDebug(
    input: PipelineInput,
    debugOptions: DebugOptions
): DebugPipelineResult {
    const snapshots: DebugSnapshot[] = [];
    const { step: targetStep } = debugOptions;

    const {
        data,
        focusPersonId,
        config,
        ancestorDepth,
        descendantDepth,
        includeSpouseAncestors,
        includeParentSiblings,
        includeParentSiblingDescendants,
        maxIterations = 20,
        tolerance = 0.5
    } = input;

    // Helper to create a snapshot
    const createSnapshot = (step: DebugStep, state: Partial<DebugSnapshot>): DebugSnapshot => {
        const snapshot: DebugSnapshot = {
            step,
            stepName: DEBUG_STEP_NAMES[step],
            selection: state.selection ?? null,
            model: state.model ?? null,
            genModel: state.genModel ?? null,
            measured: state.measured ?? null,
            placed: state.placed ?? null,
            constrained: state.constrained ?? null,
            routed: state.routed ?? null,
            result: state.result ?? null,
            validation: null,
            geometry: null
        };

        // Compute validation and geometry for steps 5+
        if (step >= 5 && snapshot.placed) {
            snapshot.validation = computeDebugValidation(snapshot, config);
            snapshot.geometry = computeDebugGeometry(snapshot, config);
        }

        return snapshot;
    };

    // Step 1: Select subgraph
    const selection = selectSubgraph({
        data,
        focusPersonId,
        ancestorDepth,
        descendantDepth,
        includeSpouseAncestors,
        includeParentSiblings,
        includeParentSiblingDescendants
    });

    snapshots.push(createSnapshot(1, { selection }));
    if (targetStep === 1 || selection.persons.size === 0) {
        return { result: emptyResult(), snapshots };
    }

    // Step 2: Build layout model
    const model = buildLayoutModel({
        data,
        selection,
        focusPersonId
    });

    snapshots.push(createSnapshot(2, { selection, model }));
    if (targetStep === 2) {
        return { result: emptyResult(), snapshots };
    }

    // Step 3: Assign generations
    const genModel = assignGenerations({
        model,
        focusPersonId
    });

    snapshots.push(createSnapshot(3, { selection, model, genModel }));
    if (targetStep === 3) {
        return { result: emptyResult(), snapshots };
    }

    // Step 4: Measure subtrees (builds FamilyBlocks)
    const measured = measureSubtrees({
        genModel,
        config,
        focusPersonId
    });

    snapshots.push(createSnapshot(4, { selection, model, genModel, measured }));
    if (targetStep === 4) {
        return { result: emptyResult(), snapshots };
    }

    // Step 5: Place X positions (block-based)
    const placed = placeX({
        measured,
        config
    });

    snapshots.push(createSnapshot(5, { selection, model, genModel, measured, placed }));
    if (targetStep === 5) {
        // Return partial result with positions for rendering boxes only
        const partialResult = emitLayoutResult({
            routed: {
                constrained: { placed, iterations: 0, finalMaxViolation: 0 },
                connections: [],
                spouseLines: []
            },
            config
        });
        partialResult.connections = [];
        partialResult.spouseLines = [];
        return { result: partialResult, snapshots };
    }

    // Step 6: Apply constraints
    const constrained = applyConstraints({
        placed,
        config,
        maxIterations,
        tolerance,
        focusPersonId,
        stopAfterPhase: debugOptions.phase
    });

    snapshots.push(createSnapshot(6, { selection, model, genModel, measured, placed: constrained.placed, constrained }));

    // If phase is specified OR targetStep is 6, skip routing and return early
    if (targetStep === 6 || debugOptions.phase) {
        const partialResult = emitLayoutResult({
            routed: {
                constrained,
                connections: [],
                spouseLines: []
            },
            config
        });
        partialResult.connections = [];
        partialResult.spouseLines = [];
        // Add debug diagnostics
        partialResult.diagnostics.routedEdges = false;
        partialResult.diagnostics.phasesRun = computePhasesRun(debugOptions.phase);
        return { result: partialResult, snapshots };
    }

    // Step 7: Route edges
    const routed = routeEdges({
        constrained,
        config
    });

    snapshots.push(createSnapshot(7, { selection, model, genModel, measured, placed: constrained.placed, constrained, routed }));
    if (targetStep === 7) {
        const result = emitLayoutResult({ routed, config });
        return { result, snapshots };
    }

    // Step 8: Emit result
    const result = emitLayoutResult({
        routed,
        config
    });

    // Validate and update diagnostics
    const validation = validateLayout(result, config);
    result.diagnostics.validationPassed = validation.passed;
    result.diagnostics.errors = validation.errors;

    snapshots.push(createSnapshot(8, { selection, model, genModel, measured, placed: constrained.placed, constrained, routed, result }));

    return { result, snapshots };
}

/**
 * StromLayoutEngine - wrapper class implementing LayoutEngine interface.
 * Provides backwards compatibility with existing code.
 */
export class StromLayoutEngine implements LayoutEngine {
    layout(request: LayoutRequest): LayoutResult {
        return runLayoutPipeline({
            data: request.data,
            focusPersonId: request.focusPersonId,
            config: request.config,
            ancestorDepth: request.policy.ancestorDepth,
            descendantDepth: request.policy.descendantDepth,
            includeSpouseAncestors: false,  // Only show focus person's ancestors
            includeParentSiblings: request.policy.includeAuntsUncles,
            includeParentSiblingDescendants: request.policy.includeCousins
        });
    }
}

/**
 * Convenience function for computing layout with default config.
 */
export function computeLayout(
    engine: LayoutEngine,
    request: LayoutRequest
): LayoutResult {
    return engine.layout(request);
}
