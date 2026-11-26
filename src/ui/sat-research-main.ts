/**
 * The research actions a satellite window asks the main window for, as the
 * main window runs them (src/windows/window-sat-research.ts holds the
 * registry and the arguments' reading). Registered once when the main window
 * starts (src/windows/window-start.ts); each runs the main window's own
 * function, as its own button would.
 */

import {
    CARD_SIGNAL_ACTION, FACT_CONFIRM_ACTION, FACT_REVERT_ACTION, HOUSES_OPEN_ACTION, PLACES_LIVE_ACTION, PLACES_OPEN_ACTION,
    PLACES_QUEUE_ACTION, VERIFY_PERSON_ACTION, readCardSignalArgs, readFactConfirmArgs, readFactRevertArgs, readHousesOpenArgs,
    readPlacesLiveArgs, readPlacesOpenArgs, readPlacesQueueArgs, readVerifyPersonArgs, registerMainResearchAction,
} from '../windows/window-sat-research.js';
import type { PlacesIdentifyBody, PlacesIdentifyResult, PlacesReadResult } from '../places-bridge.js';
import type { FactConfirmResult } from '../research-verify.js';
import type { RevertResult } from '../research-revert.js';
import type { LiveWaiting } from '../research-link.js';
import type { PersonId } from '../types.js';
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
    /** A card's signal as its badge here opens it (the answer, "What the research knows"). */
    openCardSignal(personId: PersonId, signal: string): void;
    personWaitingItems(personId: PersonId): LiveWaiting[];
    showPersonWaiting(items: readonly LiveWaiting[]): void;
    openWaitingStoryCompare(personId: PersonId): boolean;
    showResearchWaiting(): void;
    /** "Verify facts" of a person: the preview of what the research would verify (or "Verify first"). */
    showVerifyPersonDialog(personId: PersonId, opts?: { prioritize?: boolean }): void;
    /** A fact confirmed against the scan (or taken back) through this window's bridge (null: no bridge here). */
    factConfirmWrite(eid: string, confirm: boolean, txt: string | null): Promise<FactConfirmResult | null>;
    /** A fact's family tree value put back through this window's bridge, as its own Revert does. */
    revertFactHere(personId: PersonId, fact: string): Promise<RevertResult & { loaded?: 'quiet' | 'later' }>;
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
    // A card's signal of a satellite (its "!", the person menu's answer, "Awaiting action", the story's new
    // version, what the research knows): opened here as this window's own card opens it.
    registerMainResearchAction(CARD_SIGNAL_ACTION, {
        read: readCardSignalArgs,
        run: (a) => {
            const personId = a.personId as PersonId;
            if (a.signal === 'waiting-list') ui.showPersonWaiting(ui.personWaitingItems(personId));
            else if (a.signal === 'story-compare') {
                if (!ui.openWaitingStoryCompare(personId)) ui.showResearchWaiting();
            } else ui.openCardSignal(personId, a.signal);
            return true;
        },
    });
    // "Verify facts" of a satellite's person (its card's tip, menu, a fact's tip): this window's preview, through its bridge.
    registerMainResearchAction(VERIFY_PERSON_ACTION, {
        read: readVerifyPersonArgs,
        run: (a) => {
            ui.showVerifyPersonDialog(a.personId as PersonId, a.prioritize ? { prioritize: true } : {});
            return true;
        },
    });
    // "Confirm against the scan" or its Undo of a satellite's fact: written through this window's bridge, the
    // bridge's answer back to the satellite, whose tip says it as this window's would.
    registerMainResearchAction(FACT_CONFIRM_ACTION, {
        read: readFactConfirmArgs,
        run: (a) => ui.factConfirmWrite(a.eid, a.confirm, a.txt ?? null),
    });
    // Revert of a satellite's fact: put back through this window's bridge (the earlier value as this window's
    // tree has it), the research's version loaded here as after its own Revert; the outcome back to the satellite.
    registerMainResearchAction(FACT_REVERT_ACTION, {
        read: readFactRevertArgs,
        run: (a) => ui.revertFactHere(a.personId as PersonId, a.fact),
    });
}
