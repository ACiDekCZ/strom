/**
 * What a new window of a view takes over from the main window (spec 079 §1
 * "What is carried over"; the Table's own state is table-ui's):
 *
 * - always: the person in the centre (the focus), the person selected and the
 *   generations shown up and down (the persons of the family layout: what the
 *   timeline lists and the map's "this view" shows);
 * - Family and Descendants: the zoom and the point in the middle of the view
 *   (the satellite's view is smaller: the same point stands in its middle);
 *   Descendants also "whole families";
 * - Fan: its rings, the descendants' rings of the two-way shape, the shape
 *   and the colours;
 * - Timeline: no range of its own (the years follow the persons shown);
 * - Map: what it shows (this view / the whole tree), its centre and zoom, the
 *   kinds of places on and the time layer (on, its year).
 *
 * Sent as `init` after the satellite's hello, never in the address. Applied
 * once, at the first tree of the window; after that the window has its own
 * state. Pure: the app's getters and setters come in (window-start.ts).
 */

import type { PersonId } from '../types.js';
import type { SatelliteKind } from './window-role.js';

/** The views whose state is carried here (the Table's is table-ui's). */
export type GraphWindowView = 'family' | 'descendants' | 'timeline' | 'fan' | 'map';

export const GRAPH_WINDOW_VIEWS: readonly GraphWindowView[] = ['family', 'descendants', 'timeline', 'fan', 'map'];

/** Zoom and the world point in the middle of the chart's view. */
export interface ChartZoom {
    scale: number;
    x: number;
    y: number;
}

interface ViewStateBase {
    /** The person in the centre (null: the tree's default person). */
    focus: PersonId | null;
    /** The person selected in the main window (its ring here when it is not the focus). */
    selected: PersonId | null;
    depthUp: number;
    depthDown: number;
}

export interface ChartWindowState extends ViewStateBase {
    view: 'family' | 'descendants';
    zoom: ChartZoom | null;
    /** Descendants: whole families (the badge's toggle as it stands). */
    fullFamilies: boolean;
}

export interface FanWindowState extends ViewStateBase {
    view: 'fan';
    generations: number;
    descGenerations: number;
    shape: string;
    colorMode: string;
}

export interface TimelineWindowState extends ViewStateBase {
    view: 'timeline';
}

export interface MapWindowState extends ViewStateBase {
    view: 'map';
    scope: 'view' | 'tree';
    /** null: not framed yet (the window frames the places itself). */
    center: { lat: number; lon: number } | null;
    zoom: number;
    kinds: string[];
    time: { on: boolean; year: number };
}

/** The starting state of a new window of a view (one type for every view but the Table). */
export type ViewWindowState = ChartWindowState | FanWindowState | TimelineWindowState | MapWindowState;

/** What the main window's state is read from. */
export interface ViewStateSource {
    viewMode(): string;
    focus(): PersonId | null;
    /** The person of the Table's active row (the Table shown), else null. */
    tableFocus(): PersonId | null;
    /** The person another window selected (its ring here), else null. */
    windowSelected(): PersonId | null;
    depthUp(): number;
    depthDown(): number;
    /** The chart's zoom, only while Family or Descendants is shown (another view's frame is not theirs). */
    chartZoom(): ChartZoom | null;
    fullFamilies(): boolean;
    fan(): { generations: number; descGenerations: number; shape: string; colorMode: string };
    map(): { scope: 'view' | 'tree'; center: { lat: number; lon: number } | null; zoom: number; kinds: string[]; time: { on: boolean; year: number } };
}

/** What a satellite applies the state to. */
export interface ViewStateTarget {
    /** The person exists in the window's tree. */
    hasPerson(id: PersonId): boolean;
    setFocus(id: PersonId, depthUp: number, depthDown: number): void;
    setWindowSelected(id: PersonId): void;
    setFullFamilies(on: boolean): void;
    setFan(fan: { generations: number; descGenerations: number; shape: string; colorMode: string }): void;
    setMap(map: Omit<MapWindowState, keyof ViewStateBase | 'view'>): void;
    /** After the first drawing: the chart's zoom and middle. */
    restoreZoom(zoom: ChartZoom): void;
    /** After the first drawing without a zoom to restore: the view's own centring. */
    centerView(): void;
}

