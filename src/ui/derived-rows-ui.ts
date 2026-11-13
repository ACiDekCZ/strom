/**
 * A person's part at another's event in the person dialog's list of events
 * (spec 085 §5): "Godparent · baptism: Anežka Hurdálková" with the date and
 * place below, a chain before it, a dashed line under it and ⋯ on the right.
 * The row opens the event where it is kept: a person's event in its editor
 * at that person, a couple's event in the couple's editor, the wedding in
 * its witnesses' dialog. The rows come from src/derived-participations.ts.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { PersonId, PartnershipId, Gender } from '../types.js';
import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { chainLinkSvg } from '../icons.js';
import { shownName } from '../person-name.js';
import { MARRIAGE_EVENT_ID } from '../shared-events.js';
import {
    DerivedParticipation, ParticipationTarget, derivedParticipations, derivedRoleLabel, derivedEventWord,
} from '../derived-participations.js';
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

    /** More items of a derived row's ⋯ (§6 adds "Record as an own event"). */
    derivedMenuExtra(_d: DerivedParticipation): { label: string; hint?: string; run: () => void }[] {
        return [];
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
});
