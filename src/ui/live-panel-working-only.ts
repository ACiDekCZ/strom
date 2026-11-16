/**
 * The small research panel beside the overview's own window (spec 079 U9):
 * while the Research overview is in a window of its own, the main window's
 * panel on a computer keeps its head and "Working" only (the other sections
 * are seen in that window). Phones and tablets, an ended following and the
 * panel without following stay as they are.
 */

import type { PanelPrefKey } from './live-section-prefs.js';

export interface WorkingOnlyEnv {
    /** The Research overview is open in a window of its own. */
    overviewInWindow: boolean;
    /** The main window is at a computer's width (> 1024 px, breakpoints.ts). */
    desktop: boolean;
    /** The following has ended (its panel says so and stays as it is). */
    ended: boolean;
}

/** The panel shows its head and "Working" only. */
export function livePanelWorkingOnly(env: WorkingOnlyEnv): boolean {
    return env.overviewInWindow && env.desktop && !env.ended;
}

/**
 * The panel's sections drawn, in order: all of them in the user's order, or
 * "Working" alone beside the overview's window (whatever its choice in
 * Customize panel, else the panel would be empty).
 */
export function livePanelDrawnSections(order: readonly PanelPrefKey[], workingOnly: boolean): PanelPrefKey[] {
    return workingOnly ? ['working'] : [...order];
}

/** "Working" beside the overview's window says "Nothing is being worked on now" in its place. */
export function livePanelNothingAtWork(workers: readonly unknown[]): boolean {
    return workers.length === 0;
}
