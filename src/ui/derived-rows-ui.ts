/**
 * A person's part at another's event in the person dialog's list of events
 * (spec 085 §5): "Godparent · baptism: Anežka Hurdálková" with the date and
 * place below, a chain before it, a dashed line under it and ⋯ on the right.
 * The row opens the event where it is kept: a person's event in its editor
 * at that person, a couple's event in the couple's editor, the wedding in
 * its witnesses' dialog. The rows come from src/derived-participations.ts.
 *
 * Recording the part as an own event too (§6, K2.2): from the row's ⋯ and
 * from the menu of a linked participant's chip in the event editor and the
 * wedding witnesses' dialog, a new godparent / wedding witness event opens
 * prefilled (the date, the place, the same sources, roleAt naming the event)
 * and is created only on Save; its line "for the baptism: …" in the list.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { PersonId, PartnershipId, Gender, EventRoleAt, LifeEvent, ParticipantRole } from '../types.js';
import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { formatFlexDate, formatDateForInput } from '../dates.js';
import { chainLinkSvg } from '../icons.js';
import { shownName } from '../person-name.js';
import { MARRIAGE_EVENT_ID } from '../shared-events.js';
import {
    DerivedParticipation, ParticipationTarget, OwnRecordPrefill, derivedParticipations, derivedRoleLabel, derivedEventWord,
    ownRecordType, ownRecordPrefill, roleAtSubjects,
} from '../derived-participations.js';
import { extraParticipantRole } from '../godparents.js';
import { uiModule } from './module.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The names of the persons the event is of ("Václav Hurdálek and Ludmila Kalinová"). */
export function derivedSubjectNames(d: Pick<DerivedParticipation, 'subjects'>): string[] {
    return d.subjects.map(pid => DataManager.getPerson(pid)).filter(p => !!p).map(p => shownName(p!));
}

