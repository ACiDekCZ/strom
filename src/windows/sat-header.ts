/**
 * The satellite window's header (spec 079 §2, mockups 2a–2f): it stands in
 * for the app's toolbar, which is not mounted here at all (no tree switcher,
 * app menu, Research, Settings, the phone's bottom bar). K1: the window's
 * name "{tree} · {view}", "Follow selection", a divider, Undo and Redo
 * (the main window's undo, available by its status).
 */

import { strings } from '../strings.js';
import type { SatelliteKind } from './window-role.js';
import { satelliteKindLabel } from './window-title.js';

/** What the header needs from the satellite client (SatelliteClient fits). */
export interface SatHeaderClient {
    readonly treeName: string;
    readonly hasTree: boolean;
    followSelection: boolean;
    on(event: 'status' | 'tree' | 'tree-gone' | 'renamed' | 'connection', cb: () => void): () => void;
}

export interface SatHeaderOptions {
    kind: SatelliteKind;
    undo: () => void;
    redo: () => void;
    /** Undo/Redo's state and tooltips (the toolbar's own refresh, by the button ids). */
    refreshUndoRedo: () => void;
    /** "Follow selection" was switched. */
    onFollowChange?: () => void;
}

const UNDO_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
const REDO_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

/** The header's name: the tree and the view; the view alone while there is no tree. */
export function satHeaderTitle(treeName: string, kind: SatelliteKind): string {
    const view = satelliteKindLabel(kind);
    return treeName ? `${treeName} · ${view}` : view;
}

/**
 * Put the header in place of the toolbar: the toolbar and the bottom bar
 * leave the document (they are not part of a satellite). `refresh` writes
 * its texts again (another language).
 */
export function mountSatHeader(doc: Document, client: SatHeaderClient, opts: SatHeaderOptions): { el: HTMLElement; refresh: () => void } {
    doc.querySelectorAll('body > .toolbar, #bottom-bar').forEach(el => el.remove());

    const header = doc.createElement('header');
    header.className = 'sat-header';

    const title = doc.createElement('span');
    title.className = 'sat-header-title';

    const spacer = doc.createElement('span');
    spacer.className = 'sat-header-spacer';

    const follow = doc.createElement('button');
    follow.type = 'button';
    follow.className = 'sat-follow';
    follow.setAttribute('role', 'switch');
    follow.innerHTML = '<span class="sat-follow-track" aria-hidden="true"><span class="sat-follow-knob"></span></span>'
        + '<span class="sat-follow-label"></span>';

    const divider = doc.createElement('span');
    divider.className = 'sat-header-divider';
    divider.setAttribute('aria-hidden', 'true');

    const undo = doc.createElement('button');
    undo.type = 'button';
    undo.id = 'toolbar-undo-btn';
    undo.className = 'sat-icon-btn';
    undo.disabled = true;
    undo.innerHTML = UNDO_ICON;
    undo.addEventListener('click', () => opts.undo());

    const redo = doc.createElement('button');
    redo.type = 'button';
    redo.id = 'toolbar-redo-btn';
    redo.className = 'sat-icon-btn';
    redo.disabled = true;
    redo.innerHTML = REDO_ICON;
    redo.addEventListener('click', () => opts.redo());

    header.append(title, spacer, follow, divider, undo, redo);
    doc.body.prepend(header);

    const syncTitle = (): void => {
        const text = satHeaderTitle(client.hasTree ? client.treeName : '', opts.kind);
        title.textContent = text;
        title.title = text;
    };
    const syncFollow = (): void => {
        const on = client.followSelection;
        follow.querySelector('.sat-follow-label')!.textContent = strings.win.followSelection;
        follow.setAttribute('aria-label', strings.win.followSelection);
        follow.setAttribute('aria-checked', on ? 'true' : 'false');
        follow.title = on ? strings.win.followSelectionOn : strings.win.followSelectionOff;
    };
    follow.addEventListener('click', () => {
        client.followSelection = !client.followSelection;
        syncFollow();
        opts.onFollowChange?.();
    });

    const sync = (): void => { syncTitle(); opts.refreshUndoRedo(); };
    for (const ev of ['status', 'tree', 'tree-gone', 'renamed', 'connection'] as const) client.on(ev, sync);
    const refresh = (): void => { syncTitle(); syncFollow(); opts.refreshUndoRedo(); };
    refresh();
    return { el: header, refresh };
}
