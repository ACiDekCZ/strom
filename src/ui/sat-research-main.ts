/**
 * The research actions a satellite window asks the main window for, as the
 * main window runs them (src/windows/window-sat-research.ts holds the
 * registry and the arguments' reading). Registered once when the main window
 * starts (src/windows/window-start.ts); each runs the main window's own
 * function, as its own button would.
 */

import {
    HOUSES_OPEN_ACTION, PLACES_LIVE_ACTION, PLACES_OPEN_ACTION, PLACES_QUEUE_ACTION,
    readHousesOpenArgs, readPlacesLiveArgs, readPlacesOpenArgs, readPlacesQueueArgs, registerMainResearchAction,
} from '../windows/window-sat-research.js';
import type { PlacesIdentifyBody, PlacesIdentifyResult, PlacesReadResult } from '../places-bridge.js';
import type { MapScope } from './map-ui.js';

/** What the actions need of the app (the UI in the app, fakes in a test). */
export interface SatResearchMainDeps {
    showPlacesManager(focusKey?: string, parentDialogId?: string, scope?: MapScope, opts?: { unplaced?: boolean }): void;
    openPlacesBulk(kind: 'look' | 'check'): void;
    /** A place step written through this window's bridge (null: no bridge here). */
    placesIdentifyHere(body: PlacesIdentifyBody): Promise<PlacesIdentifyResult | null>;
    /** The research's places read through this window's bridge (null: no bridge here). */
    placesLiveHere(rev?: string): Promise<PlacesReadResult | null>;
    showHousesWindow(opts: { town?: string; house?: string }): void;
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
    // A place step of a satellite (Look up, Check, Remove from the queue): written through this window's bridge,
    // the bridge's reply back to the satellite, which says it as this window would.
    registerMainResearchAction(PLACES_QUEUE_ACTION, {
        read: readPlacesQueueArgs,
        run: (a) => ui.placesIdentifyHere(a.body),
    });
    // The research's places for a satellite's map, Places and person card (their states).
    registerMainResearchAction(PLACES_LIVE_ACTION, {
        read: readPlacesLiveArgs,
        run: (a) => ui.placesLiveHere(a.rev),
    });
    // "Houses of the town ›" of a satellite: the Houses window here, with the research's part (this window's bridge).
    registerMainResearchAction(HOUSES_OPEN_ACTION, {
        read: readHousesOpenArgs,
        run: (a) => {
            ui.showHousesWindow({ town: a.town, ...(a.house ? { house: a.house } : {}) });
            return true;
        },
    });
}
