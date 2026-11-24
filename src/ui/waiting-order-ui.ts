/**
 * The order of "Awaiting action" in the Research overview (spec 083 U6,
 * K5.1–K5.4): the choice of order (recommended / newest first / oldest
 * first; with the research's books "Most tasks", spec 105 §2; with the
 * items' gains "Most helpful", spec 105 K4.1) and of the
 * groups (by archive, by book, none; before the books the Groups switch),
 * both kept on this device for every tree; an item's "new" tag and "waits
 * since" time beside its row.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { formatWaitingSince } from '../live-time.js';
import type { LiveWaiting } from '../research-link.js';
import { ALL_WAITING_ORDERS, GROUP_TITLE_LINES, WaitingOrder, todoWaiting, waitingSince } from '../research-waiting.js';
import { waitingSeen } from './live-section-prefs.js';

/** The order chosen (missing: recommended). Kept on this device for every tree. */
export const WAITING_ORDER_KEY = 'strom-live-overview-waiting-order';
/** The groups chosen: missing — by archive (the Groups switch on); '0' — none (the switch off); 'book' — by book. */
export const WAITING_GROUPS_KEY = 'strom-live-overview-waiting-groups';

/**
 * The order kept on this device: "Most tasks" only where the research says
 * its books (`books`), "Most helpful" only where it says the gains (`gain`),
 * else Recommended — the kept value stays for a research that says them.
 */
export function storedWaitingOrder(books = false, gain = false): WaitingOrder {
    try {
        const v = localStorage.getItem(WAITING_ORDER_KEY);
        if (!(ALL_WAITING_ORDERS as readonly string[]).includes(v ?? '')) return 'recommended';
        return (v === 'most' && !books) || (v === 'gain' && !gain) ? 'recommended' : v as WaitingOrder;
    } catch {
        return 'recommended';
    }
}

export function storeWaitingOrder(order: WaitingOrder): void {
    try {
        if (order === 'recommended') localStorage.removeItem(WAITING_ORDER_KEY);
        else localStorage.setItem(WAITING_ORDER_KEY, order);
    } catch { /* not kept */ }
}

/** How Awaiting action is grouped (spec 105 §1): by archive (the places, as before), by book, or none (a time order). */
export type WaitingGroups = 'archive' | 'book' | 'none';
export const WAITING_GROUP_MODES: readonly WaitingGroups[] = ['archive', 'book', 'none'];

/** The groups kept on this device (missing or unknown: by archive; '0': none, as the switch off kept it). */
export function storedWaitingGroupMode(): WaitingGroups {
    try {
        const v = localStorage.getItem(WAITING_GROUPS_KEY);
        return v === '0' ? 'none' : v === 'book' ? 'book' : 'archive';
    } catch {
        return 'archive';
    }
}

export function storeWaitingGroupMode(mode: WaitingGroups): void {
    try {
        if (mode === 'archive') localStorage.removeItem(WAITING_GROUPS_KEY);
        else localStorage.setItem(WAITING_GROUPS_KEY, mode === 'none' ? '0' : 'book');
    } catch { /* not kept */ }
}

/** The Groups switch (a research without books): on unless none was chosen. */
export function storedWaitingGroups(): boolean {
    return storedWaitingGroupMode() !== 'none';
}

export function storeWaitingGroups(on: boolean): void {
    storeWaitingGroupMode(on ? 'archive' : 'none');
}

/**
 * The groups as drawn: "Most tasks" always by book; without the books by
 * book is by archive; Recommended has no "No groups" (by archive). The kept
 * value is never rewritten by this.
 */
export function shownWaitingGroups(stored: WaitingGroups, order: WaitingOrder, books: boolean): WaitingGroups {
    if (books && order === 'most') return 'book';
    if (stored === 'book' && !books) return 'archive';
    if (stored === 'none' && order === 'recommended') return 'archive';
    return stored;
}

/** The groups offered in an order (with the books): Recommended without "No groups"; none in "Most tasks". */
export function waitingGroupModesFor(order: WaitingOrder): readonly WaitingGroups[] {
    return order === 'most' ? [] : order === 'recommended' ? ['archive', 'book'] : WAITING_GROUP_MODES;
}

