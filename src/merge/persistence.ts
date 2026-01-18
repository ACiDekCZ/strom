/**
 * Merge Import - Persistence Module
 * Handles saving and loading merge sessions to/from localStorage
 */

import { PersonId, StromData } from '../types.js';
import {
    MergeState,
    MergePhase,
    PersonMatch,
    FieldConflict,
    MatchDecision
} from './types.js';

// ==================== STORAGE KEYS ====================

const MERGE_SESSIONS_KEY = 'strom-merge-sessions';
const CURRENT_MERGE_KEY = 'strom-current-merge';

// ==================== SERIALIZABLE TYPES ====================

/** Serializable version of MergeState (Map -> Array) */
export interface SerializableMergeState {
    existingData: StromData;
    incomingData: StromData;
    matches: PersonMatch[];
    unmatchedExisting: PersonId[];
    unmatchedIncoming: PersonId[];
    decisions: Array<[PersonId, MatchDecision]>;
    conflictResolutions: Array<[PersonId, FieldConflict[]]>;
    phase: MergePhase;
}

/** Saved merge session metadata */
export interface SavedMergeSession {
    id: string;
    savedAt: string;
    incomingFileName?: string;
    /** Target tree name (tree being merged into) */
    targetTreeName?: string;
    /** Source tree name (tree being merged from, for tree-to-tree merge) */
    sourceTreeName?: string;
    stats: {
        total: number;
        reviewed: number;
        resolved: number;
        conflicts: number;
    };
    state: SerializableMergeState;
}

// ==================== SERIALIZATION ====================

/**
 * Convert MergeState to serializable format
 */
function serializeState(state: MergeState): SerializableMergeState {
    return {
        existingData: state.existingData,
        incomingData: state.incomingData,
        matches: state.matches,
        unmatchedExisting: state.unmatchedExisting,
        unmatchedIncoming: state.unmatchedIncoming,
        decisions: Array.from(state.decisions.entries()),
        conflictResolutions: Array.from(state.conflictResolutions.entries()),
        phase: state.phase
    };
}

/**
 * Convert serialized state back to MergeState
 */
