/**
 * The status tip (spec 065 round 2): one bubble for every reliability mark —
 * a fact's pill in the person dialog and the relationships panel, the pill of
 * the person-origin row, and the tree card's status mark. It says the step
 * (its glyphs and name), the step's sentence, which facts it applies to (the
 * card, the origin row), the sources cited at the fact (at most three, then a
 * way to all of them), and the way into the help.
 *
 * With a mouse it opens after a moment over the mark and stays while the
 * pointer goes over into it (a bridge spans the gap); a click pins it (Esc,
 * a click elsewhere or a second click closes it, Esc returns the focus).
 * By touch a tap pins it. One tip at a time, in the page's top layer
 * (appended to the body, fixed), so a dialog's scroll never clips it.
 *
 * The same floating bubble also carries a card mark's words by touch
 * (`openMarkTip`), with the mark's action as a button.
 *
 * Extension points: `registerStatusTipExtension` gets every tip drawn with
 * its context and two slots — `.st-reason` between the sentence and the
 * sources, and `div.st-acts` above the help — empty and hidden until an
 * extension fills them.
 */

import { strings } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { sourceEntryText } from '../source-location.js';
import { FactHolder, factCitations, isPartnership } from '../import-origin.js';
import {
    CARD_STATUS_FACTS, CardStatus, FactReliability, ReliabilityOptions, ReliabilityStep, ReliabilityStepName, factReliability,
} from '../reliability.js';
import type { LifeEvent, Partnership, PartnershipId, Person, PersonId, Source, StromData } from '../types.js';
import type { PersonStoryState } from '../card-signals.js';
import type { CitationContext } from './sources.js';
import {
    cardStatusLegendLabel, cardStatusWords, reliabilityLabel, reliabilityTitle, statusMarkHtml,
} from './fact-status.js';
import { iconSvg } from '../icons.js';

type CitationContextLike = CitationContext;

const personIn = (data: StromData, id: string | undefined): Person | undefined => (id ? data.persons[id as PersonId] : undefined);
const unionIn = (data: StromData, id: string | undefined): Partnership | undefined => (id ? data.partnerships[id as PartnershipId] : undefined);

/** What the tip needs of the app (set by the UI once, `installStatusTips`). */
export interface StatusTipHost {
    /** The tree's data now. */
    data(): StromData;
    /** The reliability options now (person-reliability-ui.ts reliabilityOptionsNow). */
    options(): ReliabilityOptions;
    /** The card's mark of a person (TreeRenderer.cardSignalsFor(id)?.status). */
    cardStatus(personId: string): CardStatus | null;
    /** The story the card signals (null: none). */
    story(personId: string): PersonStoryState | null;
    /** How many distinct sources the person cites. */
    personSourceCount(personId: string): number;
    /** Open a source in the viewer at its citation. */
    openSource(sourceId: string, ctx: CitationContext | null): void;
    /** The person's sources dialog, the given sources marked. */
    openPersonSources(personId: string, focusSourceIds: string[]): void;
    /** The person's story. */
    openStory(personId: string): void;
    /** The help on reliability (focus returns to `trigger`). */
    openHelp(trigger: HTMLElement | null): void;
    /** The tree knows where its facts came from (TreeRenderer.treeKnowsOriginNow()). */
    treeKnowsOrigin(): boolean;
}

/** Label of a QUAY value as the source editor names it. */
function qualityLabel(q: number | undefined): string {
    if (q === undefined) return '';
    return q >= 3 ? strings.sources.quality3 : q === 2 ? strings.sources.quality2 : strings.sources.quality1;
}

const TIP_ID = 'status-tip';
/** Rows of sources a tip lists before "and N more". */
const MAX_ROWS = 3;
const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 200;
/** The gap between the mark and the tip (a bridge the pointer crosses). */
const GAP = 8;

/** The pills and marks that open a status tip. */
const TRIGGER_SELECTOR = 'button.fact-status, #tree-canvas .person-card > .card-status-mark[data-mark="status"]';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const upperFirst = (t: string): string => (t ? t.charAt(0).toLocaleUpperCase() + t.slice(1) : t);
const lowerFirst = (t: string): string => (t ? t.charAt(0).toLocaleLowerCase() + t.slice(1) : t);

