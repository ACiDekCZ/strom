/**
 * The satellite window's header (spec 079 §2, mockups 2a–2f): it stands in
 * for the app's toolbar, which is not mounted here at all (no tree switcher,
 * app menu, Research, Settings, the phone's bottom bar). From the left: the
 * tree's name, the view switcher (K2: the view tabs from 960 px, below them
 * one button "{view} ▾" with a menu of the six views; it switches this
 * window only), a flexible gap, "Selection" (a button with a menu of what
 * another window's choice does here, K2.1: switch / mark only / off, and in
 * the Table, the Timeline and the Map what a choice here does in the main
 * window, spec 110: mark only / Focus), a divider, Undo and Redo
 * (the main window's undo, available by its status) and ⧉ "Open another
 * window" (K2).
 */

import { strings } from '../strings.js';
import type { SatelliteKind } from './window-role.js';
import { satelliteKindLabel } from './window-title.js';
import { followModesFor, sendModeAvailable, type FollowMode, type SendMode } from './follow-mode.js';
import type { MainWindowState, SatelliteConnection } from './satellite.js';
import { setSelTabLabel } from '../ui/sel-css.js';

/** From this window width the view switcher is the view tabs; below it one button with a menu (§2 K2, 2e). */
export const SAT_SEGMENT_MIN_WIDTH = 960;

/** The views a satellite switches between, in the order of the view tabs (not the book, not the overview). */
export const SAT_VIEWS: readonly SatelliteKind[] = ['family', 'descendants', 'timeline', 'fan', 'map', 'table'];

/** What the header needs from the satellite client (SatelliteClient fits). */
export interface SatHeaderClient {
    readonly treeName: string;
    readonly hasTree: boolean;
    followMode: FollowMode;
    /** The send mode chosen in the window (spec 110 §1), whatever view shows. */
    readonly sendModeChoice: SendMode;
    /** Setting it chooses the send mode. */
    sendMode: SendMode;
    readonly mainState: MainWindowState;
    readonly connection: SatelliteConnection;
    on(event: 'status' | 'tree' | 'tree-gone' | 'renamed' | 'connection' | 'follow-mode' | 'send-mode' | 'main-state', cb: () => void): () => void;
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
    /** "Selection" got another mode of this window (what another window's choice does here). */
    onFollowChange?: () => void;
}

const UNDO_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
const REDO_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

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

    const follow = createFollowControl(doc, {
        kind: opts.kind,
        state: () => ({
            recv: client.followMode,
            send: sendModeAvailable(opts.kind()) ? client.sendModeChoice : null,
            agent: client.mainState.followingAgent,
            mainClosed: client.connection === 'main-closed',
        }),
        chooseRecv: (mode) => {
            client.followMode = mode;
            follow.refresh();
            opts.onFollowChange?.();
        },
        chooseSend: (mode) => {
            client.sendMode = mode;
            follow.refresh();
        },
    });

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
    // Undo / Redo as one group and ⧉ beside it, spaced as in the main window's toolbar (T54 H15).
    const tools = doc.createElement('span');
    tools.className = 'sat-tools';
    const undoGroup = doc.createElement('span');
    undoGroup.className = 'sat-undo-group';
    undoGroup.append(undo, redo);
    tools.append(undoGroup);
    if (another) tools.append(another);
    header.append(spacer, follow.button, divider, tools);
    doc.body.prepend(header);

    const syncTitle = (): void => {
        const text = satHeaderTitle(client.hasTree ? client.treeName : '', opts.kind(), !!switcher);
        title.textContent = text;
        title.title = text;
        title.hidden = !text;
    };
    const syncAnother = (): void => {
        if (!another) return;
        const why = opts.anotherBlocked?.() ?? '';
        another.disabled = !!why;
        another.setAttribute('aria-label', strings.win.openAnother);
        another.title = why || strings.win.openAnother;
    };

    const sync = (): void => { syncTitle(); syncAnother(); opts.refreshUndoRedo(); };
    for (const ev of ['status', 'tree', 'tree-gone', 'renamed', 'connection'] as const) client.on(ev, sync);
    for (const ev of ['follow-mode', 'send-mode', 'main-state', 'connection'] as const) client.on(ev, () => follow.refresh());
    const refresh = (): void => { syncTitle(); switcher?.refresh(); follow.refresh(); syncAnother(); opts.refreshUndoRedo(); };
    // The closed "Selection" follows the header's width (spec 110 §1), not the screen's.
    const measure = (): void => follow.setWidth(header.getBoundingClientRect().width || win?.innerWidth || 0);
    if (win) {
        win.addEventListener('resize', () => {
            switcher?.closeMenu(false);
            follow.closeMenu(false);
            measure();
        });
        const RO = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
        if (RO) new RO(() => measure()).observe(header);
    }
    measure();
    refresh();
    return { el: header, refresh };
}

