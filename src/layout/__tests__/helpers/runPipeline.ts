/**
 * Pipeline execution helper for tests.
 *
 * Runs the complete layout pipeline and returns intermediate stages
 * for inspection and assertion.
 */

import { StromData, PersonId, LayoutConfig, DEFAULT_LAYOUT_CONFIG } from '../../../types.js';
import {
    selectSubgraph,
    buildLayoutModel,
    assignGenerations,
    measureSubtrees,
    placeX,
    applyConstraints,
    routeEdges,
    emitLayoutResult,
    GraphSelection,
    LayoutModel,
    GenerationalModel,
    MeasuredModel,
    PlacedModel,
    ConstrainedModel,
    RoutedModel,
    LayoutResult
} from '../../pipeline/index.js';

/**
 * All intermediate stages from the pipeline.
 */
export interface PipelineStages {
    selection: GraphSelection;
    model: LayoutModel;
    genModel: GenerationalModel;
    measured: MeasuredModel;
    placed: PlacedModel;
    constrained: ConstrainedModel;
    routed: RoutedModel;
    result: LayoutResult;
}

/**
 * Options for running the pipeline.
 */
export interface RunPipelineOptions {
    ancestorDepth?: number;
    descendantDepth?: number;
    config?: Partial<LayoutConfig>;
    maxIterations?: number;
    tolerance?: number;
    stopAfterPhase?: 'A' | 'B';
}

/**
 * Run the complete layout pipeline and return all intermediate stages.
 */
export function runPipeline(
    data: StromData,
    focusId: PersonId,
    options: RunPipelineOptions = {}
): PipelineStages {
    const config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, ...options.config };
    const ancestorDepth = options.ancestorDepth ?? 10;
    const descendantDepth = options.descendantDepth ?? 10;
    const maxIterations = options.maxIterations ?? 30;
    const tolerance = options.tolerance ?? 0.5;

    // Stage 1: Select subgraph
    const selection = selectSubgraph({
        data,
        focusPersonId: focusId,
        ancestorDepth,
        descendantDepth,
        includeSpouseAncestors: true,
        includeParentSiblings: true,
        includeParentSiblingDescendants: true,
    });

    // Stage 2: Build model
    const model = buildLayoutModel({
        data,
        selection,
        focusPersonId: focusId
    });

    // Stage 3: Assign generations
    const genModel = assignGenerations({
        model,
        focusPersonId: focusId
    });

    // Stage 4: Measure subtrees
    const measured = measureSubtrees({
        genModel,
        config
    });

    // Stage 5: Place X
    const placed = placeX({
        measured,
        config
    });

    // Stage 6: Apply constraints
    const constrained = applyConstraints({
        placed,
        config,
        maxIterations,
        tolerance,
        stopAfterPhase: options.stopAfterPhase,
        focusPersonId: focusId,
    });

    // Stage 7: Route edges
    const routed = routeEdges({
        constrained,
        config
    });

    // Stage 8: Emit result
    const result = emitLayoutResult({
        routed,
        config
    });

    return { selection, model, genModel, measured, placed, constrained, routed, result };
}
