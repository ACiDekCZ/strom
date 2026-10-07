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
    LifeEvent, LifeEventType, EventParticipant, ParticipantRole, PersonId, PartnershipId, FactStatus,
    generateParticipantId,
} from '../types.js';
import { PersonPicker } from '../person-picker.js';
import { extraParticipantRole } from '../godparents.js';
import { strings } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { SELECTABLE_EVENT_TYPES, sortLifeEvents, eventTakesParticipants, eventValueIsOnTag } from '../events.js';
import { formatFlexDate, normalizeDateInput, formatDateForInput } from '../dates.js';
import { chainLinkSvg, iconSvg } from '../icons.js';
import { uiModule } from './module.js';
import { factStatusHtml } from './fact-status.js';
import { autoGrowAll } from './autogrow.js';
import { DETAIL_KEYS, offeredDetails, refreshDetailGroup, resetDetailGroup, renderAgeCheck, ageBirthDate, eventDetailLine } from './event-details-ui.js';
import { shownNameOrEmpty } from '../person-name.js';

/** HTML-escape a user string for safe innerHTML insertion. */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The note of an event whose note IS its subject rather than a remark about it
 * — the trade, the denomination, the title. Each goes out as the value of its
 * own GEDCOM tag, and each leaves the row saying only "Occupation" or "Title"
 * if it is not shown.
 */
function eventOwnSubject(event: LifeEvent): string | undefined {
    return eventValueIsOnTag(event.type) ? event.note : undefined;
}

/** Display label for an event (custom label when present, else the type name). */
export function eventTypeLabel(event: LifeEvent): string {
    if (event.type === 'custom' && event.customLabel) return event.customLabel;
    return strings.events.types[event.type];
}

/**
 * Secondary line: date (year, flex-aware) and place, joined with a middot.
 *
 * `lead` comes first, for an event whose note IS its subject. An occupation
 * keeps the trade in its note — that is what goes out as the GEDCOM OCCU value
 * — so the row read "Povolání" and nothing else whenever the trade carried no
 * date or place. Which trade it was is the one thing worth seeing there.
 */
