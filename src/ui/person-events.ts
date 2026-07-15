/**
 * Life-events UI methods for the person modal: the read-only birth/death rows,
 * the editable events list, and the add/edit event editor dialog. Each event
 * mutation goes straight through DataManager (its own undoable action),
 * independent of the person modal's staged Save/Cancel.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import {
    LifeEvent, LifeEventType, EventParticipant, ParticipantRole, PersonId,
    generateParticipantId,
} from '../types.js';
import { PersonPicker } from '../person-picker.js';
import { strings } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { SELECTABLE_EVENT_TYPES, sortLifeEvents } from '../events.js';
import { formatFlexDate, normalizeDateInput, formatDateForInput } from '../dates.js';
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
                eventMeta(event.date, event.place), locked ? null : event.id,
                this.participantsSummary(event)));
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
    /**
     * "Godparent: Marie Dvořáková · Witness: Josef Krátký" — the point of
     * recording them is seeing them, and reopening the editor to find out who
     * stood at a baptism defeats it.
     */
    participantsSummary(event: LifeEvent): string {
        return (event.participants ?? []).map(p => {
            const person = p.personId ? DataManager.getPerson(p.personId) : null;
            const name = person ? `${person.firstName} ${person.lastName}`.trim() : (p.name ?? '');
            return `${strings.events.roles[p.role]}: ${name}`;
        }).join('  ·  ');
    },

    eventRowHtml(typeLabel: string, meta: string, eventId: string | null, participants = ''): string {
        const actions = eventId === null ? '' : `
            <div class="event-actions">
                <button type="button" title="${esc(strings.events.edit)}"
                    onclick="window.Strom.UI.showEditEventModal('${esc(eventId)}')">&#9998;</button>
                <button type="button" title="${esc(strings.events.delete)}"
                    onclick="window.Strom.UI.deleteEvent('${esc(eventId)}')">&#128465;</button>
            </div>`;
        const metaHtml = meta ? `<span class="event-meta"> — ${esc(meta)}</span>` : '';
        const peopleHtml = participants
            ? `<div class="event-participants">${esc(participants)}</div>` : '';
        return `
            <div class="event-row${eventId === null ? ' readonly' : ''}">
                <div class="event-main">
                    <div><span class="event-type">${esc(typeLabel)}</span>${metaHtml}</div>
                    ${peopleHtml}
                </div>
                ${actions}
            </div>`;
    },

    /**
     * Pick someone from the tree, or nothing. Resolves when the user chooses or
     * cancels, so callers can just await it.
     */
    pickPerson(title: string, excludeId?: PersonId): Promise<PersonId | null> {
        return new Promise(resolve => {
            const modal = document.getElementById('participant-picker-modal');
            const titleEl = modal?.querySelector('h2');
            if (!modal) { resolve(null); return; }
            if (titleEl) titleEl.textContent = title;

            const done = (id: PersonId | null): void => {
                modal.classList.remove('active');
                this.participantPickerResolve = null;
                resolve(id);
            };
            this.participantPickerResolve = () => done(null);

            new PersonPicker({
                containerId: 'participant-picker',
                persons: DataManager.getAllPersons().filter(p => !p.isPlaceholder && p.id !== excludeId),
                onSelect: (personId) => done(personId),
            });
            modal.classList.add('active');
        });
    },

    /** Close the picker without choosing (× / Cancel / Escape). */
    cancelParticipantPicker(): void {
        this.participantPickerResolve?.();
    },

    // ==================== GODPARENTS & WITNESSES (K2) ====================

    /**
     * The participants are edited as plain rows held in `this.eventParticipants`
     * until the event is saved, so cancelling really cancels.
     *
     * A row is either a name typed as the register writes it, or a link to
     * someone in the tree. The typed name is the normal case: a godparent is
     * usually a neighbour, and making people invent a person for every one of
     * them would mean they write nothing down at all.
     */
    renderEventParticipants(): void {
        const list = document.getElementById('event-participants-list');
        if (!list) return;
        const esc = (t: string): string => this.escapeHtml(t);

        list.innerHTML = this.eventParticipants.map((p, i) => {
            const linked = p.personId ? DataManager.getPerson(p.personId) : null;
            const shownName = linked ? `${linked.firstName} ${linked.lastName}`.trim() : (p.name ?? '');
            const roles = (['godparent', 'witness', 'officiant', 'other'] as ParticipantRole[])
                .map(r => `<option value="${r}"${p.role === r ? ' selected' : ''}>${esc(strings.events.roles[r])}</option>`)
                .join('');
            return `
                <div class="participant-row" data-index="${i}">
                    <select class="participant-role" aria-label="${esc(strings.events.participants)}">${roles}</select>
                    <input type="text" class="participant-name${linked ? ' is-linked' : ''}"
                           value="${esc(shownName)}" placeholder="${esc(strings.events.participantName)}"
                           aria-label="${esc(strings.events.participantName)}"${linked ? ' readonly' : ''}>
                    <input type="text" class="participant-note" value="${esc(p.note ?? '')}"
                           placeholder="${esc(strings.events.participantNote)}"
                           aria-label="${esc(strings.events.participantNote)}">
                    <button type="button" class="participant-btn secondary participant-link${linked ? ' linked' : ''}"
                            title="${esc(linked ? strings.events.participantUnlink : strings.events.participantLink)}">
                        ${linked ? `🔗 ${esc(strings.events.participantInTree)}` : '🔗'}
                    </button>
                    <button type="button" class="participant-btn secondary participant-del"
                            title="${esc(strings.events.delete)}">&#128465;</button>
                </div>`;
        }).join('');

        list.querySelectorAll('.participant-row').forEach(row => {
            const i = Number(row.getAttribute('data-index'));
            (row.querySelector('.participant-role') as HTMLSelectElement).onchange = (e) => {
                this.eventParticipants[i].role = (e.target as HTMLSelectElement).value as ParticipantRole;
            };
            (row.querySelector('.participant-name') as HTMLInputElement).oninput = (e) => {
                this.eventParticipants[i].name = (e.target as HTMLInputElement).value;
            };
            (row.querySelector('.participant-note') as HTMLInputElement).oninput = (e) => {
                this.eventParticipants[i].note = (e.target as HTMLInputElement).value;
            };
            (row.querySelector('.participant-link') as HTMLButtonElement).onclick = () => this.toggleParticipantLink(i);
            (row.querySelector('.participant-del') as HTMLButtonElement).onclick = () => {
                this.eventParticipants.splice(i, 1);
                this.renderEventParticipants();
            };
        });
    },

    addEventParticipantRow(): void {
        // Baptism is the common case, so godparent is the useful default.
        this.eventParticipants.push({ id: generateParticipantId(), role: 'godparent', name: '' });
        this.renderEventParticipants();
        (document.querySelector('.participant-row:last-child .participant-name') as HTMLInputElement | null)?.focus();
    },

    /** Link a row to someone in the tree, or drop the link and keep the name. */
    async toggleParticipantLink(index: number): Promise<void> {
        const row = this.eventParticipants[index];
        if (row.personId) {
            // Unlink: keep the name that was shown, so nothing is lost.
            const person = DataManager.getPerson(row.personId);
            row.name = person ? `${person.firstName} ${person.lastName}`.trim() : row.name;
            row.personId = undefined;
            this.renderEventParticipants();
            return;
        }
        const personId = await this.pickPerson(strings.events.participantLink, this.currentId ?? undefined);
        if (!personId) return;
        row.personId = personId;
        row.name = undefined;   // the name now comes from the person
        this.renderEventParticipants();
    },

    /** Rows worth keeping: a row with neither a link nor a name is just noise. */
    collectEventParticipants(): EventParticipant[] {
        return this.eventParticipants
            .map(p => ({
                id: p.id,
                role: p.role,
                ...(p.personId ? { personId: p.personId } : {}),
                ...(p.name?.trim() ? { name: p.name.trim() } : {}),
                ...(p.note?.trim() ? { note: p.note.trim() } : {}),
            }))
            .filter(p => p.personId || p.name);
    },

    /** Open the event editor in "add" mode. */
    showAddEventModal(): void {
        if (!this.currentId) return;
        if (DataManager.isPersonLocked(this.currentId)) return;
        this.editingEventId = null;
        this.populateEventTypeSelect();
        this.setEventEditorFields('baptism', '', '', '', '');
        this.eventParticipants = [];
        this.renderEventParticipants();
        // Citations need a saved event id — hide the section while adding.
        const src = document.getElementById('event-sources-section');
        if (src) src.style.display = 'none';
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
            formatDateForInput(event.date), event.place ?? '', event.note ?? '');
        // A copy: editing the rows must not touch the stored event until Save.
        this.eventParticipants = (event.participants ?? []).map(p => ({ ...p }));
        this.renderEventParticipants();
        // Citations available for an existing event — but they are a research
        // field, so the same rule as everywhere: only when asked for, unless this
        // event already cites something.
        const src = document.getElementById('event-sources-section');
        if (src) {
            src.style.display = (SettingsManager.isAdvancedFields() || event.sourceIds?.length)
                ? '' : 'none';
        }
        this.renderEventSourcesChips();
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
        this.updateEventNoteLabel(select.value as LifeEventType);
    },

    /**
     * For an occupation, this field IS the occupation — it goes out as GEDCOM
     * OCCU. Labelling it "Note" invited "worked in Kladno as a blacksmith",
     * which then became the man's trade in every other program.
     */
    updateEventNoteLabel(type: LifeEventType): void {
        const label = document.getElementById('event-note-label');
        const input = document.getElementById('input-event-note') as HTMLTextAreaElement | null;
        const isOccupation = type === 'occupation';
        if (label) label.textContent = isOccupation ? strings.events.occupationLabel : strings.events.note;
        if (input) {
            input.placeholder = isOccupation ? strings.events.occupationHint : '';
            input.rows = isOccupation ? 1 : 2;
        }
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
        const participants = this.collectEventParticipants();
        if (participants.length > 0) payload.participants = participants;

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
        // Say which one. A row of events all read "Delete this event?" otherwise,
        // and the user is left guessing which one they clicked.
        const person = DataManager.getPerson(this.currentId);
        const event = person?.events?.find(e => e.id === eventId);
        if (!event) return;
        const meta = eventMeta(event.date, event.place);
        const what = `${eventTypeLabel(event)}${meta ? ` — ${meta}` : ''}`;
        const confirmed = await this.showConfirm(strings.events.deleteConfirm(what), strings.buttons.delete);
        if (!confirmed) return;
        DataManager.removeLifeEvent(this.currentId, eventId);
        this.renderEventsList();
    },
});