/** What a tip is about. */
export interface StatusTipContext {
    /** A fact's pill, the origin row's pill (facts sharing one step), or a tree card's mark. */
    kind: 'fact' | 'origin' | 'card';
    personId?: string;
    partnershipId?: string;
    /** The facts it speaks for (one for a fact's pill). */
    facts: string[];
    /** The step said (absent: the card's facts share none, or the citations' level speaks). */
    step?: ReliabilityStepName;
    /** The fact's reliability (a fact's pill, the origin row's first fact, the card's step). */
    reliability?: FactReliability | null;
    /** The mark or pill it opened from. */
    trigger: HTMLElement;
}

/** The empty places an extension may fill (kolo 3: why the step, actions such as Verify). */
export interface StatusTipSlots {
    /** Between the sentence and the sources (`.st-reason`), hidden while empty. */
    reason: HTMLElement;
    /** Above the help (`div.st-acts`, a wrapping row of buttons), hidden while empty. */
    actions: HTMLElement;
}

export type StatusTipExtension = (ctx: StatusTipContext, slots: StatusTipSlots) => void;

const extensions: StatusTipExtension[] = [];

/** Add an extension called for every status tip drawn; returns its removal. */
export function registerStatusTipExtension(ext: StatusTipExtension): () => void {
    extensions.push(ext);
    return () => {
        const i = extensions.indexOf(ext);
        if (i >= 0) extensions.splice(i, 1);
    };
}

let host: StatusTipHost | null = null;

// ==================== The model ====================

export interface SourceRowModel {
    source: Source;
    ctx: CitationContextLike;
    sub: string;
}

export interface SourcesModel {
    head: string;
    rows: SourceRowModel[];
    /** No row: what stands in its place. */
    empty?: string;
    /** The way to all of them ("and 2 more ›", "Person's sources (6) ›"). */
    more?: { label: string; personId: string; sourceIds: string[] };
}

interface TipModel {
    label: string;
    glyphHtml: string;
    sentence: string;
    applies: string;
    sources: SourcesModel | null;
    story: PersonStoryState | null;
}

/** A fact's name in "Applies to" (name, birth, death, sex, an event's type). */
function factName(holder: FactHolder | null, fact: string): string {
    const r = strings.reliability;
    if (fact === 'name' || fact === 'birth' || fact === 'death') return r.cardFact[fact];
    if (fact === 'sex') return r.part.SEX;
    if (fact.startsWith('event:') && holder && !isPartnership(holder)) {
        const ev = (holder.events ?? []).find(e => e?.id === fact.slice(6)) as LifeEvent | undefined;
        if (ev) return lowerFirst(ev.type === 'custom' && ev.customLabel ? ev.customLabel : strings.events.types[ev.type]);
    }
    return fact;
}

/** The step's name in the tip's header (from the family tree: the short title, "(unverified)"). */
function stepLabel(step: ReliabilityStepName): string {
    return step === 'import' ? strings.reliability.titleImportShort : reliabilityLabel(step);
}

/** The step's sentence without its name when the sentence begins with it ("Proven — …"). */
function stepSentence(r: ReliabilityStep & Partial<FactReliability>, label: string, research: boolean): string {
    const title = reliabilityTitle(r, { research });
    if (r.step === 'import' && title === strings.reliability.titleImportShort) return '';
    for (const sep of [' — ', ': ']) {
        const head = `${label}${sep}`;
        if (title.startsWith(head)) return upperFirst(title.slice(head.length));
        const short = `${reliabilityLabel(r.step)}${sep}`;
        if (sep === ' — ' && title.startsWith(short)) return upperFirst(title.slice(short.length));
    }
    if (r.step === 'import') {
        // "From the family tree (unverified): taken from …": the header says the first part.
        const head = `${strings.reliability.titleImportShort}: `;
        if (title.startsWith(head)) return upperFirst(title.slice(head.length));
    }
    return title;
}

/** The pill's glyphs before the step's name. */
function stepGlyphHtml(r: ReliabilityStep): string {
    const dots = (...on: boolean[]): string => `<span class="fs-dots" aria-hidden="true">${on.map(o => (o ? '<i class="on"></i>' : '<i></i>')).join('')}</span>`;
    const inner = r.step === 'human' ? '<span class="fs-check" aria-hidden="true">✓</span>'
        : r.step === 'proven' ? dots(true, r.dots === 2)
        : r.step === 'import' ? dots(false, false)
        : '';
    return `<span class="fact-status fact-status-${r.step} st-pill" aria-hidden="true">${inner}</span>`;
}

