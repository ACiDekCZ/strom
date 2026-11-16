/**
 * The order of "Awaiting action" in the Research overview (spec 083 U6,
 * K5.1–K5.4): the choice of order (recommended / newest first / oldest
 * first) and the Groups switch, both kept on this device for every tree;
 * an item's "new" tag and "waits since" time beside its row.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { formatWaitingSince } from '../live-time.js';
import type { LiveWaiting } from '../research-link.js';
import { WAITING_ORDERS, WaitingOrder, todoWaiting, waitingSince } from '../research-waiting.js';
import { waitingSeen } from './live-section-prefs.js';

/** The order chosen (missing: recommended). Kept on this device for every tree. */
export const WAITING_ORDER_KEY = 'strom-live-overview-waiting-order';
/** The Groups switch of a time order ('0': off; missing: on). */
export const WAITING_GROUPS_KEY = 'strom-live-overview-waiting-groups';

export function storedWaitingOrder(): WaitingOrder {
    try {
        const v = localStorage.getItem(WAITING_ORDER_KEY);
        return (WAITING_ORDERS as readonly string[]).includes(v ?? '') ? v as WaitingOrder : 'recommended';
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

export function storedWaitingGroups(): boolean {
    try {
        return localStorage.getItem(WAITING_GROUPS_KEY) !== '0';
    } catch {
        return true;
    }
}

export function storeWaitingGroups(on: boolean): void {
    try {
        if (on) localStorage.removeItem(WAITING_GROUPS_KEY);
        else localStorage.setItem(WAITING_GROUPS_KEY, '0');
    } catch { /* not kept */ }
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
    return order === 'newest' ? L.waitingOrderNew : order === 'oldest' ? L.waitingOrderOld : L.waitingOrderRec;
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
