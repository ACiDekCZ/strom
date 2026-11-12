/**
 * The satellite window's header (spec 079 §2, mockups 2a–2f): it stands in
 * for the app's toolbar, which is not mounted here at all (no tree switcher,
 * app menu, Research, Settings, the phone's bottom bar). From the left: the
 * tree's name, the view switcher (K2: the view tabs from 960 px, below them
 * one button "{view} ▾" with a menu of the six views; it switches this
 * window only), a flexible gap, "Follow selection", a divider, Undo and Redo
 * (the main window's undo, available by its status) and ⧉ "Open another
 * window" (K2).
 */

import { strings } from '../strings.js';
import type { SatelliteKind } from './window-role.js';
import { satelliteKindLabel } from './window-title.js';

/** From this window width the view switcher is the view tabs; below it one button with a menu (§2 K2, 2e). */
export const SAT_SEGMENT_MIN_WIDTH = 960;

/** The views a satellite switches between, in the order of the view tabs (not the book, not the overview). */
export const SAT_VIEWS: readonly SatelliteKind[] = ['family', 'descendants', 'timeline', 'fan', 'map', 'table'];

/** What the header needs from the satellite client (SatelliteClient fits). */
export interface SatHeaderClient {
    readonly treeName: string;
    readonly hasTree: boolean;
    followSelection: boolean;
    on(event: 'status' | 'tree' | 'tree-gone' | 'renamed' | 'connection', cb: () => void): () => void;
}

export interface SatHeaderOptions {
    /** The view the window shows now. */
    kind: () => SatelliteKind;
    /** Switch this window's view (K2); absent: no switcher (the overview's window), the name says the view. */
    switchView?: (kind: SatelliteKind) => void;
    /** ⧉ "Open another window" (K2; absent: no ⧉). Called in the click's handler. */
    openAnother?: () => void;
    /** Why ⧉ cannot open a window now ('' = it can; a text = disabled, the text its tooltip). */
    anotherBlocked?: () => string;
    undo: () => void;
    redo: () => void;
    /** Undo/Redo's state and tooltips (the toolbar's own refresh, by the button ids). */
    refreshUndoRedo: () => void;
    /** "Follow selection" was switched. */
    onFollowChange?: () => void;
}

const UNDO_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
const REDO_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

/**
 * The header's name. With the view switcher (K2) the tree alone (the switcher
 * says the view); without it the tree and the view, the view alone while
 * there is no tree.
 */
export function satHeaderTitle(treeName: string, kind: SatelliteKind, withSwitcher = false): string {
    if (withSwitcher) return treeName;
    const view = satelliteKindLabel(kind);
    return treeName ? `${treeName} · ${view}` : view;
}

/**
 * Where a key moves the focus in a menu of `count` items from `at` (-1:
 * none focused): the arrows go round, Home and End to the ends; -1 for any
 * other key.
 */
