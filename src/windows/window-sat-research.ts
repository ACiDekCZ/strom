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
import type { FactConfirmErrorCode, FactConfirmResult } from '../research-verify.js';
import type { RevertResult } from '../research-revert.js';
import { researchLinkActionOf } from '../research-link.js';
import { isBridgelessWindow } from '../research-device.js';
import { HISTORY_PLACE_ID_RE, HISTORY_REGION_RE, sanitizeHideQueue, type HistoryHideOp } from '../history.js';
import type { ExperimentSwitch, HistoryWriteError, HistoryWriteRefusal, HistoryWriteResult } from '../history-bridge.js';
import type { ManageTab } from '../history-manage.js';

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

/** "Verify facts" of a satellite's person (the card's tip, its menu, a fact's tip): the main window's preview. */
export const VERIFY_PERSON_ACTION = 'verify-person';

export interface VerifyPersonArgs {
    personId: string;
    /** "Verify first": the waiting facts' tasks moved to the head of the queue. */
    prioritize?: boolean;
}

/** `verify-person`'s arguments as they came (null: malformed). */
export function readVerifyPersonArgs(raw: unknown): VerifyPersonArgs | null {
    const a = argsObject(raw);
    if (!a || Object.keys(a).some(k => k !== 'personId' && k !== 'prioritize')) return null;
    if (!personIdOf(a.personId)) return null;
    if (a.prioritize !== undefined && typeof a.prioritize !== 'boolean') return null;
    return { personId: a.personId, ...(a.prioritize ? { prioritize: true } : {}) };
}

/** "Confirm against the scan" (or its Undo) of a satellite's fact: written through the main window's bridge. */
export const FACT_CONFIRM_ACTION = 'fact-confirm';

export interface FactConfirmArgs {
    /** The research's id of the fact. */
    eid: string;
    confirm: boolean;
    /** The research's mark of the value shown ('changed': the value is not the one the mark stands for). */
    txt?: string;
}

/** `fact-confirm`'s arguments as they came (null: malformed). */
export function readFactConfirmArgs(raw: unknown): FactConfirmArgs | null {
    const a = argsObject(raw);
    if (!a || Object.keys(a).some(k => k !== 'eid' && k !== 'confirm' && k !== 'txt')) return null;
    if (typeof a.eid !== 'string' || !a.eid || a.eid.length > MAX_TEXT || typeof a.confirm !== 'boolean') return null;
    if (a.txt !== undefined && (typeof a.txt !== 'string' || !a.txt || a.txt.length > MAX_TEXT)) return null;
    return { eid: a.eid, confirm: a.confirm, ...(typeof a.txt === 'string' ? { txt: a.txt } : {}) };
}

const CONFIRM_CODES: readonly FactConfirmErrorCode[] = [
    'factconfirm.invalid', 'factconfirm.unknown', 'factconfirm.retracted', 'factconfirm.merged', 'confirm.changed',
    'busy', 'locked', 'network', 'invalid', 'unsupported', 'unknown',
];

const textOf = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT;

/** The main window's answer to `fact-confirm` as it came (null: none, or not one). */
export function readFactConfirmResult(raw: unknown): FactConfirmResult | null {
    const r = argsObject(raw);
    if (!r) return null;
    if (r.ok === true) {
        if (!textOf(r.fact) || !textOf(r.owner) || !textOf(r.head)) return null;
        if (r.confirmed !== undefined && !textOf(r.confirmed)) return null;
        if (r.parent !== undefined && !textOf(r.parent)) return null;
        return {
            ok: true, fact: r.fact, owner: r.owner, head: r.head,
            ...(typeof r.confirmed === 'string' ? { confirmed: r.confirmed } : {}), ...(typeof r.parent === 'string' ? { parent: r.parent } : {}),
        };
    }
    if (r.ok !== false || !CONFIRM_CODES.includes(r.code as FactConfirmErrorCode)) return null;
    if (typeof r.status !== 'number' || !textOf(r.reason)) return null;
    return { ok: false, code: r.code as FactConfirmErrorCode, status: r.status, reason: r.reason };
}

