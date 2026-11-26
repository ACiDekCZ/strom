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

import type { PlaceCheckFlag, PlacesIdentifyBody } from '../places-bridge.js';
import { researchLinkActionOf } from '../research-link.js';
import { isBridgelessWindow } from '../research-device.js';

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

/**
 * The forward of a satellite (no bridge of its own) whose main window answers now: what the research shows
 * there (a card's signal, "What the research knows") opens in the main window. Null in the main window, the
 * overview window, or with the main window closed: the window runs it itself, as before.
 */
export function satMainForward(): SatResearchForward | null {
    return isBridgelessWindow() && forward?.mainOpen() ? forward : null;
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

/** The places' steps of a satellite (Look up, Check, Remove from the queue): written through the main window's bridge. */
export const PLACES_QUEUE_ACTION = 'places-queue';
/** The research's places read through the main window's bridge (their states on a satellite's map, Places, person card). */
export const PLACES_LIVE_ACTION = 'places-live';
/** Houses opened in the main window (a satellite's "Houses of the town ›" with the research's part there). */
export const HOUSES_OPEN_ACTION = 'houses-open';

/** `places-queue`: the step as the satellite would have written it to the bridge. */
export interface PlacesQueueArgs {
    body: PlacesIdentifyBody;
}

const PLACE_CHECK_FLAGS: readonly PlaceCheckFlag[] = ['far', 'district', 'label', 'choices'];
/** At most this many texts in one step (the research takes 5000), each this long at most. */
const MAX_ITEMS = 5000;
const MAX_TEXT = 500;

/** A list of texts as a step names them (null: not one). */
function texts(v: unknown): string[] | null {
    if (!Array.isArray(v) || v.length > MAX_ITEMS) return null;
    return v.every(x => typeof x === 'string' && x.length > 0 && x.length <= MAX_TEXT) ? [...v as string[]] : null;
}

/** `places-queue`'s arguments as they came (null: malformed; the bridge's own reading checks the items again). */
export function readPlacesQueueArgs(raw: unknown): PlacesQueueArgs | null {
    const a = argsObject(raw);
    if (!a || Object.keys(a).some(k => k !== 'body')) return null;
    const b = argsObject(a.body);
    if (!b) return null;
    const queue = b.do === 'queue';
    if (!queue && b.do !== 'cancel') return null;
    const keys = queue ? ['do', 'forms', 'places', 'all', 'check', 'flags'] : ['do', 'forms', 'places', 'all'];
    if (Object.keys(b).some(k => !keys.includes(k))) return null;
    const forms = b.forms === undefined ? undefined : texts(b.forms);
    const places = b.places === undefined ? undefined : texts(b.places);
    if (forms === null || places === null) return null;
    if (b.all !== undefined && (queue ? b.all !== 'offmap' && b.all !== 'placed' : b.all !== 'queued')) return null;
    if (!forms?.length && !places?.length && b.all === undefined) return null;
    const lists = { ...(forms ? { forms } : {}), ...(places ? { places } : {}) };
    if (!queue) return { body: { do: 'cancel', ...lists, ...(b.all === 'queued' ? { all: 'queued' as const } : {}) } };
    if (b.check !== undefined && typeof b.check !== 'boolean') return null;
    let flags: Record<string, PlaceCheckFlag> | undefined;
    if (b.flags !== undefined) {
        const f = argsObject(b.flags);
        if (!f || Object.keys(f).length > MAX_ITEMS) return null;
        flags = {};
        for (const [form, flag] of Object.entries(f)) {
            if (form.length > MAX_TEXT || !PLACE_CHECK_FLAGS.includes(flag as PlaceCheckFlag)) return null;
            flags[form] = flag as PlaceCheckFlag;
        }
    }
    return {
        body: {
            do: 'queue', ...lists,
            ...(b.all === 'offmap' || b.all === 'placed' ? { all: b.all } : {}),
            ...(b.check ? { check: true } : {}),
            ...(flags ? { flags } : {}),
        },
    };
}

/** `places-live`: the state the satellite read last (`rev`), so an unchanged reply stays small. */
export interface PlacesLiveArgs {
    rev?: string;
}

/** `places-live`'s arguments as they came (null: malformed). */
export function readPlacesLiveArgs(raw: unknown): PlacesLiveArgs | null {
    const a = argsObject(raw);
    if (!a || Object.keys(a).some(k => k !== 'rev')) return null;
    if (a.rev !== undefined && (typeof a.rev !== 'string' || a.rev.length > 200)) return null;
    return typeof a.rev === 'string' && a.rev ? { rev: a.rev } : {};
}

/** `houses-open`: the town the window shows (its key or its name), a house's row open. */
export interface HousesOpenArgs {
    town: string;
    house?: string;
}

/** `houses-open`'s arguments as they came (null: malformed). */
export function readHousesOpenArgs(raw: unknown): HousesOpenArgs | null {
    const a = argsObject(raw);
    if (!a || Object.keys(a).some(k => k !== 'town' && k !== 'house')) return null;
    if (typeof a.town !== 'string' || !a.town.trim() || a.town.length > MAX_TEXT) return null;
    if (a.house !== undefined && (typeof a.house !== 'string' || !a.house || a.house.length > MAX_TEXT)) return null;
    return { town: a.town, ...(typeof a.house === 'string' ? { house: a.house } : {}) };
}

/** A card's research signal opened in the main window (a satellite's card "!", its person menu's signal rows). */
export const CARD_SIGNAL_ACTION = 'card-signal';

/**
 * What a card's signal opens: `waiting` its answer (or the person's items of "Awaiting action"),
 * `waiting-list` the person's items lit (touch), `story-compare` the story's new version (else
 * "Awaiting action"), `conflict` / `question` "What the research knows" at the first open conflict / the question.
 */
export type CardSignalKind = 'waiting' | 'waiting-list' | 'story-compare' | 'conflict' | 'question';

const CARD_SIGNALS: readonly CardSignalKind[] = ['waiting', 'waiting-list', 'story-compare', 'conflict', 'question'];

export interface CardSignalArgs {
    personId: string;
    signal: CardSignalKind;
}

/** A person's id as a message names it (the app's ids are short). */
const personIdOf = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** `card-signal`'s arguments as they came (null: malformed). */
export function readCardSignalArgs(raw: unknown): CardSignalArgs | null {
    const a = argsObject(raw);
    if (!a || Object.keys(a).some(k => k !== 'personId' && k !== 'signal')) return null;
    if (!personIdOf(a.personId) || !CARD_SIGNALS.includes(a.signal as CardSignalKind)) return null;
    return { personId: a.personId, signal: a.signal as CardSignalKind };
}

/** How "What the research knows" opens (person-research-ui.ts). */
export interface PersonResearchOpen {
    edge?: boolean;
    hypo?: { id: string; variant?: string };
    conflict?: string;
    questions?: boolean;
}

/**
 * "What the research knows" of a satellite's person as the main window's `person-research` takes it (the
 * overview window's action): the person, the conflict or hypothesis it opens at, its variant, the research
 * edges' section, the question.
 */
export function personResearchArgs(personId: string, opts: PersonResearchOpen): Record<string, unknown> {
    return {
        personId,
        ...(opts.conflict ? { conflict: opts.conflict } : {}),
        ...(opts.hypo?.id ? { hypo: opts.hypo.id, ...(opts.hypo.variant ? { variant: opts.hypo.variant } : {}) } : {}),
        ...(opts.edge ? { edge: true } : {}),
        ...(opts.questions ? { questions: true } : {}),
    };
}

/** A research link the main window can build again for its tree (`research-link`): what the satellite's link asks. */
export interface RelayedResearchLink {
    link: 'places' | 'fixes';
    params: Record<string, string>;
}

/**
 * The places' links of a satellite (Run now, Fix in the research) as the main window's `research-link` takes
 * them: the action and its parameters, never the address itself (null: not one of these links).
 */
export function relayedPlacesLink(url: string): RelayedResearchLink | null {
    const r = researchLinkActionOf(url);
    if (!r || r.link !== 'places' && r.link !== 'fixes') return null;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.params)) if (typeof v === 'string') params[k] = v;
    return { link: r.link, params };
}
