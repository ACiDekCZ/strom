/**
 * "What the research knows" about one person: the sources that disagree, the
 * hypotheses the research works with and what it already searched. Written by
 * Strom Research into its GEDCOM (Person.research), read-only here — deciding
 * a conflict or handing it to the agent continues in the research (↗).
 * Readable everywhere (phone, locked, read-only); the links only on a
 * computer whose research announced them.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { PersonId, ResearchConflict, ResearchConflictValue } from '../types.js';
import { formatFlexDate } from '../dates.js';
import { parseGedcomDate, gedcomTagEventType } from '../ged-parser.js';
import { researchConflictRef } from '../research-link.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { PersonMenuAction } from './context-menu.js';
import { personSubtitle } from './person-sources-ui.js';

const DIALOG_ID = 'person-research-modal';

/** HTML-escape a string for innerHTML (text and attribute values). */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The fact a conflict is about, in words ("Birth", "Baptism", "Name"). */
export function researchFactLabel(fact: string): string {
    const tag = fact.toUpperCase();
    if (tag === 'BIRT') return strings.events.types.birth;
    if (tag === 'DEAT') return strings.events.types.death;
    if (tag === 'NAME') return strings.research.factName;
    if (tag === 'SEX') return strings.labels.gender;
    const type = gedcomTagEventType(tag);
    return type ? strings.events.types[type] : tag;
}

/** Only GEDCOM date words and numbers ("ABT 1870", "3 FEB 1865", "BET 1870 AND 1872"). */
const GEDCOM_DATE_TEXT = /^(?:\s*(?:ABT|BEF|AFT|EST|CAL|INT|FROM|TO|BET|AND|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|\d{1,4}))+\s*$/i;

/** The heading of a conflict: its question when the research wrote one, else the fact. */
export function researchConflictTitle(c: ResearchConflict): string {
    return c.title || researchFactLabel(c.fact);
}

/** A value as people read it: a GEDCOM date in the app's date style, a sex as a word, else as written. */
export function researchValueText(fact: string, value: string): string {
    if (fact.toUpperCase() === 'SEX') {
        const v = value.trim().toUpperCase();
        if (v === 'M') return strings.gender.male;
        if (v === 'F') return strings.gender.female;
        return value;
    }
    // A claim in words ("70 years at death 1937", "12 MAR 1865, Týnec") stays as written.
    if (!GEDCOM_DATE_TEXT.test(value)) return value;
    let date = '';
    try { date = parseGedcomDate(value); } catch { date = ''; }
    return date ? formatFlexDate(date) : value;
}

/** A conflict about a date (not a place or a name): the values read as dates. */
export function isDateConflict(c: ResearchConflict): boolean {
    return c.values.every(v => researchValueText(c.fact, v.value) !== v.value || /^\s*\d{3,4}\s*\??\s*$/.test(v.value));
}

/** Title of the first source of a value that is in the tree ('' when none). */
function sourceTitle(v: ResearchConflictValue | undefined): string {
    const sources = DataManager.getData().sources ?? {};
    const id = v?.sourceIds?.find(sid => sources[sid]);
    return id ? sources[id].title : '';
}