/** "fol. 12 · 3 Feb 1865 · original" under a source's title: the reliability is the citation's (spec 077). */
function sourceSub(source: Source, quality: number | undefined): string {
    const date = source.recordDate ? formatFlexDate(source.recordDate) : '';
    return [sourceEntryText(source), date, qualityLabel(quality)].filter(Boolean).join(' · ');
}

/** Sources in the tip's order: the one the value is from first, then by the record's date. */
function orderSources<T extends { source: Source }>(rows: T[], first: string | undefined): T[] {
    const key = (r: T): string => r.source.recordDate ?? '9999';
    const rest = rows.filter(r => r.source.id !== first).sort((a, b) => key(a).localeCompare(key(b)));
    const lead = rows.find(r => r.source.id === first);
    return lead ? [lead, ...rest] : rows.length > 0 ? [rows[0], ...rest.filter(r => r !== rows[0])] : rest;
}

function holderCtx(holder: FactHolder): CitationContextLike {
    return isPartnership(holder) ? { partnershipId: holder.id } : { personId: holder.id };
}

/** The sources block of one fact's pill (each row's reliability that of its citation at the fact). */
export function factSourcesModel(data: StromData, holder: FactHolder, fact: string, r: FactReliability | null,
    personId: string | undefined): SourcesModel {
    const s = strings.reliability;
    const cited = factCitations(data, holder, fact);
    // The record the research read the value from leads, even when it is not cited at the fact.
    const valueId = r?.sourceIds?.find(id => data.sources?.[id]);
    const valueSource = valueId ? data.sources![valueId] : undefined;
    const all: { source: Source; ctx: CitationContextLike; quality?: number }[] = valueSource && !cited.some(c => c.source.id === valueId)
        ? [{ source: valueSource, ctx: holderCtx(holder), quality: valueSource.quality }, ...cited] : cited;
    const ordered = orderSources(all, valueId);
    const rows: SourceRowModel[] = ordered.map((c, i) => {
        let sub = sourceSub(c.source, c.quality);
        if (i === 0 && r?.step === 'proven' && r.dots === 2) sub = [sub, s.readersAgree].filter(Boolean).join(' · ');
        return { source: c.source, ctx: c.ctx, sub };
    });
    const step = r?.step;
    if (rows.length === 0) return { head: s.srcHead, rows: [], empty: step === 'import' ? s.importNoCite : s.noSourceRow };
    const head = step === 'import' ? s.citedInImportHead : rows.length === 1 ? s.srcOne : s.srcN(rows.length);
    const more = rows.length > MAX_ROWS && personId
        ? { label: s.srcMore(rows.length - MAX_ROWS), personId, sourceIds: rows.map(x => x.source.id) } : undefined;
    return { head, rows: more ? rows.slice(0, MAX_ROWS) : rows, more };
}

/** The sources block of a tree card's mark: the sources at its name, birth and death, then all of the person's. */
function cardSourcesModel(data: StromData, person: Person, status: CardStatus): SourcesModel {
    const s = strings.reliability;
    const bySource = new Map<string, { source: Source; ctx: CitationContextLike; facts: string[] }>();
    for (const fact of CARD_STATUS_FACTS) {
        for (const c of factCitations(data, person, fact)) {
            const row = bySource.get(c.source.id) ?? { source: c.source, ctx: c.ctx, facts: [] };
            row.facts.push(s.cardFact[fact]);
            bySource.set(c.source.id, row);
        }
    }
    const valueId = status.step?.sourceIds?.find(id => bySource.has(id));
    const ordered = orderSources([...bySource.values()], valueId);
    const rows: SourceRowModel[] = ordered.map(r => ({
        source: r.source, ctx: r.ctx,
        sub: [r.facts.join(', '), sourceEntryText(r.source)].filter(Boolean).join(' · '),
    }));
    const total = host?.personSourceCount(person.id) ?? rows.length;
    const more = total > 0 ? { label: s.srcPerson(total), personId: person.id, sourceIds: rows.map(x => x.source.id) } : undefined;
    const step = status.step?.step ?? (status.cls === 'cs-import' ? 'import' : undefined);
    if (rows.length === 0) return { head: s.srcHead, rows: [], empty: step === 'import' ? s.importNoCite : s.noSourceRow, more };
    const head = step === 'import' ? s.citedInImportHead : rows.length === 1 ? s.srcOne : s.srcN(rows.length);
    return { head, rows: rows.slice(0, MAX_ROWS), more };
}

