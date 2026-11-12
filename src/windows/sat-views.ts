/**
 * A satellite window's own view and its further windows (spec 079 §2 K2):
 *
 * - the view switched in the header (or by anything that switches the view
 *   here, e.g. "Show descendants" in a person's menu) is this window's: its
 *   address says it (`okno=`, a reload keeps it), the main window's list
 *   names it, the title follows; the main window's view and its settings
 *   are not touched;
 * - ⧉ "Open another window" opens a window of the same view and state from
 *   here (in this window's click). The main window lists it at its hello and
 *   hands it the state this window announced (`spawn` → `init`), so it starts
 *   as a window the main window opened would.
 */

import { UI } from '../ui.js';
import { strings } from '../strings.js';
import { TreeRenderer } from '../renderer.js';
import type { SatelliteClient } from './satellite.js';
import { newWindowId, satelliteUrl, satelliteWindowName, type SatelliteKind } from './window-role.js';
import { DEFAULT_WINDOW_SIZE, currentGeometry, placeNextTo, type ScreenGeometry } from './window-registry.js';
import { BLOCKED_TOAST_MS, MANY_TOAST_MS, MANY_WINDOWS } from './window-controls.js';
import { windowStartState } from './window-start.js';
import { SAT_VIEWS } from './sat-header.js';

/** This window's address with another view (`okno=`), everything else kept. */
export function satelliteHrefWithKind(href: string, kind: SatelliteKind): string {
    try {
        const url = new URL(href);
        url.searchParams.set('okno', kind);
        return url.toString();
    } catch {
        return href;
    }
}

/**
 * Follow this window's view: when it differs from the client's kind, the
 * kind, the address and the main window's list take it, then `changed`
 * (the header and the title). Returns the check, to run after every
 * drawing (the view may be switched from anywhere in the window).
 */
export function followSatelliteView(client: SatelliteClient, changed: (kind: SatelliteKind) => void): () => void {
    return () => {
        if (!SAT_VIEWS.includes(client.kind)) return;   // the overview's window has no views
        const view = TreeRenderer.getViewMode();
        if (view === client.kind || !SAT_VIEWS.includes(view)) return;
        client.setKind(view);
        try { history.replaceState(history.state, '', satelliteHrefWithKind(window.location.href, view)); } catch { /* the address stays */ }
        changed(view);
    };
}

/** What opening another window needs (the browser's; a test passes its own). */
export interface OpenAnotherDeps {
    open: (url: string, name: string, features: string) => Window | null;
    geometry: () => ScreenGeometry | null;
    startState: (kind: SatelliteKind) => unknown;
    newId: () => string;
}

const browserDeps: OpenAnotherDeps = {
    open: (url, name, features) => window.open(url, name, features),
    geometry: currentGeometry,
    startState: windowStartState,
    newId: newWindowId,
};

/**
 * Open a window of the same view and state from this satellite (only in a
 * click's handler: a browser blocks a window opened later). Returns the new
 * window's id, or null when the browser blocked it.
 */
export function openWindowFromSatellite(client: SatelliteClient, deps: OpenAnotherDeps = browserDeps): string | null {
    const kind = client.kind;
    const id = deps.newId();
    const state = deps.startState(kind);
    const size = DEFAULT_WINDOW_SIZE[kind];
    const others = client.status?.windows.length ?? 0;
    const g = deps.geometry();
    const place = g ? placeNextTo(size.width, size.height, g, others) : { left: 0, top: 0, ...size };
    const features = `popup,width=${place.width},height=${place.height},left=${place.left},top=${place.top}`;
    let win: Window | null = null;
    try {
        win = deps.open(satelliteUrl(kind, client.treeId ?? client.requestedTreeId, id), satelliteWindowName(id), features);
    } catch {
        win = null;
    }
    if (!win) return null;
    client.announceSpawn(id, kind, state);
    return id;
}

/**
 * ⧉ in a satellite's header: the window opens, or the browser's block is
 * said with "Try again" (a new click, a new permission; §4d); from the sixth
 * window on, that windows need memory (§4e), as in the main window.
 */
export function openAnotherWindow(client: SatelliteClient): void {
    const before = client.status?.windows.length ?? 0;
    const id = openWindowFromSatellite(client);
    if (!id) {
        UI.showToast(strings.win.blocked, BLOCKED_TOAST_MS, {
            notice: true,
            hold: true,
            kind: 'window-blocked',
            action: { label: strings.win.retry, run: () => openAnotherWindow(client) },
        });
        return;
    }
    if (before >= MANY_WINDOWS) UI.showToast(strings.win.manyWindows(before + 1), MANY_TOAST_MS, { notice: true, kind: 'window-many' });
}