export function menuKeyTarget(key: string, at: number, count: number): number {
    if (count <= 0) return -1;
    if (key === 'ArrowDown') return at < 0 ? 0 : (at + 1) % count;
    if (key === 'ArrowUp') return at < 0 ? count - 1 : (at - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return -1;
}

const ANOTHER_ICON = '<span aria-hidden="true">⧉</span>';

/**
 * Put the header in place of the toolbar: the toolbar and the bottom bar
 * leave the document (they are not part of a satellite). `refresh` writes
 * its texts again (another language, another view).
 */
export function mountSatHeader(doc: Document, client: SatHeaderClient, opts: SatHeaderOptions): { el: HTMLElement; refresh: () => void } {
    doc.querySelectorAll('body > .toolbar, #bottom-bar').forEach(el => el.remove());
    const win = doc.defaultView;

    const header = doc.createElement('header');
    header.className = 'sat-header';

    const title = doc.createElement('span');
    title.className = 'sat-header-title';

    // The view switcher (K2): the view tabs (≥ 960 px) or one button with a menu (< 960 px); CSS shows one of them.
    const switcher = opts.switchView ? createSwitcher(doc, opts.kind, opts.switchView) : null;

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

    let another: HTMLButtonElement | null = null;
    if (opts.openAnother) {
        const open = opts.openAnother;
        another = doc.createElement('button');
        another.type = 'button';
        another.className = 'sat-icon-btn sat-another';
        another.innerHTML = ANOTHER_ICON;
        another.addEventListener('click', () => { if (!(opts.anotherBlocked?.() ?? '')) open(); });
    }

    header.append(title);
    if (switcher) header.append(switcher.segment, switcher.button);
    header.append(spacer, follow, divider, undo, redo);
    if (another) header.append(another);
    doc.body.prepend(header);

    const syncTitle = (): void => {
        const text = satHeaderTitle(client.hasTree ? client.treeName : '', opts.kind(), !!switcher);
        title.textContent = text;
        title.title = text;
        title.hidden = !text;
    };
    const syncFollow = (): void => {
        const on = client.followSelection;
        follow.querySelector('.sat-follow-label')!.textContent = strings.win.followSelection;
        follow.setAttribute('aria-label', strings.win.followSelection);
        follow.setAttribute('aria-checked', on ? 'true' : 'false');
        follow.title = on ? strings.win.followSelectionOn : strings.win.followSelectionOff;
    };
    const syncAnother = (): void => {
        if (!another) return;
        const why = opts.anotherBlocked?.() ?? '';
        another.disabled = !!why;
        another.setAttribute('aria-label', strings.win.openAnother);
        another.title = why || strings.win.openAnother;
    };
    follow.addEventListener('click', () => {
        client.followSelection = !client.followSelection;
        syncFollow();
        opts.onFollowChange?.();
    });

    const sync = (): void => { syncTitle(); syncAnother(); opts.refreshUndoRedo(); };
    for (const ev of ['status', 'tree', 'tree-gone', 'renamed', 'connection'] as const) client.on(ev, sync);
    const refresh = (): void => { syncTitle(); switcher?.refresh(); syncFollow(); syncAnother(); opts.refreshUndoRedo(); };
    if (win && switcher) win.addEventListener('resize', () => switcher.closeMenu(false));
    refresh();
    return { el: header, refresh };
}

interface Switcher {
    segment: HTMLElement;
    button: HTMLButtonElement;
    refresh(): void;
    closeMenu(returnFocus: boolean): void;
}

/** The view tabs and the narrow window's "{view} ▾" with its menu (§2 K2, 2d, 2e). */
function createSwitcher(doc: Document, current: () => SatelliteKind, switchView: (kind: SatelliteKind) => void): Switcher {
    const segment = doc.createElement('div');
    segment.className = 'view-mode-segment sat-view-segment';
    segment.setAttribute('role', 'group');
    const tabs = new Map<SatelliteKind, HTMLButtonElement>();
    for (const kind of SAT_VIEWS) {
        const tab = doc.createElement('button');
        tab.type = 'button';
        tab.dataset.view = kind;
        tab.addEventListener('click', () => switchView(kind));
        tabs.set(kind, tab);
        segment.appendChild(tab);
    }

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'sat-view-btn';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span class="sat-view-btn-label"></span><span class="sat-view-btn-caret" aria-hidden="true">▾</span>';

    let menu: HTMLElement | null = null;
    const items = (): HTMLElement[] => (menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')] : []);

    const onOutside = (e: Event): void => {
        const t = e.target as Node | null;
        if (menu && t && !menu.contains(t) && !button.contains(t)) closeMenu(false);
    };
    function closeMenu(returnFocus: boolean): void {
        if (!menu) return;
        menu.remove();
        menu = null;
        button.setAttribute('aria-expanded', 'false');
        button.classList.remove('is-open');
        doc.removeEventListener('pointerdown', onOutside, true);
        if (returnFocus) button.focus();
    }
    const openMenu = (focus: 'current' | 'first' | 'last'): void => {
        if (menu) return;
        const m = doc.createElement('div');
        m.className = 'view-window-menu sat-view-menu';
        m.setAttribute('role', 'menu');
        m.setAttribute('aria-label', satelliteKindLabel(current()));
        const now = current();
        for (const kind of SAT_VIEWS) {
            const item = doc.createElement('button');
            item.type = 'button';
            item.className = 'view-window-item';
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', kind === now ? 'true' : 'false');
            item.dataset.view = kind;
            const label = doc.createElement('span');
            label.className = 'view-window-item-label';
            label.textContent = satelliteKindLabel(kind);
            item.appendChild(label);
            if (kind === now) {
                const note = doc.createElement('span');
                note.className = 'view-window-item-note';
                note.textContent = strings.win.thisView;
                item.appendChild(note);
            }
            item.addEventListener('click', () => {
                closeMenu(true);
                if (kind !== current()) switchView(kind);
            });
            m.appendChild(item);
        }
        m.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeMenu(true);
                return;
            }
            if (e.key === 'Tab') { closeMenu(false); return; }
            const list = items();
            const next = menuKeyTarget(e.key, list.indexOf(doc.activeElement as HTMLElement), list.length);
            if (next < 0) return;
            e.preventDefault();
            list[next].focus();
        });
        doc.body.appendChild(m);
        const r = button.getBoundingClientRect();
        const width = 220;
        const view = doc.defaultView;
        const left = Math.max(8, Math.min(r.left, (view?.innerWidth ?? width + 16) - width - 8));
        m.style.width = `${width}px`;
        m.style.top = `${Math.round(r.bottom + 6)}px`;
        m.style.left = `${Math.round(left)}px`;
        m.style.maxHeight = `calc(100vh - ${Math.round(r.bottom + 6)}px - 12px)`;
        menu = m;
        button.setAttribute('aria-expanded', 'true');
        button.classList.add('is-open');
        doc.addEventListener('pointerdown', onOutside, true);
        const list = items();
        const at = focus === 'first' ? 0 : focus === 'last' ? list.length - 1 : Math.max(0, SAT_VIEWS.indexOf(now));
        list[at]?.focus();
    };
    button.addEventListener('click', () => { if (menu) closeMenu(false); else openMenu('current'); });
    button.addEventListener('keydown', (e) => {
        if (menu) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); openMenu('first'); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu('last'); }
    });

    const refresh = (): void => {
        const now = current();
        for (const [kind, tab] of tabs) {
            const on = kind === now;
            tab.textContent = satelliteKindLabel(kind);
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        const name = satelliteKindLabel(now);
        button.querySelector('.sat-view-btn-label')!.textContent = name;
        button.setAttribute('aria-label', name);
        if (menu) { closeMenu(false); }
    };
    return { segment, button, refresh, closeMenu };
}