/** What a trigger is about, read from its attributes (null: nothing to say). */
function contextOf(trigger: HTMLElement): StatusTipContext | null {
    if (!host) return null;
    const data = host.data();
    const opts = host.options();
    if (trigger.matches('.card-status-mark')) {
        const personId = trigger.closest<HTMLElement>('.person-card')?.dataset.id;
        if (!personId || !personIn(data, personId)) return null;
        const status = host.cardStatus(personId);
        if (!status) return null;
        return { kind: 'card', personId, facts: [...status.facts], step: status.step?.step, reliability: status.step ?? null, trigger };
    }
    const personId = trigger.dataset.stPerson;
    const partnershipId = trigger.dataset.stPartnership;
    const facts = (trigger.dataset.stFacts ?? trigger.dataset.fact ?? '').split(',').filter(Boolean);
    const holder: FactHolder | undefined = partnershipId ? unionIn(data, partnershipId)
        : personId ? personIn(data, personId) : undefined;
    const r = holder && facts[0] ? factReliability(data, holder, facts[0], opts) : null;
    const step = (r?.step ?? trigger.dataset.factStatus) as ReliabilityStepName | undefined;
    return { kind: trigger.dataset.stFacts ? 'origin' : 'fact', personId, partnershipId, facts, step, reliability: r, trigger };
}

function modelOf(ctx: StatusTipContext, touch: boolean): TipModel | null {
    if (!host) return null;
    const data = host.data();
    const research = host.options().originFeature;
    if (ctx.kind === 'card') {
        const person = personIn(data, ctx.personId);
        const status = host.cardStatus(ctx.personId!);
        if (!person || !status) return null;
        let label: string;
        let sentence: string;
        if (status.source === 'step' && status.step) {
            label = stepLabel(status.step.step);
            sentence = stepSentence(status.step, label, research);
        } else {
            const words = cardStatusWords(status, host.treeKnowsOrigin());
            label = status.source === 'step' ? upperFirst(cardStatusLegendLabel(status.cls)) : strings.card.evTitle[status.evidence?.level ?? 'none'];
            sentence = words.sub;
        }
        const r = strings.reliability;
        const applies = status.facts.length > 0 ? r.appliesTo(r.joinParts(status.facts.map(f => r.cardFact[f]))) : '';
        return {
            label, sentence, applies,
            glyphHtml: statusMarkHtml(status, { className: 'card-status-mark--inline' }),
            sources: cardSourcesModel(data, person, status),
            story: touch ? host.story(person.id) : null,
        };
    }
    const step = ctx.step;
    if (!step) return null;
    const label = stepLabel(step);
    const r: ReliabilityStep & Partial<FactReliability> = ctx.reliability ?? { step };
    const holder: FactHolder | undefined = ctx.partnershipId ? unionIn(data, ctx.partnershipId)
        : ctx.personId ? personIn(data, ctx.personId) : undefined;
    // A pill that is no fact's (a parent's or a partner's link): its own sentence, no sources.
    const sentence = holder ? stepSentence(r, label, research) : (ctx.trigger.dataset.stTitle ?? '');
    const rel = strings.reliability;
    const applies = ctx.kind === 'origin' && ctx.facts.length > 1
        ? rel.appliesTo(rel.joinParts(ctx.facts.map(f => factName(holder ?? null, f)))) : '';
    const personOf = (u: Partnership): string => u.person1Id;
    const sourcesPerson = ctx.personId ?? (holder && isPartnership(holder) ? personOf(holder) : undefined);
    let sources: SourcesModel | null = null;
    if (holder && ctx.kind === 'fact' && ctx.facts[0]) {
        sources = factSourcesModel(data, holder, ctx.facts[0], ctx.reliability ?? null, sourcesPerson);
    } else if (holder && ctx.kind === 'origin') {
        // The origin row: the sources at each of its facts, one row per source.
        const seen = new Map<string, SourceRowModel>();
        for (const f of ctx.facts) {
            for (const row of factSourcesModel(data, holder, f, null, undefined).rows) if (!seen.has(row.source.id)) seen.set(row.source.id, row);
        }
        const rows = [...seen.values()];
        sources = rows.length === 0
            ? { head: rel.srcHead, rows: [], empty: step === 'import' ? rel.importNoCite : rel.noSourceRow }
            : {
                head: step === 'import' ? rel.citedInImportHead : rows.length === 1 ? rel.srcOne : rel.srcN(rows.length),
                rows: rows.slice(0, MAX_ROWS),
                more: rows.length > MAX_ROWS && sourcesPerson
                    ? { label: rel.srcMore(rows.length - MAX_ROWS), personId: sourcesPerson, sourceIds: rows.map(x => x.source.id) } : undefined,
            };
    }
    return { label, glyphHtml: stepGlyphHtml(r), sentence, applies, sources, story: null };
}

