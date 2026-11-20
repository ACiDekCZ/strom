/**
 * History in the Timeline view (spec 121, after DEV symboly-dejin §9): the
 * history row of the whole timeline — every event of a region where a person
 * with a row lived in its year — and the history of places and the findings
 * per person (for their life lines), and what a cluster of the row opens
 * (§2): on a computer a popover at the cluster listing its events and whom
 * each concerns, the names links to their cards; on a phone or a touch screen
 * a bottom sheet with the events and a row per person to open in the card.
 *
 * The events are computed in one pass (computeTimelineHistory, src/history.ts)
 * and kept until the data, the payload, the rows or the settings change: a
 * change of focus computes nothing. The kinds and the region filter apply to
 * the finished list (the model). The row is drawn by src/timeline-chart.ts.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { shownName } from '../person-name.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { yearOf } from '../dates.js';
import {
    timelineHistoryYears, timelineConcernPersons, timelineClusterPersons, placeTimelinePop,
    type TimelineHistoryItem, type TimelineHistoryInput,
} from '../timeline.js';
import { computeTimelineHistory, timelineHistoryRegion, type HistoryPayload, type PersonResidence, type TimelineHistoryComputed } from '../history.js';
import { historyKindSvg } from '../history-symbols.js';
import type { PersonId, StromData } from '../types.js';
import { uiModule } from './module.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A phone (narrow or held sideways) or a touch screen: the sheet, not the card at once. */
function wantsSheet(): boolean {
    if (typeof matchMedia !== 'function') return false;
    return matchMedia(MQ_PHONE_BAR).matches || matchMedia('(pointer: coarse)').matches;
}

/** The persons' residences, kept while the tree's content stays (a change of focus keeps them). */
let residences: { data: StromData; rev: number; map: Map<string, PersonResidence> } | null = null;
/** The last computed history and what it was computed for. */
let computed: { key: string; payload: HistoryPayload; data: StromData; result: TimelineHistoryComputed } | null = null;
/** The events of the row last drawn and the rows' order (a cluster's popover and sheet read them). */
let lastEvents: readonly TimelineHistoryItem[] = [];
let lastRowOrder: readonly string[] = [];
/** The open popover of the history row (one at a time). */
let pop: { el: HTMLElement; key: string; close: (refocus: boolean) => void } | null = null;

/** What a popover of the history row shows and where (openTimelinePopover). */
export interface TimelinePopoverOptions {
    /** The element it belongs to: a cluster, the row's label. */
    anchor: Element;
    /** The anchor's x in the window's pixels (default: its centre); the popover starts 40 px left of it. */
    x?: number;
    /** Which popover it is (a second click on its anchor closes it). */
    key: string;
    /** The heading, also the dialog's name. */
    title: string;
    /** The content under the heading (markup). */
    body: string;
    /** Width in px: 380 (a cluster), 400 (the options). */
    width?: number;
    /** A modifier class next to `tl-pop`. */
    className?: string;
    /** Where the keyboard goes back on Esc and × (looked up when it closes: the row may be redrawn). */
    returnFocus: () => HTMLElement | null;
    /** A click inside (not ×); `close(false)` closes it without moving the keyboard. */
    onClick?: (target: HTMLElement, close: (refocus: boolean) => void) => void;
    onClose?: () => void;
}

/** A cluster's ids as they stand in its data-hist-ids. */
function clusterKey(ids: readonly string[]): string {
    return ids.map(id => encodeURIComponent(id)).join(' ');
}

/** "1880" or a period "1882–1890". */
function historyYears(e: TimelineHistoryItem): string {
    return e.year2 !== undefined ? `${e.year}–${e.year2}` : String(e.year);
}

function kindName(e: TimelineHistoryItem): string {
    const k = strings.history.kinds;
    return k[e.kind] ?? k.other;
}

/** "kind · region" (the region only when the row's events come from two regions or more). */
function kindMeta(e: TimelineHistoryItem): string {
    return e.region ? `${kindName(e)} · ${e.region}` : kindName(e);
}

/**
 * The popover placed at the history row (placeTimelinePop): the row is the
 * tint's box widened by its 3 px margins (the anchor's own box without one).
 */
