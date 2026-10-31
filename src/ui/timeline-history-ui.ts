/**
 * History in the Timeline view (DEV symboly-dejin §9, variant 9a): the
 * focused person's history events for the view's history row, and what a
 * cluster of that row opens — on a computer the person card on the first
 * event's row (its year unfolded), on a phone or a touch screen a bottom
 * sheet listing the cluster's events with "Open in the person card".
 *
 * The events are the card's (historyForPerson: the layer, the tie to a
 * research, the card's "History" chip, hidings and the origin switches);
 * the row is drawn by src/timeline-chart.ts.
 */

import { strings } from '../strings.js';
import { DataManager } from '../data.js';
import { shownName } from '../person-name.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { timelineHistoryYears, type TimelineHistoryItem } from '../timeline.js';
import { historyKindSvg } from '../history-symbols.js';
import type { PersonId } from '../types.js';
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

export const timelineHistoryMethods = uiModule({
    /**
     * The focused person's events for the Timeline's history row, or
     * undefined when the row is not drawn at all: the layer off, the tree
     * not tied to a research, the card's "History" chip off, nothing read
     * yet, or no event.
     */
    timelineHistory(personId: string | null | undefined): { personId: string; events: TimelineHistoryItem[] } | undefined {
        if (!personId) return undefined;
        const view = this.historyForPerson(personId);
        if (!view?.chipOn || !view.history?.items.length) return undefined;
        return {
            personId,
            events: view.history.items.map(i => ({
                id: i.ev.id,
                year: i.year,
                ...(i.ev.to !== undefined && i.ev.to > i.ev.from ? { year2: i.ev.to } : {}),
                kind: i.ev.kind,
                scope: i.ev.scope,
                text: i.text,
            })),
        };
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
        const all = this.timelineHistory(personId)?.events ?? [];
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
