/**
 * The main window's window controls (spec 079 §1, §4; K1: the Table):
 *
 * - ⧉ after the view tabs (`#view-window-btn`): its menu opens a view in a
 *   new window; with satellites open it is the indicator ("⧉ 2 more
 *   windows", below 1280 px the number alone) and its menu lists them first
 *   (Bring to front, ×, Close all; from 5 windows an amber note);
 * - the Table tab of the view tabs: Ctrl/Cmd+click and the middle button
 *   open it in a new window, a right click (Shift+F10, the Menu key) offers
 *   it in a small menu; this window keeps its view;
 * - a window the browser blocked: a toast with "Try again" (10 s); the
 *   sixth window and every further one: a toast that windows need memory.
 *
 * Shown only where windows are offered (window-open.ts): nothing on a phone,
 * with touch or in an exported file.
 */

import { UI } from '../ui.js';
import { strings } from '../strings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import type { WindowRegistry, WindowEntry } from './window-registry.js';
import type { SatelliteKind } from './window-role.js';
import {
    canOpenWindows, onWindowOfferChange, openInNewWindow, setViewModeCheck, setWindowControlsRefresher, setWindowOpener,
} from './window-open.js';

/** From this many satellites the menu warns about memory (§4 "Many windows"). */
export const MANY_WINDOWS = 5;
/** Below this width the indicator shows the number alone (§4, 4c). */
export const INDICATOR_TEXT_MIN_WIDTH = 1280;
/** The blocked window's toast stands this long: it is a how-to (4d). */
export const BLOCKED_TOAST_MS = 10000;
/** The many-windows toast after an opening (4e). */
export const MANY_TOAST_MS = 6000;

/** The views K1 opens in a window (K2 adds the others). */
const WINDOW_VIEWS: readonly SatelliteKind[] = ['table'];

let registry: WindowRegistry | null = null;
let menu: HTMLElement | null = null;
let ctxMenu: { el: HTMLElement; anchor: HTMLElement } | null = null;
/** Windows whose "Bring to front" the browser did not honour (said under their row while the menu is open). */
const focusFailed = new Set<string>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** A view's (or the research overview's) name. */
export function windowKindLabel(kind: SatelliteKind): string {
    if (kind === 'overview') return strings.live.overviewTitle;
    return strings.viewModeSwitch[kind];
}

function treeNameOf(entry: WindowEntry): string {
    if (!entry.treeId) return '';
    return TreeManager.getTrees().find(t => t.id === entry.treeId)?.name ?? '';
}

function isMac(): boolean {
    return UI.isMacPlatform();
}

// ---- opening ----

/** The starting state a new window of `kind` gets from this window (§1 "What is carried over"). */
function initialStateFor(kind: SatelliteKind): unknown {
    if (kind !== 'table') return undefined;
    const state = UI.tableWindowState();
    // From another view: the person selected here is the selected row there.
    if (TreeRenderer.getViewMode() !== 'table' && state.rowType === 'persons') {
        const focus = TreeRenderer.getFocusPersonId();
        if (focus) state.selected = `p:${focus}`;
    }
    return state;
}

/**
 * Open a satellite window (from a click's handler only). Blocked by the
 * browser: the toast with "Try again" (a new click, a new permission).
 */
function openWindow(kind: SatelliteKind, initial?: unknown): void {
    if (!registry) return;
    const start = initial !== undefined ? initial : initialStateFor(kind);
    const before = registry.size;
    const id = registry.openSatellite(kind, start);
    if (!id) {
        UI.showToast(strings.win.blocked, BLOCKED_TOAST_MS, {
            notice: true,
            hold: true,
            kind: 'window-blocked',
            action: { label: strings.win.retry, run: () => { openInNewWindow(kind, start); } },
        });
        return;
    }
    if (before >= MANY_WINDOWS) UI.showToast(strings.win.manyWindows(registry.size), MANY_TOAST_MS, { notice: true, kind: 'window-many' });
}

// ---- ⧉ and the indicator ----

function windowButton(): HTMLButtonElement | null {
    return document.getElementById('view-window-btn') as HTMLButtonElement | null;
}

