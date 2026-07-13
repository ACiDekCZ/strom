/**
 * Life-events UI methods for the person modal: the read-only birth/death rows,
 * the editable events list, and the add/edit event editor dialog. Each event
 * mutation goes straight through DataManager (its own undoable action),
 * independent of the person modal's staged Save/Cancel.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { LifeEvent, LifeEventType } from '../types.js';
import { strings } from '../strings.js';
import { SELECTABLE_EVENT_TYPES, sortLifeEvents } from '../events.js';
import { formatFlexDate, normalizeDateInput } from '../dates.js';
import { uiModule } from './module.js';

/** HTML-escape a user string for safe innerHTML insertion. */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Display label for an event (custom label when present, else the type name). */
function eventTypeLabel(event: LifeEvent): string {
    if (event.type === 'custom' && event.customLabel) return event.customLabel;
    return strings.events.types[event.type];
}

/** Secondary line: date (year, flex-aware) and place, joined with a middot. */
function eventMeta(date: string | undefined, place: string | undefined): string {
    const parts: string[] = [];
    const d = formatFlexDate(date);
    if (d) parts.push(d);
    if (place) parts.push(place);
    return parts.join(' · ');
}

export const personEventsMethods = uiModule({
    /**
     * Render the events list for the currently edited person into #events-list.
     * Shows read-only birth/death rows (synthesized from the first-class date
     * fields) followed by the editable events in chronological order.
     */
    renderEventsList(): void {
        const container = document.getElementById('events-list');
        if (!container) return;
        container.innerHTML = '';

        if (!this.currentId) return;
        const person = DataManager.getPerson(this.currentId);
        if (!person) return;

        const locked = DataManager.isPersonLocked(this.currentId);
        const rows: string[] = [];

        // Read-only birth / death rows (never editable as events).
        if (person.birthDate || person.birthPlace) {
            rows.push(this.eventRowHtml(strings.events.types.birth,
                eventMeta(person.birthDate, person.birthPlace), null));
        }

        const events = sortLifeEvents(person.events ?? []);
        for (const event of events) {
            rows.push(this.eventRowHtml(eventTypeLabel(event),
                eventMeta(event.date, event.place), locked ? null : event.id));
        }

        if (person.deathDate || person.deathPlace) {
            rows.push(this.eventRowHtml(strings.events.types.death,
                eventMeta(person.deathDate, person.deathPlace), null));
        }

        if (rows.length === 0) {
            container.innerHTML = `<div class="events-empty">${esc(strings.events.empty)}</div>`;
        } else {
            container.innerHTML = rows.join('');
        }

        // Add button visibility follows the lock state.
        const addBtn = document.getElementById('btn-add-event');
        if (addBtn) addBtn.style.display = locked ? 'none' : '';
    },

    /**
     * One event row. `eventId` null means a non-editable row (birth/death or a
     * locked person) rendered without edit/delete actions.
     */
    eventRowHtml(typeLabel: string, meta: string, eventId: string | null): string {
        const actions = eventId === null ? '' : `
            <div class="event-actions">
                <button type="button" title="${esc(strings.events.edit)}"
                    onclick="window.Strom.UI.showEditEventModal('${esc(eventId)}')">&#9998;</button>
                <button type="button" title="${esc(strings.events.delete)}"
                    onclick="window.Strom.UI.deleteEvent('${esc(eventId)}')">&#128465;</button>
            </div>`;
        const metaHtml = meta ? `<span class="event-meta"> — ${esc(meta)}</span>` : '';
        return `
            <div class="event-row${eventId === null ? ' readonly' : ''}">
                <div class="event-main"><span class="event-type">${esc(typeLabel)}</span>${metaHtml}</div>
                ${actions}
            </div>`;
    },

    /** Open the event editor in "add" mode. */
    showAddEventModal(): void {
        if (!this.currentId) return;
        if (DataManager.isPersonLocked(this.currentId)) return;
        this.editingEventId = null;
        this.populateEventTypeSelect();
        this.setEventEditorFields('baptism', '', '', '', '');
        this.openEventEditor(strings.events.addTitle);
    },

    /** Open the event editor pre-filled from an existing event. */
    showEditEventModal(eventId: string): void {
        if (!this.currentId) return;
        const person = DataManager.getPerson(this.currentId);
        const event = person?.events?.find(e => e.id === eventId);
        if (!event) return;
        this.editingEventId = eventId;
        this.populateEventTypeSelect();
        this.setEventEditorFields(event.type, event.customLabel ?? '',
            event.date ?? '', event.place ?? '', event.note ?? '');
        this.openEventEditor(strings.events.editTitle);
    },

    /** Fill the type <select> with the user-selectable event types. */
    populateEventTypeSelect(): void {
        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        if (!select) return;
        select.innerHTML = SELECTABLE_EVENT_TYPES
            .map(t => `<option value="${t}">${esc(strings.events.types[t])}</option>`)
            .join('');
        select.onchange = () => this.updateEventCustomLabelVisibility();
    },

    /** Show the custom-label field only for the 'custom' event type. */
    updateEventCustomLabelVisibility(): void {
        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        const group = document.getElementById('event-custom-label-group');
        if (!select || !group) return;
        group.style.display = select.value === 'custom' ? '' : 'none';
    },

    setEventEditorFields(type: LifeEventType, customLabel: string, date: string, place: string, note: string): void {
        const typeSelect = document.getElementById('input-event-type') as HTMLSelectElement | null;
        const labelInput = document.getElementById('input-event-custom-label') as HTMLInputElement | null;
        const dateInput = document.getElementById('input-event-date') as HTMLInputElement | null;
        const placeInput = document.getElementById('input-event-place') as HTMLInputElement | null;
        const noteInput = document.getElementById('input-event-note') as HTMLTextAreaElement | null;
        if (typeSelect) typeSelect.value = type;
        if (labelInput) labelInput.value = customLabel;
        if (dateInput) dateInput.value = date;
        if (placeInput) placeInput.value = place;
        if (noteInput) noteInput.value = note;
        this.updateEventCustomLabelVisibility();
    },

    openEventEditor(title: string): void {
        const titleEl = document.getElementById('event-editor-title');
        if (titleEl) titleEl.textContent = title;
        const modal = document.getElementById('event-editor-modal');
        if (modal) modal.classList.add('active');
    },

    closeEventEditor(): void {
        const modal = document.getElementById('event-editor-modal');
        if (modal) modal.classList.remove('active');
        this.editingEventId = null;
    },

    /** Validate and persist the event editor, then refresh the list. */
    saveEventFromModal(): void {
        if (!this.currentId) return;
        const typeSelect = document.getElementById('input-event-type') as HTMLSelectElement | null;
        const labelInput = document.getElementById('input-event-custom-label') as HTMLInputElement | null;
        const dateInput = document.getElementById('input-event-date') as HTMLInputElement | null;
        const placeInput = document.getElementById('input-event-place') as HTMLInputElement | null;
        const noteInput = document.getElementById('input-event-note') as HTMLTextAreaElement | null;

        const type = (typeSelect?.value || 'custom') as LifeEventType;
        const customLabel = labelInput?.value.trim() || '';
        const date = normalizeDateInput(dateInput?.value || '');
        const place = placeInput?.value.trim() || '';
        const note = noteInput?.value.trim() || '';

        if (date === null) {
            this.showAlert(strings.personModal.invalidDate, 'warning');
            return;
        }
        if (type === 'custom' && !customLabel) {
            this.showAlert(strings.events.customLabelRequired, 'warning');
            return;
        }

        // Only carry fields that are set (keeps stored events lean).
        const payload: Omit<LifeEvent, 'id'> = { type };
        if (type === 'custom') payload.customLabel = customLabel;
        if (date) payload.date = date;
        if (place) payload.place = place;
        if (note) payload.note = note;

        if (this.editingEventId) {
            DataManager.updateLifeEvent(this.currentId, this.editingEventId, payload);
        } else {
            DataManager.addLifeEvent(this.currentId, payload);
        }

        this.closeEventEditor();
        this.renderEventsList();
    },

    /** Confirm and remove an event, then refresh the list. */
    async deleteEvent(eventId: string): Promise<void> {
        if (!this.currentId) return;
        const confirmed = await this.showConfirm(strings.events.deleteConfirm, strings.buttons.delete);
        if (!confirmed) return;
        DataManager.removeLifeEvent(this.currentId, eventId);
        this.renderEventsList();
    },
});