/** Revert of a satellite's fact (the family tree's value put back): through the main window's bridge. */
export const FACT_REVERT_ACTION = 'fact-revert';

export interface FactRevertArgs {
    personId: string;
    /** The fact's key (name, sex, birth, death, event:<id>); its earlier value is read in the main window. */
    fact: string;
}

/** `fact-revert`'s arguments as they came (null: malformed). */
export function readFactRevertArgs(raw: unknown): FactRevertArgs | null {
    const a = argsObject(raw);
    if (!a || Object.keys(a).some(k => k !== 'personId' && k !== 'fact')) return null;
    if (!personIdOf(a.personId) || typeof a.fact !== 'string' || !a.fact || a.fact.length > 200) return null;
    return { personId: a.personId, fact: a.fact };
}

/** The main window's answer to `fact-revert` as it came (null: none, or not one). */
export function readRevertResult(raw: unknown): (RevertResult & { loaded?: 'quiet' | 'later' }) | null {
    const r = argsObject(raw);
    if (!r) return null;
    if (r.loaded !== undefined && r.loaded !== 'quiet' && r.loaded !== 'later') return null;
    const loaded: { loaded?: 'quiet' | 'later' } = r.loaded === 'quiet' || r.loaded === 'later' ? { loaded: r.loaded } : {};
    const reason = textOf(r.reason) ? r.reason : '';
    switch (r.kind) {
        case 'ok':
            return textOf(r.head) && textOf(r.parent) ? { kind: 'ok', head: r.head, parent: r.parent, ...loaded } : null;
        case 'nothing':
            return { kind: 'nothing', reason, ...loaded };
        case 'unknown':
            return { kind: 'unknown', reason };
        case 'busy':
            return { kind: 'busy', reason, ...(typeof r.retryAfter === 'number' ? { retryAfter: r.retryAfter } : {}) };
        case 'writeHeld':
            // What holds writing as the main window read it: the other computer's name is what the row says.
            if (r.computer !== undefined && !textOf(r.computer)) return null;
            return { kind: 'writeHeld', reason, ...(typeof r.computer === 'string' && r.computer ? { computer: r.computer } : {}) };
        case 'noBridge':
            return { kind: 'noBridge' };
        case 'error':
            return { kind: 'error', status: typeof r.status === 'number' ? r.status : 0, code: textOf(r.code) ? r.code : '', reason };
        default:
            return null;
    }
}

/** A hiding (or its undo) of a satellite's history: queued and sent by the main window, which holds the bridge and the queue. */
export const HISTORY_HIDE_ACTION = 'history-hide';

/** `history-hide`'s arguments as they came: the one hiding, read as the device's queue reads its entries (null: malformed). */
export function readHistoryHideArgs(raw: unknown): { op: HistoryHideOp } | null {
    const a = argsObject(raw);
    if (!a || Object.keys(a).some(k => k !== 'op')) return null;
    const op = sanitizeHideQueue([a.op])[0];
    return op ? { op } : null;
}

/** A step of a satellite's history layer that the main window takes: its dialog opened there, or a write through its bridge. */
export const HISTORY_STEP_ACTION = 'history-step';

/**
 * - `manage`: "History of places" in the main window (its tab, a place's row, a region's detail);
 * - `align`: "Align history with the settings…" in the main window;
 * - `first` / `search-again`: a region's "Find first" / "Search again" of the card, written through the main window's bridge;
 * - `place`: a place's own history asked (its record), through the main window's bridge;
 * - `off`: the search switched off for the tree (both, or one of `experiments.split`), through the main window's bridge.
 */
