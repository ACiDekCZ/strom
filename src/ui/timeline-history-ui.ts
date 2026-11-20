/**
 * History in the Timeline view (spec 121, after DEV symboly-dejin §9): the
 * history row of the whole timeline — every event of a region where a person
 * with a row lived in its year — and the history of places and the findings
 * per person (for their life lines), and what a cluster of the row opens: on a
 * computer the person card on the first event's row (its year unfolded), on a
 * phone or a touch screen a bottom sheet listing the cluster's events with
 * "Open in the person card".
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
import { timelineHistoryYears, type TimelineHistoryItem, type TimelineHistoryInput } from '../timeline.js';
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
/** The events of the row last drawn (a cluster's sheet reads them). */
let lastEvents: readonly TimelineHistoryItem[] = [];

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
        lastEvents = computed.result.events;
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
     * A cluster of the Timeline's history row: the card (a computer) or the
     * sheet (a phone, touch) of a person it concerns — the focused person
     * when the first event concerns them, else the first of its rows.
     */
    openTimelineHistoryRow(ids: readonly string[], focusId?: string | null): void {
        const first = lastEvents.find(e => e.id === ids[0]);
        if (!first?.persons.length) return;
        const personId = focusId && first.persons.includes(focusId) ? focusId : first.persons[0];
        this.openTimelineHistory(personId, ids.filter(id => lastEvents.some(e => e.id === id && e.persons.includes(personId))));
    },

    /** A cluster of the Timeline's history row: the card (a computer) or the sheet (a phone, touch). */
    openTimelineHistory(personId: string, ids: readonly string[]): void {
        if (!ids.length) return;
        if (wantsSheet()) this.showTimelineHistorySheet(personId, ids);
        else this.openTimelineHistoryInCard(personId, ids[0]);
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

    /** The phone's sheet (§9 9g): "History 1886–1892 · name", the events (year · symbol · text), "Open in the person card". */
    showTimelineHistorySheet(personId: string, ids: readonly string[]): void {
        const all = lastEvents;
        const items = ids.map(id => all.find(e => e.id === id)).filter((e): e is TimelineHistoryItem => !!e);
        if (!items.length) return;
        const h = strings.history;
        const person = DataManager.getPerson(personId as PersonId);
        const title = h.timelineSheetTitle(timelineHistoryYears(items), person ? shownName(person) : '');
        const rows = items.map(e => `<li class="tl-hsheet-row">`
            + `<span class="tl-hsheet-year">${e.year2 !== undefined ? `${e.year}–${e.year2}` : e.year}</span>`
            + `<span class="tl-hsheet-sym hist-kind is-${e.scope}" title="${esc(h.kinds[e.kind] ?? h.kinds.other)}">${historyKindSvg(e.kind, 14)}</span>`
            + `<span class="tl-hsheet-text">${esc(e.text)}</span></li>`).join('');
        const sheet = this.showLifelineHistorySheet('tl-hsheet', 'dialog', title,
            `<div class="tl-hsheet-title">${esc(title)}</div><ul class="tl-hsheet-list">${rows}</ul>`
            + `<button type="button" class="bottom-sheet-item tl-hsheet-open">${esc(h.openInCard)} ›</button>`
            + `<button type="button" class="bottom-sheet-item pm-lifeline-hsheet-cancel">${esc(strings.buttons.close)}</button>`);
        sheet.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.tl-hsheet-open')) {
                this.hideBottomSheet();
                this.openTimelineHistoryInCard(personId, items[0].id);
            } else if (target.closest('.pm-lifeline-hsheet-cancel')) {
                this.hideBottomSheet();
            }
        });
        sheet.querySelector<HTMLElement>('.tl-hsheet-open')?.focus({ preventScroll: true });
    },
});
