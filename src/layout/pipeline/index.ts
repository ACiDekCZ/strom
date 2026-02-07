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
export { selectSubgraph, expandSelectionForDisplay } from './1-select-subgraph.js';
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

import { PersonId, PartnershipId, StromData } from '../../types.js';
import {
    PipelineInput,
    LayoutResult,
    LayoutRequest,
    LayoutEngine,
    DisplayPolicy,
    DEFAULT_DISPLAY_POLICY,
    GraphSelection
} from './types.js';

import {
    DebugOptions,
    DebugStep,
    DebugSnapshot,
    DebugPipelineResult,
    DEBUG_STEP_NAMES
} from './debug-types.js';

import { selectSubgraph, expandSelectionForDisplay } from './1-select-subgraph.js';
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
 * Find persons with multiple partnerships for auto-expansion.
 *
 * Expansion scope (direct line + their partners at every generation):
 * - Gen -1: biological parents of focus person + parents' partners
 * - Gen  0: focus person + their partners + siblings + siblings' partners
 * - Gen 1+: descendants of all gen-0 members + descendants' partners
 *
 * All persons in scope who have multiple partnerships get auto-expanded.
 */
function findAutoExpandPersonIds(
    data: StromData,
    focusPersonId: PersonId,
    selection: GraphSelection
): Set<PersonId> {
    const expandScope = new Set<PersonId>();

    const focusPerson = data.persons[focusPersonId];
    if (!focusPerson) return new Set();

    // Gen 0: focus person
    expandScope.add(focusPersonId);

    // Gen 0: partners of focus person
    for (const pid of focusPerson.partnerships) {
        if (!selection.partnerships.has(pid)) continue;
        const p = data.partnerships[pid];
        if (!p) continue;
        const partnerId = p.person1Id === focusPersonId ? p.person2Id : p.person1Id;
        if (selection.persons.has(partnerId)) {
            expandScope.add(partnerId);
        }
    }

    // Gen 0: siblings of focus person (children of focus's parents)
    // and their partners
    for (const parentId of focusPerson.parentIds) {
        const parent = data.persons[parentId];
        if (!parent) continue;
        for (const ppid of parent.partnerships) {
            if (!selection.partnerships.has(ppid)) continue;
            const pp = data.partnerships[ppid];
            if (!pp) continue;
            for (const siblingId of pp.childIds) {
                if (!selection.persons.has(siblingId)) continue;
                expandScope.add(siblingId);
                // Partners of sibling
                const sibling = data.persons[siblingId];
                if (!sibling) continue;
                for (const spid of sibling.partnerships) {
                    if (!selection.partnerships.has(spid)) continue;
                    const sp = data.partnerships[spid];
                    if (!sp) continue;
                    const sibPartnerId = sp.person1Id === siblingId ? sp.person2Id : sp.person1Id;
                    if (selection.persons.has(sibPartnerId)) {
                        expandScope.add(sibPartnerId);
                    }
                }
            }
        }
    }

    // Gen -1: parents + parents' partners + parents' siblings + their partners
    // (same "family cluster" logic as gen 0)
    for (const parentId of focusPerson.parentIds) {
        if (!selection.persons.has(parentId)) continue;
        expandScope.add(parentId);
        const parent = data.persons[parentId];
        if (!parent) continue;
        // Partners of parent
        for (const ppid of parent.partnerships) {
            if (!selection.partnerships.has(ppid)) continue;
            const pp = data.partnerships[ppid];
            if (!pp) continue;
            const parentPartnerId = pp.person1Id === parentId ? pp.person2Id : pp.person1Id;
            if (selection.persons.has(parentPartnerId)) {
                expandScope.add(parentPartnerId);
            }
        }
        // Siblings of parent (children of grandparents) + their partners
        for (const gpId of parent.parentIds) {
            const gp = data.persons[gpId];
            if (!gp) continue;
            for (const gpPid of gp.partnerships) {
                if (!selection.partnerships.has(gpPid)) continue;
                const gpP = data.partnerships[gpPid];
                if (!gpP) continue;
                for (const auntUncleId of gpP.childIds) {
                    if (!selection.persons.has(auntUncleId)) continue;
                    expandScope.add(auntUncleId);
                    const auntUncle = data.persons[auntUncleId];
                    if (!auntUncle) continue;
                    for (const auPid of auntUncle.partnerships) {
                        if (!selection.partnerships.has(auPid)) continue;
                        const auP = data.partnerships[auPid];
                        if (!auP) continue;
                        const auPartnerId = auP.person1Id === auntUncleId ? auP.person2Id : auP.person1Id;
                        if (selection.persons.has(auPartnerId)) {
                            expandScope.add(auPartnerId);
                        }
                    }
                }
            }
        }
    }

    // Gen >= 1: biological descendants of ALL gen-0 family members (BFS)
    // Parents (gen -1) are excluded from descendant seeding
    const parentIds = new Set(focusPerson.parentIds);
    const queue: PersonId[] = [];
    for (const gen0Id of expandScope) {
        if (parentIds.has(gen0Id)) continue;
        const person = data.persons[gen0Id];
        if (!person) continue;
        for (const pid of person.partnerships) {
            if (!selection.partnerships.has(pid)) continue;
            const p = data.partnerships[pid];
            if (!p) continue;
            for (const childId of p.childIds) {
                if (selection.persons.has(childId) && !expandScope.has(childId)) {
                    queue.push(childId);
                }
            }
        }
    }

    while (queue.length > 0) {
        const childId = queue.shift()!;
        if (expandScope.has(childId)) continue;
        expandScope.add(childId);
        const child = data.persons[childId];
        if (!child) continue;
        for (const pid of child.partnerships) {
            if (!selection.partnerships.has(pid)) continue;
            const p = data.partnerships[pid];
            if (!p) continue;
            // Add partner of descendant to scope
            const partnerId = p.person1Id === childId ? p.person2Id : p.person1Id;
            if (partnerId && selection.persons.has(partnerId) && !expandScope.has(partnerId)) {
                expandScope.add(partnerId);
            }
            for (const gcId of p.childIds) {
                if (selection.persons.has(gcId) && !expandScope.has(gcId)) {
                    queue.push(gcId);
                }
            }
        }
    }

    // Filter to persons with multiple partnerships (in data, not selection —
    // expandSelectionForDisplay will add missing partnerships later)
    const result = new Set<PersonId>();
    for (const personId of expandScope) {
        const person = data.persons[personId];
        if (!person || person.partnerships.length <= 1) continue;
        result.add(personId);
    }

    return result;
}

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
        tolerance = 0.5,
        displayPolicy = DEFAULT_DISPLAY_POLICY
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

    // Auto-expand: find persons at gen >= -1 with multiple partnerships
    let effectivePolicy = displayPolicy;
    if (displayPolicy.autoExpand !== false) {
        const autoExpandIds = findAutoExpandPersonIds(data, focusPersonId, selection);
        if (autoExpandIds.size > 0) {
            const merged = new Set(autoExpandIds);
            if (displayPolicy.expandedPersonIds) {
                for (const id of displayPolicy.expandedPersonIds) merged.add(id);
            }
            effectivePolicy = { mode: 'expanded', expandedPersonIds: merged, autoExpand: true };
        }
    }

    // Expand selection for expanded persons (add missing partners/children)
    expandSelectionForDisplay(data, selection, effectivePolicy);

    // Step 2: Build layout model
    const model = buildLayoutModel({
        data,
        selection,
        focusPersonId,
        displayPolicy: effectivePolicy
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
        tolerance = 0.5,
        displayPolicy = DEFAULT_DISPLAY_POLICY
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

    // Auto-expand: find persons at gen >= -1 with multiple partnerships
    let effectivePolicyDebug = displayPolicy;
    if (displayPolicy.autoExpand !== false) {
        const autoExpandIdsDebug = findAutoExpandPersonIds(data, focusPersonId, selection);
        if (autoExpandIdsDebug.size > 0) {
            const merged = new Set(autoExpandIdsDebug);
            if (displayPolicy.expandedPersonIds) {
                for (const id of displayPolicy.expandedPersonIds) merged.add(id);
            }
            effectivePolicyDebug = { mode: 'expanded', expandedPersonIds: merged, autoExpand: true };
        }
    }

    // Expand selection for expanded persons (add missing partners/children)
    expandSelectionForDisplay(data, selection, effectivePolicyDebug);

    snapshots.push(createSnapshot(1, { selection }));
    if (targetStep === 1 || selection.persons.size === 0) {
        return { result: emptyResult(), snapshots };
    }

    // Step 2: Build layout model
    const model = buildLayoutModel({
        data,
        selection,
        focusPersonId,
        displayPolicy: effectivePolicyDebug
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
            includeParentSiblingDescendants: request.policy.includeCousins,
            displayPolicy: request.displayPolicy
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
