/**
 * The search of the queue in the Research overview (spec 052 §1, the
 * research's `queue.search`, Strom Research 1.32): a field over the queue's
 * chips; what is typed is sent to the bridge after a pause of typing
 * (`GET /queue?q=…`, research-queue-pages), never searched here and never
 * kept: the search lasts until it is cleared (×, Escape, Clear search) or the
 * overview closes.
 *
 * The overview is drawn anew at any moment (a status of the research
 * followed live), so the field is one element kept over the redraws: its
 * text and caret stay, the focus is given back when a redraw took it.
 */

import { LiveSession, el, queuePaged } from './research-ui.js';
import { QUEUE_SEARCH_FEATURE } from '../research-link.js';
import { QUEUE_QUERY_MAX, queueQuery, type QueueList } from '../research-queue-pages.js';
import { strings } from '../strings.js';

/** The pause of typing after which the text is searched. */
export const QUEUE_SEARCH_PAUSE_MS = 300;

export interface QueueSearch {
    /** The tree whose queue is searched (another one starts empty). */
    treeId: string;
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
    spinner: HTMLElement;
    clear: HTMLButtonElement;
    live: HTMLElement;
    timer: ReturnType<typeof setTimeout> | null;
    /** The search whose result was said to a screen reader ('' = none). */
    said: string;
    /** Draws the overview again (the latest one asked). */
    redraw: () => void;
}

let current: SearchState | null = null;
/** The field had the focus when a redraw began: its selection, given back after it. */
let focusBefore: { start: number | null; end: number | null; dir: 'forward' | 'backward' | 'none' | null } | null = null;

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
    return current;
}

/** The overview closed (or its tree changed): the search ends, nothing of it stays. */
export function resetQueueSearch(): void {
    if (current?.timer) clearTimeout(current.timer);
    current = null;
    focusBefore = null;
}

/** The section's body around the field (where the list is dimmed while a search is read). */
function sectionOf(st: SearchState): HTMLElement | null {
    return st.box.closest<HTMLElement>('.live-section__body');
}

/** The search is typed or read: the indicator in the field, the list dimmed, `aria-busy` on the field. */
export function markQueueSearchPending(on: boolean): void {
    const st = current;
    if (!st) return;
    st.spinner.hidden = !on;
    if (on) st.input.setAttribute('aria-busy', 'true');
    else st.input.removeAttribute('aria-busy');
    st.box.classList.toggle('is-pending', on);
    sectionOf(st)?.classList.toggle('research-queue--pending', on);
}

/** Say the search's result once, after it was read (`key`: which search it is). */
export function sayQueueSearch(key: string, text: string): void {
    const st = current;
    if (!st || st.said === key) return;
    st.said = key;
    st.live.textContent = text;
}

/** Clear the search: the queue again, the caret in the empty field. */
export function clearQueueSearch(focus = true): void {
    const st = current;
    if (!st) return;
    if (st.timer) clearTimeout(st.timer);
    st.timer = null;
    st.input.value = '';
    st.clear.hidden = true;
    st.typing = false;
    st.applied = '';
    st.shown = null;
    st.said = '';
    st.live.textContent = '';
    markQueueSearchPending(false);
    st.redraw();
    if (focus) current?.input.focus({ preventScroll: true });
}

/** A redraw begins: whether the field has the focus (and where its caret is). */
export function noteQueueSearchFocus(): void {
    const input = current?.input;
    focusBefore = input && document.activeElement === input
        ? { start: input.selectionStart, end: input.selectionEnd, dir: input.selectionDirection } : null;
}

/** The field is in the overview again: the focus it had goes back to it, its caret where it was. */
export function restoreQueueSearchFocus(): void {
    const st = current;
    const was = focusBefore;
    focusBefore = null;
    if (!st || !was || !st.input.isConnected || document.activeElement === st.input) return;
    st.input.focus({ preventScroll: true });
    if (was.start !== null && was.end !== null) {
        try { st.input.setSelectionRange(was.start, was.end, was.dir ?? undefined); } catch { /* not a text field */ }
    }
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
    if (current && current.treeId === s.treeId) {
        current.redraw = redraw;
        // Greyed while the overview's own window had no main window (it is kept over the redraws): usable again until greyed anew.
        for (const c of [current.input, current.clear]) {
            if (!c.dataset.greyed) continue;
            delete c.dataset.greyed;
            c.removeAttribute('aria-disabled');
            c.disabled = false;
        }
        return current;
    }
    resetQueueSearch();
    const L = strings.live;
    const box = el('div', 'research-overview__queue-search');
    box.setAttribute('role', 'search');
    const glass = box.appendChild(el('span', 'research-overview__queue-search-icon'));
    glass.setAttribute('aria-hidden', 'true');
    glass.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
        + '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>';
    const input = box.appendChild(el('input', 'research-overview__queue-search-input'));
    input.type = 'search';
    input.setAttribute('aria-label', L.queueSearchAria);
    input.placeholder = L.queueSearchPh;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = QUEUE_QUERY_MAX * 2;
    const tail = box.appendChild(el('span', 'research-overview__queue-search-tail'));
    const spinner = tail.appendChild(el('span', 'live-panel-spinner research-overview__queue-search-spin'));
    spinner.setAttribute('aria-hidden', 'true');
    spinner.hidden = true;
    const clear = tail.appendChild(el('button', 'research-overview__queue-search-clear', '×'));
    clear.type = 'button';
    clear.setAttribute('aria-label', L.queueSearchClear);
    clear.title = L.queueSearchClear;
    clear.hidden = true;
    // The section's one live region: the count or "nothing found", only once a search was read.
    const live = box.appendChild(el('span', 'research-overview__queue-search-live'));
    live.setAttribute('aria-live', 'polite');
    const st: SearchState = {
        treeId: s.treeId, box, input, applied: '', typing: false, shown: null,
        spinner, clear, live, timer: null, said: '', redraw,
    };
    current = st;

    const typed = (): void => {
        if (current !== st) return;
        const text = input.value;
        clear.hidden = text === '';
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
                live.textContent = '';
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
        st.timer = setTimeout(() => {
            st.timer = null;
            if (current !== st) return;
            st.typing = false;
            st.applied = queueQuery(input.value);
            st.redraw();
        }, QUEUE_SEARCH_PAUSE_MS);
    };
    input.addEventListener('input', (e) => {
        // Composed characters (an input method) are searched once composed.
        if ((e as InputEvent).isComposing) return;
        typed();
    });
    input.addEventListener('compositionend', typed);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !e.isComposing) {
            // A search ends first (the overview stays); an empty field lets Escape close the overview.
            if (input.value === '') return;
            e.preventDefault();
            e.stopPropagation();
            clearQueueSearch();
        } else if (e.key === 'ArrowDown' && !e.isComposing) {
            const row = firstRow(st);
            if (!row) return;
            e.preventDefault();
            row.focus();
        }
    });
    clear.onclick = () => clearQueueSearch();
    return st;
}
