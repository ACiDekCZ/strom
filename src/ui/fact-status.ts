/**
 * One mark of reliability per fact (spec 066 §2): a small pill beside the
 * fact — confirmed by a person (✓), proven (●● / ●○), the research's
 * probable / possible, from the family tree (○○, dashed), a lead, no source
 * (dotted). Steps differ by dots, ✓ and the frame, never by colour.
 * Read-only: the research and the app's import record decide it, the pill
 * only shows it. No step, no pill.
 *
 * The pill is a button: its title says the whole step; a click (on touch a
 * tap) opens the same text under the row with a link into the help, a second
 * click, a click elsewhere or Esc closes it.
 */

import { FactPart, FactStatus, ImportRecord, Person, StromData } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { importDateText, importProgramLabel } from '../import-next.js';
import {
    FactReliability, PersonOriginSummary, ReliabilityOptions, ReliabilityStep, ReliabilityStepName, factReliability,
    reliabilityStep, sameStep, weakestStep,
} from '../reliability.js';
import { HELP_TOPICS } from '../help/topics.js';
import { openHelp } from './help-ui.js';

const escText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => escText(s).replace(/"/g, '&quot;');

type Lang = 'cs' | 'en' | 'de' | 'pl';

function uiLang(): Lang {
    const l = getCurrentLanguage();
    return l === 'cs' || l === 'de' || l === 'pl' ? l : 'en';
}

/** The status's name in the UI language ('' for none). */
export function factStatusLabel(status: FactStatus | undefined): string {
    return status ? strings.factStatus[status] : '';
}

/** The pill's short text of a step. */
export function reliabilityLabel(step: ReliabilityStepName): string {
    const r = strings.reliability;
    if (step === 'human') return r.human;
    if (step === 'proven') return r.proven;
    if (step === 'import') return r.import;
    if (step === 'none') return r.none;
    return strings.factStatus[step];
}

/** `{prog}` and `{date}` of an import record, in the UI language. */
export function importOriginParts(rec: ImportRecord, lang: Lang = uiLang()): { prog: string; date: string; loaded: string } {
    const day = rec.at.slice(0, 10);
    return {
        prog: importProgramLabel(rec),
        date: importDateText(rec, lang),
        loaded: /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatFlexDate(day, lang) : rec.at,
    };
}

/** "date and place" of a fact's parts. */
function partsText(parts: readonly FactPart[]): string {
    const r = strings.reliability;
    return r.joinParts(parts.map(p => r.part[p]));
}

export interface ReliabilityTitleOptions {
    /** The tree is the research's with origin: no "no source yet" note (the research tells). */
    research?: boolean;
}

/**
 * The whole step in words (the pill's title, aria-label and the tap
 * tooltip's text): who stands behind the value, and where an imported value
 * came from. A fact partly from the family tree says which part (and in a
 * tree without the research, that no source backs it yet).
 */
export function reliabilityTitle(r: ReliabilityStep & Partial<Pick<FactReliability, 'importRecord' | 'fromParts' | 'changedParts'>>,
    opts: ReliabilityTitleOptions = {}): string {
    const s = strings.reliability;
    const origin = r.importRecord ? importOriginParts(r.importRecord) : null;
    const withImport = (t: string): string => (origin && r.fromImport ? `${t} ${s.fromImport(origin.prog, origin.date)}` : t);
    switch (r.step) {
        case 'human': return withImport(s.titleHuman);
        case 'proven': return withImport(r.dots === 2 ? s.titleProven2 : s.titleProven1);
        case 'none': return s.titleNone;
        case 'import': {
            if (!origin) return reliabilityLabel('import');
            const from = r.fromParts ?? [];
            const changed = r.changedParts ?? [];
            if (from.length > 0 && changed.length > 0) {
                const text = s.partial(partsText(from), partsText(changed));
                return opts.research ? text : `${text} ${s.noSourceYet}`;
            }
            return s.titleImport(origin.prog, origin.date);
        }
        default: return withImport(strings.factStatus.title(reliabilityLabel(r.step)));
    }
}

/** The pill's glyphs: ✓ for a person's, dots for proven (by readers) and from the family tree. */
function glyphsHtml(r: ReliabilityStep): string {
    if (r.step === 'human') return '<span class="fs-check" aria-hidden="true">✓</span>';
    if (r.step === 'proven') return `<span class="fs-dots" aria-hidden="true"><i class="on"></i><i${r.dots === 2 ? ' class="on"' : ''}></i></span>`;
    if (r.step === 'import') return '<span class="fs-dots" aria-hidden="true"><i></i><i></i></span>';
    return '';
}

export interface ReliabilityHtmlOptions {
    /** A plain span (inside another button, where a button cannot be): the title only, no tap tooltip. */
    inert?: boolean;
    /** Extra classes (e.g. where it stands). */
    className?: string;
    /** The fact it marks (data-fact), for the places that look it up. */
    fact?: string;
}

/** A step's pill ('' for none). */
export function reliabilityHtml(step: ReliabilityStep | null | undefined, title: string, opts: ReliabilityHtmlOptions = {}): string {
    if (!step) return '';
    const label = reliabilityLabel(step.step);
    const cls = `fact-status fact-status-${step.step}${opts.className ? ` ${opts.className}` : ''}`;
    const attrs = `class="${cls}" data-fact-status="${step.step}"${step.step === 'proven' ? ` data-dots="${step.dots ?? 1}"` : ''}`
        + `${opts.fact ? ` data-fact="${escAttr(opts.fact)}"` : ''} title="${escAttr(title)}"`;
    const inner = `${glyphsHtml(step)}<span class="fs-text">${escText(label)}</span>`;
    return opts.inert
        ? `<span ${attrs}>${inner}</span>`
        : `<button type="button" ${attrs} aria-label="${escAttr(`${label}: ${title}`)}" aria-expanded="false">${inner}</button>`;
}

/** A fact's pill from its reliability ('' for none). */
export function factReliabilityHtml(r: FactReliability | null | undefined, opts: ReliabilityHtmlOptions & ReliabilityTitleOptions = {}): string {
    return r ? reliabilityHtml(r, reliabilityTitle(r, opts), opts) : '';
}

/** The research's status alone as a pill ('' for none): what the research holds of a fact, with no origin known. */
export function factStatusHtml(status: FactStatus | undefined, opts: ReliabilityHtmlOptions = {}): string {
    const step = reliabilityStep({ status });
    return step ? reliabilityHtml(step, reliabilityTitle(step), opts) : '';
}

/**
 * Where the person card shows the marks (the "same marks" rule): when every
 * fact shown has the same step and they come from a family tree, one pill in
 * the person-origin row and none at the facts; otherwise (also when a fact is
 * only partly from the file) the row (when any fact is from a family tree)
 * explains the mark and each fact has its own.
 */
export function personMarksLayout(summary: PersonOriginSummary): {
    row: null | { text: string; step?: ReliabilityStep };
    atFacts: boolean;
} {
    const rec = summary.importRecord;
    if (!rec) return { row: null, atFacts: true };
    const o = importOriginParts(rec);
    // A fact partly changed since says so at itself, so the facts then keep their own pills.
    const partial = summary.facts.some(f => f.changedParts.length > 0);
    if (summary.allSameStep && !partial) {
        return { row: { text: strings.reliability.originAll(o.prog, o.date, o.loaded), step: summary.allSameStep }, atFacts: false };
    }
    return { row: { text: strings.reliability.originMixed(o.prog, o.date, o.loaded) }, atFacts: true };
}

/** The pill of the person-origin row: the step every fact shares, said with the record. */
export function originRowPillHtml(summary: PersonOriginSummary, step: ReliabilityStep, opts: ReliabilityTitleOptions = {}): string {
    const first = summary.facts.find(f => sameStep(f, step));
    return first ? factReliabilityHtml(first, opts) : reliabilityHtml(step, reliabilityTitle(step, opts));
}

/** The facts the tree card's mini mark stands for (§2f). */
const CARD_FACTS = ['name', 'birth', 'death'] as const;

/**
 * The tree card's mini mark ('' for none): no text, the weakest step of the
 * name, the birth and the death; its title says the step and which facts.
 */
export function cardReliabilityMarkHtml(data: Pick<StromData, 'imports'>, person: Person, opts: ReliabilityOptions): string {
    const facts = CARD_FACTS.map(f => ({ f, r: factReliability(data, person, f, opts) }));
    const weakest = weakestStep(facts.map(x => x.r));
    if (!weakest) return '';
    const s = strings.reliability;
    const which = facts.filter(x => x.r && sameStep(x.r, weakest)).map(x => s.cardFact[x.f]).join(', ');
    const title = `${reliabilityTitle(weakest, { research: opts.originFeature })} · ${s.cardFacts(which)}`;
    const glyphs = glyphsHtml(weakest);
    return `<span class="card-rel-mark fact-status-${weakest.step}" data-fact-status="${weakest.step}" title="${escAttr(title)}">${glyphs}</span>`;
}

/** The row the tap tooltip opens under (inside a form field, after other rows). */
function tipAnchor(pill: HTMLElement): { el: HTMLElement; inside: boolean } {
    const field = pill.closest<HTMLElement>('.form-group');
    if (field) return { el: field, inside: true };
    const row = pill.closest<HTMLElement>('.event-row, .pg-row, .rel-item, .person-origin, .couple-event-row, .fs-row');
    return { el: row ?? pill.parentElement ?? pill, inside: false };
}

let openPill: HTMLElement | null = null;

/** Close the open tap tooltip, if any. */
export function closeReliabilityTip(): void {
    const pill = openPill;
    openPill = null;
    if (!pill) return;
    pill.setAttribute('aria-expanded', 'false');
    document.getElementById('fact-status-tip')?.remove();
}

function openTip(pill: HTMLElement): void {
    closeReliabilityTip();
    const title = pill.getAttribute('title') ?? '';
    const step = (pill.dataset.factStatus ?? 'lead') as ReliabilityStepName;
    const tip = document.createElement('div');
    tip.className = 'fact-status-tip';
    tip.id = 'fact-status-tip';
    tip.setAttribute('role', 'note');
    const head = document.createElement('div');
    head.className = 'fact-status-tip-head';
    head.textContent = reliabilityLabel(step);
    const body = document.createElement('div');
    body.className = 'fact-status-tip-body';
    body.textContent = title;
    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'fact-status-tip-help';
    help.textContent = strings.reliability.help;
    help.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeReliabilityTip();
        void openHelp(HELP_TOPICS.reliability, pill);
    });
    tip.append(head, body, help);
    const { el, inside } = tipAnchor(pill);
    if (inside) el.appendChild(tip);
    else el.insertAdjacentElement('afterend', tip);
    pill.setAttribute('aria-expanded', 'true');
    pill.setAttribute('aria-controls', tip.id);
    openPill = pill;
}

let installed = false;

/**
 * The tap tooltip of every pill (one listener on the document, installed
 * once): a click on a pill opens or closes its text, a click elsewhere or
 * Esc closes it.
 */
export function installReliabilityTips(): void {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        const pill = target?.closest<HTMLElement>('button.fact-status');
        if (pill) {
            // Inside a label: never focus its field; inside a row: never open the row.
            e.preventDefault();
            e.stopPropagation();
            if (openPill === pill) closeReliabilityTip();
            else openTip(pill);
            return;
        }
        if (openPill && !target?.closest('.fact-status-tip')) closeReliabilityTip();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !openPill) return;
        const pill = openPill;
        e.stopPropagation();
        closeReliabilityTip();
        if (pill.isConnected) pill.focus({ preventScroll: true });
    }, true);
}
