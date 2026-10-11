/**
 * "Awaiting action": what the research waits on, put in order for the app —
 * to do and sent (awaiting a reply), by chip (section), by the place it is
 * done at (group), and which of the task link's actions an item offers.
 * Pure: the items come checked from research-link.ts (sanitizeWaiting); an
 * older research (no `waiting.groups`) has no phases, sections or groups.
 */

import { LiveWaiting, WAITING_SECTIONS, WaitingAction, WaitingGroup, WaitingSection, researchTaskRef } from './research-link.js';

export type WaitingPhase = 'todo' | 'sent';
/** The chip filter: all, or one section. */
export type WaitingFilter = 'all' | WaitingSection;

/** Items the small panel lists before "N more in the overview". */
export const PANEL_WAITING = 5;
/** The group items without a place of their own go to (always at the bottom). */
export const OTHER_GROUP = 'other';

export function waitingPhase(w: LiveWaiting): WaitingPhase {
    return w.phase === 'sent' ? 'sent' : 'todo';
}

/** What the user can do something about now: everything but what was sent and waits for a reply. */
export function todoWaiting<T extends LiveWaiting>(items: readonly T[]): T[] {
    return items.filter(w => waitingPhase(w) === 'todo');
}

/** The count the menu, the heading, the state and the cards go by. */
export function waitingTodoCount(items: readonly LiveWaiting[]): number {
    return todoWaiting(items).length;
}

/** The item's chip: as the research says, else by its kind (a story or an archive's question is a decision). */
export function waitingSection(w: LiveWaiting): WaitingSection {
    if (w.section) return w.section;
    return w.kind === 'story' || w.kind === 'permission' || w.kind === 'takeover' || w.kind === 'check' ? 'decide' : 'other';
}

