/**
 * Table jumps by a person's name (spec 103 U3): the history of the jumps
 * (‹ ›) and the cell a jump lands on.
 *
 * Only jumps by a link are steps: a row type, a view or a filter changed by
 * hand is not one (decision D1). Every window has its own module state, so
 * its own history.
 */

import type { RowType } from './table-model.js';

/** Where a jump started: the active cell, the scroll, the name ‹ shows. */
export interface JumpFrom {
    rowType: RowType;
    /** The row's key (the selected row); `key` is its line's (a union's sub-row). */
    row: string;
    key: string;
    col: string;
    scrollTop: number;
    scrollLeft: number;
    label: string;
}

/** Where a jump led: the person's line and cell, the name it came from, the name › shows. */
export interface JumpTo {
    personId: string;
    key: string;
    col: string;
    origin: string | null;
    label: string;
    /** A partner's union opened by the jump (decision D3): closed again by ‹. */
    expanded?: string;
    /** The person was shown for now outside the filter (spec 103 2b): › shows them so again. */
    temp?: boolean;
}

export interface JumpStep { from: JumpFrom; to: JumpTo }

/** At most this many steps are kept; the oldest go first. */
export const JUMP_HISTORY_MAX = 50;

/** The jumps back and forward of one table (a browser's history in small). */
export class JumpHistory {
    private steps: JumpStep[] = [];
    /** How many steps lie behind: steps[at - 1] is the one ‹ undoes. */
    private at = 0;

    /** A new jump: the steps ahead are dropped. */
    push(step: JumpStep): void {
        this.steps.splice(this.at);
        this.steps.push(step);
        if (this.steps.length > JUMP_HISTORY_MAX) this.steps.splice(0, this.steps.length - JUMP_HISTORY_MAX);
        this.at = this.steps.length;
    }

    /** The step ‹ undoes (null when none), moved behind. */
    back(): JumpStep | null {
        if (this.at === 0) return null;
        this.at -= 1;
        return this.steps[this.at];
    }

    /** The step › repeats (null when none), moved ahead. */
    forward(): JumpStep | null {
        if (this.at >= this.steps.length) return null;
        this.at += 1;
        return this.steps[this.at - 1];
    }

    canBack(): boolean { return this.at > 0; }
    canForward(): boolean { return this.at < this.steps.length; }
    /** Any step at all: the bar's ‹ › show from the first jump on. */
    any(): boolean { return this.steps.length > 0; }
    /** The name ‹ leads to. */
    backLabel(): string { return this.at > 0 ? this.steps[this.at - 1].from.label : ''; }
    /** The name › leads to. */
    forwardLabel(): string { return this.at < this.steps.length ? this.steps[this.at].to.label : ''; }

    clear(): void {
        this.steps = [];
        this.at = 0;
    }
}

/**
 * The cell a jump lands on in the People table (spec 103 §1, 3; decision
 * D2): through a partner the person's Partner cell on the union's line with
 * the person it came from (when the union has a line of its own), else the
 * Name cell; a column not shown leads to the Name cell too.
 */
export function jumpTargetCell(
    via: string, shown: readonly string[], unionIndex: number, unions: number,
): { col: string; sub: number } {
    if (via === 'partner' && shown.includes('partner') && unionIndex >= 0) {
        // The first union is on the person's own line; the others (or all, when the person has several) on their sub-rows.
        return { col: 'partner', sub: unions > 1 ? unionIndex + 1 : 0 };
    }
    return { col: 'name', sub: 0 };
}
