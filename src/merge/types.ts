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
}

// ==================== MERGE DECISIONS ====================

/** User decision for a match */
export type MatchDecision =
    | { type: 'confirm' }
    | { type: 'reject' }
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
    phase: MergePhase;
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
}
