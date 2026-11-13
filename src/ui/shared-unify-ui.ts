/**
 * Copies of a shared event that went apart (spec 085 §4, 4c–4g): the Unify
 * dialog, "Separate the differing copy/copies" and "Open" for Data quality,
 * the Table's finding bubble and the event editor's amber bar.
 *
 * The dialog lists only the fields that differ, each value as a radio card
 * with the persons whose copy has it; the majority is chosen (on a tie the
 * value of the person it was opened from). From three differing fields on,
 * "Take everything from:" sets every field to one person's values. Unify
 * writes the choice to every copy, Separate takes the differing copies out
 * of the share, each as ONE undo step whose pill says what happened.
 *
 * The content is pure (src/shared-divergence.ts: unifyModel, unifyDefaults,
 * takeAllFrom, unifyValues); every write goes through DataManager.
 */

import { DataManager } from '../data.js';
import type { PersonId } from '../types.js';
import { strings } from '../strings.js';
import { shareDivergence, type SharedEventCommonField } from '../shared-events.js';
import {
    divergenceTitle, divergentCopies, divergentPersons, takeAllFrom, unifyDefaults, unifyModel, unifyValues,
} from '../shared-divergence.js';
import { uiModule } from './module.js';

/** HTML-escape a user string for safe innerHTML insertion. */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The Unify dialog while it is open. */
export interface SharedUnifyState {
    shareId: string;
    /** The person whose side it was opened from (a tie's default, "Take everything from"'s first choice). */
    openerId: PersonId | null;
    choice: Map<SharedEventCommonField, number>;
    /** Run after Unify or Separate (the caller redraws). */
    after: (() => void) | null;
    /** The element the focus goes back to when the dialog closes. */
    returnFocus: HTMLElement | null;
}

