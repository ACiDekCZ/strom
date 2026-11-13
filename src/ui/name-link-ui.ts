/**
 * Link a godparent or a witness recorded by name to the person of the tree
 * they probably are (spec 085 §6, K1.4).
 *
 * In the event editor and the wedding witnesses' dialog (6e, 6f): under a
 * participant written by name whom persons of the tree match
 * (src/participant-match.ts), a grey bar offers them — one candidate with
 * Link · Not this person, several one under another, each with Link, and
 * None of them. Link sets the person and keeps the name as written; a
 * rejection is kept with the participant and the offer is not made again.
 * Both wait for the editor's Save like every other change of its rows.
 *
 * In Data quality (6g, 6h): a trace "n godparents and witnesses recorded by
 * name match a person in the tree" with Review one by one, which lists them
 * with the same choices and Later (hidden until the dialog closes). There a
 * choice is saved at once, one undo step each. Nothing is ever linked by
 * itself.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { PersonId, StromData, EventParticipant } from '../types.js';
import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { normalizeDateInput, formatFlexDate } from '../dates.js';
import { shownName } from '../person-name.js';
import {
    findParticipantMatches, linkableParticipant, matchMeta, nameLinkLeads, rejectedNameLinks,
    type MatchEvent, type ParticipantMatch, type NameLinkLead, type ParticipantRef,
} from '../participant-match.js';
import { derivedRoleLabel } from '../derived-participations.js';
import { uiModule } from './module.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One lead's key in the dialog (Later hides it until the dialog closes). */
export function nameLinkKey(ref: ParticipantRef): string {
    return [ref.ownerPersonId ?? ref.partnershipId ?? '', ref.eventId, ref.participantId].join('\u0000');
}

/** The leads the open list shows, by their index in it (the buttons carry the index). */
let listed: NameLinkLead[] = [];