// ==================== Drawing ====================

function tipHtml(m: TipModel): string {
    const s = strings.reliability;
    const src = m.sources;
    const rows = src ? src.rows.map((r, i) => `
        <button type="button" class="st-src" data-row="${i}" data-source-id="${esc(r.source.id)}" data-ctx="${esc(JSON.stringify(r.ctx))}">
            <span class="st-src-icon" aria-hidden="true">${iconSvg('file', { size: 14 })}</span>
            <span class="st-src-text"><span class="st-src-title">${esc(r.source.title)}</span>${r.sub ? `<span class="st-src-sub">${esc(r.sub)}</span>` : ''}</span>
        </button>`).join('') : '';
    const story = m.story
        ? `<button type="button" class="st-story st-link">${esc(strings.card.tipStoryRow(m.story.title))}</button>` : '';
    return `
        <div class="st-head badge-tooltip-header">${m.glyphHtml}<span class="st-step">${esc(m.label)}</span></div>
        ${m.sentence ? `<div class="st-sentence">${esc(m.sentence)}</div>` : ''}
        ${m.applies ? `<div class="st-applies">${esc(m.applies)}</div>` : ''}
        <div class="st-reason" hidden></div>
        ${src ? `<div class="st-sources">
            <div class="st-src-head">${esc(src.head)}</div>
            ${rows}
            ${src.empty ? `<div class="st-src-none">${esc(src.empty)}</div>` : ''}
            ${src.more ? `<button type="button" class="st-more st-link">${esc(src.more.label)}</button>` : ''}
        </div>` : ''}
        ${story}
        <div class="st-acts" hidden></div>
        <button type="button" class="st-help st-link">${esc(s.help)}</button>`;
}

// ==================== The floating bubble ====================

let tip: HTMLElement | null = null;
let current: HTMLElement | null = null;
let pinned = false;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
/** The last tip's context and touch flag (a refresh draws it again). */
let lastCtx: StatusTipContext | null = null;
let lastTouch = false;

function clearTimers(): void {
    if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
}

function isTouchNow(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function canHover(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
}

/**
 * The tip's content in its own scrolling box: the arrow and the mouse's
 * bridge to the mark stand outside the bubble, and in the scrolling bubble
 * itself they made it scroll (a bridge under a tip above its mark: 9 px, two
 * scrollbars) while its content fitted.
 */
function setTipContent(el: HTMLElement, html: string): void {
    el.innerHTML = `<div class="st-scroll">${html}</div>`;
}

/** The tip's element, made once. */
function tipElement(): HTMLElement {
    if (tip && tip.isConnected) return tip;
    tip = document.createElement('div');
    tip.id = TIP_ID;
    tip.className = 'status-tip';
    tip.setAttribute('role', 'dialog');
    tip.addEventListener('mouseenter', () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } });
    tip.addEventListener('mouseleave', (e) => {
        if (pinned) return;
        const to = e.relatedTarget as Node | null;
        if (to && current?.contains(to)) return;
        scheduleClose();
    });
    tip.addEventListener('click', onTipClick);
    tip.addEventListener('keydown', onTipKey);
    return tip;
}

/** Put the tip under its mark, its right edge at the mark's (above when there is no room below). */
function place(): void {
    if (!tip || !current) return;
    if (!current.isConnected) { closeStatusTip(); return; }
    const r = current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = vw <= 640 ? 16 : 8;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = r.right - w;
    left = Math.max(margin, Math.min(left, vw - w - margin));
    let top = r.bottom + GAP;
    let above = false;
    if (top + h > vh - 8 && r.top - GAP - h >= 8) { top = r.top - GAP - h; above = true; }
    top = Math.max(8, Math.min(top, vh - h - 8));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.classList.toggle('st-above', above);
    const arrow = Math.max(12, Math.min(r.left + r.width / 2 - left, w - 12));
    tip.style.setProperty('--st-arrow-x', `${Math.round(arrow)}px`);
}

