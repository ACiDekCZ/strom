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

import { StromData, TreeId } from './types.js';

export interface UndoSnapshot {
    /** Deep copy of the tree data at this point. */
    data: StromData;
    /** What the recorded action was (used in the toast: "Undone: <description>"). */
    description: string;
}

/** Maximum number of undo steps kept per tree. */
export const MAX_UNDO_STEPS = 50;

class UndoManagerClass {
    private undoStack: UndoSnapshot[] = [];
    private redoStack: UndoSnapshot[] = [];
    private activeTreeId: TreeId | null = null;

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
        this.undoStack.push(snapshot);
        if (this.undoStack.length > MAX_UNDO_STEPS) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    /**
     * Pop the previous state. `currentData` (the present state) is stashed on the
     * redo stack tagged with the undone action's description.
     */
    undo(currentData: StromData): UndoSnapshot | null {
        const snapshot = this.undoStack.pop();
        if (!snapshot) return null;
        this.redoStack.push({ data: currentData, description: snapshot.description });
        return snapshot;
    }

    /** Symmetric to undo(): replay the last undone state. */
    redo(currentData: StromData): UndoSnapshot | null {
        const snapshot = this.redoStack.pop();
        if (!snapshot) return null;
        this.undoStack.push({ data: currentData, description: snapshot.description });
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

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** Test/utility: drop all history for the current tree. */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
    }
}

export const UndoManager = new UndoManagerClass();
