/**
 * The research actions a satellite window asks the main window for, as the
 * main window runs them (src/windows/window-sat-research.ts holds the
 * registry and the arguments' reading). Registered once when the main window
 * starts (src/windows/window-start.ts); each runs the main window's own
 * function, as its own button would.
 */

import {
    CARD_SIGNAL_ACTION, FACT_CONFIRM_ACTION, FACT_REVERT_ACTION, HISTORY_HIDE_ACTION, HISTORY_STEP_ACTION, HOUSES_OPEN_ACTION,
    PLACES_LIVE_ACTION, PLACES_OPEN_ACTION, PLACES_QUEUE_ACTION, RESEARCH_DIALOG_ACTION, VERIFY_PERSON_ACTION, readCardSignalArgs,
    readFactConfirmArgs, readFactRevertArgs, readHistoryHideArgs, readHistoryStepArgs, readHousesOpenArgs, readPlacesLiveArgs,
    readPlacesOpenArgs, readPlacesQueueArgs, readResearchDialogArgs, readVerifyPersonArgs, registerMainResearchAction,
    type HistoryWriteStep, type MaterialsGroup,
} from '../windows/window-sat-research.js';
import type { HistoryHideOp } from '../history.js';
import type { ManageTab } from '../history-manage.js';
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
    /** The page of a house of the tree (false: no such house here). */
    openHousePage(id: string): boolean;
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
    /** A hiding (or its undo) of the history: queued here, kept on the device, sent through this window's bridge. */
    applyHistoryHide(op: HistoryHideOp): Promise<void>;
    openHistoryManage(opts?: { tab?: ManageTab; place?: string; region?: string }): void;
    openHistoryAlignDialog(): void;
    /** A history write through this window's bridge, its answer as a satellite reads it. */
    historyWriteHere(step: HistoryWriteStep): Promise<unknown>;
    openMaterials(opts?: { person?: string; batch?: string; group?: MaterialsGroup; files?: string[] }): void;
    showMaterialDialog(target: { personId: PersonId } | { sourceId: string }): void;
    showReadDocumentDialog(opts?: { readId?: string; sourceId?: string; personId?: string }): void;
    showReadSourceAgain(sourceId: string, clip?: string): void;
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
    // "Houses of the town ›" of a satellite: the Houses window here, with the research's part (this window's bridge);
    // a house of it opens the house page.
    registerMainResearchAction(HOUSES_OPEN_ACTION, {
        read: readHousesOpenArgs,
        run: (a) => {
            // A house of a satellite ("House page ›", an address in a card): its page here.
            if (a.house && ui.openHousePage(a.house)) return true;
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
    // A hiding of a satellite's history: queued here with this window's own (one queue, one device copy) and sent
    // through its bridge; the satellite shows it at once by itself.
    registerMainResearchAction(HISTORY_HIDE_ACTION, {
        read: readHistoryHideArgs,
        run: (a) => {
            void ui.applyHistoryHide(a.op);
            return true;
        },
    });
    // A step of a satellite's history layer: "History of places" and the alignment open here; "Find first",
    // "Search again", a place's own history and switching the search off are written through this window's bridge,
    // the answer back to the satellite, which says it as this window would.
    registerMainResearchAction(HISTORY_STEP_ACTION, {
        read: readHistoryStepArgs,
        run: (a) => {
            if (a.step === 'manage') {
                ui.openHistoryManage({ ...(a.tab ? { tab: a.tab } : {}), ...(a.place ? { place: a.place } : {}), ...(a.region ? { region: a.region } : {}) });
                return true;
            }
            if (a.step === 'align') {
                ui.openHistoryAlignDialog();
                return true;
            }
            return ui.historyWriteHere(a);
        },
    });
    // A research dialog of a satellite that needs the bridge's address (Materials, "Send material…", a reading,
    // "Read again…"): opened here, with this window's bridge, as this window's own button opens it.
    registerMainResearchAction(RESEARCH_DIALOG_ACTION, {
        read: readResearchDialogArgs,
        run: (a) => {
            switch (a.dialog) {
                case 'materials':
                    ui.openMaterials({ ...(a.person ? { person: a.person } : {}), ...(a.batch ? { batch: a.batch } : {}), ...(a.group ? { group: a.group } : {}), ...(a.files ? { files: a.files } : {}) });
                    break;
                case 'material':
                    ui.showMaterialDialog('personId' in a ? { personId: a.personId as PersonId } : { sourceId: a.sourceId });
                    break;
                case 'read':
                    ui.showReadDocumentDialog({
                        ...(a.readId ? { readId: a.readId } : {}), ...(a.sourceId ? { sourceId: a.sourceId } : {}),
                        ...(a.personId ? { personId: a.personId } : {}),
                    });
                    break;
                case 'read-again':
                    ui.showReadSourceAgain(a.sourceId, a.clip);
                    break;
            }
            return true;
        },
    });
}
