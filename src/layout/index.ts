/**
 * Layout Module Entry Point
 *
 * Provides a clean API for computing family tree layouts.
 * Uses a modular 8-step pipeline architecture.
 *
 * Usage:
 *   import { computeLayout, StromLayoutEngine } from './layout/index.js';
 *
 *   const engine = new StromLayoutEngine();
 *   const result = computeLayout(engine, request);
 *
 * Pipeline steps:
 *   1. selectSubgraph()     → GraphSelection
 *   2. buildLayoutModel()   → LayoutModel (UnionNodes!)
 *   3. assignGenerations()  → GenerationalModel
 *   4. measureSubtrees()    → MeasuredModel
 *   5. placeX()             → PlacedModel
 *   6. applyConstraints()   → ConstrainedModel
 *   7. routeEdges()         → RoutedModel
 *   8. emitLayoutResult()   → LayoutResult
 */

// Re-export everything from pipeline
export * from './pipeline/index.js';

// Re-export types for backwards compatibility
export type {
    LayoutEngine,
    LayoutRequest,
    LayoutResult,
    SelectionPolicy,
    Connection,
    SpouseLine,
    ChildDrop,
    ValidationResult,
    LayoutDiagnostics
} from './pipeline/types.js';