function setTrigger(next: HTMLElement | null): void {
    if (current && current !== next) {
        current.classList.remove('st-pinned');
        if (current.matches('button')) current.setAttribute('aria-expanded', 'false');
        current.removeAttribute('aria-controls');
    }
    current = next;
}

function show(trigger: HTMLElement, fill: (el: HTMLElement) => string | null, asPinned: boolean): boolean {
    clearTimers();
    const el = tipElement();
    const label = fill(el);
    if (label === null) { closeStatusTip(); return false; }
    setTrigger(trigger);
    el.setAttribute('aria-label', label);
    if (!el.isConnected) document.body.appendChild(el);
    el.hidden = false;
    pinned = asPinned;
    el.classList.toggle('st-is-pinned', asPinned);
    if (trigger.matches('button')) trigger.setAttribute('aria-expanded', asPinned ? 'true' : 'false');
    trigger.setAttribute('aria-controls', TIP_ID);
    trigger.classList.toggle('st-pinned', asPinned);
    place();
    return true;
}

/** Open the status tip of a pill or a card's mark (`pinned`: by a click or a tap). */
export function openStatusTip(trigger: HTMLElement, opts: { pinned?: boolean } = {}): boolean {
    const ctx = contextOf(trigger);
    if (!ctx) return false;
    const touch = isTouchNow();
    return show(trigger, (el) => {
        const m = modelOf(ctx, touch);
        if (!m) return null;
        el.className = 'status-tip';
        setTipContent(el, tipHtml(m));
        lastCtx = ctx;
        lastTouch = touch;
        runExtensions(el, ctx);
        return m.label;
    }, !!opts.pinned);
}

function runExtensions(el: HTMLElement, ctx: StatusTipContext): void {
    const reason = el.querySelector<HTMLElement>('.st-reason');
    const actions = el.querySelector<HTMLElement>('.st-acts');
    if (!reason || !actions) return;
    for (const ext of extensions) {
        try { ext(ctx, { reason, actions }); } catch (e) { console.error(e); }
    }
    reason.hidden = reason.childNodes.length === 0;
    actions.hidden = actions.childNodes.length === 0;
}

/** Draw the open status tip again (its facts or sources changed). */
export function refreshStatusTip(): void {
    if (!tip || !current || !lastCtx || tip.hidden || !tip.classList.contains('status-tip') || tip.dataset.kind === 'mark') return;
    const ctx = contextOf(current);
    const m = ctx ? modelOf(ctx, lastTouch) : null;
    if (!ctx || !m) { closeStatusTip(); return; }
    setTipContent(tip, tipHtml(m));
    lastCtx = ctx;
    runExtensions(tip, ctx);
    place();
}

/** A card mark's words in the floating bubble (by touch): its header, its lines, its action as a button. */
export interface MarkTipContent {
    head: string;
    /** The lines under the header (HTML, escaped by the caller). */
    bodyHtml: string;
    /** The mark's action, a 44 px button (none: the words alone). */
    button?: { label: string; run: () => void };
}

/** Open a card mark's bubble (pinned), by touch. */
export function openMarkTip(trigger: HTMLElement, content: MarkTipContent): boolean {
    return show(trigger, (el) => {
        el.className = 'status-tip mark-tip-panel';
        el.dataset.kind = 'mark';
        setTipContent(el, `<div class="st-head badge-tooltip-header"><span class="st-step">${esc(content.head)}</span></div>`
            + `<div class="st-body">${content.bodyHtml}</div>`
            + (content.button ? `<button type="button" class="st-mark-action st-link">${esc(content.button.label)}</button>` : ''));
        const btn = el.querySelector<HTMLButtonElement>('.st-mark-action');
        if (btn && content.button) {
            const run = content.button.run;
            btn.addEventListener('click', (e) => { e.stopPropagation(); closeStatusTip(); run(); });
        }
        lastCtx = null;
        return content.head;
    }, true);
}

/** Close the open tip (`returnFocus`: back to its pill, after Esc). */
export function closeStatusTip(returnFocus = false): void {
    clearTimers();
    const trigger = current;
    setTrigger(null);
    pinned = false;
    lastCtx = null;
    if (tip) {
        tip.hidden = true;
        delete tip.dataset.kind;
        tip.remove();
    }
    if (returnFocus && trigger?.isConnected && trigger.matches('button, [tabindex]')) trigger.focus({ preventScroll: true });
}

