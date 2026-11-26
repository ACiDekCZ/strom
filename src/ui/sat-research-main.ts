/**
 * The research actions a satellite window asks the main window for, as the
 * main window runs them (src/windows/window-sat-research.ts holds the
 * registry and the arguments' reading). Registered once when the main window
 * starts (src/windows/window-start.ts); each runs the main window's own
 * function, as its own button would.
 */

import {
    PLACES_OPEN_ACTION, readPlacesOpenArgs, registerMainResearchAction,
} from '../windows/window-sat-research.js';
import type { MapScope } from './map-ui.js';

/** What the actions need of the app (the UI in the app, fakes in a test). */
export interface SatResearchMainDeps {
    showPlacesManager(focusKey?: string, parentDialogId?: string, scope?: MapScope, opts?: { unplaced?: boolean }): void;
    openPlacesBulk(kind: 'look' | 'check'): void;
}

/** Register every action a satellite may ask the main window for. */
export function registerSatelliteResearchActions(ui: SatResearchMainDeps): void {
    // "Look up in the research" of a satellite's map: Places here with the preview of looking them up.
    registerMainResearchAction(PLACES_OPEN_ACTION, {
        read: readPlacesOpenArgs,
        run: (a) => {
            ui.showPlacesManager(undefined, undefined, a.scope, { unplaced: a.unplaced });
            if (a.bulk && document.getElementById('places-modal')) ui.openPlacesBulk(a.bulk);
            return true;
        },
    });
}
