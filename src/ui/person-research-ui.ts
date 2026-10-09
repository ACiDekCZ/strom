/**
 * "What the research knows" about one person: the sources that disagree, the
 * hypotheses the research works with and what it already searched. Written by
 * Strom Research into its GEDCOM (Person.research), read-only here — deciding
 * a conflict or handing it to the agent continues in the research (↗).
 * Readable everywhere (phone, locked, read-only); the links only on a
 * computer whose research announced them.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, ResearchConflict, ResearchConflictValue, ResearchHypothesis } from '../types.js';
import { isOpenHypothesis, loadViewLinks } from '../view-links.js';
import { researchHypothesisNote, researchHypothesisState } from '../research-hypotheses.js';
import { formatFlexDate } from '../dates.js';
import { parseGedcomDate, gedcomTagEventType } from '../ged-parser.js';
import { researchConflictRef } from '../research-link.js';
import { canDecideInApp } from '../research-decide.js';
import { ConflictScope } from '../research-conflict-card.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { PersonMenuAction } from './context-menu.js';
import { personSubtitle } from './person-sources-ui.js';

const DIALOG_ID = 'person-research-modal';
/** How long a conflict's card opened at stays lit up (DEV §6.2). */
export const CONFLICT_HIGHLIGHT_MS = 1500;
/** What had the keyboard when the dialog opened (a line's label, a stub): it gets it back on close. */
let dialogOpener: HTMLElement | null = null;

/** HTML-escape a string for innerHTML (text and attribute values). */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The fact a conflict is about, in words ("Birth", "Baptism", "Name", "Title before name"). */
export function researchFactLabel(fact: string): string {
    const tag = fact.toUpperCase();
    if (tag === 'BIRT') return strings.events.types.birth;
    if (tag === 'DEAT') return strings.events.types.death;
    if (tag === 'NAME') return strings.research.factName;
    // The titles of the name (GEDCOM's NPFX / NSFX): named as the dialog's fields are.
    if (tag === 'NPFX') return strings.labels.titleBefore;
    if (tag === 'NSFX') return strings.labels.titleAfter;
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
        if (v === 'U') return strings.gender.unknown;
        return value;
    }
    // A claim in words ("70 years at death 1937", "12 MAR 1865, Týnec") stays as written.
    if (!GEDCOM_DATE_TEXT.test(value)) return value;
    let date = '';
    try { date = parseGedcomDate(value); } catch { date = ''; }
    return date ? formatFlexDate(date) : value;
}

/**
 * A value of a side said in words: an empty one (deleted on its side, 2 VAL
 * with no text) as "(empty)", never as nothing.
 */
export function conflictValueSaid(text: string): string {
    return text || strings.conflict.empty;
}

/** A value of a side as a card or a panel shows it (escaped): an empty one muted, never a blank box. */
export function conflictValueHtml(text: string): string {
    return text ? esc(text) : `<span class="prc-empty">${esc(strings.conflict.empty)}</span>`;
}

/** A conflict about a date (not a place or a name): the values read as dates (an empty side says nothing). */
export function isDateConflict(c: ResearchConflict): boolean {
    const said = c.values.filter(v => typeof v.value === 'string' && v.value.trim());
    return said.length > 0 && said.every(v => researchValueText(c.fact, v.value) !== v.value || /^\s*\d{3,4}\s*\??\s*$/.test(v.value));
}

/** A year in a value said in words ("23. 10. 1865, Žďár nad Sázavou", "tkadlec, 1865"). */
const YEAR_IN_WORDS = /(^|\D)\d{3,4}(\D|$)/;

/**
 * What of its fact a conflict is about (ConflictScope): the date when its
 * values read as dates; the whole fact when an event's values mix a date
 * with words — a part of a documented fact deleted in the app, the app's
 * side what is left of it ("Žďár nad Sázavou" against "23. 10. 1865, Žďár
 * nad Sázavou", "1865" against "tkadlec, 1865"); else the place or the value.
 */