/** Whether a tip is open (for tests and callers). */
export function statusTipOpen(): boolean {
    return !!tip && tip.isConnected && !tip.hidden;
}

function scheduleClose(): void {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeTimer = null; if (!pinned) closeStatusTip(); }, CLOSE_DELAY_MS);
}

function onTipClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!host) return;
    const src = target.closest<HTMLElement>('.st-src');
    const trigger = current;
    if (src) {
        e.stopPropagation();
        let ctx: CitationContextLike | null = null;
        try { ctx = JSON.parse(src.dataset.ctx ?? 'null') as CitationContextLike | null; } catch { ctx = null; }
        closeStatusTip();
        host.openSource(src.dataset.sourceId ?? '', ctx);
        return;
    }
    if (target.closest('.st-more')) {
        e.stopPropagation();
        const m = lastCtx ? modelOf(lastCtx, lastTouch) : null;
        const more = m?.sources?.more;
        closeStatusTip();
        if (more) host.openPersonSources(more.personId, more.sourceIds);
        return;
    }
    if (target.closest('.st-story')) {
        e.stopPropagation();
        const personId = lastCtx?.personId;
        closeStatusTip();
        if (personId) host.openStory(personId);
        return;
    }
    if (target.closest('.st-help')) {
        e.stopPropagation();
        closeStatusTip();
        host.openHelp(trigger);
    }
}

/** The tip's buttons in a ring for Tab; Shift+Tab from the first goes back to its pill. */
function onTipKey(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !tip) return;
    const items = [...tip.querySelectorAll<HTMLElement>('button:not([hidden]), [href], [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.closest('[hidden]'));
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
        if (current?.isConnected && current.matches('button')) { e.preventDefault(); current.focus({ preventScroll: true }); }
        return;
    }
    if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
}

let installed = false;

/**
 * The status tip of every pill and card mark (listeners on the document,
 * installed once); `h` tells it the tree's data and opens what its links lead to.
 */
export function installStatusTips(h: StatusTipHost): void {
    host = h;
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('mouseover', (e) => {
        if (!canHover()) return;
        const trigger = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(TRIGGER_SELECTOR);
        if (!trigger) return;
        if (trigger === current) { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } return; }
        if (pinned) return;
        if (openTimer) clearTimeout(openTimer);
        openTimer = setTimeout(() => {
            openTimer = null;
            if (trigger.isConnected && trigger.matches(':hover')) openStatusTip(trigger);
        }, OPEN_DELAY_MS);
    });
    document.addEventListener('mouseout', (e) => {
        const trigger = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(TRIGGER_SELECTOR);
        if (!trigger) return;
        const to = e.relatedTarget as Node | null;
        if (to && (trigger.contains(to) || tip?.contains(to))) return;
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
        if (trigger === current && !pinned) scheduleClose();
    });
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(`#${TIP_ID}`)) return;
        const trigger = target?.closest?.<HTMLElement>(TRIGGER_SELECTOR);
        if (trigger) {
            // Inside a label: never focus its field; inside a row or on a card: never open them.
            e.preventDefault();
            e.stopPropagation();
            if (trigger === current && pinned) closeStatusTip();
            else openStatusTip(trigger, { pinned: true });
            return;
        }
        if (current) closeStatusTip();
    }, true);
    // A press elsewhere (the tree panned, a dialog scrolled by the finger) closes it.
    document.addEventListener('pointerdown', (e) => {
        if (!current) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(`#${TIP_ID}`) || target?.closest?.(TRIGGER_SELECTOR)) return;
        closeStatusTip();
    }, true);
    document.addEventListener('wheel', (e) => {
        if (current && !(e.target as HTMLElement | null)?.closest?.(`#${TIP_ID}`)) closeStatusTip();
    }, { capture: true, passive: true });
    document.addEventListener('keydown', (e) => {
        if (!current) return;
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            closeStatusTip(true);
            return;
        }
        // Tab from the pinned pill goes into its tip.
        if (e.key === 'Tab' && !e.shiftKey && pinned && document.activeElement === current && tip) {
            const first = tip.querySelector<HTMLElement>('button');
            if (first) { e.preventDefault(); first.focus(); }
        }
    }, true);
    window.addEventListener('scroll', (e) => {
        if (current && !(e.target instanceof Node && tip?.contains(e.target))) place();
    }, true);
    window.addEventListener('resize', () => { if (current) place(); });
}
