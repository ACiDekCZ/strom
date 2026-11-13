/**
 * The search of the queue in the Research overview (spec 052 §1, the
 * research's `queue.search`, Strom Research 1.32): a field over the queue's
 * chips; what is typed is sent to the bridge after a pause of typing
 * (`GET /queue?q=…`, research-queue-pages), never searched here and never
 * kept: the search lasts until it is cleared (×, Escape, Clear search) or the
 * overview closes.
 *
 * The field is the overview's `queue` section search (`remote`, spec 083 §3),
 * one element kept over the redraws: its text and caret stay, the focus is
 * given back when a redraw took it.
 */

import { LiveSession, queuePaged } from './research-ui.js';
import { QUEUE_SEARCH_FEATURE } from '../research-link.js';
import { QUEUE_QUERY_MAX, queueQuery, type QueueList } from '../research-queue-pages.js';
import { strings } from '../strings.js';
import { overviewSearches, sectionBodyOf, type SectionSearch } from './section-search.js';

/** The pause of typing after which the text is searched. */
export const QUEUE_SEARCH_PAUSE_MS = 300;

export interface QueueSearch {
    /** The tree whose queue is searched (another one starts empty). */
    treeId: string;
    /** The field (`role="search"` box, input, indicator, ×, live region), put into each drawing by `field.mount(host)`. */
    field: SectionSearch;
    /** `role="search"`: the magnifier, the field, the indicator, ×, and the section's live region. */
    box: HTMLElement;
    input: HTMLInputElement;
    /** The text searched now ('' = none): the typed text once the typing paused. */
    applied: string;
    /** Typed and not searched yet (the pause runs). */
    typing: boolean;
    /** The search's list drawn last: shown dimmed while the next one is read (null: the queue's own). */
    shown: QueueList | null;
}

interface SearchState extends QueueSearch {
    timer: ReturnType<typeof setTimeout> | null;
    /** The search whose result was said to a screen reader ('' = none). */
    said: string;
    /** Draws the overview again (the latest one asked). */
    redraw: () => void;
}

let current: SearchState | null = null;

/** The queue's search while its field lives (the overview's registry ends it when the overview closes). */
function active(): SearchState | null {
    if (current && current.field.destroyed) current = null;
    return current;
}

/**
 * The research searches its queue (`queue.search`), read by pages through a
 * bridge answering now, and the queue has a task (up next or set aside).
 */
export function queueSearchOffered(s: LiveSession | null): boolean {
    if (!s || !queuePaged(s) || !s.features?.includes(QUEUE_SEARCH_FEATURE)) return false;
    const c = s.queueCounts;
    return s.queue.length > 0 || s.queueMore > 0 || (!!c && c.next + c.parked > 0);
}

/** The search of the queue on screen (null: none drawn now). */
export function activeQueueSearch(): QueueSearch | null {
    return active();
}

/** The queue's search ends (its tree changed), nothing of it stays. The overview's closing ends it with every other field. */
export function resetQueueSearch(): void {
    if (current?.timer) clearTimeout(current.timer);
    current = null;
    overviewSearches.drop('queue');
}

/** The section's body around the field (where the list is dimmed while a search is read). */
function sectionOf(st: SearchState): HTMLElement | null {
    return sectionBodyOf(st.box);
}

/** The search is typed or read: the indicator in the field, the list dimmed, `aria-busy` on the field. */
export function markQueueSearchPending(on: boolean): void {
    const st = active();
    if (!st) return;
    st.field.setPending(on);
    sectionOf(st)?.classList.toggle('research-queue--pending', on);
}

/** Say the search's result once, after it was read (`key`: which search it is). */
export function sayQueueSearch(key: string, text: string): void {
    const st = active();
    if (!st || st.said === key) return;
    st.said = key;
    st.field.announce(text);
}

/** Clear the search: the queue again, the caret in the empty field. */
export function clearQueueSearch(focus = true): void {
    active()?.field.clear(focus);
}

/** The first task's row of the queue's list under the field. */
function firstRow(st: SearchState): HTMLElement | null {
    return sectionOf(st)?.querySelector<HTMLElement>('.live-queue > .live-queue-row[data-task]') ?? null;
}

/**
 * The search of `s`'s queue, its field built once and kept until the overview
 * closes. `redraw` draws the overview again (a search sent, cleared).
 */
export function queueSearchFor(s: LiveSession, redraw: () => void): QueueSearch {
    const had = active();
    if (had && had.treeId === s.treeId) {
        had.redraw = redraw;
        return had;
    }
    resetQueueSearch();
    const L = strings.live;
    let st: SearchState | null = null;
    const typed = (text: string): void => {
        if (!st || current !== st) return;
        if (st.timer) clearTimeout(st.timer);
        st.timer = null;
        const q = queueQuery(text);
        if (!q) {
            // Emptied: the queue at once, nothing asked.
            st.typing = false;
            if (st.applied) {
                st.applied = '';
                st.shown = null;
                st.said = '';
                st.field.silence();
                st.redraw();
            }
            markQueueSearchPending(false);
            return;
        }
        if (q === st.applied) {
            st.typing = false;
            markQueueSearchPending(false);
            st.redraw();
            return;
        }
        st.typing = true;
        markQueueSearchPending(true);
        const self = st;
        st.timer = setTimeout(() => {
            self.timer = null;
            if (current !== self) return;
            self.typing = false;
            self.applied = queueQuery(self.input.value);
            self.redraw();
        }, QUEUE_SEARCH_PAUSE_MS);
    };
    const field = overviewSearches.ensure({
        section: 'queue', mode: 'remote',
        placeholder: L.queueSearchPh, ariaLabel: L.queueSearchAria, clearLabel: L.queueSearchClear,
        maxLength: QUEUE_QUERY_MAX * 2,
        onInput: typed,
        onArrowDown: () => {
            const row = st ? firstRow(st) : null;
            if (!row) return false;
            row.focus();
            return true;
        },
        onCleared: () => {
            if (!st || current !== st) return;
            if (st.timer) clearTimeout(st.timer);
            st.timer = null;
            st.typing = false;
            st.applied = '';
            st.shown = null;
            st.said = '';
            markQueueSearchPending(false);
            st.redraw();
        },
        onDestroy: () => {
            if (st?.timer) clearTimeout(st.timer);
            if (current === st) current = null;
        },
    });
    st = {
        treeId: s.treeId, field, box: field.box, input: field.input, applied: '', typing: false, shown: null,
        timer: null, said: '', redraw,
    };
    current = st;
    return st;
}
