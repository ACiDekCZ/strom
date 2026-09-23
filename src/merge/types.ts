/**
 * Merge Import - Type Definitions
 * Types for smart merge import functionality
 */

import { PersonId, PartnershipId, Person, StromData } from '../types.js';

// ==================== VALIDATION ====================

/** Result of file validation */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    data?: StromData;
}

// ==================== MATCHING ====================

/** Confidence level for match */
export type MatchConfidence = 'high' | 'medium' | 'low';

/** Reason for match */
export type MatchReason =
    | 'exact_name_gender_birthdate'   // High: name + gender + date
    | 'name_gender_birthyear'         // Medium: name + gender + year
    | 'name_gender_parents'           // Medium: name + gender + parents
    | 'name_similarity_relationships' // Low: similar name + relationships
    | 'first_name_match'              // First name exact, last name differs (married women)
    | 'first_name_birthyear'          // First name + birth year (relaxed)
    | 'lastname_birthyear'            // Last name + birth year (could be relative)
    | 'partner_of_matched'            // Partner of already matched person
    | 'child_of_matched'              // Child of already matched person
    | 'parent_of_matched'             // Parent of already matched person
    | 'partner_similarity'            // Partners have similar names
    | 'manual';                       // Manual assignment

/** Person match between existing and incoming data */
export interface PersonMatch {
    existingId: PersonId;
    incomingId: PersonId;
    confidence: MatchConfidence;
    reasons: MatchReason[];
    score: number;                    // 0-100
    existingPerson: Person;
    incomingPerson: Person;
    conflicts: FieldConflict[];
}

/** Field conflict between existing and incoming data */
export interface FieldConflict {
    field: keyof Person;
    existingValue: string | undefined;
    incomingValue: string | undefined;
    resolution: 'keep_existing' | 'use_incoming' | 'manual';
    resolvedValue?: string;
    /**
     * Why the pre-selected resolution was suggested (heuristics in
     * suggestResolution). Absent = plain keep-existing default, no opinion.
     */
    suggestedReason?: 'more_precise_date' | 'more_complete';
}

/** Partnership fields that can conflict when both trees know the same union. */
export type PartnershipConflictField = 'status' | 'startDate' | 'startPlace' | 'endDate';

/** Resolution of one conflicting value. */
export type ConflictResolution = 'keep_existing' | 'use_incoming';

/**
 * A union that exists in both trees (both partners resolve to existing
 * persons who already share a partnership) and disagrees on one field.
 * Derived from the current decisions, never stored: which unions coincide
 * depends on which person matches the user confirmed.
 */
export interface PartnershipConflict {
    incomingPartnershipId: PartnershipId;
    existingPartnershipId: PartnershipId;
    field: PartnershipConflictField;
    existingValue: string;
    incomingValue: string;
    resolution: ConflictResolution;
}

// ==================== MERGE DECISIONS ====================

/**
 * User decision for a match.
 * - confirm: same person → merge incoming into the existing one
 * - reject: NOT the same person → import the incoming person as a NEW person
 * - skip: don't bring this incoming person at all (neither merged nor added)
 * - manual_match: merge into a hand-picked existing person
 */
export type MatchDecision =
    | { type: 'confirm' }
    | { type: 'reject' }
    | { type: 'skip' }
    | { type: 'manual_match'; targetId: PersonId };

// ==================== MERGE STATE ====================

/** Current phase of merge process */
export type MergePhase = 'analyzing' | 'reviewing' | 'executing' | 'complete';

/** Full state of merge process */
export interface MergeState {
    existingData: StromData;
    incomingData: StromData;
    matches: PersonMatch[];
    unmatchedExisting: PersonId[];
    unmatchedIncoming: PersonId[];
    decisions: Map<PersonId, MatchDecision>;
    conflictResolutions: Map<PersonId, FieldConflict[]>;
    /**
     * The user's answers for partnership conflicts, keyed by the INCOMING
     * partnership id. A union with an entry counts as resolved; a field
     * without an answer keeps the existing value. Optional: sessions saved
     * before partnership conflicts existed lack it.
     */
    partnershipResolutions?: Map<PartnershipId, Partial<Record<PartnershipConflictField, ConflictResolution>>>;
    phase: MergePhase;
    /**
     * "Update existing only" mode. When true, the merge only enriches persons
     * that matched (confirmed/manual) and adds NO unmatched/rejected incoming
     * persons (nor placeholders/partnerships that would depend on them).
     * Absent/false = normal mode (add new persons too). Old saved sessions
     * without this field default to false.
     */
    updateOnly?: boolean;
}

// ==================== ID MAPPING ====================

/** Mapping from incoming IDs to final IDs */
export interface IdMapping {
    persons: Map<PersonId, PersonId>;       // incoming -> final
    partnerships: Map<PartnershipId, PartnershipId>;  // incoming -> final
}

// ==================== MERGE RESULT ====================

/** Result of merge execution */
export interface MergeResult {
    success: boolean;
    mergedData: StromData;
    stats: {
        merged: number;        // Persons merged with existing
        added: number;         // New persons added
        skipped: number;       // Incoming persons skipped (neither merged nor added)
        partnerships: number;  // Total partnerships in result
    };
    backupKey?: string;        // localStorage key for backup
    errors?: string[];
}

// ==================== UI STATE ====================

/** Filter for match review UI */
export type MatchFilter = 'all' | 'high' | 'medium' | 'low' | 'unmatched' | 'conflicts';

/** Stats for merge review */
export interface MergeStats {
    total: number;
    matched: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    unmatched: number;
    withConflicts: number;
    /** Unions present in both trees that disagree on status or dates. */
    partnershipConflicts: number;
    /** Of those, how many the user already went through in the dialog. */
    partnershipConflictsResolved: number;
    /**
     * Persons that will actually be ADDED as new given the current decisions
     * and updateOnly mode (0 in updateOnly mode). Unlike `unmatched` (how many
     * are listed for review), this is the truthful "will add N" number.
     */
    willAdd: number;
    /** Incoming persons the user chose to skip (neither merged nor added). */
    skipped: number;
}
