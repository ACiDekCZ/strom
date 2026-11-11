/**
 * "What the research knows" about one person: the sources that disagree, the
 * hypotheses the research works with and what it already searched. Written by
 * Strom Research into its GEDCOM (Person.research), read-only here — deciding
 * a conflict or handing it to the agent continues in the research (its mark).
 * Readable everywhere (phone, locked, read-only); the links only on a
 * computer whose research announced them.
 */

import { researchActionLabel } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, ResearchConflict, ResearchConflictValue, ResearchHypothesis, ResearchHypothesisVariant } from '../types.js';
import { isOpenHypothesis, loadViewLinks, researchHypotheses } from '../view-links.js';
import {
    researchHypothesisNote, researchHypothesisState, researchHypothesisDecision, researchHypothesisLinkLabel, HYPOTHESIS_REASON_FOLD,
    researchHypothesisBigJoin, researchHypothesisReopenNote, researchHypothesisCannotReopenText, researchHypothesisWaitText,
    researchHypothesisPreviousText, researchHypothesisHoldsSinceText, researchHypothesisProposalParts, researchHypothesisNoteText,
} from '../research-hypotheses.js';
import { HypothesisPick } from '../research-hypothesis-pick.js';
import { HypothesisCardButton, hypothesisCardPlan } from '../research-hypothesis-card.js';
import {
    PendingHypothesis, clearHypothesisCardNotes, hypothesisCardNote, hypothesisStateKey, newPendingHypothesis, onPendingHypothesisChange,
    pendingHypothesis, pendingHypothesisPhase, setPendingHypothesis,
} from '../research-hypothesis-wait.js';
import { formatFlexDate } from '../dates.js';
import { parseGedcomDate, gedcomTagEventType } from '../ged-parser.js';
import { HYPOTHESES_DECIDE_FEATURE, researchConflictRef, researchHypothesisRef, researchLinkMark } from '../research-link.js';
import { lastBridgeStatus } from './research-sync-ui.js';
import { canDecideInApp, conflictFromEdit } from '../research-decide.js';
import { ConflictScope } from '../research-conflict-card.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { PersonMenuAction } from './context-menu.js';
import { personSubtitle } from './person-sources-ui.js';
import { helpMark } from './help-mark.js';
import type { HelpTopic } from '../help/topics.js';
import { researchClaimValue } from '../research-claim.js';

const DIALOG_ID = 'person-research-modal';
/** How long a conflict's card opened at stays lit up (DEV §6.2). */
export const CONFLICT_HIGHLIGHT_MS = 1500;
/** What had the keyboard when the dialog opened (a line's label, a stub): it gets it back on close. */
let dialogOpener: HTMLElement | null = null;

/**
 * The hypotheses whose "Change" was clicked (spec 074 DEV §6): a mode of this
 * page, by `${researchId}|${hypothesisId}`; "Cancel the change", a decision
 * asked or the dialog closed ends it.
 */
const changingHypotheses = new Set<string>();

function hypothesisKey(researchId: string, hypothesisId: string): string {
    return `${researchId.toLowerCase()}|${hypothesisId}`;
}

/** Draws the open dialog's hypotheses again (set while the dialog is open). */
let redrawHypotheses: (() => void) | null = null;

/** The one listener of the waits (registered once; it draws the dialog that is open). */
function redrawPendingHypotheses(): void {
    redrawHypotheses?.();
}

/** The keyboard on a hypothesis's card: its wait, else its first working choice, else its heading. */
function focusHypothesis(host: HTMLElement, hypo: string): void {
    const card = host.querySelector<HTMLElement>(`[data-hypo="${CSS.escape(hypo)}"]`);
    (card?.querySelector<HTMLElement>('.prv-wait-again')
        ?? card?.querySelector<HTMLElement>('.prv-pick:not([disabled]), .prh-act:not([disabled])')
        ?? card?.querySelector<HTMLElement>(':scope > summary'))?.focus({ preventScroll: true });
}

/** Spec 060 K1.8: from this many open hypotheses (the person deciding) the switch to the AI deciding is offered. */
export const HYPOTHESES_OFFER_MIN = 10;
const HYPOTHESES_OFFER_HIDDEN_KEY = 'strom-research-hypos-offer-hidden:';

function hypothesesOfferHidden(researchId: string): boolean {
    try {
        return localStorage.getItem(HYPOTHESES_OFFER_HIDDEN_KEY + researchId.toLowerCase()) === '1';
    } catch {
        return false;
    }
}