/** ⧉ as the window count stands: hidden where windows are not offered, the indicator with satellites. */
function updateButton(): void {
    const wrap = document.getElementById('view-window-wrap');
    const btn = windowButton();
    if (!wrap || !btn) return;
    const offered = canOpenWindows();
    wrap.hidden = !offered;
    if (!offered) {
        closeMenu(false);
        closeCtxMenu(false);
    }
    const n = registry?.size ?? 0;
    const W = strings.win;
    btn.classList.toggle('has-windows', n > 0);
    const count = btn.querySelector<HTMLElement>('.view-window-count');
    if (count) {
        count.hidden = n === 0;
        count.textContent = n === 0 ? '' : window.innerWidth >= INDICATOR_TEXT_MIN_WIDTH ? W.otherWindows(n) : String(n);
    }
    const label = n > 0 ? `${W.openInNewWindow} · ${W.otherWindows(n)}` : W.openInNewWindow;
    btn.setAttribute('aria-label', label);
    btn.title = n > 0 ? W.otherWindows(n) : W.openInNewWindow;
    btn.setAttribute('aria-expanded', menu ? 'true' : 'false');
    updateSegmentTitles();
}

/** The Table tab's tooltip names the shortcut, only where windows are offered (§1). */
function updateSegmentTitles(): void {
    const offered = canOpenWindows();
    for (const kind of WINDOW_VIEWS) {
        const tab = document.getElementById(`view-mode-${kind}`);
        if (!tab) continue;
        const name = windowKindLabel(kind);
        if (offered) tab.title = isMac() ? strings.win.segmentHintMac(name) : strings.win.segmentHint(name);
        else tab.removeAttribute('title');
    }
}

// ---- the menu ----

function menuItems(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(i => !i.hasAttribute('disabled') && i.offsetParent !== null);
}

function moveFocus(root: HTMLElement, e: KeyboardEvent): boolean {
    const items = menuItems(root);
    if (!items.length) return false;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return false;
    items[next].focus();
    return true;
}

/** Place a menu under its anchor, kept inside the window; it scrolls inside below the bottom. */
function placeMenu(m: HTMLElement, anchor: HTMLElement, width: number): void {
    const r = anchor.getBoundingClientRect();
    const top = Math.round(r.bottom + 6);
    const left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8)));
    m.style.width = `${width}px`;
    m.style.top = `${top}px`;
    m.style.left = `${left}px`;
    m.style.maxHeight = `calc(100vh - ${top}px - 12px)`;
}

function menuWidth(): number {
    return window.innerWidth <= 1100 ? 330 : 350;
}

/** The section "Open windows" (§4): one row per satellite, Close all, the many-windows note. */
function windowsSection(list: WindowEntry[]): HTMLElement {
    const W = strings.win;
    const sec = el('div', 'view-window-list');
    sec.setAttribute('role', 'group');
    const head = el('div', 'view-window-head', W.openWindows);
    head.id = 'view-window-list-head';
    sec.setAttribute('aria-labelledby', head.id);
    sec.appendChild(head);
    if (list.length >= MANY_WINDOWS) sec.appendChild(el('div', 'view-window-many', W.manyWindows(list.length)));
    for (const entry of list) {
        const row = el('div', 'view-window-row');
        row.dataset.windowId = entry.id;
        const line = el('div', 'view-window-line');
        const name = el('span', 'view-window-name');
        const view = el('strong', undefined, windowKindLabel(entry.kind));
        name.appendChild(view);
        const tree = treeNameOf(entry);
        if (tree) name.appendChild(el('span', 'view-window-tree', ` · ${tree}`));
        name.title = tree ? `${windowKindLabel(entry.kind)} · ${tree}` : windowKindLabel(entry.kind);
        const front = el('button', 'view-window-front', W.bringToFront);
        front.type = 'button';
        front.setAttribute('role', 'menuitem');
        front.setAttribute('aria-label', `${W.bringToFront}: ${name.title}`);
        front.addEventListener('click', () => { void bringToFront(entry.id); });
        const close = el('button', 'view-window-close');
        close.type = 'button';
        close.setAttribute('role', 'menuitem');
        close.setAttribute('aria-label', `${W.closeWindow}: ${name.title}`);
        close.title = W.closeWindow;
        close.innerHTML = '<span aria-hidden="true">×</span>';
        close.addEventListener('click', () => {
            registry?.closeWindow(entry.id);
            focusFailed.delete(entry.id);
        });
        line.append(name, front, close);
        row.appendChild(line);
        if (focusFailed.has(entry.id)) {
            row.classList.add('is-focus-failed');
            const note = el('div', 'view-window-failed', W.focusFailed);
            note.setAttribute('role', 'status');
            row.appendChild(note);
        }
        sec.appendChild(row);
    }
    const foot = el('div', 'view-window-foot');
    const all = el('button', 'view-window-closeall', W.closeAll);
    all.type = 'button';
    all.setAttribute('role', 'menuitem');
    all.addEventListener('click', () => {
        registry?.closeAll();
        focusFailed.clear();
        // The list is gone: the keyboard goes on in the menu's views.
        if (menu) menuItems(menu)[0]?.focus();
    });
    foot.appendChild(all);
    sec.appendChild(foot);
    sec.appendChild(el('div', 'view-window-sep'));
    return sec;
}