function eventMeta(
    date: string | undefined,
    place: string | undefined,
    lead?: string | undefined
): string {
    const parts: string[] = [];
    if (lead?.trim()) parts.push(lead.trim());
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
                eventMeta(person.birthDate, person.birthPlace), null, '',
                eventDetailLine({ address: person.birthAddress }), person.birthStatus));
        }

        const events = sortLifeEvents(person.events ?? []);
        for (const event of events) {
            rows.push(this.eventRowHtml(eventTypeLabel(event),
                eventMeta(event.date, event.place, eventOwnSubject(event)),
                locked ? null : event.id,
                this.participantsSummary(event), eventDetailLine(event), event.status));
        }

        if (person.deathDate || person.deathPlace) {
            rows.push(this.eventRowHtml(strings.events.types.death,
                eventMeta(person.deathDate, person.deathPlace), null, '',
                eventDetailLine({ cause: person.deathCause, age: person.deathAge, address: person.deathAddress }), person.deathStatus));
        }

        if (rows.length === 0) {
            container.innerHTML = `<div class="events-empty">${esc(strings.events.empty)}</div>`;
        } else {
            container.innerHTML = rows.join('');
            // Event ids come from data files: handlers via data attributes,
            // never inline JS (&#39; is decoded back to a quote in attributes).
            container.querySelectorAll<HTMLElement>('.event-edit-btn[data-event-id]').forEach(btn => {
                btn.addEventListener('click', () => this.showEditEventModal(btn.dataset.eventId ?? ''));
            });
            container.querySelectorAll<HTMLElement>('.event-delete-btn[data-event-id]').forEach(btn => {
                btn.addEventListener('click', () => { void this.deleteEvent(btn.dataset.eventId ?? ''); });
            });
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
            const name = person ? shownNameOrEmpty(person) : (p.name ?? '');
            const extra = extraParticipantRole(p);
            return `${extra ? strings.events.extraRoles[extra.role] : strings.events.roles[p.role]}: ${name}`;
        }).join('  ·  ');
    },

    eventRowHtml(typeLabel: string, meta: string, eventId: string | null, participants = '', details = '', status?: FactStatus): string {
        const actions = eventId === null ? '' : `
            <div class="event-actions">
                <button type="button" class="event-edit-btn" title="${esc(strings.events.edit)}" aria-label="${esc(strings.events.edit)}"
                    data-event-id="${esc(eventId)}">${iconSvg('pencil')}</button>
                <button type="button" class="event-delete-btn" title="${esc(strings.events.delete)}" aria-label="${esc(strings.events.delete)}"
                    data-event-id="${esc(eventId)}">${iconSvg('trash')}</button>
            </div>`;
        const metaHtml = meta ? `<span class="event-meta"> — ${esc(meta)}</span>` : '';
        const peopleHtml = participants
            ? `<div class="event-participants">${esc(participants)}</div>` : '';
        // Cause · age · house, quietly under the event (src/ui/event-details-ui.ts).
        const detailsHtml = details ? `<div class="event-details-line">${esc(details)}</div>` : '';
        return `
            <div class="event-row${eventId === null ? ' readonly' : ''}">
                <div class="event-main">
                    <div><span class="event-type">${esc(typeLabel)}</span>${metaHtml}${factStatusHtml(status)}</div>
                    ${detailsHtml}
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
                modal.onclick = null;
                // Pop our own stack entry (Escape in misc.ts routes through
                // cancelParticipantPicker, which also lands here).
                if (this.dialogStack[this.dialogStack.length - 1] === 'participant-picker-modal') {
                    this.dialogStack.pop();
                }
                this.participantPickerResolve = null;
                resolve(id);
            };
            this.participantPickerResolve = () => done(null);

            new PersonPicker({
                containerId: 'participant-picker',
                persons: DataManager.getAllPersons().filter(p => !p.isPlaceholder && p.id !== excludeId),
                onSelect: (personId) => done(personId),
            });
            // Clicking the backdrop cancels, like the other modals.
            modal.onclick = (e) => { if (e.target === modal) done(null); };
            // On the dialog stack so Escape resolves the promise instead of
            // closing the event editor underneath and stranding the await.
            this.pushDialog('participant-picker-modal');
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
        // The same rows edit a wedding's witnesses, in their own dialog.
        const list = document.getElementById(this.weddingWitnessesPartnershipId
            ? 'wedding-witnesses-list' : 'event-participants-list');
        if (!list) return;
        const esc = (t: string): string => this.escapeHtml(t);

        list.innerHTML = this.eventParticipants.map((p, i) => {
            const linked = p.personId ? DataManager.getPerson(p.personId) : null;
            const nameShown = linked ? shownNameOrEmpty(linked) : (p.name ?? '');
            // A role the app has no name for (a midwife from the research): its
            // own word on the "Present" option, the rest of the note in the field.
            const extra = extraParticipantRole(p);
            const roles = (['godparent', 'witness', 'officiant', 'other'] as ParticipantRole[])
                .map(r => `<option value="${r}"${p.role === r ? ' selected' : ''}>${esc(r === 'other' && extra ? strings.events.extraRoles[extra.role] : strings.events.roles[r])}</option>`)
                .join('');
            const noteShown = extra ? extra.rest : (p.note ?? '');
            return `
                <div class="participant-row" data-index="${i}">
                    <select class="participant-role" aria-label="${esc(strings.events.participants)}">${roles}</select>
                    <input type="text" class="participant-name${linked ? ' is-linked' : ''}"
                           value="${esc(nameShown)}" placeholder="${esc(strings.events.participantName)}"
                           aria-label="${esc(strings.events.participantName)}"${linked ? ' readonly' : ''}>
                    <input type="text" class="participant-note" value="${esc(noteShown)}"
                           placeholder="${esc(strings.events.participantNote)}"
                           aria-label="${esc(strings.events.participantNote)}">
                    <button type="button" class="participant-btn secondary participant-link${linked ? ' linked' : ''}"
                            title="${esc(linked ? strings.events.participantUnlink : strings.events.participantLink)}">
                        ${chainLinkSvg({ stroke: 'currentColor', size: 11, strokeWidth: 2 })}${linked ? ` ${esc(strings.events.participantInTree)}` : ''}
                    </button>
                    <button type="button" class="participant-btn secondary participant-del"
                            title="${esc(strings.events.delete)}" aria-label="${esc(strings.events.delete)}">${iconSvg('trash')}</button>
                </div>`;
        }).join('');

        list.querySelectorAll('.participant-row').forEach(row => {
            const i = Number(row.getAttribute('data-index'));
            const extra = extraParticipantRole(this.eventParticipants[i]);
            (row.querySelector('.participant-role') as HTMLSelectElement).onchange = (e) => {
                const p = this.eventParticipants[i];
                const now = extraParticipantRole(p);
                p.role = (e.target as HTMLSelectElement).value as ParticipantRole;
                // A role picked here replaces the file's word for it.
                if (now && p.role !== 'other') {
                    if (now.rest) p.note = now.rest;
                    else delete p.note;
                }
            };
            (row.querySelector('.participant-name') as HTMLInputElement).oninput = (e) => {
                this.eventParticipants[i].name = (e.target as HTMLInputElement).value;
            };
            (row.querySelector('.participant-note') as HTMLInputElement).oninput = (e) => {
                const value = (e.target as HTMLInputElement).value;
                const p = this.eventParticipants[i];
                // The file's role word stays in front ("Midwife — …"), as the research reads it.
                p.note = extra && p.role === 'other' ? (value.trim() ? `${extra.word} — ${value}` : extra.word) : value;
            };
            (row.querySelector('.participant-link') as HTMLButtonElement).onclick = () => this.toggleParticipantLink(i);
            (row.querySelector('.participant-del') as HTMLButtonElement).onclick = () => {
                this.eventParticipants.splice(i, 1);
                this.renderEventParticipants();
            };
        });

        // An event that names someone shows the field whatever its type is —
        // re-check here, because the rows are what decides it.
        const typeSelect = document.getElementById('input-event-type') as HTMLSelectElement | null;
        if (!this.coupleEventPartnershipId && !this.weddingWitnessesPartnershipId) {
            this.updateEventParticipantsVisibility((typeSelect?.value || 'custom') as LifeEventType);
        }
    },

    addEventParticipantRow(): void {
        // Baptism is the common case, so godparent is the useful default; at
        // a couple's banns or contract it is a witness.
        const couple = this.coupleEventPartnershipId || this.weddingWitnessesPartnershipId;
        this.eventParticipants.push({ id: generateParticipantId(), role: couple ? 'witness' : 'godparent', name: '' });
        this.renderEventParticipants();
        const list = this.weddingWitnessesPartnershipId ? '#wedding-witnesses-list' : '#event-participants-list';
        (document.querySelector(`${list} .participant-row:last-child .participant-name`) as HTMLInputElement | null)?.focus();
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
        const personId = await this.pickPerson(strings.events.participantLink,
            this.coupleEventPartnershipId || this.weddingWitnessesPartnershipId ? undefined : this.currentId ?? undefined);
        if (!personId) return;
        row.personId = personId;
        // Keep a name snapshot beside the link: the display prefers the live
        // person (see renderEventParticipants / participantsSummary), but if the
        // person is ever deleted the record keeps a name instead of a dangling
        // id. If the row had no name yet, snapshot the linked person's current
        // display name so the snapshot is never empty.
        if (!row.name?.trim()) {
            const linked = DataManager.getPerson(personId);
            if (linked) row.name = `${linked.firstName} ${linked.lastName}`.trim();
        }
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

    // ==================== WEDDING WITNESSES ====================

    /**
     * The wedding's witnesses, edited like an event's godparents: a role, a
     * name as the register writes it or a link to someone in the tree, a
     * note. The rows are held until Save, so Cancel really cancels; Save
     * writes them to the partnership inside the relationships panel's own
     * session (its Cancel takes them back too).
     */
    showWeddingWitnesses(partnershipId: PartnershipId): void {
        const partnership = DataManager.getPartnership(partnershipId);
        const modal = document.getElementById('wedding-witnesses-modal');
        if (!partnership || !modal || DataManager.isTreeLocked()) return;
        this.weddingWitnessesPartnershipId = partnershipId;
        this.eventParticipants = (partnership.participants ?? []).map(p => ({ ...p }));
        // A new list starts with one empty witness row, ready to type.
        if (this.eventParticipants.length === 0) {
            this.eventParticipants.push({ id: generateParticipantId(), role: 'witness', name: '' });
        }
        this.renderEventParticipants();
        this.weddingWitnessesSnapshot = JSON.stringify(this.collectEventParticipants());
        this.pushDialog('wedding-witnesses-modal');
        modal.classList.add('active');
        (modal.querySelector('.participant-row:last-child .participant-name:not([readonly])') as HTMLInputElement | null)?.focus();
    },

    saveWeddingWitnesses(): void {
        const id = this.weddingWitnessesPartnershipId;
        if (!id) return;
        DataManager.setPartnershipParticipants(id, this.collectEventParticipants());
        this.forceCloseWeddingWitnesses();
        this.refreshRelationshipsPanel();
    },

    /** Cancel / × / Escape: ask before throwing away edited rows. */
    closeWeddingWitnesses(): void {
        if (this.weddingWitnessesPartnershipId
            && JSON.stringify(this.collectEventParticipants()) !== this.weddingWitnessesSnapshot) {
            this.showUnsavedEditorDialog(strings.events.unsavedMessage,
                () => this.saveWeddingWitnesses(),
                () => this.forceCloseWeddingWitnesses());
            return;
        }
        this.forceCloseWeddingWitnesses();
    },

    forceCloseWeddingWitnesses(): void {
        document.getElementById('wedding-witnesses-modal')?.classList.remove('active');
        if (this.dialogStack[this.dialogStack.length - 1] === 'wedding-witnesses-modal') this.dialogStack.pop();
        this.weddingWitnessesPartnershipId = null;
        this.weddingWitnessesSnapshot = null;
        this.eventParticipants = [];
    },

    /** Open the event editor in "add" mode. */
    showAddEventModal(): void {
        if (!this.currentId) return;
        if (DataManager.isPersonLocked(this.currentId)) return;
        this.coupleEventPartnershipId = null;
        this.setCoupleEditorMode(null);
        this.editingEventId = null;
        this.eventParticipants = [];
        this.eventParticipantsPinned = false;
        this.populateEventTypeSelect();
        this.setEventEditorFields('baptism', '', '', '', '');
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
        this.coupleEventPartnershipId = null;
        this.setCoupleEditorMode(null);
        this.editingEventId = eventId;
        // A copy: editing the rows must not touch the stored event until Save.
        this.eventParticipants = (event.participants ?? []).map(p => ({ ...p }));
        this.eventParticipantsPinned = this.eventParticipants.length > 0;
        this.populateEventTypeSelect();
        this.setEventEditorFields(event.type, event.customLabel ?? '',
            formatDateForInput(event.date), event.place ?? '', event.note ?? '', event);
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
        this.updateEventParticipantsVisibility(select.value as LifeEventType);
        this.updateEventDetails(select.value as LifeEventType, false);
    },

    /**
     * Cause, age and house under the date and place, offered by type (a
     * baptism only the house). Changing the type keeps what is filled in, and
     * a filled field stays shown whatever the type.
     */
    updateEventDetails(type: LifeEventType, reset: boolean): void {
        const group = document.getElementById('event-details');
        if (!group) return;
        const label = document.getElementById('event-cause-label');
        if (label) label.textContent = type === 'death' ? strings.fields.cause : strings.fields.causeGeneric;
        const readOnly = !!this.currentId && DataManager.isPersonLocked(this.currentId);
        if (reset) resetDetailGroup(group, offeredDetails(type), readOnly);
        else refreshDetailGroup(group, offeredDetails(type), readOnly);
        for (const id of ['input-event-age', 'input-event-date']) {
            const input = document.getElementById(id);
            if (!input || input.dataset.ageCheck) continue;
            input.dataset.ageCheck = '1';
            input.addEventListener('input', () => this.updateEventAgeCheck());
        }
        this.updateEventAgeCheck();
    },

    /** "Calculated …" under the event's age, counted from the person's birth (or baptism). */
    updateEventAgeCheck(): void {
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
        const person = this.currentId ? DataManager.getPerson(this.currentId) : null;
        const date = normalizeDateInput(val('input-event-date'));
        renderAgeCheck(document.getElementById('event-age-check'), val('input-event-age'),
            ageBirthDate(person), date || undefined);
    },

    /** Offer godparents/witnesses only where a register would name them. */
    updateEventParticipantsVisibility(type: LifeEventType): void {
        const section = document.getElementById('event-participants-section');
        if (!section) return;
        if (this.eventParticipants.length > 0) this.eventParticipantsPinned = true;
        const show = eventTakesParticipants(type, this.eventParticipantsPinned);
        section.style.display = show ? '' : 'none';
    },

    /**
     * For an occupation, this field IS the occupation — it goes out as GEDCOM
     * OCCU. Labelling it "Note" invited "worked in Kladno as a blacksmith",
     * which then became the man's trade in every other program.
     */
    updateEventNoteLabel(type: LifeEventType): void {
        const label = document.getElementById('event-note-label');
        const input = document.getElementById('input-event-note') as HTMLTextAreaElement | null;
        // For these two the field is not a remark about the event, it IS the
        // event — the trade, the denomination — and goes out as the GEDCOM
        // tag's own value. Labelling it "Note" invited prose that then became
        // the man's trade in every other program.
        // A few carry a hint of their own; the rest are named well enough by
        // their type ("Title", "Nationality").
        const hints: Partial<Record<LifeEventType, { label: string; hint: string }>> = {
            occupation: { label: strings.events.occupationLabel, hint: strings.events.occupationHint },
            religion: { label: strings.events.religionLabel, hint: strings.events.religionHint },
        };
        const own = eventValueIsOnTag(type)
            ? (hints[type] ?? { label: strings.events.types[type], hint: '' })
            : null;
        if (label) label.textContent = own ? own.label : strings.events.note;
        if (input) {
            input.placeholder = own ? own.hint : '';
            input.rows = own ? 1 : 2;
        }
    },

    setEventEditorFields(type: LifeEventType, customLabel: string, date: string, place: string, note: string,
        details: Pick<LifeEvent, 'cause' | 'age' | 'address'> = {}): void {
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
        for (const key of DETAIL_KEYS) {
            const input = document.getElementById(`input-event-${key}`) as HTMLInputElement | null;
            if (input) input.value = details[key] ?? '';
        }
        this.updateEventCustomLabelVisibility();
        this.updateEventDetails(type, true);
    },

    openEventEditor(title: string): void {
        const titleEl = document.getElementById('event-editor-title');
        if (titleEl) titleEl.textContent = title;
        const modal = document.getElementById('event-editor-modal');
        if (!modal) return;
        // On the dialog stack, like every other dialog opened on top of
        // another: without an entry Escape fell through to the "close
        // everything" fallback and took the person modal underneath with it.
        this.pushDialog('event-editor-modal');
        modal.classList.add('active');
        autoGrowAll(modal, '#input-event-note');
        // Baseline for the "unsaved changes" question on close.
        this.eventEditorSnapshot = this.eventEditorState();
    },

    /** The editor's form values as one comparable string. */
    eventEditorState(): string {
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
        return JSON.stringify([
            val('input-event-type'), val('input-event-custom-label'), val('input-event-date'),
            val('input-event-place'), val('input-event-note'), this.collectEventParticipants(),
            ...DETAIL_KEYS.map(k => val(`input-event-${k}`)),
            val('input-event-age-1'), val('input-event-age-2'),
        ]);
    },

    hasEventEditorChanges(): boolean {
        if (this.eventEditorSnapshot === null) return false;
        if (!document.getElementById('event-editor-modal')?.classList.contains('active')) return false;
        return this.eventEditorState() !== this.eventEditorSnapshot;
    },

    /** Cancel / Escape: ask before throwing away edits, like the person modal. */
    closeEventEditor(): void {
        if (this.hasEventEditorChanges()) {
            this.showUnsavedEditorDialog(strings.events.unsavedMessage,
                () => this.saveEventFromModal(),
                () => this.forceCloseEventEditor());
            return;
        }
        this.forceCloseEventEditor();
    },

    forceCloseEventEditor(): void {
        const modal = document.getElementById('event-editor-modal');
        if (modal) modal.classList.remove('active');
        if (this.dialogStack[this.dialogStack.length - 1] === 'event-editor-modal') {
            this.dialogStack.pop();
        }
        this.editingEventId = null;
        this.coupleEventPartnershipId = null;
        this.eventEditorSnapshot = null;
    },

    /** Validate and persist the event editor, then refresh the list. */
    saveEventFromModal(): void {
        if (this.coupleEventPartnershipId) { this.saveCoupleEventFromModal(); return; }
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
        for (const key of DETAIL_KEYS) {
            const v = (document.getElementById(`input-event-${key}`) as HTMLInputElement | null)?.value.trim() ?? '';
            if (v) payload[key] = v;
            else if (this.editingEventId) payload[key] = undefined;
        }
        const participants = this.collectEventParticipants();

        if (this.editingEventId) {
            // An emptied field must reach updateLifeEvent as an explicit
            // undefined — a missing key would leave the old value in place.
            if (type !== 'custom') payload.customLabel = undefined;
            if (!date) payload.date = undefined;
            if (!place) payload.place = undefined;
            if (!note) payload.note = undefined;
            // The participants editor is always live, so always send the array —
            // even empty — or deleting the last participant would leave the old
            // list untouched (Object.assign never removes a key). updateLifeEvent
            // strips an empty array back out so stored events stay lean.
            payload.participants = participants;
            DataManager.updateLifeEvent(this.currentId, this.editingEventId, payload);
        } else {
            if (participants.length > 0) payload.participants = participants;
            DataManager.addLifeEvent(this.currentId, payload);
        }

        this.forceCloseEventEditor();
        this.renderEventsList();
        this.renderPersonLifeline(this.currentId);
        // The quick occupation/residence fields mirror the newest such event.
        this.refreshQuickFieldsFromEvents();
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
        const d = strings.danger;
        const confirmed = await this.showConfirm(`${what}\n\n${d.undoHint}`, d.deleteEventTitle(eventTypeLabel(event)),
            { confirmLabel: d.deleteEvent, variant: 'danger', note: this.researchArchiveDeleteNote() });
        if (!confirmed) return;
        DataManager.removeLifeEvent(this.currentId, eventId);
        this.renderEventsList();
        this.renderPersonLifeline(this.currentId);
        this.refreshQuickFieldsFromEvents();
    },
});