export const personResearchMethods = uiModule({
    /** The person's open conflicts (what the edit form marks). */
    personOpenConflicts(personId: PersonId): ResearchConflict[] {
        return (DataManager.getPerson(personId)?.research?.conflicts ?? []).filter(c => c.status === 'open');
    },

    /** "What the research knows" for the person menu, or null when the research wrote nothing. */
    personResearchKnows(personId: PersonId): PersonMenuAction | null {
        const r = DataManager.getPerson(personId)?.research;
        if (!r || !((r.conflicts?.length ?? 0) + (r.hypotheses?.length ?? 0) + (r.searched?.length ?? 0) + (r.edge ? 1 : 0))) return null;
        const open = this.personOpenConflicts(personId).length;
        const label = strings.research.knows;
        return open > 0
            ? { action: 'research-knows', label, tag: strings.research.openConflicts(open),
                ariaLabel: `${label}, ${strings.research.openConflicts(open)}` }
            : { action: 'research-knows', label };
    },

    /**
     * The dialog. From the edit form it opens above it (the form stays on
     * the dialog stack underneath); from the menu it is the only dialog.
     * `edge`: opened from the research edge above the card — its "Above the
     * person" section comes into view and takes the focus.
     */
    showPersonResearchDialog(personId: PersonId, opts: { edge?: boolean } = {}): void {
        document.getElementById(DIALOG_ID)?.remove();
        const person = DataManager.getPerson(personId);
        const research = person?.research;
        if (!person || !research) return;
        const r = strings.research;
        const asOf = DataManager.getData().researchAsOf;
        const subtitle = [personSubtitle(personId), asOf ? r.asOf(formatFlexDate(asOf)) : ''].filter(Boolean).join(' · ');
        const sources = DataManager.getData().sources ?? {};
        const canDecide = this.researchLinkAvailable('conflict') && this.personResearchRef(personId) !== null;
        // An archive has no agent to leave a conflict to: deciding stays (in the research).
        const toAgent = !this.activeResearchArchive();

        const sourceCell = (v: ResearchConflictValue): string => {
            const id = v.sourceIds?.find(sid => sources[sid]);
            if (!id) return '<span class="person-research-nosource">–</span>';
            return `<button type="button" class="link-button person-research-source" data-source="${esc(id)}">${esc(sources[id].title)}</button>`;
        };
        const conflicts = research.conflicts ?? [];
        const openHtml = conflicts.filter(c => c.status === 'open').map(c => {
            const id = researchConflictRef(c.id);
            return `
                <div class="person-research-conflict">
                    <div class="person-research-conflict-head">
                        <span class="person-research-fact">${esc(researchConflictTitle(c))}</span>
                        <span class="person-research-open-tag">${esc(r.conflictOpen)}</span>
                    </div>
                    <table class="person-research-values">
                        <thead><tr><th scope="col">${esc(r.conflictValue)}</th><th scope="col">${esc(r.conflictSource)}</th></tr></thead>
                        <tbody>${c.values.map(v => `<tr><td>${esc(researchValueText(c.fact, v.value))}</td><td>${sourceCell(v)}</td></tr>`).join('')}</tbody>
                    </table>
                    ${canDecide && id ? `
                    <div class="person-research-conflict-actions">
                        <button type="button" class="link-button" data-conflict="${esc(id)}" data-do="decide">${esc(r.decide)}</button>${toAgent ? `
                        <button type="button" class="link-button person-research-agent" data-conflict="${esc(id)}" data-do="agent"
                            aria-label="${esc(`${r.leaveToAgent}, ${r.aiBadge}, ${r.opensInResearchSr}`)}">${esc(r.leaveToAgent)}
                            <span class="research-ai-badge" title="${esc(r.aiCostHint)}" aria-hidden="true">${esc(r.aiBadge)}</span> ↗</button>` : ''}
                    </div>` : ''}
                </div>`;
        }).join('');
        const decidedHtml = conflicts.filter(c => c.status === 'decided').map(c => {
            const values = c.values.map(v => researchValueText(c.fact, v.value)).join(' vs. ');
            // The decision is words ("1865 (S0001)"); a source only when the research names one.
            const decision = c.decision ? r.decided(c.decision.value, sourceTitle(c.decision)) : '';
            return `
                <div class="person-research-decided">
                    <span>${esc(researchConflictTitle(c))}: ${esc(values)}</span>
                    ${decision ? `<span class="person-research-decision">${esc(decision)}</span>` : ''}
                </div>`;
        }).join('');
        const hypotheses = research.hypotheses ?? [];
        const searched = [...(research.searched ?? [])].sort((a, b) => (a.from ?? a.to ?? 99999) - (b.from ?? b.to ?? 99999));
        const years = (from?: number, to?: number): string =>
            from !== undefined && to !== undefined ? (from === to ? String(from) : `${from}–${to}`)
                : from !== undefined ? `${from}–` : to !== undefined ? `–${to}` : '';

        const section = (title: string, body: string): string => body
            ? `<section class="person-research-section"><h3 class="menu-section-header">${esc(title)}</h3>${body}</section>` : '';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = DIALOG_ID;
        overlay.innerHTML = `
            <div class="modal modal--md person-research-modal" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="person-research-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="person-research-title">${esc(r.knows)}</h2>
                        <div class="audit-log-subtitle">${esc(subtitle)}</div>
                    </div>
                    <button type="button" class="close-btn" id="person-research-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="person-research-body">
                    ${this.researchEdgeSectionHtml(personId)}
                    ${section(r.conflicts, openHtml + decidedHtml)}
                    ${section(r.hypotheses, hypotheses.map(h => `
                        <div class="person-research-hypo">
                            <div class="person-research-hypo-title">${esc(h.title)}</div>
                            ${h.note ? `<p class="person-research-hypo-note">${esc(h.note)}</p>` : ''}
                        </div>`).join(''))}
                    ${section(r.searched, searched.length > 0 ? `
                        <table class="person-research-searched">
                            <thead><tr><th scope="col">${esc(r.searchedBook)}</th><th scope="col">${esc(r.searchedYears)}</th><th scope="col">${esc(r.searchedResult)}</th></tr></thead>
                            <tbody>${searched.map(x => `<tr>
                                <td>${esc(x.title)}</td>
                                <td class="person-research-years">${esc(years(x.from, x.to))}</td>
                                <td>${x.result ? `<span class="person-research-result person-research-result--${x.result}">${esc(x.result === 'found' ? r.found : r.none)}</span>` : ''}</td>
                            </tr>`).join('')}</tbody>
                        </table>` : '')}
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" id="person-research-close" data-dismiss>${esc(strings.buttons.close)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(DIALOG_ID);
        const close = (): void => this.closePersonResearchDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#person-research-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-research-close') as HTMLButtonElement).onclick = close;
        overlay.querySelectorAll<HTMLButtonElement>('.person-research-source').forEach(btn => {
            btn.onclick = () => this.showSourceViewer(btn.dataset.source ?? '', { personId });
        });
        overlay.querySelectorAll<HTMLButtonElement>('[data-conflict]').forEach(btn => {
            btn.onclick = () => {
                const agent = btn.dataset.do === 'agent';
                const url = this.activeResearchLink('conflict', { conflict: btn.dataset.conflict, conflictDo: agent ? 'agent' : 'decide' });
                if (url) this.launchResearchLink(url, agent ? 'agent' : 'terminal');
            };
        });
        this.bindResearchEdgeSection(overlay, personId);
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        const edgeHead = opts.edge ? overlay.querySelector<HTMLElement>('#research-edge-section summary') : null;
        if (edgeHead) {
            edgeHead.focus({ preventScroll: true });
            edgeHead.scrollIntoView({ block: 'start' });
        } else {
            (overlay.querySelector('#person-research-close') as HTMLButtonElement).focus({ preventScroll: true });
        }
    },

    closePersonResearchDialog(): void {
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
    },

    /**
     * The edit form: "conflict ›" at the label of each field the research has
     * an open conflict about (birth date or place, death, sex, name). Clicking
     * it opens the dialog above the form. Cards in the tree stay as they are.
     */
    markResearchConflicts(personId: PersonId): void {
        document.querySelectorAll('#person-modal .pm-conflict-tag').forEach(n => n.remove());
        const r = strings.research;
        const marked = new Set<string>();
        for (const c of this.personOpenConflicts(personId)) {
            const fact = c.fact.toUpperCase();
            const date = isDateConflict(c);
            const input = fact === 'BIRT' ? (date ? 'input-birthdate' : 'input-birthplace')
                : fact === 'DEAT' ? (date ? 'input-deathdate' : 'input-deathplace')
                : fact === 'NAME' ? 'input-firstname'
                : fact === 'SEX' ? 'gender-segment'
                : null;
            if (!input || marked.has(input)) continue;
            const label = input === 'gender-segment'
                ? document.querySelector<HTMLElement>('#gender-segment')?.closest('.form-group')?.querySelector('label')
                : document.querySelector<HTMLElement>(`#person-modal label[for="${input}"]`);
            if (!label) continue;
            marked.add(input);
            const tag = document.createElement('button');
            tag.type = 'button';
            tag.className = 'pm-conflict-tag';
            tag.textContent = r.conflictTag;
            tag.setAttribute('aria-label', r.conflictTagSr(researchFactLabel(fact)));
            tag.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showPersonResearchDialog(personId);
            };
            label.appendChild(tag);
        }
    },
});