export const sharedUnifyMethods = uiModule({
    /**
     * Open the Unify dialog over whatever is open (Data quality, the Table,
     * the event editor). Nothing when the copies agree (any more) or the tree
     * cannot be changed.
     */
    showSharedUnify(shareId: string, openerId: PersonId | null = null, after: (() => void) | null = null): void {
        const data = DataManager.getData();
        const d = shareDivergence(data, shareId);
        const modal = document.getElementById('shared-unify-modal');
        if (!d || !modal || DataManager.isReadOnly()) return;
        this.sharedUnify = {
            shareId, openerId, choice: unifyDefaults(d, openerId), after,
            returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        };
        this.renderSharedUnify();
        this.pushDialog('shared-unify-modal');
        modal.classList.add('active');
        modal.querySelector<HTMLInputElement>('.su-opt input:checked')?.focus();
    },

    /** Draw the dialog from the data and the current choice. */
    renderSharedUnify(): void {
        const st = this.sharedUnify;
        const body = document.getElementById('shared-unify-body');
        if (!st || !body) return;
        const data = DataManager.getData();
        const d = shareDivergence(data, st.shareId);
        if (!d) { this.closeSharedUnify(); return; }
        const m = unifyModel(data, d);
        const set = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        set('shared-unify-title', m.title);
        set('shared-unify-lead', m.lead);
        set('shared-unify-separate', m.separateLabel);
        set('shared-unify-go', m.goLabel);
        const v = strings.validation;
        let html = '';
        if (m.takeAll) {
            // Nobody picked at first: the fields start on the majority's values.
            html += `<div class="su-take-all"><label for="shared-unify-take-all">${esc(v.unifyTakeAll)}</label>`
                + '<select id="shared-unify-take-all"><option value="" selected>–</option>'
                + m.takeAll.map(p => `<option value="${esc(p.personId)}">${esc(p.name)}</option>`).join('')
                + '</select></div>';
        }
        for (const f of m.fields) {
            const chosen = st.choice.get(f.field) ?? 0;
            html += `<div class="su-field" data-field="${esc(f.field)}" role="radiogroup" aria-labelledby="su-label-${esc(f.field)}">`
                + `<span class="su-label" id="su-label-${esc(f.field)}">${esc(f.label)}</span><div class="su-opts">`;
            for (const o of f.options) {
                const on = o.index === chosen;
                html += `<label class="su-opt${on ? ' is-on' : ''}"><input type="radio" name="su-${esc(f.field)}" value="${o.index}"${on ? ' checked' : ''}>`
                    + `<span class="su-opt-text"><span class="su-val">${esc(o.text)}</span><span class="su-who">${esc(o.names)}</span></span></label>`;
            }
            html += '</div></div>';
        }
        html += `<p class="su-same">${esc(m.same)}</p>`;
        body.innerHTML = html;
        body.querySelectorAll<HTMLInputElement>('.su-opt input').forEach(input => {
            input.addEventListener('change', () => {
                const field = input.closest<HTMLElement>('.su-field')?.dataset.field as SharedEventCommonField | undefined;
                if (!field || !this.sharedUnify) return;
                this.sharedUnify.choice.set(field, Number(input.value));
                this.markSharedUnifyChoice();
            });
        });
        const take = body.querySelector<HTMLSelectElement>('#shared-unify-take-all');
        take?.addEventListener('change', () => {
            if (!this.sharedUnify || !take.value) return;
            const now = shareDivergence(DataManager.getData(), this.sharedUnify.shareId);
            if (!now) return;
            this.sharedUnify.choice = takeAllFrom(now, take.value as PersonId, this.sharedUnify.choice);
            this.markSharedUnifyChoice();
        });
    },

    /** Mark the chosen cards (the radios themselves change on their own). */
    markSharedUnifyChoice(): void {
        const st = this.sharedUnify;
        const body = document.getElementById('shared-unify-body');
        if (!st || !body) return;
        body.querySelectorAll<HTMLElement>('.su-field').forEach(fs => {
            const chosen = st.choice.get(fs.dataset.field as SharedEventCommonField) ?? 0;
            fs.querySelectorAll<HTMLInputElement>('.su-opt input').forEach(input => {
                const on = Number(input.value) === chosen;
                input.checked = on;
                input.closest('.su-opt')?.classList.toggle('is-on', on);
            });
        });
    },

    /** "Make match for n people": the choice to every copy, one undo step. */
    confirmSharedUnify(): void {
        const st = this.sharedUnify;
        if (!st) return;
        const data = DataManager.getData();
        const d = shareDivergence(data, st.shareId);
        if (!d) { this.closeSharedUnify(); return; }
        const m = unifyModel(data, d);
        const title = divergenceTitle(data, d);
        const values = unifyValues(d, st.choice);
        const n = DataManager.runBatch(strings.validation.unified(title, m.persons), () => DataManager.unifySharedCopies(st.shareId, values));
        if (!n) {
            this.showAlert(strings.events.sharedSaveRefused, 'warning');
            return;
        }
        const after = st.after;
        this.closeSharedUnify(false);
        after?.();
    },

    /** "Separate the differing copy/copies" in the dialog's footer. */
    separateSharedFromUnify(): void {
        const st = this.sharedUnify;
        if (!st) return;
        if (!this.separateDivergentShared(st.shareId)) return;
        const after = st.after;
        this.closeSharedUnify(false);
        after?.();
    },

    /**
     * Take the differing copies out of a shared event (each stays its
     * person's ordinary event as it is), one undo step whose pill says how
     * many. False when there is nothing to separate or it was refused.
     */
    separateDivergentShared(shareId: string): boolean {
        const data = DataManager.getData();
        const d = shareDivergence(data, shareId);
        if (!d || DataManager.isReadOnly()) return false;
        const persons = divergentPersons(d);
        const copies = divergentCopies(d).length;
        if (!persons.length) return false;
        const title = divergenceTitle(data, d);
        const n = DataManager.runBatch(strings.validation.separatedCopies(title, copies), () => DataManager.separateCopies(shareId, persons));
        if (!n) {
            this.showAlert(strings.events.sharedSaveRefused, 'warning');
            return false;
        }
        return true;
    },

    /** The first differing copy of a share: whose it is and its event (Open). */
    divergentCopyOf(shareId: string): { personId: PersonId; eventId: string } | null {
        const d = shareDivergence(DataManager.getData(), shareId);
        return d ? divergentCopies(d)[0] ?? d.copies[0] ?? null : null;
    },

    /** Close the dialog (Cancel, ×, Escape); `restore`: the focus back where it was. */
    closeSharedUnify(restore = true): void {
        const modal = document.getElementById('shared-unify-modal');
        modal?.classList.remove('active');
        if (this.dialogStack[this.dialogStack.length - 1] === 'shared-unify-modal') this.dialogStack.pop();
        const back = this.sharedUnify?.returnFocus;
        this.sharedUnify = null;
        if (restore && back?.isConnected) back.focus();
    },
});