/** A choice of groups' name ("Book"). */
export function waitingGroupsLabel(mode: WaitingGroups): string {
    const B = strings.live.books;
    return mode === 'book' ? B.groupBook : mode === 'none' ? B.groupNone : B.groupArchive;
}

let watched = false;

/** Another window of this device chose another order or switch: `redraw` (once registered). */
export function watchWaitingOrderStorage(redraw: () => void): void {
    if (watched || typeof window === 'undefined') return;
    watched = true;
    window.addEventListener('storage', (e) => {
        if (e.key === WAITING_ORDER_KEY || e.key === WAITING_GROUPS_KEY || e.key === null) redraw();
    });
}

/** The order's name ("Newest first"). */
export function waitingOrderLabel(order: WaitingOrder): string {
    const L = strings.live;
    return order === 'newest' ? L.waitingOrderNew : order === 'oldest' ? L.waitingOrderOld : order === 'most' ? L.books.orderMost
        : order === 'gain' ? L.waitingOrderGain : L.waitingOrderRec;
}

/**
 * The items to do the overview shows as new (spec 083 K5.3, decision H1 a):
 * those the record of "Awaiting action" had not seen when the overview drew
 * them. Kept in `tagged` until the overview closes (drawing them notes them
 * as seen); a tree never noted (its first look) has nothing new.
 */
export function noteWaitingNew(treeId: string, items: readonly LiveWaiting[], tagged: Set<string>): void {
    const seen = waitingSeen(treeId);
    if (!seen) return;
    for (const w of todoWaiting(items)) if (!seen.has(w.id)) tagged.add(w.id);
}

/**
 * Why an item helps (spec 105 K4.1), only in the order "Most helpful": the
 * research's reason, quiet under the row (`cls`: the row's own subtext); null
 * in any other order or when the research said none.
 */
export function waitingGainEl(w: LiveWaiting, order: WaitingOrder, tag: 'span' | 'small', cls: string): HTMLElement | null {
    const says = order === 'gain' ? w.gain?.says : '';
    if (!says) return null;
    const node = document.createElement(tag);
    node.className = `${cls} waiting-gain`;
    node.textContent = says;
    return node;
}

/** The "waits since" time of an item (refreshed by the panel's ticker), or null when the research said none. */
export function waitingSinceEl(w: LiveWaiting, cls = 'research-overview__since'): HTMLElement | null {
    const ts = waitingSince(w);
    if (ts === null) return null;
    const time = document.createElement('time');
    time.className = `live-time ${cls}`;
    time.dateTime = w.at;
    time.dataset.ts = String(ts);
    time.dataset.kind = 'waitsince';
    time.textContent = waitingSinceText(ts);
    return time;
}

export function waitingSinceText(ts: number): string {
    return formatWaitingSince(ts, Date.now(), getCurrentLanguage(), { justNow: strings.research.justNow, yesterday: strings.live.waitingSinceYesterday });
}

/**
 * Beside an item's row: the "new" tag (any order) over its "waits since"
 * time (a time order); null when neither is shown.
 */
export function waitingSideEl(w: LiveWaiting, opts: { isNew: boolean; time: boolean }): HTMLElement | null {
    const side = document.createElement('span');
    side.className = 'research-overview__waiting-side';
    if (opts.isNew) {
        const tag = document.createElement('span');
        tag.className = 'research-overview__new';
        tag.textContent = strings.live.waitingNewTag;
        side.appendChild(tag);
    }
    const since = opts.time ? waitingSinceEl(w) : null;
    if (since) side.appendChild(since);
    return side.childElementCount > 0 ? side : null;
}

/** How Awaiting action is being drawn: its order and whether the time order is one list (its rows read it). */
let drawn: { order: WaitingOrder; flat: boolean } = { order: 'recommended', flat: false };

export function setWaitingDrawn(order: WaitingOrder, flat: boolean): void {
    drawn = { order, flat };
}

export function waitingDrawn(): { order: WaitingOrder; flat: boolean } {
    return drawn;
}

/** The name of the place an item belongs to, as its group's heading says it. */
export function waitingGroupName(w: LiveWaiting): string {
    return w.kind === 'place' ? strings.places.waiting.group : w.group?.name ?? strings.live.waitingOtherGroup;
}

