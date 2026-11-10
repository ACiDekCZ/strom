/**
 * Table view (spec 073 §4.6): the header menu of a column.
 *
 * On top the column's whole name (and what a computed one is computed
 * from), then: sort ascending / descending / add to sort · filter, only
 * empty, only filled (when part C2 gives the filter) · pin left or unpin ·
 * move left / right · hide. `headMenuItems` builds the entries without the
 * DOM; `openHeadMenu` shows them as a menu under the head cell (a computer
 * and a tablet; a phone shows them in a sheet, table-ui.ts).
 */

import { strings } from '../../strings.js';

export interface HeadMenuItem {
    id: string;
    label: string;
    /** A small sign before the label. */
    icon: string;
    /** The shortcut on the right. */
    hint?: string;
    disabled?: boolean;
    /** The chosen one of a list (the open view, §9.2): a check before the label. */
    checked?: boolean;
    run(): void;
}

/** A separator between the menu's parts. */
export const SEP = null;
export type HeadMenuEntry = HeadMenuItem | typeof SEP;
/** A quiet label over a part of the menu ("Built-in", §9.2). */
export interface MenuHeading { heading: string }
/** A quiet sentence in the menu ("A built-in view cannot be renamed or deleted."). */
export interface MenuNote { note: string }
export type MenuEntry = HeadMenuEntry | MenuHeading | MenuNote;

export interface HeadMenuContext {
    pinned: boolean;
    locked: boolean;
    canPin: boolean;
    canMoveLeft: boolean;
    canMoveRight: boolean;
    sortAsc(): void;
    sortDesc(): void;
    sortAdd(): void;
    /** The column filter's entries (§8, part C2); without them the menu has none. */
    filter?: { open(): void; onlyEmpty(): void; onlyFilled(): void };
    pin(): void;
    unpin(): void;
    move(dir: -1 | 1): void;
    hide(): void;
}

export function headMenuItems(ctx: HeadMenuContext): HeadMenuEntry[] {
    const t = strings.table;
    const out: HeadMenuEntry[] = [
        { id: 'sortAsc', label: t.sortAsc, icon: '↑', run: ctx.sortAsc },
        { id: 'sortDesc', label: t.sortDesc, icon: '↓', run: ctx.sortDesc },
        { id: 'sortAdd', label: t.sortAdd, icon: '+', hint: t.sortAddHint, run: ctx.sortAdd },
    ];
    if (ctx.filter) {
        const f = ctx.filter;
        out.push(SEP,
            { id: 'filter', label: t.filterColumn, icon: '≡', hint: '›', run: () => f.open() },
            { id: 'onlyEmpty', label: t.onlyEmpty, icon: '', run: () => f.onlyEmpty() },
            { id: 'onlyFilled', label: t.onlyFilled, icon: '', run: () => f.onlyFilled() });
    }
    const place: HeadMenuItem[] = [];
    if (ctx.pinned && !ctx.locked) place.push({ id: 'unpin', label: t.unpin, icon: '⇥', run: ctx.unpin });
    else if (!ctx.pinned && ctx.canPin) place.push({ id: 'pin', label: t.pin, icon: '⇤', run: ctx.pin });
    if (!ctx.locked) {
        place.push(
            { id: 'moveLeft', label: t.moveLeft, icon: '←', hint: 'Alt + ←', disabled: !ctx.canMoveLeft, run: () => ctx.move(-1) },
            { id: 'moveRight', label: t.moveRight, icon: '→', hint: 'Alt + →', disabled: !ctx.canMoveRight, run: () => ctx.move(1) },
            { id: 'hide', label: t.hide, icon: '×', run: ctx.hide });
    }
    if (place.length) out.push(SEP, ...place);
    return out;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let openMenu: { el: HTMLElement; close(focusBack: boolean): void } | null = null;

export function closeHeadMenu(): void {
    openMenu?.close(false);
}

export function isHeadMenuOpen(): boolean {
    return !!openMenu;
}

/**
 * Show the menu under a head cell. Keys: ↑ ↓ Home End move, Enter / Space
 * choose, Escape or Tab close; the focus goes back to the head cell.
 */
export function openHeadMenu(anchor: HTMLElement, title: string, note: string, entries: MenuEntry[]): HTMLElement {
    closeHeadMenu();
    const el = document.createElement('div');
    el.className = 'tv-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', title || anchor.getAttribute('aria-label') || anchor.textContent || '');
    let html = title
        ? `<div class="tv-menu-title" aria-hidden="true">${esc(title)}</div>`
            + (note ? `<div class="tv-menu-note" aria-hidden="true">${esc(note)}</div>` : '')
            + '<div class="tv-menu-sep" role="separator"></div>'
        : '';
    entries.forEach((e, i) => {
        if (!e) { html += '<div class="tv-menu-sep" role="separator"></div>'; return; }
        if ('heading' in e) { html += `<div class="tv-menu-heading" role="presentation">${esc(e.heading)}</div>`; return; }
        if ('note' in e) { html += `<div class="tv-menu-note tv-menu-foot" role="presentation">${esc(e.note)}</div>`; return; }
        const checkable = e.checked !== undefined;
        html += `<button type="button" class="tv-menu-item" role="${checkable ? 'menuitemradio' : 'menuitem'}" tabindex="-1" data-i="${i}" data-id="${esc(e.id)}"`
            + (checkable ? ` aria-checked="${e.checked}"` : '')
            + `${e.disabled ? ' aria-disabled="true"' : ''}>`
            + `<span class="tv-menu-icon" aria-hidden="true">${esc(e.checked ? '✓' : e.icon)}</span>`
            + `<span class="tv-menu-label">${esc(e.label)}</span>`
            + (e.hint ? `<span class="tv-menu-hint" aria-hidden="true">${esc(e.hint)}</span>` : '')
            + '</button>';
    });
    el.innerHTML = html;
    document.body.appendChild(el);

    // Under the cell, kept inside the window.
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = r.bottom + 2;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 2) : below;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;

    const items = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.tv-menu-item:not([aria-disabled="true"])')];
    const close = (focusBack: boolean): void => {
        if (openMenu?.el !== el) return;
        openMenu = null;
        el.remove();
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', onResize);
        if (focusBack && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
    const onOutside = (e: PointerEvent): void => { if (!el.contains(e.target as Node)) close(false); };
    const onResize = (): void => close(false);
    el.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest<HTMLElement>('.tv-menu-item');
        if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
        const entry = entries[Number(btn.dataset.i)];
        close(true);
        if (entry && 'run' in entry) entry.run();
    });
    el.addEventListener('keydown', (e) => {
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            list[(at + step + list.length) % list.length]?.focus();
        } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close(true);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            close(true);
        }
    });
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
    window.addEventListener('resize', onResize);
    openMenu = { el, close };
    (el.querySelector<HTMLElement>('.tv-menu-item[aria-checked="true"]') ?? items()[0])?.focus({ preventScroll: true });
    return el;
}
