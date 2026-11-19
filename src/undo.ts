/**
 * Undo / Redo — snapshot stack for the active tree's data.
 *
 * A mutation records a deep copy of the data as it was BEFORE the change plus a
 * human-readable description. Undo restores the previous snapshot; redo replays
 * it. The stack is bounded and belongs to the active tree — switching trees
 * clears the history (simple and predictable, per spec).
 *
 * This module only holds snapshots and juggles the two stacks; taking the deep
 * copies, applying them to the live data and persisting is the DataManager's job.
 */

import { StromData, TreeId, ResearchBase } from './types.js';

export interface UndoSnapshot {
    /** Deep copy of the tree data at this point. */
    data: StromData;
    /** What the recorded action was (used in the toast: "Undone: <description>"). */
    description: string;
    /** The research base these data build on (a tree tied to a research); undefined = not recorded. */
    base?: ResearchBase | null;
    /** What kind of step this is, for a step a dialog offers to undo by name (the sources' split, spec 075 §5). */
    mark?: UndoMark;
    /**
     * The step changed only the tree's own lists of people (spec 084), which a
     * research never has: undone and redone also while the tree follows a
     * research (its other steps wait until following ends).
     */
    listsOnly?: true;
    /**
     * When the state was recorded (UndoManager sets it, rising): a load
     * of images goes only into the states after its start (spec 116, I3).
     */
    seq?: number;
}

/** A step named beyond its description: its kind, when it was done, how many things it changed. */
export interface UndoMark {
    kind: 'sourcesSplit';
    /** ms since the epoch */
    at: number;
    count: number;
}

/** Maximum number of undo steps kept per tree. */
export const MAX_UNDO_STEPS = 50;

class UndoManagerClass {
    private undoStack: UndoSnapshot[] = [];
    private redoStack: UndoSnapshot[] = [];
    private activeTreeId: TreeId | null = null;
    private seq = 0;

    /**
     * Point the manager at a tree. When the tree changes, both stacks are
     * cleared — undo history does not survive a tree switch.
     */
    setActiveTree(treeId: TreeId | null): void {
        if (treeId !== this.activeTreeId) {
            this.undoStack = [];
            this.redoStack = [];
            this.activeTreeId = treeId;
        }
    }

    /**
     * Record a pre-mutation snapshot. A fresh mutation invalidates the redo
     * stack (standard behavior).
     */
    push(snapshot: UndoSnapshot): void {
        this.undoStack.push({ ...snapshot, seq: ++this.seq });
        if (this.undoStack.length > MAX_UNDO_STEPS) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    /**
     * Pop the previous state. `currentData` (the present state) is stashed on the
     * redo stack tagged with the undone action's description.
     */
    undo(currentData: StromData, currentBase?: ResearchBase | null): UndoSnapshot | null {
        const snapshot = this.undoStack.pop();
        if (!snapshot) return null;
        this.redoStack.push(stepLike(snapshot, currentData, currentBase));
        return snapshot;
    }

    /** Symmetric to undo(): replay the last undone state. */
    redo(currentData: StromData, currentBase?: ResearchBase | null): UndoSnapshot | null {
        const snapshot = this.redoStack.pop();
        if (!snapshot) return null;
        this.undoStack.push(stepLike(snapshot, currentData, currentBase));
        return snapshot;
    }

    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /** Description of the action a single undo would reverse, or null. */
    peekUndoDescription(): string | null {
        return this.undoStack.length > 0
            ? this.undoStack[this.undoStack.length - 1].description
            : null;
    }

    /** The mark of the step a single undo would reverse, or null (none, or a step without one). */
    peekUndoMark(): UndoMark | null {
        return this.undoStack[this.undoStack.length - 1]?.mark ?? null;
    }

    /** The step a single undo (redo) would take back (replay) changed only lists of people. */
    peekListsOnly(which: 'undo' | 'redo'): boolean {
        const stack = which === 'undo' ? this.undoStack : this.redoStack;
        return stack[stack.length - 1]?.listsOnly === true;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** The stamp of the history now: every state recorded later has a higher `seq`. */
    historyStamp(): number {
        return this.seq;
    }

    /**
     * Change in place the data of every state on both stacks recorded after
     * `since` (images that came in the background go into the states the
     * user can go back or forth to, spec 116 I3).
     */
    patchHistory(since: number, fn: (data: StromData) => void): void {
        for (const s of [...this.undoStack, ...this.redoStack]) {
            if ((s.seq ?? 0) > since) fn(s.data);
        }
    }

    /** Test/utility: drop all history for the current tree. */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
    }
}

/** The state `data` stashed on the other stack as the same step as `snapshot` (its description and kind). */
function stepLike(snapshot: UndoSnapshot, data: StromData, base: ResearchBase | null | undefined): UndoSnapshot {
    return {
        data, description: snapshot.description,
        ...(base !== undefined ? { base } : {}),
        ...(snapshot.mark ? { mark: snapshot.mark } : {}),
        ...(snapshot.listsOnly ? { listsOnly: true as const } : {}),
        // The same step, seen from its other side: recorded when the step was.
        ...(snapshot.seq !== undefined ? { seq: snapshot.seq } : {}),
    };
}

export const UndoManager = new UndoManagerClass();
