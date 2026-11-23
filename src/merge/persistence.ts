/**
 * Merge Import - Persistence Module
 * Handles saving and loading merge sessions to/from IndexedDB
 */

import { PersonId, PartnershipId, StromData } from '../types.js';
import {
    MergeState,
    MergePhase,
    MergeTarget,
    MergeWizardState,
    PersonMatch,
    FieldConflict,
    MatchDecision,
    PartnershipConflictField,
    ConflictResolution
} from './types.js';
import { detectPartnershipConflicts } from './executor.js';
import { planCounts, wizardPlan } from './plan.js';
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
    /** Partnership conflict answers. Optional: old sessions lack it. */
    partnershipResolutions?: Array<[PartnershipId, Partial<Record<PartnershipConflictField, ConflictResolution>>]>;
    phase: MergePhase;
    /** "Update existing only" mode (Primitive 1). Optional: old sessions lack it. */
    updateOnly?: boolean;
    /** The target tree and its data's fingerprint at the matching (spec 134 K0.6). Optional: old sessions lack it. */
    target?: MergeTarget;
    /** The guide's step, reached step, comparison done and choices (spec 134 §1). Optional: old sessions lack it. */
    wizard?: MergeWizardState;
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
        /**
         * The guide's "to decide" (planCounts().pending of wizardPlan, the
         * number of step 2), when the comparison ran (134 S-P2). Absent in
         * sessions of older versions and before the comparison.
         */
        pending?: number;
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
        partnershipResolutions: Array.from(state.partnershipResolutions?.entries() ?? []),
        phase: state.phase,
        updateOnly: state.updateOnly,
        ...(state.target ? { target: state.target } : {}),
        ...(state.wizard ? { wizard: structuredClone(state.wizard) } : {})
    };
}

function deserializeState(serialized: SerializableMergeState): MergeState {
    // A session saved before suggestions stopped being the default holds them
    // as resolutions: on a person nobody answered for, a suggested
    // "use the import" goes back to keeping the existing value (spec 134 K0.3).
    const answered = new Set(serialized.conflictResolutions.map(([id]) => id));
    for (const match of serialized.matches) {
        if (answered.has(match.incomingId)) continue;
        for (const conflict of match.conflicts) {
            if (conflict.suggestedReason && conflict.resolution === 'use_incoming') {
                conflict.suggested ??= 'use_incoming';
                conflict.resolution = 'keep_existing';
            }
        }
    }
    return {
        existingData: serialized.existingData,
        incomingData: serialized.incomingData,
        matches: serialized.matches,
        unmatchedExisting: serialized.unmatchedExisting,
        unmatchedIncoming: serialized.unmatchedIncoming,
        decisions: new Map(serialized.decisions),
        conflictResolutions: new Map(serialized.conflictResolutions),
        partnershipResolutions: new Map(serialized.partnershipResolutions ?? []),
        phase: serialized.phase,
        // Old saved sessions predate the flag → default to normal mode.
        updateOnly: serialized.updateOnly ?? false,
        ...(serialized.target ? { target: serialized.target } : {}),
        ...(serialized.wizard ? { wizard: serialized.wizard } : {})
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
    conflicts += detectPartnershipConflicts(state).length;
    for (const [personId, resolutions] of state.conflictResolutions) {
        const match = state.matches.find(m => m.incomingId === personId);
        if (match && resolutions.length === match.conflicts.length) {
            resolved++;
        }
    }

    const pending = pendingOf(state);
    return { total, reviewed, resolved, conflicts, ...(pending !== undefined ? { pending } : {}) };
}

/** The guide's "to decide" of a merge (step 2), or undefined before its comparison. */
function pendingOf(state: MergeState): number | undefined {
    try {
        const plan = wizardPlan(state);
        return plan ? planCounts(plan).pending : undefined;
    } catch {
        return undefined;
    }
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

/**
 * Store the state of a resumed saved merge under its own session (spec 134
 * K0.6): the session stays until the merge is written or thrown away, its
 * name as it was. False when the session is gone or the write failed.
 */
export async function updateMergeSession(id: string, state: MergeState, names?: { targetTreeName?: string; sourceTreeName?: string }): Promise<boolean> {
    try {
        const sessions = await listMergeSessions();
        const session = sessions.find(s => s.id === id);
        if (!session) return false;
        session.savedAt = new Date().toISOString();
        // The target chosen since (or named wrong by an older version, 134 V-N4): the row says the tree merged into.
        if (names?.targetTreeName) session.targetTreeName = names.targetTreeName;
        if (names?.sourceTreeName) session.sourceTreeName = names.sourceTreeName;
        session.stats = calculateStats(state);
        session.state = serializeState(state);
        await StorageManager.set('merge', SESSIONS_KEY, sessions);
        return true;
    } catch (error) {
        console.error('Failed to update merge session:', error);
        return false;
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
    return sessions.map(({ id, savedAt, incomingFileName, targetTreeName, sourceTreeName, stats, state }) => ({
        id,
        savedAt,
        incomingFileName,
        targetTreeName,
        sourceTreeName,
        // A session saved by an older version: its "to decide" from its guide's state.
        stats: stats.pending === undefined && state?.wizard ? { ...stats, ...pendingStat(state) } : stats
    }));
}

function pendingStat(serialized: SerializableMergeState): { pending?: number } {
    try {
        const pending = pendingOf(deserializeState(serialized));
        return pending !== undefined ? { pending } : {};
    } catch {
        return {};
    }
}

export async function hasPendingMerges(): Promise<boolean> {
    const currentInfo = await getCurrentMergeInfo();
    const savedSessions = await listMergeSessionsInfo();
    return currentInfo !== null || savedSessions.length > 0;
}
