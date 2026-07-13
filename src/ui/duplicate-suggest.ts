/**
 * Duplicate suggestions: while entering a NEW person (person modal or the
 * add-relation modal), hint existing persons that look like the same one. It is
 * a non-blocking hint — saving is never prevented. Scoring lives in
 * src/merge/matching.ts (shared with the merge engine).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { PersonId, Gender, RelationContext } from '../types.js';
import { strings } from '../strings.js';
import { findSimilarPersons, SimilarPersonResult } from '../merge/matching.js';
import { normalizeDateInput, displayYear } from '../dates.js';
import { uiModule } from './module.js';

/** Debounce so we don't re-score on every keystroke. */
const DEBOUNCE_MS = 300;
const MAX_SUGGESTIONS = 3;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const config = {
    person: { container: 'duplicate-suggest-person', first: 'input-firstname', last: 'input-lastname', gender: 'input-gender', birth: 'input-birthdate' },
    relation: { container: 'duplicate-suggest-relation', first: 'rel-firstname', last: 'rel-lastname', gender: 'rel-gender', birth: 'rel-birthdate' },
} as const;

type SuggestContext = keyof typeof config;

export const duplicateSuggestMethods = uiModule({
    /** Debounced re-check for the given context (called from input listeners). */
    scheduleDuplicateCheck(context: SuggestContext): void {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => this.runDuplicateCheck(context), DEBOUNCE_MS);
    },

    /**
     * Wire debounced input listeners for a context and clear the panel. Only the
     * text inputs get listeners (the gender select keeps its own change handler);
     * gender is still read when a text input triggers a re-check.
     */
    initDuplicateSuggest(context: SuggestContext): void {
        const c = config[context];
        for (const id of [c.first, c.last, c.birth]) {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el) el.oninput = () => this.scheduleDuplicateCheck(context);
        }
        this.clearDuplicateSuggest(context);
    },

    clearDuplicateSuggest(context: SuggestContext): void {
        const c = config[context];
        const panel = document.getElementById(c.container);
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    },

    /** Detach listeners + hide the panel (e.g. when editing an existing person). */
    disableDuplicateSuggest(context: SuggestContext): void {
        const c = config[context];
        for (const id of [c.first, c.last, c.birth]) {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el) el.oninput = null;
        }
        this.clearDuplicateSuggest(context);
    },

    runDuplicateCheck(context: SuggestContext): void {
        if (!SettingsManager.isSuggestDuplicatesEnabled()) return;
        const c = config[context];
        const first = (document.getElementById(c.first) as HTMLInputElement | null)?.value.trim() ?? '';
        const last = (document.getElementById(c.last) as HTMLInputElement | null)?.value.trim() ?? '';
        const gender = ((document.getElementById(c.gender) as HTMLSelectElement | null)?.value || 'male') as Gender;
        const birthRaw = (document.getElementById(c.birth) as HTMLInputElement | null)?.value || '';
        const birthDate = normalizeDateInput(birthRaw) || undefined;

        if (!first && !last) { this.clearDuplicateSuggest(context); return; }

        // In the relation modal, never suggest the anchor person themself —
        // "use existing" would link the person to themselves (the link-existing
        // picker excludes self the same way).
        const excludeId = context === 'relation'
            ? (this.relationContext as RelationContext | null)?.personId
            : undefined;
        const results = findSimilarPersons(DataManager.getData(), { firstName: first, lastName: last, gender, birthDate }, excludeId);
        this.renderDuplicateSuggest(context, results.slice(0, MAX_SUGGESTIONS));
    },

    renderDuplicateSuggest(context: SuggestContext, results: SimilarPersonResult[]): void {
        const panel = document.getElementById(config[context].container);
        if (!panel) return;
        if (results.length === 0) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

        const action = context === 'person' ? strings.duplicates.goToPerson : strings.duplicates.useExisting;
        const handler = context === 'person' ? 'goToSuggestedPerson' : 'useSuggestedPerson';
        panel.innerHTML = `
            <div class="duplicate-suggest-title">${esc(strings.duplicates.title)}</div>
            ${results.map(({ person }) => {
                const name = `${person.firstName} ${person.lastName}`.trim();
                const year = displayYear(person.birthDate);
                const parents = person.parentIds
                    .map(id => DataManager.getPerson(id))
                    .filter(p => p && !p.isPlaceholder)
                    .map(p => `${p!.firstName} ${p!.lastName}`.trim())
                    .join(', ');
                const meta = [year ? `*${year}` : '', parents ? strings.duplicates.parentsLabel(parents) : '']
                    .filter(Boolean).join(' · ');
                return `
                    <div class="duplicate-suggest-item">
                        <div class="duplicate-suggest-main">
                            <span class="duplicate-suggest-name">${esc(name)}</span>
                            ${meta ? `<span class="duplicate-suggest-meta"> — ${esc(meta)}</span>` : ''}
                        </div>
                        <button type="button" onclick="window.Strom.UI.${handler}('${esc(person.id)}')">${esc(action)}</button>
                    </div>`;
            }).join('')}
        `;
        panel.style.display = '';
    },

    /** Person-modal suggestion: close the modal and focus the existing person. */
    goToSuggestedPerson(personId: string): void {
        this.forceCloseModal();
        TreeRenderer.setFocus(personId as PersonId);
        TreeRenderer.render();
    },

    /** Relation-modal suggestion: link the existing person instead of a new one. */
    useSuggestedPerson(personId: string): void {
        const ctx = this.relationContext as RelationContext | null;
        if (!ctx) return;
        if (personId === ctx.personId) return; // never link a person to themself
        this.createRelationship(ctx.personId, personId as PersonId, ctx.relationType);
        this.closeRelationModal();
        TreeRenderer.render();
        this.refreshSearch();
        if (this.relationshipsPanelPersonId) this.refreshRelationshipsPanel();
    },
});
