/**
 * Merge Import Module
 * Smart merge import for combining incoming data with existing tree
 */

// Types
export type {
    ValidationResult,
    MatchConfidence,
    MatchReason,
    PersonMatch,
    FieldConflict,
    MatchDecision,
    MergePhase,
    MergeState,
    IdMapping,
    MergeResult,
    MatchFilter,
    MergeStats
} from './types.js';

// Persistence types
export type {
    SerializableMergeState,
    SavedMergeSession
} from './persistence.js';

// Validation
export {
    validateJsonImport,
    validateGedcomImport,
    getValidationErrorKey
} from './validation.js';

// Matching
export {
    normalizeName,
    stringSimilarity,
    findMatches,
    detectConflicts,
    createMergeState,
    calculateMergeStats,
    updateMatchDecision,
    updateConflictResolution,
    reanalyzeMatches
} from './matching.js';

// Executor
export {
    createMergeBackup,
    restoreFromBackup,
    deleteBackup,
    buildIdMapping,
    executeMerge
} from './executor.js';

// Persistence
export {
    saveCurrentMerge,
    getCurrentMerge,
    getCurrentMergeInfo,
    clearCurrentMerge,
    saveMergeSession,
    loadMergeSession,
    deleteMergeSession,
    renameMergeSession,
    listMergeSessionsInfo,
    hasPendingMerges
} from './persistence.js';

// UI
export { MergerUI } from './ui.js';
