/**
 * The couple's own events (banns, a contract, a census of the household…):
 * the list under the wedding in the relationships panel, and the event editor
 * opened for a couple instead of a person.
 *
 * Kept out of sight until wanted: a couple without events shows nothing new,
 * and "+ couple event" is offered only in the advanced mode (or once the list
 * already holds something). The wedding and the divorce stay the
 * partnership's own fields; nobody has to enter a wedding as an event.
 *
 * The editor is the person's event editor (#event-editor-modal) in a couple
 * mode: other types, each partner's age instead of one, a subtitle naming the
 * couple, Delete in the footer. Each change goes straight through DataManager;
 * inside the relationships panel its edit session makes them part of the
 * panel's Save / Cancel like the wedding witnesses.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { CoupleEvent, CoupleEventType, Partnership, PartnershipId, Person } from '../types.js';
import { strings } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { formatDateForInput, formatFlexDate, normalizeDateInput } from '../dates.js';
import {
    COUPLE_EVENT_GROUPS, coupleEventDetails, coupleEventLabel, isCoupleEventType, sortCoupleEvents,
} from '../events.js';
import { uiModule } from './module.js';
import { DetailKey, refreshDetailGroup, renderAgeCheck, resetDetailGroup, ageBirthDate } from './event-details-ui.js';
import { factStatusHtml } from './fact-status.js';
import { shownName } from '../person-name.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fullName = (p: Person | null): string => p ? shownName(p) : '?';

/** Change a label's words, keeping the "?" a long field hint hangs on it (installFieldHints). */
function setLabelText(label: HTMLElement | null, text: string): void {
    if (!label) return;
    const words = [...label.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
    if (words) words.nodeValue = text;
    else label.prepend(document.createTextNode(text));
}

/** The detail keys of the shared detail group a couple event type offers ('ages' rides on the age field). */
function offeredCoupleDetails(type: CoupleEventType): DetailKey[] {
    return coupleEventDetails(type).map(k => k === 'ages' ? 'age' : k);
}

/** "22. 1. 1888 · Dolní Lhota", or "no date · Dolní Lhota". */
function dateAndPlace(ev: CoupleEvent): string {
    return [formatFlexDate(ev.date) || strings.partnerEvents.noDate, ev.place?.trim()]
        .filter(Boolean).join(' · ');
}

export const coupleEventsMethods = uiModule({
    /** Both partners, HUSB first (the order of the GEDCOM family), else as stored. */
    couplePartners(partnership: Partnership): [Person | null, Person | null] {
        return this.partnersInGedcomOrder(partnership);
    },

    /**
     * The quiet second line of a row: house · witnesses · sources · note, only
     * what is filled in.
     */
    coupleEventSecondLine(ev: CoupleEvent): string {
        const pe = strings.partnerEvents;
        const people = (ev.participants ?? []).map(p => {
            const linked = p.personId ? DataManager.getPerson(p.personId) : null;
            return { role: p.role, name: linked ? fullName(linked) : (p.name ?? '') };
        }).filter(p => p.name);
        const witnesses = people.filter(p => p.role === 'witness').map(p => p.name);
        const others = people.filter(p => p.role !== 'witness').map(p => p.name);
        return [
            ev.address?.trim() ?? '',
            witnesses.length ? pe.witnesses(witnesses.join(', ')) : '',
            others.join(', '),
            ev.sourceIds?.length ? pe.sourceCount(ev.sourceIds.length) : '',
            ev.note?.trim() ? pe.hasNote : '',
        ].filter(Boolean).join(' · ');
    },

    /**
     * The "Couple's events" block of one partnership in the relationships
     * panel ('' when the couple has none), "+ couple event" under the list.
     * On a phone it collapses into one row naming the types, expanded in
     * place by its toggle (CSS shows the toggle under 500 px only).
     */
    coupleEventsBlockHtml(partnership: Partnership, readOnly: boolean): string {
        const events = sortCoupleEvents(partnership.events ?? []);
        if (events.length === 0) return '';
        const pe = strings.partnerEvents;
        const id = esc(partnership.id);
        const rows = events.map(ev => {
            const label = coupleEventLabel(ev);
            const meta = dateAndPlace(ev);
            const second = this.coupleEventSecondLine(ev);
            const inner = `
                <span class="couple-event-main"><span class="couple-event-type">${esc(label)}</span><span class="couple-event-dash"> — </span><span class="couple-event-meta">${esc(meta)}</span>${factStatusHtml(ev.status)}</span>
                ${second ? `<span class="couple-event-sub">${esc(second)}</span>` : ''}`;
            return readOnly
                ? `<div class="couple-event-row readonly">${inner}</div>`
                : `<button type="button" class="couple-event-row" data-partnership-id="${id}" data-event-id="${esc(ev.id)}"
                    aria-label="${esc([label, meta].join(', '))}">${inner}</button>`;
        }).join('');
        const expanded = this.expandedCoupleEvents.has(partnership.id);
        const summary = pe.summary(events.length,
            [...new Set(events.map(ev => coupleEventLabel(ev).toLocaleLowerCase()))].join(', '));
        return `
            <div class="couple-events${expanded ? ' expanded' : ''}" data-partnership-id="${id}">
                <button type="button" class="couple-events-toggle" aria-expanded="${expanded}" data-partnership-id="${id}"
                    aria-label="${esc(expanded ? pe.collapse : pe.expand)}">
                    <span class="couple-events-toggle-title">${esc(pe.title)}</span>
                    <span class="couple-events-toggle-summary">${esc(summary)}</span>
                    <span class="couple-events-toggle-chev" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
                </button>
                <div class="couple-events-title">${esc(pe.title)}</div>
                <div class="couple-events-list">
                    ${rows}
                    ${readOnly ? '' : `<button type="button" class="couple-event-add" data-partnership-id="${id}">${esc(pe.add)}</button>`}
                </div>
            </div>`;
    },

    /** "+ couple event" among the quiet links under the wedding, while the couple has no events. */
    coupleEventAddLinkHtml(partnership: Partnership, readOnly: boolean): string {
        if (readOnly || partnership.events?.length || !SettingsManager.isAdvancedFields()) return '';
        return `<button type="button" class="couple-event-add pg-add-event" data-partnership-id="${esc(partnership.id)}">${esc(strings.partnerEvents.add)}</button>`;
    },

    /** Wire the couple-event rows, links and phone toggles rendered into `content`. */
    bindCoupleEvents(content: HTMLElement): void {
        content.querySelectorAll<HTMLElement>('.couple-event-row[data-event-id]').forEach(btn => {
            btn.addEventListener('click', () => this.showEditCoupleEventModal(
                btn.dataset.partnershipId as PartnershipId, btn.dataset.eventId ?? ''));
        });
        content.querySelectorAll<HTMLElement>('.couple-event-add[data-partnership-id]').forEach(btn => {
            btn.addEventListener('click', () => this.showAddCoupleEventModal(btn.dataset.partnershipId as PartnershipId));
        });
        content.querySelectorAll<HTMLElement>('.couple-events-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const pid = btn.dataset.partnershipId ?? '';
                const block = btn.closest<HTMLElement>('.couple-events');
                const open = !this.expandedCoupleEvents.has(pid);
                if (open) this.expandedCoupleEvents.add(pid); else this.expandedCoupleEvents.delete(pid);
                block?.classList.toggle('expanded', open);
                btn.setAttribute('aria-expanded', String(open));
                btn.setAttribute('aria-label', open ? strings.partnerEvents.collapse : strings.partnerEvents.expand);
                const chev = btn.querySelector('.couple-events-toggle-chev');
                if (chev) chev.textContent = open ? '▾' : '▸';
            });
        });
    },

    // ==================== EDITOR ====================

    /** Open the event editor to add an event to a couple (Banns first: the common case). */
    showAddCoupleEventModal(partnershipId: PartnershipId): void {
        const partnership = DataManager.getPartnership(partnershipId);
        if (!partnership || DataManager.isTreeLocked()) return;
        this.coupleEventPartnershipId = partnershipId;
        this.editingEventId = null;
        this.eventParticipants = [];
        this.eventParticipantsPinned = false;
        this.setCoupleEditorMode(partnership);
        this.setCoupleEditorFields(partnership, { type: 'banns' });
        this.renderEventParticipants();
        const src = document.getElementById('event-sources-section');
        if (src) src.style.display = 'none';
        this.openEventEditor(strings.partnerEvents.addTitle);
    },

    /** Open the event editor on one of a couple's events. */
    showEditCoupleEventModal(partnershipId: PartnershipId, eventId: string): void {
        const partnership = DataManager.getPartnership(partnershipId);
        const ev = DataManager.getCoupleEvent(partnershipId, eventId);
        if (!partnership || !ev) return;
        this.coupleEventPartnershipId = partnershipId;
        this.editingEventId = eventId;
        this.eventParticipants = (ev.participants ?? []).map(p => ({ ...p }));
        this.eventParticipantsPinned = true;
        this.setCoupleEditorMode(partnership);
        this.setCoupleEditorFields(partnership, ev);
        this.renderEventParticipants();
        const src = document.getElementById('event-sources-section');
        if (src) src.style.display = (SettingsManager.isAdvancedFields() || ev.sourceIds?.length) ? '' : 'none';
        this.renderEventSourcesChips();
        this.openEventEditor(strings.partnerEvents.editTitle);
        const del = document.getElementById('btn-delete-event');
        if (del) del.hidden = DataManager.isTreeLocked();
    },

    /**
     * Switch the shared editor between a person's event (null) and a couple's:
     * the type list, the subtitle, the participants' heading, the two ages,
     * Delete in the footer.
     */
    setCoupleEditorMode(partnership: Partnership | null): void {
        const couple = !!partnership;
        const pe = strings.partnerEvents;
        const subtitle = document.getElementById('event-editor-subtitle');
        if (subtitle) {
            subtitle.hidden = !couple;
            if (partnership) {
                const [a, b] = this.couplePartners(partnership);
                subtitle.textContent = pe.couple(fullName(a), fullName(b));
            }
        }
        document.getElementById('event-editor-modal')?.classList.toggle('is-couple-event', couple);
        setLabelText(document.getElementById('event-participants-label'), couple ? pe.participants : strings.events.participants);
        const hint = document.getElementById('event-participants-hint');
        if (hint) hint.textContent = couple ? pe.participantsHint : strings.events.participantsHint;
        const personAge = document.querySelector<HTMLElement>('#event-details .event-person-age');
        const coupleAges = document.querySelector<HTMLElement>('#event-details .event-couple-ages');
        if (personAge) personAge.hidden = couple;
        if (coupleAges) coupleAges.hidden = !couple;
        // The hidden half of the age field holds nothing (a filled one would show the field).
        for (const id of couple ? ['input-event-age'] : ['input-event-age-1', 'input-event-age-2']) {
            const input = document.getElementById(id) as HTMLInputElement | null;
            if (input) input.value = '';
        }
        const del = document.getElementById('btn-delete-event');
        if (del) del.hidden = true;
        const status = document.getElementById('event-status-note');
        if (status) status.hidden = true;
        if (!couple) return;

        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        if (select) {
            select.innerHTML = COUPLE_EVENT_GROUPS.map(g => `<optgroup label="${esc(pe.groups[g.group])}">${
                g.types.map(t => `<option value="${t}">${esc(pe.types[t])}</option>`).join('')}</optgroup>`).join('');
            select.onchange = () => this.updateCoupleEventType(false);
        }
        // Each partner named under their field (the age check line carries it).
        const [a, b] = this.couplePartners(partnership);
        const ageInputs = [a, b].map((p, i) => document.getElementById(`input-event-age-${i + 1}`) as HTMLInputElement | null);
        ageInputs.forEach((input, i) => {
            const p = [a, b][i];
            if (!input) return;
            input.dataset.personId = p?.id ?? '';
            input.setAttribute('aria-label', pe.ageOf(fullName(p)));
            input.closest<HTMLElement>('.pg-age')!.hidden = !p;
            if (!input.dataset.ageCheck) {
                input.dataset.ageCheck = '1';
                input.addEventListener('input', () => this.updateCoupleEventAgeChecks());
            }
        });
        const date = document.getElementById('input-event-date') as HTMLInputElement | null;
        if (date && !date.dataset.coupleAgeCheck) {
            date.dataset.coupleAgeCheck = '1';
            date.addEventListener('input', () => { if (this.coupleEventPartnershipId) this.updateCoupleEventAgeChecks(); });
        }
    },

    /** Fill the editor from a couple's event (or the defaults of a new one). */
    setCoupleEditorFields(partnership: Partnership, ev: Partial<CoupleEvent> & { type: CoupleEventType }): void {
        const set = (id: string, value: string | undefined) => {
            const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
            if (input) input.value = value ?? '';
        };
        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        if (select) select.value = ev.type;
        set('input-event-custom-label', ev.customLabel);
        set('input-event-date', formatDateForInput(ev.date));
        set('input-event-place', ev.place);
        set('input-event-note', ev.note);
        set('input-event-cause', ev.cause);
        set('input-event-address', ev.address);
        set('input-event-age', '');
        const [a, b] = this.couplePartners(partnership);
        set('input-event-age-1', a ? ev.ages?.[a.id] : '');
        set('input-event-age-2', b ? ev.ages?.[b.id] : '');
        this.updateCoupleEventType(true);
    },

    /**
     * The type decides what is offered: the label of a custom event, the
     * details behind the quiet link, the sentence that the couple's status
     * stays. Nothing filled in is ever cleared by a change of type.
     */
    updateCoupleEventType(reset: boolean): void {
        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        const type = (isCoupleEventType(select?.value) ? select!.value : 'custom') as CoupleEventType;
        const labelGroup = document.getElementById('event-custom-label-group');
        if (labelGroup) labelGroup.style.display = type === 'custom' ? '' : 'none';
        setLabelText(document.getElementById('event-note-label'), strings.events.note);
        const note = document.getElementById('input-event-note') as HTMLTextAreaElement | null;
        if (note) { note.placeholder = ''; note.rows = 2; }
        const status = document.getElementById('event-status-note');
        if (status) {
            status.textContent = strings.partnerEvents.statusUnchanged;
            status.hidden = type !== 'divorceFiled' && type !== 'annulment';
        }
        setLabelText(document.getElementById('event-cause-label'), strings.fields.causeGeneric);
        setLabelText(document.getElementById('event-age-label'), strings.fields.age);
        // Witnesses are what the banns and a contract are read for: always offered.
        const section = document.getElementById('event-participants-section');
        if (section) section.style.display = '';
        const group = document.getElementById('event-details');
        if (group) {
            const readOnly = DataManager.isTreeLocked();
            if (reset) resetDetailGroup(group, offeredCoupleDetails(type), readOnly);
            else refreshDetailGroup(group, offeredCoupleDetails(type), readOnly);
        }
        this.updateCoupleEventAgeChecks();
    },

    /** "Jan, calculated 24 years" under each partner's age, from their birth and the event's date. */
    updateCoupleEventAgeChecks(): void {
        const pid = this.coupleEventPartnershipId;
        const partnership = pid ? DataManager.getPartnership(pid) : null;
        if (!partnership) return;
        const [a, b] = this.couplePartners(partnership);
        const date = normalizeDateInput((document.getElementById('input-event-date') as HTMLInputElement | null)?.value ?? '');
        [a, b].forEach((p, i) => {
            const input = document.getElementById(`input-event-age-${i + 1}`) as HTMLInputElement | null;
            if (!p || !input) return;
            renderAgeCheck(document.getElementById(`event-age-check-${i + 1}`), input.value,
                ageBirthDate(p), date || undefined, p.firstName || fullName(p));
        });
    },

    /** Each partner's age as typed, by person id ({} when none). */
    collectCoupleEventAges(): Record<string, string> {
        const ages: Record<string, string> = {};
        for (const i of [1, 2]) {
            const input = document.getElementById(`input-event-age-${i}`) as HTMLInputElement | null;
            const value = input?.value.trim();
            const personId = input?.dataset.personId;
            if (value && personId) ages[personId] = value;
        }
        return ages;
    },

    /** Validate and store the couple's event, then refresh what shows it. */
    saveCoupleEventFromModal(): void {
        const partnershipId = this.coupleEventPartnershipId;
        if (!partnershipId) return;
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        const type = (isCoupleEventType(select?.value) ? select!.value : 'custom') as CoupleEventType;
        const customLabel = val('input-event-custom-label');
        const date = normalizeDateInput(val('input-event-date'));
        if (date === null) {
            this.showAlert(strings.personModal.invalidDate, 'warning');
            return;
        }
        if (type === 'custom' && !customLabel) {
            this.showAlert(strings.events.customLabelRequired, 'warning');
            return;
        }
        const ages = this.collectCoupleEventAges();
        const participants = this.collectEventParticipants();
        const fields: Omit<CoupleEvent, 'id'> = {
            type,
            customLabel: type === 'custom' ? customLabel : undefined,
            date: date || undefined,
            place: val('input-event-place') || undefined,
            cause: val('input-event-cause') || undefined,
            address: val('input-event-address') || undefined,
            note: val('input-event-note') || undefined,
            ages: Object.keys(ages).length ? ages : undefined,
        };
        if (this.editingEventId) {
            // The list is always live: an empty one removes the last person.
            DataManager.updateCoupleEvent(partnershipId, this.editingEventId, { ...fields, participants });
        } else {
            DataManager.addCoupleEvent(partnershipId, { ...fields, ...(participants.length ? { participants } : {}) });
        }
        this.forceCloseEventEditor();
        this.afterCoupleEventChange();
    },

    /** Delete in the editor's footer: say which event, ask, remove. */
    async deleteEventFromEditor(): Promise<void> {
        const partnershipId = this.coupleEventPartnershipId;
        const eventId = this.editingEventId;
        const ev = partnershipId && eventId ? DataManager.getCoupleEvent(partnershipId, eventId) : null;
        if (!partnershipId || !eventId || !ev) return;
        const label = coupleEventLabel(ev);
        const what = `${label} — ${dateAndPlace(ev)}`;
        const d = strings.danger;
        const confirmed = await this.showConfirm(`${what}\n\n${d.undoHint}`, d.deleteEventTitle(label),
            { confirmLabel: d.deleteEvent, variant: 'danger', note: this.researchArchiveDeleteNote() });
        if (!confirmed) return;
        DataManager.removeCoupleEvent(partnershipId, eventId);
        this.forceCloseEventEditor();
        this.afterCoupleEventChange();
    },

    /** Re-render what shows a couple's events: the relationships panel, the person's life timeline. */
    afterCoupleEventChange(): void {
        if (this.relationshipsPanelPersonId) this.refreshRelationshipsPanel();
        if (this.currentId && document.getElementById('person-modal')?.classList.contains('active')) {
            this.renderPersonLifeline(this.currentId);
        }
    },
});
