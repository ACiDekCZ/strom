/**
 * "On the map" in a satellite (spec 098 §6): the window shows no map of its
 * own for it, so the selection (a list, or the Table's selection scope) goes
 * to the main window, which takes it as its selection, shows the Map in the
 * scope Selection and comes forward. While the main window is closed the
 * action is offered disabled.
 */

/** How a satellite hands "On the map" over (none in the main window). */
export interface ShowOnMapForward {
    /** The main window answers now. */
    mainOpen(): boolean;
    /** Send the selection (an encoded SelectionRef) and ask the main window forward. */
    send(ref: string): void;
}

let forward: ShowOnMapForward | null = null;

export function setShowOnMapForward(f: ShowOnMapForward | null): void {
    forward = f;
}

/** The satellite's hand-over; null in the main window (it shows the map itself). */
export function showOnMapForward(): ShowOnMapForward | null {
    return forward;
}
