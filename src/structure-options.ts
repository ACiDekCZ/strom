/**
 * Change structure… (spec 139 §2): which options the dialog offers for a tree
 * and why one is greyed out. Pure logic, no DOM — the dialog
 * (src/ui/structure-ui.ts) draws what this returns.
 *
 * Every option is always listed, in the dialog's order; one that cannot run
 * now is `enabled: false` with the reason the dialog says under it. A
 * read-only tree (locked, followed live, a newer app's data) gets no dialog at
 * all: its "Change structure…" row is not shown (§1.1).
 */

import { findComponents } from './components.js';
import type { StromData } from './types.js';
import type { StructureDirKind } from './icons.js';

export type StructureGroupKey = 'newTree' | 'split' | 'join';

/** The options in the dialog's order (§2.2). */
export type StructureOptionKey = 'select' | 'copy' | 'families' | 'parts' | 'into' | 'file';

/** Why an option is greyed out (structure.why*). */
export type StructureReason = 'notOpen' | 'connected' | 'noOther' | 'followed';

/** A way out offered with the reason, under the option (a link, never inside its button). */
export type StructureReasonAction = 'stopFollowing';

export interface StructureContext {
    /** The tree is the open one. */
    isActive: boolean;
    /** Locked, followed live, locked data or saved by a newer app: no dialog. */
    readOnly: boolean;
    /** The open tree is followed live (writing into it is blocked). */
    liveFollowing: boolean;
    /** Some other tree exists (a target to join into). */
    otherTrees: boolean;
    /**
     * Some other tree can take a merge now. Blocked targets never grey the
     * option out: the merge guide's check (mergeTargetReady) says why and
     * offers its way out.
     */
    otherTargetsReady?: boolean;
    /**
     * The whole tree is one connected family; null while not known yet (a
     * large tree counted in the background) — the option stays active and the
     * split dialog says it itself.
     */
    connected: boolean | null;
}

export interface StructureOption {
    key: StructureOptionKey;
    group: StructureGroupKey;
    /** The direction drawn before its text (§2.3). */
    dir: StructureDirKind;
    enabled: boolean;
    reason?: StructureReason;
    reasonAction?: StructureReasonAction;
}

const OPTIONS: ReadonlyArray<Pick<StructureOption, 'key' | 'group' | 'dir'>> = [
    { key: 'select', group: 'newTree', dir: 'new' },
    { key: 'copy', group: 'newTree', dir: 'new' },
    { key: 'families', group: 'split', dir: 'split' },
    { key: 'parts', group: 'split', dir: 'split' },
    { key: 'into', group: 'join', dir: 'into' },
    { key: 'file', group: 'join', dir: 'file' },
];

/** The groups in the dialog's order. */
export const STRUCTURE_GROUPS: readonly StructureGroupKey[] = ['newTree', 'split', 'join'];

function blocked(key: StructureOptionKey, ctx: StructureContext): Pick<StructureOption, 'reason' | 'reasonAction'> | null {
    switch (key) {
        // A selection is made of the open tree's view, lists and people.
        case 'select':
            return ctx.isActive ? null : { reason: 'notOpen' };
        case 'parts':
            return ctx.connected === true ? { reason: 'connected' } : null;
        case 'into':
            return ctx.otherTrees ? null : { reason: 'noOther' };
        // The guide writes into the open tree: it has to be open and writable.
        case 'file':
            if (!ctx.isActive) return { reason: 'notOpen' };
            return ctx.liveFollowing ? { reason: 'followed', reasonAction: 'stopFollowing' } : null;
        default:
            return null;
    }
}

/** The dialog's options for a tree; none for a read-only tree (it has no dialog). */
export function structureOptions(ctx: StructureContext): StructureOption[] {
    if (ctx.readOnly) return [];
    return OPTIONS.map(option => {
        const why = blocked(option.key, ctx);
        return why ? { ...option, enabled: false, ...why } : { ...option, enabled: true };
    });
}

/** Whether the tree is one connected family (nothing to separate); an empty tree is. */
export function isWhollyConnected(data: StromData): boolean {
    return findComponents(data).length <= 1;
}