/** The "more" of each clamped text drawn (a group's title, an item's "Waiting on"), watched for its column's width. */
const clampMoreOf = new WeakMap<Element, { btn: HTMLButtonElement; linesVar: string; lines: number }>();
let clampObserver: ResizeObserver | null = null;

/**
 * Whether a clamped text needs its "more" / "less": cut at its cap (more
 * than its lines), or unfolded beyond them. The cap is the text's CSS
 * variable of lines (a group title's `--group-title-lines`: 3, 4 on a phone,
 * in the panel, in a narrow column; "Waiting on"'s `--on-lines`: 10, 3 on a
 * phone held sideways).
 */
function syncClampMore(text: HTMLElement): void {
    const c = clampMoreOf.get(text);
    if (!c || !text.isConnected) return;
    let over: boolean;
    if (text.classList.contains('is-full')) {
        const cs = getComputedStyle(text);
        const lines = Number.parseInt(cs.getPropertyValue(c.linesVar), 10) || c.lines;
        const lh = Number.parseFloat(cs.lineHeight) || 20;
        over = text.clientHeight > lines * lh + 1;
    } else {
        over = text.scrollHeight > text.clientHeight + 1;
    }
    if (c.btn.hidden === over) c.btn.hidden = !over;
}

/**
 * A clamped text's "more" (spec 105 U4 §1, 1h; §3): a link button under the
 * text (outside any fold button: it never folds what holds it), shown only
 * when the text overflows its cap (measured once drawn and again when the
 * column's width changes). A click unfolds the whole text in place ("less"
 * folds it back); kept in the view under `stateKey` while the session lasts.
 */
function clampMoreEl(text: HTMLElement, stateKey: string, open: Map<string, boolean>, c: { cls: string; linesVar: string; lines: number }): HTMLButtonElement {
    const L = strings.live;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `link-button ${c.cls}`;
    btn.hidden = true;
    const paint = (full: boolean): void => {
        text.classList.toggle('is-full', full);
        btn.textContent = full ? L.titleLess : L.titleMore;
        btn.setAttribute('aria-expanded', String(full));
    };
    paint(open.get(stateKey) === true);
    btn.onclick = (e) => {
        e.stopPropagation();
        const full = !text.classList.contains('is-full');
        if (full) open.set(stateKey, true);
        else open.delete(stateKey);
        paint(full);
        syncClampMore(text);
    };
    clampMoreOf.set(text, { btn, linesVar: c.linesVar, lines: c.lines });
    if (typeof ResizeObserver !== 'undefined') {
        clampObserver ??= new ResizeObserver(entries => {
            for (const entry of entries) {
                const t = entry.target as HTMLElement;
                if (!t.isConnected) clampObserver?.unobserve(t);
                else syncClampMore(t);
            }
        });
        clampObserver.observe(text);
    }
    return btn;
}

/** A group title's "more" (spec 105 U4 §1, 1h), kept under `title:<group key>`. */
export function groupTitleMoreEl(title: HTMLElement, key: string, open: Map<string, boolean>): HTMLButtonElement {
    return clampMoreEl(title, `title:${key}`, open, { cls: 'research-overview__group-more', linesVar: '--group-title-lines', lines: GROUP_TITLE_LINES });
}

/** The lines of an item's "Waiting on" before its "more" (spec 105 U4 §3; 3 on a phone held sideways, by `--on-lines`). */
export const WAITING_ON_LINES = 10;

/** An item's "Waiting on" "more" (spec 105 U4 §3, Q1 a), kept under `on:<item id>`. */
export function waitingOnMoreEl(text: HTMLElement, id: string, open: Map<string, boolean>): HTMLButtonElement {
    return clampMoreEl(text, `on:${id}`, open, { cls: 'research-overview__waiting-on-more', linesVar: '--on-lines', lines: WAITING_ON_LINES });
}

/** A row's tag of its place in a list without groups (the whole name on hover). */
export function waitingGroupTagEl(w: LiveWaiting): HTMLElement {
    const name = waitingGroupName(w);
    const tag = document.createElement('span');
    tag.className = 'research-overview__group-tag';
    tag.textContent = name;
    tag.title = name;
    return tag;
}

/** ⇅ before the order's name (14 px, the text's light colour). */
export const ORDER_ICON = '<svg class="research-overview__order-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg>';