/** The research's order; `order` only settles what a filter left (the list comes sorted). */
export function orderWaiting<T extends LiveWaiting>(items: readonly T[]): T[] {
    return items.map((w, i) => ({ w, i }))
        .sort((a, b) => (a.w.order ?? Number.MAX_SAFE_INTEGER) - (b.w.order ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
        .map(x => x.w);
}

/** The chips with their counts, in their fixed order: only sections present; none unless two or more. */
export function waitingChips(items: readonly LiveWaiting[]): { section: WaitingSection; count: number }[] {
    const counts = new Map<WaitingSection, number>();
    for (const w of items) counts.set(waitingSection(w), (counts.get(waitingSection(w)) ?? 0) + 1);
    const chips = WAITING_SECTIONS.filter(s => counts.has(s)).map(section => ({ section, count: counts.get(section)! }));
    return chips.length >= 2 ? chips : [];
}

/** The filter in force: a section no item (or no chip) has any more falls back to all. */
export function effectiveWaitingFilter(items: readonly LiveWaiting[], filter: WaitingFilter): WaitingFilter {
    if (filter === 'all') return 'all';
    return waitingChips(items).some(c => c.section === filter) ? filter : 'all';
}

export function filterWaiting<T extends LiveWaiting>(items: readonly T[], filter: WaitingFilter): T[] {
    return filter === 'all' ? [...items] : items.filter(w => waitingSection(w) === filter);
}

export interface WaitingGroupRows<T extends LiveWaiting = LiveWaiting> {
    key: string;
    /** The place (null: an item without one, in "Other"). */
    group: WaitingGroup | null;
    items: T[];
}

/**
 * Items by their place, each group where its first item stands (in the
 * research's order); items without a place and the "other" group at the bottom.
 */
export function groupWaiting<T extends LiveWaiting>(items: readonly T[]): WaitingGroupRows<T>[] {
    const groups = new Map<string, WaitingGroupRows<T>>();
    for (const w of orderWaiting(items)) {
        const key = w.group?.key ?? OTHER_GROUP;
        let g = groups.get(key);
        if (!g) {
            g = { key, group: w.group ?? null, items: [] };
            groups.set(key, g);
        }
        // An item without a place joins "other" under the research's name for it, when one came.
        if (!g.group && w.group) g.group = w.group;
        g.items.push(w);
    }
    const list = [...groups.values()];
    return [...list.filter(g => g.key !== OTHER_GROUP), ...list.filter(g => g.key === OTHER_GROUP)];
}

/** Both phases (after the filter), each in groups. */
export function waitingPhases<T extends LiveWaiting>(items: readonly T[], filter: WaitingFilter): Record<WaitingPhase, WaitingGroupRows<T>[]> {
    const shown = filterWaiting(items, filter);
    return {
        todo: groupWaiting(shown.filter(w => waitingPhase(w) === 'todo')),
        sent: groupWaiting(shown.filter(w => waitingPhase(w) === 'sent')),
    };
}

/** The first `n` items to do, in order, and how many more there are (the small panel). */
export function panelWaiting<T extends LiveWaiting>(items: readonly T[], n = PANEL_WAITING): { shown: T[]; more: number } {
    const todo = orderWaiting(todoWaiting(items));
    return { shown: todo.slice(0, n), more: Math.max(0, todo.length - n) };
}

/** The order the actions stand in: Chat right next to Answer, never tucked away. */
const ACTION_ORDER: readonly WaitingAction[] = ['answer', 'chat', 'file', 'note', 'folder', 'sent'];
/** Images are saved by hand: Chat leads (it is the way to talk about them). */
const IMAGES_ORDER: readonly WaitingAction[] = ['chat', 'answer', 'folder', 'file', 'note', 'sent'];

/**
 * The task link's actions an item offers, in their order: only those the
 * research named at it (`actions`); null when it named none (an older
 * research: "Answer" as before). A story, an archive's question or a takeover
 * never goes by the task link. What was sent is not marked sent again.
 */
export function waitingTaskActions(w: LiveWaiting): WaitingAction[] | null {
    if (!w.actions || w.kind === 'story' || w.kind === 'permission' || w.kind === 'takeover') return null;
    return (w.kind === 'images' ? IMAGES_ORDER : ACTION_ORDER).filter(a => w.actions!.includes(a) && !(a === 'sent' && waitingPhase(w) === 'sent'));
}

/**
 * The task a group's "Chat ↗" opens: of its items that offer a chat, the one
 * first in the research's order (the research's chat takes up the group's
 * other waiting tasks itself); null when none offers one.
 */
export function waitingGroupChatTask(items: readonly LiveWaiting[]): string | null {
    const chat = orderWaiting(items).find(w => researchTaskRef(w.id) && waitingTaskActions(w)?.includes('chat'));
    return chat ? researchTaskRef(chat.id) : null;
}

/** Chat is the detail's main button where nothing is answered there (images are saved by hand). */
export function waitingChatLeads(w: LiveWaiting): boolean {
    return w.kind === 'images';
}

/** How long ago, in days for anything older than today ("9 days ago"), in the UI language. */
export function waitingDaysAgo(ts: number, now: number, lang: string): string {
    const day = 86_400_000;
    const days = Math.max(0, Math.floor((now - ts) / day));
    try {
        return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
    } catch {
        return `${days}`;
    }
}

/** The task link's `do` for an action (answer: none). */
export function waitingActionDo(action: WaitingAction): Exclude<WaitingAction, 'answer'> | undefined {
    return action === 'answer' ? undefined : action;
}

/** A piece of text: plain, or an http(s) address to be a link. */
export type TextPiece = { text: string; url?: string };

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/g;
/** More closing than opening brackets: the last one closes the text around the address. */
const unbalanced = (t: string): boolean => (t.match(/\)/g)?.length ?? 0) > (t.match(/\(/g)?.length ?? 0);

/**
 * Split text into plain pieces and http(s) addresses (closing punctuation
 * stays outside the link). Only addresses the URL parser takes as http(s)
 * become links; the caller sets every piece as text, never as HTML.
 */
export function textWithLinks(text: string): TextPiece[] {
    const out: TextPiece[] = [];
    let last = 0;
    for (const m of text.matchAll(URL_IN_TEXT)) {
        let raw = m[0];
        // "(see https://x.example/a)." keeps ")." out of the address.
        while (/[.,;:!?\]}»“”]$/.test(raw) || (raw.endsWith(')') && unbalanced(raw))) raw = raw.slice(0, -1);
        let url: string | null = null;
        try {
            const u = new URL(raw);
            url = u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
        } catch { /* not an address */ }
        if (!url) continue;
        const at = m.index ?? 0;
        if (at > last) out.push({ text: text.slice(last, at) });
        out.push({ text: raw, url });
        last = at + raw.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
}
