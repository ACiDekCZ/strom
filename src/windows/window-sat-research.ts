/**
 * Research actions of a satellite window that run in the main window (the
 * satellite holds no bridge of its own; the main window does).
 *
 * Satellite side: `satResearchForward()` is how the satellite's UI asks the
 * main window to run an action (fire and forget, the main window coming
 * forward when it opens a dialog, or with its outcome awaited). It is set
 * from the satellite's client when the window starts and is null in the
 * main window (there the UI runs its own actions).
 *
 * Main side: a registry of the actions a satellite may ask for, each with a
 * strict reading of its arguments (anything malformed is not run) and its
 * run. The main window's research-action handler tries this registry first.
 * The actions themselves are registered by src/ui/sat-research-main.ts.
 */

/** What a satellite's UI needs from its client to have an action run in the main window. */
export interface SatResearchForward {
    /** The main window is open and answers. */
    mainOpen(): boolean;
    /** Ask the main window to run the action; `focusMain`: it comes to the front. */
    run(id: string, args: unknown, focusMain: boolean): void;
    /** Ask the main window to run the action and wait for its outcome (null: no answer within `waitMs`). */
    ask(id: string, args: unknown, waitMs: number): Promise<unknown>;
}

let forward: SatResearchForward | null = null;

/** A satellite's research actions go to the main window through this (null: this window runs them itself). */
export function setSatResearchForward(f: SatResearchForward | null): void {
    forward = f;
}

export function satResearchForward(): SatResearchForward | null {
    return forward;
}

// ==================== THE MAIN WINDOW'S ACTIONS ====================

/** One action a satellite may ask the main window for. */
export interface MainResearchAction<T> {
    /** The arguments as they came in a message, checked (null: malformed, the action is not run). */
    read(args: unknown): T | null;
    /** Run it; what it returns goes back to a satellite that waits for the outcome. */
    run(args: T): unknown;
}

const mainActions = new Map<string, MainResearchAction<unknown>>();

/** Register (or replace) an action the main window runs for a satellite. */
export function registerMainResearchAction<T>(id: string, action: MainResearchAction<T>): void {
    mainActions.set(id, action as MainResearchAction<unknown>);
}

/** Forget every registered action (a test's fresh start). */
export function clearMainResearchActions(): void {
    mainActions.clear();
}

/**
 * A satellite's action in the main window: one of the registry with valid
 * arguments is run (its outcome returned); an unknown id is left to the
 * other handlers (`handled: false`); a known id with malformed arguments is
 * not run (`handled: true`, no result).
 */
export function runMainResearchAction(id: unknown, args: unknown): { handled: boolean; result?: unknown } {
    if (typeof id !== 'string') return { handled: false };
    const action = mainActions.get(id);
    if (!action) return { handled: false };
    const read = action.read(args);
    if (read === null) return { handled: true };
    return { handled: true, result: action.run(read) };
}

// ==================== ARGUMENTS ====================

/** The plain object of a message's arguments (anything else: null). */
export function argsObject(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** "Places" opened in the main window (the map's "Look up in the research" of a satellite). */
export const PLACES_OPEN_ACTION = 'places-open';

export interface PlacesOpenArgs {
    /**
     * Which places the dialog lists, as the main window has them ('view': its own view). A satellite sends
     * 'tree' for its selection or its view, which the main window does not have.
     */
    scope: 'tree' | 'view';
    /** Open with the "No location" chip on. */
    unplaced: boolean;
    /** The preview of "Look up all" / "Check all" opened at once. */
    bulk?: 'look' | 'check';
}

const PLACES_OPEN_KEYS = new Set(['scope', 'unplaced', 'bulk']);

/** `places-open`'s arguments as they came (null: malformed). */
export function readPlacesOpenArgs(raw: unknown): PlacesOpenArgs | null {
    const a = argsObject(raw);
    if (!a) return null;
    if (Object.keys(a).some(k => !PLACES_OPEN_KEYS.has(k))) return null;
    if (a.scope !== 'tree' && a.scope !== 'view') return null;
    if (typeof a.unplaced !== 'boolean') return null;
    if (a.bulk !== undefined && a.bulk !== 'look' && a.bulk !== 'check') return null;
    return { scope: a.scope, unplaced: a.unplaced, ...(a.bulk ? { bulk: a.bulk } : {}) };
}