function hideHypothesesOffer(researchId: string): void {
    try {
        localStorage.setItem(HYPOTHESES_OFFER_HIDDEN_KEY + researchId.toLowerCase(), '1');
    } catch { /* no storage: hidden until the dialog is opened again */ }
}

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
export function researchValueText(fact: string, said: string): string {
    // A conflict kept from before the parser dropped a batch's source label ("@s:59 let…").
    const value = researchClaimValue(said);
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
    return said.length > 0 && said.every(v => researchValueText(c.fact, v.value) !== researchClaimValue(v.value) || /^\s*\d{3,4}\s*\??\s*$/.test(v.value));
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
     * `questions`: opened from the card's "?" (or the person menu without a
     * conflict) — the person's open question comes into view and takes the focus.
     */
    showPersonResearchDialog(personId: PersonId, opts: { edge?: boolean; hypo?: { id: string; variant?: string }; conflict?: string; questions?: boolean } = {}): void {
        // Drawn again from inside itself: the one that opened it first keeps it.
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body && !active.closest(`#${DIALOG_ID}`)) dialogOpener = active;
        document.getElementById(DIALOG_ID)?.remove();
        const person = DataManager.getPerson(personId);
        // The conflicts as the research has them now (its version not loaded may say more, finding 40),
        // and one decided from here whose card still says so.
        const conflicts = this.researchConflictsShown(personId);
        // The person's open question (the card's "?"): its own section, first.
        const question = person?.question?.trim() ?? '';
        // Facts waiting to be verified (spec 065 §10k): the "Verifying" section, even with nothing else to say.
        const verifyWaiting = (this.personVerifyState(personId)?.pending ?? 0) > 0;
        const research = person?.research ?? (conflicts.length || question || verifyWaiting ? {} : undefined);
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
                    <p class="person-research-sources-only">${esc(conflictFromEdit(c) ? strings.conflict.editOnly : strings.conflict.sourcesOnly)}</p>
                    ${canDecide && id ? `
                    <div class="person-research-conflict-actions">
                        <button type="button" class="link-button" data-conflict="${esc(id)}" data-do="decide">${researchActionLabel(r.decide, researchLinkMark('conflict', { conflictDo: 'decide' }))}</button>${toAgent ? `
                        <button type="button" class="link-button person-research-agent" data-conflict="${esc(id)}" data-do="agent"
                            aria-label="${esc(`${r.leaveToAgent}, ${r.aiBadge}, ${r.opensInResearchSr}`)}">${researchActionLabel(r.leaveToAgent, researchLinkMark('conflict', { conflictDo: 'agent' }), { sr: false })}</button>` : ''}
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

        // A section with its help (the conflicts, the hypotheses): the heading in a row, "?" last on its right (1105 §10).
        const section = (title: string, body: string, help?: HelpTopic): string => !body ? ''
            : help ? `<section class="person-research-section" data-section-help="${help}"><div class="person-research-section-head"><h3 class="menu-section-header">${esc(title)}</h3></div>${body}</section>`
            : `<section class="person-research-section"><h3 class="menu-section-header">${esc(title)}</h3>${body}</section>`;
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
                    ${question ? `<section class="person-research-section person-research-question-section"><h3 class="menu-section-header">${esc(strings.card.tipQuestionHead)}</h3><p class="person-research-question" tabindex="-1">${esc(question)}</p></section>` : ''}
                    ${this.researchEdgeSectionHtml(personId)}
                    ${section(r.conflicts, openHtml + decidedHtml, 'personConflicts')}
                    ${section(r.hypotheses, hypotheses.length > 0 ? `${this.researchHypothesesOfferHtml()}<div class="person-research-hypos">${this.researchHypothesesHtml(personId, hypotheses)}</div>` : '', 'hypotheses')}
                    ${section(r.searched, searched.length > 0 ? `
                        <table class="person-research-searched">
                            <thead><tr><th scope="col">${esc(r.searchedBook)}</th><th scope="col">${esc(r.searchedYears)}</th><th scope="col">${esc(r.searchedResult)}</th></tr></thead>
                            <tbody>${searched.map(x => `<tr>
                                <td>${esc(x.title)}</td>
                                <td class="person-research-years">${esc(years(x.from, x.to))}</td>
                                <td>${x.result ? `<span class="person-research-result person-research-result--${x.result}">${esc(x.result === 'found' ? r.found : r.none)}</span>` : ''}</td>
                            </tr>`).join('')}</tbody>
                        </table>` : '')}
                    ${this.personVerifySectionHtml(personId)}
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" id="person-research-close" data-dismiss>${esc(strings.buttons.close)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(DIALOG_ID);
        for (const head of overlay.querySelectorAll<HTMLElement>('[data-section-help] > .person-research-section-head')) {
            head.append(helpMark(head.parentElement!.dataset.sectionHelp as HelpTopic));
        }
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
        const verifySection = overlay.querySelector<HTMLElement>('[data-verify-section="person"]');
        if (verifySection) this.bindVerifySection(verifySection, () => this.closePersonResearchDialog());
        this.bindResearchEdgeSection(overlay, personId);
        this.bindResearchHypotheses(overlay, personId);
        this.bindResearchHypothesesOffer(overlay);
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
        } else if (opts.questions && overlay.querySelector('.person-research-question')) {
            const q = overlay.querySelector<HTMLElement>('.person-research-question')!;
            q.scrollIntoView({ block: 'nearest' });
            q.focus({ preventScroll: true });
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
     * 5 people · Find". No switch for a version without a link, one the
     * tree records already ("The tree records this already"), one only in
     * words (same, siblings: "Text only, cannot be shown.") or a decided or
     * abandoned hypothesis. A decided or abandoned one says who decided it
     * when the agent did ("decided by the agent"), the day and, folded open,
     * the reason (a long one its first lines, unfolded on a click). Under the
     * box a row for its actions: the way into the research — "Decide in the
     * research" (open) or "Change in the research" — only where the research
     * on this computer announced the `hypothesis` link.
     */
    researchHypothesesHtml(personId: PersonId, hypotheses: readonly ResearchHypothesis[]): string {
        return hypotheses.map(h => {
            const pick = this.researchHypothesisPickable(h);
            return pick === 'old' || pick === 'merge' ? this.researchHypothesisTodayHtml(h, pick) : this.researchHypothesisPickHtml(personId, h, pick);
        }).join('');
    },

    /** A hypothesis's heading line: "H0022 · open · 3 versions · its note" (or who decided it and when), "left open {day}". */
    researchHypothesisMetaHtml(h: ResearchHypothesis, opts: { left?: boolean } = {}): string {
        const r = strings.research;
        const variants = h.variants ?? [];
        const note = researchHypothesisNote(h);
        const decision = researchHypothesisDecision(h);
        return [
            esc(h.id ?? ''), esc(researchHypothesisState(h)),
            decision.by ? `<span class="person-research-hypo-by">${esc(decision.by)}</span>` : '',
            esc(decision.day), esc(variants.length > 0 ? r.hypoVersions(variants.length) : ''), esc(variants.length > 0 ? note : ''),
            opts.left && h.leftOpen && isOpenHypothesis(h) ? esc(r.hypoLeft(formatFlexDate(h.leftOpen))) : '',
        ].filter(Boolean).join(' · ');
    },

    /** A decided or abandoned hypothesis's reason ("Reason: …", a long one folded). */
    researchHypothesisReasonHtml(h: ResearchHypothesis): string {
        const r = strings.research;
        const decision = researchHypothesisDecision(h);
        const reasonLong = decision.reason.length > HYPOTHESIS_REASON_FOLD;
        return !decision.reason ? '' : `
                    <p class="person-research-hypo-reason${reasonLong ? ' is-long' : ''}"><span class="prh-reason-label">${esc(r.hypoReason)}:</span> ${reasonLong
                        ? `<button type="button" class="prh-reason-text prh-reason--more" aria-expanded="false">${esc(decision.reason)}</button>`
                        : `<span class="prh-reason-text">${esc(decision.reason)}</span>`}</p>`;
    },

    /** A version's claim: two lines, a long one (over 90 characters) unfolded on a click. */
    researchVariantTitleHtml(variant: ResearchHypothesisVariant): string {
        const title = variant.title ?? '';
        return title.length > 90
            ? `<button type="button" class="prv-title prv-title--more" aria-expanded="false">${esc(title)}</button>`
            : `<span class="prv-title">${esc(title)}</span>`;
    },

    /** A version's "Show" switch (the view link). */
    researchVariantSwitchHtml(variant: ResearchHypothesisVariant, shown: boolean): string {
        const v = strings.viewLinks;
        return `
                    <button type="button" class="view-link-switch" role="switch" aria-checked="${shown ? 'true' : 'false'}"
                        data-variant="${esc(variant.id)}" aria-label="${esc(v.switchAria(variant.id))}">
                        <span class="view-link-switch__label" aria-hidden="true">${esc(v.switchLabel)}</span>
                        <span class="view-link-switch__track" aria-hidden="true"></span>
                    </button>`;
    },

    /**
     * Today's card (spec 060, and DEV §2 `old`): what an older research, one
     * without deciding by a link, gets. `merge` (DEV §2): the same rows, a line
     * that merging people is decided in the research, and the way there the
     * card's main action.
     */
    researchHypothesisTodayHtml(h: ResearchHypothesis, pick: HypothesisPick): string {
        const r = strings.research;
        const v = strings.viewLinks;
        const offered = TreeRenderer.viewLinksOffered();
        const canLink = this.researchLinkAvailable('hypothesis');
        const open = isOpenHypothesis(h);
        const variants = h.variants ?? [];
        const metaHtml = this.researchHypothesisMetaHtml(h);
        const reasonHtml = this.researchHypothesisReasonHtml(h);
        const hypoId = researchHypothesisRef(h.id);
        const linkHtml = canLink && hypoId ? `<button type="button" class="link-button person-research-hypo-link" data-hypo-do="decide">${researchActionLabel(researchHypothesisLinkLabel(h), researchLinkMark('hypothesis'))}</button>` : '';
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
                    : (o ? o.inTree : !!variant.inTree?.length) ? v.inTree
                    : o?.textOnly || variant.links.some(l => l.kind === 'same' || l.kind === 'siblings') ? v.textOnly
                    : v.notInResearch;
                const state = !open || !o?.state ? ''
                    : o.state.state === 'real' ? v.real
                    : o.state.state === 'invalid' ? v.reason[o.state.reason] : '';
                metaHtml = esc([chosen ? r.hypoChosen : '', what, state].filter(Boolean).join(' · '));
            }
            const sw = canSwitch ? this.researchVariantSwitchHtml(variant, !!o!.shown) : '';
            return `<div class="person-research-variant${o?.shown ? ' is-shown' : ''}${chosen ? ' is-chosen' : ''}" role="listitem" data-variant="${esc(variant.id)}">
                    <span class="prv-id" aria-hidden="true">${esc(variant.id)}</span>
                    <span class="prv-text">${this.researchVariantTitleHtml(variant)}<span class="prv-meta">${metaHtml}</span></span>${sw}
                </div>`;
        }).join('');
        const mergeHtml = pick === 'merge' ? `<p class="prh-info">${esc(r.hypoMerge)}</p>` : '';
        return `
                <details class="person-research-hypo${open ? '' : ' is-closed'}"${pick === 'merge' ? ' data-pick="merge"' : ''}${h.id ? ` data-hypo="${esc(h.id)}"` : ''}${open ? ' open' : ''}>
                    <summary class="person-research-hypo-head">
                        <span class="person-research-hypo-title">${esc(h.title)}</span>
                        ${metaHtml ? `<span class="person-research-hypo-meta">${metaHtml}</span>` : ''}
                    </summary>${reasonHtml}
                    ${rows ? `<div class="person-research-variants" role="list" aria-label="${esc(h.title)}">${rows}</div>` : ''}
                    ${!rows && h.note ? `<p class="person-research-hypo-note">${esc(h.note)}</p>` : ''}${mergeHtml}
                    <div class="person-research-hypo-actions">${linkHtml}</div>
                </details>`;
    },

    /**
     * The card of a hypothesis that knows deciding in the app (spec 074, DEV
     * §1–§7, hypothesisCardPlan): `pick` — under each version's claim the
     * agent's proposal, its sources for and against, what choosing it does to
     * the tree and "Choose" (into the research's terminal); under the box "No
     * version holds" and "Leave open", or for a decided one "Change" and
     * "Reopen" with what that does (or why it cannot be); "Decide in the
     * research" quiet below a line. The wait for the research's confirmation
     * at what was asked, the other choices switched off. `remote`: readable,
     * "Show" works, a line that it is decided on the research's computer.
     * `readonly`: only read.
     */
    researchHypothesisPickHtml(personId: PersonId, h: ResearchHypothesis, pick: HypothesisPick): string {
        const r = strings.research;
        const v = strings.viewLinks;
        const rid = this.activeResearchId();
        const open = isOpenHypothesis(h);
        const hypoId = researchHypothesisRef(h.id);
        const pending = rid && h.id ? pendingHypothesis(rid, h.id) : null;
        // What became of a wait that loaded nothing new here (DEV §4): decided otherwise, or "Later".
        const note = rid && h.id ? hypothesisCardNote(rid, h.id) : null;
        const plan = hypothesisCardPlan(h, pick, {
            changing: !!rid && !!h.id && changingHypotheses.has(hypothesisKey(rid, h.id)),
            pending,
            linkable: this.researchLinkAvailable('hypothesis') && !!hypoId,
            held: note?.kind === 'later',
        });
        const metaHtml = this.researchHypothesisMetaHtml(h, { left: true });
        const holds = plan.holdsSince ? researchHypothesisHoldsSinceText(h) : '';
        const prev = researchHypothesisPreviousText(h);
        const shownNote = note && (note.kind === 'later' || note.state === hypothesisStateKey(h)) ? note : null;
        const noteHtml = shownNote ? `
                    <p class="prh-info prh-decided-note" role="status">${esc(researchHypothesisNoteText(shownNote))}${shownNote.kind === 'later' ? `
                        <button type="button" class="link-button prh-decided-load">${esc(r.hypoLoad)}</button>` : ''}</p>` : '';
        const headHtml = noteHtml + (holds ? `
                    <p class="prh-holds">${esc(holds)}</p>`
            : `${this.researchHypothesisReasonHtml(h)}${prev ? `
                    <p class="prh-prev">${esc(prev)}</p>` : ''}`);
        const offers = h.id && TreeRenderer.viewLinksOffered() && pick !== 'readonly' ? this.viewLinkOffersFor(h.id) : [];
        const catalog = DataManager.getData().sources ?? {};
        const terminal = researchLinkMark('hypothesis');
        const off = (b: HypothesisCardButton): string => b === 'off' ? ' disabled' : '';
        const proposal = researchHypothesisProposalParts(h);
        const rows = (h.variants ?? []).map((variant, i) => {
            const vp = plan.variants[i];
            const o = offers.find(x => x.variant === variant.id);
            const canSwitch = open && !!o?.choice && (o.shown || o.state?.state === 'draw');
            const big = open ? researchHypothesisBigJoin({ people: variant.people ?? (o?.choice ? o.people : undefined) }) : 0;
            const bigHtml = big ? `<span class="prv-big"><span class="view-link-icon view-link-icon--12" aria-hidden="true"></span>${esc(r.hypoBig(big))}</span>` : '';
            const tagHtml = vp.tag ? `<span class="prv-tag">${esc(vp.tag === 'holds' ? r.hypoHoldsNow : r.hypoChosen)}</span>` : '';
            let metaHtml: string;
            if (o?.shown && o.choice) {
                metaHtml = `${bigHtml}${big ? '' : '<span class="view-link-icon" aria-hidden="true"></span>'}<span>${esc(big ? v.shownWord : `${v.shownWord} · ${v.people(o.people)}`)} · </span>`
                    + `<button type="button" class="link-button prv-find" data-variant="${esc(variant.id)}" aria-label="${esc(v.findAria(this.viewLinkWho(o.choice)))}">${esc(v.find)}</button>`;
            } else {
                const what = big ? ''
                    : o?.choice ? v.people(variant.people ?? o.people)
                    : (o ? o.inTree : !!variant.inTree?.length) ? v.inTree
                    : o?.textOnly || variant.links.some(l => l.kind === 'same' || l.kind === 'siblings') ? v.textOnly
                    : variant.people ? v.people(variant.people)
                    : v.notInResearch;
                const state = !open || !o?.state ? ''
                    : o.state.state === 'real' ? v.real
                    : o.state.state === 'invalid' ? v.reason[o.state.reason] : '';
                const words = [what, state].filter(Boolean).join(' · ');
                metaHtml = `${tagHtml}${bigHtml}${words ? `<span>${esc(words)}</span>` : ''}`;
            }
            const proposalHtml = vp.proposal && proposal ? `
                        <span class="prv-proposal"><strong>${esc(proposal.label)}</strong>${proposal.text ? ` <span>${esc(proposal.text)}</span>` : ''}</span>` : '';
            const sources = plan.extras ? this.researchVariantSourcesHtml(variant, catalog) : null;
            const noteText = vp.note === 'stays' ? r.hypoStaysNote : vp.note === 'inTree' ? r.hypoInTreeNote : vp.note === 'noLink' ? r.hypoNoLinkNote : '';
            const pickHtml = vp.pick ? `
                        <button type="button" class="secondary prv-pick" data-hypo-pick="${esc(variant.id)}" aria-label="${esc(r.hypoPickAria(variant.id))}"${off(vp.pick)}>${researchActionLabel(r.hypoPick, terminal, { sr: false })}</button>` : '';
            const waitHtml = vp.waiting && pending ? this.researchHypothesisWaitHtml(h, pending) : '';
            const sw = canSwitch ? this.researchVariantSwitchHtml(variant, !!o!.shown) : '';
            const cls = [o?.shown ? 'is-shown' : '', vp.tag ? 'is-chosen' : '', vp.dim ? 'is-dim' : ''].filter(Boolean).join(' ');
            return `<div class="person-research-variant${cls ? ` ${cls}` : ''}" role="listitem" data-variant="${esc(variant.id)}">
                    <span class="prv-id" aria-hidden="true">${esc(variant.id)}</span>
                    <span class="prv-text">${this.researchVariantTitleHtml(variant)}<span class="prv-meta">${metaHtml}</span>${proposalHtml}${sources ? `
                        <button type="button" class="link-button prv-sources-toggle" aria-expanded="false">${esc(r.hypoSources(sources.count))}</button>${sources.html}` : ''}${noteText ? `
                        <span class="prv-kindnote">${esc(noteText)}</span>` : ''}${pickHtml}${waitHtml}</span>${sw}
                </div>`;
        }).join('');
        const proposalNoneHtml = plan.proposalNone && proposal ? `
                    <p class="prv-proposal prh-proposal-none"><strong>${esc(proposal.label)}</strong> <span>${esc(proposal.text)}</span></p>` : '';
        // Under the box: the wait for what was asked there, the choices, what reopening does.
        let underHtml = '';
        if (plan.footWait && pending) underHtml += this.researchHypothesisWaitHtml(h, pending);
        const buttons: string[] = [];
        if (plan.foot) {
            if (plan.foot.none) buttons.push(`<button type="button" class="secondary prh-act" data-hypo-act="abandon"${off(plan.foot.none)}>${researchActionLabel(r.hypoNone, terminal)}</button>`);
            if (plan.foot.leave) buttons.push(`<button type="button" class="secondary prh-act" data-hypo-act="keep-open"${off(plan.foot.leave)}>${researchActionLabel(r.hypoLeave, terminal)}</button>`);
            if (plan.foot.cancelChange) buttons.push(`<button type="button" class="link-button prh-cancel-change" data-hypo-act="change-cancel">${esc(r.hypoChangeCancel)}</button>`);
        }
        if (plan.decided) {
            const dis = plan.decided.off ? ' disabled' : '';
            buttons.push(`<button type="button" class="secondary prh-act" data-hypo-act="change"${dis}>${esc(r.hypoChangeHere)}</button>`);
            if (plan.decided.reopen) buttons.push(`<button type="button" class="secondary prh-act" data-hypo-act="reopen"${dis}>${researchActionLabel(r.hypoReopen, terminal)}</button>`);
        }
        if (buttons.length) underHtml += `
                    <div class="person-research-hypo-actions prh-choices">${buttons.join('')}</div>`;
        const decNote = !plan.decided ? '' : plan.decided.cannot ? researchHypothesisCannotReopenText(h) : researchHypothesisReopenNote(h);
        if (decNote) underHtml += `
                    <p class="prh-note">${esc(decNote)}</p>`;
        if (plan.changeHint) underHtml += `
                    <p class="prh-note">${esc(r.hypoChangeReason)}</p>`;
        if (plan.info) underHtml += `
                    <p class="prh-info">${esc(plan.info === 'remote' ? r.hypoRemote : r.hypoMerge)}</p>`;
        if (plan.link) {
            const label = open ? r.decide : plan.decided?.cannot ? r.decide : r.hypoChange;
            underHtml += `
                    <div class="prh-more"><button type="button" class="link-button person-research-hypo-link prh-more-link" data-hypo-do="decide">${researchActionLabel(label, terminal)}</button></div>`;
        }
        return `
                <details class="person-research-hypo${open ? '' : ' is-closed'}" data-pick="${pick}"${h.id ? ` data-hypo="${esc(h.id)}"` : ''}${open ? ' open' : ''}>
                    <summary class="person-research-hypo-head">
                        <span class="person-research-hypo-title">${esc(h.title)}</span>
                        ${metaHtml ? `<span class="person-research-hypo-meta">${metaHtml}</span>` : ''}
                    </summary>${headHtml}
                    ${rows ? `<div class="person-research-variants" role="list" aria-label="${esc(h.title)}">${rows}</div>` : ''}
                    ${!rows && h.note ? `<p class="person-research-hypo-note">${esc(h.note)}</p>` : ''}${proposalNoneHtml}${underHtml}
                </details>`;
    },

    /**
     * A version's sources (DEV §1): "+ For:" the ones it names (3 SOUR), "−
     * Against:" what speaks against it (3 _AGAINST) with its sources; a source
     * of the file opens as elsewhere in What the research knows. Null when it
     * names neither; `count` for "Sources (n)" (folded on a phone).
     */
    researchVariantSourcesHtml(variant: ResearchHypothesisVariant, catalog: Record<string, { title: string }>): { html: string; count: number } | null {
        const r = strings.research;
        const link = (id: string): string => `<button type="button" class="link-button prv-source" data-source="${esc(id)}">${esc(catalog[id].title)}</button>`;
        const pro = (variant.sourceIds ?? []).filter(id => catalog[id]);
        const against = (variant.against ?? []).filter(a => a.text.trim());
        if (!pro.length && !against.length) return null;
        const proHtml = pro.length ? `
                            <span class="prv-src-label prv-src-label--for"><span class="prv-src-mark" aria-hidden="true">+</span>${esc(r.hypoFor)}</span>
                            <span class="prv-src-list">${pro.map(link).join('')}</span>` : '';
        const againstHtml = against.length ? `
                            <span class="prv-src-label prv-src-label--against"><span class="prv-src-mark" aria-hidden="true">−</span>${esc(r.hypoAgainst)}</span>
                            <span class="prv-src-list">${against.map(a => {
                                const ids = (a.sourceIds ?? []).filter(id => catalog[id]);
                                return `<span class="prv-src-item">${esc(a.text)}${ids.length ? ` ${ids.map(link).join(' ')}` : ''}</span>`;
                            }).join('')}</span>` : '';
        return { html: `
                        <span class="prv-sources">${proHtml}${againstHtml}
                        </span>`, count: pro.length + against.length };
    },

    /**
     * The wait for the research's confirmation (DEV §4): "Waiting for
     * confirmation in the research" (after ten minutes "Not confirmed by the
     * research yet"), the terminal's question, "Open again" (the same link)
     * and "Stop waiting" (forgets it here). At the version chosen, or under
     * the box for No version holds, Leave open and Reopen.
     */
    researchHypothesisWaitHtml(h: ResearchHypothesis, p: PendingHypothesis): string {
        const r = strings.research;
        const long = pendingHypothesisPhase(p, Date.now()) === 'long';
        const text = long ? r.hypoWaitLongText : researchHypothesisWaitText(h, p.do, p.variant);
        return `
                        <span class="prv-wait" role="status" data-wait-phase="${long ? 'long' : 'waiting'}">
                            <span class="prv-wait-title"><span class="prv-wait-dot" aria-hidden="true"></span>${esc(long ? r.hypoWaitLong : r.hypoWait)}</span>
                            ${text ? `<span class="prv-wait-text">${esc(text)}</span>` : ''}
                            <span class="prv-wait-actions">
                                <button type="button" class="link-button prv-wait-again">${researchActionLabel(r.hypoWaitAgain, researchLinkMark('hypothesis'))}</button>
                                <button type="button" class="link-button prv-wait-stop">${esc(r.hypoWaitStop)}</button>
                            </span>
                        </span>`;
    },

    /**
     * Spec 060 K1.8: the person decides and the tree has 10 or more open
     * hypotheses — one sentence offers "The AI decides", a link into the
     * research that confirms it in its terminal (nothing switched here). Only
     * where its bridge takes the choice (`hypotheses.decide`, the value said)
     * and the `hypotheses` link is announced; hidden for this research once
     * hidden. The link and its count, or null.
     */
    researchHypothesesOffer(): { url: string; open: number } | null {
        const rid = this.activeResearchId();
        // An archive has no AI agent to hand the deciding to (spec 074).
        if (!rid || hypothesesOfferHidden(rid) || this.activeResearchArchive()) return null;
        const status = this.researchStatusOf(rid) ?? lastBridgeStatus(rid);
        if (!status?.features?.includes(HYPOTHESES_DECIDE_FEATURE) || status.hypothesesDecide !== 'person') return null;
        const open = [...researchHypotheses(DataManager.getData()).values()].filter(isOpenHypothesis).length;
        if (open < HYPOTHESES_OFFER_MIN) return null;
        const url = this.activeResearchLink('hypotheses', { decide: 'agent' });
        return url ? { url, open } : null;
    },

    researchHypothesesOfferHtml(): string {
        const offer = this.researchHypothesesOffer();
        if (!offer) return '';
        const r = strings.research;
        return `
            <p class="person-research-hypo-offer" id="person-research-hypo-offer">
                <span class="person-research-hypo-offer-text">${esc(r.hypoOfferAgent(offer.open))}</span>
                <button type="button" class="link-button" data-offer="switch">${researchActionLabel(r.hypoOfferSwitch, researchLinkMark('hypotheses'))}</button>
                <button type="button" class="link-button person-research-hypo-offer-hide" data-offer="hide" aria-label="${esc(r.hypoOfferHideSr)}">${esc(r.hypoOfferHide)}</button>
            </p>`;
    },

    /** The offer's link (into the research's terminal) and its "Hide" (remembered for this research). */
    bindResearchHypothesesOffer(root: HTMLElement): void {
        const offer = root.querySelector<HTMLElement>('#person-research-hypo-offer');
        if (!offer) return;
        offer.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-offer]');
            if (!btn) return;
            if (btn.dataset.offer === 'switch') {
                const url = this.researchHypothesesOffer()?.url;
                if (url) this.launchResearchLink(url, 'terminal');
                return;
            }
            const rid = this.activeResearchId();
            if (rid) hideHypothesesOffer(rid);
            // The keyboard stays in the section: on its first hypothesis.
            const next = offer.parentElement?.querySelector<HTMLElement>('.person-research-hypo > summary');
            offer.remove();
            next?.focus({ preventScroll: true });
        });
    },

    /** Wire the hypotheses' switches, "Find" and the long claims (inside the dialog `root`). */
    bindResearchHypotheses(root: HTMLElement, personId: PersonId): void {
        const host = root.querySelector<HTMLElement>('.person-research-hypos');
        if (!host) return;
        const redraw = (focus?: { hypo: string; variant: string }): void => {
            const open = new Set([...host.querySelectorAll<HTMLDetailsElement>('.person-research-hypo')].filter(d => d.open).map(d => d.dataset.hypo ?? ''));
            const expanded = new Set([...host.querySelectorAll<HTMLElement>('.person-research-variant.is-expanded')]
                .map(row => `${row.closest<HTMLElement>('[data-hypo]')?.dataset.hypo}:${row.dataset.variant}`));
            const sourcesOpen = [...host.querySelectorAll<HTMLElement>('.person-research-variant.is-sources-open')]
                .map(row => [row.closest<HTMLElement>('[data-hypo]')?.dataset.hypo ?? '', row.dataset.variant ?? ''] as const);
            host.innerHTML = this.researchHypothesesHtml(personId, DataManager.getPerson(personId)?.research?.hypotheses ?? []);
            host.querySelectorAll<HTMLDetailsElement>('.person-research-hypo[data-hypo]').forEach(d => { d.open = open.has(d.dataset.hypo!); });
            for (const key of expanded) {
                const [hypo, variant] = key.split(':');
                this.expandResearchVariant(host, hypo, variant);
            }
            for (const [hypo, variant] of sourcesOpen) {
                const row = host.querySelector<HTMLElement>(`[data-hypo="${CSS.escape(hypo)}"] .person-research-variant[data-variant="${CSS.escape(variant)}"]`);
                row?.classList.add('is-sources-open');
                row?.querySelector('.prv-sources-toggle')?.setAttribute('aria-expanded', 'true');
            }
            if (focus) {
                host.querySelector<HTMLElement>(`[data-hypo="${CSS.escape(focus.hypo)}"] .view-link-switch[data-variant="${CSS.escape(focus.variant)}"]`)?.focus({ preventScroll: true });
            }
        };
        // A wait asked or ended (here, or by the research's confirmation): the cards drawn again,
        // the keyboard kept on the card it was in.
        redrawHypotheses = () => {
            if (!host.isConnected) { redrawHypotheses = null; return; }
            const active = document.activeElement as HTMLElement | null;
            const inHypo = active && host.contains(active) ? active.closest<HTMLElement>('[data-hypo]')?.dataset.hypo : undefined;
            redraw();
            if (inHypo) focusHypothesis(host, inHypo);
        };
        onPendingHypothesisChange(redrawPendingHypotheses);
        const hypothesisOf = (id: string): ResearchHypothesis | undefined =>
            (DataManager.getPerson(personId)?.research?.hypotheses ?? []).find(h => h.id === id);
        // Ask the research (its terminal) to decide for a version, abandon, leave open or reopen,
        // and wait here for its confirmation (DEV §4).
        const ask = (hypo: string, what: 'decide' | 'abandon' | 'keep-open' | 'reopen', variant?: string): void => {
            const rid = this.activeResearchId();
            const h = hypothesisOf(hypo);
            const url = this.activeResearchLink('hypothesis', { hypothesis: hypo, hypothesisDo: what, ...(variant ? { variant } : {}) });
            if (!rid || !h || !url) return;
            this.launchResearchLink(url, 'terminal');
            changingHypotheses.delete(hypothesisKey(rid, hypo));
            setPendingHypothesis(rid, hypo, newPendingHypothesis(h, what, url, this.researchSyncLink()?.link.head ?? '', Date.now(), variant));
            focusHypothesis(host, hypo);
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
            const reason = target.closest<HTMLButtonElement>('.prh-reason--more');
            if (reason) {
                const on = reason.getAttribute('aria-expanded') !== 'true';
                reason.closest('.person-research-hypo-reason')?.classList.toggle('is-expanded', on);
                reason.setAttribute('aria-expanded', String(on));
                return;
            }
            const sourcesToggle = target.closest<HTMLButtonElement>('.prv-sources-toggle');
            if (sourcesToggle) {
                const row = sourcesToggle.closest<HTMLElement>('.person-research-variant')!;
                const on = !row.classList.contains('is-sources-open');
                row.classList.toggle('is-sources-open', on);
                sourcesToggle.setAttribute('aria-expanded', String(on));
                return;
            }
            const source = target.closest<HTMLButtonElement>('.prv-source');
            if (source) {
                this.showSourceViewer(source.dataset.source ?? '', { personId });
                return;
            }
            if (!hypo) return;
            const rid = this.activeResearchId();
            const pickBtn = target.closest<HTMLButtonElement>('[data-hypo-pick]');
            if (pickBtn) {
                if (!pickBtn.disabled) ask(hypo, 'decide', pickBtn.dataset.hypoPick);
                return;
            }
            const act = target.closest<HTMLButtonElement>('[data-hypo-act]');
            if (act) {
                if (act.disabled || !rid) return;
                const what = act.dataset.hypoAct;
                if (what === 'change' || what === 'change-cancel') {
                    // The change mode (DEV §6): the versions offered, or back to the decided card.
                    if (what === 'change') changingHypotheses.add(hypothesisKey(rid, hypo));
                    else changingHypotheses.delete(hypothesisKey(rid, hypo));
                    redraw();
                    const card = host.querySelector<HTMLElement>(`[data-hypo="${CSS.escape(hypo)}"]`);
                    (what === 'change'
                        ? card?.querySelector<HTMLElement>('.prv-pick:not([disabled])')
                        : card?.querySelector<HTMLElement>('[data-hypo-act="change"]'))?.focus({ preventScroll: true });
                } else if (what === 'abandon' || what === 'keep-open' || what === 'reopen') {
                    ask(hypo, what);
                }
                return;
            }
            if (target.closest('.prv-wait-again')) {
                const url = rid ? pendingHypothesis(rid, hypo)?.url : undefined;
                if (url) this.launchResearchLink(url, 'terminal');
                return;
            }
            if (target.closest('.prh-decided-load')) {
                void this.researchLoadNewer();
                return;
            }
            if (target.closest('.prv-wait-stop')) {
                if (rid) setPendingHypothesis(rid, hypo, null);
                host.querySelector<HTMLElement>(`[data-hypo="${CSS.escape(hypo)}"] > summary`)?.focus({ preventScroll: true });
                return;
            }
            // Into the research: decide the hypothesis there, or change its decision (its terminal).
            if (target.closest('[data-hypo-do="decide"]')) {
                const url = this.activeResearchLink('hypothesis', { hypothesis: hypo, hypothesisDo: 'decide' });
                if (url) this.launchResearchLink(url, 'terminal');
                return;
            }
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
        // A change begun is not carried to the next opening (DEV §6); a wait asked is (DEV §4).
        changingHypotheses.clear();
        redrawHypotheses = null;
        // A decision made otherwise is said once, at the card open then (DEV §4).
        const closedRid = this.activeResearchId();
        if (closedRid) clearHypothesisCardNotes(closedRid, 'elsewhere');
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
        // Folded away is the titles' own group, not a closed dialog around it
        // (a closed dialog is hidden too, and the form is marked before it shows).
        const titleInput = (id: string): string =>
            document.getElementById(id)?.closest<HTMLElement>('.name-titles')?.hidden ? 'input-firstname' : id;
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
                tag.setAttribute('aria-label', (conflicts.some(conflictFromEdit) ? r.conflictTagEditSr : r.conflictTagSr)(researchFactLabel(fact)));
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