export const derivedRowsMethods = uiModule({
    /** The derived rows of the person in the dialog, in the order of their dates (undated last). */
    derivedRowsOf(personId: PersonId): DerivedParticipation[] {
        return derivedParticipations(DataManager.getData(), DataManager.getSharedEventIndex(), personId);
    },

    /** One derived row of the list of events; `i` is its index in the list the handlers read. */
    derivedRowHtml(d: DerivedParticipation, i: number, gender: Gender | undefined): string {
        const S = strings.events;
        const names = derivedSubjectNames(d);
        const open = S.derivedOpen(derivedEventWord(d), names.join(', '));
        const meta = [formatFlexDate(d.date), d.place].filter(Boolean).join(' · ');
        return `
            <div class="event-row derived" role="button" tabindex="0" data-derived-i="${i}" title="${esc(open)}">
                <span class="derived-mark" aria-hidden="true">${chainLinkSvg({ size: 14 })}</span>
                <div class="event-main">
                    <div class="derived-head"><span class="derived-role">${esc(derivedRoleLabel(d, gender))}</span> <span class="derived-names">${esc(joinAnd(getCurrentLanguage(), names))}</span></div>
                    ${meta ? `<div class="event-details-line derived-meta">${esc(meta)}</div>` : ''}
                </div>
                <div class="event-actions">
                    <button type="button" class="derived-more" aria-haspopup="menu" data-derived-i="${i}"
                        title="${esc(S.derivedMenu)}" aria-label="${esc(S.derivedMenu)}">⋯</button>
                </div>
            </div>`;
    },

    /** Clicks of the derived rows under `root` (`rows`: the list derivedRowHtml was given the indexes of). */
    bindDerivedRows(root: HTMLElement, rows: readonly DerivedParticipation[]): void {
        const rowOf = (el: HTMLElement): DerivedParticipation | undefined => rows[Number(el.dataset.derivedI)];
        root.querySelectorAll<HTMLElement>('.event-row.derived').forEach(row => {
            const open = () => { const d = rowOf(row); if (d) this.openDerivedEvent(d); };
            row.addEventListener('click', (e: MouseEvent) => {
                if ((e.target as HTMLElement).closest('.derived-more')) return;
                open();
            });
            row.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.target !== row) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
        });
        root.querySelectorAll<HTMLButtonElement>('.derived-more').forEach(btn => {
            btn.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                const d = rowOf(btn);
                if (d) this.openDerivedMenu(btn, d);
            });
        });
    },

    /** The ⋯ of a derived row: open the event (and record the part as the person's own, §6). */
    openDerivedMenu(anchor: HTMLElement, d: DerivedParticipation): void {
        const S = strings.events;
        const names = derivedSubjectNames(d).join(', ');
        this.openSharedMenu(anchor, [
            { label: S.derivedOpen(derivedEventWord(d), names), run: () => this.openDerivedEvent(d) },
            ...this.derivedMenuExtra(d),
        ], { width: 300, spanEl: anchor.closest<HTMLElement>('.event-row') });
    },

    /** More items of a derived row's ⋯ (§6 adds recordOwnMenuItems once the editor saves roleAt). */
    derivedMenuExtra(_d: DerivedParticipation): { label: string; hint?: string; run: () => void }[] {
        return [];
    },

    /** "Also record as an own event" in a derived row's ⋯ (§6a), for a part that has an own type. */
    recordOwnMenuItems(d: DerivedParticipation): { label: string; hint?: string; run: () => void }[] {
        const personId = this.currentId;
        const type = ownRecordType(d);
        if (!personId || !type || DataManager.isPersonLocked(personId)) return [];
        const S = strings.events;
        return [{
            label: S.recordOwn, hint: type === 'godparent' ? S.recordOwnHintGodparent : S.recordOwnHintWitness,
            run: () => this.recordOwnPart(personId, d),
        }];
    },

    /**
     * Open the event a derived row points at where it is kept: a person's
     * event in its editor at that person, a couple's event in the couple's
     * editor (over the dialog of its first partner), the wedding in its
     * witnesses' dialog (over the relationships of its first partner).
     * Unsaved changes of the person dialog are asked about first.
     */
    openDerivedEvent(t: ParticipationTarget): void {
        const go = () => {
            if (t.ownerPersonId) {
                this.openEventEditorFor(t.ownerPersonId, t.eventId);
                return;
            }
            const union = t.partnershipId ? DataManager.getPartnership(t.partnershipId) : undefined;
            if (!union) return;
            if (t.eventId === MARRIAGE_EVENT_ID) {
                this.showRelationshipsPanel(union.person1Id);
                if (!DataManager.isTreeLocked()) this.showWeddingWitnesses(union.id as PartnershipId);
                return;
            }
            const open = document.getElementById('person-modal')?.classList.contains('active');
            if (!open || this.currentId !== union.person1Id) {
                this.clearDialogStack();
                this.pushDialog('person-modal');
                this.showEditPersonModal(union.person1Id);
            }
            this.showEditCoupleEventModal(union.id as PartnershipId, t.eventId);
        };
        const modal = document.getElementById('person-modal');
        if (modal?.classList.contains('active')) this.leavePersonModalThen(go);
        else go();
    },

    /**
     * Record a person's part at an event as their own event (§6c): the
     * dialogs on the way are left first (unsaved changes asked about), the
     * person's dialog opens and over it the editor of a new event, prefilled.
     */
    recordOwnPart(personId: PersonId, part: Pick<DerivedParticipation, 'role' | 'extra' | 'eventId' | 'partnershipId' | 'ownerPersonId'>): void {
        const prefill = ownRecordPrefill(DataManager.getData(), part);
        if (!prefill || !DataManager.getPerson(personId) || DataManager.isPersonLocked(personId)) return;
        this.leaveEditorsThen(personId, () => this.showRecordOwnEditor(prefill));
    },

    /**
     * Leave the event editor, the wedding witnesses' dialog with the
     * relationships under it, and the person dialog of another person (each
     * asked about when changed), then open `personId`'s dialog and run `next`.
     */
    leaveEditorsThen(personId: PersonId, next: () => void): void {
        const active = (id: string) => !!document.getElementById(id)?.classList.contains('active');
        const toPerson = () => {
            const open = () => {
                if (!active('person-modal') || this.currentId !== personId) {
                    this.clearDialogStack();
                    this.pushDialog('person-modal');
                    this.showEditPersonModal(personId);
                }
                next();
            };
            if (active('person-modal') && this.currentId !== personId) this.leavePersonModalThen(open);
            else open();
        };
        if (active('event-editor-modal')) {
            const discard = () => { this.forceCloseEventEditor(); toPerson(); };
            if (this.hasEventEditorChanges()) {
                this.showUnsavedEditorDialog(strings.events.unsavedMessage, () => { if (this.saveEventFromModal()) toPerson(); }, discard);
            } else discard();
            return;
        }
        if (active('wedding-witnesses-modal')) {
            const changed = !!this.weddingWitnessesPartnershipId
                && JSON.stringify(this.collectEventParticipants()) !== this.weddingWitnessesSnapshot;
            const closePanel = () => { if (active('relationships-modal')) this.closeRelationshipsPanel(); };
            const discard = () => {
                this.forceCloseWeddingWitnesses();
                this.pendingPartnershipChanges.clear();
                closePanel();
                toPerson();
            };
            if (changed || this.hasRelationshipsChanges()) {
                this.showUnsavedEditorDialog(strings.events.unsavedMessage, () => {
                    if (this.weddingWitnessesPartnershipId) this.saveWeddingWitnesses();
                    if (active('relationships-modal')) this.saveRelationships();
                    closePanel();
                    toPerson();
                }, discard);
            } else discard();
            return;
        }
        toPerson();
    },

    /** The editor of a new own event, prefilled from the event the person took part in (created only on Save). */
    showRecordOwnEditor(prefill: OwnRecordPrefill): void {
        if (!this.currentId) return;
        this.showAddEventModal();
        this.recordOwnDraft = prefill;
        this.setEventEditorFields(prefill.type, '', formatDateForInput(prefill.date), prefill.place ?? '', '');
        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        if (select) select.disabled = true;
        this.updateEventParticipantsVisibility(prefill.type);
        this.renderRoleAtField(prefill.roleAt);
        const bar = document.getElementById('event-prefill-bar');
        if (bar) {
            const S = strings.events;
            const at = prefill.roleAt;
            bar.textContent = at.eventType === 'baptism' && at.personId ? S.recordOwnPrefilled
                : at.eventType === 'marriage' ? S.recordOwnPrefilledMarriage
                : S.recordOwnPrefilledEvent(derivedEventWord({ eventType: at.eventType, partnershipId: at.partnershipId }));
            bar.hidden = false;
        }
        // The sources come along (the same source, its page and QUAY); citing more waits for the saved event.
        const src = document.getElementById('event-sources-section');
        if (src) src.style.display = prefill.sourceIds?.length ? '' : 'none';
        const cite = document.getElementById('btn-cite-event');
        if (cite) cite.hidden = true;
        this.renderRecordOwnSources();
        this.eventEditorSnapshot = this.eventEditorState();
    },

    /** The prefilled sources of a new own record, each removable before Save. */
    renderRecordOwnSources(): void {
        this.renderSourceChips('event-sources-chips', this.recordOwnDraft?.sourceIds, 'uncitePrefilledSource');
    },

    uncitePrefilledSource(sourceId: string): void {
        const draft = this.recordOwnDraft;
        if (!draft?.sourceIds) return;
        draft.sourceIds = draft.sourceIds.filter(id => id !== sourceId);
        if (draft.citationQuay?.sourceIds) delete draft.citationQuay.sourceIds[sourceId];
        this.renderRecordOwnSources();
    },

    /** The read-only "For the baptism" field: whose event an own record belongs to (null hides it). */
    renderRoleAtField(at: EventRoleAt | undefined | null): void {
        const group = document.getElementById('event-roleat-group');
        const label = document.getElementById('event-roleat-label');
        const value = document.getElementById('event-roleat-value');
        if (!group || !label || !value) return;
        const texts = at ? this.roleAtTexts(at) : null;
        group.hidden = !texts;
        if (!texts) { value.innerHTML = ''; return; }
        label.textContent = texts.label;
        value.innerHTML = `${chainLinkSvg({ size: 14 })}<span class="event-roleat-text">${esc(texts.names)}${texts.date
            ? ` <span class="event-roleat-meta">· ${esc(texts.date)}</span>` : ''}</span>`;
    },

    /** The field's label, the line under an own record ("for the baptism: …"), the names and the event's date. */
    roleAtTexts(at: EventRoleAt): { label: string; line: string; names: string; date: string } | null {
        const S = strings.events;
        const data = DataManager.getData();
        const pids = roleAtSubjects(data, DataManager.getSharedEventIndex(), at);
        const names = joinAnd(getCurrentLanguage(), pids.map(pid => DataManager.getPerson(pid)).filter(p => !!p).map(p => shownName(p!)));
        if (!names) return null;
        let date: string | undefined;
        if (at.personId) date = data.persons[at.personId]?.events?.find(e => e.id === at.eventId)?.date;
        else if (at.partnershipId) {
            const union = data.partnerships[at.partnershipId];
            date = at.eventId === MARRIAGE_EVENT_ID ? union?.startDate : union?.events?.find(e => e.id === at.eventId)?.date;
        }
        const baptism = at.eventType === 'baptism' && !!at.personId;
        const marriage = at.eventType === 'marriage';
        const word = derivedEventWord({ eventType: at.eventType, partnershipId: at.partnershipId });
        return {
            label: baptism ? S.refBaptism : marriage ? S.refMarriage : S.refEvent,
            line: baptism ? S.refLine(names) : marriage ? S.refLineMarriage(names) : S.refLineOther(word, names),
            names,
            date: formatFlexDate(date) ?? '',
        };
    },

    /** The line under an own record in the list of events ('' for any other event). */
    refLineHtml(event: LifeEvent): string {
        const texts = event.roleAt ? this.roleAtTexts(event.roleAt) : null;
        if (!texts) return '';
        return `<div class="ref-line">${chainLinkSvg({ size: 13 })}<span class="ref-line-text">${esc(texts.line)}</span></div>`;
    },

    /** Put back what showRecordOwnEditor changed in the editor. */
    resetRecordOwnEditor(): void {
        this.recordOwnDraft = null;
        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        if (select) select.disabled = false;
        const bar = document.getElementById('event-prefill-bar');
        if (bar) { bar.hidden = true; bar.textContent = ''; }
        const cite = document.getElementById('btn-cite-event');
        if (cite) cite.hidden = false;
        this.renderRoleAtField(null);
    },

    /** The new own record's fields beyond the form (roleAt, the sources) and its toast after the save. */
    recordOwnPayload(payload: Omit<LifeEvent, 'id'>): string | null {
        const draft = this.recordOwnDraft;
        if (!draft || this.editingEventId) return null;
        payload.roleAt = { ...draft.roleAt };
        if (draft.sourceIds?.length) payload.sourceIds = [...draft.sourceIds];
        const quay = draft.citationQuay?.sourceIds;
        if (quay && Object.keys(quay).length) payload.citationQuay = { sourceIds: { ...quay } };
        const person = this.currentId ? DataManager.getPerson(this.currentId) : null;
        return strings.events.recordedOwn(strings.events.types[draft.type], person ? shownName(person) : '');
    },

    /**
     * The chip of a participant linked to someone in the tree (§6b): its menu
     * opens the person, records the part as their own event (when the event
     * is saved and the part has an own type), or drops the link.
     */
    openParticipantChipMenu(anchor: HTMLElement, index: number): void {
        const row = this.eventParticipants[index];
        const pid = row?.personId;
        const person = pid ? DataManager.getPerson(pid) : null;
        if (!row || !pid || !person) return;
        const S = strings.events;
        const items: { label: string; hint?: string; danger?: boolean; divide?: boolean; run: () => void }[] = [
            { label: S.sharedOpenPerson, run: () => this.leaveEditorsThen(pid, () => {}) },
        ];
        const part = this.participantPart(row.role, row.note);
        const type = part ? ownRecordType(part) : null;
        if (part && type && !DataManager.isPersonLocked(pid) && ownRecordPrefill(DataManager.getData(), part)) {
            items.push({
                label: S.recordOwn, hint: type === 'godparent' ? S.recordOwnHintGodparent : S.recordOwnHintWitness,
                run: () => this.recordOwnPart(pid, part),
            });
        }
        items.push({ label: S.unlink, divide: true, run: () => { void this.toggleParticipantLink(index); } });
        this.openSharedMenu(anchor, items, { width: 300, spanEl: anchor.closest<HTMLElement>('.participant-row'), title: shownName(person) });
    },

    /** The saved event the participants being edited belong to, with a row's part in it (null: a new event). */
    participantPart(role: ParticipantRole, note: string | undefined): Pick<DerivedParticipation, 'role' | 'extra' | 'eventId' | 'partnershipId' | 'ownerPersonId'> | null {
        const extra = extraParticipantRole({ role, note })?.role;
        const base = { role, ...(extra ? { extra } : {}) };
        if (this.weddingWitnessesPartnershipId) return { ...base, partnershipId: this.weddingWitnessesPartnershipId, eventId: MARRIAGE_EVENT_ID };
        if (!this.editingEventId) return null;
        if (this.coupleEventPartnershipId) return { ...base, partnershipId: this.coupleEventPartnershipId, eventId: this.editingEventId };
        return this.currentId ? { ...base, ownerPersonId: this.currentId, eventId: this.editingEventId } : null;
    },
});
