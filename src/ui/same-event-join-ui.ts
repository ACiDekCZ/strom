/**
 * Join an event recorded separately at several persons into one shared event
 * from Data quality (spec 085 K1.6 b).
 *
 * The trace in Leads names the event ("Census 15 Feb 1921, Dolní Smyšlenice –
 * recorded separately for 3 people") with Join into one event; several such
 * events are one sentence with Review one by one, which lists them in place of
 * the check, each with where it is (the event, the date, the place, the
 * persons), Join, Later (hidden until the dialog closes) and Back. The groups
 * come from the one match of "the same event" (findSeparateSameEvents in
 * src/shared-events.ts). Join saves at once, one undo step; each person's age
 * and own fields stay, and common fields that differ open Make copies match
 * (nothing is overwritten silently). Nothing is ever joined by itself.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { LifeEvent, PersonId, StromData } from '../types.js';
import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { shownName } from '../person-name.js';
import { findSeparateSameEvents, shareDivergence, type SeparateSameEventGroup } from '../shared-events.js';
import { sharedEventTitle } from '../shared-event-editor.js';
import { uiModule } from './module.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The groups the open trace or list shows, by their index (the buttons carry the index). */
let listed: SeparateSameEventGroup[] = [];

export const sameEventJoinMethods = uiModule({
    /** "Census 15 Feb 1921, Dolní Smyšlenice, No. 14": the event, its date, place and house. */
    sameJoinWhat(ev: LifeEvent): string {
        const type = ev.type === 'custom' ? ev.customLabel?.trim() ?? '' : strings.events.types[ev.type] ?? ev.type;
        const head = [type, formatFlexDate(ev.date)].filter(t => t).join(' ');
        return [head, ev.place?.trim(), ev.address?.trim()].filter(t => t).join(', ');
    },

    /** The persons of a group, as names ("Sudivoj, Radegunda and Bohuchval Vrbiňák"). */
    sameJoinWho(group: SeparateSameEventGroup, data: StromData): string {
        const names = group.persons.map(pid => data.persons[pid]).filter(p => !!p).map(p => shownName(p!));
        return joinAnd(getCurrentLanguage(), names);
    },

    /** The trace in Leads: one event named with Join, several as one sentence with Review one by one. */
    sameJoinTraceHtml(data: StromData, ro: boolean): string {
        const v = strings.validation;
        listed = findSeparateSameEvents(data);
        if (listed.length === 0) return '';
        if (listed.length > 1) {
            return `<div class="vq-group vq-group--info vq-samejoin" data-type="separateSameEvent">
                <div class="vq-samejoin-lead"><span class="vq-dot" aria-hidden="true"></span><span class="vq-samejoin-lead-text">${esc(v.sameJoinSummary(listed.length))}</span></div>
                <button type="button" class="vq-samejoin-review" data-vq="sameJoinReview" data-focus-key="sameJoinReview">${esc(v.sameJoinReview)}</button>
            </div>`;
        }
        const g = listed[0];
        return `<div class="vq-group vq-group--info vq-samejoin" data-type="separateSameEvent">
            <div class="vq-samejoin-lead"><span class="vq-dot" aria-hidden="true"></span><span class="vq-samejoin-lead-body">
                <span class="vq-samejoin-lead-text">${esc(v.sameJoinLead(this.sameJoinWhat(g.target.event), g.persons.length))}</span>
                <span class="vq-samejoin-where">${esc(this.sameJoinWhere(g, data))}</span>
            </span></div>
            ${ro ? '' : `<button type="button" class="vq-samejoin-join" data-vq="sameJoin" data-i="0" data-focus-key="sj:0">${esc(v.sameJoin)}</button>`}
        </div>`;
    },

    /** The line under a group's event: its persons, and the share it joins when there is one. */
    sameJoinWhere(group: SeparateSameEventGroup, data: StromData): string {
        const who = this.sameJoinWho(group, data);
        const shareSize = group.persons.length - group.records.length;
        return group.shareId ? `${who} · ${strings.validation.sameJoinToShare(shareSize)}` : who;
    },

    /** The list of Review one by one: each event with where it is, Join and Later; Back. */
    sameJoinListHtml(data: StromData, later: ReadonlySet<string>, ro: boolean): string {
        const v = strings.validation;
        listed = findSeparateSameEvents(data).filter(g => !later.has(g.key));
        const items = listed.map((g, i) => {
            const acts = `<div class="vq-samejoin-acts">
                ${ro ? '' : `<button type="button" class="vq-samejoin-join" data-vq="sameJoin" data-i="${i}" data-focus-key="sj:${i}">${esc(v.sameJoin)}</button>`}
                <button type="button" class="vq-samejoin-later" data-vq="sameJoinLater" data-i="${i}" data-focus-key="sjl:${i}">${esc(v.later)}</button>
            </div>`;
            return `<div class="vq-samejoin-item">
                <div class="vq-samejoin-head">
                    <span class="vq-samejoin-name">${esc(v.sameJoinLead(this.sameJoinWhat(g.target.event), g.persons.length))}</span>
                    <span class="vq-samejoin-where">${esc(this.sameJoinWhere(g, data))}</span>
                </div>
                ${acts}
            </div>`;
        }).join('');
        return `<div class="vq-samejoin-list">
            <button type="button" class="vq-samejoin-back" data-vq="sameJoinBack" data-focus-key="sameJoinBack">‹ ${esc(v.nameLinkBack)}</button>
            <h3 class="vq-samejoin-title">${esc(v.sameJoinTitle(listed.length))}</h3>
            <p class="vq-samejoin-hint">${esc(v.sameJoinHint)}</p>
            ${items}
        </div>`;
    },

    /** The group a trace or list button stands for. */
    sameJoinGroupAt(i: string | undefined): SeparateSameEventGroup | null {
        const n = Number(i);
        return Number.isInteger(n) ? listed[n] ?? null : null;
    },

    /**
     * Join from Data quality (the open tree): saved at once as one undo step
     * (its pill names the event and the persons' count); common fields that differ open Make copies match (`after`
     * redraws the dialog when it closes). The group is found again by its key
     * in the tree as it is now.
     */
    joinSameEventFromQuality(key: string, after: () => void): void {
        const group = findSeparateSameEvents(DataManager.getData()).find(g => g.key === key);
        if (!group) return;
        const title = sharedEventTitle(group.target.event, strings.events.types[group.target.event.type] ?? group.target.event.type);
        const text = strings.validation.sameJoinDone(title, group.persons.length);
        const viewer: PersonId = group.target.personId;
        const saved = DataManager.runBatch(text, () => DataManager.joinSeparateSameEvent(key));
        if (!saved) {
            this.showAlert(strings.events.sharedSaveRefused, 'warning');
            return;
        }
        // Common fields that differ (a source, a note…): Make copies match, never overwritten silently.
        if (saved.shareId && shareDivergence(DataManager.getData(), saved.shareId)) {
            this.showSharedUnify(saved.shareId, viewer, after);
        }
    },
});
