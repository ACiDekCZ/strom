/**
 * The reliability marks of the person card and of the relationships panel
 * (spec 066 §2): the person-origin row under the person's header, the pills
 * at the name, sex and occupation fields and at the events, and the marks
 * of the parent and partner links. Where the steps come from: the research's
 * tree with `origin` in its bridge's features, otherwise the app's own
 * import record (src/reliability.ts). Settings → "Reliability on the person
 * card" off: no marks there at all.
 */

import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { Partnership, Person, PersonId } from '../types.js';
import { importRecordOf } from '../import-origin.js';
import {
    FactReliability, PersonOriginSummary, ReliabilityOptions, factReliability, personOriginSummary, reliabilityStep,
} from '../reliability.js';
import {
    factReliabilityHtml, installReliabilityTips, originRowPillHtml, personMarksLayout, reliabilityHtml, reliabilityTitle,
    ReliabilityHtmlOptions,
} from './fact-status.js';
import { uiModule } from './module.js';

/** What the person card shows of the marks, computed once per drawing. */
export interface PersonReliabilityView {
    summary: PersonOriginSummary;
    /** Pills at the facts (false: the one pill of the origin row stands for them all, or the setting is off). */
    atFacts: boolean;
    opts: ReliabilityOptions;
}

export const personReliabilityMethods = uiModule({
    /** Where the steps come from now: the active research tree and whether its bridge names `origin`. */
    reliabilityOptionsNow(): ReliabilityOptions {
        const originFeature = this.researchShowsOriginNow();
        return { researchTree: originFeature || !!this.activeResearchId(), originFeature };
    },

    /** The person card's marks (null: the setting is off). */
    personReliabilityView(person: Person): PersonReliabilityView | null {
        if (!SettingsManager.isReliabilityCardEnabled()) return null;
        const opts = this.reliabilityOptionsNow();
        const summary = personOriginSummary(DataManager.getData(), person, opts);
        return { summary, atFacts: personMarksLayout(summary).atFacts, opts };
    },

    /** One fact's pill on the person card ('' where none stands). */
    personFactMarkHtml(view: PersonReliabilityView | null, fact: string, extra: ReliabilityHtmlOptions = {}): string {
        if (!view || !view.atFacts) return '';
        const r = view.summary.facts.find(f => f.fact === fact);
        return r ? factReliabilityHtml(r, { research: view.opts.originFeature, fact, ...extra }) : '';
    },

    /**
     * The person card's origin row and the pills at its fields (name, sex,
     * occupation); the events list draws its own. Null: none (a new person).
     */
    renderPersonReliability(personId: PersonId | null): void {
        installReliabilityTips();
        const modal = document.getElementById('person-modal');
        modal?.querySelectorAll('.form-group > label > .fact-status').forEach(n => n.remove());
        const row = document.getElementById('pm-origin');
        const person = personId ? DataManager.getPerson(personId) : null;
        const view = person ? this.personReliabilityView(person) : null;
        if (row) {
            const layout = view ? personMarksLayout(view.summary) : { row: null };
            row.hidden = !layout.row;
            row.innerHTML = '';
            if (layout.row && view) {
                const text = document.createElement('span');
                text.className = 'person-origin-text';
                text.textContent = layout.row.text;
                row.appendChild(text);
                if (layout.row.step) row.insertAdjacentHTML('beforeend', originRowPillHtml(view.summary, layout.row.step, { research: view.opts.originFeature }));
            }
        }
        if (!person || !view?.atFacts) return;
        const put = (label: Element | null | undefined, html: string): void => {
            if (!label || !html) return;
            const tmp = document.createElement('template');
            tmp.innerHTML = html.trim();
            const pill = tmp.content.firstElementChild;
            if (pill) label.insertBefore(pill, label.querySelector('.pm-conflict-tag'));
        };
        // The name: at the given name and the surname, each while it is the part from the family tree.
        const name = view.summary.facts.find(f => f.fact === 'name');
        if (name) {
            const parts = name.step === 'import' && name.fromParts.length > 0 ? name.fromParts : null;
            const html = this.personFactMarkHtml(view, 'name');
            if (!parts || parts.includes('GIVN')) put(document.querySelector('#person-modal label[for="input-firstname"]'), html);
            if (!parts || parts.includes('SURN')) put(document.getElementById('lastname-label'), html);
        }
        put(document.getElementById('gender-segment')?.closest('.form-group')?.querySelector(':scope > label'),
            this.personFactMarkHtml(view, 'sex'));
        const occupation = this.latestQuickEvent(person, 'occupation', 'note');
        if (occupation) put(document.querySelector('#person-modal label[for="input-occupation"]'), this.personFactMarkHtml(view, `event:${occupation.id}`));
    },

    /** The open person card marked again (a setting changed, a research version loaded). */
    refreshPersonReliability(): void {
        const modal = document.getElementById('person-modal');
        if (!modal?.classList.contains('active') || !this.currentId) return;
        this.renderPersonReliability(this.currentId);
        this.renderEventsList();
    },

    /**
     * The mark of a parent link or a partner link in the relationships panel:
     * from the app's own import record (the link came from a loaded family
     * tree), whatever the research says of the facts.
     */
    relationLinkMarkHtml(importId: string | undefined): string {
        if (!importId || !SettingsManager.isReliabilityCardEnabled()) return '';
        const record = importRecordOf(DataManager.getData(), importId);
        const step = record ? reliabilityStep({ valueFromImport: true }) : null;
        if (!step || !record) return '';
        installReliabilityTips();
        return reliabilityHtml(step, reliabilityTitle({ ...step, importRecord: record }));
    },

    /** A couple's fact (wedding, divorce, a couple's event) as a pill ('' for none). */
    partnershipFactMarkHtml(ps: Partnership, fact: string, extra: ReliabilityHtmlOptions = {}): string {
        if (!SettingsManager.isReliabilityCardEnabled()) return '';
        const opts = this.reliabilityOptionsNow();
        const r: FactReliability | null = factReliability(DataManager.getData(), ps, fact, opts);
        if (!r) return '';
        if (!extra.inert) installReliabilityTips();
        return factReliabilityHtml(r, { research: opts.originFeature, fact, ...extra });
    },
});