/** From this header width the control starts with its name "Selection:" (spec 110 §1). */
export const FOLLOW_LABEL_MIN_WIDTH = 1280;
/** From this header width beside the view tabs both directions show; below it (to the tabs' 960 px) only what is sent. */
export const FOLLOW_BOTH_MIN_WIDTH = 1100;
/** Up to this header width (a phone) the control is its icon alone, the words stay its aria-label. */
export const FOLLOW_ICON_MAX_WIDTH = 640;

/** What the "Selection" control shows (spec 110 §1, §4, §7). */
export interface FollowControlState {
    /** What another window's choice does here. */
    recv: FollowMode;
    /** What a choice here does in the main window, as chosen; null: the view offers no such choice (§6). */
    send: SendMode | null;
    /** The main window follows the research agent: a choice sent is only marked there (§4). */
    agent: boolean;
    /** The main window is not open (§7). */
    mainClosed: boolean;
}

/** Which parts of the closed control show. */
export interface FollowControlParts {
    /** "Selection:" before the values. */
    label: boolean;
    /** ⤓ what another window's choice does here. */
    recv: boolean;
    /** ⤴ what a choice here does in the main window. */
    send: boolean;
    /** The values in words (else their icons alone). */
    text: boolean;
}

/**
 * The closed control by the header's width (spec 110 §1): "Selection:" from
 * 1280 px, both directions from 1100 px and again below the view tabs
 * (< 960 px, the tabs are one button there), between 960 and 1099 px the
 * direction sent alone (marking here is the default then). Off is "⊘ off",
 * a view without the main window's choice its own direction alone. A phone
 * keeps one icon.
 */
export function followControlParts(width: number, state: FollowControlState): FollowControlParts {
    const text = width > FOLLOW_ICON_MAX_WIDTH;
    const label = width >= FOLLOW_LABEL_MIN_WIDTH;
    if (state.recv === 'off' || state.send === null) return { label, recv: true, send: false, text };
    const compact = !text || (width >= SAT_SEGMENT_MIN_WIDTH && width < FOLLOW_BOTH_MIN_WIDTH);
    return { label, recv: !(compact && state.recv === 'mark'), send: true, text };
}

/** The main window's group of the menu: greyed while off here or without the main window; its note. */
export function followSendGroupState(state: FollowControlState): { disabled: boolean; note: 'off' | 'no-main' | 'agent' | null } {
    if (state.recv === 'off') return { disabled: true, note: 'off' };
    if (state.mainClosed) return { disabled: true, note: 'no-main' };
    return { disabled: false, note: state.agent ? 'agent' : null };
}

function lowerFirst(text: string): string {
    return text ? text.charAt(0).toLocaleLowerCase() + text.slice(1) : text;
}

/** What another window's choice does here, in words ("mark only"). */
export function followModeName(mode: FollowMode): string {
    if (mode === 'switch') return strings.satFollow.recvSwitch;
    if (mode === 'mark') return strings.satFollow.recvMark;
    return strings.satFollow.recvOff;
}

/** What a mode does, the menu's second line. */
export function followModeNote(mode: FollowMode): string {
    if (mode === 'switch') return strings.satFollow.recvSwitchNote;
    if (mode === 'mark') return strings.satFollow.recvMarkNote;
    return strings.satFollow.recvOffNote;
}

/** What a choice here does in the main window, in words: Focus is the card's own Focus, lower case as the other values. */
export function sendModeName(mode: SendMode): string {
    return mode === 'focus' ? lowerFirst(strings.contextMenu.focus) : strings.satFollow.sendMark;
}

export function sendModeNote(mode: SendMode): string {
    return mode === 'focus' ? strings.satFollow.sendFocusNote : strings.satFollow.sendMarkNote;
}

/** The control's aria-label and tooltip: both directions in whole words. */
export function followControlAria(state: FollowControlState): string {
    if (state.recv === 'off') return strings.satFollow.ariaOff;
    if (state.send === null) return strings.satFollow.ariaRecv(followModeName(state.recv));
    const send = sendModeName(state.send) + (state.agent && !state.mainClosed ? ` ${strings.satFollow.agentSuffix}` : '');
    return strings.satFollow.aria(followModeName(state.recv), send);
}