export function conflictScope(c: ResearchConflict): ConflictScope {
    if (isDateConflict(c)) return 'date';
    if (['NAME', 'NPFX', 'NSFX', 'SEX'].includes(c.fact.trim().toUpperCase())) return 'place';
    return c.values.some(v => typeof v.value === 'string' && YEAR_IN_WORDS.test(v.value)) ? 'fact' : 'place';
}

/**
 * The edit form's field a conflict about a birth or a death marks: the date
 * or the place it is about; a conflict of the whole fact the part deleted —
 * the date unless the app's side still says one.
 */
function conflictDateField(c: ResearchConflict): boolean {
    const scope = conflictScope(c);
    if (scope !== 'fact') return scope === 'date';
    const user = c.values.find(v => v.side === 'user')?.value ?? '';
    return !YEAR_IN_WORDS.test(user);
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
        return this.researchConflictsOf(personId).filter(c => c.status === 'open');
    },

    /** "What the research knows" for the person menu, or null when the research wrote nothing. */
    personResearchKnows(personId: PersonId): PersonMenuAction | null {
        const r = DataManager.getPerson(personId)?.research;
        const conflicts = this.researchConflictsOf(personId).length;
        if (!(conflicts + (r?.hypotheses?.length ?? 0) + (r?.searched?.length ?? 0) + (r?.edge ? 1 : 0))) return null;
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
     * `hypo`: opened from the label of a line "linked in the view only" — the
     * hypothesis and the version it shows. The dialog carries it
     * (data-open-hypo / data-open-variant) and marks each hypothesis with its
     * id (data-hypo): bringing that one into view, open, belongs to the
     * hypotheses' own section.
     * `conflict`: a conflict's card (by its id, "X0007") comes into view and
     * its first choice takes the keyboard (the card when none is on).
     */
    showPersonResearchDialog(personId: PersonId, opts: { edge?: boolean; hypo?: { id: string; variant?: string }; conflict?: string } = {}): void {
        // Drawn again from inside itself: the one that opened it first keeps it.
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body && !active.closest(`#${DIALOG_ID}`)) dialogOpener = active;
        document.getElementById(DIALOG_ID)?.remove();
        const person = DataManager.getPerson(personId);
        // The conflicts as the research has them now (its version not loaded may say more, finding 40),
        // and one decided from here whose card still says so.
        const conflicts = this.researchConflictsShown(personId);
        const research = person?.research ?? (conflicts.length ? {} : undefined);
        if (!person || !research) return;
        const r = strings.research;
        const asOf = DataManager.getData().researchAsOf;
        const subtitle = [personSubtitle(personId), asOf ? r.asOf(formatFlexDate(asOf)) : ''].filter(Boolean).join(' · ');
        const sources = DataManager.getData().sources ?? {};
        const canDecide = this.researchLinkAvailable('conflict') && this.personResearchRef(personId) !== null;
        // An archive has no agent to leave a conflict to: deciding stays (in the research).
        const toAgent = !this.activeResearchNoAgent();

        const sourceCell = (v: ResearchConflictValue): string => {
            const id = v.sourceIds?.find(sid => sources[sid]);
            if (!id) return '<span class="person-research-nosource">–</span>';
            return `<button type="button" class="link-button person-research-source" data-source="${esc(id)}">${esc(sources[id].title)}</button>`;
        };
        const openHtml = conflicts.filter(c => c.status === 'open' || this.researchConflictCardState(researchConflictRef(c.id) ?? '')).map(c => {
            const id = researchConflictRef(c.id);
            // Made by an edit here, both sides said: the two sides with their choices (conflict-decide-ui.ts).
            if (canDecideInApp(c, person) || (id && this.researchConflictCardState(id))) return this.researchConflictCardHtml(personId, c);
            if (c.status !== 'open') return '';
            return `
                <div class="person-research-conflict">
                    <div class="person-research-conflict-head">
                        <span class="person-research-fact">${esc(researchConflictTitle(c))}</span>
                        <span class="person-research-open-tag">${esc(r.conflictOpen)}</span>
                    </div>
                    <table class="person-research-values">
                        <thead><tr><th scope="col">${esc(r.conflictValue)}</th><th scope="col">${esc(r.conflictSource)}</th></tr></thead>
                        <tbody>${c.values.map(v => `<tr><td>${conflictValueHtml(researchValueText(c.fact, v.value))}</td><td>${sourceCell(v)}</td></tr>`).join('')}</tbody>
                    </table>
                    <p class="person-research-sources-only">${esc(strings.conflict.sourcesOnly)}</p>
                    ${canDecide && id ? `
                    <div class="person-research-conflict-actions">
                        <button type="button" class="link-button" data-conflict="${esc(id)}" data-do="decide">${esc(r.decide)}</button>${toAgent ? `
                        <button type="button" class="link-button person-research-agent" data-conflict="${esc(id)}" data-do="agent"
                            aria-label="${esc(`${r.leaveToAgent}, ${r.aiBadge}, ${r.opensInResearchSr}`)}">${esc(r.leaveToAgent)}
                            <span class="research-ai-badge" title="${esc(r.aiCostHint)}" aria-hidden="true">${esc(r.aiBadge)}</span> ↗</button>` : ''}
                    </div>` : ''}
                </div>`;
        }).join('');
        const decidedHtml = conflicts.filter(c => c.status === 'decided' && !this.researchConflictCardState(researchConflictRef(c.id) ?? ''))
            .map(c => this.researchConflictDecidedRowHtml(c)).join('');
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
        overlay.dataset.person = personId;
        overlay.innerHTML = `
            <div class="modal modal--md person-research-modal${openHtml.includes('data-conflict-card=') ? ' person-research-modal--sides' : ''}" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="person-research-title"${opts.hypo ? ` data-open-hypo="${esc(opts.hypo.id)}"${opts.hypo.variant ? ` data-open-variant="${esc(opts.hypo.variant)}"` : ''}` : ''}>
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
                    ${section(r.hypotheses, hypotheses.length > 0 ? `<div class="person-research-hypos">${this.researchHypothesesHtml(personId, hypotheses)}</div>` : '')}
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
        // The conflicts' controls by delegation: a card is drawn again as its state moves (conflict-decide-ui.ts).
        overlay.querySelector('.person-research-body')?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.person-research-conflict')) return;
            const source = target.closest<HTMLButtonElement>('.person-research-source');
            if (source) {
                this.showSourceViewer(source.dataset.source ?? '', { personId });
                return;
            }
            const card = target.closest<HTMLElement>('[data-conflict-card]');
            const decide = target.closest<HTMLButtonElement>('[data-decide]');
            if (decide && card) {
                if (decide.disabled || decide.getAttribute('aria-disabled') === 'true') return;
                void this.decideResearchConflict(personId, card.dataset.conflictCard!, decide.dataset.decide === 'research' ? 'research' : 'user');
                return;
            }
            const action = target.closest<HTMLButtonElement>('[data-notice-action]');
            if (action && card) {
                this.researchConflictNoticeAction(personId, card.dataset.conflictCard!, action.dataset.noticeAction ?? '');
                return;
            }
            const link = target.closest<HTMLButtonElement>('[data-conflict]');
            if (link && !link.disabled) {
                const agent = link.dataset.do === 'agent';
                const take = link.dataset.take === 'user' || link.dataset.take === 'research' ? link.dataset.take : undefined;
                const url = this.activeResearchLink('conflict', { conflict: link.dataset.conflict, conflictDo: agent ? 'agent' : 'decide', ...(take ? { take } : {}) });
                if (url) this.launchResearchLink(url, agent ? 'agent' : 'terminal');
            }
        });
        this.bindResearchEdgeSection(overlay, personId);
        this.bindResearchHypotheses(overlay, personId);
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        const edgeHead = opts.edge ? overlay.querySelector<HTMLElement>('#research-edge-section summary') : null;
        const conflictCard = opts.conflict ? overlay.querySelector<HTMLElement>(`[data-conflict-card="${CSS.escape(opts.conflict)}"]`) : null;
        if (conflictCard) {
            conflictCard.scrollIntoView({ block: 'center' });
            (conflictCard.querySelector<HTMLElement>('.prc-choice:not(:disabled)') ?? conflictCard).focus({ preventScroll: true });
            // Lit up a moment, so it is clear where the way led (without motion when asked so: CSS).
            conflictCard.classList.add('prc--highlight');
            // (A card drawn again meanwhile carries the light over: conflict-decide-ui.ts.)
            setTimeout(() => overlay.querySelector(`[data-conflict-card="${CSS.escape(opts.conflict!)}"]`)?.classList.remove('prc--highlight'), CONFLICT_HIGHLIGHT_MS);
        } else if (opts.hypo && this.openResearchHypothesis(overlay, opts.hypo.id, opts.hypo.variant)) {
            // Opened from a line's label (or the edge's bubble): at the hypothesis, open, its version unfolded.
        } else if (edgeHead) {
            edgeHead.focus({ preventScroll: true });
            edgeHead.scrollIntoView({ block: 'start' });
        } else {
            (overlay.querySelector('#person-research-close') as HTMLButtonElement).focus({ preventScroll: true });
        }
    },

    /**
     * The hypotheses of "What the research knows": each its question, under
     * it "H0022 · open · 3 versions · what the note adds", folded open while
     * the hypothesis is open. Its versions in a box — letter, claim, what it
     * would bring — and where the tree can show it "linked in the view only",
     * "Show" with a switch: the versions of one hypothesis act as a radio
     * group that can have none (switching one on switches the shown one
     * off; off unlinks it). The shown version: a ghost's tint, "shown · +
     * 5 people · Find". No switch for a version without a link, one only in
     * words (same, siblings: "Text only, cannot be shown.") or a decided or
     * abandoned hypothesis. Under the box a row for its actions, empty in
     * phase 1 (phase 2: "Link for real" at the shown version).
     */
    researchHypothesesHtml(personId: PersonId, hypotheses: readonly ResearchHypothesis[]): string {
        const r = strings.research;
        const v = strings.viewLinks;
        const offered = TreeRenderer.viewLinksOffered();
        return hypotheses.map(h => {
            const open = isOpenHypothesis(h);
            const variants = h.variants ?? [];
            const note = researchHypothesisNote(h);
            const meta = [h.id ?? '', researchHypothesisState(h), variants.length > 0 ? r.hypoVersions(variants.length) : '',
                variants.length > 0 ? note : ''].filter(Boolean).join(' · ');
            const offers = h.id && offered ? this.viewLinkOffersFor(h.id) : [];
            const rows = variants.map(variant => {
                const o = offers.find(x => x.variant === variant.id);
                const chosen = h.status === 'decided' && h.chosen === variant.id;
                const canSwitch = open && !!o?.choice && (o.shown || o.state?.state === 'draw');
                let metaHtml: string;
                if (o?.shown && o.choice) {
                    metaHtml = `<span class="view-link-icon" aria-hidden="true"></span><span>${esc(`${v.shownWord} · ${v.people(o.people)}`)} · </span>`
                        + `<button type="button" class="link-button prv-find" data-variant="${esc(variant.id)}" aria-label="${esc(v.findAria(this.viewLinkWho(o.choice)))}">${esc(v.find)}</button>`;
                } else {
                    const what = o?.choice ? v.people(o.people)
                        : o?.textOnly || variant.links.some(l => l.kind === 'same' || l.kind === 'siblings') ? v.textOnly
                        : v.notInResearch;
                    const state = !open || !o?.state ? ''
                        : o.state.state === 'real' ? v.real
                        : o.state.state === 'invalid' ? v.reason[o.state.reason] : '';
                    metaHtml = esc([chosen ? r.hypoChosen : '', what, state].filter(Boolean).join(' · '));
                }
                const title = variant.title ?? '';
                const long = title.length > 90;
                const titleHtml = long
                    ? `<button type="button" class="prv-title prv-title--more" aria-expanded="false">${esc(title)}</button>`
                    : `<span class="prv-title">${esc(title)}</span>`;
                const sw = canSwitch ? `
                    <button type="button" class="view-link-switch" role="switch" aria-checked="${o!.shown ? 'true' : 'false'}"
                        data-variant="${esc(variant.id)}" aria-label="${esc(v.switchAria(variant.id))}">
                        <span class="view-link-switch__label" aria-hidden="true">${esc(v.switchLabel)}</span>
                        <span class="view-link-switch__track" aria-hidden="true"></span>
                    </button>` : '';
                return `<div class="person-research-variant${o?.shown ? ' is-shown' : ''}${chosen ? ' is-chosen' : ''}" role="listitem" data-variant="${esc(variant.id)}">
                    <span class="prv-id" aria-hidden="true">${esc(variant.id)}</span>
                    <span class="prv-text">${titleHtml}<span class="prv-meta">${metaHtml}</span></span>${sw}
                </div>`;
            }).join('');
            return `
                <details class="person-research-hypo${open ? '' : ' is-closed'}"${h.id ? ` data-hypo="${esc(h.id)}"` : ''}${open ? ' open' : ''}>
                    <summary class="person-research-hypo-head">
                        <span class="person-research-hypo-title">${esc(h.title)}</span>
                        ${meta ? `<span class="person-research-hypo-meta">${esc(meta)}</span>` : ''}
                    </summary>
                    ${rows ? `<div class="person-research-variants" role="list" aria-label="${esc(h.title)}">${rows}</div>` : ''}
                    ${!rows && h.note ? `<p class="person-research-hypo-note">${esc(h.note)}</p>` : ''}
                    <div class="person-research-hypo-actions"></div>
                </details>`;
        }).join('');
    },

    /** Wire the hypotheses' switches, "Find" and the long claims (inside the dialog `root`). */
    bindResearchHypotheses(root: HTMLElement, personId: PersonId): void {
        const host = root.querySelector<HTMLElement>('.person-research-hypos');
        if (!host) return;
        const redraw = (focus?: { hypo: string; variant: string }): void => {
            const open = new Set([...host.querySelectorAll<HTMLDetailsElement>('.person-research-hypo')].filter(d => d.open).map(d => d.dataset.hypo ?? ''));
            const expanded = new Set([...host.querySelectorAll<HTMLElement>('.person-research-variant.is-expanded')]
                .map(row => `${row.closest<HTMLElement>('[data-hypo]')?.dataset.hypo}:${row.dataset.variant}`));
            host.innerHTML = this.researchHypothesesHtml(personId, DataManager.getPerson(personId)?.research?.hypotheses ?? []);
            host.querySelectorAll<HTMLDetailsElement>('.person-research-hypo[data-hypo]').forEach(d => { d.open = open.has(d.dataset.hypo!); });
            for (const key of expanded) {
                const [hypo, variant] = key.split(':');
                this.expandResearchVariant(host, hypo, variant);
            }
            if (focus) {
                host.querySelector<HTMLElement>(`[data-hypo="${CSS.escape(focus.hypo)}"] .view-link-switch[data-variant="${CSS.escape(focus.variant)}"]`)?.focus({ preventScroll: true });
            }
        };
        host.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const hypo = target.closest<HTMLElement>('[data-hypo]')?.dataset.hypo;
            const more = target.closest<HTMLButtonElement>('.prv-title--more');
            if (more) {
                const row = more.closest<HTMLElement>('.person-research-variant')!;
                const on = !row.classList.contains('is-expanded');
                row.classList.toggle('is-expanded', on);
                more.setAttribute('aria-expanded', String(on));
                return;
            }
            if (!hypo) return;
            const find = target.closest<HTMLButtonElement>('.prv-find');
            if (find) {
                const treeId = DataManager.getCurrentTreeId();
                const link = treeId ? loadViewLinks(treeId).find(l => l.hypo === hypo) : null;
                if (!link) return;
                this.closePersonResearchDialog();
                void this.viewLinkFind(link);
                return;
            }
            const sw = target.closest<HTMLButtonElement>('.view-link-switch');
            if (!sw || sw.disabled) return;
            const variant = sw.dataset.variant!;
            sw.disabled = true;
            void (async () => {
                if (sw.getAttribute('aria-checked') === 'true') {
                    await this.viewLinkUnlink(hypo, { near: sw });
                } else {
                    const choice = this.viewLinkOffersFor(hypo).find(o => o.variant === variant)?.choice;
                    if (choice) await this.viewLinkShow(choice);
                }
                // The dialog may have gone meanwhile (Esc).
                if (host.isConnected) redraw({ hypo, variant });
            })();
        });
    },

    /** Unfold a version's whole claim (a long one shows two lines). */
    expandResearchVariant(root: HTMLElement, hypo: string, variant: string): void {
        const row = root.querySelector<HTMLElement>(`.person-research-hypo[data-hypo="${CSS.escape(hypo)}"] .person-research-variant[data-variant="${CSS.escape(variant)}"]`);
        if (!row) return;
        row.classList.add('is-expanded');
        row.querySelector('.prv-title--more')?.setAttribute('aria-expanded', 'true');
    },

    /**
     * Bring a hypothesis of the open dialog into view, folded open, with the
     * keyboard on its heading (and the version's claim unfolded). False when
     * the dialog has no such hypothesis.
     */
    openResearchHypothesis(root: HTMLElement, hypo: string, variant?: string): boolean {
        const details = root.querySelector<HTMLDetailsElement>(`.person-research-hypo[data-hypo="${CSS.escape(hypo)}"]`);
        if (!details) return false;
        details.open = true;
        if (variant) this.expandResearchVariant(root, hypo, variant);
        const head = details.querySelector<HTMLElement>('summary');
        head?.focus({ preventScroll: true });
        details.scrollIntoView({ block: 'start' });
        return true;
    },

    /** Today's row of a decided conflict: its question, the values, the decision with its source. */
    researchConflictDecidedRowHtml(c: ResearchConflict): string {
        const r = strings.research;
        const values = c.values.map(v => conflictValueSaid(researchValueText(c.fact, v.value))).join(' vs. ');
        // The decision is words ("1865 (S0001)"); a source only when the research names one.
        const decision = c.decision ? r.decided(c.decision.value, sourceTitle(c.decision)) : '';
        const id = researchConflictRef(c.id);
        return `
                <div class="person-research-decided"${id ? ` data-decided="${esc(id)}"` : ''} tabindex="-1">
                    <span>${esc(researchConflictTitle(c))}: ${esc(values)}</span>
                    ${decision ? `<span class="person-research-decision">${esc(decision)}</span>` : ''}
                </div>`;
    },

    closePersonResearchDialog(): void {
        // The decided cards are done: opened again, the data say it.
        this.researchConflictCardsClosed();
        const dialog = document.getElementById(DIALOG_ID);
        const hadFocus = !!dialog?.contains(document.activeElement);
        dialog?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        const opener = dialogOpener;
        dialogOpener = null;
        if (!hadFocus || !opener?.isConnected) return;
        if (opener.matches('.research-edge')) this.focusResearchEdgeQuietly(opener);
        else opener.focus({ preventScroll: true });
    },

    /**
     * The edit form: "conflict ›" at the label of each field the research has
     * an open conflict about (birth date or place, death, sex, name). A field
     * with one conflict the app can decide by a side: the tag opens the panel
     * by the field (conflict-panel-ui.ts); any other opens the dialog above
     * the form. Cards in the tree stay as they are. A title's conflict marks
     * its field, or the given name while the titles are folded away behind
     * "+ title". Drawn again as conflicts settle: the keyboard stays on a
     * field's tag while it is there.
     */
    markResearchConflicts(personId: PersonId): void {
        const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('#person-modal .pm-conflict-tag')?.dataset.field ?? '';
        document.querySelectorAll('#person-modal .pm-conflict-tag').forEach(n => n.remove());
        const r = strings.research;
        const titleInput = (id: string): string =>
            document.getElementById(id)?.closest('[hidden]') ? 'input-firstname' : id;
        const byInput = new Map<string, ResearchConflict[]>();
        for (const c of this.personOpenConflicts(personId)) {
            const fact = c.fact.toUpperCase();
            const date = conflictDateField(c);
            const input = fact === 'BIRT' ? (date ? 'input-birthdate' : 'input-birthplace')
                : fact === 'DEAT' ? (date ? 'input-deathdate' : 'input-deathplace')
                : fact === 'NAME' ? 'input-firstname'
                : fact === 'SEX' ? 'gender-segment'
                : fact === 'NPFX' ? titleInput('input-title-before')
                : fact === 'NSFX' ? titleInput('input-title-after')
                : null;
            if (input) byInput.set(input, [...(byInput.get(input) ?? []), c]);
        }
        const person = DataManager.getPerson(personId);
        for (const [input, conflicts] of byInput) {
            const label = input === 'gender-segment'
                ? document.querySelector<HTMLElement>('#gender-segment')?.closest('.form-group')?.querySelector('label')
                : document.querySelector<HTMLElement>(`#person-modal label[for="${input}"]`);
            if (!label) continue;
            const fact = conflicts[0].fact.toUpperCase();
            // One conflict there, decidable here: the panel by the field.
            const panelId = conflicts.length === 1 && canDecideInApp(conflicts[0], person) ? researchConflictRef(conflicts[0].id) : null;
            const tag = document.createElement('button');
            tag.type = 'button';
            tag.className = 'pm-conflict-tag';
            tag.dataset.field = input;
            tag.textContent = r.conflictTag;
            if (panelId) {
                tag.dataset.conflict = panelId;
                tag.setAttribute('aria-haspopup', 'dialog');
                tag.setAttribute('aria-expanded', String(this.isResearchConflictPanelOpen(panelId)));
                tag.setAttribute('aria-label', strings.conflict.panelTitle(researchConflictTitle(conflicts[0])));
            } else {
                tag.setAttribute('aria-label', r.conflictTagSr(researchFactLabel(fact)));
            }
            tag.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!panelId) {
                    this.showPersonResearchDialog(personId);
                } else if (this.isResearchConflictPanelOpen(panelId)) {
                    this.closeResearchConflictPanel();
                } else {
                    const field = input === 'gender-segment'
                        ? document.querySelector<HTMLElement>('#gender-segment .segment-btn.active') ?? document.querySelector<HTMLElement>('#gender-segment .segment-btn')
                        : document.getElementById(input);
                    this.openResearchConflictPanel(personId, panelId, tag, field);
                }
            };
            label.appendChild(tag);
            if (focused === input) tag.focus({ preventScroll: true });
        }
    },

    /** The edit form open for a person: its tags drawn again from the conflicts now (after one settled). */
    refreshPersonFormConflicts(): void {
        const modal = document.getElementById('person-modal');
        if (modal?.classList.contains('active') && this.currentId && DataManager.getPerson(this.currentId)) this.markResearchConflicts(this.currentId);
    },
});