function placePopover(el: HTMLElement, anchor: Element, x?: number): void {
    const band = anchor.closest('.tl-hist-row')?.querySelector('.tl-hist-band');
    const a = anchor.getBoundingClientRect();
    const row = band ? band.getBoundingClientRect() : a;
    const m = band ? 3 : 0;
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-bar-h')) || 0;
    const place = placeTimelinePop(
        { x: x ?? a.left + a.width / 2, top: row.top - m, bottom: row.bottom + m },
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight, bottomInset: inset },
    );
    el.style.left = `${Math.round(place.left)}px`;
    el.style.top = `${Math.round(place.top)}px`;
    el.classList.toggle('is-above', place.above);
    if (place.maxHeight !== null) el.style.maxHeight = `${Math.floor(place.maxHeight)}px`;
}

/** A person who gets a row on the Timeline (computeTimelineModel): a birth year, not a placeholder. */
function hasRow(data: StromData, id: string): boolean {
    const p = data.persons[id as keyof typeof data.persons];
    return !!p && !p.isPlaceholder && yearOf(p.birthDate) !== null;
}

export const timelineHistoryMethods = uiModule({
    /**
     * The Timeline's history row for the given row ids (spec 121 §0), or
     * undefined when the row is not drawn at all: the layer off, the tree
     * not tied to a research, the card's "History" chip off, nothing read
     * yet. The focused person is only `focusId` (the line of the life).
     */
    timelineHistoryAll(rowIds: readonly string[], focusId?: string | null): TimelineHistoryInput | undefined {
        const src = this.historyTimelineSource();
        if (!src) { lastEvents = []; return undefined; }
        const data = DataManager.getData();
        const rev = DataManager.getContentRevision();
        const treeId = DataManager.getCurrentTreeId();
        if (!residences || residences.data !== data || residences.rev !== rev) residences = { data, rev, map: new Map() };
        const ids = rowIds.filter(id => hasRow(data, id));
        const lang = getCurrentLanguage();
        const key = JSON.stringify([treeId, rev, src.researchId, src.queue, src.kinds, lang, ids]);
        if (!computed || computed.key !== key || computed.payload !== src.payload || computed.data !== data) {
            computed = {
                key, payload: src.payload, data,
                result: computeTimelineHistory(data, ids, src.payload, lang, { queue: src.queue, kinds: src.kinds, residences: residences.map }),
            };
        }
        const opts = SettingsManager.getTimelineHistory(treeId);
        const region = timelineHistoryRegion(src.payload, opts.region, lang, computed.result.regionList);
        const filter = { ...(opts.kinds ? { kinds: opts.kinds } : {}), ...(region ?? {}) };
        return {
            events: computed.result.events,
            ...(opts.local ? { local: computed.result.local } : {}),
            ...(Object.keys(filter).length ? { filter } : {}),
            ...(focusId ? { focusId } : {}),
        };
    },

    /** The regions of the row's events, the most events first (the options' list). */
    timelineHistoryRegions(): readonly { id: string; name: string; count: number }[] {
        return computed?.result.regionList ?? [];
    },

    /**
     * The history row the Timeline drew (the model's events: trimmed to the
     * rows, the filter applied, a region named only with two or more) and
     * the rows' order — what a cluster's popover and sheet read.
     */
    setTimelineHistoryDrawn(events: readonly TimelineHistoryItem[], rowOrder: readonly string[]): void {
        lastEvents = events;
        lastRowOrder = rowOrder;
    },

    /**
     * A cluster of the Timeline's history row (spec 121 §2): on a computer a
     * popover at the cluster (its events, whom each concerns, links to their
     * cards; a click on the open one's cluster closes it), on a phone or a
     * touch screen the sheet with the persons to open.
     */
    openTimelineHistoryRow(ids: readonly string[], focusId?: string | null, anchor?: Element | null): void {
        if (!ids.some(id => lastEvents.some(e => e.id === id))) return;
        if (wantsSheet() || !anchor) { this.showTimelineHistorySheet(ids, focusId); return; }
        const key = clusterKey(ids);
        if (pop?.key === key) { pop.close(true); return; }
        this.showTimelineHistoryPopover(ids, anchor, focusId);
    },

    /**
     * The popover of a cluster (§2, 2a–2c): "History 1880–1891" and ×, then
     * a row per event — the years, the symbol in its origin's colour, the
     * text, "kind · region", "Concerns:" with at most two names as links to
     * their cards (the rows' order, the focused person first) and "and N
     * more". A name opens the card on the event's row and closes it.
     */
    showTimelineHistoryPopover(ids: readonly string[], anchor: Element, focusId?: string | null): void {
        const items = ids.map(id => lastEvents.find(e => e.id === id)).filter((e): e is TimelineHistoryItem => !!e);
        if (!items.length) return;
        const h = strings.history;
        const title = h.timelineYearsTitle(timelineHistoryYears(items));
        const rows = items.map(e => {
            const persons = e.persons.filter(id => DataManager.getPerson(id as PersonId));
            const { shown, more } = timelineConcernPersons(persons, focusId);
            const names = shown.map(id => `<button type="button" class="link-button tl-pop-person" data-person-id="${esc(id)}"`
                + ` data-event-id="${esc(e.id)}">${esc(shownName(DataManager.getPerson(id as PersonId)!))}</button>`).join(', ');
            const [before, after = ''] = h.timelineConcerns('\u0000', more).split('\u0000');
            const who = shown.length ? `<span class="tl-pop-who">${esc(before)}${names}${esc(after)}</span>` : '';
            return `<li class="tl-pop-ev"><span class="tl-pop-y">${historyYears(e)}</span>`
                + `<span class="tl-pop-sym is-${e.scope}" title="${esc(kindName(e))}">${historyKindSvg(e.kind, 14)}</span>`
                + `<span class="tl-pop-main"><span class="tl-pop-text">${esc(e.text)}</span>`
                + `<span class="tl-pop-meta">${esc(kindMeta(e))}</span>${who}</span></li>`;
        }).join('');
        const key = clusterKey(ids);
        this.openTimelinePopover({
            anchor, key, title,
            body: `<ol class="tl-pop-list">${rows}</ol>`,
            returnFocus: () => document.querySelector<HTMLElement>(`#timeline-container .tl-hist[data-hist-ids="${CSS.escape(key)}"]`),
            onClick: (target, close) => {
                const link = target.closest<HTMLElement>('.tl-pop-person[data-person-id]');
                if (!link) return;
                close(false);
                this.openTimelineHistoryInCard(link.dataset.personId!, link.dataset.eventId!);
            },
        });
    },

    /**
     * A popover of the Timeline's history row (spec 121 §2 and the options of
     * §5): `.tl-pop`, `width` px wide (380 by default), under the row and at
     * the anchor's x − 40, above the row where the window has no room below,
     * clipped into the window; one at a time. Esc, a click beside it, a
     * scroll or a resize close it; Esc and × put the keyboard back on the
     * anchor (`returnFocus`); Tab stays inside. `role="dialog"`, labelled by
     * its title.
     */
    openTimelinePopover(o: TimelinePopoverOptions): HTMLElement {
        pop?.close(false);
        const el = document.createElement('div');
        el.className = `tl-pop${o.className ? ` ${o.className}` : ''}`;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', o.title);
        el.tabIndex = -1;
        el.style.width = `${o.width ?? 380}px`;
        el.innerHTML = `<div class="tl-pop-head"><span class="tl-pop-title">${esc(o.title)}</span>`
            + `<button type="button" class="tl-pop-x" aria-label="${esc(strings.buttons.close)}" title="${esc(strings.buttons.close)}">×</button></div>`
            + `<div class="tl-pop-body">${o.body}</div>`;
        const focusables = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex="0"]')]
            .filter(x => !(x as HTMLButtonElement).disabled && !x.hidden && x.getClientRects().length > 0);
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(true);
            } else if (e.key === 'Tab' && el.contains(document.activeElement)) {
                const list = focusables();
                if (!list.length) return;
                e.preventDefault();
                const i = list.indexOf(document.activeElement as HTMLElement);
                list[e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1)].focus();
            }
        };
        const onDown = (e: Event): void => {
            const t = e.target as Element | null;
            if (!t || el.contains(t)) return;
            // A cluster or the row's label: its own click opens another popover or closes this one.
            if (t.closest?.('#timeline-container .tl-hist, #timeline-container .tl-hist-btn')) return;
            close(false);
        };
        const onScroll = (e: Event): void => {
            if (e.target instanceof Node && el.contains(e.target)) return;
            close(true);
        };
        const onResize = (): void => close(false);
        const close = (refocus: boolean): void => {
            if (pop?.el !== el) return;
            pop = null;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
            el.remove();
            o.onClose?.();
            if (refocus) o.returnFocus()?.focus({ preventScroll: true });
        };
        el.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.tl-pop-x')) { close(true); return; }
            o.onClick?.(target, close);
        });
        document.body.appendChild(el);
        pop = { el, key: o.key, close };
        placePopover(el, o.anchor, o.x);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        (el.querySelector<HTMLElement>('.tl-pop-body button, .tl-pop-body input, .tl-pop-body [tabindex="0"]') ?? el.querySelector<HTMLElement>('.tl-pop-x'))
            ?.focus({ preventScroll: true });
        return el;
    },

    /** The Timeline's popover, closed (a view left, the row redrawn without it). */
    closeTimelinePopover(refocus = false): void {
        pop?.close(refocus);
    },

    /** The person card, its life timeline on the event's row (the year unfolded, the row lit). */
    openTimelineHistoryInCard(personId: string, eventId: string): void {
        if (!DataManager.getPerson(personId as PersonId)) return;
        const open = (): void => {
            this.clearDialogStack();
            this.pushDialog('person-modal');
            this.showEditPersonModal(personId as PersonId);
            this.highlightHistoryEvent(eventId);
        };
        if (document.getElementById('person-modal')?.classList.contains('active')) this.leavePersonModalThen(open);
        else open();
    },

    /**
     * The phone's sheet of a cluster (spec 121 §2, 2d–2e): "History 1880–1891"
     * (no name: the row is the whole timeline's), the events (year · symbol ·
     * text, "kind · region" under it), then "Open in the person card" with a
     * row per person the cluster concerns (the rows' order, the focused person
     * first), at most four and "and N more ›", which unfolds the rest here. A
     * person opens their card on the first event of the cluster that concerns them.
     */
    showTimelineHistorySheet(ids: readonly string[], focusId?: string | null): void {
        const items = ids.map(id => lastEvents.find(e => e.id === id)).filter((e): e is TimelineHistoryItem => !!e);
        if (!items.length) return;
        const h = strings.history;
        const title = h.timelineYearsTitle(timelineHistoryYears(items));
        const rows = items.map(e => `<li class="tl-hsheet-row">`
            + `<span class="tl-hsheet-year">${historyYears(e)}</span>`
            + `<span class="tl-hsheet-sym hist-kind is-${e.scope}" title="${esc(kindName(e))}">${historyKindSvg(e.kind, 14)}</span>`
            + `<span class="tl-hsheet-text">${esc(e.text)}<span class="tl-hsheet-meta">${esc(kindMeta(e))}</span></span></li>`).join('');
        const people = timelineClusterPersons(items, lastRowOrder, focusId)
            .filter(p => DataManager.getPerson(p.personId as PersonId));
        const personBtn = (p: { personId: string; eventId: string }): string =>
            `<button type="button" class="bottom-sheet-item tl-hsheet-person" data-person-id="${esc(p.personId)}" data-event-id="${esc(p.eventId)}">`
            + `<span>${esc(shownName(DataManager.getPerson(p.personId as PersonId)!))}</span><span aria-hidden="true">›</span></button>`;
        const SHOWN = 4;
        const rest = people.length > SHOWN ? people.slice(SHOWN) : [];
        const persons = people.length
            ? `<div class="tl-hsheet-sub">${esc(h.openInCard)}</div>`
                + `<div class="tl-hsheet-people" role="group" aria-label="${esc(h.openInCard)}">`
                + (rest.length ? people.slice(0, SHOWN) : people).map(personBtn).join('')
                + (rest.length ? `<button type="button" class="bottom-sheet-item tl-hsheet-more">${esc(h.timelinePeopleMore(rest.length))} ›</button>` : '')
                + `</div>`
            : '';
        const sheet = this.showLifelineHistorySheet('tl-hsheet', 'dialog', title,
            `<div class="tl-hsheet-title">${esc(title)}</div><ul class="tl-hsheet-list">${rows}</ul>${persons}`
            + `<button type="button" class="bottom-sheet-item pm-lifeline-hsheet-cancel">${esc(strings.buttons.close)}</button>`);
        sheet.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const person = target.closest<HTMLElement>('.tl-hsheet-person[data-person-id]');
            if (person) {
                this.hideBottomSheet();
                this.openTimelineHistoryInCard(person.dataset.personId!, person.dataset.eventId!);
            } else if (target.closest('.tl-hsheet-more')) {
                const more = target.closest<HTMLElement>('.tl-hsheet-more')!;
                more.insertAdjacentHTML('beforebegin', rest.map(personBtn).join(''));
                const next = more.previousElementSibling ? sheet.querySelectorAll<HTMLElement>('.tl-hsheet-person')[SHOWN] : null;
                more.remove();
                next?.focus({ preventScroll: true });
            } else if (target.closest('.pm-lifeline-hsheet-cancel')) {
                this.hideBottomSheet();
            }
        });
        sheet.querySelector<HTMLElement>('.tl-hsheet-person, .pm-lifeline-hsheet-cancel')?.focus({ preventScroll: true });
    },
});
