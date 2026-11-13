/**
 * What a section of the Research overview searched here draws around its
 * field (spec 083 §1, §2, §3): the kind chips with what was found, "Found n
 * of m" or the frame of nothing found with its ways back, a number's amber
 * tag in a row, the folded section's heading with the text, and on a phone
 * the sheet over the keyboard with the section's title under its head.
 * Shared by Awaiting action and What the research knows; the logic is in
 * `section-search-filter.ts`.
 */

import { strings } from '../strings.js';
import { fieldVisible } from '../section-search-match.js';
import { sheetOverKeyboard } from '../section-search-filter.js';
import type { SectionSearch } from './section-search.js';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

const GLASS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">'
    + '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>';

/**
 * Put the section's field into `host` (under its heading, over its chips)
 * when it is shown: ten items or more, or a text typed. False: not shown.
 */
export function mountSectionSearch(host: HTMLElement, search: SectionSearch | null, total: number): boolean {
    if (!search || !fieldVisible(total, search.text)) return false;
    search.mount(host);
    bindSheetSearch(search);
    return true;
}

/**
 * A kind chip while searching: its count is what was found of its kind; with
 * nothing found it stays in its place, dashed and faint, still choosable.
 * True: nothing found of its kind (it carries no dot of something new).
 */
export function paintSearchChip(chip: HTMLElement, label: string, count: number, searching: boolean): boolean {
    chip.textContent = `${label} ${count}`;
    const empty = searching && count === 0;
    chip.classList.toggle('research-overview__filter--empty', empty);
    return empty;
}

export interface SearchOutcome {
    /** Words are typed. */
    searching: boolean;
    /** Found under the chosen chip. */
    found: number;
    /** Under the chosen chip without the search. */
    total: number;
    /** The chosen chip's name; null: All. */
    kindLabel: string | null;
    /** "Search all kinds": the chip back on All. */
    onAllKinds: () => void;
}

/**
 * After the chips: "Found n of m" (shown at once, told a screen reader after
 * a pause), or the frame of nothing found with "Clear search" (and "Search
 * all kinds" under a kind). Nothing while no words are typed. Returns the
 * frame when it drew one.
 */
export function appendSearchOutcome(host: HTMLElement, search: SectionSearch | null, o: SearchOutcome): HTMLElement | null {
    if (!search) return null;
    search.mountStatus(host);
    if (!o.searching) {
        search.silence();
        return null;
    }
    const L = strings.live;
    if (o.found > 0) {
        search.announce(L.sectionSearchFound(o.found, o.total));
        return null;
    }
    const said = o.kindLabel ? L.sectionSearchNoneKind(o.kindLabel) : L.queueSearchNone;
    search.announce(said, false);
    const box = make('div', 'research-overview__search-empty');
    box.appendChild(make('span', 'research-overview__search-empty-text', said));
    if (o.kindLabel) {
        const all = make('button', 'link-button research-overview__search-all', L.sectionSearchAllKinds);
        all.type = 'button';
        all.onclick = () => {
            o.onAllKinds();
            if (search.input.isConnected) search.input.focus({ preventScroll: true });
        };
        box.appendChild(all);
    }
    const cancel = make('button', 'link-button research-overview__search-cancel', L.queueSearchCancel);
    cancel.type = 'button';
    cancel.onclick = () => search.clear();
    box.appendChild(cancel);
    host.appendChild(box);
    return box;
}

/** A number the search matched (P…, T…, H…): the amber tag of the Queue's search. */
export function searchHitTag(text: string): HTMLElement {
    return make('span', 'research-overview__hit', text);
}

/** A folded section with a search typed: a magnifier and the text in quotes, in place of its summary. */
export function searchSummaryEl(text: string): HTMLElement {
    const sum = make('span', 'live-section__sum research-overview__section-sum--search');
    sum.insertAdjacentHTML('afterbegin', GLASS);
    sum.appendChild(make('span', 'research-overview__section-sum-text', strings.live.sectionSearchQuoted(text.trim())));
    return sum;
}

const sheetBound = new WeakSet<SectionSearch>();

/**
 * On a phone's sheet (touch): the field focused by a tap scrolls the sheet's
 * body so the section's title stands just under the sheet's head (never
 * `scrollIntoView`, which moves the page under the keyboard). The focus
 * given back after a redraw moves nothing.
 */
export function bindSheetSearch(search: SectionSearch): void {
    if (sheetBound.has(search)) return;
    sheetBound.add(search);
    search.input.addEventListener('focus', () => {
        if (search.restoring || !search.input.closest('.research-overview--sheet')) return;
        if (window.matchMedia?.('(pointer: coarse)').matches !== true) return;
        const scroller = search.input.closest<HTMLElement>('.research-overview__body');
        const section = search.box.closest<HTMLElement>('.live-section__body');
        const heading = section?.id ? scroller?.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(section.id)}"]`) : null;
        if (!scroller || !heading) return;
        const head = heading.closest<HTMLElement>('.live-section__headrow') ?? heading;
        scroller.scrollTop += head.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 4;
    });
}

let fitted: { root: HTMLElement; fit: () => void; off: () => void } | null = null;

/**
 * The overview's sheet on a phone ends where the keyboard begins
 * (`visualViewport`), so what is found stands between the field and the
 * keyboard; null (the sheet gone, another form): the sheet keeps its size and
 * nothing listens any more.
 */
export function keepSheetOverKeyboard(root: HTMLElement | null): void {
    if (fitted && fitted.root === root) {
        fitted.fit();
        return;
    }
    fitted?.off();
    fitted = null;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!root || !vv) return;
    const fit = (): void => {
        if (!root.isConnected) {
            keepSheetOverKeyboard(null);
            return;
        }
        const box = sheetOverKeyboard(vv, window.innerHeight);
        root.style.top = box ? `${box.top}px` : '';
        root.style.height = box ? `${box.height}px` : '';
        root.style.bottom = box ? 'auto' : '';
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    fitted = {
        root, fit,
        off: () => {
            vv.removeEventListener('resize', fit);
            vv.removeEventListener('scroll', fit);
            root.style.top = '';
            root.style.height = '';
            root.style.bottom = '';
        },
    };
    fit();
}