const ICON_PATHS = {
    in: '<path d="M2.5 9.5v4h11v-4"/><path d="M8 2v8"/><path d="M5 7l3 3 3-3"/>',
    out: '<path d="M7 3.5H2.5v10h10V9"/><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5l-6 6"/>',
    off: '<circle cx="8" cy="8" r="5.5"/><path d="M4.2 11.8l7.6-7.6"/>',
    caret: '<path d="M4 6l4 4 4-4"/>',
    check: '<path d="M3.5 8.5l3 3 6-7"/>',
    info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.5V11"/><path d="M8 5h.01"/>',
    agent: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
} as const;

function icon(name: keyof typeof ICON_PATHS, cls = 'sat-follow-ico'): string {
    return `<svg class="${cls}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

interface FollowControl {
    button: HTMLButtonElement;
    refresh(): void;
    /** The header's width (the closed control's parts follow it). */
    setWidth(width: number): void;
    closeMenu(returnFocus: boolean): void;
}

/** What the control reads of the window. */
interface FollowControlDeps {
    kind: () => SatelliteKind;
    state: () => FollowControlState;
    chooseRecv: (mode: FollowMode) => void;
    chooseSend: (mode: SendMode) => void;
}

/**
 * "Selection: ⤓ {here} · ⤴ {main window} ▾" (spec 110 §1, A+C): one control
 * for both directions, its menu in two groups, This window (what another
 * window's choice does here) and Main window (what a choice here does
 * there; only in a view that offers it, greyed while off or without the
 * main window, with a note while the main window follows the agent).
 */
function createFollowControl(doc: Document, deps: FollowControlDeps): FollowControl {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'sat-follow';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span class="sat-follow-label"></span>'
        + `<span class="sat-follow-recv"><span class="sat-follow-recv-ico"></span><span class="sat-follow-state"></span></span>`
        + '<span class="sat-follow-dot" aria-hidden="true">·</span>'
        + `<span class="sat-follow-send">${icon('out')}<span class="sat-follow-send-state"></span><span class="sat-follow-agent"></span></span>`
        + icon('caret', 'sat-follow-ico sat-follow-caret');
    const part = <T extends HTMLElement>(sel: string): T => button.querySelector<T>(sel)!;
    let width = doc.defaultView?.innerWidth ?? 1280;

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

    const item = (label: string, note: string, checked: boolean, disabled: boolean, pick: () => void): HTMLButtonElement => {
        const it = doc.createElement('button');
        it.type = 'button';
        it.className = 'view-window-item sat-follow-item';
        it.setAttribute('role', 'menuitemradio');
        it.setAttribute('aria-checked', checked ? 'true' : 'false');
        if (disabled) it.setAttribute('aria-disabled', 'true');
        const text = doc.createElement('span');
        text.className = 'sat-follow-item-text';
        const l = doc.createElement('span');
        l.className = 'view-window-item-label';
        l.textContent = label;
        const n = doc.createElement('span');
        n.className = 'sat-follow-item-note';
        n.textContent = note;
        text.append(l, n);
        it.innerHTML = icon('check', 'sat-follow-ico sat-follow-check');
        it.append(text);
        it.addEventListener('click', () => {
            if (it.getAttribute('aria-disabled') === 'true') return;
            closeMenu(true);
            pick();
        });
        return it;
    };
    const group = (name: string, sub: string): HTMLElement => {
        const g = doc.createElement('div');
        g.className = 'sat-follow-group';
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', name);
        const head = doc.createElement('div');
        head.className = 'sat-follow-group-head';
        const b = doc.createElement('b');
        b.textContent = name;
        const span = doc.createElement('span');
        span.textContent = `· ${sub}`;
        head.append(b, span);
        g.appendChild(head);
        return g;
    };

    /** The menu's groups as the window is now (written again when its state changes while open). */
    const fill = (m: HTMLElement): void => {
        m.replaceChildren();
        m.setAttribute('aria-label', strings.satFollow.menu);
        const st = deps.state();
        const here = group(strings.satFollow.groupThis, strings.satFollow.groupThisSub);
        for (const mode of followModesFor(deps.kind())) {
            const it = item(followModeName(mode), followModeNote(mode), mode === st.recv, false, () => { if (mode !== deps.state().recv) deps.chooseRecv(mode); });
            it.dataset.mode = mode;
            here.appendChild(it);
        }
        m.appendChild(here);
        if (st.send === null) return;
        const sep = doc.createElement('div');
        sep.className = 'sat-follow-sep';
        m.appendChild(sep);
        const g = followSendGroupState(st);
        const main = group(strings.satFollow.groupMain, strings.satFollow.groupMainSub);
        main.classList.toggle('is-disabled', g.disabled);
        if (g.disabled) main.setAttribute('aria-disabled', 'true');
        for (const mode of ['mark', 'focus'] as const) {
            const it = item(sendModeName(mode), sendModeNote(mode), mode === st.send, g.disabled, () => { if (mode !== deps.state().send) deps.chooseSend(mode); });
            it.dataset.send = mode;
            main.appendChild(it);
        }
        if (g.note) {
            const note = doc.createElement('div');
            note.className = 'sat-follow-note';
            note.dataset.note = g.note;
            const text = g.note === 'off' ? strings.satFollow.sendDisabled : g.note === 'no-main' ? strings.satFollow.noMain : strings.satFollow.agentNote;
            note.innerHTML = icon(g.note === 'agent' ? 'agent' : 'info');
            const span = doc.createElement('span');
            span.textContent = text;
            note.appendChild(span);
            main.appendChild(note);
        }
        m.appendChild(main);
    };

    const place = (m: HTMLElement): void => {
        const r = button.getBoundingClientRect();
        const vw = doc.defaultView?.innerWidth ?? 320;
        const w = Math.min(360, vw - 16);
        const left = Math.max(8, Math.min(r.right - w, vw - w - 8));
        m.style.width = `${w}px`;
        m.style.top = `${Math.round(r.bottom + 6)}px`;
        m.style.left = `${Math.round(left)}px`;
        m.style.maxHeight = `calc(100vh - ${Math.round(r.bottom + 6)}px - 12px)`;
    };

    const openMenu = (focus: 'current' | 'first' | 'last'): void => {
        if (menu) return;
        const m = doc.createElement('div');
        m.className = 'view-window-menu sat-follow-menu';
        m.setAttribute('role', 'menu');
        fill(m);
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
        place(m);
        menu = m;
        button.setAttribute('aria-expanded', 'true');
        button.classList.add('is-open');
        doc.addEventListener('pointerdown', onOutside, true);
        const list = items();
        const checked = list.findIndex(i => i.getAttribute('aria-checked') === 'true');
        const at = focus === 'first' ? 0 : focus === 'last' ? list.length - 1 : Math.max(0, checked);
        list[at]?.focus();
    };
    button.addEventListener('click', () => { if (menu) closeMenu(false); else openMenu('current'); });
    button.addEventListener('keydown', (e) => {
        if (menu) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); openMenu('first'); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu('last'); }
    });

    const drawButton = (): void => {
        const st = deps.state();
        const parts = followControlParts(width, st);
        button.dataset.mode = st.recv;
        if (st.send) button.dataset.send = st.send; else delete button.dataset.send;
        button.classList.toggle('is-icons', !parts.text);
        const label = part('.sat-follow-label');
        label.textContent = strings.satFollow.label;
        label.hidden = !(parts.label && parts.text);
        part('.sat-follow-recv').hidden = !parts.recv;
        part('.sat-follow-recv-ico').innerHTML = icon(st.recv === 'off' ? 'off' : 'in');
        const recvState = part('.sat-follow-state');
        recvState.textContent = followModeName(st.recv);
        recvState.hidden = !parts.text;
        part('.sat-follow-dot').hidden = !(parts.recv && parts.send && parts.text);
        const send = part('.sat-follow-send');
        send.hidden = !parts.send;
        const agent = st.agent && !st.mainClosed;
        send.classList.toggle('is-muted', agent || st.mainClosed);
        const sendState = part('.sat-follow-send-state');
        sendState.textContent = st.send ? sendModeName(st.send) : '';
        sendState.hidden = !parts.text;
        const suffix = part('.sat-follow-agent');
        suffix.textContent = strings.satFollow.agentSuffix;
        suffix.hidden = !(agent && parts.text);
        button.classList.toggle('is-agent', agent);
        const aria = followControlAria(st);
        button.setAttribute('aria-label', aria);
        button.title = aria;
    };

    const refresh = (): void => {
        drawButton();
        if (!menu) return;
        // Open: its groups again, the focus kept on the same row.
        const at = items().indexOf(doc.activeElement as HTMLElement);
        fill(menu);
        place(menu);
        if (at >= 0) items()[Math.min(at, items().length - 1)]?.focus();
    };
    const setWidth = (w: number): void => {
        if (!(w > 0) || w === width) return;
        width = w;
        drawButton();
    };
    return { button, refresh, setWidth, closeMenu };
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
        tab.className = 'sel-tab';
        tab.dataset.selDir = 'down';
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
            setSelTabLabel(tab, satelliteKindLabel(kind));
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