export const nameLinkMethods = uiModule({
    // ==================== THE EVENT EDITOR (6e, 6f) ====================

    /** The event the rows being edited belong to: its date and its persons, as the form holds them now. */
    participantMatchEvent(): MatchEvent {
        const linked = this.eventParticipants.map(p => p.personId).filter((pid): pid is PersonId => !!pid);
        const union = this.weddingWitnessesPartnershipId ?? this.coupleEventPartnershipId;
        const couple = union ? DataManager.getPartnership(union) : null;
        if (this.weddingWitnessesPartnershipId) {
            return { date: couple?.startDate, subjects: couple ? [couple.person1Id, couple.person2Id] : [], exclude: linked };
        }
        const input = document.getElementById('input-event-date') as HTMLInputElement | null;
        const raw = input?.value.trim() ?? '';
        const date = raw ? normalizeDateInput(raw) ?? undefined : undefined;
        const subjects = couple ? [couple.person1Id, couple.person2Id] : this.currentId ? [this.currentId] : [];
        return { date, subjects, exclude: linked };
    },

    /** The persons a row recorded by name may be (none for a linked row, a priest or a rejected candidate). */
    participantMatches(p: EventParticipant): ParticipantMatch[] {
        if (!linkableParticipant(p)) return [];
        const ev = this.participantMatchEvent();
        return findParticipantMatches(DataManager.getData(), p.name!, {
            ...ev, exclude: [...(ev.exclude ?? []), ...(p.linkRejected ?? [])],
        }, DataManager.getPersonNameIndex());
    },

    /** The grey bar under a row recorded by name ('' without candidates). */
    participantOfferHtml(index: number): string {
        const p = this.eventParticipants[index];
        if (!p || DataManager.isReadOnly()) return '';
        const matches = this.participantMatches(p);
        if (matches.length === 0) return '';
        const S = strings.events;
        const nameOf = (m: ParticipantMatch): string => {
            const person = DataManager.getPerson(m.personId);
            return person ? shownName(person) : p.name!.trim();
        };
        if (matches.length === 1) {
            const m = matches[0];
            const meta = matchMeta(m);
            return `<div class="participant-offer" role="group" aria-label="${esc(S.link)}">
                <span class="participant-offer-text">${esc(meta ? S.linkOffer(nameOf(m), meta) : S.linkOffer(nameOf(m), '').replace(' ()', ''))}</span>
                <span class="participant-offer-btns">
                    <button type="button" class="participant-offer-link" data-offer-link="${esc(m.personId)}">${esc(S.link)}</button>
                    <button type="button" class="participant-offer-reject secondary" data-offer-reject>${esc(S.notThisPerson)}</button>
                </span>
            </div>`;
        }
        const cands = matches.map(m => {
            const meta = matchMeta(m, ' · ');
            return `<div class="participant-offer-cand">
                <span class="participant-offer-who"><span class="participant-offer-name">${esc(nameOf(m))}</span>${meta ? ` <span class="participant-offer-meta">${esc(meta)}</span>` : ''}</span>
                <button type="button" class="participant-offer-link" data-offer-link="${esc(m.personId)}"
                    aria-label="${esc(`${S.link}: ${nameOf(m)}${meta ? ` ${meta}` : ''}`)}">${esc(S.link)}</button>
            </div>`;
        }).join('');
        return `<div class="participant-offer is-many" role="group" aria-label="${esc(S.link)}">
            <span class="participant-offer-text">${esc(S.linkOfferMany(matches.length, p.name!.trim()))}</span>
            ${cands}
            <button type="button" class="participant-offer-reject participant-offer-none" data-offer-reject>${esc(S.noneOfThem)}</button>
        </div>`;
    },

    /** Put a row's bar in place (after the name or the date changed), without redrawing the row. */
    refreshParticipantOffer(row: Element, index: number): void {
        row.querySelector('.participant-offer')?.remove();
        const html = this.participantOfferHtml(index);
        if (html) row.insertAdjacentHTML('beforeend', html);
        this.bindParticipantOffer(row, index);
    },

    /** Every row's bar again (the event's date changed). */
    refreshParticipantOffers(): void {
        const list = document.getElementById(this.weddingWitnessesPartnershipId ? 'wedding-witnesses-list' : 'event-participants-list');
        list?.querySelectorAll('.participant-row').forEach(row => {
            const i = Number(row.getAttribute('data-index'));
            if (!this.eventParticipants[i]?.personId) this.refreshParticipantOffer(row, i);
        });
    },

    /** Link · Not this person · None of them of a row's bar. */
    bindParticipantOffer(row: Element, index: number): void {
        const bar = row.querySelector<HTMLElement>('.participant-offer');
        if (!bar) return;
        bar.onclick = (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
            if (!btn || !bar.contains(btn)) return;
            const p = this.eventParticipants[index];
            if (!p) return;
            const link = btn.dataset.offerLink as PersonId | undefined;
            if (link) {
                const person = DataManager.getPerson(link);
                if (!person) return;
                // The name as the register wrote it stays beside the link.
                p.personId = link;
                delete p.linkRejected;
                this.renderEventParticipants();
                this.showToast(strings.events.linked(shownName(person)));
                const list = document.getElementById(this.weddingWitnessesPartnershipId ? 'wedding-witnesses-list' : 'event-participants-list');
                list?.querySelector<HTMLElement>(`.participant-row[data-index="${index}"] .participant-link`)?.focus();
                return;
            }
            if (btn.hasAttribute('data-offer-reject')) {
                const ids = this.participantMatches(p).map(m => m.personId);
                p.linkRejected = [...new Set([...(p.linkRejected ?? []), ...ids])];
                this.refreshParticipantOffer(row, index);
                (row.querySelector('.participant-name') as HTMLElement | null)?.focus();
            }
        };
    },

    /** The editor's date field redraws the bars when it changes (wired once). */
    wireParticipantOfferDate(): void {
        const input = document.getElementById('input-event-date') as HTMLInputElement | null;
        if (!input || input.dataset.offerWired) return;
        input.dataset.offerWired = '1';
        input.addEventListener('change', () => {
            if (!this.weddingWitnessesPartnershipId) this.refreshParticipantOffers();
        });
    },

    // ==================== DATA QUALITY (6g, 6h) ====================

    /** The trace in Leads: the sentence and Review one by one. */
    nameLinkTraceHtml(count: number): string {
        const v = strings.validation;
        return `<div class="vq-group vq-group--info vq-namelink" data-type="nameLink">
            <div class="vq-namelink-lead"><span class="vq-dot" aria-hidden="true"></span><span class="vq-namelink-lead-text">${esc(v.nameLinkLead(count))}</span></div>
            <button type="button" class="vq-namelink-review" data-vq="nameLinkReview" data-focus-key="nameLinkReview">${esc(v.nameLinkReview)}</button>
        </div>`;
    },

    /** "Godparent · baptism: Bolemír Pšeničný, 3 Apr 1896" of a lead. */
    nameLinkWhere(lead: NameLinkLead, data: StromData): string {
        const first = lead.candidates[0] ? data.persons[lead.candidates[0].personId] : undefined;
        const label = derivedRoleLabel({
            role: lead.role, note: lead.note, eventType: lead.eventType, customLabel: lead.customLabel,
            partnershipId: lead.ref.partnershipId,
        }, first?.gender);
        const names = lead.subjects.map(pid => data.persons[pid]).filter(p => !!p).map(p => shownName(p!));
        const date = formatFlexDate(lead.date);
        return `${label} ${joinAnd(getCurrentLanguage(), names)}${date ? `, ${date}` : ''}`;
    },

    /** The list of the trace (6g): each lead with its candidates, the choices, Later; the rejected count at the end. */
    nameLinkListHtml(data: StromData, later: ReadonlySet<string>, ro: boolean): string {
        const v = strings.validation;
        const S = strings.events;
        listed = nameLinkLeads(data, DataManager.getData() === data ? DataManager.getPersonNameIndex() : undefined)
            .filter(l => !later.has(nameLinkKey(l.ref)));
        const items = listed.map((lead, i) => {
            const cands = lead.candidates.map(m => {
                const person = data.persons[m.personId];
                const name = person ? shownName(person) : lead.name;
                const meta = matchMeta(m, ' · ');
                return `<div class="vq-namelink-cand">
                    <span class="vq-namelink-who"><span class="vq-namelink-cname">${esc(name)}</span>${meta ? ` <span class="vq-namelink-meta">${esc(meta)}</span>` : ''}</span>
                    ${ro ? '' : `<button type="button" class="vq-namelink-link" data-vq="nameLinkLink" data-i="${i}" data-pid="${esc(m.personId)}"
                        data-focus-key="nl:${i}:${esc(m.personId)}" aria-label="${esc(`${S.link}: ${name}${meta ? ` ${meta}` : ''}`)}">${esc(S.link)}</button>`}
                </div>`;
            }).join('');
            const acts = ro ? '' : `<div class="vq-namelink-acts">
                <button type="button" class="vq-namelink-reject" data-vq="nameLinkReject" data-i="${i}" data-focus-key="nr:${i}">${esc(lead.candidates.length === 1 ? S.notThisPerson : S.noneOfThem)}</button>
                <button type="button" class="vq-namelink-later" data-vq="nameLinkLater" data-i="${i}" data-focus-key="nlt:${i}">${esc(v.later)}</button>
            </div>`;
            return `<div class="vq-namelink-item">
                <div class="vq-namelink-head"><span class="vq-namelink-name">${esc(lead.name)}</span><span class="vq-namelink-where">${esc(this.nameLinkWhere(lead, data))}</span></div>
                ${cands}${acts}
            </div>`;
        }).join('');
        const rejected = rejectedNameLinks(data);
        return `<div class="vq-namelink-list">
            <button type="button" class="vq-namelink-back" data-vq="nameLinkBack" data-focus-key="nameLinkBack">‹ ${esc(v.nameLinkBack)}</button>
            <h3 class="vq-namelink-title">${esc(v.nameLinkTitle(listed.length))}</h3>
            <p class="vq-namelink-hint">${esc(v.nameLinkHint)}</p>
            ${items}
            ${rejected > 0 ? `<p class="vq-namelink-rejected">${esc(v.rejectedCount(rejected))}</p>` : ''}
        </div>`;
    },

    /** The lead a list button stands for. */
    nameLinkLeadAt(i: string | undefined): NameLinkLead | null {
        const n = Number(i);
        return Number.isInteger(n) ? listed[n] ?? null : null;
    },

    /** Link from the list: saved at once (the open tree), a toast. */
    linkNameFromList(lead: NameLinkLead, personId: PersonId): void {
        const person = DataManager.getPerson(personId);
        if (!person || !DataManager.linkNamedParticipant(lead.ref, personId)) return;
        this.showToast(strings.events.linked(shownName(person)));
    },

    /** Not this person / None of them from the list: kept, not offered again. */
    rejectNameFromList(lead: NameLinkLead): void {
        DataManager.rejectNamedParticipant(lead.ref, lead.candidates.map(m => m.personId));
    },
});
