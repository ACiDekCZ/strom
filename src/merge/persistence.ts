/**
 * Merge Import - Persistence Module
 * Handles saving and loading merge sessions to/from IndexedDB
 */

import { PersonId, StromData } from '../types.js';
import {
    MergeState,
    MergePhase,
    PersonMatch,
    FieldConflict,
    MatchDecision
} from './types.js';
import { StorageManager } from '../storage.js';

// ==================== IDB KEYS ====================

const SESSIONS_KEY = 'sessions';
const CURRENT_KEY = 'current';

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

function generateSessionId(): string {
    return `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function calculateStats(state: MergeState): SavedMergeSession['stats'] {
    const total = state.matches.length + state.unmatchedIncoming.length;
    const reviewed = state.decisions.size;

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

export async function saveCurrentMerge(state: MergeState, fileName?: string): Promise<void> {
    try {
        const session: SavedMergeSession = {
            id: 'current',
            savedAt: new Date().toISOString(),
            incomingFileName: fileName,
            stats: calculateStats(state),
            state: serializeState(state)
        };

        await StorageManager.set('merge', CURRENT_KEY, session);
    } catch (error) {
        console.error('Failed to save current merge:', error);
    }
}

export async function getCurrentMerge(): Promise<MergeState | null> {
    try {
        const session = await StorageManager.get<SavedMergeSession>('merge', CURRENT_KEY);
        if (!session) return null;
        return deserializeState(session.state);
    } catch (error) {
        console.error('Failed to load current merge:', error);
        return null;
    }
}

export async function getCurrentMergeInfo(): Promise<Omit<SavedMergeSession, 'state'> | null> {
    try {
        const session = await StorageManager.get<SavedMergeSession>('merge', CURRENT_KEY);
        if (!session) return null;
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

export async function clearCurrentMerge(): Promise<void> {
    await StorageManager.delete('merge', CURRENT_KEY);
}

// ==================== SAVED SESSIONS ====================

export async function saveMergeSession(
    state: MergeState,
    fileName?: string,
    targetTreeName?: string,
    sourceTreeName?: string
): Promise<string> {
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

        const sessions = await listMergeSessions();
        sessions.push(session);

        await StorageManager.set('merge', SESSIONS_KEY, sessions);

        // Clear current merge after saving
        await clearCurrentMerge();

        return id;
    } catch (error) {
        console.error('Failed to save merge session:', error);
        throw error;
    }
}

export async function loadMergeSession(id: string): Promise<MergeState | null> {
    try {
        const sessions = await listMergeSessions();
        const session = sessions.find(s => s.id === id);

        if (!session) return null;

        return deserializeState(session.state);
    } catch (error) {
        console.error('Failed to load merge session:', error);
        return null;
    }
}

export async function deleteMergeSession(id: string): Promise<void> {
    try {
        const sessions = await listMergeSessions();
        const filtered = sessions.filter(s => s.id !== id);
        await StorageManager.set('merge', SESSIONS_KEY, filtered);
    } catch (error) {
        console.error('Failed to delete merge session:', error);
    }
}

export async function renameMergeSession(id: string, newName: string): Promise<void> {
    try {
        const sessions = await listMergeSessions();
        const session = sessions.find(s => s.id === id);
        if (session) {
            session.incomingFileName = newName;
            await StorageManager.set('merge', SESSIONS_KEY, sessions);
        }
    } catch (error) {
        console.error('Failed to rename merge session:', error);
    }
}

export async function listMergeSessions(): Promise<SavedMergeSession[]> {
    try {
        const sessions = await StorageManager.get<SavedMergeSession[]>('merge', SESSIONS_KEY);
        return sessions || [];
    } catch (error) {
        console.error('Failed to list merge sessions:', error);
        return [];
    }
}

export async function listMergeSessionsInfo(): Promise<Array<Omit<SavedMergeSession, 'state'>>> {
    const sessions = await listMergeSessions();
    return sessions.map(({ id, savedAt, incomingFileName, targetTreeName, sourceTreeName, stats }) => ({
        id,
        savedAt,
        incomingFileName,
        targetTreeName,
        sourceTreeName,
        stats
    }));
}

export async function hasPendingMerges(): Promise<boolean> {
    const currentInfo = await getCurrentMergeInfo();
    const savedSessions = await listMergeSessionsInfo();
    return currentInfo !== null || savedSessions.length > 0;
}