export type HistoryStep =
    | { step: 'manage'; tab?: ManageTab; place?: string; region?: string }
    | { step: 'align' }
    | { step: 'first' | 'search-again'; region: string }
    | { step: 'place'; place: string }
    | { step: 'off'; which: ExperimentSwitch };

/** The steps that write (the satellite waits for the bridge's answer). */
export type HistoryWriteStep = Extract<HistoryStep, { step: 'first' | 'search-again' | 'place' | 'off' }>;

const MANAGE_TABS: readonly ManageTab[] = ['regions', 'places', 'hidden', 'deleted'];
const EXPERIMENT_SWITCHES: readonly ExperimentSwitch[] = ['history', 'regions', 'places'];

/** `history-step`'s arguments as they came (null: malformed). */
export function readHistoryStepArgs(raw: unknown): HistoryStep | null {
    const a = argsObject(raw);
    if (!a) return null;
    const only = (...keys: string[]): boolean => Object.keys(a).every(k => k === 'step' || keys.includes(k));
    switch (a.step) {
        case 'manage': {
            if (!only('tab', 'place', 'region')) return null;
            if (a.tab !== undefined && !MANAGE_TABS.includes(a.tab as ManageTab)) return null;
            if (a.place !== undefined && (typeof a.place !== 'string' || !a.place || a.place.length > MAX_TEXT)) return null;
            if (a.region !== undefined && (typeof a.region !== 'string' || !HISTORY_REGION_RE.test(a.region))) return null;
            return {
                step: 'manage',
                ...(a.tab ? { tab: a.tab as ManageTab } : {}),
                ...(typeof a.place === 'string' ? { place: a.place } : {}),
                ...(typeof a.region === 'string' ? { region: a.region } : {}),
            };
        }
        case 'align':
            return only() ? { step: 'align' } : null;
        case 'first':
        case 'search-again':
            if (!only('region') || typeof a.region !== 'string' || !HISTORY_REGION_RE.test(a.region)) return null;
            return { step: a.step, region: a.region };
        case 'place':
            if (!only('place') || typeof a.place !== 'string' || !HISTORY_PLACE_ID_RE.test(a.place)) return null;
            return { step: 'place', place: a.place };
        case 'off':
            if (!only('which') || !EXPERIMENT_SWITCHES.includes(a.which as ExperimentSwitch)) return null;
            return { step: 'off', which: a.which as ExperimentSwitch };
        default:
            return null;
    }
}

const HISTORY_WRITE_CODES: readonly HistoryWriteError[] = [
    'invalid', 'gone', 'off', 'archive', 'done', 'retracted', 'skipped', 'link', 'held', 'busy', 'network', 'timeout', 'unknown',
];

/** No answer from the main window (or from the bridge it writes to). */
export const HISTORY_NO_ANSWER: HistoryWriteRefusal = { ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' };

/**
 * The main window's answer to a history write as it came: done (its new head), or the refusal with the bridge's
 * sentence (what holds writing already put into words there) and a link only when it is one of the research's
 * own links the app builds. Anything else: no answer.
 */
export function readHistoryWriteResult(raw: unknown): HistoryWriteResult {
    const r = argsObject(raw);
    if (!r) return HISTORY_NO_ANSWER;
    if (r.ok === true) return textOf(r.head) && textOf(r.parent) ? { ok: true, head: r.head, parent: r.parent } : HISTORY_NO_ANSWER;
    if (r.ok !== false || !HISTORY_WRITE_CODES.includes(r.code as HistoryWriteError)) return HISTORY_NO_ANSWER;
    if (typeof r.status !== 'number' || !textOf(r.reason)) return HISTORY_NO_ANSWER;
    const link = typeof r.link === 'string' && r.link.length <= 2000 && researchLinkActionOf(r.link) ? r.link : '';
    return {
        ok: false, code: r.code as HistoryWriteError, status: r.status, reason: r.reason,
        bridgeCode: textOf(r.bridgeCode) ? r.bridgeCode : '', ...(link ? { link } : {}),
    };
}