async function bringToFront(id: string): Promise<void> {
    if (!registry) return;
    focusFailed.delete(id);
    const ok = await registry.focusWindow(id);
    if (ok) {
        focusFailed.delete(id);
        closeMenu(false);
        return;
    }
    focusFailed.add(id);
    renderMenu();
}

/** The menu's content as the windows stand; the focus stays on the item it was on. */
function renderMenu(): void {
    if (!menu || !registry) return;
    const W = strings.win;
    const focusedKey = (document.activeElement as HTMLElement | null)?.closest('[data-key]')?.getAttribute('data-key') ?? null;
    menu.innerHTML = '';
    const list = registry.list();
    if (list.length) menu.appendChild(windowsSection(list));
    const head = el('div', 'view-window-head', W.openInNewWindow);
    menu.appendChild(head);
    const current = TreeRenderer.getViewMode();
    for (const kind of WINDOW_VIEWS) {
        const item = el('button', 'view-window-item');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.dataset.view = kind;
        item.dataset.key = `view:${kind}`;
        item.appendChild(el('span', 'view-window-item-label', windowKindLabel(kind)));
        if (kind === current) item.appendChild(el('span', 'view-window-item-note', W.thisView));
        item.addEventListener('click', () => {
            closeMenu(false);
            openInNewWindow(kind);
        });
        menu.appendChild(item);
    }
    // Keys of the rows' buttons, to give the focus back after a redraw.
    menu.querySelectorAll<HTMLElement>('.view-window-row').forEach(row => {
        const id = row.dataset.windowId;
        row.querySelector('.view-window-front')?.setAttribute('data-key', `front:${id}`);
        row.querySelector('.view-window-close')?.setAttribute('data-key', `close:${id}`);
    });
    menu.querySelector('.view-window-closeall')?.setAttribute('data-key', 'closeall');
    if (focusedKey) {
        const again = menu.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`);
        (again ?? menuItems(menu)[0])?.focus();
    }
    const btn = windowButton();
    if (btn) placeMenu(menu, btn, menuWidth());
}

function onMenuKey(e: KeyboardEvent): void {
    if (!menu) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
    }
    if (e.key === 'Tab') {
        closeMenu(false);
        return;
    }
    if (moveFocus(menu, e)) e.preventDefault();
}

function onOutside(e: Event): void {
    const t = e.target as Node | null;
    if (menu && t && !menu.contains(t) && !windowButton()?.contains(t)) closeMenu(false);
    if (ctxMenu && t && !ctxMenu.el.contains(t)) closeCtxMenu(false);
}

function onViewportChange(): void {
    closeMenu(false);
    closeCtxMenu(false);
}

function openMenu(): void {
    const btn = windowButton();
    if (!btn || !canOpenWindows()) return;
    closeCtxMenu(false);
    UI.closeAllMenusExcept('sheet');
    menu = el('div', 'view-window-menu');
    menu.id = 'view-window-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', strings.win.openInNewWindow);
    menu.addEventListener('keydown', onMenuKey);
    document.body.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('is-open');
    renderMenu();
    menuItems(menu)[0]?.focus();
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onViewportChange);
}

function closeMenu(returnFocus: boolean): void {
    if (!menu) return;
    menu.remove();
    menu = null;
    focusFailed.clear();
    const btn = windowButton();
    btn?.setAttribute('aria-expanded', 'false');
    btn?.classList.remove('is-open');
    if (!ctxMenu) {
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', onViewportChange);
    }
    if (returnFocus) btn?.focus();
}

function toggleMenu(): void {
    if (menu) closeMenu(false);
    else openMenu();
}

// ---- the view tabs: Ctrl/Cmd+click, the middle button, the small menu ----

function openCtxMenu(tab: HTMLElement, kind: SatelliteKind): void {
    closeMenu(false);
    closeCtxMenu(false);
    const m = el('div', 'view-window-menu view-window-ctx');
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', windowKindLabel(kind));
    const item = el('button', 'view-window-item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.dataset.view = kind;
    item.innerHTML = '<span class="view-window-item-icon" aria-hidden="true">⧉</span>';
    item.appendChild(el('span', 'view-window-item-label', strings.win.viewInNewWindow(windowKindLabel(kind))));
    item.addEventListener('click', () => {
        closeCtxMenu(true);
        openInNewWindow(kind);
    });
    m.appendChild(item);
    m.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeCtxMenu(true);
        } else if (e.key === 'Tab') {
            closeCtxMenu(false);
        } else if (moveFocus(m, e)) {
            e.preventDefault();
        }
    });
    document.body.appendChild(m);
    placeMenu(m, tab, 260);
    m.style.maxHeight = '';
    tab.classList.add('is-window-ctx');
    ctxMenu = { el: m, anchor: tab };
    item.focus();
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onViewportChange);
}

function closeCtxMenu(returnFocus: boolean): void {
    if (!ctxMenu) return;
    const { el: m, anchor } = ctxMenu;
    ctxMenu = null;
    m.remove();
    anchor.classList.remove('is-window-ctx');
    if (!menu) {
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', onViewportChange);
    }
    if (returnFocus) anchor.focus();
}

/** The view tab of `kind` (one K1 opens in a window), or null. */
function windowTabOf(target: EventTarget | null): { tab: HTMLElement; kind: SatelliteKind } | null {
    const tab = (target as Element | null)?.closest?.<HTMLElement>('#view-mode-segment > button') ?? null;
    if (!tab) return null;
    const kind = tab.id.replace(/^view-mode-/, '') as SatelliteKind;
    return WINDOW_VIEWS.includes(kind) ? { tab, kind } : null;
}

function wireSegment(): void {
    const seg = document.getElementById('view-mode-segment');
    if (!seg) return;
    // Capture: before the tab's own click switches this window's view.
    seg.addEventListener('click', (e) => {
        if (!(e.ctrlKey || e.metaKey) || !canOpenWindows()) return;
        const hit = windowTabOf(e.target);
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation();
        openInNewWindow(hit.kind);
    }, true);
    // The middle button: no autoscroll, then the window.
    seg.addEventListener('mousedown', (e) => {
        if (e.button === 1 && canOpenWindows() && windowTabOf(e.target)) e.preventDefault();
    });
    seg.addEventListener('auxclick', (e) => {
        if (e.button !== 1 || !canOpenWindows()) return;
        const hit = windowTabOf(e.target);
        if (!hit) return;
        e.preventDefault();
        openInNewWindow(hit.kind);
    });
    seg.addEventListener('contextmenu', (e) => {
        if (!canOpenWindows()) return;
        const hit = windowTabOf(e.target);
        if (!hit) return;
        e.preventDefault();
        openCtxMenu(hit.tab, hit.kind);
    });
    seg.addEventListener('keydown', (e) => {
        if (!((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') || !canOpenWindows()) return;
        const hit = windowTabOf(e.target);
        if (!hit) return;
        e.preventDefault();
        openCtxMenu(hit.tab, hit.kind);
    });
}

// ---- start ----

function refresh(): void {
    updateButton();
    UI.syncTableWindowButton();
    if (menu) renderMenu();
}

/** The main window's controls of its windows (after the registry started). */
export function initWindowControls(reg: WindowRegistry): void {
    registry = reg;
    setViewModeCheck(() => DataManager.isViewMode());
    setWindowOpener(openWindow);
    const btn = windowButton();
    if (btn) {
        btn.addEventListener('click', () => toggleMenu());
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && !menu) {
                e.preventDefault();
                openMenu();
            }
        });
    }
    wireSegment();
    reg.onChange(() => {
        // A window gone: its failed focus is no longer said.
        const ids = new Set(reg.list().map(w => w.id));
        for (const id of [...focusFailed]) if (!ids.has(id)) focusFailed.delete(id);
        refresh();
    });
    onWindowOfferChange(refresh);
    // The indicator's words or number follow the width (1280 px).
    let wide = window.innerWidth >= INDICATOR_TEXT_MIN_WIDTH;
    window.addEventListener('resize', () => {
        const now = window.innerWidth >= INDICATOR_TEXT_MIN_WIDTH;
        if (now !== wide) { wide = now; updateButton(); }
    });
    window.addEventListener('strom:tree-renamed', () => { if (menu) renderMenu(); });
    setWindowControlsRefresher(() => {
        updateButton();
        if (menu) renderMenu();
    });
    refresh();
}