function deserializeState(serialized: SerializableMergeState): MergeState {
    return {
        existingData: serialized.existingData,
        incomingData: serialized.incomingData,
        matches: serialized.matches,
        unmatchedExisting: serialized.unmatchedExisting,
        unmatchedIncoming: serialized.unmatchedIncoming,
        decisions: new Map(serialized.decisions),
        conflictResolutions: new Map(serialized.conflictResolutions),
        phase: serialized.phase
    };
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
    return `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate session stats from merge state
 */
function calculateStats(state: MergeState): SavedMergeSession['stats'] {
    const total = state.matches.length + state.unmatchedIncoming.length;
    const reviewed = state.decisions.size;

    // Count total conflicts and resolved conflicts
    let conflicts = 0;
    let resolved = 0;
    for (const match of state.matches) {
        conflicts += match.conflicts.length;
    }
    for (const [personId, resolutions] of state.conflictResolutions) {
        const match = state.matches.find(m => m.incomingId === personId);
        if (match && resolutions.length === match.conflicts.length) {
            resolved++;
        }
    }

    return { total, reviewed, resolved, conflicts };
}

// ==================== CURRENT MERGE (AUTO-SAVE) ====================

/**
 * Save current merge state (auto-save)
 */
export function saveCurrentMerge(state: MergeState, fileName?: string): void {
    try {
        const session: SavedMergeSession = {
            id: 'current',
            savedAt: new Date().toISOString(),
            incomingFileName: fileName,
            stats: calculateStats(state),
            state: serializeState(state)
        };

        localStorage.setItem(CURRENT_MERGE_KEY, JSON.stringify(session));
    } catch (error) {
        console.error('Failed to save current merge:', error);
    }
}

/**
 * Load current merge state
 */
export function getCurrentMerge(): MergeState | null {
    try {
        const json = localStorage.getItem(CURRENT_MERGE_KEY);
        if (!json) return null;

        const session: SavedMergeSession = JSON.parse(json);
        return deserializeState(session.state);
    } catch (error) {
        console.error('Failed to load current merge:', error);
        return null;
    }
}

/**
 * Get current merge session metadata (without full state)
 */
export function getCurrentMergeInfo(): Omit<SavedMergeSession, 'state'> | null {
    try {
        const json = localStorage.getItem(CURRENT_MERGE_KEY);
        if (!json) return null;

        const session: SavedMergeSession = JSON.parse(json);
        return {
            id: session.id,
            savedAt: session.savedAt,
            incomingFileName: session.incomingFileName,
            stats: session.stats
        };
    } catch (error) {
        console.error('Failed to get current merge info:', error);
        return null;
    }
}

/**
 * Clear current merge state
 */
export function clearCurrentMerge(): void {
    localStorage.removeItem(CURRENT_MERGE_KEY);
}

// ==================== SAVED SESSIONS ====================

/**
 * Save merge session for later
 */
export function saveMergeSession(
    state: MergeState,
    fileName?: string,
    targetTreeName?: string,
    sourceTreeName?: string
): string {
    try {
        const id = generateSessionId();
        const session: SavedMergeSession = {
            id,
            savedAt: new Date().toISOString(),
            incomingFileName: fileName,
            targetTreeName,
            sourceTreeName,
            stats: calculateStats(state),
            state: serializeState(state)
        };

        // Get existing sessions
        const sessions = listMergeSessions();
        sessions.push(session);

        localStorage.setItem(MERGE_SESSIONS_KEY, JSON.stringify(sessions));

        // Clear current merge after saving
        clearCurrentMerge();

        return id;
    } catch (error) {
        console.error('Failed to save merge session:', error);
        throw error;
    }
}

/**
 * Load merge session by ID
 */
export function loadMergeSession(id: string): MergeState | null {
    try {
        const sessions = listMergeSessions();
        const session = sessions.find(s => s.id === id);

        if (!session) return null;

        return deserializeState(session.state);
    } catch (error) {
        console.error('Failed to load merge session:', error);
        return null;
    }
}

/**
 * Delete merge session by ID
 */
export function deleteMergeSession(id: string): void {
    try {
        const sessions = listMergeSessions();
        const filtered = sessions.filter(s => s.id !== id);
        localStorage.setItem(MERGE_SESSIONS_KEY, JSON.stringify(filtered));
    } catch (error) {
        console.error('Failed to delete merge session:', error);
    }
}

/**
 * Rename merge session (update incomingFileName which serves as display name)
 */
export function renameMergeSession(id: string, newName: string): void {
    try {
        const sessions = listMergeSessions();
        const session = sessions.find(s => s.id === id);
        if (session) {
            session.incomingFileName = newName;
            localStorage.setItem(MERGE_SESSIONS_KEY, JSON.stringify(sessions));
        }
    } catch (error) {
        console.error('Failed to rename merge session:', error);
    }
}

/**
 * List all saved merge sessions (without full state data)
 */
export function listMergeSessions(): SavedMergeSession[] {
    try {
        const json = localStorage.getItem(MERGE_SESSIONS_KEY);
        if (!json) return [];

        return JSON.parse(json);
    } catch (error) {
        console.error('Failed to list merge sessions:', error);
        return [];
    }
}

/**
 * Get session metadata without state
 */
export function listMergeSessionsInfo(): Array<Omit<SavedMergeSession, 'state'>> {
    const sessions = listMergeSessions();
    return sessions.map(({ id, savedAt, incomingFileName, targetTreeName, sourceTreeName, stats }) => ({
        id,
        savedAt,
        incomingFileName,
        targetTreeName,
        sourceTreeName,
        stats
    }));
}

/**
 * Check if there are any pending merges (current or saved)
 */
export function hasPendingMerges(): boolean {
    const currentInfo = getCurrentMergeInfo();
    const savedSessions = listMergeSessionsInfo();
    return currentInfo !== null || savedSessions.length > 0;
}