export function isGraphWindowView(kind: SatelliteKind | string): kind is GraphWindowView {
    return (GRAPH_WINDOW_VIEWS as readonly string[]).includes(kind);
}

/** The main window's state for a new window of `kind` (undefined for the Table and the overview). */
export function captureViewState(kind: SatelliteKind, src: ViewStateSource): ViewWindowState | undefined {
    if (!isGraphWindowView(kind)) return undefined;
    const fromTable = src.viewMode() === 'table' ? src.tableFocus() : null;
    const focus = fromTable ?? src.focus();
    const base: ViewStateBase = {
        focus,
        selected: src.windowSelected() ?? focus,
        depthUp: src.depthUp(),
        depthDown: src.depthDown(),
    };
    switch (kind) {
        case 'family':
        case 'descendants': {
            // The zoom of the view shown, only for the same view (the two charts lay out differently).
            const zoom = src.viewMode() === kind && !fromTable ? src.chartZoom() : null;
            return { ...base, view: kind, zoom, fullFamilies: src.fullFamilies() };
        }
        case 'fan':
            return { ...base, view: 'fan', ...src.fan() };
        case 'timeline':
            return { ...base, view: 'timeline' };
        case 'map': {
            const m = src.map();
            return { ...base, view: 'map', scope: m.scope, center: m.center ? { ...m.center } : null, zoom: m.zoom, kinds: [...m.kinds], time: { ...m.time } };
        }
    }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const idOrNull = (v: unknown): PersonId | null => (typeof v === 'string' && v ? v as PersonId : null);

/**
 * The state as it came over the channel, checked: null when it is not one
 * for `kind` (another version, a broken message) — the window then opens as
 * it would on its own.
 */
export function parseViewState(kind: SatelliteKind, raw: unknown): ViewWindowState | null {
    if (!isGraphWindowView(kind) || !isObj(raw) || raw.view !== kind) return null;
    if (!num(raw.depthUp) || !num(raw.depthDown)) return null;
    const base: ViewStateBase = {
        focus: idOrNull(raw.focus),
        selected: idOrNull(raw.selected),
        depthUp: Math.max(0, Math.floor(raw.depthUp)),
        depthDown: Math.max(0, Math.floor(raw.depthDown)),
    };
    switch (kind) {
        case 'family':
        case 'descendants': {
            const z = raw.zoom;
            const zoom = isObj(z) && num(z.scale) && z.scale > 0 && num(z.x) && num(z.y) ? { scale: z.scale, x: z.x, y: z.y } : null;
            return { ...base, view: kind, zoom, fullFamilies: raw.fullFamilies === true };
        }
        case 'fan':
            if (!num(raw.generations) || !num(raw.descGenerations) || typeof raw.shape !== 'string' || typeof raw.colorMode !== 'string') return null;
            return { ...base, view: 'fan', generations: raw.generations, descGenerations: raw.descGenerations, shape: raw.shape, colorMode: raw.colorMode };
        case 'timeline':
            return { ...base, view: 'timeline' };
        case 'map': {
            const c = raw.center;
            const center = isObj(c) && num(c.lat) && num(c.lon) ? { lat: c.lat, lon: c.lon } : null;
            const t = raw.time;
            const time = isObj(t) && typeof t.on === 'boolean' && num(t.year) ? { on: t.on, year: t.year } : { on: false, year: 0 };
            const kinds = Array.isArray(raw.kinds) ? raw.kinds.filter((k): k is string => typeof k === 'string') : [];
            if (!num(raw.zoom)) return null;
            return { ...base, view: 'map', scope: raw.scope === 'tree' ? 'tree' : 'view', center, zoom: raw.zoom, kinds, time };
        }
    }
}

/**
 * Before the first drawing of the window's tree (the tree's default person
 * already chosen): the focus and its generations, the selection, the view's
 * own settings. A person the tree does not have leaves the default person.
 */
export function applyViewStateBeforeDraw(state: ViewWindowState, target: ViewStateTarget): void {
    if (state.focus && target.hasPerson(state.focus)) target.setFocus(state.focus, state.depthUp, state.depthDown);
    if (state.selected && state.selected !== state.focus && target.hasPerson(state.selected)) target.setWindowSelected(state.selected);
    switch (state.view) {
        case 'family':
            break;
        case 'descendants':
            target.setFullFamilies(state.fullFamilies);
            break;
        case 'fan':
            target.setFan({ generations: state.generations, descGenerations: state.descGenerations, shape: state.shape, colorMode: state.colorMode });
            break;
        case 'timeline':
            break;
        case 'map':
            target.setMap({ scope: state.scope, center: state.center, zoom: state.zoom, kinds: state.kinds, time: state.time });
            break;
    }
}

/**
 * After the first drawing: Family and Descendants take the zoom and the
 * middle of the main window's view (or centre as they would on their own);
 * the other views frame themselves while drawing (the map from its centre).
 */
export function applyViewStateAfterDraw(state: ViewWindowState | null, view: string, target: ViewStateTarget): void {
    if (view !== 'family' && view !== 'descendants') return;
    if (state && (state.view === 'family' || state.view === 'descendants') && state.zoom) target.restoreZoom(state.zoom);
    else target.centerView();
}

// ---- a satellite's own state over its reload, and its start without one ----

/**
 * sessionStorage key of a satellite's own state (§1, its reload): written
 * when the page goes (F5, closed), read at its next start. sessionStorage is
 * the window's own; nothing goes to localStorage or IndexedDB.
 */
export function windowStateKey(windowId: string): string {
    return `strom.win.state.${windowId}`;
}

/** What a satellite keeps of itself over its reload: its tree, its view and the view's state. */
export interface StoredWindowState {
    tree: string;
    kind: SatelliteKind;
    state: unknown;
}

/** The record written for the window's reload (null: nothing to keep: no tree, no state). */
export function storedWindowStateJson(tree: string | null, kind: SatelliteKind, state: unknown): string | null {
    if (!tree || state === undefined || state === null) return null;
    const rec: StoredWindowState = { tree, kind, state };
    return JSON.stringify(rec);
}

/**
 * The state the window kept for itself, when it is one of `kind` (the view
 * shown before the reload is the address's) for the tree `tree`; else null.
 */
export function readStoredWindowState(raw: string | null, kind: SatelliteKind): StoredWindowState | null {
    if (!raw) return null;
    let rec: unknown;
    try { rec = JSON.parse(raw); } catch { return null; }
    if (!isObj(rec) || typeof rec.tree !== 'string' || !rec.tree || rec.kind !== kind || rec.state === undefined || rec.state === null) return null;
    return { tree: rec.tree, kind, state: rec.state };
}

/** The main window's person in the centre, sent with its tree (a window without a state of its own starts there). */
export interface MainFocus {
    personId: PersonId;
    depthUp: number;
    depthDown: number;
}

/** The main window's person as it came over the channel (null: none, or not one). */
export function parseMainFocus(raw: unknown): MainFocus | null {
    if (!isObj(raw)) return null;
    const personId = idOrNull(raw.personId);
    if (!personId || !num(raw.depthUp) || !num(raw.depthDown)) return null;
    return { personId, depthUp: Math.max(0, Math.floor(raw.depthUp)), depthDown: Math.max(0, Math.floor(raw.depthDown)) };
}

/**
 * How a satellite starts a tree (the first one, a reload, another tree from
 * the main window): with its state (from the main window's `init` or kept
 * over its reload) when its person is still in the tree; a state whose person
 * is gone counts as none. Without a person of the state, the main window's
 * person, when the tree has it. Neither: the tree's default person, as the
 * main window chooses it (`focus` null, nothing to apply) — never a start
 * that would draw the first person's whole family for want of a state.
 */
export function chooseWindowStart(
    state: ViewWindowState | null,
    mainFocus: MainFocus | null,
    hasPerson: (id: PersonId) => boolean,
): { state: ViewWindowState | null; focus: MainFocus | null } {
    const usable = state && (!state.focus || hasPerson(state.focus)) ? state : null;
    if (usable?.focus) return { state: usable, focus: null };
    const focus = mainFocus && hasPerson(mainFocus.personId) ? mainFocus : null;
    return { state: usable, focus };
}
